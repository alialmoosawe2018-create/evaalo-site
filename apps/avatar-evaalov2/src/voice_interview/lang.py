"""Arabic vs English detection for transcripts and agent replies.

Code-switching aware: a sentence like "عندي مهارة recruitment" is Arabic, not
English — even though the latin word is longer than each Arabic word.

Tunables (all optional):
    LANG_DETECT_AR_SHARE_FLOOR        Min Arabic share of script letters to
                                      classify as Arabic. Default: 0.35.
    LANG_DETECT_EN_MIN_LATIN_CHARS    Min latin letters required to classify a
                                      pure-latin utterance as English.
                                      Default: 8.
    LANG_DETECT_DEBUG                 If true, log (ar, lat, decision) per call.
                                      Default: false.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("agent")

_AR_RE = re.compile(r"[\u0600-\u06FF]")
_LAT_RE = re.compile(r"[A-Za-z]")


def _ar_share_floor() -> float:
    raw = (os.getenv("LANG_DETECT_AR_SHARE_FLOOR") or "").strip()
    if not raw:
        return 0.35
    try:
        v = float(raw)
    except ValueError:
        return 0.35
    return max(0.05, min(0.95, v))


def _en_min_latin_chars() -> int:
    raw = (os.getenv("LANG_DETECT_EN_MIN_LATIN_CHARS") or "").strip()
    if not raw:
        return 8
    try:
        v = int(raw)
    except ValueError:
        return 8
    return max(2, min(64, v))


def _debug_enabled() -> bool:
    return (os.getenv("LANG_DETECT_DEBUG") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _count_letters(text: str) -> tuple[int, int, int]:
    """Return ``(arabic_letters, latin_letters, total_letters)`` ignoring digits/punct."""
    ar = len(_AR_RE.findall(text))
    lat = len(_LAT_RE.findall(text))
    return ar, lat, ar + lat


# Arabic *letters* only (exclude Arabic punctuation like ؟ ، ؛ and Arabic-Indic
# digits, which live in the same 0600–06FF block and would false-positive on
# "Excel؟").
_AR_LETTER = r"[ء-يٱ-ۓ]"
_HYBRID_TOKEN_RE = re.compile(rf"[A-Za-z]{_AR_LETTER}|{_AR_LETTER}[A-Za-z]")


def contains_hybrid_latin_arabic_token(text: str) -> bool:
    """True if any token glues Latin and Arabic letters with no separator
    (e.g. "motivatesك") — a generation artifact, not a real loanword.

    Legitimate loanwords are space-separated ("عندي HR", "أستخدم Excel") and
    never match; only letters glued directly across scripts trigger it.
    """
    if not text:
        return False
    return bool(_HYBRID_TOKEN_RE.search(text))


def detect_lang_from_text(text: str) -> str | None:
    """Code-switching-aware dominant language classifier.

    Returns:
        ``"ar"``  — Arabic (possibly with English loanwords/brand names mixed in).
        ``"en"``  — Pure (or near-pure) English with no Arabic letters and a
                    substantial latin word count.
        ``None``  — Ambiguous / too short. Caller should keep the previous
                    language hint instead of switching.
    """
    if not text:
        return None
    ar, lat, total = _count_letters(text)
    if total == 0:
        if _debug_enabled():
            logger.debug("lang_detect | no letters in text=%r -> None", text[:40])
        return None

    decision: str | None = None

    if ar >= 2:
        ar_share = ar / total if total else 0.0
        if ar_share >= _ar_share_floor():
            decision = "ar"

    if decision is None and ar == 0 and lat >= _en_min_latin_chars():
        decision = "en"

    if _debug_enabled():
        logger.debug(
            "lang_detect | ar=%d lat=%d total=%d ar_share=%.2f decision=%s text=%r",
            ar,
            lat,
            total,
            (ar / total) if total else 0.0,
            decision,
            text[:60],
        )

    return decision


def detect_lang_reply_fallback(text: str) -> str | None:
    """Short replies where the ratio rule cannot decide: 'Okay.' / 'تمام'.

    Only fires when one script has zero letters of the other. This is what makes
    code-switching ("ok recruitment") fall through to ``None`` cleanly — both
    scripts present, neither side empty.
    """
    if not text or not text.strip():
        return None
    ar, lat, _ = _count_letters(text)
    if lat >= 1 and ar == 0:
        return "en"
    if ar >= 1 and lat == 0:
        return "ar"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Explicit language-switch intent detector
# ─────────────────────────────────────────────────────────────────────────────
# Recognizes phrases the user says to ASK for a language change, regardless of
# the carrier sentence's own language. Used to lock the assistant's reply
# language so a single short confirmation in the other language ("نعم", "ok")
# does not flip it back. See ``InterviewAssistant._locked_lang``.

_EN_INTENT_RE = re.compile(
    r"\b("
    r"in\s+english|to\s+english|english\s+please|english\s*,\s*please|"
    r"speak\s+(?:in\s+)?english|talk\s+(?:in\s+)?english|"
    r"switch\s+to\s+english|change\s+(?:to|into)\s+english|"
    r"continue\s+in\s+english|let'?s\s+(?:speak|continue|talk|go)\s+(?:in\s+)?english|"
    r"go\s+(?:on\s+)?in\s+english|use\s+english"
    r")\b",
    re.IGNORECASE,
)

_EN_INTENT_AR_RE = re.compile(
    r"("
    r"بال[إا]نج?ل?[يى]ز(?:ي|ية)?|"
    r"بال[إا]نك?ل?[يى]ز(?:ي|ية)?|"
    r"الإنجليزية|الانجليزية|الإنكليزية|الانكليزية|"
    r"إنجليزي|انجليزي|إنكليزي|انكليزي"
    r")"
)

_AR_INTENT_RE = re.compile(
    r"\b("
    r"in\s+arabic|to\s+arabic|arabic\s+please|arabic\s*,\s*please|"
    r"speak\s+(?:in\s+)?arabic|talk\s+(?:in\s+)?arabic|"
    r"switch\s+(?:to|back\s+to)\s+arabic|change\s+(?:to|into|back\s+to)\s+arabic|"
    r"back\s+to\s+arabic|continue\s+in\s+arabic|let'?s\s+(?:speak|continue|talk|go)\s+(?:in\s+)?arabic|"
    r"use\s+arabic"
    r")\b",
    re.IGNORECASE,
)

_AR_INTENT_AR_RE = re.compile(
    r"("
    r"بالعرب[يى](?:ة)?|بالعربية|العربية|"
    r"عرب[يى]\s*(?:فقط|من\s*فضلك|لو\s*سمحت|please)?|"
    r"رجوع\s*(?:إلى|لـ|الى)?\s*العربية|"
    r"نرجع\s*(?:إلى|لـ|الى)?\s*العرب"
    r")"
)


def detect_language_switch_intent(text: str) -> str | None:
    """Return ``'en'`` / ``'ar'`` when the user explicitly requests a switch, else ``None``.

    Matches both directions in either carrier language:
      * ``"can we speak in english"`` → ``'en'``
      * ``"ممكن نتكلم بالإنجليزي"``     → ``'en'``
      * ``"back to arabic please"``    → ``'ar'``
      * ``"بالعربي لو سمحت"``           → ``'ar'``

    English match is preferred when both directions match (e.g. mixed phrasing)
    because in practice the user usually says the target language name.
    """
    if not text or not text.strip():
        return None
    if _EN_INTENT_RE.search(text) or _EN_INTENT_AR_RE.search(text):
        return "en"
    if _AR_INTENT_RE.search(text) or _AR_INTENT_AR_RE.search(text):
        return "ar"
    return None
