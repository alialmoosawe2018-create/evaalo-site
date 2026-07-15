"""P0.5 — active question state tests."""

from __future__ import annotations

from voice_interview.active_question import (
    MODE_WAIT,
    STATUS_ANSWERED,
    STATUS_ANSWERING,
    STATUS_AWAITING_ANSWER,
    STATUS_REJECTED,
    TurnPlan,
    enforce_single_question_response,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.experience_tracks import pick_distant_step
from voice_interview.heuristics import analyze_user_answer


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
        position="HR Recruiter",
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
                "sampleQuestion": "شنو قنوات الاستقطاب؟",
            },
            {
                "stepKey": "channel_quality",
                "competencyKey": "sourcing_strategy",
                "sampleQuestion": "شلون قيّمت جودة المرشحين؟",
            },
            {
                "stepKey": "screening",
                "competencyKey": "structured_evaluation",
                "sampleQuestion": "شلون تفرّق بين مرشح قوي وضعيف؟",
            },
            {
                "stepKey": "candidate_experience",
                "competencyKey": "candidate_experience",
                "sampleQuestion": "شلون تحافظ على تجربة المرشح؟",
            },
        ],
    }
]


def test_resume_active_detected() -> None:
    diag = analyze_user_answer("خليني أجاوب على سؤالك عن بعد المقابلة")
    assert diag["resume_active"] is True


def test_ambiguous_clarify_not_linkedin_start() -> None:
    diag = analyze_user_answer(
        "أي أمور. ممكن.",
        active_question_text="شلون تفرّق بين مرشح قوي ومرشح يبدو جيد بس ضعيف بالتقييم؟",
        active_question_status="awaiting_answer",
    )
    assert diag["is_ambiguous_clarify"] is True

    diag2 = analyze_user_answer(
        "ممكن، استخدمت LinkedIn.",
        active_question_text="شنو قنوات الاستقطاب؟",
        active_question_status="awaiting_answer",
    )
    assert diag2["is_ambiguous_clarify"] is False
    assert diag2["is_substantive_answer"] is True


def test_answer_in_progress_waits() -> None:
    agent = _make_assistant()
    agent._memory.active_question_text = "شنو قنوات الاستقطاب؟"
    agent._memory.active_question_status = STATUS_AWAITING_ANSWER
    diag = analyze_user_answer("بس خليني أوضح لج")
    diag = {**diag, "link_policy": {}}
    rec = agent._pick_recommended_question(diag, agent._memory, {})
    assert rec is not None
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_WAIT


def test_topic_skip_does_not_advance_before_agent_reply() -> None:
    agent = _make_assistant(bank=["Q1", "Q2"])
    mem = agent._memory
    mem.active_question_text = "شنو قنوات LinkedIn؟"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.pending_step_key = "sourcing_channels"
    mem.path_cursor = 1

    diag = analyze_user_answer("خلينا نغير السؤال")
    agent._reject_active_question(mem)
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)

    assert mem.path_cursor == 1
    assert mem.active_question_status == STATUS_REJECTED


def test_record_agent_reply_opens_active_question() -> None:
    agent = _make_assistant()
    agent._turn_plan = TurnPlan(
        question="شلون تفرّق بين مرشح قوي وضعيف؟",
        step_key="screening",
        competency_key="structured_evaluation",
        cluster_key="screening",
        source="path_step",
    )
    agent.record_agent_reply("شلون تفرّق بين مرشح قوي وضعيف بالتقييم؟")

    mem = agent._memory
    assert mem.active_question_status == STATUS_AWAITING_ANSWER
    assert mem.pending_step_key == "screening"
    assert "؟" in mem.active_question_text


def test_answered_then_path_advance_on_send() -> None:
    agent = _make_assistant()
    mem = agent._memory
    mem.active_question_status = STATUS_ANSWERED
    mem.path_cursor = 2
    agent._turn_plan = TurnPlan(
        question="شلون تحافظ على تجربة المرشح؟",
        step_key="candidate_experience",
        source="path_step",
        advance_path_on_send=True,
    )
    agent.record_agent_reply("شلون تحافظ على تجربة المرشح الجيد؟")
    assert mem.path_cursor == 3
    assert mem.active_question_status == STATUS_AWAITING_ANSWER


def test_pick_distant_step_skips_rejected_cluster() -> None:
    q, step, comp, cluster = pick_distant_step(
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
    assert comp == "structured_evaluation"


def test_single_question_guard_replaces_double_question() -> None:
    plan = TurnPlan(
        question="شنو المؤشر الأهم عندكم؟",
        clarify_fallback="أقصد جودة المرشحين مو العدد. شنو المؤشر الأهم عندكم؟",
        response_mode="ask",
    )
    bad = "شلون تقيّم القناة؟ وشلون تتابع بعد المقابلة؟"
    fixed = enforce_single_question_response(bad, plan)
    assert fixed.count("؟") == 1
    assert "بعد المقابلة" not in fixed


def test_rich_answer_marks_answered_not_advance_cursor() -> None:
    agent = _make_assistant()
    mem = agent._memory
    mem.active_question_text = "شنو قنوات الاستقطاب؟"
    mem.active_question_status = STATUS_ANSWERING
    mem.path_cursor = 0
    text = (
        "استخدمت LinkedIn وTelegram والإحالات الداخلية "
        "وكنت أركز على وضوح الإعلان والمزايا"
    )
    diag = analyze_user_answer(text)
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)
    assert mem.active_question_status == STATUS_ANSWERED
    assert mem.path_cursor == 0
