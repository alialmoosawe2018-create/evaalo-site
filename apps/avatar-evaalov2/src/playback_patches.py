"""Monkey-patch for AudioOutput.on_playback_finished (Beyond / DataStream avatar).

When STT interview defaults are on, ``worker.run()`` sets
``PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED`` unless you already set it — this drops **extra**
``playback_finished`` calls that exceed captured segment counts (common after
``clear_buffer`` arbitrary completion).

Set ``PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED=false`` to disable the patch entirely.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("playback_patches")

_PATCH_APPLIED = False


def configure_and_apply_playback_patches() -> None:
    """Interview defaults: opt in to suppress unless user set PLAYBACK_PATCH_* explicitly (empty = use default)."""
    try:
        from voice_interview.config import interview_defaults_enabled

        if interview_defaults_enabled():
            os.environ.setdefault("PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED", "true")
    except Exception:
        pass
    apply_playback_patches()


def apply_playback_patches() -> None:
    """Idempotent: safe to call once per worker process (see worker.run)."""
    global _PATCH_APPLIED
    raw = os.getenv("PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED", "")
    suppress = raw.strip().lower() in ("1", "true", "yes")
    if not suppress:
        logger.debug(
            "playback_finished suppress patch off — set PLAYBACK_PATCH_SUPPRESS_EXTRA_FINISHED=true "
            "(worker sets default on when SPEECHMATICS_INTERVIEW_DEFAULTS) or raise AVATAR_CLEAR_BUFFER_TIMEOUT"
        )
        return
    if _PATCH_APPLIED:
        return
    try:
        from livekit.agents import voice

        io_module = getattr(voice, "io", None)
        if io_module is None:
            return

        _orig = getattr(io_module.AudioOutput, "on_playback_finished", None)
        if _orig is None:
            return

        def _patched(
            self,
            *,
            playback_position: float,
            interrupted: bool,
            synchronized_transcript: str | None = None,
        ) -> None:
            pfc = getattr(self, "_AudioOutput__playback_finished_count", 0)
            psc = getattr(self, "_AudioOutput__playback_segments_count", 0)
            if pfc >= psc:
                logger.debug("playback_finished extra event (avatar) ignored")
                return
            return _orig(
                self,
                playback_position=playback_position,
                interrupted=interrupted,
                synchronized_transcript=synchronized_transcript,
            )

        io_module.AudioOutput.on_playback_finished = _patched
        _PATCH_APPLIED = True
        logger.debug("playback_finished patch applied (suppress extra events when counts disagree)")
    except Exception as e:
        logger.warning("playback patches skipped: %s", e)
