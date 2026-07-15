"""Live QA gate — hr_recruiter P0.5 personas (5 scenarios)."""

from __future__ import annotations

from voice_interview.active_question import (
    MODE_WAIT,
    STATUS_ANSWERED,
    STATUS_ANSWERING,
    STATUS_AWAITING_ANSWER,
    TurnPlan,
    enforce_single_question_response,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.experience_tracks import pick_distant_step
from voice_interview.heuristics import analyze_user_answer


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _recruiter_assistant() -> InterviewAssistant:
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
        bank_questions=[],
        bank_key="hr_recruiter",
        position="Recruiter",
        candidate_gender="female",
        has_domain_guidance=True,
        domain_pack_key="hr_recruiter",
    )


HR_PATH = [
    {
        "pathKey": "recruiter_default_experienced",
        "steps": [
            {
                "stepKey": "sourcing_channels",
                "competencyKey": "sourcing_strategy",
                "clusterKey": "sourcing",
                "sampleQuestion": "شنو قنوات الاستقطاب؟",
            },
            {
                "stepKey": "channel_quality",
                "competencyKey": "sourcing_strategy",
                "clusterKey": "sourcing",
                "sampleQuestion": "شلون قيّمت جودة المرشحين؟",
            },
            {
                "stepKey": "screening",
                "competencyKey": "structured_evaluation",
                "clusterKey": "screening",
                "sampleQuestion": "شلون تفرّق بين مرشح قوي وضعيف؟",
            },
            {
                "stepKey": "candidate_experience",
                "competencyKey": "candidate_experience",
                "clusterKey": "experience",
                "sampleQuestion": "شلون تحافظ على تجربة المرشح؟",
            },
        ],
    }
]


def test_persona_strong_candidate_partial_not_cut() -> None:
    """Strong candidate mid-answer — must not advance path."""
    agent = _recruiter_assistant()
    mem = agent._memory
    mem.active_question_text = "شنو قنوات الاستقطاب اللي استخدمتها؟"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.path_cursor = 0
    partial = (
        "استخدمت LinkedIn والإحالات الداخلية، وكنت أركز على وضوح الوصف "
        "والراتب التنافسي، وبعدين"
    )
    diag = analyze_user_answer(partial, active_question_text=mem.active_question_text)
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)
    assert mem.path_cursor == 0
    assert mem.active_question_status in (
        STATUS_AWAITING_ANSWER,
        STATUS_ANSWERED,
        STATUS_ANSWERING,
    )


def test_persona_junior_ambiguous_clarify() -> None:
    diag = analyze_user_answer(
        "أي أمور. ممكن.",
        active_question_text="شلون تفرّق بين مرشح قوي ومرشح يبدو جيد بس ضعيف بالتقييم؟",
        active_question_status="awaiting_answer",
    )
    assert diag["is_ambiguous_clarify"] is True


def test_persona_interrupt_resume_active() -> None:
    diag = analyze_user_answer("خليني أجاوب على سؤالك عن LinkedIn")
    assert diag["resume_active"] is True


def test_persona_topic_change_distant_jump() -> None:
    q, step, _comp, cluster = pick_distant_step(
        "hr_recruiter",
        HR_PATH,
        "experienced",
        rejected_step_keys={"sourcing_channels", "channel_quality"},
        rejected_cluster_keys={"sourcing"},
        completed_step_keys=set(),
        asked_competency_keys=set(),
        current_cluster_key="sourcing",
        asked_question_keys=set(),
    )
    assert q is not None
    assert step == "screening"
    assert cluster == "screening"


def test_persona_single_question_guard() -> None:
    plan = TurnPlan(
        question="شنو المؤشر الأهم عندكم؟",
        clarify_fallback="أقصد جودة المرشحين. شنو المؤشر الأهم؟",
        response_mode="ask",
    )
    bad = "شلون تقيّم القناة؟ وشلون تتابع بعد المقابلة؟"
    fixed = enforce_single_question_response(bad, plan)
    assert fixed.count("؟") == 1


def test_persona_answer_in_progress_wait() -> None:
    agent = _recruiter_assistant()
    mem = agent._memory
    mem.active_question_text = "شنو قنوات الاستقطاب؟"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    diag = analyze_user_answer("بس خليني أوضح لج")
    diag = {**diag, "link_policy": {}}
    rec = agent._pick_recommended_question(diag, mem, {})
    assert rec is not None
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_WAIT
