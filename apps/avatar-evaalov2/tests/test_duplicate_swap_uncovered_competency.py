"""A duplicate is replaced by the next UNCOVERED blueprint competency, not a generic bridge.

The case is a real interview, replayed through the real agent: 2026-09-23 18:58,
HR Assistant, Arabic, session ``video-interview-6aae4fd088e7a6d01639e33b-1790189899923``.
It scored 27/Reject with five of its ten competencies never asked, because four
questions in a row were the role-neutral bridge («اذكرلي موقف كان صعب عليك…»):
the agent log says ``duplicate ask with no fresh anchor; bridging`` on turns 6, 7,
9 and 11, and the turn log shows the picker had planned confidentiality,
interview coordination and HRIS on the first three.

What the replay uses, all of it from production:
  * the blueprint snapshot stored on the session (3 anchors, 10 competencies);
  * the candidate's words, split into turns exactly as the agent log shows them
    (turns 3 and 5 got no reply; turn 8 ended on «لان.» and the agent waited);
  * the model's wording for the turns the guard let through (1, 2, 4);
  * the greeting record as production stored it — the never-spoken payroll
    reframe (a separate, known telemetry bug, reproduced here on purpose because
    it IS in the agent's memory).

What it cannot use: the model's rejected wording on the four duplicate turns —
it was thrown away before anything recorded it. It does not matter. The guard's
choice of replacement reads the rejected text only through the duplicate
verdict, and production logged that verdict for exactly those four turns. The
replay feeds the previous question verbatim there, which gets the same verdict.

The replay also stops short of the reframe model (no LLM in tests), so it shows
the question the guard HANDS to the reframe, not the reframe's final wording.
"""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse

from voice_interview.active_question import MODE_ASK, TurnPlan
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.entity_policy import DIFFICULTY_FOLLOWUP_POOL
from voice_interview.heuristics import is_semantic_duplicate_question
from voice_interview.subject_coverage import subject_already_asked
from voice_interview.turn_log import TurnLogSink

# ── Session J, from the stored blueprint snapshot ────────────────────────────

SESSION_J_ANCHORS = [
    "شنو خبرتك بتنسيق المقابلات على ATS مثل Greenhouse أو Workable من ناحية تنظيم المواعيد؟",
    "شنو خبرتك بملء سجلات الموظفين باستخدام HRIS أو Excel، مثل تفاصيل التوظيف والدوام؟",
    "شنو خبرتك بحفظ مستندات الموظفين الحساسة مثل العقود وتقارير الأداء إلكترونياً أو ورقياً؟",
]

_J_COMPETENCIES = [
    (
        "data_entry_accuracy",
        "الدقة بإدخال البيانات",
        "critical",
        "اطلب مثال محدد يوضّح موقف أدخلت به بيانات موظف (مثل راتب أو تاريخ بداية)، واشرح "
        "الإجراء اللي سويته للتحقق والنتيجة على وجود أوقل أخطاء أو استدعاءات للتصحيح.",
    ),
    (
        "confidentiality_and_discretion",
        "السرية وحفظ المعلومات",
        "critical",
        "اطلب مثال عن موقف استلمت بيه مستند سري (عقد، تقرير تقييم) وشنو الإجراءات اللي "
        "سويتها لحمايته والنتيجة لو حصلت أي محاولة وصول غير مصرح.",
    ),
    (
        "interview_coordination",
        "تنسيق المقابلات",
        "high",
        "اطلب مثال يشرح تنظيم مقابلة من التنسيق الأولي للمدير والمرشح لحد تأكيد النتائج، "
        "وبين دورك بالتحديد والنتيجة على سير المقابلة.",
    ),
    (
        "hris_and_excel",
        "استخدام HRIS وExcel",
        "high",
        "اطلب مثال على تقرير أو مهمة عملتها بExcel أو HRIS، وضح البيانات اللي استخدمتها، "
        "الأدوات أو الصيغ، والنتيجة العملية للتقرير.",
    ),
    (
        "policy_and_compliance",
        "الالتزام بالإجراءات والسياسات",
        "high",
        "اطلب مثال عن تطبيقك لإجراء HR (مثل إجازة، إنهاء عقد) وفسّر الخطوات اللي اتبعتها "
        "وكيف ضمنت الالتزام بسياسة الشركة والنتيجة.",
    ),
    (
        "candidate_communication",
        "التواصل مع المرشحين",
        "high",
        "اطلب مثال تواصلت بيه مع مرشح بموضوع حساس (تأخير، رفض عرض) ووضح الرسالة اللي "
        "بعثتها وردة فعل المرشح والنتيجة للسمعة أو للتوظيف.",
    ),
    (
        "time_and_prioritization",
        "إدارة الوقت والأولويات",
        "medium",
        "اطلب مثال عن يوم كان عندك مهام متضاربة، شلون رتبتها أو فوّضت منها، وشنو كانت "
        "النتيجة على الالتزام بالمواعيد؟",
    ),
    (
        "payroll_support",
        "دعم الرواتب والمستحقات",
        "medium",
        "اطلب مثال عن مرة دعمت فريق الرواتب بتعديل بند أو إدخال بيانات وروح تفصيل كيف "
        "عرفت الرقم وكيف تم التحقق والنتيجة بالشهر المالي.",
    ),
    (
        "document_management",
        "إدارة الملفات والسجلات",
        "medium",
        "اطلب مثال عن تنظيم أرشيف عقود أو ملفات موظفين، ووضح نظام التسمية، صلاحيات "
        "الوصول، وكيف تعمل نسخ احتياطية أو استرجاع عند الحاجة.",
    ),
    (
        "reconciliation_and_reporting_support",
        "مساعدة بالمطابقات والتقارير",
        "medium",
        "اطلب مثال عن عملية مطابقة بين سجلات HR وسجلات مالية أو حضور، اذكر الأعمدة "
        "المستخدمة، الخطوات اللي سويتها للعثور على فروقات، والنتيجة بعد التسوية.",
    ),
]


def session_j_competencies() -> list[dict]:
    return [
        {
            "competencyKey": key,
            "title": title,
            "priority": priority,
            "questionObjective": objective,
            "expectedEvidence": ["مثال محدد"],
            "followUpRules": ["شنو صار بعدها؟"],
        }
        for key, title, priority, objective in _J_COMPETENCIES
    ]


#: The canned greeting as the worker marked it verbatim, and what the audio played —
#: with a SYNTHETIC name in place of the candidate's. The double space the agent
#: log printed inside the name is kept.
_J_GREETING = "حياك الله ألف باء  جيم دال، نبدأ من خبرتك العملية."

#: What production recorded for the greeting (turn 0): a reframe that was never
#: spoken. Kept because it is in the agent's memory for the rest of the session.
_J_GREETING_RECORD = (
    "شنو خبرتك بموضوع الـ payroll، يعني دفع الرواتب، إذا مرّ عليك أو لا؟"
)

# The model's wording on the turns the guard passed — from the stored transcript.
_J_SPOKEN_ATS = (
    "أريد أفهم شلون تنسق المقابلات باستخدام نظام تتبّع المتقدّمين (ATS) مثل Greenhouse أو "
    "Workable.  أقصد مثلاً، إذا كان عندك موعد مقابلة مع مرشح، شنو الخطوات اللي اتبعتها "
    "لتنظيم الموعد والتأكد من كل شيء جاهز؟"
)
_J_SPOKEN_HRIS = (
    "يهمّني أعرف شلون تسجل بيانات الموظفين باستخدام HRIS أو Excel.  أقصد، مثلاً، إذا كان "
    "عندك تفاصيل توظيف أو دوام لازم تدخلها، شنو الخطوات اللي اتبعتها لضمان دقة المعلومات؟"
)
_J_SPOKEN_DOCS = (
    "خلّينا نحچي عن حفظ مستندات الموظفين الحساسة.  أقصد مثل العقود وتقارير الأداء، شلون "
    "تحافظ على هذه المستندات سواء كانت إلكترونية أو ورقية؟"
)

_DUP = "duplicate"  # production logged a duplicate verdict on this turn
_NONE = "none"  # production recorded no agent reply on this turn
_CLARIFY = "clarify"  # the clarification the picker planned

#: (turn, candidate's words, what the model said) — turns as the agent log split them.
#: The words are SYNTHETIC: no candidate speech is stored. Each line gives the real
#: picker exactly what the production line gave it — the same diagnostics (ready /
#: shallow / rich answer / clarify request / topic change / trailing «لان.»), the
#: same entities, recommended question, plan, spoken text, turn-log record and
#: end-of-session memory — checked by replaying both through the agent, in the
#: fixed and the pre-P4 build, and diffing every decision frame.
SESSION_J_SCRIPT: list[tuple[int, str, str]] = [
    (1, "هلا. انا جاهز.", _J_SPOKEN_ATS),
    (2, "حول الموضوع.", _J_SPOKEN_HRIS),
    (3, "يعني. واضح عندنا بالشغل.", _NONE),
    (
        4,
        "لما يباشر موظف جديد نسجل بياناته بنظام الشركة ونكتب معلوماته الشخصية ووسائل التواصل "
        "وتفاصيل العقد والدوام والمخصصات. ونراجع كل حقل مرة ثانية حتى تكون البيانات صحيحة "
        "ونرجع لها عند اي حالة طارئة.",
        _J_SPOKEN_DOCS,
    ),
    (5, "نحفظها ورقياً بالمكتب او الكترونياً على الجهاز.", _NONE),
    (6, "بملف على الحاسبة. باسم الرقم الوظيفي حتى نلكاها بسرعة وقت ما نحتاجها.", _DUP),
    (7, "طيب.", _DUP),
    (8, "شنو تقصدين بالموقف بالضبط يعني اي نوع من المواقف؟ لان.", _NONE),
    (9, "يعتمد على الحالة.", _DUP),
    (
        10,
        "يعتمد على الحالة يعني ممكن توضحي لي شنو نوع المشاكل المقصودة هنا.",
        _CLARIFY,
    ),
    (11, "ممكن نغير السؤال.", _DUP),
]

#: Covered before turn 6 — by the anchors the candidate had already heard — or,
#: for confidentiality, rejected as a duplicate on turn 6 itself.
_J_COVERED_BY_ANCHORS = {
    "data_entry_accuracy",
    "interview_coordination",
    "hris_and_excel",
}


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _router() -> TtsRouteContext:
    return TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )


def session_j_agent() -> InterviewAssistant:
    return InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="HR Assistant",
        bank_questions=list(SESSION_J_ANCHORS),
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=session_j_competencies(),
        career_level="mid",
    )


async def replay_session_j(agent: InterviewAssistant) -> list[dict]:
    """Drive the real agent through session J, one production turn at a time.

    Each spoken turn runs the guard TWICE, in production's order: tts_node first,
    on the model's text; then transcription_node, on the text the TTS actually
    spoke (the transcript is TTS-aligned), and only then the record. The agent
    log shows this order: one «[reply-guard]» line per bridged turn, not two, and
    each ``[turn-log]`` line lands just after TTS synthesis ends.
    """
    agent._turn_log_sink = TurnLogSink(object())
    agent.mark_verbatim(_J_GREETING)
    agent.record_agent_reply(_J_GREETING_RECORD)
    rows: list[dict] = []
    try:
        for turn, said, reply in SESSION_J_SCRIPT:
            silent = False
            try:
                await agent.on_user_turn_completed(
                    ChatContext.empty(), ChatMessage(role="user", content=[said])
                )
            except StopResponse:
                silent = True
            plan = agent._turn_plan
            row = {
                "turn": turn,
                "said": said,
                "planned_competency": (plan.competency_key or "") if plan else "",
                "planned_source": plan.source if plan else "",
                "spoken": "",
                "competency": "",
                "second_pass": "",
            }
            if silent or reply == _NONE:
                rows.append(row)
                continue
            if reply == _DUP:
                model_text = agent._memory.asked_questions[-1]
            elif reply == _CLARIFY:
                model_text = plan.question or ""
            else:
                model_text = reply
            spoken = await agent.reframe_bare_question(
                agent._apply_guard_to_agent_text(model_text)
            )
            transcript = await agent.reframe_bare_question(
                agent._apply_guard_to_agent_text(spoken)
            )
            agent.record_agent_reply(transcript)
            row["second_pass"] = transcript
            row["spoken"] = spoken
            row["competency"] = (
                (agent._turn_plan.competency_key or "") if agent._turn_plan else ""
            )
            row["record"] = agent._turn_log_sink.records[-1]
            rows.append(row)
    finally:
        agent._cancel_wait_timeout()
    return rows


def _replay(
    monkeypatch: pytest.MonkeyPatch | None = None, *, old_behaviour: bool = False
):
    agent = session_j_agent()
    if old_behaviour:
        assert monkeypatch is not None
        # Exactly the control flow before this change: anchor → wrap-up → bridge.
        monkeypatch.setattr(
            agent,
            "_swap_duplicate_for_uncovered_competency",
            lambda turn, recent, reason="duplicate": None,
        )
    rows = asyncio.run(replay_session_j(agent))
    return agent, {row["turn"]: row for row in rows}


def _is_bridge(text: str) -> bool:
    return text in DIFFICULTY_FOLLOWUP_POOL


# ── 0. The replay reproduces production before the fix ───────────────────────


def test_replay_reproduces_the_four_production_bridges_without_the_fix(monkeypatch):
    """The harness is only evidence if the OLD code gives production's result."""
    _, rows = _replay(monkeypatch, old_behaviour=True)

    # Production's turn log: what the picker planned on each spoken turn.
    assert rows[1]["planned_source"] == "track_anchor"
    assert rows[2]["planned_source"] == "track_anchor"
    assert rows[4]["planned_source"] == "track_anchor"
    assert rows[6]["planned_competency"] == "confidentiality_and_discretion"
    assert rows[7]["planned_competency"] == "interview_coordination"
    assert rows[9]["planned_competency"] == "hris_and_excel"
    assert rows[10]["planned_source"] == "clarify_pack"
    assert rows[11]["planned_source"] == "bank"
    assert rows[8]["spoken"] == ""  # «…لان.» → the agent waited, as in production

    # …and production's outcome: all four duplicates became generic bridges.
    for turn in (6, 7, 9, 11):
        assert _is_bridge(rows[turn]["spoken"]), (turn, rows[turn]["spoken"])
    for turn in (1, 2, 4):
        assert not _is_bridge(rows[turn]["spoken"])


def test_replay_ends_with_production_competency_count_without_the_fix(monkeypatch):
    """Production's END record: ``questions=9 competencies=3/10``."""
    agent, _ = _replay(monkeypatch, old_behaviour=True)
    assert agent._memory.asked_competency_keys == {
        "confidentiality_and_discretion",
        "interview_coordination",
        "hris_and_excel",
    }


# ── 1. The same session now moves to uncovered competencies ──────────────────


def test_session_j_duplicates_move_to_the_uncovered_competencies_in_priority_order():
    _, rows = _replay()

    for turn in (6, 7, 9, 11):
        assert not _is_bridge(rows[turn]["spoken"]), (turn, rows[turn]["spoken"])
        assert "موقف صعب" not in rows[turn]["spoken"]
    assert [rows[t]["competency"] for t in (6, 7, 9, 11)] == [
        "policy_and_compliance",
        "candidate_communication",
        "time_and_prioritization",
        "payroll_support",
    ]
    # The picker's plan on those turns is unchanged — only the replacement is.
    assert rows[6]["planned_competency"] == "confidentiality_and_discretion"
    assert rows[7]["planned_competency"] == "interview_coordination"
    assert rows[9]["planned_competency"] == "hris_and_excel"
    # Each swapped question names its competency's subject.
    assert "الالتزام بالإجراءات والسياسات" in rows[6]["spoken"]
    assert "التواصل مع المرشحين" in rows[7]["spoken"]
    assert "مهام متضاربة" in rows[9]["spoken"]
    assert "دعم الرواتب والمستحقات" in rows[11]["spoken"]


# ── 2. Never a covered competency just to dodge the duplicate ────────────────


def test_no_covered_competency_is_swapped_in_to_avoid_the_duplicate():
    _, rows = _replay()
    swapped = {rows[t]["competency"] for t in (6, 7, 9, 11)}
    assert not swapped & _J_COVERED_BY_ANCHORS
    assert "confidentiality_and_discretion" not in swapped  # the one just rejected


def _deliver(agent: InterviewAssistant, anchor: str, spoken: str) -> None:
    """Put an anchor in front of the candidate through the real record path."""
    agent._turn_plan = TurnPlan(
        question=anchor, source="track_anchor", response_mode=MODE_ASK
    )
    agent.record_agent_reply(spoken)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)


def test_a_competency_whose_subject_was_already_heard_is_skipped():
    """interview_coordination is FIRST in line and still must not be chosen.

    Its own question («…يبيّن تنسيق المقابلات…») is not a duplicate of the ATS
    anchor by any word-overlap test — only its subject is. The delivered anchor
    «شنو خبرتك بتنسيق المقابلات على ATS…» is what carries that subject; the
    model's rewording («شلون تنسق المقابلات…») kept only one of its words.
    """
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="HR Assistant",
        bank_questions=[],
        blueprint_competencies=[
            c
            for c in session_j_competencies()
            if c["competencyKey"] in ("interview_coordination", "policy_and_compliance")
        ],
    )
    _deliver(agent, SESSION_J_ANCHORS[0], _J_SPOKEN_ATS)
    template = agent._competency_question_text(agent._blueprint_competencies[0])
    assert not is_semantic_duplicate_question(template, [_J_SPOKEN_ATS])  # the trap

    out = agent._guard_repetition_and_language(_J_SPOKEN_ATS)
    assert agent._turn_plan.competency_key == "policy_and_compliance"
    assert "تنسيق" not in out


# ── 3. The generic bridge is still the fallback ──────────────────────────────


def _dup_agent(competencies: list[dict] | None) -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="HR Assistant",
        bank_questions=[],
        blueprint_competencies=competencies,
    )
    _deliver(agent, SESSION_J_ANCHORS[0], _J_SPOKEN_ATS)
    return agent


def test_bridge_when_there_is_no_blueprint():
    agent = _dup_agent(None)
    assert _is_bridge(agent._guard_repetition_and_language(_J_SPOKEN_ATS))


def test_bridge_when_every_competency_is_already_asked():
    agent = _dup_agent(session_j_competencies())
    agent._memory.asked_competency_keys.update(k for k, *_ in _J_COMPETENCIES)
    assert _is_bridge(agent._guard_repetition_and_language(_J_SPOKEN_ATS))


def test_bridge_when_the_only_competency_left_was_already_heard():
    """A covered competency is not "suitable" — the bridge beats a repeat."""
    agent = _dup_agent(
        [
            c
            for c in session_j_competencies()
            if c["competencyKey"] == "interview_coordination"
        ]
    )
    out = agent._guard_repetition_and_language(_J_SPOKEN_ATS)
    assert _is_bridge(out)
    assert agent._turn_plan.competency_key in (None, "")


def test_uncovered_competency_comes_before_the_wrap_up():
    """ "No fresh question left" was false while a competency was still unasked."""
    agent = _dup_agent(session_j_competencies())
    agent._memory.asked_questions.extend(f"سؤال سابق رقم {i}؟" for i in range(10))
    agent._memory.asked_questions.append(_J_SPOKEN_ATS)
    out = agent._guard_repetition_and_language(_J_SPOKEN_ATS)
    assert agent._memory.wrap_up_offered is False
    # Only the ATS question was heard here, so the first critical competency is free.
    assert agent._turn_plan.competency_key == "data_entry_accuracy"
    assert "الدقة بإدخال البيانات" in out


def test_wrap_up_still_offered_once_nothing_is_left():
    agent = _dup_agent(session_j_competencies())
    agent._memory.asked_competency_keys.update(k for k, *_ in _J_COMPETENCIES)
    agent._memory.asked_questions.extend(f"سؤال سابق رقم {i}؟" for i in range(10))
    agent._memory.asked_questions.append(_J_SPOKEN_ATS)
    out = agent._guard_repetition_and_language(_J_SPOKEN_ATS)
    assert agent._memory.wrap_up_offered is True
    assert "نختم" in out


def test_hybrid_token_alone_does_not_trigger_the_competency_swap():
    """Scope: the rule is for duplicates. A garbled token keeps its old path."""
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="HR Assistant",
        bank_questions=[],
        blueprint_competencies=session_j_competencies(),
    )
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent._guard_repetition_and_language("شنو الشي اللي motivatesك بهذا الدور؟")
    assert agent._turn_plan.competency_key in (None, "")


# ── Both guard passes agree, and bookkeeping is exact ────────────────────────


def test_chat_and_audio_agree_on_every_spoken_turn():
    _, rows = _replay()
    for turn, row in rows.items():
        assert row["second_pass"] == row["spoken"], turn


def test_a_late_guard_pass_after_the_record_keeps_the_same_swap():
    """The reverse order — record first, second pass after — must not pick again.

    Production runs tts_node first, so this order is not what it does today; the
    memo exists so that a change in node timing cannot make the late pass swap
    AGAIN from state its own record changed, installing a second competency the
    candidate never hears.
    """
    agent = _dup_agent(session_j_competencies())
    _deliver(agent, SESSION_J_ANCHORS[1], _J_SPOKEN_HRIS)
    agent._turn_plan = TurnPlan(
        question="احچيلي عن موقف حقيقي يبيّن تنسيق المقابلات، شنو سويت؟",
        competency_key="interview_coordination",
        source="competency_engine",
        response_mode=MODE_ASK,
    )
    first = agent._guard_repetition_and_language(_J_SPOKEN_ATS)
    agent.record_agent_reply(first)
    late = agent._guard_repetition_and_language(_J_SPOKEN_ATS)

    assert late == first
    assert agent._memory.current_competency_key == "confidentiality_and_discretion"
    assert agent._turn_plan.competency_key == "confidentiality_and_discretion"
    assert agent._memory.asked_competency_keys == {
        "interview_coordination",
        "confidentiality_and_discretion",
    }


def test_swap_marks_the_rejected_and_the_new_competency_and_nothing_else():
    agent, _ = _replay()
    asked = agent._memory.asked_competency_keys
    assert asked == {
        "confidentiality_and_discretion",
        "policy_and_compliance",
        "interview_coordination",
        "candidate_communication",
        "hris_and_excel",
        "time_and_prioritization",
        "payroll_support",
    }
    # A fresh competency ask spends no follow-up depth on anyone.
    assert agent._memory.competency_followup_counts.get("policy_and_compliance", 0) == 0


def test_turn_log_names_the_replacement_and_keeps_the_original_intent():
    _, rows = _replay()
    rec = rows[6]["record"]
    assert rec["competencyKey"] == "policy_and_compliance"
    assert rec["planSource"] == "competency_engine"
    assert rec["guardSwap"]["to"] == "competency"
    assert rec["guardSwap"]["reason"] == "duplicate"
    assert rec["guardSwap"]["fromCompetency"] == "confidentiality_and_discretion"
    assert rec["guardSwap"]["toCompetency"] == "policy_and_compliance"
    assert "السرية" in rec["guardSwap"]["fromQuestion"]
    # An ordinary turn carries no swap.
    assert rows[1]["record"]["guardSwap"] is None


def test_turn_log_labels_a_bridge_too(monkeypatch):
    _, rows = _replay(monkeypatch, old_behaviour=True)
    swap = rows[6]["record"]["guardSwap"]
    assert swap["to"] == "bridge"
    assert swap["fromCompetency"] == "confidentiality_and_discretion"


# ── The subject check on its own ─────────────────────────────────────────────


#: What the real record path puts in ``coverage_evidence`` before turn 6: the
#: greeting AS HEARD (not its never-spoken rewrite), each spoken question, and
#: the blueprint wording of each anchor that was delivered.
_J_EVIDENCE_BEFORE_TURN_6 = [
    _J_GREETING,
    _J_SPOKEN_ATS,
    SESSION_J_ANCHORS[0],
    _J_SPOKEN_HRIS,
    SESSION_J_ANCHORS[1],
    _J_SPOKEN_DOCS,
    SESSION_J_ANCHORS[2],
]
_J_TITLES = [title for _, title, _, _ in _J_COMPETENCIES]


def _j_covered(title: str, evidence: list[str] = _J_EVIDENCE_BEFORE_TURN_6) -> bool:
    return subject_already_asked(
        title, evidence, other_subjects=[t for t in _J_TITLES if t != title]
    )


def test_replay_records_the_approved_evidence_before_turn_6():
    agent, _ = _replay()
    assert agent._memory.coverage_evidence[:7] == _J_EVIDENCE_BEFORE_TURN_6
    assert _J_GREETING_RECORD not in agent._memory.coverage_evidence  # never spoken


@pytest.mark.parametrize(
    ("title", "covered"),
    [
        ("الدقة بإدخال البيانات", True),
        # Approved as covered by د4; its words barely overlap («حفظ» only). It is
        # the competency REJECTED on turn 6 and marked asked, so it is excluded by
        # that route and never reaches this check at a decision point.
        ("السرية وحفظ المعلومات", False),
        ("تنسيق المقابلات", True),  # through the delivered anchor «بتنسيق المقابلات»
        ("استخدام HRIS وExcel", True),
        ("الالتزام بالإجراءات والسياسات", False),
        ("التواصل مع المرشحين", False),  # «مع مرشح» for scheduling is not the subject
        ("إدارة الوقت والأولويات", False),
        ("دعم الرواتب والمستحقات", False),  # the payroll line was never spoken
        # Documented exception (owner, 2026-09-24): approved as covered, invisible
        # to any word match — zero words shared with what was delivered.
        ("إدارة الملفات والسجلات", False),
        ("مساعدة بالمطابقات والتقارير", False),
    ],
)
def test_subject_coverage_on_session_j(title, covered):
    assert _j_covered(title) is covered


def test_interview_coordination_needs_the_delivered_anchor_not_just_the_rewording():
    """The rewording says «تنسق», not «تنسيق»: one title word alone is not coverage."""
    spoken_only = [e for e in _J_EVIDENCE_BEFORE_TURN_6 if e not in SESSION_J_ANCHORS]
    assert _j_covered("تنسيق المقابلات", spoken_only) is False
    assert _j_covered("تنسيق المقابلات") is True


def test_documented_exception_never_changes_a_j_decision():
    """document_management sits after every J pick in P4's order, so reading it as
    covered (the approved judgement) could not have changed any of them."""
    agent, rows = _replay()
    order = [c["competencyKey"] for c in agent._ordered_blueprint_competencies()]
    for turn in (6, 7, 9, 11):
        assert order.index(rows[turn]["competency"]) < order.index(
            "document_management"
        )


def test_the_greeting_rewrite_never_counts_as_asked():
    """Only the verbatim greeting was heard. A rewrite recorded at turn 0 — even
    one naming a competency outright — must not cover it."""
    agent = session_j_agent()
    agent.mark_verbatim(_J_GREETING)
    agent.record_agent_reply("شنو خبرتك بدعم الرواتب والمستحقات بالشركة؟")
    assert agent._memory.coverage_evidence == [_J_GREETING]
    assert not _j_covered("دعم الرواتب والمستحقات", agent._memory.coverage_evidence)


def test_subject_already_asked_in_english():
    heard = [
        "What is your experience coordinating interviews on an ATS such as Greenhouse?"
    ]
    assert subject_already_asked("Interview Coordination", heard) is True
    assert subject_already_asked("Candidate Communication", heard) is False


def test_subject_already_asked_with_nothing_heard():
    assert subject_already_asked("تنسيق المقابلات", []) is False
    assert subject_already_asked("", [_J_SPOKEN_ATS]) is False
