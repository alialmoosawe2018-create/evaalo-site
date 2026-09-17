"""The ledger wired into the running agent — not just the data structure.

A green unit test on ``SubjectCoverage`` proves nothing about the interview if
the agent never consults it. These drive the real pickers, so the wiring is what
goes red when it breaks.
"""

from __future__ import annotations

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import analyze_user_answer
from voice_interview.subject_coverage import ASKED, EVIDENCE_OBTAINED, INSUFFICIENT

SOURCING_COMP = {
    "competencyKey": "talent_sourcing",
    "title": "الاستقطاب",
    "priority": "critical",
    "followUpRules": ["احچيلي عن قنوات الاستقطاب اللي اشتغلت بيها، وشنو سويت بيها فعلاً؟"],
}
# Same subject, different bank, different wording. Two of them, because the
# interesting block is the one the old guards cannot make: a question that was
# never asked, in words that were never used, on a subject already settled.
BANK_SOURCING_Q = "شنو مصادر التوظيف اللي تعتمد عليها أكثر، وليش هاي بالذات؟"
BANK_SOURCING_Q2 = "شلون تبني قنوات الاستقطاب لدور جديد بالفريق؟"
BANK_OTHER_Q = "شلون تتعامل وية سرية معلومات المرشحين الحساسة؟"

RICH_ANSWER = (
    "بالشركة السابقة اشتغلت على الاستقطاب من لينكدإن ومن ترشيح الموظفين، "
    "وبنيت قائمة مرشحين لكل شاغر، والنتيجة قللنا وقت ملء الشاغر من ٤٥ يوم لـ٢٨ يوم."
)
THIN_ANSWER = "أي، أشتغل على الاستقطاب بشكل عام وأحاول أطور القنوات شوية."


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _agent() -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    agent = InterviewAssistant(
        tts_router=router,
        bank_questions=[BANK_SOURCING_Q, BANK_SOURCING_Q2, BANK_OTHER_Q],
        bank_key="blueprint",
        position="HR Recruiter",
        has_domain_guidance=True,
        blueprint_competencies=[SOURCING_COMP],
    )
    agent._memory.anchor_questions_sent = 3
    return agent


def _ask_sourcing_then_answer(agent: InterviewAssistant, answer: str) -> None:
    q = agent._pick_next_competency_question(agent._memory)
    assert q is not None
    agent.record_agent_reply(q)
    agent._record_subject_answer(answer, analyze_user_answer(answer))


def test_asking_registers_the_subject_before_any_answer() -> None:
    """The ask itself must reach the ledger — and already unify the two banks."""
    agent = _agent()
    q = agent._pick_next_competency_question(agent._memory)
    agent.record_agent_reply(q)

    cov = agent._memory.subject_coverage
    assert cov.state(BANK_SOURCING_Q) == ASKED
    assert cov.ask_counts[cov.resolve(BANK_SOURCING_Q)] == 1


def test_evidence_from_the_competency_closes_the_bank_question_too() -> None:
    agent = _agent()
    _ask_sourcing_then_answer(agent, RICH_ANSWER)

    assert agent._memory.subject_coverage.state(BANK_SOURCING_Q) == EVIDENCE_OBTAINED
    # BOTH sourcing questions are off the table, neither of them ever asked
    assert agent._pick_next_bank_anchor() == BANK_OTHER_Q


def test_evidence_from_the_bank_closes_the_competency_too() -> None:
    """The other direction: the bank asked first, so the competency key is clean."""
    agent = _agent()
    agent.record_agent_reply(BANK_SOURCING_Q)
    agent._record_subject_answer(RICH_ANSWER, analyze_user_answer(RICH_ANSWER))

    assert "talent_sourcing" not in agent._memory.asked_competency_keys
    assert agent._pick_next_competency_question(agent._memory) is None


def test_the_same_bank_question_is_still_offered_when_the_answer_was_thin() -> None:
    """Control: the block above must come from the EVIDENCE, not from the ask."""
    agent = _agent()
    _ask_sourcing_then_answer(agent, THIN_ANSWER)

    assert agent._memory.subject_coverage.state(BANK_SOURCING_Q) == INSUFFICIENT
    # the bank returns the collapsed form, so match on the subject wording
    assert "مصادر التوظيف" in (agent._pick_next_bank_anchor() or "")


def test_a_thin_subject_is_dropped_rather_than_asked_a_third_time() -> None:
    """«سجّل الحالة وانتقل» — and BANK_SOURCING_Q2 is the third attempt.

    Nothing else in the agent can block it: it was never asked, its wording was
    never used, and its competency key was never marked. Only the ledger knows
    the subject behind it has had its two attempts.
    """
    agent = _agent()
    _ask_sourcing_then_answer(agent, THIN_ANSWER)
    agent.record_agent_reply(BANK_SOURCING_Q)  # the one rephrase
    agent._record_subject_answer(THIN_ANSWER, analyze_user_answer(THIN_ANSWER))

    assert agent._pick_next_bank_anchor() == BANK_OTHER_Q
    assert agent._memory.subject_coverage.state(BANK_SOURCING_Q2) == INSUFFICIENT


def test_already_answered_claim_advances_instead_of_arguing() -> None:
    """«جاوبتك على هذا» with an answer on record → move on, do not re-ask."""
    agent = _agent()
    _ask_sourcing_then_answer(agent, THIN_ANSWER)

    claim = "جاوبتك على هذا قبل شوية"
    diag = analyze_user_answer(claim)
    assert diag["claims_already_answered"] is True
    agent._record_subject_answer(claim, diag)

    assert diag["subject_already_covered"] is True
    assert agent._infer_action_from_frame(diag) == "advance"
    assert agent._pick_next_bank_anchor() == BANK_OTHER_Q


def test_a_claim_with_nothing_on_record_changes_nothing() -> None:
    """A subject cannot be skipped by asserting it was covered."""
    agent = _agent()
    q = agent._pick_next_competency_question(agent._memory)
    agent.record_agent_reply(q)

    claim = "سألتيني هذا قبل"
    diag = analyze_user_answer(claim)
    assert diag["claims_already_answered"] is True
    agent._record_subject_answer(claim, diag)

    assert diag.get("subject_already_covered") is not True
    # and the subject stays on the table — the claim bought nothing
    assert not agent._memory.subject_coverage.should_skip(BANK_SOURCING_Q)


def test_a_negated_claim_is_not_a_claim() -> None:
    diag = analyze_user_answer("لا، ما سألتيني عن هذا الموضوع أبداً")
    assert diag["claims_already_answered"] is False
