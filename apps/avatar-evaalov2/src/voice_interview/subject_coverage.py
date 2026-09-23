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

import os
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

# Arabic clitics that glue onto a noun: «بتنسيق», «والسياسات», «للمرشحين».
_AR_CLITICS = ("وال", "بال", "فال", "كال", "لل", "ال", "و", "ب", "ف", "ك", "ل")
# Plural / feminine endings: «مقابلات» and «مقابلة» are one subject.
_AR_SUFFIXES = ("ات", "ين", "ون", "ه")  # noqa: RUF001 — Arabic, not Latin look-alikes
_ALEF_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})  # noqa: RUF001
_AR_LONG_VOWELS = str.maketrans("", "", "اوي")


def _is_latin(word: str) -> bool:
    return word.isascii()


def _skeleton(word: str) -> str:
    """Drop Arabic long vowels after the first letter: «تنسيق» and «تنسق» meet."""
    if _is_latin(word) or len(word) < 2:
        return word
    return word[0] + word[1:].translate(_AR_LONG_VOWELS)


def _subject_terms(text: str) -> list[set[str]]:
    """Each content word of ``text`` as the set of forms it may appear in.

    Two-letter words are dropped: in Arabic they are function words («مع», «او»)
    and matching on them marked «التواصل مع المرشحين» as already asked because
    an earlier question said «مقابلة مع مرشح».
    """
    out: list[set[str]] = []
    for token in content_tokens(text):
        tok = token.translate(_ALEF_MAP)
        if len(tok) < 3:
            continue
        if _is_latin(tok):
            out.append({tok})
            continue
        forms = {tok}
        frontier = [tok]
        for _ in range(2):  # «وبالتنسيق» needs two strips
            frontier = [
                t[len(p) :] for t in frontier for p in _AR_CLITICS
                if t.startswith(p) and len(t) - len(p) >= 3
            ]
            forms.update(frontier)
        forms.update(
            f[: -len(s)] for f in list(forms) for s in _AR_SUFFIXES
            if f.endswith(s) and len(f) - len(s) >= 3
        )
        out.append({_skeleton(f) for f in forms})
    return out


def _same_term(a: set[str], b: set[str]) -> bool:
    """One word, possibly inflected: «مرشح»/«مرشحين», interview/interviews."""
    for x in a:
        for y in b:
            if x == y:
                return True
            short, long_ = (x, y) if len(x) <= len(y) else (y, x)
            if _is_latin(x) and _is_latin(y):
                # coordination / coordinating share everything but the ending.
                shared = len(os.path.commonprefix([x, y]))
                if shared >= 4 and shared >= 0.75 * len(short):
                    return True
            elif len(short) >= 3 and long_.startswith(short) and len(long_) - len(short) <= 2:
                return True
    return False


def subject_already_asked(subject: str, asked_questions: Iterable[str]) -> bool:
    """True when a question the candidate already heard named this subject.

    Two of the subject's words in one earlier question (one, if the subject is a
    single word). Deliberately about what was SPOKEN, not about which bank a
    question came from — the candidate hears a repeat either way.
    """
    terms = _subject_terms(subject)
    if not terms:
        return False
    need = min(2, len(terms))
    for question in asked_questions:
        heard = _subject_terms(question)
        if not heard:
            continue
        hits = sum(1 for term in terms if any(_same_term(term, h) for h in heard))
        if hits >= need:
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
