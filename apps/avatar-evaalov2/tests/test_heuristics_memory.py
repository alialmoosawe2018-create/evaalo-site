"""Tests for interview heuristics and memory loop prevention."""

from __future__ import annotations

import pytest

from voice_interview.active_question import STATUS_AWAITING_ANSWER, STATUS_REJECTED, TurnPlan
from voice_interview.assistant import InterviewAssistant, InterviewMemory, TtsRouteContext
from voice_interview.heuristics import analyze_user_answer, normalize_text
from voice_interview.entity_policy import build_glossary_entries


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _make_assistant(bank: list[str] | None = None) -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=bank or [],
        bank_key="test",
        position="Petroleum Engineer",
        candidate_gender="male",
        has_domain_guidance=True,
    )


# ── Heuristics: topic change (real STT fragments) ──────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "خلينا نغير سؤال",
        "الحقيقة ما فكر بهذا السؤال ممكن نغير سؤال",
        "ما عندي جواب على هذا السؤال",
        "هذا السؤال ما اعرفه",
        "ممكن غير السؤال",
        "السؤال ما عاجبني",
    ],
)
def test_topic_change_soft_phrases(text: str) -> None:
    diag = analyze_user_answer(text)
    assert diag["is_topic_change_request"] is True
    assert diag["is_incomplete_turn"] is False


@pytest.mark.parametrize(
    "text",
    [
        "خلينا نغير سؤال",
        "خلينا. غير. السؤال.",
        "ممكن نغير السؤال أكثر",
        "سؤال اخر ايضا",
        "وكله غير السؤال",
        "انا غير السؤال ايضا",
        "غير اكثر",
        "change question please",
        "skip",
    ],
)
def test_topic_change_detected(text: str) -> None:
    diag = analyze_user_answer(text)
    assert diag["is_topic_change_request"] is True


@pytest.mark.parametrize(
    "text,kind",
    [
        ("ممكن تعرفيني أكثر عن نفسك", "ask_interviewer"),
        ("ممكن عرفيني عن نفسك", "ask_interviewer"),
        ("انت منو", "ask_interviewer"),
        ("ممكن تعرفنا على حضرتك", "ask_interviewer"),
        ("تعرفرينة على حضرتج", "ask_interviewer"),
        ("زين ممكن تعرفيني على چنت احنا لسه ما تعرفنا عليك", "ask_interviewer"),
        ("تعرفيني عليك شكو انت", "ask_interviewer"),
        ("عرفني عن نفسي", "intro_self"),
        ("شنو دخل المهندس البترول هذا", "role_objection"),
        ("بس وضحي لي شنو تقصدين بالقضية الحساسة", "clarify_term"),
        ("بلكت توضحي لي السؤال اكثر", "clarify_term"),
        ("what do you mean by that", "clarify_term"),
        ("who are you interviewing me", "ask_interviewer"),
        ("introduce yourself", "ask_interviewer"),
    ],
)
def test_meta_request_detected(text: str, kind: str) -> None:
    diag = analyze_user_answer(text)
    assert diag["meta_request"] == kind


def test_rich_answer_detected() -> None:
    text = (
        "اشتغلت في حقل الشعيبة ومجنون كمهندس انتاج في البصرة في العراق "
        "وكنا ندير عمل الانتاج ونراقبها ونسوي تقارير يوميه واسبوعيا"
    )
    diag = analyze_user_answer(text)
    assert diag["is_rich_answer"] is True
    assert diag["is_substantive_answer"] is True
    assert diag["is_topic_change_request"] is False


def test_greeting_ready_not_substantive() -> None:
    diag = analyze_user_answer("اهلا. وسهلا. انا جاهز. فضلت. أنا جاهز.")
    assert diag["is_greeting_or_ready"] is True
    assert diag["is_substantive_answer"] is False
    assert diag["is_rich_answer"] is False


def test_topic_change_with_tool_correction_is_substantive() -> None:
    text = "ممكن نغير السؤال. انا اشتغل على الجي بي اس مو على. ستيشن."
    diag = analyze_user_answer(text)
    assert diag["is_topic_change_request"] is True
    assert diag["is_substantive_answer"] is True


# ── Memory: asked questions + bank cursor ───────────────────────────────────


def test_record_agent_reply_dedupes() -> None:
    agent = _make_assistant()
    agent.record_agent_reply("شلون استخدمت البيانات لتحسين إنتاجية حقل نفطي؟")
    agent.record_agent_reply("شلون استخدمت البيانات لتحسين إنتاجية حقل نفطي؟")
    assert len(agent._memory.asked_questions) == 1


def test_pick_next_bank_anchor_skips_used() -> None:
    bank = [
        "سؤال أول عن الإنتاج",
        "سؤال ثاني عن الحفر",
        "سؤال ثالث عن الاختبارات",
    ]
    agent = _make_assistant(bank=bank)
    agent._memory.asked_question_keys.add(normalize_text(bank[0]))
    nxt = agent._pick_next_bank_anchor()
    assert nxt == bank[1]


def test_advance_after_skip_updates_topic() -> None:
    bank = ["anchor A", "anchor B", "anchor C"]
    agent = _make_assistant(bank=bank)
    agent._memory.current_topic = bank[0]
    agent._memory.last_sample = bank[0]
    agent._memory.active_question_text = bank[0]
    agent._memory.active_question_status = STATUS_AWAITING_ANSWER

    diag = analyze_user_answer("خلينا نغير سؤال")
    agent._reject_active_question(agent._memory)
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)

    assert agent._memory.active_question_status == STATUS_REJECTED
    agent._turn_plan = TurnPlan(question=bank[1], source="bank")
    agent.record_agent_reply(bank[1])
    assert agent._memory.current_topic == bank[1]
    assert agent._memory.active_question_status == STATUS_AWAITING_ANSWER


def test_three_pivots_consume_distinct_anchors() -> None:
    bank = ["Q1", "Q2", "Q3"]
    agent = _make_assistant(bank=bank)
    agent._memory.current_topic = bank[0]
    agent._memory.active_question_text = bank[0]
    agent._memory.active_question_status = STATUS_AWAITING_ANSWER

    for i, phrase in enumerate(("غير السؤال", "سؤال ثاني", "سؤال اخر")):
        diag = analyze_user_answer(phrase)
        agent._reject_active_question(agent._memory)
        agent._memory.topic_change_count += 1
        action = agent._infer_action_from_frame(diag)
        agent._update_memory_post_decision(diag, action)
        next_q = bank[min(i + 1, len(bank) - 1)]
        agent._turn_plan = TurnPlan(question=next_q, source="bank")
        agent.record_agent_reply(next_q)

    assert agent._memory.topic_change_count == 3
    assert len(agent._memory.asked_questions) >= 2


def test_role_objection_triggers_skip_action() -> None:
    agent = _make_assistant(bank=["soft skills", "technical"])
    agent._memory.current_topic = "soft skills"
    diag = analyze_user_answer("شنو دخل هذا بالمهندس")
    assert diag["meta_request"] == "role_objection"
    assert agent._infer_action_from_frame(diag) == "acknowledged_skip"


def test_candidate_role_flip_triggers_ask_interviewer() -> None:
    text = "انت جزء من هذا الاختبار انا اللي بنيتك واريد اقدمك للشركات"
    diag = analyze_user_answer(text)
    assert diag["meta_request"] == "ask_interviewer"


def test_memory_snapshot_fields() -> None:
    mem = InterviewMemory(current_topic="t1", bank_cursor=1)
    mem.record_question("test question")
    mem.session_entities.add("GPS")
    mem.rejected_entities.add("Total Station")
    snap = mem.snapshot()
    assert snap["asked_questions_count"] == 1
    assert snap["bank_cursor"] == 1
    assert "GPS" in snap["session_entities"]
    assert "Total Station" in snap["rejected_entities"]


def test_skip_turn_applies_empty_link_policy() -> None:
    glossary = build_glossary_entries(["GPS", "Total Station"])
    agent = _make_assistant_with_glossary(glossary)
    diag = analyze_user_answer("خلينا نغير سؤال")
    diag = agent._apply_entity_policy("خلينا نغير سؤال", diag)
    assert diag["link_policy"]["allowed_link_entities"] == []


def test_ask_interviewer_canned_reply_ar() -> None:
    agent = _make_assistant()
    reply = agent._canned_identity_reply("ممكن عرفيني عن نفسك")
    assert "إيفالو" in reply or "Evaalo" in reply
    assert "؟" not in reply
    assert "مشروع" not in reply


def test_ask_interviewer_frame_no_technical_question() -> None:
    agent = _make_assistant_with_glossary(build_glossary_entries(["geology"]))
    agent._memory.last_sample = "شنو المعلومات الجيولوجية اللي درستها؟"
    text = "زين ممكن تعرفيني على چنت احنا لسه ما تعرفنا عليك"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert diag["meta_request"] == "ask_interviewer"
    frame = agent._build_decision_frame(diag)
    assert frame is not None
    assert "Do NOT ask any interview" in frame or "identity ONLY" in frame
    assert agent._infer_action_from_frame(diag) == "identity_reply"
    rec = agent._pick_recommended_question(diag, agent._memory, diag["link_policy"])
    assert rec is None


def test_clarify_uses_example_not_verbatim_repeat() -> None:
    bank = ["شنو المؤشرات اللي تتابعها بشكل دوري؟", "سؤال ثاني مختلف"]
    agent = _make_assistant_with_glossary(build_glossary_entries([]))
    agent._bank_questions = bank
    agent._memory.last_sample = bank[0]
    agent._memory.current_topic = bank[0]
    text = "بلكت توضحي لي السؤال اكثر"
    diag = analyze_user_answer(text)
    assert diag["meta_request"] == "clarify_term"
    rec = agent._pick_recommended_question(
        diag, agent._memory, diag.get("link_policy") or {}
    )
    assert rec is not None
    assert rec != bank[0]
    assert "مثلاً" in rec or "مثال" in rec


def test_topic_change_with_channels_honors_content() -> None:
    glossary = build_glossary_entries(["LinkedIn", "Telegram", "Referrals"])
    agent = _make_assistant_with_glossary(glossary)
    agent._bank_questions = ["سؤال أول", "سؤال ثاني"]
    agent._memory.current_topic = "سؤال أول"
    text = "خلينا نغير السؤال. نستخدم LinkedIn و Telegram والإحالات"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert diag["is_topic_change_request"] is True
    assert diag["honor_skip_content"] is True
    assert "LinkedIn" in diag["speech_hooks"]
    assert agent._infer_action_from_frame(diag) == "honor_skip_content"
    rec = agent._pick_recommended_question(diag, agent._memory, diag["link_policy"])
    assert rec is not None
    assert "LinkedIn" in rec or "Telegram" in rec or "إحالات" in rec


def test_rich_answer_with_linkedin_gets_hook_followup() -> None:
    glossary = build_glossary_entries(["LinkedIn"])
    agent = _make_assistant_with_glossary(glossary)
    text = "نعتمد على LinkedIn أكثر شي للبحث عن مرشحين تقنيين"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert diag["is_substantive_answer"] is True
    assert "LinkedIn" in diag["speech_hooks"]
    rec = agent._pick_recommended_question(diag, agent._memory, diag["link_policy"])
    assert rec is not None
    assert "LinkedIn" in rec
    assert agent._infer_action_from_frame(diag) == "follow_up"


def test_incomplete_turn_waits_without_new_question() -> None:
    agent = _make_assistant_with_glossary(build_glossary_entries([]))
    text = "مرة من المرات طلب من عندنا وظيفة HR Manager فاحنا"
    diag = analyze_user_answer(text)
    assert diag["is_incomplete_turn"] is True
    rec = agent._pick_recommended_question(diag, agent._memory, {})
    assert rec == "أكيد، خذ راحتك وكمل فكرتك."
    assert agent._infer_action_from_frame(diag) == "wait_for_completion"


def test_ask_for_guidance_distinct_from_clarify() -> None:
    guidance = "ما مرت عليه هيچ تجربة، أنا أسأل شنو الإجراء الأنسب؟"
    diag = analyze_user_answer(
        guidance,
        active_question_text="شلون تتعامل إذا تغيّرت متطلبات المدير؟",
        active_question_status="awaiting_answer",
    )
    assert diag["is_ask_for_guidance"] is True
    assert diag["meta_request"] is None

    clarify = "ممكن توضحي شنو تقصد بمتطلبات المدير؟"
    diag2 = analyze_user_answer(
        clarify,
        active_question_text="شلون تتعامل إذا تغيّرت متطلبات المدير؟",
        active_question_status="awaiting_answer",
    )
    assert diag2["is_ask_for_guidance"] is False
    assert diag2["meta_request"] == "clarify_term"


def test_clarify_challenge_detected() -> None:
    text = "يعني ما فهمت. هذه المؤشرات ما لها علاقة بهندسة النفط"
    diag = analyze_user_answer(text)
    assert diag["meta_request"] == "clarify_challenge"


def test_petroleum_e2e_clarify_skip_incomplete() -> None:
    """Acceptance scenario: clarify → skip competency → incomplete wait."""
    from voice_interview.entity_policy import build_glossary_entries

    agent = InterviewAssistant(
        tts_router=TtsRouteContext(
            _StubTts(),
            arabic_voice_id="ar",
            english_voice_id="en",
            supports_override=False,
            cooldown_ms=0,
            initial_voice_id="ar",
            initial_language="ar",
        ),
        bank_questions=[
            "شنو أهم مشروع بترولي اشتغلت عليه — أكاديمي أو ميداني — وشنو كان دورك؟",
            "شلون تقرأ بيانات بئر أو مكمن؟",
        ],
        bank_key="petroleum_engineer",
        position="Petroleum Engineer",
        has_domain_guidance=True,
        domain_pack_key="petroleum_engineer",
        interview_paths=[
            {
                "pathKey": "petroleum_experienced",
                "steps": [
                    {
                        "stepKey": "project_example",
                        "competencyKey": "field_data_analysis",
                        "sampleQuestion": "اذكرلي مثال محدد — شنو المشكلة؟",
                    },
                ],
            }
        ],
    )
    agent._memory.last_sample = agent._bank_questions[0]
    agent._memory.current_topic = agent._bank_questions[0]
    agent._memory.current_competency_key = "field_data_analysis"

    clarify_diag = analyze_user_answer("ما فهمت، وضحي أكثر شنو تقصدين بالمؤشرات")
    clarify_rec = agent._pick_recommended_question(
        clarify_diag, agent._memory, clarify_diag.get("link_policy") or {}
    )
    assert clarify_rec
    assert "Time to Fill" not in clarify_rec
    assert "Offer Acceptance" not in clarify_rec

    skip_diag = analyze_user_answer("غير السؤال")
    skip_rec = agent._pick_recommended_question(
        skip_diag, agent._memory, skip_diag.get("link_policy") or {}
    )
    assert skip_rec
    assert agent._turn_recommended_source == "competency_jump"
    assert "مشروع" not in skip_rec or "محاكاة" in skip_rec or "مفاهيم" in skip_rec

    incomplete_diag = analyze_user_answer("بس دقيقة خليني اوضح النقطة")
    incomplete_rec = agent._pick_recommended_question(
        incomplete_diag, agent._memory, incomplete_diag.get("link_policy") or {}
    )
    assert incomplete_rec == "أكيد، خذ راحتك وكمل فكرتك."

    guard = agent._apply_guard_to_agent_text(
        "مثلاً Time to Fill أو Offer Acceptance — أي واحد تتابعه؟"
    )
    assert "Time to Fill" not in guard


def _make_assistant_with_glossary(glossary):
    from voice_interview.entity_policy import RoleGlossaryEntry

    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=["Q1", "Q2"],
        bank_key="test",
        position="Survey Engineer",
        role_glossary=glossary,
        domain_pack_key="hr_recruiter",
    )
