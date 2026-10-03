"""Part one of the video interview — three opening questions from the job description.

The backend writes the questions once per campaign (the recruiter saw and may have
edited them) and sends them in the dispatch metadata as ``jd_questions``. When they
are present, valid and switched on, they take the place of the blueprint's three
anchor questions; the competencies then drive the rest exactly as before.

Everything here is fail-open: a missing key, a malformed set, the wrong language or
the switch off all return no questions, and the interview runs as it does today.
Three questions or none — a candidate never hears two where another heard three.

Pure functions only (no LiveKit, no I/O), so the rules are testable on their own.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from voice_interview.lang import detect_lang_from_text

logger = logging.getLogger("agent")

JD_QUESTION_COUNT = 3
_MAX_QUESTION_CHARS = 600


def jd_part_one_enabled() -> bool:
    """``INTERVIEW_JD_PART1`` — off unless set. A NEW key: it is not one of the
    July secrets whose values cannot be read back, so its default is the code's."""
    raw = (os.getenv("INTERVIEW_JD_PART1") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def jd_max_followups() -> int:
    """Follow-ups allowed after each opening question (owner: at most one)."""
    raw = (os.getenv("INTERVIEW_JD_MAX_FOLLOWUPS") or "").strip()
    try:
        n = int(raw) if raw else 1
    except ValueError:
        n = 1
    return max(0, min(2, n))


def jd_part_one_max_turns() -> int:
    """Safety net: agent utterances part one may take before the competencies
    start, whatever is left of it (three questions, one follow-up each and a
    clarification or two fit in eight)."""
    raw = (os.getenv("INTERVIEW_JD_PART1_MAX_TURNS") or "").strip()
    try:
        n = int(raw) if raw else 8
    except ValueError:
        n = 8
    return max(JD_QUESTION_COUNT, min(12, n))


@dataclass(frozen=True)
class JdQuestion:
    id: str
    question: str
    clarify_hint: str
    duty: str


def _has_question_mark(text: str) -> bool:
    return "؟" in text or "?" in text


def parse_jd_questions(meta: dict[str, Any], session_lang: str | None) -> list[JdQuestion]:
    """The three questions from ``meta["jd_questions"]``, or ``[]``.

    ``session_lang`` is the interview's locked language (``"ar"``/``"en"``) when
    the backend sent one. Each question must be in that language; with no lock,
    the three must at least agree with each other.
    """
    raw = meta.get("jd_questions") if isinstance(meta, dict) else None
    if not raw:
        return []
    try:
        items = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:  # malformed metadata is a no-op, never a crash
        logger.warning("jd_questions: unreadable (%s) — part one off for this session", e)
        return []
    if not isinstance(items, list) or len(items) != JD_QUESTION_COUNT:
        logger.warning("jd_questions: expected %d questions — part one off", JD_QUESTION_COUNT)
        return []
    out: list[JdQuestion] = []
    langs: set[str] = set()
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            return _reject("an item is not an object")
        question = str(item.get("question") or "").strip()
        hint = str(item.get("clarifyHint") or item.get("clarify_hint") or "").strip()
        duty = str(item.get("duty") or "").strip()[:200]
        if not question or len(question) > _MAX_QUESTION_CHARS or not _has_question_mark(question):
            return _reject(f"question {i + 1} is empty, too long or not a question")
        if not hint or len(hint) > _MAX_QUESTION_CHARS:
            return _reject(f"question {i + 1} has no clarification")
        lang = detect_lang_from_text(question)
        if lang not in ("ar", "en"):
            return _reject(f"question {i + 1}: language unclear")
        langs.add(lang)
        out.append(JdQuestion(id=f"q{i + 1}", question=question, clarify_hint=hint, duty=duty))
    if len(langs) != 1:
        return _reject("the questions are not all in one language")
    if session_lang in ("ar", "en") and langs != {session_lang}:
        return _reject(f"questions are {next(iter(langs))}, the interview is {session_lang}")
    if len({q.question for q in out}) != JD_QUESTION_COUNT:
        return _reject("two questions are the same")
    return out


def _reject(reason: str) -> list[JdQuestion]:
    logger.warning("jd_questions: %s — part one off for this session", reason)
    return []


def jd_language(questions: list[JdQuestion]) -> str:
    return (detect_lang_from_text(questions[0].question) or "ar") if questions else ""


_AR_CLAUSE_SPLIT = re.compile(r"[،,]")
_EN_CLAUSE_SPLIT = re.compile(r",")


def jd_clarification(q: JdQuestion, language: str) -> str:
    """What the interviewer says when the candidate asks what an opening question means.

    The recruiter-approved clarification sentence (one more concrete example of the
    same situation), then the question's own ask again: «يعني مثلاً …، شلون راح
    تتصرف؟». The ask is the question's last clause; when it cannot be told apart,
    the whole question follows the example.
    """
    hint = q.clarify_hint.strip().rstrip(".؟?!،,").strip()
    question = q.question.strip()
    if language == "en":
        parts = [p.strip() for p in _EN_CLAUSE_SPLIT.split(question) if p.strip()]
        ask = parts[-1] if len(parts) > 1 and _has_question_mark(parts[-1]) else question
        lead = hint if re.match(r"(?i)^(for example|e\.g\.|for instance)", hint) else f"For example, {hint[:1].lower()}{hint[1:]}"
        return f"{lead}. {ask[:1].upper()}{ask[1:]}"
    parts = [p.strip() for p in _AR_CLAUSE_SPLIT.split(question) if p.strip()]
    ask = parts[-1] if len(parts) > 1 and _has_question_mark(parts[-1]) else question
    lead = hint if hint.startswith("يعني") else f"يعني {hint}"
    return f"{lead}، {ask}"


# The owner's wording (2026-10-04) for the three fixed lines of part one.
#
# Greeting lead: after «حياك الله <name>،», before question 1 (replaces «نبدأ من
# خبرتك العملية», which promised a question about the past).
_GREETING_LEAD = {
    "ar": "خلّينا نبدأ بموقف بسيط من الشغل.",
    "en": "Let's start with a simple situation from work.",
}
# Transition: spoken once, before the first question after part one. A statement
# (no «؟»), added after the opener guard has run, so nothing rewrites it.
_TRANSITION = {
    "ar": "هسه خلّينا نحچي عن خبرتك وطريقة شغلك بشكل عام.",
    "en": "Now let's talk about your experience and the way you work in general.",
}
# The one follow-up a description question gets: it stays in the situation the
# question described («تتوقع»), where the generic probes asked about the past.
_FOLLOWUP = {
    "ar": "شنو تتوقع يكون أصعب جزء بهالموقف؟",
    "en": "What do you expect would be the hardest part of that situation?",
}


def jd_greeting_lead(language: str) -> str:
    return _GREETING_LEAD["en" if language == "en" else "ar"]


def jd_transition_line(language: str) -> str:
    return _TRANSITION["en" if language == "en" else "ar"]


def jd_followup_line(language: str) -> str:
    return _FOLLOWUP["en" if language == "en" else "ar"]


# The transition already says «خلّينا نحچي عن»; a question opening with the same
# words right after it would repeat them. «حچيلي عن» takes the same noun.
_SAME_OPENER = re.compile(r"^\s*خل[ّ]?ينا\s+نحچي\s+عن\s+")


def without_transition_echo(question: str) -> str:
    return _SAME_OPENER.sub("حچيلي عن ", question or "", count=1)


# Plan sources that are a follow-up to the question on the table, not a new subject.
JD_FOLLOWUP_SOURCES = frozenset(
    {
        "follow_up_on_active",
        "hook_followup",
        "entity_followup",
        "competency_followup",
        "correction_followup",
        "result_followup",
    }
)
