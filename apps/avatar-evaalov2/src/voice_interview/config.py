"""Environment loading, constants, and Windows asyncio policy."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("agent")

# src/voice_interview/config.py -> parents: voice_interview, src, project root
_env_path = Path(__file__).resolve().parent.parent.parent / ".env.local"
load_dotenv(_env_path, override=True)
if not _env_path.exists():
    logger.warning(".env.local not found at: %s", _env_path)
# بعض المشغّلات (أو مجلد عمل مختلف) لا يجدون المسار أعلاه — جرّب cwd أيضاً
_cwd_env = Path.cwd() / ".env.local"
if _cwd_env.is_file() and _cwd_env.resolve() != _env_path.resolve():
    load_dotenv(_cwd_env, override=True)
    logger.debug("Also loaded .env.local from cwd: %s", _cwd_env)


def _apply_windows_asyncio_policy() -> None:
    """Avoid Proactor shutdown races (e.g. WinError 10054) unless FORCE_PROACTOR_EVENT_LOOP=1."""
    if sys.platform != "win32":
        return
    if os.getenv("FORCE_PROACTOR_EVENT_LOOP", "").lower() in ("1", "true", "yes"):
        logger.debug("asyncio: Proactor policy (FORCE_PROACTOR_EVENT_LOOP)")
        return
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    logger.debug("asyncio: WindowsSelectorEventLoopPolicy (fewer WinError 10054 on disconnect)")


_apply_windows_asyncio_policy()

# --- defaults aligned with product interview flow ---

ARABIC_VOICE_ID = "a0K946lDZEyNuRXJc7sI"
LEGACY_WRONG_AVATAR_ID = "b5bebaf9-ae80-4e43-b97f-4506136ed926"
DEFAULT_AVATAR_ID = "694c83e2-8895-4a98-bd16-56332ca3f449"
INVALID_ELEVEN_VOICE_IDS = frozenset({"21m00Tzpb8gXv3hC"})


def interview_defaults_enabled() -> bool:
    """STT/endpointing/TTS interview boost when SPEECHMATICS_INTERVIEW_DEFAULTS is true."""
    return os.getenv("SPEECHMATICS_INTERVIEW_DEFAULTS", "true").lower() in ("1", "true", "yes")


def interview_auto_end_enabled() -> bool:
    """Expose the ``end_interview`` tool so the agent can close the session itself.

    When true, the InterviewAssistant registers an ``end_interview`` function tool and the
    prompt instructs the LLM to call it after the closing remarks (interview + questions done).
    Disable via ``INTERVIEW_AUTO_END=false`` to keep the legacy behavior (wait for the
    candidate / room to disconnect).
    """
    return os.getenv("INTERVIEW_AUTO_END", "true").lower() in ("1", "true", "yes")


def interview_end_delete_room() -> bool:
    """After the closing remarks, delete the LiveKit room (kicks everyone) vs only shutting down the job.

    Default ``true``: ``ctx.delete_room()`` fully tears down the room so the candidate's client
    disconnects too. Set ``INTERVIEW_END_DELETE_ROOM=false`` to use ``ctx.shutdown()`` instead
    (agent leaves; backend keeps room lifecycle). See https://docs.livekit.io/agents/logic/sessions/
    """
    return os.getenv("INTERVIEW_END_DELETE_ROOM", "true").lower() in ("1", "true", "yes")


def interview_profile_normalized() -> str | None:
    """Single switch for pipeline temperament (see LiveKit AgentSession tuning).

    ``INTERVIEW_PROFILE=latency`` — snappier turns, shorter TTS prefetch default, preemptive generation on.
    ``INTERVIEW_PROFILE=stability`` — calmer STT/avatar, higher endpointing floors, preemptive off.

    If unset, legacy ``AVATAR_STABILITY_MODE`` / ``AVATAR_FAST_RESPONSE`` apply alone.
    """
    p = (os.getenv("INTERVIEW_PROFILE") or "").strip().lower()
    if not p:
        return None
    if p in ("stability", "stable", "calm"):
        return "stability"
    if p in ("latency", "fast", "snappy"):
        return "latency"
    logger.warning("Ignoring invalid INTERVIEW_PROFILE=%r (use latency or stability)", p)
    return None


def avatar_stability_mode() -> bool:
    """When True: longer endpointing + higher clear_buffer floor (fewer STT splits; more turn latency).

    Overridden by ``INTERVIEW_PROFILE=stability`` (on) or ``=latency`` (off) when interview defaults on.
    """
    if not interview_defaults_enabled():
        return False
    prof = interview_profile_normalized()
    if prof == "stability":
        return True
    if prof == "latency":
        return False
    return os.getenv("AVATAR_STABILITY_MODE", "false").lower() in ("1", "true", "yes")


def avatar_fast_response() -> bool:
    """Snappier STT finals + LiveKit endpointing + shorter TTS segment gaps.

    ``INTERVIEW_PROFILE=latency`` forces this on; ``=stability`` keeps legacy env unless you set
    ``AVATAR_FAST_RESPONSE=true``.
    """
    if not interview_defaults_enabled():
        return False
    prof = interview_profile_normalized()
    if prof == "latency":
        return True
    if prof == "stability":
        return os.getenv("AVATAR_FAST_RESPONSE", "false").lower() in ("1", "true", "yes")
    return os.getenv("AVATAR_FAST_RESPONSE", "false").lower() in ("1", "true", "yes")


def tts_reply_prefetch_max_chars() -> int:
    """LLM chars to buffer before TTS/lang route; lower = faster first audio (LiveKit TTS pipeline)."""
    raw = (os.getenv("TTS_REPLY_PREFETCH_MAX_CHARS") or "").strip()
    if raw:
        try:
            return max(8, min(64, int(raw)))
        except ValueError:
            pass
    prof = interview_profile_normalized()
    if prof == "latency":
        # LiveKit latency guidance: smaller prefetch → earlier first TTS byte → faster avatar lip-sync start.
        # 10 = snappier than 12; env TTS_REPLY_PREFETCH_MAX_CHARS overrides (min 8 in tts_reply_prefetch_max_chars).
        return 10
    if prof == "stability":
        # Slightly more LLM context before first TTS chunk → clearer Arabic (esp. sentence-initial).
        return 26
    return 20


def env_allow_interruption() -> bool:
    """AgentSession.allow_interruptions / per-turn speech handles (LiveKit agents).

    ``ALLOW_INTERRUPTION=false`` alone makes LiveKit **skip** user finals while the agent speaks
    (*skipping reply… cannot be interrupted*). With ``INTERVIEW_HARD_NO_INTERRUPT=true``,
    ``ALLOW_INTERRUPTION`` is respected.

    Defaults: allow interruptions on. Calmer avatar: raise ``MIN_INTERRUPTION_DURATION`` (~0.9-1.2s)
    or set ``INTERVIEW_HARD_NO_INTERRUPT=true`` with ``ALLOW_INTERRUPTION=false``.
    ``INTERVIEW_FORCE_ALLOW_INTERRUPTION=true`` forces allow.
    """
    explicit = os.getenv("ALLOW_INTERRUPTION", "true").lower() == "true"
    if os.getenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION", "false").lower() in ("1", "true", "yes"):
        return True
    hard_no = os.getenv("INTERVIEW_HARD_NO_INTERRUPT", "false").lower() in ("1", "true", "yes")
    if hard_no:
        return explicit
    if not explicit:
        logger.debug(
            "allow_interruptions=True (ALLOW_INTERRUPTION=false ignored; set INTERVIEW_HARD_NO_INTERRUPT=true to forbid)"
        )
    return True


def env_preemptive_generation() -> bool:
    """AgentSession.preemptive_generation.

    When ``PREEMPTIVE_GENERATION=false``, the pipeline waits longer before LLM/TTS work — the UI
    often stays in *thinking* noticeably longer. Prefer ``true`` with ``INTERVIEW_PROFILE=latency``.

    If ``PREEMPTIVE_GENERATION`` is set, it wins. Otherwise with interview defaults:
    * ``AVATAR_STABILITY_MODE`` defaults preemptive **off** (fewer LLM/TTS overlaps → calmer avatar).
    * Snappy profile (stability off): preemptive **on** unless disabled.
    ``INTERVIEW_FORCE_PREEMPTIVE_GENERATION=true`` forces on.
    """
    raw = os.getenv("PREEMPTIVE_GENERATION")
    if raw is not None and str(raw).strip() != "":
        return str(raw).strip().lower() == "true"
    if not interview_defaults_enabled():
        return True
    if os.getenv("INTERVIEW_FORCE_PREEMPTIVE_GENERATION", "false").lower() in ("1", "true", "yes"):
        return True
    return not avatar_stability_mode()


def apply_interview_endpointing_boost(min_ept: float, max_ept: float) -> tuple[float, float]:
    """Tune LiveKit `min_endpointing_delay` / `max_endpointing_delay` for interview + Speechmatics.

    With ``turn_detection=\"stt\"`` (no VAD, no plugin turn detector), LiveKit applies
    **min_endpointing_delay after the STT end-of-speech signal** — additive on top of
    Speechmatics EOU. See ``AgentSession`` docs: min_endpointing_delay / max_endpointing_delay.

    **max_endpointing_delay** mainly matters when a **plugin turn detector** is installed; with
    pure STT mode it rarely applies, but we still raise it so dispatch + future detectors stay sane.

    ``INTERVIEW_PROFILE=latency`` (LiveKit-style snappy turns): lower default floor, cap high max so
    the pipeline does not wait unnecessarily after STT has already committed the utterance.

    Defaults: snappier min when not in ``AVATAR_STABILITY_MODE``; higher floors in stability mode.
    """
    if not interview_defaults_enabled():
        return min_ept, max_ept
    _prof = interview_profile_normalized()
    _stable = avatar_stability_mode() and not avatar_fast_response()
    _default_floor = "0.36" if _stable else "0.08"
    if _prof == "latency":
        # Snappier post–STT dispatch (additive after Speechmatics EOU); raise if agent cuts in too eagerly.
        _default_floor = "0.04"
    floor_min = float(os.getenv("INTERVIEW_MIN_ENDPOINTING_FLOOR", _default_floor))
    if min_ept < floor_min:
        logger.debug("interview boost: MIN_ENDPOINTING_DELAY %.2f (was %.2f)", floor_min, min_ept)
        min_ept = floor_min
    _default_ceiling = "1.25" if _stable else "2.0"
    if _prof == "latency":
        _default_ceiling = "1.12"
    ceiling = float(os.getenv("INTERVIEW_MAX_ENDPOINTING_CEILING", _default_ceiling))
    ceiling = max(0.85, min(3.0, ceiling))
    if max_ept < ceiling:
        logger.debug("interview boost: MAX_ENDPOINTING_DELAY %.2f (was %.2f)", ceiling, max_ept)
        max_ept = ceiling
    if max_ept < min_ept + 0.15:
        max_ept = min_ept + 0.2
        logger.debug("interview boost: MAX_ENDPOINTING_DELAY %.2f (gap vs min)", max_ept)
    if _prof == "latency":
        cap = float(os.getenv("INTERVIEW_LATENCY_MAX_ENDPOINTING_CAP", "1.15"))
        cap = max(0.9, min(2.5, cap))
        if max_ept > cap:
            logger.debug(
                "interview latency profile: MAX_ENDPOINTING_DELAY capped %.2f -> %.2f (LiveKit snappy turns)",
                max_ept,
                cap,
            )
            max_ept = cap
    if _stable:
        logger.debug(
            "interview boost: avatar_stability_mode=True (set AVATAR_STABILITY_MODE=false for snappier turns)"
        )
    if avatar_stability_mode() and avatar_fast_response():
        logger.debug("interview boost: AVATAR_FAST_RESPONSE overrides slow endpointing")
    return min_ept, max_ept


def interview_min_interruption_duration() -> float:
    """Minimum user speech length (s) to count as interrupting the agent (LiveKit default ~0.5).

    Lower = user can barge-in sooner (snappier). Latency profile defaults a touch below generic interview.
    """
    _default = "0.5"
    if interview_defaults_enabled():
        _default = (
            "0.48"
            if interview_profile_normalized() == "latency"
            else "0.52"
        )
    raw = os.getenv("MIN_INTERRUPTION_DURATION", _default)
    try:
        v = float(raw)
    except ValueError:
        return 0.5
    return max(0.2, min(2.0, v))


def interview_false_interruption_timeout() -> float | None:
    """After a (possibly false) interruption, wait this long for user audio (default 2.5s interview)."""
    raw = os.getenv("FALSE_INTERRUPTION_TIMEOUT", "2.5" if interview_defaults_enabled() else "2.0")
    if raw is None or str(raw).strip().lower() in ("", "none", "off", "disable"):
        return None
    try:
        return max(0.5, float(raw))
    except ValueError:
        return 2.0


def interview_discard_audio_if_uninterruptible() -> bool:
    # For avatar interviews, dropping audio chunks when uninterruptible can sound like chopped playout.
    # Prefer keeping queued audio unless explicitly overridden.
    default = "false" if interview_defaults_enabled() else "true"
    return os.getenv("DISCARD_AUDIO_IF_UNINTERRUPTIBLE", default).lower() in (
        "1",
        "true",
        "yes",
    )


def default_avatar_clear_buffer_timeout() -> float:
    """Raw env (DataStreamAudioOutput `_clear_buffer_timeout`). See effective_avatar_clear_buffer_timeout()."""
    explicit = os.getenv("AVATAR_CLEAR_BUFFER_TIMEOUT")
    if explicit is not None and explicit.strip() != "":
        return float(explicit.strip())
    # Interview default: ~20s — Beyond/DataStream often needs headroom after clear_buffer before lk.playback_finished.
    # Below ~18s, logs frequently show arbitrary playout + duplicate playback_finished warnings.
    if interview_defaults_enabled():
        return 20.0
    return 2.0


def effective_avatar_clear_buffer_timeout() -> float:
    """Buffer after `lk.clear_buffer` RPC before arbitrary playout completion (DataStreamAudioOutput).

    If this is shorter than Beyond's `lk.playback_finished` RPC latency—common on interrupt when
    the user speaks again while the avatar is still playing—you get:
    `didn't receive playback finished event after clear buffer` and then
    `playback_finished called more times than playback segments were captured`.

    Interview **floor** bumps a short timeout up so Beyond's `playback_finished` can arrive after
    `clear_buffer` — avoiding arbitrary completion + duplicate `playback_finished` warnings.

    **Tradeoff:** raising the timeout reduces those warnings but **extends the worst-case wait** after
    `clear_buffer` when the real RPC is delayed. **~14-18s** often fits UAE/Beyond; use env overrides or
    **PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED** only if residual duplicate logs remain after a higher timeout.

    **Cap must be >= floor** (legacy .env had cap=14 while floor=18, undoing the interview bump).
    """
    raw = default_avatar_clear_buffer_timeout()
    if not interview_defaults_enabled():
        return raw
    _min_iv = "20.0" if avatar_stability_mode() else "18.0"
    floor = float(os.getenv("AVATAR_CLEAR_BUFFER_MIN_INTERVIEW", _min_iv))
    _default_cap = 28.0
    cap = float(os.getenv("AVATAR_CLEAR_BUFFER_MAX_INTERVIEW", str(_default_cap)))
    if cap < floor:
        new_cap = max(_default_cap, floor)
        logger.warning(
            "interview: AVATAR_CLEAR_BUFFER_MAX_INTERVIEW %.1fs < floor %.1fs — using cap %.1fs. "
            "Set AVATAR_CLEAR_BUFFER_MAX_INTERVIEW=%.1f in avatar-evaalov2 .env.local or remove it.",
            cap,
            floor,
            new_cap,
            new_cap,
        )
        cap = new_cap
    v = raw
    if v < floor:
        logger.debug(
            "interview: floor clear_buffer_timeout %.1fs -> %.1fs",
            v,
            floor,
        )
        v = floor
    if v > cap:
        logger.debug(
            "interview: cap clear_buffer_timeout %.1fs -> %.1fs",
            v,
            cap,
        )
        v = cap
    return v
