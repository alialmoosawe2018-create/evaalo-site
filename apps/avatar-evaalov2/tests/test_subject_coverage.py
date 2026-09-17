"""Coverage is three states on ONE ledger, not asked/not-asked per bank.

The owner's rule, verbatim: «لا تجعل coverage مجرد asked/not asked، ولا تجعل كل
جواب answered تلقائيًا. أريد على الأقل distinction بين asked, insufficient,
وevidence_obtained. يجب أن يمنع evidence_obtained سؤالًا آخر عن نفس subject حتى
لو جاء من question bank مختلف.»
"""

from __future__ import annotations

from voice_interview.heuristics import analyze_user_answer
from voice_interview.subject_coverage import (
    ASKED,
    EVIDENCE_OBTAINED,
    INSUFFICIENT,
    SubjectCoverage,
    evidence_state_for,
)

# Two questions about the same subject from two different sources: the left one
# is the blueprint competency, the right one is the role bank's own phrasing.
COMP_Q = "حچيلي عن قنوات الاستقطاب اللي اشتغلت بيها، وشنو سويت بيها فعلياً؟"
BANK_Q = "شنو مصادر التوظيف اللي تعتمد عليها أكثر، وليش؟"

RICH_ANSWER = (
    "بالشركة السابقة اشتغلت على الاستقطاب من لينكدإن ومن ترشيح الموظفين، "
    "وبنيت قائمة مرشحين لكل شاغر، والنتيجة قللنا وقت ملء الشاغر من ٤٥ يوم لـ٢٨ يوم."
)
THIN_ANSWER = "أي، أشتغل على الاستقطاب بشكل عام وأحاول أطور القنوات."


def _asked_and_answered(cov: SubjectCoverage, question: str, answer: str, **kw) -> str:
    cov.record_asked(question, competency_key=kw.get("competency_key", ""))
    diag = analyze_user_answer(answer)
    return cov.record_answer(
        answer,
        question=question,
        competency_key=kw.get("competency_key", ""),
        is_rich=bool(diag.get("is_rich_answer")),
    )


def test_asked_is_not_answered() -> None:
    cov = SubjectCoverage()
    cov.record_asked(COMP_Q, competency_key="talent_sourcing")
    assert cov.state(COMP_Q, competency_key="talent_sourcing") == ASKED
    assert not cov.should_skip(COMP_Q, competency_key="talent_sourcing")


def test_a_thin_answer_is_insufficient_not_evidence() -> None:
    """«ولا تجعل كل جواب answered تلقائيًا» — this is that rule."""
    cov = SubjectCoverage()
    state = _asked_and_answered(cov, COMP_Q, THIN_ANSWER, competency_key="talent_sourcing")
    assert state == INSUFFICIENT
    assert not cov.is_evidenced(COMP_Q, competency_key="talent_sourcing")


def test_a_real_story_with_an_outcome_is_evidence() -> None:
    cov = SubjectCoverage()
    state = _asked_and_answered(cov, COMP_Q, RICH_ANSWER, competency_key="talent_sourcing")
    assert state == EVIDENCE_OBTAINED


def test_evidence_blocks_the_other_bank_on_the_same_subject() -> None:
    """The headline requirement: «حتى لو جاء من question bank مختلف»."""
    cov = SubjectCoverage()
    _asked_and_answered(cov, COMP_Q, RICH_ANSWER, competency_key="talent_sourcing")
    # BANK_Q carries no competency key and different wording — same subject.
    assert cov.should_skip(BANK_Q)
    assert cov.is_evidenced(BANK_Q)


def test_an_insufficient_subject_is_dropped_after_the_second_ask() -> None:
    """«لا تجادل المرشح ولا تكرر السؤال نفسه؛ سجّل الحالة وانتقل»."""
    cov = SubjectCoverage()
    _asked_and_answered(cov, COMP_Q, THIN_ANSWER, competency_key="talent_sourcing")
    assert not cov.should_skip(BANK_Q)  # one rephrase is still allowed
    cov.record_asked(BANK_Q)
    assert cov.should_skip(BANK_Q)  # a third attempt is not
    assert cov.state(BANK_Q) == INSUFFICIENT  # recorded, not silently forgotten


def test_state_never_moves_backwards() -> None:
    cov = SubjectCoverage()
    _asked_and_answered(cov, COMP_Q, RICH_ANSWER, competency_key="talent_sourcing")
    cov.record_answer("أي.", question=BANK_Q, is_rich=False)
    assert cov.state(COMP_Q, competency_key="talent_sourcing") == EVIDENCE_OBTAINED


def test_two_different_competencies_are_never_merged_by_a_shared_topic() -> None:
    """Blueprint granularity survives unification — the rubric scores each one."""
    cov = SubjectCoverage()
    _asked_and_answered(cov, COMP_Q, RICH_ANSWER, competency_key="talent_sourcing")
    other = "احچيلي عن الاستقطاب للأدوار التقنية بالذات، شنو اختلف بيه؟"
    assert not cov.should_skip(other, competency_key="technical_sourcing")


def test_the_claim_is_honoured_only_when_the_record_agrees() -> None:
    cov = SubjectCoverage()
    # nothing on record → the claim alone proves nothing
    assert cov.close_on_candidate_claim(COMP_Q, competency_key="talent_sourcing") is False
    _asked_and_answered(cov, COMP_Q, THIN_ANSWER, competency_key="talent_sourcing")
    assert cov.close_on_candidate_claim(BANK_Q) is True
    assert cov.should_skip(BANK_Q)
    assert THIN_ANSWER[:20] in cov.prior_answer(BANK_Q)


def test_evidence_needs_substance_not_length() -> None:
    padding = "يعني بشكل عام الموضوع مهم جداً وأحاول دائماً أهتم بيه قدر الإمكان " * 3
    assert evidence_state_for(padding, is_rich=True) == INSUFFICIENT
    assert evidence_state_for(RICH_ANSWER, is_rich=True) == EVIDENCE_OBTAINED
    # rich=False can never be evidence, however concrete the words are
    assert evidence_state_for(RICH_ANSWER, is_rich=False) == INSUFFICIENT


def test_snapshot_reports_the_three_buckets() -> None:
    cov = SubjectCoverage()
    _asked_and_answered(cov, COMP_Q, RICH_ANSWER, competency_key="talent_sourcing")
    cov.record_asked("شلون تتعامل وية السرية بالمعلومات الحساسة؟", competency_key="confid")
    snap = cov.snapshot()
    assert snap["evidence_obtained"] == ["comp:talent_sourcing"]
    assert snap["asked"] == ["comp:confid"]
