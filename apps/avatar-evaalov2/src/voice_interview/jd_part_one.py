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


# The owner's wording (2026-10-04) for the two fixed lines of part one. The
# follow-up is NOT fixed: it is written per answer (see below).
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


def jd_greeting_lead(language: str) -> str:
    return _GREETING_LEAD["en" if language == "en" else "ar"]


def jd_transition_line(language: str) -> str:
    return _TRANSITION["en" if language == "en" else "ar"]


# The transition already says «خلّينا نحچي عن»; a question opening with the same
# words right after it would repeat them. «حچيلي عن» takes the same noun.
_SAME_OPENER = re.compile(r"^\s*خل[ّ]?ينا\s+نحچي\s+عن\s+")


def without_transition_echo(question: str) -> str:
    return _SAME_OPENER.sub("حچيلي عن ", question or "", count=1)


# ── The one follow-up: written per answer, or none ───────────────────────────
#
# Owner (2026-10-04): the follow-up must come from the question and from what the
# candidate just said — «وإذا السجلين مختلفين، شلون راح تحدد الصحيح؟» after an
# answer about comparing records — never one fixed line, and never a generic probe.
# One at most per question, in the same situation and the future tense; when the
# answer gives nothing worth probing, the interview moves to the next question.
#
# A separate, small model call decides it. It is shown the question and the answer
# ONLY — never the next question: shown it, the model asked THAT instead of a
# follow-up in 12 of 12 real runs.

def jd_followup_timeout_s() -> float:
    raw = (os.getenv("INTERVIEW_JD_FOLLOWUP_TIMEOUT_S") or "").strip()
    try:
        n = float(raw) if raw else 4.0
    except ValueError:
        n = 4.0
    return max(1.0, min(10.0, n))


# Rules, not examples: literal example content in an LLM rule leaks into outputs.
_FOLLOWUP_SYSTEM = {
    "ar": "\n".join(
        [
            "You are a job interviewer. The candidate was asked ONE situational question about a work "
            "situation (what they WILL do), and has just answered it.",
            "Write ONE short follow-up question, in natural spoken Iraqi Arabic, that probes something "
            "SPECIFIC the candidate just said — a step they named, a choice they made, a detail they skipped.",
            "Stay inside the same situation and keep it about what they WILL do: use «راح» "
            "(«شلون راح…» / «شنو راح…»). Never ask about their past or their experience.",
            "One ask only, one question mark at the end, at most 15 words. Not a yes/no question. "
            "No new topic, no restating the original question, no praise or summary.",
            "If the answer gives nothing specific worth probing — too short, off the point, or already "
            "complete — reply exactly: NONE",
        ]
    ),
    "en": "\n".join(
        [
            "You are a job interviewer. The candidate was asked ONE situational question about a work "
            "situation (what they WOULD do), and has just answered it.",
            "Write ONE short follow-up question in plain spoken English that probes something SPECIFIC the "
            "candidate just said — a step they named, a choice they made, a detail they skipped.",
            "Stay inside the same situation and keep it about what they WOULD do. Never ask about their "
            "past or their experience.",
            "One ask only, one question mark at the end, at most 15 words. Not a yes/no question. "
            "No new topic, no restating the original question, no praise or summary.",
            "If the answer gives nothing specific worth probing — too short, off the point, or already "
            "complete — reply exactly: NONE",
        ]
    ),
}


# The follow-up is said as written, so it must address the candidate as the rest of
# the interview does: feminine only when the candidate is known to be female.
# Real model, 2026-10-04: one follow-up in 36 used a feminine verb for a candidate
# of unknown gender.
_ADDRESS_AR = {
    "female": "Address the candidate with feminine second-person forms.",
    "": "Address the candidate with masculine second-person forms (the default address).",
}


def build_jd_followup_messages(
    question: str, answer: str, language: str, gender: str = ""
) -> list[tuple[str, str]]:
    """The decision prompt: the question and the answer — nothing else."""
    lang = "en" if language == "en" else "ar"
    system = _FOLLOWUP_SYSTEM[lang]
    if lang == "ar":
        system = f"{system}\n{_ADDRESS_AR['female' if gender == 'female' else '']}"
    user = f"<question>\n{question.strip()}\n</question>\n<answer>\n{answer.strip()[:1200]}\n</answer>"
    return [("system", system), ("user", user)]


_PAST_AR = re.compile(
    r"(سويت|سويته|سويتها|عملت|واجهت|واجهته|واجهتها|صار\s+وياك|صارت\s+وياك|مر\s+عليك|مرّ\s+عليك|مرت\s+عليك|"
    r"اشتغلت|خبرتك|تجربتك|شغلك\s+السابق|بشركتك\s+السابقة|كنت\s+ت)"
)
_PAST_EN = re.compile(r"\b(did you|have you ever|in your (last|previous)|your experience|you've had)\b", re.I)
_YESNO_AR = re.compile(r"^(و?هل|عندك|اكو|أكو)\b")
# Whole words only, so «شوية» is not «شو». Real model, 2026-10-04: «…، وشو راح
# تتأكد…؟» slipped past a list without «شو».
_WH_AR = r"(?:شلون|اشلون|شنو|شو|ايش|إيش|كيف|ليش|وين|منو|متى|شكد|اشكد|شگد|هل)(?!\w)"
_TWO_ASKS_AR = re.compile(r"(?<!\w)و?" + _WH_AR + r"[^؟?]{2,}?\sو" + _WH_AR)
# The dialect rule the description questions pass on the backend
# (jdInterviewQuestions.ts arabicLevantine + arabicMsa), same lists. Real model,
# 2026-10-04: «وشو», «هناك» and «قمت بيها» reached a written follow-up.
_AR_LETTERS = re.compile("[ء-يٱ-ۓ]+")
_AR_DIACRITICS = re.compile("[ً-ْٰـ]")
_AR_LEVANTINE_WORDS = frozenset({"شو", "ايش", "ايشو", "كيف"})
_AR_LEVANTINE_RE = (
    re.compile(r"^(?:ا|ت|ن|ب|بت)?حك(?:ي)?(?:لي|يلي|لنا|ني|ينا|نا|ولي|و|وا|ت|يت)?$"),  # noqa: RUF001
    re.compile(r"^(?:ا|ت|ن)?حجي(?:لي|ني|نا|يلي)?$"),  # noqa: RUF001
)
_AR_MSA_MARKERS = ("تحدث عن", "ما هي", "كيف قمت", "التي", "الذي", "ماذا")
_AR_NON_IRAQI_RE = re.compile(
    r"(قد\s+قمت|قمت\s+ب|(^|\s)قمت(\s|$)|عملتها|عملته|(^|\s)عملت(\s|$)|بتعمل|(^|\s)تعمل(\s|$)|إزاي|ازاي|"
    r"هلق|هلأ|هيك|علشان|عشان|اتعاملت|(^|\s)هناك(\s|$)|(^|\s)جاء(\s|$)|اتخذتها)"
)


def _fold_ar(text: str) -> str:
    text = re.sub("[أإآٱ]", "ا", text).replace("ى", "ي").replace("ة", "ه")  # noqa: RUF001
    return _AR_DIACRITICS.sub("", text).lower()


def _arabic_not_iraqi(text: str) -> bool:
    folded = _fold_ar(text)
    for tok in _AR_LETTERS.findall(folded):
        forms = (tok, tok[1:] if tok[:1] in ("و", "ف") else tok)
        if any(f in _AR_LEVANTINE_WORDS or any(r.match(f) for r in _AR_LEVANTINE_RE) for f in forms):
            return True
    if any(_fold_ar(m) in folded for m in _AR_MSA_MARKERS):
        return True
    # Punctuation as a space, so «هناك؟» meets the same word boundary as «هناك ».
    return bool(_AR_NON_IRAQI_RE.search(re.sub(r"[؟?،,.!]", " ", text)))
_WH_EN = "(how|what|why|which|who|where|when)"
_TWO_ASKS_EN = re.compile(r"\b" + _WH_EN + r"\b[^?]*\band\s+" + _WH_EN + r"\b", re.I)
_YESNO_EN = re.compile(r"^(do|does|did|have|has|had|is|are|was|were|can|could|would|will|should)\b", re.I)


def clean_jd_followup(raw: str, language: str, avoid: list[str], answer: str = "") -> str:
    """The model's follow-up if it is usable, else "" (the interview moves on).

    ``avoid`` holds the description questions: a "follow-up" that is really one of
    them restated (or the next one recited) is not a follow-up. With ``answer``, a
    follow-up must pick up at least one word the candidate said — otherwise it was
    invented, not a follow-up (owner, 2026-10-04: no useful follow-up → the next
    question). Real model, 2026-10-04: to «أتعامل ويا الموضوع باحترافية» it wrote
    a new twist («…إذا الموظف كان متوتر؟») in 6 of 12 calls.
    """
    from voice_interview.subject_coverage import (
        shared_term_count,  # local: no import cycle
    )

    text = " ".join(str(raw or "").replace("«", "").replace("»", "").split()).strip().strip('"').strip()
    if not text or text.upper().startswith("NONE"):
        return ""
    marks = text.count("؟") + text.count("?")
    if marks != 1 or not text.endswith(("؟", "?")):
        return ""
    if len(text.split()) > 22:
        return ""
    lang = "en" if language == "en" else "ar"
    if detect_lang_from_text(text) not in (None, lang):
        return ""
    if lang == "ar":
        if (
            "راح" not in text
            or _PAST_AR.search(text)
            or _YESNO_AR.match(text)
            or _TWO_ASKS_AR.search(text)
            or _arabic_not_iraqi(text)
        ):
            return ""
    else:
        if (
            not re.search(r"\b(would|will)\b|'d\b", text, re.I)
            or _PAST_EN.search(text)
            or _YESNO_EN.match(text)
            or _TWO_ASKS_EN.search(text)
        ):
            return ""
    for q in avoid:
        total = shared_term_count(q, q)
        if total and shared_term_count(q, text) / total >= 0.5:
            return ""
    if answer and shared_term_count(text, answer) < 1:
        return ""
    return text


# Plan sources that are a follow-up to the question on the table, not a new subject.
JD_FOLLOWUP_SOURCES = frozenset(
    {
        "jd_followup",
        "follow_up_on_active",
        "hook_followup",
        "entity_followup",
        "competency_followup",
        "correction_followup",
        "result_followup",
    }
)
