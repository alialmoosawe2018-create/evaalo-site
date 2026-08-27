"""Blueprint competencies drive the interview.

The Stage-3 scorer can only rate a competency when the transcript carries an
evidence block for it, so the agent must ask every blueprint competency exactly
once (priority order) instead of improvising off the question bank.
"""

from __future__ import annotations

import pytest

from voice_interview.active_question import MODE_WAIT, STATUS_AWAITING_ANSWER
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import analyze_user_answer


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _competencies() -> list[dict]:
    """Mixed-priority blueprint, deliberately NOT in priority order."""
    return [
        {
            "competencyKey": "role_intake",
            "title": "استلام متطلبات الدور",
            "priority": "high",
            "questionObjective": "قياس قدرة المرشح على استلام متطلبات الدور من المدير.",
            "expectedEvidence": ["مثال حقيقي محدد", "النتيجة"],
            "followUpRules": ["شلون تستلم متطلبات الدور من المدير المسؤول؟"],
        },
        {
            "competencyKey": "sourcing",
            "title": "البحث عن المرشحين",
            "priority": "critical",
            "followUpRules": ["شلون تبني قائمة مرشحين لدور صعب؟"],
        },
        {
            "competencyKey": "structured_interviewing",
            "title": "المقابلة المنظّمة",
            "priority": "medium",
            "followUpRules": ["شلون تضمن عدالة المقابلة بين المرشحين؟"],
        },
        {
            "competencyKey": "hard_to_fill",
            "title": "الأدوار صعبة الملء",
            "priority": "critical",
            "followUpRules": ["احچيلي عن دور صعب ملأته، شنو سويت؟"],
        },
    ]


def _make_agent(
    competencies: list[dict] | None = None,
    bank: list[str] | None = None,
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
        if bank is not None
        else [
            "اذكرلي أهم دور وظّفت عليه، وشنو كان دورك بيه؟",
            "شنو نوع الأدوار اللي عندك خبرة بيها أكثر شي؟",
            "احچيلي عن أصعب توظيف مرّ بيك؟",
        ],
        bank_key="blueprint",
        position="HR Recruiter",
        has_domain_guidance=True,
        blueprint_competencies=competencies
        if competencies is not None
        else _competencies(),
    )


def _drain_anchor_intro(agent: InterviewAssistant) -> None:
    """Fast-forward past the fixed 3-anchor intro backbone."""
    agent._memory.anchor_questions_sent = 3


# ── The engine itself ────────────────────────────────────────────────────────


def test_engine_walks_every_competency_in_priority_order() -> None:
    agent = _make_agent()
    mem = agent._memory

    picked: list[str] = []
    questions: list[str] = []
    for _ in range(len(_competencies())):
        q = agent._pick_next_competency_question(mem)
        assert q is not None
        picked.append(agent._turn_plan.competency_key)
        questions.append(q)
        agent.record_agent_reply(q)

    # critical (blueprint order) → high → medium, every competency exactly once.
    assert picked == [
        "sourcing",
        "hard_to_fill",
        "role_intake",
        "structured_interviewing",
    ]
    assert len(set(questions)) == len(questions)
    assert mem.asked_competency_keys == {
        "sourcing",
        "hard_to_fill",
        "role_intake",
        "structured_interviewing",
    }

    # Everything covered → the engine yields, the bank takes over.
    assert agent._pick_next_competency_question(mem) is None


def test_engine_marks_competency_covered_at_send_time() -> None:
    agent = _make_agent()
    mem = agent._memory

    q1 = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q1)
    assert "sourcing" in mem.asked_competency_keys

    q2 = agent._pick_next_competency_question(mem)
    assert agent._turn_plan.competency_key == "hard_to_fill"
    assert q2 != q1


def test_engine_skips_asked_and_rejected_competencies() -> None:
    agent = _make_agent()
    mem = agent._memory
    mem.asked_competency_keys.add("sourcing")
    mem.rejected_competency_keys.add("hard_to_fill")

    assert agent._pick_next_competency_question(mem) is not None
    assert agent._turn_plan.competency_key == "role_intake"


def test_engine_ignores_competencies_without_a_key() -> None:
    # Legacy/test blueprints (title + followUps only) have nothing to score
    # against, so they must not hijack the interview.
    agent = _make_agent(competencies=[{"title": "field survey", "followUps": ["س؟"]}])
    assert agent._pick_next_competency_question(agent._memory) is None


def test_engine_covers_medium_priority_competencies_too() -> None:
    # Regression: the old coverage floor only forced priority=="critical", so
    # high/medium competencies were never asked and never scored.
    agent = _make_agent(
        competencies=[
            {
                "competencyKey": "c_med",
                "title": "متابعة",
                "priority": "medium",
                "followUpRules": ["شلون تتابع المرشح بعد العرض؟"],
            },
        ]
    )
    assert agent._pick_next_competency_question(agent._memory) is not None
    assert agent._turn_plan.competency_key == "c_med"


# ── Question construction ────────────────────────────────────────────────────


def test_question_prefers_blueprint_follow_up_rule() -> None:
    agent = _make_agent()
    q = agent._pick_next_competency_question(agent._memory)
    assert q == "شلون تبني قائمة مرشحين لدور صعب؟"


def test_question_falls_back_to_objective_when_rule_is_not_a_question() -> None:
    # The taxonomy fallback emits instructions ("اطلب مثالاً…"), not questions.
    agent = _make_agent(
        competencies=[
            {
                "competencyKey": "accuracy",
                "title": "الدقة بالبيانات",
                "priority": "critical",
                "questionObjective": "قياس الدقة بالبيانات.",
                "expectedEvidence": ["خطوات المراجعة"],
                "followUpRules": ["اطلب مثالاً محدداً بأرقام إن بقي عاماً."],
            }
        ]
    )
    q = agent._pick_next_competency_question(agent._memory)
    assert q is not None
    assert "الدقة بالبيانات" in q
    assert "خطوات المراجعة" in q
    assert q.count("؟") == 1


def test_question_falls_back_to_title_without_evidence() -> None:
    agent = _make_agent(
        competencies=[
            {"competencyKey": "k", "title": "إدارة الوقت", "priority": "high"},
        ]
    )
    q = agent._pick_next_competency_question(agent._memory)
    assert q is not None
    assert "إدارة الوقت" in q
    assert q.count("؟") == 1


# ── Wiring into the turn picker ──────────────────────────────────────────────


def test_anchor_intro_runs_before_the_competency_engine() -> None:
    agent = _make_agent()
    mem = agent._memory
    diag = analyze_user_answer("أهلاً، أنا جاهز")
    diag = agent._apply_entity_policy("أهلاً، أنا جاهز", diag)

    for _ in range(3):
        q = agent._pick_recommended_question(diag, mem, diag.get("link_policy") or {})
        assert q is not None
        assert agent._turn_plan.source in ("bank", "track_anchor")
        agent.record_agent_reply(q)

    assert mem.anchor_questions_sent == 3


def test_competency_engine_outranks_the_question_bank() -> None:
    agent = _make_agent()
    mem = agent._memory
    _drain_anchor_intro(agent)

    text = "اشتغلت على توظيف مهندسين وسويت خطة بحث كاملة وحصلت على ثلاث ترشيحات قوية بالشهر الأول."
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)

    q = agent._pick_recommended_question(diag, mem, diag.get("link_policy") or {})
    assert q is not None
    assert agent._turn_plan.source == "competency_engine"
    assert agent._turn_plan.competency_key == "sourcing"


def test_every_competency_is_asked_once_across_a_session() -> None:
    agent = _make_agent()
    mem = agent._memory
    _drain_anchor_intro(agent)

    text = "اشتغلت على توظيف مهندسين وسويت خطة بحث وحصلت على ترشيحات قوية بالشهر الأول."
    asked: list[str] = []
    for _ in range(12):
        diag = analyze_user_answer(text)
        diag = agent._apply_entity_policy(text, diag)
        q = agent._pick_recommended_question(diag, mem, diag.get("link_policy") or {})
        if q is None:
            continue
        if agent._turn_plan.source == "competency_engine":
            asked.append(agent._turn_plan.competency_key)
        agent.record_agent_reply(q)
        mem.active_question_status = STATUS_AWAITING_ANSWER

    assert sorted(asked) == sorted(c["competencyKey"] for c in _competencies())
    assert len(asked) == len(set(asked))


def test_follow_up_budget_advances_to_the_next_competency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERVIEW_MAX_FOLLOWUPS_PER_COMPETENCY", "1")
    agent = _make_agent()
    mem = agent._memory
    _drain_anchor_intro(agent)

    first = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(first)
    assert mem.current_competency_key == "sourcing"
    assert agent._competency_followup_budget_left(mem) is True

    # One follow-up spends the whole budget for this competency.
    follow = "وشنو كانت أصعب نقطة بهاي الخطة؟"
    agent._set_turn_recommendation(follow, source="hook_followup")
    agent.record_agent_reply(follow)
    assert agent._competency_followup_budget_left(mem) is False

    text = "اشتغلت على توظيف مهندسين وسويت خطة بحث وحصلت على ترشيحات قوية."
    diag = analyze_user_answer(text)
    diag = agent._apply_entity_policy(text, diag)
    q = agent._pick_recommended_question(diag, mem, diag.get("link_policy") or {})
    assert agent._turn_plan.source == "competency_engine"
    assert agent._turn_plan.competency_key == "hard_to_fill"
    assert q is not None


# ── Phase B: the "take your time" nudge must stay silent everywhere ──────────


def test_active_question_path_emits_no_continuation_nudge() -> None:
    # INTERVIEW_WAIT_NUDGE defaults to false: no code path may broadcast a
    # CONTINUATION_POOL line, including the active-question lock.
    agent = _make_agent()
    mem = agent._memory
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.active_question_text = "شلون تبني قائمة مرشحين لدور صعب؟"

    text = "ما أدري بصراحة"
    diag = analyze_user_answer(
        text,
        active_question_text=mem.active_question_text,
        active_question_status=mem.active_question_status,
    )
    diag = agent._apply_entity_policy(text, diag)

    locked = agent._active_question_locked_pick(
        diag, mem, diag.get("link_policy") or {}
    )
    assert locked is None
    assert "خذ راحتك" not in (locked or "")


def test_continuation_nudge_restored_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERVIEW_WAIT_NUDGE", "true")
    agent = _make_agent()
    mem = agent._memory
    mem.active_question_status = STATUS_AWAITING_ANSWER
    mem.active_question_text = "شلون تبني قائمة مرشحين لدور صعب؟"

    text = "ما أدري بصراحة"
    diag = analyze_user_answer(
        text,
        active_question_text=mem.active_question_text,
        active_question_status=mem.active_question_status,
    )
    diag = agent._apply_entity_policy(text, diag)

    locked = agent._active_question_locked_pick(
        diag, mem, diag.get("link_policy") or {}
    )
    assert locked is not None
    assert agent._turn_plan.response_mode == MODE_WAIT
