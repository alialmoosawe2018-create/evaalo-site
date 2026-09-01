"""Keep-warm ping detection (kept dependency-free so tests import it cheaply).

The backend heartbeat periodically dispatches a throwaway room to keep this
worker's container warm, so the first real interview after an idle stretch /
redeploy does not pay the ~20s cold-start (container boot + plugin preload).
``worker.my_agent`` calls :func:`is_keep_warm_job` right after connect + metadata
parse and returns immediately for such pings — no avatar / LLM / TTS started.
"""

from __future__ import annotations

from typing import Any

_TRUTHY = ("1", "true", "yes")


def is_keep_warm_job(meta: dict[str, Any] | None, room_name: str | None) -> bool:
    """True for a backend keep-warm ping.

    A ping carries metadata ``warmup`` truthy (``"1"``/``"true"``/``"yes"``)
    and/or a room name containing ``warmup``.
    """
    if str((meta or {}).get("warmup") or "").strip().lower() in _TRUTHY:
        return True
    return "warmup" in (room_name or "").lower()
