"""LiveKit AgentSession metrics observability.

Wires the SDK's ``metrics_collected`` event into our structured "agent" logger so
we can answer concrete questions during cold-start regressions and audio-quality
incidents without wading through the full LiveKit debug log:

* "How long did the LLM take to first token?"            -> ``LLMMetrics.ttft``
* "How long did TTS take to first byte?"                 -> ``TTSMetrics.ttfb``
* "How long between user stop and our reply starting?"   -> ``EOUMetrics.end_of_utterance_delay``
* "How many tokens are we burning per turn?"             -> ``UsageCollector`` summary

References:
    https://docs.livekit.io/agents/build/metrics/
    https://docs.livekit.io/deploy/observability/data/
"""

from __future__ import annotations

import logging
import os
from typing import Any

from livekit.agents import AgentSession, JobContext, MetricsCollectedEvent, metrics

logger = logging.getLogger("agent")

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


def _level() -> int:
    raw = (os.getenv("METRICS_LOG_LEVEL") or "info").strip().lower()
    return _LEVELS.get(raw, logging.INFO)


def _enabled() -> bool:
    raw = (os.getenv("METRICS_OBSERVABILITY") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _ms(seconds: float | None) -> str:
    if seconds is None:
        return "n/a"
    return f"{seconds * 1000:.0f}ms"


def _summarize_eou(m: metrics.EOUMetrics) -> str:
    return (
        "EOU "
        f"end_of_utterance={_ms(m.end_of_utterance_delay)} "
        f"transcription={_ms(m.transcription_delay)} "
        f"on_user_turn={_ms(m.on_user_turn_completed_delay)} "
        f"speech_id={m.speech_id or '-'}"
    )


def _summarize_llm(m: metrics.LLMMetrics) -> str:
    cancelled = " cancelled=true" if getattr(m, "cancelled", False) else ""
    return (
        f"LLM[{m.label}] "
        f"ttft={_ms(m.ttft)} "
        f"duration={_ms(m.duration)} "
        f"prompt={m.prompt_tokens}({m.prompt_cached_tokens}cached) "
        f"completion={m.completion_tokens} "
        f"tps={m.tokens_per_second:.1f}"
        f"{cancelled}"
    )


def _summarize_tts(m: metrics.TTSMetrics) -> str:
    cancelled = " cancelled=true" if getattr(m, "cancelled", False) else ""
    return (
        f"TTS[{m.label}] "
        f"ttfb={_ms(m.ttfb)} "
        f"duration={_ms(m.duration)} "
        f"audio={_ms(m.audio_duration)} "
        f"chars={m.characters_count}"
        f"{cancelled}"
    )


def _summarize_stt(m: metrics.STTMetrics) -> str:
    return (
        f"STT[{m.label}] "
        f"duration={_ms(m.duration)} "
        f"audio={_ms(m.audio_duration)} "
        f"streamed={m.streamed}"
    )


def attach_metrics_hooks(
    session: AgentSession,
    ctx: JobContext | None = None,
) -> metrics.UsageCollector | None:
    """Subscribe to ``metrics_collected`` and log a concise per-event summary.

    Also accumulates token usage in a ``UsageCollector``; when ``ctx`` is given,
    a final usage summary is logged via a shutdown callback so the line lands
    in the same job log on graceful disconnect.

    Returns the ``UsageCollector`` so callers may inspect mid-session totals if
    they want; pass ``None`` to opt out of cleanup wiring.

    Set ``METRICS_OBSERVABILITY=false`` to disable entirely.
    Set ``METRICS_LOG_LEVEL=debug`` to demote the per-event lines if they get noisy.
    """
    if not _enabled():
        logger.debug("metrics observability disabled (METRICS_OBSERVABILITY=false)")
        return None

    log_level = _level()
    usage_collector = metrics.UsageCollector()

    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        m: Any = ev.metrics
        try:
            usage_collector.collect(m)
        except Exception as e:
            logger.debug("usage_collector.collect failed: %s", e)

        try:
            if isinstance(m, metrics.EOUMetrics):
                logger.log(log_level, _summarize_eou(m))
            elif isinstance(m, metrics.LLMMetrics):
                logger.log(log_level, _summarize_llm(m))
            elif isinstance(m, metrics.TTSMetrics):
                logger.log(log_level, _summarize_tts(m))
            elif isinstance(m, metrics.STTMetrics):
                logger.log(log_level, _summarize_stt(m))
            else:
                logger.debug("metric: %s", m)
        except Exception as e:
            logger.debug("metrics summarize failed: %s", e)

    session.on("metrics_collected", _on_metrics)
    logger.debug("metrics_collected hook attached (level=%s)", logging.getLevelName(log_level))

    if ctx is not None:
        async def _log_usage() -> None:
            try:
                summary = usage_collector.get_summary()
                logger.info("usage summary | %s", summary)
            except Exception as e:
                logger.debug("usage summary failed: %s", e)

        try:
            ctx.add_shutdown_callback(_log_usage)
        except Exception as e:
            logger.debug("add_shutdown_callback failed: %s", e)

    return usage_collector
