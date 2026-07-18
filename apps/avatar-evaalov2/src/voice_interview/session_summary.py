"""Per-session timing summary.

Emits ONE concise log line per LiveKit interview session, capturing the milestones
that diagnose 95% of "why is the cold start slow / why did it disconnect" issues:

    session_summary | sid=... room=... duration=12.34s connect=4.12s
        avatar_ready=3.05s first_tts=1.41s first_user_final=2.67s
        turns=8 reason=ok

The summary is posted via ``ctx.add_shutdown_callback`` so it always lands, even
on graceful disconnect, /end from the backend, JWT expiry, or remote room delete.

Designed to be cheap (only floats and a single ``logger.info``) and side-effect
free if individual milestones never fired (they remain ``None`` and print as ``-``).

Reference: https://docs.livekit.io/agents/server/job/
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from livekit.agents import AgentSession, JobContext

logger = logging.getLogger("agent")


@dataclass
class SessionTelemetry:
    """Lightweight per-session timing tracker.

    Fields are seconds (relative to ``started_at``). Use ``None`` to mark "never
    happened" — keeps log lines honest when an interview died early.
    """

    sid: str = ""
    room: str = ""
    started_at: float = field(default_factory=time.monotonic)

    connect_s: float | None = None
    avatar_ready_s: float | None = None
    candidate_joined_s: float | None = None
    first_tts_s: float | None = None
    first_user_final_s: float | None = None
    turns: int = 0
    end_reason: str = "ok"
    bank_resolution: str = ""
    bank_category: str = ""
    bank_override_used: bool | None = None

    def mark(self, field_name: str) -> None:
        """Set ``field_name`` to elapsed seconds since ``started_at`` (idempotent)."""
        if not hasattr(self, field_name):
            return
        if getattr(self, field_name) is not None:
            return
        setattr(self, field_name, round(time.monotonic() - self.started_at, 3))

    def bump_turn(self) -> None:
        self.turns += 1


def _fmt(seconds: float | None) -> str:
    return "-" if seconds is None else f"{seconds:.2f}s"


def attach_session_summary(
    ctx: JobContext,
    session: AgentSession,
    *,
    sid: str = "",
    room: str = "",
) -> SessionTelemetry:
    """Wire SessionTelemetry into AgentSession events + shutdown callback.

    Captures, in order:
      * ``connect_s``           — set by caller right after ``ctx.connect()`` finishes.
      * ``avatar_ready_s``      — set by caller right after ``avatar_session.start(...)``.
      * ``first_tts_s``         — first agent speech (we hook ``agent_state_changed``
                                  to "speaking"; falls back to first ``conversation_item_added``
                                  with role="assistant").
      * ``first_user_final_s``  — first finalized user transcript.
      * ``turns``               — count of conversation items.
      * ``end_reason``          — set by the shutdown callback if ``ctx.job`` carries one.

    Returns the telemetry object so the caller can call ``.mark("connect_s")`` /
    ``.mark("avatar_ready_s")`` from the spots where those milestones happen.
    """
    tel = SessionTelemetry(sid=sid, room=room)

    def _on_user_final(ev: Any) -> None:
        try:
            if getattr(ev, "is_final", False):
                tel.mark("first_user_final_s")
        except Exception:
            pass

    def _on_conv_item(ev: Any) -> None:
        try:
            tel.bump_turn()
            item = getattr(ev, "item", None)
            role = getattr(item, "role", None) if item is not None else None
            if role == "assistant":
                tel.mark("first_tts_s")
        except Exception:
            pass

    def _on_agent_state(ev: Any) -> None:
        try:
            new_state = getattr(ev, "new_state", None) or getattr(ev, "state", None)
            if new_state == "speaking":
                tel.mark("first_tts_s")
        except Exception:
            pass

    try:
        session.on("user_input_transcribed", _on_user_final)
    except Exception as e:
        logger.debug("session_summary: user_input_transcribed hook skipped: %s", e)
    try:
        session.on("conversation_item_added", _on_conv_item)
    except Exception as e:
        logger.debug("session_summary: conversation_item_added hook skipped: %s", e)
    try:
        session.on("agent_state_changed", _on_agent_state)
    except Exception as e:
        logger.debug("session_summary: agent_state_changed hook skipped: %s", e)

    async def _emit_summary() -> None:
        try:
            duration = round(time.monotonic() - tel.started_at, 3)
            logger.info(
                "session_summary | sid=%s room=%s duration=%.2fs "
                "connect=%s avatar_ready=%s candidate_joined=%s first_tts=%s first_user_final=%s "
                "turns=%d reason=%s bank_resolution=%s bank_category=%s bank_override=%s",
                tel.sid or "-",
                tel.room or "-",
                duration,
                _fmt(tel.connect_s),
                _fmt(tel.avatar_ready_s),
                _fmt(tel.candidate_joined_s),
                _fmt(tel.first_tts_s),
                _fmt(tel.first_user_final_s),
                tel.turns,
                tel.end_reason,
                tel.bank_resolution or "-",
                tel.bank_category or "-",
                tel.bank_override_used if tel.bank_override_used is not None else "-",
            )
        except Exception as e:
            logger.debug("session_summary emit failed: %s", e)

    try:
        ctx.add_shutdown_callback(_emit_summary)
    except Exception as e:
        logger.debug("session_summary add_shutdown_callback failed: %s", e)

    return tel
