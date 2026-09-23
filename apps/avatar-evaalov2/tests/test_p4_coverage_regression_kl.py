"""P4's subject coverage, held to the owner-approved outcomes for K and L (2026-09-24).

The first matcher turned «الأعمال» into «العمل», «العمليات» into «العمل» and
«تأثير» into «تأثر» by deleting letters inside words, and treated two generic HR
words («بيانات» + «موظف») as a subject. In L that ended the interview on a
wrap-up with business partnering and policy design never asked; in K it asked a
medium competency before two high ones. The approved rule — a competency is
covered only when a DELIVERED question asked for its substance — is pinned here
at every decision point, with the replays in ``p4_replay_sessions`` (which, run
against the previous release, reproduce all five production decisions).
"""

from __future__ import annotations

import logging

import pytest
from p4_replay_sessions import SESSION_K, SESSION_L, Session, _router, replay

from voice_interview.active_question import MODE_ASK, TurnPlan
from voice_interview.assistant import InterviewAssistant
from voice_interview.heuristics import is_topic_repeat, normalize_text
from voice_interview.subject_coverage import shared_term_count, subject_already_asked
from voice_interview.turn_log import TurnLogSink


@pytest.fixture(scope="module")
def k():
    return replay(SESSION_K)


@pytest.fixture(scope="module")
def l_run():
    return replay(SESSION_L)


def _covered(session: Session, evidence: list[str], key: str) -> bool:
    titles = {k: t for k, t, _, _ in session.competencies}
    return subject_already_asked(
        titles[key],
        evidence,
        other_subjects=[t for kk, t in titles.items() if kk != key],
    )


# ── The approved decisions ───────────────────────────────────────────────────


def test_k_turn_13_employee_requests(k):
    _, out = k
    assert out[13]["pick"] == "employee_requests"


def test_k_turn_16_confidentiality_not_offboarding(k):
    _, out = k
    assert out[16]["pick"] == "confidentiality_data_protection"


def test_l_turn_15_employee_lifecycle(l_run):
    _, out = l_run
    assert out[15]["pick"] == "employee_lifecycle_management"


def test_l_turn_17_business_partnering_not_documentation(l_run):
    _, out = l_run
    assert out[17]["pick"] == "hr_business_partnering"


def test_l_turn_20_policy_design_and_no_wrap_up(l_run):
    agent, out = l_run
    assert out[20]["pick"] == "policy_design_and_process_improvement"
    assert out[20]["wrap_up_offered"] is False
    assert agent._memory.wrap_up_offered is False


def test_both_guard_passes_agree_at_every_decision(k, l_run):
    for _, out in (k, l_run):
        for turn, o in out.items():
            assert o["second_pass"] == o["line"], turn


# ── Genuinely covered stays excluded; genuinely uncovered stays eligible ─────

# (session, turn) → (covered or asked, uncovered) per the approved J/K/L table.
_APPROVED = {
    ("K", 13): (
        {"employee_records", "policy_execution", "hris_administration"},
        {
            "employee_requests",
            "onboarding_support",
            "offboarding_process",
            "confidentiality_data_protection",
            "compliance_reporting",
            "process_improvement",
        },
    ),
    ("K", 16): (
        {
            "employee_records",
            "policy_execution",
            "hr_service_delivery",
            "employee_requests",
            "onboarding_support",  # plan-marked — out of this release (owner, q2)
            "hris_administration",
        },
        {
            "confidentiality_data_protection",
            "offboarding_process",
            "compliance_reporting",
            "process_improvement",
        },
    ),
    ("L", 15): (
        {
            "hr_case_management",
            "hr_compliance",
            "hr_policy_application",
            "hr_operations_and_transactions",
            "onboarding_offboarding_design",
        },
        {
            "employee_lifecycle_management",
            "documentation_and_audit_readiness",
            "hr_analytics_reporting",
            "hr_business_partnering",
            "policy_design_and_process_improvement",
        },
    ),
    ("L", 17): (
        {
            "hr_case_management",
            "hr_compliance",
            "hr_policy_application",
            "hr_operations_and_transactions",
            "onboarding_offboarding_design",
            "employee_lifecycle_management",
        },
        {
            "hr_business_partnering",
            "policy_design_and_process_improvement",
            "documentation_and_audit_readiness",
            "hr_analytics_reporting",
        },
    ),
    ("L", 20): (
        {
            "hr_case_management",
            "hr_compliance",
            "hr_policy_application",
            "hr_operations_and_transactions",
            "onboarding_offboarding_design",
            "employee_lifecycle_management",
            "hr_business_partnering",
        },
        {
            "policy_design_and_process_improvement",
            "documentation_and_audit_readiness",
            "hr_analytics_reporting",
        },
    ),
}


@pytest.mark.parametrize(("name", "turn"), sorted(_APPROVED))
def test_coverage_at_each_decision_point_matches_the_approved_table(
    name, turn, k, l_run
):
    session, (_, out) = (SESSION_K, k) if name == "K" else (SESSION_L, l_run)
    snap = out[turn]
    covered, uncovered = _APPROVED[(name, turn)]
    for key in covered:
        assert key in snap["asked"] or _covered(session, snap["evidence"], key), key
    for key in uncovered:
        assert key not in snap["asked"], key
        assert not _covered(session, snap["evidence"], key), key


def test_k_hris_administration_is_covered_by_the_delivered_anchor(k):
    """Approved as covered: the HRIS anchor asked to keep HRIS data current. The
    spoken rewording keeps only «HRIS»; the anchor wording adds «نظام HRIS»."""
    _, out = k
    evidence = out[13]["evidence"]
    assert _covered(SESSION_K, evidence, "hris_administration")
    spoken_only = [e for e in evidence if e not in SESSION_K.anchors]
    assert not _covered(SESSION_K, spoken_only, "hris_administration")


def test_k_delivered_anchor_is_the_one_the_guard_swapped_in(k):
    """Turn 1 planned anchor 1 (requests); the guard delivered anchor 2 (HRIS).
    Counting the plan's anchor would have marked employee_requests heard at 13."""
    agent, _ = k
    evidence = agent._memory.coverage_evidence
    assert SESSION_K.anchors[1] in evidence
    assert SESSION_K.anchors[0] not in evidence


def test_the_greeting_rewrite_is_not_evidence_in_k(k):
    agent, _ = k
    evidence = agent._memory.coverage_evidence
    assert evidence[0] == SESSION_K.greeting
    assert not any("payroll" in e for e in evidence[:1])


# ── The collisions, and the genuine matches that must survive ────────────────


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("وبياناته", "ينتهي"),  # K: strip «و», strip the root «ب», drop two alefs
        ("الأعمال", "العمل"),  # L: the article form lost its alefs
        ("العمليات", "العمل"),  # L: «ات» then the «ي» from inside
        ("تأثير", "تأثر"),  # L: the «ي» from inside
    ],
)
def test_the_four_traced_collisions_no_longer_match(a, b):
    assert shared_term_count(a, b) == 0


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("المرشحين", "مرشح"),
        ("المقابلات", "مقابلة"),
        ("بياناته", "بيانات"),
        ("عملية", "العمليات"),
        ("بتنسيق", "تنسيق"),
        ("والسياسات", "سياسات"),
        ("coordination", "coordinating"),
        ("interviews", "interview"),
    ],
)
def test_genuine_inflections_still_match(a, b):
    assert shared_term_count(a, b) == 1


def test_generic_blueprint_words_are_not_a_subject():
    """K's t16 collision: «بياناته» + «موظف» from the records question. Both words
    sit in other titles of K's blueprint, so they cannot carry confidentiality."""
    records_q = SESSION_K.records[6].spoken  # turn 11
    assert "بياناته" in records_q and "موظف" in records_q
    assert not _covered(SESSION_K, [records_q], "confidentiality_data_protection")


def test_an_all_generic_title_needs_every_word():
    """L's policy design shares each word with another title («تصميم», «تحسين»,
    «السياسة», «العمليات»), so only a question holding all four covers it."""
    partial = "شلون تتعامل مع تصميم السياسة بالشركة؟"
    full = "احچيلي عن تصميم السياسة وتحسين العمليات اللي سويته؟"
    assert not _covered(SESSION_L, [partial], "policy_design_and_process_improvement")
    assert _covered(SESSION_L, [full], "policy_design_and_process_improvement")


def test_topic_classifier_no_longer_excludes_inside_p4_but_is_unchanged():
    """L's analytics was hidden because «بيانات» and «الأدلة» share one topic
    bucket. The bucket still exists — and still guards duplicates elsewhere —
    but P4 no longer uses it to exclude a competency."""
    evidence_q = SESSION_L.records[7].spoken  # turn 10: «المستندات أو الأدلة…»
    analytics = next(
        c for c in SESSION_L.competencies if c[0] == "hr_analytics_reporting"
    )
    assert is_topic_repeat(analytics[3], [evidence_q])  # classifier unchanged

    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Senior HR Generalist",
        bank_questions=[],
        blueprint_competencies=[
            {
                "competencyKey": analytics[0],
                "title": analytics[1],
                "priority": analytics[2],
                "questionObjective": analytics[3],
            }
        ],
    )
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent.record_agent_reply(evidence_q)
    # The candidate answered it with evidence, so the ledger closed that subject
    # — and the ledger files it under the same topic bucket. Asked about the
    # analytics QUESTION it would say "skip"; asked about the competency, not.
    agent._memory.subject_coverage.record_answer(
        "استخدمت محضر التحقيق وشهادات الموظفين، وقدرنا نحل المشكلة ونقلل الشكاوى بنسبة 30%",
        question=evidence_q,
        is_rich=True,
    )
    assert agent._memory.subject_coverage.should_skip(
        analytics[3], competency_key=analytics[0]
    )
    agent._memory.turn_index = 1
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent._guard_repetition_and_language(evidence_q)
    assert agent._turn_plan.competency_key == "hr_analytics_reporting"


def _plain_agent(anchors: list[str]) -> InterviewAssistant:
    return InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Senior HR Generalist",
        bank_questions=list(anchors),
    )


def test_a_planned_anchor_the_model_did_not_say_is_not_evidence():
    """Delivered means heard: a plan naming an anchor proves nothing if the spoken
    question is about something else (K turn 14 did this with a competency)."""
    agent = _plain_agent(SESSION_L.anchors)
    agent._turn_plan = TurnPlan(
        question=SESSION_L.anchors[1], source="track_anchor", response_mode=MODE_ASK
    )
    off_plan = (
        "بخصوص شغلك، اذكرلي شنو خبرتك مع نظام الـ payroll وكيف تعاملت ويه المشاكل؟"
    )
    agent.record_agent_reply(off_plan)
    assert agent._memory.coverage_evidence == [off_plan]


def test_the_delivered_anchor_is_the_first_pass_choice():
    """The second guard pass works on already reworded text and can land on a
    different anchor; the candidate heard the first pass's."""
    agent = _plain_agent(SESSION_K.anchors)
    mem = agent._memory
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent.record_agent_reply("شنو خبرتك العامة بالموارد البشرية؟")
    mem.turn_index = 1
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    hybrid = "شنو الشي اللي motivatesك بهذا الدور؟"
    agent._guard_repetition_and_language(hybrid)  # pass 1 → anchor 1
    first = agent._delivered_anchor
    mem.asked_question_keys.add(normalize_text(SESSION_K.anchors[0]))
    agent._guard_repetition_and_language(hybrid)  # pass 2 → would be anchor 2
    assert agent._delivered_anchor == first
    agent.record_agent_reply("سؤال مُعاد صياغته عن طلبات الموظفين والإجازات؟")
    assert SESSION_K.anchors[0] in mem.coverage_evidence
    assert SESSION_K.anchors[1] not in mem.coverage_evidence


# ── Diagnostics (no behaviour change) ────────────────────────────────────────


def _exhausted_agent() -> InterviewAssistant:
    """Every competency asked except one already covered — nothing to swap in."""
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Senior HR Generalist",
        bank_questions=[],
        blueprint_competencies=[
            {"competencyKey": k, "title": t, "priority": p, "questionObjective": o}
            for k, t, p, o in SESSION_L.competencies
        ],
    )
    agent._turn_log_sink = TurnLogSink(object())
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent.record_agent_reply(
        SESSION_L.records[4].spoken
    )  # onboarding/offboarding on HRIS
    mem = agent._memory
    mem.asked_competency_keys.update(
        k
        for k, *_ in SESSION_L.competencies
        if k not in ("onboarding_offboarding_design", "hr_operations_and_transactions")
    )
    mem.asked_questions.extend(f"سؤال سابق رقم {i}؟" for i in range(10))
    mem.turn_index = 5
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    return agent


def test_p4_logs_every_exclusion_and_its_reason_when_nothing_is_left(caplog):
    agent = _exhausted_agent()
    stand_in = SESSION_L.records[4].spoken
    with caplog.at_level(logging.INFO, logger="agent"):
        agent._guard_repetition_and_language(stand_in)
    line = next(
        r.getMessage() for r in caplog.records if "P4 found no" in r.getMessage()
    )
    assert "onboarding_offboarding_design=covered" in line
    assert "hr_operations_and_transactions=covered" in line
    assert "hr_case_management=asked" in line

    agent.record_agent_reply(agent._winddown_line or "")
    swap = agent._turn_log_sink.records[-1]["guardSwap"]
    assert swap["to"] == "wrap_up"
    assert swap["reason"] == "duplicate"
    assert "onboarding_offboarding_design=covered" in swap["p4Excluded"]


def test_first_pass_guard_reason_is_kept_in_the_turn_log():
    """K turn 1: the first pass swapped for «presupposing»; the second pass, on
    the rewritten text holding «وHRIS», called it «hybrid» and overwrote it."""
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="HR",
        bank_questions=[],
    )
    agent._turn_log_sink = TurnLogSink(object())
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    first_q = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent.record_agent_reply(first_q)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    agent._guard_repetition_and_language(first_q)  # pass 1: duplicate → bridge
    agent._guard_repetition_and_language(
        "شنو الشي اللي motivatesك بهذا الدور؟"
    )  # pass 2
    agent.record_agent_reply("سؤال جديد تماماً عن الرواتب؟")
    assert agent._turn_log_sink.records[-1]["guardSwap"]["reason"] == "duplicate"
