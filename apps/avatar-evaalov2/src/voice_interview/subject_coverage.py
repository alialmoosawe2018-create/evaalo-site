"""Subject coverage — three states, one ledger shared by every question source.

Coverage used to be binary AND split by source: ``asked_competency_keys`` for the
blueprint competencies, ``asked_question_keys`` / ``asked_topics`` for the role
bank, and nothing tied the two together. Two consequences, both seen in real
interviews:

* a subject the candidate had already evidenced came back as a "fresh" question
  from the other source — it was unasked *in that bank*, so no guard objected;
* any answer at all closed the subject as answered. One word counted.

This ledger keeps ONE state per subject, whichever bank the question came from:

``asked``
    the question went out, nothing usable has come back yet.
``insufficient``
    the candidate answered, but there is no usable evidence in it.
``evidence_obtained``
    a real answer: lived detail or a stated outcome.

``evidence_obtained`` blocks any further question on that subject. ``insufficient``
is recorded and then LEFT ALONE after the second ask — the agent moves on instead
of arguing with the candidate or re-asking the identical question.

State never moves backwards: once a subject is evidenced, a later thin turn on the
same subject cannot reopen it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from .heuristics import (
    classify_interview_topic,
    content_tokens,
    has_experience_markers,
    is_semantic_duplicate_question,
    mentions_result,
    normalize_text,
)

ASKED = "asked"
INSUFFICIENT = "insufficient"
EVIDENCE_OBTAINED = "evidence_obtained"

# Monotonic: a subject only ever moves up this ladder.
_RANK = {ASKED: 0, INSUFFICIENT: 1, EVIDENCE_OBTAINED: 2}

# How many times one subject may be asked while it stays ``insufficient``. The
# second ask is the rephrase; a third would be the repetition the owner flagged.
_MAX_ASKS_WHILE_INSUFFICIENT = 2

# Questions kept per subject — enough for semantic matching and for quoting back
# what was already covered, without growing unbounded in a long session.
_KEEP_QUESTIONS = 4
_KEEP_ANSWERS = 3


def _comp_subject(competency_key: str) -> str:
    # NOT normalize_text: it turns "_" into a space, so ``talent_sourcing`` and a
    # different key ``talent sourcing`` would share one subject.
    return f"comp:{(competency_key or '').strip().lower()}"


def _signature(question: str) -> str:
    """A stable subject key for a question with no competency behind it."""
    toks = sorted(set(content_tokens(question)))[:4]
    return "q:" + "-".join(toks) if toks else ""


# ---- has the candidate already heard this subject? ---------------------------
#
# 2026-09-23 18:58 (HR Assistant): the blueprint's three anchor questions — ATS
# scheduling, HRIS records, sensitive documents — are the same subjects as three
# of its competencies. The competency question itself («احچيلي عن موقف حقيقي يبيّن
# تنسيق المقابلات») shares almost no words with the anchor the candidate already
# heard («شنو خبرتك بتنسيق المقابلات على ATS…»), so neither the duplicate detector
# nor the ledger above recognises the overlap. Only the model's rephrase did, once
# it borrowed the anchor's wording. Matching on the competency's SUBJECT (its
# title) against what was actually spoken closes that gap.
#
# 2026-09-24 — the first version of this matcher was too eager, and it cost two
# interviews real questions. It dropped long vowels from INSIDE words and kept a
# form with the article, so «الأعمال» became «العمل», «العمليات» became «العمل»,
# «تأثير» became «تأثر», and «وبياناته» (strip «و», strip the root «ب») met
# «ينتهي». In L (Senior HR Generalist) that marked business partnering and policy
# design as "heard", so the guard offered the wrap-up with both never asked; in K
# (Senior HR Specialist) «بياناته» + «موظف» — two generic HR words — hid
# confidentiality, and a medium competency was asked before two high ones.
#
# The rule now, as the owner defined coverage: a competency is covered only when
# a question the candidate actually heard asked for its substance. Mechanically:
#   * a word matches another only by losing clitics in front (ال، و، ب…) or an
#     inflection ending (ات، ين، ون، ة) — never a letter from inside, and never
#     leaving fewer than three letters;
#   * a word that also appears in ANOTHER competency's title of the same
#     blueprint carries no subject of its own («موظف», «بيانات», «إدارة»…). The
#     blueprint decides this, not a word list;
#   * one heard question must hold two of the title's words, at least one of them
#     distinctive — or, when every word of the title is shared, all of them.

# Arabic clitics that glue onto a word: «بتنسيق», «والسياسات», «للمرشحين».
_AR_PREFIXES = ("وال", "بال", "فال", "كال", "لل", "ال", "و", "ب", "ف", "ك", "ل")
# Inflection endings only — plural, feminine, the attached pronoun («مقابلات»/«مقابلة»).
_AR_SUFFIXES = ("ات", "ين", "ون", "ه")  # noqa: RUF001 — Arabic, not Latin look-alikes
_EN_SUFFIXES = ("ions", "ion", "ing", "ed", "es", "s")
_ALEF_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})  # noqa: RUF001
_MIN_STEM = 3


def _is_latin(word: str) -> bool:
    return word.isascii()


def _word_forms(token: str) -> frozenset[str]:
    """Every spelling one word takes by losing clitics or an inflection ending.

    Nothing is ever removed from the middle of a word. Words under three letters
    (Arabic function words such as «مع», «او») and bare clitics («والـ») carry no
    subject and yield no forms.
    """
    tok = token.translate(_ALEF_MAP)
    if len(tok) < _MIN_STEM or tok in _AR_PREFIXES:
        return frozenset()
    forms = {tok}
    if _is_latin(tok):
        # coordination / coordinating → «coordinat»; interviews → «interview».
        forms.update(
            tok[: -len(s)] for s in _EN_SUFFIXES if tok.endswith(s) and len(tok) - len(s) >= 4
        )
        return frozenset(forms)
    frontier = [tok]
    for _ in range(2):  # «وبالتنسيق» needs two strips
        frontier = [
            t[len(p) :]
            for t in frontier
            for p in _AR_PREFIXES
            if t.startswith(p) and len(t) - len(p) >= _MIN_STEM
        ]
        forms.update(frontier)
    forms.update(
        f[: -len(s)]
        for f in list(forms)
        for s in _AR_SUFFIXES
        if f.endswith(s) and len(f) - len(s) >= _MIN_STEM
    )
    return frozenset(forms)


def _terms(text: str) -> list[frozenset[str]]:
    return [forms for forms in (_word_forms(t) for t in content_tokens(text)) if forms]


def _has_term(term: frozenset[str], terms: Iterable[frozenset[str]]) -> bool:
    return any(term & other for other in terms)


def shared_term_count(a: str, b: str) -> int:
    """How many of ``a``'s words also occur in ``b``, under the same word rule."""
    other = _terms(b)
    return sum(1 for term in _terms(a) if _has_term(term, other))


def subject_already_asked(
    subject: str,
    heard_questions: Iterable[str],
    *,
    other_subjects: Iterable[str] = (),
) -> bool:
    """True when a question the candidate actually heard asked about this subject.

    ``subject`` is a competency title; ``other_subjects`` are the titles of the
    other competencies in the same blueprint — a word they share is not evidence
    of THIS subject. ``heard_questions`` must be what was delivered, not what was
    planned (see ``InterviewMemory.coverage_evidence``).
    """
    terms = _terms(subject)
    if not terms:
        return False
    others = [_terms(s) for s in other_subjects]
    distinctive = [t for t in terms if not any(_has_term(t, o) for o in others)]
    for question in heard_questions:
        heard = _terms(question)
        if not heard:
            continue
        matched = [t for t in terms if _has_term(t, heard)]
        if not distinctive:
            if len(matched) == len(terms):
                return True
        elif len(matched) >= min(2, len(terms)) and any(t in distinctive for t in matched):
            return True
    return False


def evidence_state_for(answer: str, *, is_rich: bool) -> str:
    """``evidence_obtained`` only for an answer that carries something scorable.

    Length alone is not evidence — the owner's rule «ولا تجعل كل جواب answered
    تلقائيًا». A rich turn still has to name lived experience or state an
    outcome; otherwise the subject stays ``insufficient`` and the agent moves on.
    """
    if not (answer or "").strip():
        return INSUFFICIENT
    if is_rich and (mentions_result(answer) or has_experience_markers(answer)):
        return EVIDENCE_OBTAINED
    return INSUFFICIENT


@dataclass
class SubjectCoverage:
    """The shared ledger. Lives on :class:`InterviewMemory`."""

    states: dict[str, str] = field(default_factory=dict)
    questions: dict[str, list[str]] = field(default_factory=dict)
    answers: dict[str, list[str]] = field(default_factory=dict)
    ask_counts: dict[str, int] = field(default_factory=dict)
    # alias (an HR topic, or a competency key folded into an existing subject)
    # -> the subject key that owns it. This is what unifies the two banks.
    aliases: dict[str, str] = field(default_factory=dict)

    # ---- resolution ---------------------------------------------------------

    def _alias_keys(self, question: str) -> list[str]:
        topic = classify_interview_topic(question or "")
        return [f"topic:{topic}"] if topic else []

    def _semantic_match(self, question: str) -> str:
        for subject, asked in self.questions.items():
            if asked and is_semantic_duplicate_question(question, asked):
                return subject
        return ""

    def resolve(self, question: str = "", *, competency_key: str = "") -> str:
        """The subject key this question belongs to, or "" if it is new.

        A competency keeps its own subject once it has one — blueprint
        granularity is never collapsed by a topic alias. A question with no
        competency behind it (the role bank, an anchor) folds into whatever
        subject already owns its topic or its wording.
        """
        ckey = (competency_key or "").strip()
        if ckey:
            subject = _comp_subject(ckey)
            if subject in self.states:
                return subject
            owned = self.aliases.get(subject)
            if owned:
                return owned

        for alias in self._alias_keys(question):
            owner = self.aliases.get(alias)
            if owner:
                # Never let a shared HR topic merge two DIFFERENT blueprint
                # competencies — that would drop a competency the rubric scores.
                if ckey and owner.startswith("comp:") and owner != _comp_subject(ckey):
                    continue
                return owner

        if question:
            match = self._semantic_match(question)
            if match and not (ckey and match.startswith("comp:")):
                return match
        return ""

    def subject_for(self, question: str = "", *, competency_key: str = "") -> str:
        """Resolve, creating the subject (and its aliases) when it is new."""
        existing = self.resolve(question, competency_key=competency_key)
        if existing:
            self._bind_aliases(existing, question, competency_key=competency_key)
            return existing
        ckey = (competency_key or "").strip()
        subject = _comp_subject(ckey) if ckey else _signature(question)
        if not subject:
            return ""
        self.states.setdefault(subject, ASKED)
        self._bind_aliases(subject, question, competency_key=competency_key)
        return subject

    def _bind_aliases(self, subject: str, question: str, *, competency_key: str = "") -> None:
        for alias in self._alias_keys(question):
            self.aliases.setdefault(alias, subject)
        ckey = (competency_key or "").strip()
        if ckey:
            comp = _comp_subject(ckey)
            if comp != subject:
                self.aliases.setdefault(comp, subject)

    # ---- recording ----------------------------------------------------------

    def record_asked(self, question: str, *, competency_key: str = "") -> str:
        subject = self.subject_for(question, competency_key=competency_key)
        if not subject:
            return ""
        self.states.setdefault(subject, ASKED)
        self.ask_counts[subject] = self.ask_counts.get(subject, 0) + 1
        q = (question or "").strip()
        if q:
            asked = self.questions.setdefault(subject, [])
            if normalize_text(q) not in {normalize_text(x) for x in asked}:
                asked.append(q[:400])
                del asked[:-_KEEP_QUESTIONS]
        return subject

    def record_answer(
        self, answer: str, *, question: str = "", competency_key: str = "", is_rich: bool = False
    ) -> str:
        """Grade the answer for its subject. Returns the resulting state."""
        subject = self.resolve(question, competency_key=competency_key)
        if not subject:
            subject = self.subject_for(question, competency_key=competency_key)
        if not subject:
            return ""
        text = (answer or "").strip()
        if text:
            kept = self.answers.setdefault(subject, [])
            kept.append(text[:600])
            del kept[:-_KEEP_ANSWERS]
        new_state = evidence_state_for(text, is_rich=is_rich)
        current = self.states.get(subject, ASKED)
        if _RANK.get(new_state, 0) > _RANK.get(current, 0):
            self.states[subject] = new_state
        return self.states.get(subject, ASKED)

    # ---- reading ------------------------------------------------------------

    def state(self, question: str = "", *, competency_key: str = "") -> str:
        subject = self.resolve(question, competency_key=competency_key)
        return self.states.get(subject, "") if subject else ""

    def is_evidenced(self, question: str = "", *, competency_key: str = "") -> bool:
        return self.state(question, competency_key=competency_key) == EVIDENCE_OBTAINED

    def should_skip(self, question: str = "", *, competency_key: str = "") -> bool:
        """True when a NEW question on this subject must not be asked.

        Two reasons, and only these two: the subject is already evidenced, or it
        has had its allowance of asks and stayed thin. The second is the
        "record it and move on" rule — never a third identical attempt.
        """
        subject = self.resolve(question, competency_key=competency_key)
        if not subject:
            return False
        state = self.states.get(subject, "")
        if state == EVIDENCE_OBTAINED:
            return True
        return (
            state == INSUFFICIENT
            and self.ask_counts.get(subject, 0) >= _MAX_ASKS_WHILE_INSUFFICIENT
        )

    def close_on_candidate_claim(self, question: str = "", *, competency_key: str = "") -> bool:
        """«جاوبتك» / «سألتيني» — check the record before answering back.

        Returns True only when the ledger actually holds an earlier answer for
        this subject. The subject is then taken off the table: no argument, no
        third attempt at the same question. Returns False when nothing is on
        record, and the caller carries on normally — the claim alone is not
        proof, so a candidate cannot skip a subject by asserting it was covered.
        """
        subject = self.resolve(question, competency_key=competency_key)
        if not subject or not (self.answers.get(subject) or []):
            return False
        current = self.states.get(subject, ASKED)
        if _RANK.get(current, 0) < _RANK[INSUFFICIENT]:
            self.states[subject] = INSUFFICIENT
        self.ask_counts[subject] = max(
            self.ask_counts.get(subject, 0), _MAX_ASKS_WHILE_INSUFFICIENT
        )
        return True

    def prior_answer(self, question: str = "", *, competency_key: str = "") -> str:
        """What the candidate already said on this subject, newest first."""
        subject = self.resolve(question, competency_key=competency_key)
        if not subject:
            return ""
        kept = self.answers.get(subject) or []
        return kept[-1] if kept else ""

    def snapshot(self) -> dict[str, object]:
        return {
            "subjects": dict(sorted(self.states.items())),
            "asked": sorted(k for k, v in self.states.items() if v == ASKED),
            "insufficient": sorted(k for k, v in self.states.items() if v == INSUFFICIENT),
            "evidence_obtained": sorted(
                k for k, v in self.states.items() if v == EVIDENCE_OBTAINED
            ),
        }
