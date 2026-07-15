"""Reception Agent: Evaalo demo host — ElevenLabs routing + sticky bilingual replies."""

from __future__ import annotations

import logging
import os
import time
from collections.abc import AsyncIterable
from typing import Any

from livekit import rtc
from livekit.agents import Agent, ModelSettings
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.voice.io import TimedString

from reception.config import env_allow_interruption, tts_reply_prefetch_max_chars
from reception.knowledge import append_knowledge_to_instructions
from reception.reply_normalizer import normalize_reception_reply
from reception.lang import (
    detect_lang_from_text,
    detect_lang_reply_fallback,
    detect_language_switch_intent,
)

logger = logging.getLogger("agent")


async def _normalize_text_stream(text: AsyncIterable[str]) -> AsyncIterable[str]:
    async for chunk in text:
        if not chunk:
            continue
        normalized = normalize_reception_reply(chunk)
        if normalized:
            yield normalized


_BASE_RECEPTION_INSTRUCTIONS = """You are Evaalo's virtual visual reception host for a short interactive demo call.

Core identity:
You represent Evaalo, an HR-focused AI Hiring Intelligence Platform.
Evaalo helps companies screen, interview, evaluate, compare, and manage candidates through a structured AI-assisted hiring workflow.

Your role:
- Welcome visitors warmly and professionally.
- Explain what Evaalo does in simple, clear language.
- Answer general questions about Evaalo's HR platform and services.
- Guide interested visitors toward sales, support, or the appropriate team.
- Collect basic information when useful: name, company, email, and reason for contacting Evaalo.
- Keep the experience natural, human-like, and concise because this is a visual reception demo.

Refer to the EVAALO HR KNOWLEDGE BASE section below for Evaalo product details, services, hiring workflow, and FAQ.

Responsible positioning:
- Evaalo does not replace HR teams.
- Evaalo supports HR teams with structured insights, reports, summaries, recommendations, and comparisons.
- The final hiring decision remains with the employer or HR team.
- Do not claim guaranteed hiring outcomes.
- Do not provide legal guarantees.

Personality:
Professional, approachable, confident, and warm. Natural and human, not robotic. Friendly but concise.

Voice style:
- For greetings or simple questions, answer in one or two short sentences.
- For service explanations, answer in two to four concise sentences.
- Finish your thought; never stop mid-sentence.
- Avoid filler, repetition, and long lectures.
- Since this is a visual reception experience, sound welcoming and clear.

Audio / hearing check:
- If the visitor asks whether you can hear them (e.g. "هل تسمع صوتي؟", "هل تسمعني؟", "Can you hear me?"), confirm clearly and briefly. In Arabic: "نعم، أسمع صوتك بوضوح." In English: "Yes, I can hear you clearly." Then invite them to continue.
- Do not explain STT, microphones, or technical details.

Formatting:
Each assistant turn must be exactly one paragraph. No bullet lists read aloud, no multiple paragraphs. Always end on a complete sentence with proper punctuation.
Never use digits, numbered lists, or ordinal enumeration (first, second, step one, "three services," "أول شي", "ثاني شي", etc.) in spoken replies. Explain only in flowing narrative prose — connect ideas with natural conjunctions, without counting items.

Arabic spelling (mandatory when replying in Arabic):
- Always write the platform name exactly as: ایڤالو (with ڤ). Never use Latin letters inside the Arabic brand (wrong: ایvالو). Never use إيفالو or ايفالو.
- Do not mix Latin v/V inside Arabic words.

Language rules:
- Always respond in the visitor's current language: the language of their most recent full message.
- Arabic messages that include English product terms like HR, Screening, Voice Interview, Video Interview, or Evaalo still require an Arabic reply.
- Only switch fully to English when the visitor's last utterance is entirely English or they explicitly ask to switch languages.
- A language switch persists until they switch back.
- When in doubt, mirror the user's last sentence language.

Pronunciation:
- Say Evaalo naturally as Evaalo in English or ایڤالو in Arabic (never إيفالو or ایvالo).
- Do not spell brand names letter by letter.
- Do not use quotes, asterisks, emojis, or special symbols in spoken replies.

Forbidden:
- Do not conduct job interviews with the visitor.
- Do not ask candidate evaluation questions.
- Do not evaluate or judge the visitor.
- Do not make hiring acceptance or rejection decisions.
- Do not invent pricing, SLAs, legal commitments, named customers, or unsupported claims.
- Do not present Evaalo as a general AI agents company. The main focus is HR, recruiting, screening, interviews, and candidate evaluation.
- Never mention question banks, scoring internals, or internal implementation details."""

_DIALECT_MSA = """Arabic style: Modern Standard Arabic (الفصحى) only. Avoid colloquial words. Examples: "ماذا"، "كيف"، "الآن"، "هل"، "أنا"، "نحن". Keep verbs in MSA conjugation."""

_DIALECT_IRAQI_LIGHT = """Arabic style: MSA-leaning Iraqi (لهجة عراقية مهنية خفيفة). Stay professional but warm. Use sparingly:
- Question words: "شنو" instead of "ماذا"; "شلون" instead of "كيف"; "وين" instead of "أين"; "ليش" instead of "لماذا".
- Pronouns: "آني" / "إحنا" / "انته" / "انتي" are acceptable.
- Connectors: "هسه" (الآن) ، "كلش" ، "ماكو" ، "اكو" — use 1–2 per turn.
- Prefer Iraqi pronouns + MSA syntax over heavy slang."""

_DIALECT_IRAQI_FULL = """Arabic style: Iraqi colloquial (بغدادية). Natural everyday Iraqi: شنو، شلون، وين، ليش، هسه، كلش، ماكو، اكو. Stay polite."""

_DIALECT_PROFILES = {
    "msa": _DIALECT_MSA,
    "iraqi_light": _DIALECT_IRAQI_LIGHT,
    "iraqi": _DIALECT_IRAQI_FULL,
}


def _resolve_dialect_block() -> str:
    raw = (os.getenv("RECEPTION_DIALECT") or "iraqi_light").strip().lower()
    profile = _DIALECT_PROFILES.get(raw)
    if profile is None:
        logger.warning(
            "Unknown RECEPTION_DIALECT=%r — falling back to iraqi_light. Valid: msa|iraqi_light|iraqi",
            raw,
        )
        profile = _DIALECT_IRAQI_LIGHT
    return f"""═══════════════════════════════════════════════════════════════
ARABIC DIALECT PROMPT (active profile: {raw})
═══════════════════════════════════════════════════════════════
{profile}

This dialect block applies ONLY when responding in Arabic. When responding in
English, ignore it entirely and use natural professional English."""


def _default_reception_instructions() -> str:
    return f"""═══════════════════════════════════════════════════════════════
BASE PROMPT (Persona, Voice rules, Language rules)
═══════════════════════════════════════════════════════════════
{_BASE_RECEPTION_INSTRUCTIONS}

{_resolve_dialect_block()}"""


class TtsRouteContext:
    """Shared ElevenLabs voice/language routing for user transcripts and agent TTS."""

    def __init__(
        self,
        tts: Any,
        *,
        arabic_voice_id: str,
        english_voice_id: str,
        supports_override: bool,
        cooldown_ms: float,
        initial_voice_id: str,
        initial_language: str,
    ) -> None:
        self.tts = tts
        self.arabic_voice_id = arabic_voice_id
        self.english_voice_id = english_voice_id
        self.supports_override = supports_override
        self.cooldown_ms = cooldown_ms
        self.current_voice_id = initial_voice_id
        self.current_language = initial_language
        self.last_route_ts = 0.0
        self._last_applied_detected: str | None = (
            initial_language if initial_language in ("ar", "en") else None
        )
        self.last_user_lang: str | None = None

    def apply(self, detected: str, *, force: bool = False, source: str = "user") -> None:
        target_vid = self.arabic_voice_id if detected == "ar" else self.english_voice_id
        need_update = (target_vid != self.current_voice_id) or (
            self.supports_override and detected != self.current_language
        )
        if not need_update:
            return
        now = time.monotonic() * 1000.0
        if (
            not force
            and (now - self.last_route_ts) < self.cooldown_ms
            and detected == self._last_applied_detected
        ):
            logger.debug(
                "TTS routing skipped (cooldown %.0fms, duplicate lang=%s)",
                self.cooldown_ms,
                detected,
            )
            return
        try:
            uk: dict[str, Any] = {"voice_id": target_vid}
            if self.supports_override:
                uk["language"] = detected
            self.tts.update_options(**uk)
            self.current_voice_id = target_vid
            if self.supports_override:
                self.current_language = detected
            self.last_route_ts = now
            self._last_applied_detected = detected
            logger.debug("TTS routing [%s] -> lang=%s voice=%s", source, detected, target_vid)
        except Exception as ex:
            logger.warning("TTS routing failed: %s", ex)


def tts_router_aligned_with_stream(r: TtsRouteContext) -> bool:
    """True when voice/lang already match stream — skip prefetch for lower avatar jitter."""
    if r.current_voice_id == r.english_voice_id:
        return (not r.supports_override) or (r.current_language == "en")
    if r.current_voice_id == r.arabic_voice_id:
        return (not r.supports_override) or (r.current_language == "ar")
    return False


class ReceptionAssistant(Agent):
    """Routes ElevenLabs voice by reply text before TTS; sticky bilingual behavior."""

    def __init__(
        self,
        *,
        tts_router: TtsRouteContext,
        allow_interruptions: bool | None = None,
        reception_context: str | None = None,
    ) -> None:
        ai = (
            allow_interruptions
            if allow_interruptions is not None
            else env_allow_interruption()
        )
        self._tts_router = tts_router
        # Sticky reply-language lock. Set by an explicit visitor request ("speak
        # in English", "بالعربي لو سمحت") and cleared only by an opposite
        # explicit request — so a single short confirmation in the other
        # language ("نعم", "ok") cannot regress the language. ``None`` = follow
        # ``last_user_lang``.
        self._locked_lang: str | None = None
        raw_instr = (os.getenv("RECEPTION_AGENT_INSTRUCTIONS") or "").strip()
        instructions = raw_instr if raw_instr else _default_reception_instructions()
        extra = (os.getenv("RECEPTION_AGENT_INSTRUCTIONS_EXTRA") or "").strip()
        if extra:
            instructions = f"{instructions}\n{extra}"
        instructions = append_knowledge_to_instructions(instructions)
        ctx = (reception_context or "").strip()
        if ctx:
            instructions = (
                f"{instructions}\n\n═══════════════════════════════════════════════════════════════\n"
                f"VISITOR SESSION CONTEXT\n"
                f"═══════════════════════════════════════════════════════════════\n"
                f"{ctx}"
            )
        super().__init__(
            instructions=instructions,
            allow_interruptions=ai,
        )

    def _reply_language_directive(self) -> str:
        """Build an explicit language directive for the LLM.

        Priority order:
          1. ``_locked_lang`` — set by an explicit visitor request to switch
             (e.g. "let's speak in English", "بالعربي لو سمحت"). Stays in force
             until an opposite explicit request is received.
          2. ``tts_router.last_user_lang`` — language of the visitor's last
             utterance; used only when no explicit lock is active.
          3. Generic mirror-the-last-sentence fallback.

        Treats explicit switch requests as sticky so a single short confirmation
        in the other language ("نعم", "ok") cannot flip the reply language.
        """
        if self._locked_lang == "en":
            return (
                "REPLY LANGUAGE: English. The visitor explicitly asked to continue in English. "
                "Reply ONLY in English from now on, even if their next message contains Arabic "
                "brand names (e.g. 'ایڤالو'), proper nouns, or short Arabic phrases. Continue in "
                "English until they explicitly ask to switch back to Arabic. "
                "Do NOT switch back on a short Arabic confirmation like 'نعم', 'تمام', or 'ok'."
            )
        if self._locked_lang == "ar":
            return (
                "REPLY LANGUAGE: Arabic. The visitor explicitly asked to continue in Arabic. "
                "Reply ONLY in Arabic using the active dialect profile, even if their next "
                "message contains English loanwords or brand names. Continue in Arabic until "
                "they explicitly ask to switch back to English."
            )

        lang = (self._tts_router.last_user_lang or "").strip().lower() or None
        if lang == "en":
            return (
                "REPLY LANGUAGE: English. The visitor's most recent message is in English "
                "(possibly mentioning Arabic brand names like 'ایڤالو'). Answer in English; reuse "
                "those Arabic brand names verbatim or transliterate naturally — do NOT switch the "
                "whole reply to Arabic just because of one Arabic word."
            )
        if lang == "ar":
            return (
                "REPLY LANGUAGE: Arabic. The visitor's most recent message is in Arabic. "
                "Answer in Arabic using the active dialect profile."
            )
        return (
            "REPLY LANGUAGE: mirror the visitor's most recent FULL sentence language exactly. "
            "Do not infer language from earlier turns or from a single foreign loanword inside Arabic."
        )

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage
    ) -> None:
        """Set the sticky language lock (if requested) and inject the reply-language directive.

        Runs after STT-final, before LLM generation. Pure, sub-millisecond.
        """
        try:
            text = ""
            tc = getattr(new_message, "text_content", None)
            if callable(tc):
                text = tc() or ""
            else:
                content = getattr(new_message, "content", None)
                if isinstance(content, list):
                    text = " ".join(str(c) for c in content if isinstance(c, str))
                elif isinstance(content, str):
                    text = content

            try:
                intent = detect_language_switch_intent(text)
                if intent and intent != self._locked_lang:
                    self._locked_lang = intent
                    self._tts_router.last_user_lang = intent
                    try:
                        self._tts_router.apply(intent, force=True, source="explicit_switch")
                    except Exception as ex:
                        logger.debug("explicit_switch tts_router.apply failed: %s", ex)
                    logger.info(
                        "language_lock | locked=%s reason=explicit_user_request text=%r",
                        intent,
                        text[:80],
                    )
            except Exception as ex:
                logger.debug("language switch intent detection failed: %s", ex)

            try:
                detected_now = detect_lang_from_text(text) or detect_lang_reply_fallback(text)
                if detected_now:
                    self._tts_router.last_user_lang = detected_now
            except Exception:
                logger.debug("ratio-based language detection failed", exc_info=True)

            turn_ctx.add_message(role="system", content=self._reply_language_directive())
        except Exception as ex:
            logger.warning("on_user_turn_completed failed: %s", ex, exc_info=True)

    async def transcription_node(
        self,
        text: AsyncIterable[str | TimedString],
        model_settings: ModelSettings,
    ) -> AsyncIterable[str | TimedString]:
        streaming_raw = os.getenv("RECEPTION_TRANSCRIPT_STREAMING", "true")
        if streaming_raw.lower() not in (
            "0",
            "false",
            "no",
        ):
            async for item in Agent.default.transcription_node(self, text, model_settings):
                if isinstance(item, str):
                    yield normalize_reception_reply(item)
                else:
                    yield item
            return

        parts: list[str] = []
        async for delta in text:
            parts.append(str(delta))
        full = "".join(parts).strip()
        if not full:
            return
        collapsed = normalize_reception_reply(" ".join(full.split()))
        yield collapsed

    @staticmethod
    async def _prefetch_text_for_lang(text: AsyncIterable[str]) -> tuple[str, AsyncIterable[str]]:
        chunks: list[str] = []
        agen = text.__aiter__()
        combined = ""
        max_prefetch = tts_reply_prefetch_max_chars()
        try:
            while len(combined) < max_prefetch:
                try:
                    chunk = await agen.__anext__()
                except StopAsyncIteration:
                    break
                chunks.append(chunk)
                combined = "".join(chunks)
                if detect_lang_from_text(combined):
                    break
        except StopAsyncIteration:
            pass

        async def _replay() -> AsyncIterable[str]:
            for c in chunks:
                yield c
            async for rest in agen:
                yield rest

        return combined, _replay()

    async def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        # Locked language (explicit visitor request) wins over the last-utterance hint.
        hint: str | None = None
        hint_applied = False
        if self._locked_lang in ("ar", "en"):
            hint = self._locked_lang
            self._tts_router.apply(hint, force=True, source="locked_lang")
            hint_applied = True
        elif os.getenv("TTS_USE_LAST_USER_LANG_HINT", "true").lower() in ("1", "true", "yes"):
            hint = self._tts_router.last_user_lang
            if hint in ("ar", "en"):
                self._tts_router.apply(hint, force=True, source="user_lang_hint")
                hint_applied = True

        if os.getenv("AVATAR_SKIP_PREFETCH_WHEN_ROUTED", "true").lower() in (
            "1",
            "true",
            "yes",
        ) and tts_router_aligned_with_stream(self._tts_router) and not hint_applied:
            async for frame in Agent.default.tts_node(
                self, _normalize_text_stream(text), model_settings
            ):
                yield frame
            return

        combined, merged = await self._prefetch_text_for_lang(_normalize_text_stream(text))
        detected_primary = detect_lang_from_text(combined)
        detected_fallback = detect_lang_reply_fallback(combined)
        detected = detected_primary or detected_fallback
        # While the language is explicitly locked, never let detector noise on
        # the reply text override the locked voice — even if the LLM accidentally
        # produced a sentence in the other language.
        if self._locked_lang in ("ar", "en"):
            detected = self._locked_lang
        if detected:
            min_switch_chars_raw = (os.getenv("TTS_REPLY_EN_SWITCH_MIN_CHARS") or "").strip()
            try:
                min_switch_chars = int(min_switch_chars_raw) if min_switch_chars_raw else 18
            except ValueError:
                min_switch_chars = 18
            min_switch_chars = max(6, min(128, min_switch_chars))

            if hint == "ar" and detected == "en":
                if detected_primary != "en":
                    logger.debug(
                        "TTS reply routing: keep AR voice (fallback-only EN detect, text=%r)",
                        combined[:80],
                    )
                    detected = "ar"
                elif len(combined) < min_switch_chars:
                    logger.debug(
                        "TTS reply routing: defer EN switch (%d < min %d chars, text=%r)",
                        len(combined),
                        min_switch_chars,
                        combined[:80],
                    )
                    detected = "ar"

            self._tts_router.apply(detected, force=True, source="reply")
        async for frame in Agent.default.tts_node(self, merged, model_settings):
            yield frame
