from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("agent")

_LANG_AR = "<!-- kb-lang:ar -->"
_LANG_EN = "<!-- kb-lang:en -->"


def _default_knowledge_path() -> Path:
    """Shared knowledge file — same source as voice + text reception agents."""
    return (
        Path(__file__).resolve().parent.parent.parent.parent
        / "backend"
        / "src"
        / "evaalo-only-voice-reception"
        / "data"
        / "evaalo_hr_knowledge.md"
    )


def _knowledge_path() -> Path:
    raw = (os.getenv("RECEPTION_KNOWLEDGE_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()

    return _default_knowledge_path()


def _knowledge_max_chars() -> int:
    raw = (os.getenv("RECEPTION_KNOWLEDGE_MAX_CHARS") or "12000").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 12000

    return max(2000, min(value, 25000))


def _extract_lang_section(raw: str, lang: str) -> str:
    marker = _LANG_AR if lang == "ar" else _LANG_EN
    other = _LANG_EN if lang == "ar" else _LANG_AR
    start = raw.find(marker)
    if start < 0:
        return raw.strip()
    body = raw[start + len(marker) :]
    nxt = body.find(other)
    if nxt >= 0:
        body = body[:nxt]
    return body.strip()


def _apply_max_chars(text: str, path: Path) -> str:
    max_chars = _knowledge_max_chars()
    if len(text) <= max_chars:
        return text
    logger.warning(
        "Reception knowledge truncated | path=%s chars=%d max=%d",
        path,
        len(text),
        max_chars,
    )
    return text[:max_chars].rstrip() + "\n\n[Knowledge truncated for reception agent.]"


@lru_cache(maxsize=4)
def load_evaalo_knowledge(language: str = "all") -> str:
    path = _knowledge_path()
    mode = (language or "all").strip().lower()
    if mode in ("english",):
        mode = "en"
    if mode in ("arabic", "ar-iq"):
        mode = "ar"

    try:
        if not path.is_file():
            logger.warning("Reception knowledge file not found: %s", path)
            return ""

        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            logger.warning("Reception knowledge file is empty: %s", path)
            return ""

        if mode == "ar":
            text = _extract_lang_section(raw, "ar")
        elif mode == "en":
            text = _extract_lang_section(raw, "en")
        else:
            ar = _extract_lang_section(raw, "ar")
            en = _extract_lang_section(raw, "en")
            text = f"{ar}\n\n---\n\n{en}" if ar and en and ar != en else (ar or en or raw)

        text = _apply_max_chars(text, path)
        logger.info(
            "Reception knowledge loaded | path=%s mode=%s chars=%d max=%d",
            path,
            mode,
            len(text),
            _knowledge_max_chars(),
        )
        return text

    except Exception as ex:
        logger.warning("Failed to load reception knowledge file: %s", ex)
        return ""


def append_knowledge_to_instructions(instructions: str, language: str = "all") -> str:
    knowledge = load_evaalo_knowledge(language)
    if not knowledge:
        return instructions

    header = (
        "EVAALO HR KNOWLEDGE BASE"
        if language in ("en", "english")
        else "قاعدة معرفة ایڤالو للموارد البشرية"
    )
    if language in ("all", "both", ""):
        header = "EVAALO HR KNOWLEDGE BASE (AR + EN)"

    return f"""{instructions}

═══════════════════════════════════════════════════════════════
{header}
═══════════════════════════════════════════════════════════════
{knowledge}

KNOWLEDGE USAGE RULES:
- Use this knowledge to answer visitor questions about Evaalo.
- Summarize naturally. Never read long sections aloud.
- For voice or visual replies, keep answers to 2–4 short sentences.
- If the visitor asks for many details, give a brief summary, then offer to connect them with the team.
- Do not read the document verbatim.
- Do not invent pricing, legal guarantees, named customers, or unsupported claims.
- Never use numbers, digits, numbered lists, bullet lists, or ordinal enumeration in replies. Explain only in flowing narrative prose.
- Reply in the visitor's current language. Use the matching language section of this knowledge base.
"""
