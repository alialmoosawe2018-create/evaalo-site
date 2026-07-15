"""Optional tweaks to LiveKit Agents SDK constants via env (avoid forking the library)."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("agent")


def apply_env_sdk_tweaks() -> None:
    """``LIVEKIT_SPEECH_INTERRUPTION_TIMEOUT``: seconds before SDK force-cancels speech after interrupt.

    Default in ``livekit.agents.voice.speech_handle`` is **5.0**. Slightly higher values can reduce
    ``speech not done in time after interruption`` when the avatar path is slow — does **not** fix
    ``clear buffer rpc`` failures when the user disconnects mid-flight (those are often expected).
    """
    raw = (os.getenv("LIVEKIT_SPEECH_INTERRUPTION_TIMEOUT") or "").strip()
    if not raw:
        return
    try:
        v = float(raw)
    except ValueError:
        logger.warning("Invalid LIVEKIT_SPEECH_INTERRUPTION_TIMEOUT=%r", raw)
        return
    if not (2.0 <= v <= 45.0):
        logger.warning("LIVEKIT_SPEECH_INTERRUPTION_TIMEOUT must be between 2 and 45 (got %s)", v)
        return
    try:
        from livekit.agents.voice import speech_handle

        speech_handle.INTERRUPTION_TIMEOUT = v
        logger.info("sdk tweak: speech_handle.INTERRUPTION_TIMEOUT=%.1fs", v)
    except Exception as e:
        logger.warning("Could not apply INTERRUPTION_TIMEOUT tweak: %s", e)
