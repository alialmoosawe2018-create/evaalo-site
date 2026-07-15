"""Normalize assistant reply text before transcript display and TTS."""

from __future__ import annotations

import re

# Canonical Arabic brand spelling used across Evaalo reception agents.
CANONICAL_AR_BRAND = "ایڤالو"

# Wrong spellings often produced by the LLM (Latin v, hamza variants, etc.).
_AR_BRAND_WRONG = (
    "ایvالo",
    "ایVالo",
    "ایvالO",
    "ایVالO",
    "ایvالو",
    "ایVالو",
    "إيفالo",
    "إيفالO",
    "إيفالو",
    "ايفالo",
    "ايفالO",
    "ايفالو",
    "إivalo",
    "إiValo",
    "Evaalo",  # only replaced when reply is Arabic (see below)
)

_ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")
_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")


def _contains_arabic_script(text: str) -> bool:
    return bool(_ARABIC_SCRIPT_RE.search(text))


def normalize_reception_reply(text: str) -> str:
    """Fix common LLM spelling mistakes in reception replies."""
    if not text:
        return text

    out = text
    for wrong in _AR_BRAND_WRONG:
        if wrong == "Evaalo":
            if _contains_arabic_script(out):
                out = out.replace(wrong, CANONICAL_AR_BRAND)
            continue
        out = out.replace(wrong, CANONICAL_AR_BRAND)

    # Latin letter v accidentally mixed into Arabic brand (e.g. ایvالو).
    out = re.sub(r"ای\s*[vV]\s*الو", CANONICAL_AR_BRAND, out)
    out = re.sub(r"[إا]\s*[iI]\s*[vV]\s*الو", CANONICAL_AR_BRAND, out)

    out = _MULTI_SPACE_RE.sub(" ", out)
    return out.strip() if out != text else out
