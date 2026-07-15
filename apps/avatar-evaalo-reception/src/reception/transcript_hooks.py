"""User transcript side-effects for AgentSession (TTS routing); keeps worker entrypoint thin."""

from __future__ import annotations

import logging
import os
import time

from livekit.agents import AgentSession, UserInputTranscribedEvent

from reception.assistant import TtsRouteContext
from reception.config import env_or
from reception.lang import (
    detect_lang_from_text,
    detect_lang_reply_fallback,
    detect_language_switch_intent,
)

logger = logging.getLogger("agent")


def attach_user_transcript_routing(
    session: AgentSession,
    tts_router: TtsRouteContext,
    *,
    reception_voice_defaults: bool,
) -> None:
    """Register user_input_transcribed: lang hint + optional ElevenLabs routing + manual commit."""
    last_transcript: str | None = None
    last_commit_ts = 0.0
    commit_cooldown_ms = float(os.getenv("USER_COMMIT_COOLDOWN_MS", "900"))
    # ElevenLabs route only — AgentSession still receives the full final STT string for the LLM reply.
    min_user_chars = int(os.getenv("MIN_USER_TRANSCRIPT_CHARS", "2" if reception_voice_defaults else "3"))
    # Short replies ("لا", "نعم", "ok") must pass through; floor keeps env from going too low by mistake.
    try:
        iv_floor = int(
            env_or(
                "MIN_USER_TRANSCRIPT_CHARS_RECEPTION_FLOOR",
                "MIN_USER_TRANSCRIPT_CHARS_INTERVIEW_FLOOR",
                default="2",
            )
        )
    except ValueError:
        iv_floor = 4
    iv_floor = max(2, min(12, iv_floor))
    if reception_voice_defaults and min_user_chars < iv_floor:
        logger.debug("MIN_USER_TRANSCRIPT_CHARS %d -> %d (reception voice floor)", min_user_chars, iv_floor)
        min_user_chars = iv_floor
    min_user_chars = max(2, min(24, min_user_chars))
    manual_commit = os.getenv("MANUAL_COMMIT_USER_TURN", "false").lower() == "true"
    lang_switch_min_chars = int(os.getenv("TTS_LANG_SWITCH_MIN_CHARS", "4" if reception_voice_defaults else "6"))
    iv_lang_floor = 4
    if reception_voice_defaults and lang_switch_min_chars < iv_lang_floor:
        logger.debug("TTS_LANG_SWITCH_MIN_CHARS %d -> %d", lang_switch_min_chars, iv_lang_floor)
        lang_switch_min_chars = iv_lang_floor
    lang_switch_confirm_turns = max(1, int(os.getenv("TTS_LANG_SWITCH_CONFIRM_TURNS", "1")))
    # Code-switching guard: a visitor speaking Arabic with one English term must NOT
    # flip the voice/voice-id to English on the first turn. We require an explicit
    # confirmation turn for ar -> en transitions while leaving en -> ar immediate.
    try:
        ar_to_en_confirm = int(os.getenv("TTS_LANG_SWITCH_AR_TO_EN_CONFIRM_TURNS", "2"))
    except ValueError:
        ar_to_en_confirm = 2
    ar_to_en_confirm = max(1, min(5, ar_to_en_confirm))
    immediate_lang = os.getenv("TTS_LANG_SWITCH_IMMEDIATE", "true").lower() in ("1", "true", "yes")

    pending_lang: str | None = None
    pending_lang_count = 0

    def _current_router_lang() -> str | None:
        """Best-effort read of the router's currently active language ('ar'/'en'/None)."""
        cur = getattr(tts_router, "current_language", None)
        if cur in ("ar", "en"):
            return cur
        return getattr(tts_router, "_last_applied_detected", None)

    def on_user_input_transcribed(ev: UserInputTranscribedEvent) -> None:
        nonlocal last_transcript, last_commit_ts, pending_lang, pending_lang_count
        if not ev.is_final or not ev.transcript:
            return
        text = ev.transcript.strip()
        if not text:
            return

        # Explicit language-switch request — apply the voice immediately and bypass
        # the code-switching confirmation gates (``ar_to_en_confirm``, etc.).
        # The assistant's ``on_user_turn_completed`` will set ``_locked_lang`` for
        # the LLM directive on the same turn; here we just align the avatar voice
        # before the LLM/TTS stream begins.
        intent = detect_language_switch_intent(text)
        if intent in ("ar", "en"):
            try:
                tts_router.apply(intent, force=True, source="explicit_switch")
            except Exception as ex:
                logger.warning("explicit_switch TTS routing failed: %s", ex)
            tts_router.last_user_lang = intent
            pending_lang = None
            pending_lang_count = 0
            last_transcript = text
            last_commit_ts = time.monotonic() * 1000.0
            logger.info(
                "explicit_lang_switch | target=%s text=%r",
                intent,
                text[:80],
            )
            if manual_commit:
                try:
                    session.commit_user_turn()
                except Exception as e:
                    logger.error("commit_user_turn failed: %s", e)
            return

        detected_primary = detect_lang_from_text(text)
        detected_all = detected_primary or detect_lang_reply_fallback(text)
        # Only update the persistent "last user lang" hint from the strict (primary)
        # detector. Short fallbacks like "ok" or single English words must not flip
        # the hint that ``ReceptionAssistant`` uses to force the voice on
        # the next reply, otherwise we re-introduce the same code-switching bug at
        # a different layer.
        if detected_primary:
            tts_router.last_user_lang = detected_primary

        if len(text) < min_user_chars:
            return
        if text == last_transcript:
            return
        now_ms = time.monotonic() * 1000.0
        if manual_commit and now_ms - last_commit_ts < commit_cooldown_ms:
            return
        last_transcript = text
        last_commit_ts = now_ms
        logger.debug("user transcript: %s", text[:80] + ("..." if len(text) > 80 else ""))

        detected = detected_all
        if detected:
            current_lang = _current_router_lang()
            is_ar_to_en = detected == "en" and current_lang == "ar"

            if detected == "en" and len(text) < lang_switch_min_chars:
                # Short English fillers ("ok", "yes", "recruitment") must NOT flip the
                # voice while we are speaking Arabic — that is the bug the user hit.
                if current_lang == "ar":
                    logger.debug(
                        "TTS routing skipped: short EN filler in AR session (text=%r)",
                        text[:40],
                    )
                    pending_lang = None
                    pending_lang_count = 0
                else:
                    tts_router.apply(detected, force=True, source="user_short")
                    pending_lang = None
                    pending_lang_count = 0
            elif is_ar_to_en:
                # Sticky ar -> en: require N consecutive full English turns before
                # flipping the voice. Avoids voice/voice-id thrash during code-switching.
                if detected == pending_lang:
                    pending_lang_count += 1
                else:
                    pending_lang = detected
                    pending_lang_count = 1
                if pending_lang_count < ar_to_en_confirm:
                    logger.debug(
                        "TTS routing pending ar->en %d/%d (text=%r)",
                        pending_lang_count,
                        ar_to_en_confirm,
                        text[:60],
                    )
                else:
                    tts_router.apply(detected, force=False, source="user_ar_to_en")
                    pending_lang = None
                    pending_lang_count = 0
            elif immediate_lang:
                tts_router.apply(detected, force=True, source="user")
                pending_lang = None
                pending_lang_count = 0
            else:
                if detected == pending_lang:
                    pending_lang_count += 1
                else:
                    pending_lang = detected
                    pending_lang_count = 1
                if pending_lang_count < lang_switch_confirm_turns:
                    logger.debug(
                        "TTS routing pending %s (%d/%d)",
                        detected,
                        pending_lang_count,
                        lang_switch_confirm_turns,
                    )
                else:
                    tts_router.apply(detected, force=False, source="user")
                    pending_lang = None
                    pending_lang_count = 0

        if manual_commit:
            try:
                session.commit_user_turn()
            except Exception as e:
                logger.error("commit_user_turn failed: %s", e)

    session.on("user_input_transcribed", on_user_input_transcribed)
