from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("agent")


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


@lru_cache(maxsize=1)
def load_evaalo_knowledge() -> str:
    path = _knowledge_path()

    try:
        if not path.is_file():
            logger.warning("Reception knowledge file not found: %s", path)
            return ""

        text = path.read_text(encoding="utf-8").strip()
        if not text:
            logger.warning("Reception knowledge file is empty: %s", path)
            return ""

        max_chars = _knowledge_max_chars()
        if len(text) > max_chars:
            text = (
                text[:max_chars].rstrip()
                + "\n\n[Knowledge truncated for reception agent.]"
            )

        logger.info(
            "Reception knowledge loaded | path=%s chars=%d max=%d",
            path,
            len(text),
            max_chars,
        )
        return text

    except Exception as ex:
        logger.warning("Failed to load reception knowledge file: %s", ex)
        return ""


def append_knowledge_to_instructions(instructions: str) -> str:
    knowledge = load_evaalo_knowledge()
    if not knowledge:
        return instructions

    return f"""{instructions}

═══════════════════════════════════════════════════════════════
EVAALO HR KNOWLEDGE BASE
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
"""
