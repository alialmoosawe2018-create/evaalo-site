"""Environment loading, constants, and Windows asyncio policy."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("agent")

# src/reception/config.py -> parents: reception, src, project root
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


def env_or(*names: str, default: str = "") -> str:
    """Return the first non-empty environment value among ``names``."""

    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return default


# Reception worker: scoped LiveKit credentials override canonical LIVEKIT_* for this process.
_rlk_url = env_or("LIVEKIT_RECEPTION_URL", "LIVEKIT_URL")
_rlk_key = env_or("LIVEKIT_RECEPTION_API_KEY", "LIVEKIT_API_KEY")
_rlk_secret = env_or("LIVEKIT_RECEPTION_API_SECRET", "LIVEKIT_API_SECRET")
if _rlk_url:
    os.environ["LIVEKIT_URL"] = _rlk_url
if _rlk_key:
    os.environ["LIVEKIT_API_KEY"] = _rlk_key
if _rlk_secret:
    os.environ["LIVEKIT_API_SECRET"] = _rlk_secret

LIVEKIT_URL = _rlk_url
LIVEKIT_API_KEY = _rlk_key
LIVEKIT_API_SECRET = _rlk_secret

# --- voice pipeline defaults (reception demo; legacy INTERVIEW_* env names still honored) ---

ARABIC_VOICE_ID = "a0K946lDZEyNuRXJc7sI"
LEGACY_WRONG_AVATAR_ID = "b5bebaf9-ae80-4e43-b97f-4506136ed926"
DEFAULT_AVATAR_ID = "694c83e2-8895-4a98-bd16-56332ca3f449"
INVALID_ELEVEN_VOICE_IDS = frozenset({"21m00Tzpb8gXv3hC"})


def reception_voice_defaults_enabled() -> bool:
    """STT/endpointing/TTS tuning for reception when SPEECHMATICS_RECEPTION_DEFAULTS or legacy INTERVIEW_DEFAULTS."""
    r = os.getenv("SPEECHMATICS_RECEPTION_DEFAULTS")
    if r is not None and str(r).strip() != "":
        return str(r).strip().lower() in ("1", "true", "yes")
    return os.getenv("SPEECHMATICS_INTERVIEW_DEFAULTS", "true").lower() in ("1", "true", "yes")


def interview_defaults_enabled() -> bool:
    """Alias for :func:`reception_voice_defaults_enabled` (legacy name)."""

    return reception_voice_defaults_enabled()


def reception_profile_normalized() -> str | None:
    """Pipeline temperament: ``RECEPTION_PROFILE`` or legacy ``INTERVIEW_PROFILE``."""

    p = (os.getenv("RECEPTION_PROFILE") or os.getenv("INTERVIEW_PROFILE") or "").strip().lower()
    if not p:
        return None
    if p in ("stability", "stable", "calm"):
        return "stability"
    if p in ("latency", "fast", "snappy"):
        return "latency"
    logger.warning("Ignoring invalid RECEPTION_PROFILE/INTERVIEW_PROFILE=%r (use latency or stability)", p)
    return None


def interview_profile_normalized() -> str | None:
    """Alias for :func:`reception_profile_normalized` (legacy name)."""

    return reception_profile_normalized()


def avatar_stability_mode() -> bool:
    """When True: longer endpointing + higher clear_buffer floor (fewer STT splits; more turn latency).

    Overridden by ``RECEPTION_PROFILE`` / ``INTERVIEW_PROFILE=stability`` (on) or ``=latency`` (off) when reception voice defaults on.
    """
    if not reception_voice_defaults_enabled():
        return False
    prof = reception_profile_normalized()
    if prof == "stability":
        return True
    if prof == "latency":
        return False
    return os.getenv("AVATAR_STABILITY_MODE", "false").lower() in ("1", "true", "yes")


def avatar_fast_response() -> bool:
    """Snappier STT finals + LiveKit endpointing + shorter TTS segment gaps.

    ``RECEPTION_PROFILE=latency`` / ``INTERVIEW_PROFILE=latency`` forces this on; ``=stability`` keeps legacy env unless you set
    ``AVATAR_FAST_RESPONSE=true``.
    """
    if not reception_voice_defaults_enabled():
        return False
    prof = reception_profile_normalized()
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
    prof = reception_profile_normalized()
    if prof == "latency":
        # LiveKit latency guidance: smaller prefetch → earlier first TTS byte → faster avatar lip-sync start.
        # 10 = snappier than 12; env TTS_REPLY_PREFETCH_MAX_CHARS overrides (min 8 in tts_reply_prefetch_max_chars).
        return 10
    if prof == "stability":
        # Slightly more LLM context before first TTS chunk → clearer Arabic (esp. sentence-initial).
        return 26
    return 20


def reception_max_session_seconds() -> float:
    """Hard cap on a reception demo session (seconds). After this, the agent says a short
    goodbye and the room is closed so the visitor can reconnect for a fresh session.

    Default 180s (3 minutes). Set ``RECEPTION_MAX_SESSION_SECONDS=0`` to disable the cap.
    """
    raw = (os.getenv("RECEPTION_MAX_SESSION_SECONDS") or "").strip()
    if not raw:
        return 180.0
    try:
        val = float(raw)
    except ValueError:
        logger.warning("Invalid RECEPTION_MAX_SESSION_SECONDS=%r; using 180", raw)
        return 180.0
    if val <= 0:
        return 0.0
    return max(30.0, val)


def reception_session_goodbye(language: str = "ar") -> str:
    """Short closing line spoken when the session time limit is reached."""
    custom = (os.getenv("RECEPTION_SESSION_GOODBYE") or "").strip()
    if custom:
        return custom
    if language in ("en", "english"):
        return (
            "Thanks for trying the Evaalo reception demo. The session time is up for now, "
            "but feel free to reconnect anytime to continue."
        )
    return (
        "شكراً لتجربتك استقبال ایڤالو. انتهى وقت الجلسة الحالية، "
        "وتگدر تعيد الاتصال بأي وقت إذا حابب تكمل."
    )


def env_allow_interruption() -> bool:
    """AgentSession.allow_interruptions / per-turn speech handles (LiveKit agents).

    ``ALLOW_INTERRUPTION=false`` alone makes LiveKit **skip** user finals while the agent speaks
    (*skipping reply… cannot be interrupted*). With ``RECEPTION_HARD_NO_INTERRUPT`` / ``INTERVIEW_HARD_NO_INTERRUPT=true``,
    ``ALLOW_INTERRUPTION`` is respected.

    Defaults: allow interruptions on. Calmer avatar: raise ``MIN_INTERRUPTION_DURATION`` (~0.9-1.2s)
    or set ``RECEPTION_HARD_NO_INTERRUPT=true`` with ``ALLOW_INTERRUPTION=false``.
    ``RECEPTION_FORCE_ALLOW_INTERRUPTION`` / ``INTERVIEW_FORCE_ALLOW_INTERRUPTION=true`` forces allow.
    """
    explicit = os.getenv("ALLOW_INTERRUPTION", "true").lower() == "true"
    if env_or("RECEPTION_FORCE_ALLOW_INTERRUPTION", "INTERVIEW_FORCE_ALLOW_INTERRUPTION", default="false").lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    hard_no = (
        env_or("RECEPTION_HARD_NO_INTERRUPT", "INTERVIEW_HARD_NO_INTERRUPT", default="false").lower()
        in ("1", "true", "yes")
    )
    if hard_no:
        return explicit
    if not explicit:
        logger.debug(
            "allow_interruptions=True (ALLOW_INTERRUPTION=false ignored; set RECEPTION_HARD_NO_INTERRUPT or INTERVIEW_HARD_NO_INTERRUPT=true to forbid)"
        )
    return True


def env_preemptive_generation() -> bool:
    """AgentSession.preemptive_generation.

    When ``PREEMPTIVE_GENERATION=false``, the pipeline waits longer before LLM/TTS work — the UI
    often stays in *thinking* noticeably longer. Prefer ``true`` with ``RECEPTION_PROFILE=latency``.

    If ``PREEMPTIVE_GENERATION`` is set, it wins. Otherwise with reception voice defaults:
    * ``AVATAR_STABILITY_MODE`` defaults preemptive **off** (fewer LLM/TTS overlaps → calmer avatar).
    * Snappy profile (stability off): preemptive **on** unless disabled.
    ``RECEPTION_FORCE_PREEMPTIVE_GENERATION`` / ``INTERVIEW_FORCE_PREEMPTIVE_GENERATION=true`` forces on.
    """
    raw = os.getenv("PREEMPTIVE_GENERATION")
    if raw is not None and str(raw).strip() != "":
        return str(raw).strip().lower() == "true"
    if not reception_voice_defaults_enabled():
        return True
    if env_or("RECEPTION_FORCE_PREEMPTIVE_GENERATION", "INTERVIEW_FORCE_PREEMPTIVE_GENERATION", default="false").lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    return not avatar_stability_mode()


def apply_reception_endpointing_boost(min_ept: float, max_ept: float) -> tuple[float, float]:
    """Tune LiveKit `min_endpointing_delay` / `max_endpointing_delay` for reception voice + Speechmatics.

    With ``turn_detection=\"stt\"`` (no VAD, no plugin turn detector), LiveKit applies
    **min_endpointing_delay after the STT end-of-speech signal** — additive on top of
    Speechmatics EOU. See ``AgentSession`` docs: min_endpointing_delay / max_endpointing_delay.

    **max_endpointing_delay** mainly matters when a **plugin turn detector** is installed; with
    pure STT mode it rarely applies, but we still raise it so dispatch + future detectors stay sane.

    ``RECEPTION_PROFILE=latency`` / ``INTERVIEW_PROFILE=latency`` (LiveKit-style snappy turns): lower default floor, cap high max so
    the pipeline does not wait unnecessarily after STT has already committed the utterance.

    Defaults: snappier min when not in ``AVATAR_STABILITY_MODE``; higher floors in stability mode.
    """
    if not reception_voice_defaults_enabled():
        return min_ept, max_ept
    _prof = reception_profile_normalized()
    _stable = avatar_stability_mode() and not avatar_fast_response()
    _default_floor = "0.36" if _stable else "0.08"
    if _prof == "latency":
        # Snappier post–STT dispatch (additive after Speechmatics EOU); raise if agent cuts in too eagerly.
        _default_floor = "0.04"
    _floor_raw = env_or("RECEPTION_MIN_ENDPOINTING_FLOOR", "INTERVIEW_MIN_ENDPOINTING_FLOOR")
    floor_min = float(_floor_raw or _default_floor)
    if min_ept < floor_min:
        logger.debug("reception voice: MIN_ENDPOINTING_DELAY %.2f (was %.2f)", floor_min, min_ept)
        min_ept = floor_min
    _default_ceiling = "1.25" if _stable else "2.0"
    if _prof == "latency":
        _default_ceiling = "1.12"
    _ceil_raw = env_or("RECEPTION_MAX_ENDPOINTING_CEILING", "INTERVIEW_MAX_ENDPOINTING_CEILING")
    ceiling = float(_ceil_raw or _default_ceiling)
    ceiling = max(0.85, min(3.0, ceiling))
    if max_ept < ceiling:
        logger.debug("reception voice: MAX_ENDPOINTING_DELAY %.2f (was %.2f)", ceiling, max_ept)
        max_ept = ceiling
    if max_ept < min_ept + 0.15:
        max_ept = min_ept + 0.2
        logger.debug("reception voice: MAX_ENDPOINTING_DELAY %.2f (gap vs min)", max_ept)
    if _prof == "latency":
        _cap_raw = env_or("RECEPTION_LATENCY_MAX_ENDPOINTING_CAP", "INTERVIEW_LATENCY_MAX_ENDPOINTING_CAP")
        cap = float(_cap_raw or "1.15")
        cap = max(0.9, min(2.5, cap))
        if max_ept > cap:
            logger.debug(
                "reception latency profile: MAX_ENDPOINTING_DELAY capped %.2f -> %.2f (LiveKit snappy turns)",
                max_ept,
                cap,
            )
            max_ept = cap
    if _stable:
        logger.debug(
            "reception voice: avatar_stability_mode=True (set AVATAR_STABILITY_MODE=false for snappier turns)"
        )
    if avatar_stability_mode() and avatar_fast_response():
        logger.debug("reception voice: AVATAR_FAST_RESPONSE overrides slow endpointing")
    return min_ept, max_ept


def apply_interview_endpointing_boost(min_ept: float, max_ept: float) -> tuple[float, float]:
    """Alias for :func:`apply_reception_endpointing_boost` (legacy name)."""

    return apply_reception_endpointing_boost(min_ept, max_ept)


def reception_min_interrupt_speech_duration() -> float:
    """Minimum user speech length (s) to count as interrupting the agent (LiveKit default ~0.5).

    Lower = user can barge-in sooner (snappier). Latency profile defaults a touch below generic voice-agent baseline.
    """
    _default = "0.5"
    if reception_voice_defaults_enabled():
        _default = (
            "0.48"
            if reception_profile_normalized() == "latency"
            else "0.52"
        )
    raw = os.getenv("MIN_INTERRUPTION_DURATION", _default)
    try:
        v = float(raw)
    except ValueError:
        return 0.5
    return max(0.2, min(2.0, v))


def interview_min_interruption_duration() -> float:
    """Alias for :func:`reception_min_interrupt_speech_duration` (legacy name)."""

    return reception_min_interrupt_speech_duration()


def reception_false_interruption_timeout() -> float | None:
    """After a (possibly false) interruption, wait this long for user audio (default 2.5s when voice defaults on)."""
    raw = os.getenv("FALSE_INTERRUPTION_TIMEOUT", "2.5" if reception_voice_defaults_enabled() else "2.0")
    if raw is None or str(raw).strip().lower() in ("", "none", "off", "disable"):
        return None
    try:
        return max(0.5, float(raw))
    except ValueError:
        return 2.0


def interview_false_interruption_timeout() -> float | None:
    """Alias for :func:`reception_false_interruption_timeout` (legacy name)."""

    return reception_false_interruption_timeout()


def reception_discard_audio_if_uninterruptible() -> bool:
    # For avatar sessions, dropping audio chunks when uninterruptible can sound like chopped playout.
    # Prefer keeping queued audio unless explicitly overridden.
    default = "false" if reception_voice_defaults_enabled() else "true"
    return os.getenv("DISCARD_AUDIO_IF_UNINTERRUPTIBLE", default).lower() in (
        "1",
        "true",
        "yes",
    )


def interview_discard_audio_if_uninterruptible() -> bool:
    """Alias for :func:`reception_discard_audio_if_uninterruptible` (legacy name)."""

    return reception_discard_audio_if_uninterruptible()


class _UserAwayTimeoutUnset:
    """Sentinel: do not pass ``user_away_timeout`` — use LiveKit ``AgentSession`` default (15s)."""


USER_AWAY_TIMEOUT_SDK_DEFAULT = _UserAwayTimeoutUnset()


def reception_room_close_on_disconnect() -> bool:
    """``RoomOptions.close_on_disconnect`` (LiveKit agents): end session when the linked participant leaves.

    Default ``True`` matches the SDK. Set ``RECEPTION_CLOSE_ON_DISCONNECT=false`` only if you need the
    agent to stay up after the visitor disconnects (rare for reception demos).

    See https://docs.livekit.io/agents/logic/sessions/
    """
    return os.getenv("RECEPTION_CLOSE_ON_DISCONNECT", "true").lower() in (
        "1",
        "true",
        "yes",
    )


def reception_room_delete_on_close() -> bool:
    """``RoomOptions.delete_room_on_close``: delete the LiveKit room when the session closes.

    Off by default so backends that manage room lifecycle stay unchanged. Enable for self-contained
    demos to reduce orphaned rooms.

    See https://docs.livekit.io/agents/logic/sessions/
    """
    return os.getenv("RECEPTION_DELETE_ROOM_ON_CLOSE", "false").lower() in (
        "1",
        "true",
        "yes",
    )


def reception_user_away_timeout() -> float | None | _UserAwayTimeoutUnset:
    """``AgentSession.user_away_timeout``: mark user \"away\" after N seconds without speech.

    - Unset / empty → keep SDK default (do not pass the argument).
    - ``none``, ``off``, ``disable`` → pass ``None`` (disable away timer).
    - Positive float → seconds until away (e.g. ``60`` for reading-heavy demos).

    See https://docs.livekit.io/agents/logic/sessions/
    """
    raw = os.getenv("RECEPTION_USER_AWAY_TIMEOUT")
    if raw is None or str(raw).strip() == "":
        return USER_AWAY_TIMEOUT_SDK_DEFAULT
    s = str(raw).strip().lower()
    if s in ("none", "off", "disable"):
        return None
    try:
        v = float(s)
    except ValueError:
        logger.warning("Invalid RECEPTION_USER_AWAY_TIMEOUT=%r — using SDK default", raw)
        return USER_AWAY_TIMEOUT_SDK_DEFAULT
    if v < 0:
        logger.warning("RECEPTION_USER_AWAY_TIMEOUT must be >= 0 — using SDK default")
        return USER_AWAY_TIMEOUT_SDK_DEFAULT
    return v


def reception_min_interruption_words() -> int | None:
    """Optional ``AgentSession.min_interruption_words`` — reduce backchannel false interrupts (voice).

    For reception (avatar) sessions, false interruptions are particularly damaging because the
    Beyond avatar uses ``DataStreamIO`` which **does not support resume** after ``clear_buffer``.
    A single noisy breath > ``min_interruption_duration`` (~1s) is enough to silently drop the
    rest of the agent's reply — that is exactly the symptom seen in deploy logs:

        WARNING didn't receive playback finished event after clear buffer
        (no user transcript before/after — pure false interruption)

    LiveKit recommends a word floor in noisy environments. We default to ``2`` for reception
    voice sessions: STT must emit ≥ 2 actual words before the SDK treats the audio as a real
    interruption. Set ``RECEPTION_MIN_INTERRUPTION_WORDS=0`` to restore the SDK default.

    See https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
    """
    raw = (os.getenv("RECEPTION_MIN_INTERRUPTION_WORDS") or "").strip()
    if not raw:
        # Default ON for reception voice (avatar can't recover from false interrupt).
        return 2 if reception_voice_defaults_enabled() else None
    try:
        w = int(raw)
    except ValueError:
        logger.warning("Invalid RECEPTION_MIN_INTERRUPTION_WORDS=%r — ignoring", raw)
        return None
    return max(0, min(12, w))


def reception_log_participant_events() -> bool:
    """Log ``participant_connected`` / ``participant_disconnected`` on the agent room."""
    return os.getenv("RECEPTION_LOG_PARTICIPANT_EVENTS", "true").lower() in (
        "1",
        "true",
        "yes",
    )


def default_avatar_clear_buffer_timeout() -> float:
    """Raw env (DataStreamAudioOutput `_clear_buffer_timeout`). See effective_avatar_clear_buffer_timeout()."""
    explicit = os.getenv("AVATAR_CLEAR_BUFFER_TIMEOUT")
    if explicit is not None and explicit.strip() != "":
        return float(explicit.strip())
    # Reception voice default: ~20s — Beyond/DataStream often needs headroom after clear_buffer before lk.playback_finished.
    # Below ~18s, logs frequently show arbitrary playout + duplicate playback_finished warnings.
    if reception_voice_defaults_enabled():
        return 20.0
    return 2.0


def effective_avatar_clear_buffer_timeout() -> float:
    """Buffer after `lk.clear_buffer` RPC before arbitrary playout completion (DataStreamAudioOutput).

    If this is shorter than Beyond's `lk.playback_finished` RPC latency—common on interrupt when
    the user speaks again while the avatar is still playing—you get:
    `didn't receive playback finished event after clear buffer` and then
    `playback_finished called more times than playback segments were captured`.

    Reception **floor** bumps a short timeout up so Beyond's `playback_finished` can arrive after
    `clear_buffer` — avoiding arbitrary completion + duplicate `playback_finished` warnings.

    **Tradeoff:** raising the timeout reduces those warnings but **extends the worst-case wait** after
    `clear_buffer` when the real RPC is delayed. **~14-18s** often fits UAE/Beyond; use env overrides or
    **PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED** only if residual duplicate logs remain after a higher timeout.

    **Cap must be >= floor** (legacy .env had cap=14 while floor=18, undoing the reception bump).
    """
    raw = default_avatar_clear_buffer_timeout()
    if not reception_voice_defaults_enabled():
        return raw
    _min_iv = "20.0" if avatar_stability_mode() else "18.0"
    _min_raw = env_or("AVATAR_CLEAR_BUFFER_MIN_RECEPTION", "AVATAR_CLEAR_BUFFER_MIN_INTERVIEW")
    floor = float(_min_raw or _min_iv)
    _default_cap = 28.0
    _cap_raw = env_or("AVATAR_CLEAR_BUFFER_MAX_RECEPTION", "AVATAR_CLEAR_BUFFER_MAX_INTERVIEW")
    cap = float(_cap_raw or str(_default_cap))
    if cap < floor:
        new_cap = max(_default_cap, floor)
        logger.warning(
            "reception voice: AVATAR_CLEAR_BUFFER_MAX_* %.1fs < floor %.1fs — using cap %.1fs. "
            "Set AVATAR_CLEAR_BUFFER_MAX_RECEPTION=%.1f in .env.local or remove it.",
            cap,
            floor,
            new_cap,
            new_cap,
        )
        cap = new_cap
    v = raw
    if v < floor:
        logger.debug(
            "reception voice: floor clear_buffer_timeout %.1fs -> %.1fs",
            v,
            floor,
        )
        v = floor
    if v > cap:
        logger.debug(
            "reception voice: cap clear_buffer_timeout %.1fs -> %.1fs",
            v,
            cap,
        )
        v = cap
    return v
