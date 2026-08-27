"""P0.6 gate scenarios — automated replay for Recruiter active-question lock."""

from __future__ import annotations

import pytest

from voice_interview.active_question import (
    MODE_CLARIFY,
    MODE_FOLLOW_UP,
    MODE_GUIDANCE,
    MODE_WAIT,
    STATUS_AWAITING_ANSWER,
    STATUS_CLARIFYING,
    TurnPlan,
    make_path_question_id,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import analyze_user_answer


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


HR_PATH = [
    {
        "pathKey": "recruiter_default_experienced",
        "steps": [
            {
                "stepKey": "sourcing_channels",
                "competencyKey": "sourcing_strategy",
                "clusterKey": "sourcing",
                "sampleQuestion": "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
            },
            {
                "stepKey": "channel_quality",
                "competencyKey": "sourcing_strategy",
                "clusterKey": "sourcing",
                "sampleQuestion": "شلون قيّمت جودة المرشحين من كل قناة؟",
            },
            {
                "stepKey": "screening",
                "competencyKey": "structured_evaluation",
                "clusterKey": "screening",
                "sampleQuestion": "شلون تفرّق بين مرشح قوي وضعيف؟",
            },
            {
                "stepKey": "hiring_delays",
                "competencyKey": "metrics",
                "clusterKey": "metrics",
                "sampleQuestion": "شلون تتعامل مع تأخيرات التوظيف؟",
            },
            {
                "stepKey": "interview_notes",
                "competencyKey": "structured_evaluation",
                "clusterKey": "screening",
                "sampleQuestion": "شلون تسجل ملاحظات المقابلة؟",
            },
        ],
    }
]


def _recruiter() -> InterviewAssistant:
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
        interview_paths=HR_PATH,
    )


def test_gate_linkedin_not_repeated_after_answer() -> None:
    """Gate 1: same question_id must not return after answered closure."""
    agent = _recruiter()
    mem = agent._memory
    qid = make_path_question_id(
        "hr_recruiter", "recruiter_default_experienced", "sourcing_channels"
    )
    agent._turn_plan = TurnPlan(
        question="شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
        question_id=qid,
        step_key="sourcing_channels",
        cluster_key="sourcing",
        path_key="recruiter_default_experienced",
        source="path_step",
    )
    agent.record_agent_reply("شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟")

    answer = (
        "استخدمت LinkedIn والإحالات الداخلية وكنت أركز على وضوح الإعلان "
        "والراتب التنافسي بشكل واضح جداً في كل إعلان ننشره للمرشحين"
    )
    diag = analyze_user_answer(
        answer,
        active_question_text=mem.active_question_text,
        active_question_status=mem.active_question_status,
    )
    action = agent._infer_action_from_frame(diag)
    agent._update_memory_post_decision(diag, action)
    assert qid in mem.closed_question_ids

    next_q = agent._pick_path_step_recommendation(mem)
    assert next_q is not None
    assert mem.pending_step_key != "sourcing_channels"
    next_id = make_path_question_id(
        "hr_recruiter",
        "recruiter_default_experienced",
        mem.pending_step_key or "",
    )
    assert next_id != qid
    assert next_id not in mem.closed_question_ids


def test_gate_clarify_stays_on_delays_not_notes() -> None:
    """Gate 2: clarify on delays — same question, no notes step."""
    agent = _recruiter()
    mem = agent._memory
    delays_q = "شلون تتعامل مع تأخيرات التوظيف؟"
    qid = make_path_question_id("hr_recruiter", "recruiter_default_experienced", "hiring_delays")
    mem.active_question_text = delays_q
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.sent_question_id = qid
    mem.pending_step_key = "hiring_delays"
    mem.pending_cluster_key = "metrics"
    mem.last_sample = delays_q

    diag = analyze_user_answer(
        "ممكن توضحي؟",
        active_question_text=delays_q,
        active_question_status=STATUS_AWAITING_ANSWER,
    )
    agent._apply_active_question_user_signals(mem, diag)
    assert mem.active_question_status == STATUS_CLARIFYING

    rec = agent._pick_recommended_question(diag, mem, {})
    assert rec is not None
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_CLARIFY
    assert agent._turn_plan.question_id == qid
    assert "ملاحظات" not in (rec or "")

    agent.record_agent_reply(rec or "")
    assert mem.active_question_status == STATUS_AWAITING_ANSWER
    assert mem.sent_question_id == qid


def test_gate_resume_waits_no_path_advance() -> None:
    """Gate 3: «خليني أكمل» — wait, no path_cursor++."""
    agent = _recruiter()
    mem = agent._memory
    mem.active_question_text = "شنو قنوات الاستقطاب؟"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.path_cursor = 0

    diag = analyze_user_answer("بس خليني أوضح لج")
    rec = agent._pick_recommended_question(diag, mem, {})
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_WAIT
    assert mem.path_cursor == 0
    assert rec is not None


def test_gate_open_question_blocks_bank_and_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Gate 4: open question blocks bank anchor, path advance, competency jump."""
    # Spoken nudges are off by default (they interrupt); enable them here so the
    # gate's WAIT decision is observable as a recommendation instead of silence.
    monkeypatch.setenv("INTERVIEW_WAIT_NUDGE", "true")
    agent = _recruiter()
    mem = agent._memory
    mem.active_question_text = "شنو قنوات الاستقطاب؟"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.path_cursor = 0
    mem.pending_step_key = "sourcing_channels"

    diag = analyze_user_answer("تمام")
    rec = agent._pick_recommended_question(diag, mem, {})
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_WAIT
    assert mem.path_cursor == 0
    assert rec is not None


def test_gate_story_starter_follow_up_not_path_advance() -> None:
    """P0.6-2: partial HR Manager story → follow-up, no path advance."""
    agent = _recruiter()
    mem = agent._memory
    qid = make_path_question_id(
        "hr_recruiter", "recruiter_default_experienced", "difficult_role"
    )
    mem.active_question_text = "اذكرلي دور كان صعب بالتوظيف"
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.sent_question_id = qid
    mem.pending_step_key = "difficult_role"
    mem.path_cursor = 2

    partial = "كان ذو صفات عالية جداً"
    diag = analyze_user_answer(
        partial,
        active_question_text=mem.active_question_text,
        active_question_status=mem.active_question_status,
    )
    agent._apply_active_question_user_signals(mem, diag)
    rec = agent._pick_recommended_question(diag, mem, {})
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_FOLLOW_UP
    assert mem.path_cursor == 2
    assert "مقابلات" not in (rec or "").lower()


def test_live_qa_topic_change_not_treated_as_incomplete() -> None:
    """«ما فكر بهذا السؤال ممكن نغير سؤال» must skip, not wait."""
    text = "الحقيقة ما فكر بهذا السؤال ممكن نغير سؤال"
    diag = analyze_user_answer(text)
    assert diag["is_topic_change_request"] is True
    assert diag["is_incomplete_turn"] is False
    assert diag["is_answer_in_progress"] is False
    assert diag["resume_active"] is False


def test_live_qa_guidance_not_topic_skip() -> None:
    """«ما مرت عليه تجربة... شنو الإجراء الأنسب؟» = guidance, not skip/clarify."""
    text = "ما مرت عليه هيچ تجربة بهالموضوع، أنا أسأل شنو الإجراء الأنسب؟"
    diag = analyze_user_answer(
        text,
        active_question_text="شلون تتعامل إذا تغيّرت متطلبات المدير أثناء التوظيف؟",
        active_question_status=STATUS_AWAITING_ANSWER,
    )
    assert diag["is_ask_for_guidance"] is True
    assert diag["candidate_intent"] == "ask_guidance"
    assert diag["is_topic_change_request"] is False
    assert diag["meta_request"] is None


def test_gate_guidance_offers_practice_then_bridge() -> None:
    """Guidance intent: brief advice + bridge question, no path jump."""
    agent = _recruiter()
    mem = agent._memory
    qid = make_path_question_id(
        "hr_recruiter", "recruiter_default_experienced", "manager_requirements"
    )
    active_q = "شلون تتعامل إذا تغيّرت متطلبات المدير أثناء التوظيف؟"
    mem.active_question_text = active_q
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.sent_question_id = qid
    mem.pending_step_key = "manager_requirements"
    mem.pending_cluster_key = "manager_intake"
    mem.last_sample = active_q
    mem.path_cursor = 1

    text = "ما مرت عليه هيچ تجربة، أنا أسأل شنو الإجراء الأنسب؟"
    diag = analyze_user_answer(
        text,
        active_question_text=active_q,
        active_question_status=STATUS_AWAITING_ANSWER,
    )
    assert agent._infer_action_from_frame(diag) == "offer_guidance"

    rec = agent._pick_recommended_question(diag, mem, {})
    assert rec is not None
    assert agent._turn_plan is not None
    assert agent._turn_plan.response_mode == MODE_GUIDANCE
    assert agent._turn_plan.source == "offer_guidance"
    assert agent._turn_plan.question_id == qid
    assert "اجتماع" in rec or "المدير" in rec
    assert "LinkedIn" not in rec
    assert rec.count("؟") == 1
    assert mem.path_cursor == 1

    agent.record_agent_reply(rec)
    assert mem.active_question_status == STATUS_AWAITING_ANSWER
    assert mem.sent_question_id == qid


def test_live_qa_clarify_feedback_term() -> None:
    text = "ممكن توضحي لي أكثر شنو تقصد بعبارة تغذية راجعة للمرشحين؟"
    diag = analyze_user_answer(
        text,
        active_question_text="شلون تقدم تغذية راجعة للمرشحين المرفوضين؟",
        active_question_status="awaiting_answer",
    )
    assert diag["meta_request"] == "clarify_term"
    assert diag["is_topic_change_request"] is False


def test_single_question_guard_keeps_first_question() -> None:
    from voice_interview.active_question import TurnPlan, enforce_single_question_response

    plan = TurnPlan(
        question="شنو هي خبرتك بإجراء المقابلات المنظمة؟",
        response_mode="ask",
    )
    bad = (
        "شنو هي خبرتك بإجراء المقابلات المنظمة؟ "
        "وكيف تحدد المعايير اللي تستخدمها لتقييم المرشحين؟"
    )
    fixed = enforce_single_question_response(bad, plan)
    assert fixed.count("؟") == 1
    assert "المعايير" not in fixed


def test_gate_second_skip_rejects_neighboring_clusters() -> None:
    """P0.6-2: second skip from sourcing rejects neighbors."""
    agent = _recruiter()
    mem = agent._memory
    mem.pending_cluster_key = "sourcing"
    mem.pending_step_key = "sourcing_channels"
    mem.skip_count_by_cluster["sourcing"] = 1

    agent._reject_active_question(mem)
    mem.skip_count_by_cluster["sourcing"] = 2

    diag = analyze_user_answer("غير السؤال")
    rec = agent._pick_recommended_question(diag, mem, {})
    assert rec is not None
    assert agent._turn_plan is not None
    assert agent._turn_plan.cluster_key not in {"sourcing", "screening", "manager_intake", None}
    assert agent._turn_plan.step_key != "sourcing_channels"
