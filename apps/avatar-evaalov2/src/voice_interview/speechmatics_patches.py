"""Monkey-patches for livekit-plugins-speechmatics + speechmatics-rt.

- ChanClosed: ignore when EOU fallback races session teardown.
- WebSocket ConnectionConfig: inject open_timeout / ping_* from env (plugin does not expose them).
"""

from __future__ import annotations

import dataclasses
import logging
import os

logger = logging.getLogger("speechmatics_patches")


def _env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        logger.warning("speechmatics: invalid %s=%r (ignored)", name, raw)
        return None


def _merge_speechmatics_connection_config(existing):
    """Apply SPEECHMATICS_WS_* env overrides; returns existing if no overrides."""
    try:
        from speechmatics.rt import ConnectionConfig
    except ImportError:
        return existing

    base = existing if existing is not None else ConnectionConfig()
    kw: dict[str, float] = {}
    ot = _env_float("SPEECHMATICS_WS_OPEN_TIMEOUT_SEC")
    if ot is not None:
        kw["open_timeout"] = ot
    pi = _env_float("SPEECHMATICS_WS_PING_INTERVAL_SEC")
    if pi is not None:
        kw["ping_interval"] = pi
    pt = _env_float("SPEECHMATICS_WS_PING_TIMEOUT_SEC")
    if pt is not None:
        kw["ping_timeout"] = pt
    if not kw:
        return existing
    merged = dataclasses.replace(base, **kw)
    logger.debug(
        "speechmatics: ConnectionConfig from env open_timeout=%s ping_interval=%s ping_timeout=%s",
        getattr(merged, "open_timeout", None),
        getattr(merged, "ping_interval", None),
        getattr(merged, "ping_timeout", None),
    )
    return merged


def apply_speechmatics_ws_connection_patch() -> None:
    """Let AsyncClient use longer WS handshake / ping timeouts (slow VPN, Middle East-EU RT)."""
    try:
        from speechmatics.rt import AsyncClient
    except ImportError as e:
        logger.debug("speechmatics WS patch skipped (speechmatics-rt): %s", e)
        return

    if getattr(AsyncClient.__init__, "_lk_speechmatics_ws_patch", False):
        return

    _orig_init = AsyncClient.__init__

    def _patched_async_client_init(self, auth=None, *, api_key=None, url=None, conn_config=None):  # type: ignore[no-redef]
        conn_config = _merge_speechmatics_connection_config(conn_config)
        _orig_init(self, auth, api_key=api_key, url=url, conn_config=conn_config)

    _patched_async_client_init._lk_speechmatics_ws_patch = True  # type: ignore[attr-defined]
    AsyncClient.__init__ = _patched_async_client_init  # type: ignore[method-assign]
    logger.debug("speechmatics: AsyncClient ConnectionConfig env merge patch applied")


def apply_speechmatics_chan_closed_patch() -> None:
    try:
        from livekit.plugins.speechmatics import stt as sm_stt

        _orig = sm_stt.SpeechStream._send_frames

        def _send_frames_safe(self, finalized: bool = False) -> None:
            try:
                return _orig(self, finalized)
            except Exception as e:
                if e.__class__.__name__ != "ChanClosed":
                    raise
                logger.debug(
                    "Speechmatics: STT event channel closed (session ended), ignoring send (EOU fallback race)"
                )

        sm_stt.SpeechStream._send_frames = _send_frames_safe
        logger.debug("speechmatics: ChanClosed-safe _send_frames patch applied")
    except Exception as e:
        logger.warning("speechmatics ChanClosed patch skipped: %s", e)


def apply_all_speechmatics_patches() -> None:
    """Apply patches that must run before any SpeechStream / AsyncClient is created."""
    apply_speechmatics_ws_connection_patch()
    apply_speechmatics_chan_closed_patch()
