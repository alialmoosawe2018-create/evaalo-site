"""Tests for entity linking policy (Phase A)."""

from __future__ import annotations

import pytest

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.entity_policy import (
    RoleGlossaryEntry,
    build_glossary_entries,
    compute_link_policy,
    detect_tool_correction,
    extract_candidate_entities,
    extract_speech_hooks,
    pick_hook_followup,
    simplify_clarify_for_pack,
    simplify_clarify_question,
)
from voice_interview.heuristics import analyze_user_answer, normalize_text
from voice_interview.entity_policy import build_role_glossary, collapse_to_single_question


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _survey_glossary() -> list[RoleGlossaryEntry]:
    return build_glossary_entries(
        [
            "GPS",
            "GNSS",
            "Total Station",
            "RTK",
            "control points",
            "leveling",
        ]
    )


def _make_assistant(
    bank: list[str] | None = None,
    glossary: list[RoleGlossaryEntry] | None = None,
    competencies: list[dict] | None = None,
) -> InterviewAssistant:
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
        bank_questions=bank
        or [
            "اذكرلي أهم مشروع مسح اشتغلت عليه، وشنو كان دورك بيه؟",
            "شنو نوع أعمال المسح اللي عندك خبرة بيها أكثر شي؟",
        ],
        bank_key="survey",
        position="Survey Engineer",
        has_domain_guidance=True,
        role_glossary=glossary or _survey_glossary(),
        blueprint_competencies=competencies
        or [
            {
                "title": "accuracy and coordinate control",
                "followUps": [
                    "شلون كنت تتأكد من دقة الإحداثيات قبل تعتمدها بالتسليم؟"
                ],
            }
        ],
    )


def test_greeting_only_empty_allowed_entities() -> None:
    glossary = _survey_glossary()
    diag = analyze_user_answer("أهلاً، أنا جاهز")
    policy = compute_link_policy(
        entities_in_message=extract_candidate_entities("أهلاً، أنا جاهز", glossary),
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=diag["is_greeting_or_ready"],
        is_substantive=diag["is_substantive_answer"],
    )
    assert policy["allowed_link_entities"] == []
    assert policy["candidate_entities_in_last_message"] == []


def test_gps_not_total_station_correction() -> None:
    glossary = _survey_glossary()
    text = "ممكن نغير السؤال. انا اشتغل على الجي بي اس مو على ستيشن."
    norm = normalize_text(text)
    correction = detect_tool_correction(norm, text, glossary)
    assert correction is not None
    assert correction.corrected_fact == "GPS"
    assert correction.incorrect_assumption == "Total Station"

    entities = extract_candidate_entities(text, glossary)
    policy = compute_link_policy(
        entities_in_message=entities,
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=False,
        is_substantive=True,
        correction=correction,
    )
    assert "GPS" in policy["allowed_link_entities"]
    assert "Total Station" not in policy["allowed_link_entities"]
    assert "Total Station" in policy["rejected_entities"]


def test_blueprint_term_not_in_allowed_without_candidate_mention() -> None:
    glossary = _survey_glossary()
    # Candidate says nothing about Total Station
    text = "اشتغلت بمشروع مسح كبير في البصرة"
    entities = extract_candidate_entities(text, glossary)
    assert "Total Station" not in entities
    policy = compute_link_policy(
        entities_in_message=entities,
        glossary=glossary,
        rejected_entities=set(),
        is_greeting_or_ready=False,
        is_substantive=True,
    )
    assert "Total Station" in policy["forbidden_attribution_entities"]


def test_recommended_question_on_greeting_is_anchor() -> None:
    agent = _make_assistant()
    diag = analyze_user_answer("أنا جاهز")
    diag = agent._apply_entity_policy("أنا جاهز", diag)
    rec = agent._pick_recommended_question(
        diag, agent._memory, diag["link_policy"]
    )
    assert rec is not None
    assert "مشروع مسح" in rec or "مسح" in rec


def test_apply_entity_policy_tracks_session_entities() -> None:
    agent = _make_assistant()
    text = "اشتغلت على GPS RTK بمشروع مسح"
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert "GPS" in agent._memory.session_entities
    assert diag["link_policy"]["allowed_link_entities"]


def test_build_role_glossary_from_metadata() -> None:
    class _Bank:
        category = "engineering_civil_mep"
        industry_family = "engineering"

    meta = {
        "domain_guidance": "terminology: GPS, GNSS, Total Station, leveling",
        "blueprint": '{"anchorQuestions":["GPS survey project"],"competencies":[{"title":"field survey"}]}',
    }
    glossary = build_role_glossary(meta, _Bank(), {"anchorQuestions": ["GPS survey"], "competencies": []})
    labels = {e.canonical for e in glossary}
    assert "GPS" in labels
    assert "Total Station" in labels


def test_build_role_glossary_from_role_glossary_json() -> None:
    class _Bank:
        category = "general"
        industry_family = "general"

    meta = {
        "role_glossary": '["ESP", "GOR", "Water Cut"]',
        "profile_terminology": "GPS, GNSS",
    }
    glossary = build_role_glossary(meta, _Bank(), None)
    labels = {e.canonical for e in glossary}
    assert "ESP" in labels
    assert "GPS" in labels
    assert "Water Cut" in labels


def test_build_role_glossary_from_blueprint_terminology() -> None:
    class _Bank:
        category = "general"
        industry_family = "general"

    blueprint = {
        "terminology": ["RTK", "Total Station"],
        "anchorQuestions": [],
        "competencies": [],
    }
    glossary = build_role_glossary({}, _Bank(), blueprint)
    labels = {e.canonical for e in glossary}
    assert "RTK" in labels
    assert "Total Station" in labels


def test_collapse_compound_recruiter_anchor() -> None:
    bad = (
        "شنو هي وظيفة صعبة كان عليك توظيفها؟ شلون أخذت متطلبات الدور من المدير، "
        "وكيف بنيت خطة البحث، وما الذي سويته لما ما حصلت على مرشحين مناسبين بالبداية؟"
    )
    single = collapse_to_single_question(bad)
    assert single.count("؟") == 1
    assert "شلون أخذت" not in single


def test_collapse_splits_on_comma_ways() -> None:
    text = "شنو المؤشرات اللي تتابعها؟ واذكرلي قرار اتخذته بناءً على أحدها؟"
    single = collapse_to_single_question(text)
    assert single == "شنو المؤشرات اللي تتابعها؟"


def test_hr_recruiter_pack_anchors_are_single() -> None:
    anchors = [
        "اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
        "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
        "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
    ]
    for a in anchors:
        assert collapse_to_single_question(a).count("؟") == 1
        assert "شنو هي وظيفة صعبة" not in a


def test_decision_frame_includes_turn_state() -> None:
    agent = _make_assistant()
    diag = analyze_user_answer("أنا جاهز")
    diag = agent._apply_entity_policy("أنا جاهز", diag)
    frame = agent._build_decision_frame(diag)
    assert frame is not None
    assert "TURN STATE:" in frame
    assert '"allowed_link_entities":[]' in frame.replace(" ", "")
    assert "SINGLE-QUESTION RULE" in frame


def test_extract_speech_hooks_linkedin_telegram_referrals() -> None:
    text = "نستخدم LinkedIn و Telegram والإحالات بشكل يومي"
    hooks = extract_speech_hooks(text)
    assert "LinkedIn" in hooks
    assert "Telegram" in hooks
    assert "Referrals" in hooks


def test_pick_hook_followup_linkedin() -> None:
    q = pick_hook_followup("LinkedIn")
    assert "LinkedIn" in q
    assert q.endswith("؟")


def test_simplify_clarify_metrics_question_hr() -> None:
    simplified = simplify_clarify_question("شنو المؤشرات اللي تتابعها بشكل دوري؟")
    assert "مثلاً" in simplified
    assert "Time to Fill" in simplified
    assert simplified != "شنو المؤشرات اللي تتابعها بشكل دوري؟"


def test_simplify_clarify_metrics_question_petroleum() -> None:
    simplified, source = simplify_clarify_for_pack(
        "شنو المؤشرات اللي تبدي بيها قبل القرار؟",
        domain_pack_key="petroleum_engineer",
    )
    assert source == "petroleum_engineer"
    assert "Time to Fill" not in simplified
    assert "Offer Acceptance" not in simplified
    assert "معدل الإنتاج" in simplified or "الضغط" in simplified


def test_decision_frame_offers_optional_echo_on_rich_answer() -> None:
    # Selective active listening: on a rich answer with a candidate-said entity,
    # the frame OFFERS a reflection ("MAY … only if it connects naturally"),
    # never forces one.
    agent = _make_assistant()
    text = (
        "اشتغلت على GPS بمشروع مسح كبير بالبصرة، وكنت مسؤول عن دقة الإحداثيات "
        "لمدة ثلاث سنوات، وسلّمنا المشروع بنجاح بدون أخطاء تُذكر"
    )
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    assert diag.get("is_rich_answer")
    assert diag["link_policy"]["allowed_link_entities"]
    frame = agent._build_decision_frame(diag)
    assert "MAY open" in frame
    assert "connects naturally" in frame
    assert "GPS" in frame


def test_decision_frame_no_echo_on_greeting() -> None:
    # No candidate content yet → no reflection offered, no attributed entity.
    agent = _make_assistant()
    diag = analyze_user_answer("أنا جاهز")
    diag = agent._apply_entity_policy("أنا جاهز", diag)
    frame = agent._build_decision_frame(diag)
    assert "MAY open" not in frame


def test_competency_engine_prioritizes_critical_then_the_rest() -> None:
    comps = [
        {"competencyKey": "c1", "priority": "critical", "followUpRules": ["شنو خبرتك بـ c1؟"]},
        {"competencyKey": "c2", "priority": "critical", "followUpRules": ["احچيلي عن c2؟"]},
        {"competencyKey": "c3", "priority": "medium", "followUpRules": ["س٣؟"]},
    ]
    agent = _make_assistant(competencies=comps)
    mem = agent._memory

    assert agent._pick_next_competency_question(mem) is not None
    assert agent._turn_plan.competency_key == "c1"

    mem.asked_competency_keys.add("c1")
    assert agent._pick_next_competency_question(mem) is not None
    assert agent._turn_plan.competency_key == "c2"

    # Criticals done → the engine keeps going through the lower priorities, so
    # every competency ends up with evidence in the transcript.
    mem.asked_competency_keys.add("c2")
    assert agent._pick_next_competency_question(mem) is not None
    assert agent._turn_plan.competency_key == "c3"

    mem.asked_competency_keys.add("c3")
    assert agent._pick_next_competency_question(mem) is None


def test_competency_engine_noop_without_competency_key() -> None:
    # Legacy/test blueprints have nothing to score against → bank behaviour.
    agent = _make_assistant(competencies=[{"title": "field survey", "followUps": ["س؟"]}])
    assert agent._pick_next_competency_question(agent._memory) is None


def test_competency_engine_marks_covered_at_send_time() -> None:
    # Asked-once semantics: the engine advances to the next competency even if
    # the previous one's answer stayed "open" (no loop).
    comps = [
        {"competencyKey": "c1", "priority": "critical", "followUpRules": ["شنو خبرتك بـ c1؟"]},
        {"competencyKey": "c2", "priority": "critical", "followUpRules": ["احچيلي عن c2؟"]},
    ]
    agent = _make_assistant(competencies=comps)
    mem = agent._memory

    q1 = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q1)  # marks c1 covered at send time
    assert "c1" in mem.asked_competency_keys

    q2 = agent._pick_next_competency_question(mem)
    assert agent._turn_plan.competency_key == "c2"
    assert q2 != q1


# ── تسرّب المجال في التوضيح — من جلسة الإنتاج 38d54d72 (2026-09-06) ──────────
#
# طلب **محاسب** توضيحاً فجاءه: «مثلاً تنسيق موعد أو متابعة مرشّح أو ترتيب مستند»
# — أمثلة موارد بشرية. السبب أن `hr_recruiter` كان الاحتياطي المُثبَّت لكل دور بلا
# حزمة، فكل مهنة خارج الحزمتين تُوضَّح لها بلغة التوظيف. توضيحٌ من مهنة أخرى أسوأ
# من لا توضيح: يوحي للمرشح بأن الوكيل لا يعرف الدور الذي يُقابله عليه.

_HR_ONLY_PHRASES = (
    "تنسيق موعد",
    "متابعة مرشّح",
    "ترتيب مستند",
    "Time to Fill",
    "Offer Acceptance",
    "LinkedIn",
    "استقطاب",
)
_PETROLEUM_ONLY_PHRASES = ("النفطي", "معدل الإنتاج", "المحاكاة", "GOR", "بيانات إنتاج")

# الفروع السبعة التي يصنّفها `_classify_clarify_branch`، بسؤال يقود إلى كل واحد.
_BRANCH_PROBES = (
    "شنو المؤشرات اللي تتابعها؟",
    "هل المشروع أكاديمي لو ميداني؟",
    "شنو قنوات الاستقطاب؟",
    "اذكرلي موقف حساس صار وياك؟",
    "شنو التحدي اللي واجهك؟",
    "شلون تاخذ متطلبات المهمة؟",
    "احچيلي عن موقف اكتشفت فيه خطأ مالي؟",
)


@pytest.mark.parametrize("role", ["general_accountant", "nurse", "driver", ""])
@pytest.mark.parametrize("probe", _BRANCH_PROBES)
def test_clarify_never_leaks_another_profession(role: str, probe: str) -> None:
    """دورٌ بلا حزمة يُوضَّح له بلغة محايدة، لا بأمثلة مهنة أخرى."""
    text, source = simplify_clarify_for_pack(probe, domain_pack_key=role)
    assert source == "generic", f"{role!r} لم يقع على الحزمة المحايدة: {source}"
    for phrase in _HR_ONLY_PHRASES + _PETROLEUM_ONLY_PHRASES:
        assert phrase not in text, f"تسرّب «{phrase}» إلى دور {role!r}: {text}"


@pytest.mark.parametrize("probe", _BRANCH_PROBES)
def test_generic_clarify_still_offers_a_concrete_example(probe: str) -> None:
    """المحايد لا يعني المجرّد — يبقى فيه مثال قبل علامة الاستفهام الوحيدة."""
    text, _ = simplify_clarify_for_pack(probe, domain_pack_key="general_accountant")
    kept = collapse_to_single_question(text)
    assert any(w in kept for w in ("مثلاً", "مثال")), f"بلا مثال بعد الاقتطاع: {kept}"


@pytest.mark.parametrize(
    "role,expected",
    [("hr_recruiter", "hr_recruiter"), ("petroleum_engineer", "petroleum_engineer")],
)
def test_existing_packs_keep_their_own_wording(role: str, expected: str) -> None:
    """الحزمتان الأصليتان لم تتأثّرا بالاحتياطي الجديد."""
    text, source = simplify_clarify_for_pack("شنو المؤشرات اللي تتابعها؟", domain_pack_key=role)
    assert source == expected
    marker = "Time to Fill" if role == "hr_recruiter" else "النفطي"
    assert marker in text, f"{role} فقد نصّه الخاص: {text}"
