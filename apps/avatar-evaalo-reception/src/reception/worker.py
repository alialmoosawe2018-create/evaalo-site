"""AgentServer, LiveKit dispatch lifecycle, and rtc_session entrypoint."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Iterator
from typing import Any

from livekit import rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    APIConnectOptions,
    AssignmentTimeoutError,
    AutoSubscribe,
    CloseEvent,
    JobContext,
    JobProcess,
    JobRequest,
    cli,
    room_io,
)
from livekit.agents.voice.agent_session import SessionConnectOptions
from livekit.plugins import noise_cancellation
from livekit.rtc.room import ConnectError

from reception.assistant import ReceptionAssistant, TtsRouteContext
from reception.config import (
    USER_AWAY_TIMEOUT_SDK_DEFAULT,
    apply_reception_endpointing_boost,
    avatar_fast_response,
    avatar_stability_mode,
    effective_avatar_clear_buffer_timeout,
    env_allow_interruption,
    env_preemptive_generation,
    reception_discard_audio_if_uninterruptible,
    reception_false_interruption_timeout,
    reception_log_participant_events,
    reception_max_session_seconds,
    reception_min_interrupt_speech_duration,
    reception_min_interruption_words,
    reception_profile_normalized,
    reception_room_close_on_disconnect,
    reception_room_delete_on_close,
    reception_session_goodbye,
    reception_user_away_timeout,
    reception_voice_defaults_enabled,
)
from reception.factories import (
    create_avatar_session,
    create_elevenlabs_tts,
    create_openai_llm,
    create_speechmatics_stt,
    load_turn_detector_model,
    load_vad,
    maybe_warmup_elevenlabs,
)
from reception.metrics_hooks import attach_metrics_hooks
from reception.session_summary import attach_session_summary
from reception.netutil import is_websocket_closing_error
from reception.transcript_hooks import attach_user_transcript_routing
from playback_patches import configure_and_apply_playback_patches

logger = logging.getLogger("agent")


def _agent_rtc_config() -> rtc.RtcConfiguration | None:
    """ICE policy for ``job_ctx.connect()`` (WebRTC peer + signaling).

    **Default** is SFU mix (host/srflx/relay) — often faster than TURN-only when UDP to the region works.

    - ``LIVEKIT_AGENT_ICE_MODE=all|relay|nohost`` when ``LIVEKIT_AGENT_ICE_TRANSPORT`` is unset.
    - Legacy: ``LIVEKIT_AGENT_ICE_RELAY_DEFAULT=true`` forces ``relay`` if ``ICE_MODE`` unset.
    - Explicit: ``LIVEKIT_AGENT_ICE_TRANSPORT=RELAY|NOHOST|ALL``.
    """
    from livekit.rtc.room import proto_room

    raw_in = (os.getenv("LIVEKIT_AGENT_ICE_TRANSPORT") or "").strip()
    raw = raw_in.upper()

    if raw_in:
        if raw in ("DEFAULT", "ALL", "AUTO"):
            return None
        if raw in ("RELAY", "TURN", "FORCE_RELAY"):
            return rtc.RtcConfiguration(ice_transport_type=proto_room.IceTransportType.TRANSPORT_RELAY)
        if raw in ("NOHOST",):
            return rtc.RtcConfiguration(ice_transport_type=proto_room.IceTransportType.TRANSPORT_NOHOST)
        logger.warning(
            "Ignoring invalid LIVEKIT_AGENT_ICE_TRANSPORT=%r (use RELAY, NOHOST, ALL, or leave unset)",
            raw_in,
        )
        return None

    mode = (os.getenv("LIVEKIT_AGENT_ICE_MODE") or "").strip().lower()
    if not mode:
        if os.getenv("LIVEKIT_AGENT_ICE_RELAY_DEFAULT", "false").lower() in ("1", "true", "yes"):
            mode = "relay"
        else:
            mode = "all"
    if mode in ("all", "default", "mixed", "auto", ""):
        return None
    if mode in ("relay", "turn"):
        return rtc.RtcConfiguration(ice_transport_type=proto_room.IceTransportType.TRANSPORT_RELAY)
    if mode in ("nohost",):
        return rtc.RtcConfiguration(ice_transport_type=proto_room.IceTransportType.TRANSPORT_NOHOST)
    logger.warning("Ignoring invalid LIVEKIT_AGENT_ICE_MODE=%r (use all, relay, or nohost)", mode)
    return None


def _attach_reception_room_observability(room: rtc.Room) -> None:
    """Lightweight join/leave logs (LiveKit rooms + participants). Helps debug orphan sessions / avatars."""
    if not reception_log_participant_events():
        return

    def _on_pc(p: rtc.RemoteParticipant) -> None:
        logger.info(
            "participant_connected | identity=%s kind=%s",
            getattr(p, "identity", ""),
            getattr(p, "kind", ""),
        )

    def _on_pd(p: rtc.RemoteParticipant, *args: Any) -> None:
        reason = args[0] if args else None
        logger.info(
            "participant_disconnected | identity=%s kind=%s reason=%s",
            getattr(p, "identity", ""),
            getattr(p, "kind", ""),
            reason,
        )

    try:
        room.on("participant_connected", _on_pc)
        room.on("participant_disconnected", _on_pd)
    except Exception as e:
        logger.debug("reception room observability hooks skipped: %s", e)


def _rtc_config_label(cfg: rtc.RtcConfiguration | None) -> str:
    if cfg is None:
        return "all"
    try:
        from livekit.rtc.room import proto_room

        if cfg.ice_transport_type == proto_room.IceTransportType.TRANSPORT_RELAY:
            return "relay"
        if cfg.ice_transport_type == proto_room.IceTransportType.TRANSPORT_NOHOST:
            return "nohost"
    except Exception:
        pass
    return "custom"


async def _connect_job_room(ctx: JobContext) -> None:
    """Connect early; subscribe to all remote tracks (Beyond avatar + user mic/video). See LiveKit job lifecycle."""
    rtc_cfg = _agent_rtc_config()
    label = _rtc_config_label(rtc_cfg)
    try:
        # Flaky ICE / strict NAT: extra attempts before failing (see .env.example job_entry / wait_pc_connection)
        retries = max(1, min(8, int(os.getenv("LIVEKIT_AGENT_CONNECT_RETRIES", "5"))))
    except ValueError:
        retries = 3

    last_exc: BaseException | None = None
    for attempt in range(retries):
        try:
            if attempt:
                delay = 1.2 * attempt
                logger.warning(
                    "job_ctx.connect retry %s/%s (ice=%s); sleeping %.1fs",
                    attempt + 1,
                    retries,
                    label,
                    delay,
                )
                await asyncio.sleep(delay)
            logger.info(
                "LiveKit agent: job_ctx.connect starting (ice=%s, attempt %s/%s)",
                label,
                attempt + 1,
                retries,
            )
            if attempt == 0:
                logger.info(
                    "If connect is slow: ignore the 10s job_entry warning until this await returns — "
                    "agents only flag 'connected' after full room.connect(), including ICE/PC."
                )
            t0 = time.monotonic()
            await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL, rtc_config=rtc_cfg)
            dt = time.monotonic() - t0
            logger.info("job_ctx.connect finished in %.2fs (ice=%s)", dt, label)
            if dt > 9.5:
                logger.info(
                    "Slow room connect (%.1fs): LiveKit may still log a 10s job_entry warning — OK if this line appears. "
                    "If often slow or Win 10054: check LIVEKIT_URL region, TURN in project, firewall/VPN; "
                    "try LIVEKIT_AGENT_ICE_MODE=relay behind strict NAT or all on clean UDP.",
                    dt,
                )
            return
        except ConnectError as e:
            last_exc = e
            logger.warning("job_ctx.connect ConnectError: %s", e)
        except OSError as e:
            last_exc = e
            logger.warning("job_ctx.connect OSError: %s", e)
        except Exception as e:
            last_exc = e
            logger.warning("job_ctx.connect error: %s", e)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("job_ctx.connect failed")


def _load_fnc(worker) -> float:
    try:
        active = getattr(worker, "active_jobs", None)
        if active is None:
            return 0.0
        count = len(active) if hasattr(active, "__len__") else (active() if callable(active) else 0)
        return 0.9 if count >= 1 else 0.0
    except Exception:
        return 0.0


# One LiveKit agent assignment per process at a time: load 0.9 when busy — threshold 1.0 avoids noisy "full capacity" while still rejecting extras.
server = AgentServer(load_threshold=1.0, load_fnc=_load_fnc)


async def _on_job_request(req: JobRequest) -> None:
    try:
        jobs = getattr(server, "active_jobs", None)
        if jobs is not None and len(jobs) >= 1:
            logger.debug("rejecting LiveKit dispatch (worker busy): livekit_dispatch_id=%s", req.id)
            await req.reject()
            return
    except Exception as e:
        logger.debug("busy check skipped: %s", e)
    try:
        await req.accept()
    except AssignmentTimeoutError:
        logger.debug(
            "LiveKit dispatch assignment timed out (another worker likely took it, or server delayed): livekit_dispatch_id=%s",
            req.id,
        )


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = load_vad()
    maybe_warmup_elevenlabs()


server.setup_fnc = prewarm


def _build_reception_context(meta: dict[str, Any]) -> str:
    """Human-readable context from LiveKit job metadata (reception-demo backend)."""
    if not meta:
        return ""
    lines: list[str] = []
    vid = str(meta.get("visitor_id") or "").strip()
    if vid:
        lines.append(f"- Visitor ID: {vid}")
    sid = str(meta.get("session_id") or "").strip()
    if sid:
        lines.append(f"- Session ID: {sid}")
    demo = str(meta.get("demo_mode") or "").strip()
    if demo:
        lines.append(f"- Demo mode: {demo}")
    fn = str(meta.get("visitor_first_name") or "").strip()
    ln = str(meta.get("visitor_last_name") or "").strip()
    if fn or ln:
        lines.append(f"- Visitor name: {(fn + ' ' + ln).strip()}")
    em = str(meta.get("visitor_email") or "").strip()
    if em:
        lines.append(f"- Email: {em}")
    co = str(meta.get("visitor_company") or "").strip()
    if co:
        lines.append(f"- Company: {co}")
    return "\n".join(lines)


def _reception_greeting_language_mode() -> str:
    return (
        os.getenv("RECEPTION_GREETING_LANGUAGE") or os.getenv("INITIAL_GREETING_LANGUAGE") or "ar"
    ).strip().lower()


def _reception_initial_greeting_instructions(meta: dict[str, Any]) -> str:
    """One-shot instructions for session.generate_reply — reception welcome."""
    _ = meta  # reserved for future visitor hints
    mode = _reception_greeting_language_mode()
    base = (
        "You are opening Evaalo's interactive reception demo (not a job interview). "
        "One short warm welcome: 1-2 sentences, under ~35 words. "
        "Introduce Evaalo as HR automation with AI voice and video agents. "
        "Invite the visitor to ask what they want to explore. "
        "Do not screen the visitor or ask interview-style qualification questions."
    )
    if mode in ("bilingual", "auto", "mixed"):
        return base + " Use Arabic if the visitor likely expects Arabic; otherwise English."
    if mode in ("en", "english"):
        return base + " Speak only in English."
    return (
        "أنت تفتتح تجربة استقبال تفاعلية لشركة Evaalo (ليست مقابلة توظيف). "
        "تحدّث بالعربية فقط. ترحيب قصير دافئ: جملة إلى جملتين كحد أقصى. "
        "اشرح باختصار أن ایڤالو تقدّم أتمتة لموارد بشرية مع وكلاء مقابلات صوتية وفيديو بالذكاء الاصطناعي. "
        "ادعُ الزائر ليسأل عما يهمّه. لا تطرح أسئلة فرز أو تقييم مرشّح."
    )


def _reception_greeting_short_mode_enabled() -> bool:
    """Whether to emit a one-line greeting (lower TTS time → faster perceived avatar start).

    Default ``true`` to mirror the working interview path which keeps the opening line very
    short. Set ``RECEPTION_GREETING_SHORT_MODE=false`` to fall back to the long welcome.
    """
    raw = (os.getenv("RECEPTION_GREETING_SHORT_MODE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return True


# Short opener → faster first TTS → quicker avatar start (mirrors the interview path).
_RECEPTION_GREETING_AR_SHORT = "أهلاً بك في ایڤالو. شلون أگدر أساعدك اليوم؟"

_RECEPTION_GREETING_AR = (
    "أهلا وسهلا بيك في ایڤالو. آني مساعد الاستقبال، أگدر أشرحلك شلون منصتنا تساعد فرق الموارد البشرية بالفرز والمقابلات وتقييم المرشحين. شلون أگدر أساعدك اليوم؟"
)

_RECEPTION_GREETING_EN = (
    "Welcome to Evaalo. I'm the reception assistant. I can explain how our platform helps HR teams with screening, interviews, and candidate evaluation. How can I help you today?"
)


def _canned_reception_greeting(meta: dict[str, Any]) -> str:
    """Short TTS-only welcome for the reception demo."""
    mode = _reception_greeting_language_mode()
    fn = str(meta.get("visitor_first_name") or "").strip()
    short_mode = _reception_greeting_short_mode_enabled()

    if mode in ("en", "english"):
        return _RECEPTION_GREETING_EN
    if mode in ("bilingual", "auto", "mixed"):
        if short_mode:
            hi = f"أهلاً {fn}!" if fn else "أهلاً بك!"
            return f"{hi} أنا مساعد Evaalo — كيف أقدر أساعدك؟"
        hello = f"Hello, {fn}!" if fn else "Hello!"
        return (
            f"{hello} Welcome to Evaalo — أهلاً بك. "
            "I'm here to show you our AI reception and interview experience. "
            "What would you like to know?"
        )
    # Arabic mode: short opener by default for faster avatar start; full welcome only when short mode is off.
    if short_mode:
        if fn:
            return f"أهلاً {fn}! شلون أگدر أساعدك اليوم؟"
        return _RECEPTION_GREETING_AR_SHORT
    return _RECEPTION_GREETING_AR


def _iter_audio_output_chain(audio: Any) -> Iterator[Any]:
    """Walk `AudioOutput.next_in_chain` (e.g. TranscriptSynchronizer → DataStreamAudioOutput)."""
    seen: set[int] = set()
    cur: Any = audio
    while cur is not None:
        oid = id(cur)
        if oid in seen:
            break
        seen.add(oid)
        yield cur
        cur = getattr(cur, "next_in_chain", None)


def _apply_avatar_clear_buffer(avatar_session, session: AgentSession, clear_buf: float) -> None:
    """Apply buffer timeout to LiveKit output audio (documented pipeline hook) and Beyond if present.

    Newer ``livekit-agents`` attach ``_clear_buffer_timeout`` to ``DataStreamAudioOutput`` (inner
    ``next_in_chain``), not to ``TranscriptSynchronizer``'s ``_SyncedAudioOutput``. Setting only the
    outer node leaves the default (~2s) and reproduces arbitrary playout + duplicate
    ``playback_finished`` warnings.
    """
    audio = getattr(session.output, "audio", None)
    if audio is not None:
        applied = False
        for node in _iter_audio_output_chain(audio):
            if hasattr(node, "_clear_buffer_timeout"):
                try:
                    node._clear_buffer_timeout = clear_buf  # type: ignore[attr-defined]
                    logger.debug(
                        "avatar clear_buffer_timeout=%ss (%s)",
                        clear_buf,
                        type(node).__name__,
                    )
                    applied = True
                except Exception as ex:
                    logger.debug(
                        "avatar clear_buffer_timeout skip %s: %s",
                        type(node).__name__,
                        ex,
                    )
        if not applied:
            logger.debug(
                "avatar clear_buffer_timeout=%ss not applied (no _clear_buffer_timeout in chain from %s)",
                clear_buf,
                type(audio).__name__,
            )
    if hasattr(avatar_session, "clear_buffer_timeout"):
        try:
            avatar_session.clear_buffer_timeout = clear_buf  # type: ignore[attr-defined]
            logger.debug("avatar_session.clear_buffer_timeout=%ss", clear_buf)
        except Exception as ex:
            logger.debug("avatar_session.clear_buffer_timeout skip: %s", ex)


def _livekit_room_text_output_options() -> room_io.TextOutputOptions:
    """Room transcription → ``lk.transcription`` (see LiveKit multimodality text + text streams docs).

    - ``sync_transcription=False`` (default here): no ``TranscriptSynchronizer`` — assistant text hits
      the room as soon as the pipeline produces it (snappier CHAT / delta feel).
    - ``sync_transcription=True``: text paced to audio output (tighter subtitle–lip alignment; can feel
      slightly less “instant” in the transcript panel).

    Docs: https://docs.livekit.io/agents/multimodality/text/
    Text streams: https://docs.livekit.io/transport/data/text-streams/
    """
    sync = os.getenv("LIVEKIT_SYNC_TRANSCRIPTION", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    raw_sf = (os.getenv("LIVEKIT_TRANSCRIPTION_SPEED_FACTOR") or "").strip()
    speed = 1.0
    if raw_sf:
        try:
            speed = float(raw_sf)
        except ValueError:
            logger.warning("Invalid LIVEKIT_TRANSCRIPTION_SPEED_FACTOR=%r (using 1.0)", raw_sf)
    speed = max(0.25, min(4.0, speed))
    return room_io.TextOutputOptions(
        sync_transcription=sync,
        transcription_speed_factor=speed,
    )


@server.rtc_session(agent_name="evaalo-reception-agent", on_request=_on_job_request)
async def my_agent(ctx: JobContext):
    # Connect before anything else — minimizes time-to-_ctx_connect for LiveKit job_entry watchdog.
    _session_t0 = time.monotonic()
    await _connect_job_room(ctx)
    _attach_reception_room_observability(ctx.room)
    _connect_seconds = round(time.monotonic() - _session_t0, 3)
    ctx.log_context_fields = {"room": ctx.room.name, "agent_name": "evaalo-reception-agent"}
    logger.debug(
        "connected to room | room=%s livekit_dispatch_id=%s",
        ctx.room.name if ctx.room else "N/A",
        ctx.job.id if ctx.job else "N/A",
    )

    meta: dict[str, Any] = {}
    if ctx.job and ctx.job.metadata:
        try:
            raw_meta = json.loads(ctx.job.metadata)
            if isinstance(raw_meta, dict):
                meta = raw_meta
            else:
                logger.warning("job metadata is not a JSON object: %s", type(raw_meta).__name__)
            logger.debug("job metadata: %s", meta)
        except Exception as e:
            logger.warning("metadata parse failed: %s", e)

    reception_context = _build_reception_context(meta)
    # Pin RoomIO to the demo visitor (same identity as backend token: guest-{visitorId}).
    # Otherwise the first eligible remote participant (e.g. avatar worker) can be linked as "the user",
    # breaking close_on_disconnect and session cleanup when the real visitor leaves.
    _linked_visitor_identity: str | None = None
    _vid = meta.get("visitor_id")
    if _vid is not None and str(_vid).strip():
        _linked_visitor_identity = f"guest-{str(_vid).strip()}"
        logger.debug("RoomIO will link participant_identity=%s", _linked_visitor_identity)

    _iv = reception_voice_defaults_enabled()

    avatar_session = create_avatar_session()
    tts, voice_id, tts_language, supports_override = create_elevenlabs_tts()

    try:
        stt = create_speechmatics_stt()
    except Exception as e:
        logger.error("STT failed: %s", e)
        raise

    llm = create_openai_llm()

    vad_model = ctx.proc.userdata.get("vad")
    # Production default: contextual turn detector (LiveKit MultilingualModel) — requires VAD.
    # https://docs.livekit.io/agents/logic/turns/turn-detector/
    # Resolution order:
    #   1) TURN_DETECTOR_MODEL=multilingual|english + VAD available  → contextual model
    #   2) VAD disabled (DISABLE_VAD=true)                            → "stt" (Speechmatics EOU)
    #   3) Fallback (TURN_DETECTOR_MODEL unset/off + VAD available)   → "vad" (Silero alone)
    turn_detector_model = load_turn_detector_model() if vad_model is not None else None
    _turn_detector_env = (os.getenv("TURN_DETECTOR_MODEL") or "").strip().lower()
    if turn_detector_model is not None:
        turn_detection: Any = turn_detector_model
        turn_detection_label = type(turn_detector_model).__name__
    elif vad_model is None:
        turn_detection = "stt"
        turn_detection_label = "stt"
    else:
        turn_detection = "vad"
        turn_detection_label = "vad"
        if _turn_detector_env in ("", "off", "disabled", "none"):
            logger.info(
                "Turn detector: TURN_DETECTOR_MODEL is unset → using plain Silero VAD. "
                "For better Arabic/English turn-taking, set TURN_DETECTOR_MODEL=multilingual "
                "and run: uv run python -m livekit.agents.cli download-files"
            )
    # With Speechmatics + turn_detection=stt, min is applied *after* STT EOU (additive).
    # Applied after Speechmatics end-of-utterance — lower = agent starts sooner when you stop talking.
    _default_min_ept = "0.05" if reception_profile_normalized() == "latency" else "0.08"
    min_ept = float(os.getenv("MIN_ENDPOINTING_DELAY", _default_min_ept))
    max_ept = float(os.getenv("MAX_ENDPOINTING_DELAY", "2.0"))
    min_ept, max_ept = apply_reception_endpointing_boost(min_ept, max_ept)
    preemptive = env_preemptive_generation()
    allow_interrupt = env_allow_interruption()
    logger.info(
        "interruption policy | allow_interruptions=%s RECEPTION_FORCE_ALLOW_INTERRUPTION=%r "
        "RECEPTION_HARD_NO_INTERRUPT=%r ALLOW_INTERRUPTION=%r MIN_INTERRUPTION_DURATION=%r "
        "MIN_ENDPOINTING_DELAY=%r (legacy INTERVIEW_* env names still apply if RECEPTION_* unset; "
        "if values mismatch .env.local, fix working directory or LiveKit Cloud env)",
        allow_interrupt,
        os.getenv("RECEPTION_FORCE_ALLOW_INTERRUPTION") or os.getenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION"),
        os.getenv("RECEPTION_HARD_NO_INTERRUPT") or os.getenv("INTERVIEW_HARD_NO_INTERRUPT"),
        os.getenv("ALLOW_INTERRUPTION"),
        os.getenv("MIN_INTERRUPTION_DURATION"),
        os.getenv("MIN_ENDPOINTING_DELAY"),
    )
    tts_timeout = float(os.getenv("ELEVENLABS_TTS_TIMEOUT", "30"))
    tts_retry = float(os.getenv("ELEVENLABS_TTS_RETRY_INTERVAL", "1.5"))
    tts_conn = APIConnectOptions(timeout=tts_timeout, max_retry=5, retry_interval=tts_retry)
    # STT control-plane / slow networks: LiveKit APIConnectOptions wraps HTTP-ish retries; RT WebSocket is separate but shared job can block.
    stt_timeout = float(os.getenv("SPEECHMATICS_HTTP_TIMEOUT", "45"))
    llm_timeout = float(os.getenv("OPENAI_HTTP_TIMEOUT", "30"))
    conn_options = SessionConnectOptions(
        stt_conn_options=APIConnectOptions(timeout=stt_timeout, max_retry=3, retry_interval=2.0),
        llm_conn_options=APIConnectOptions(timeout=llm_timeout, max_retry=3, retry_interval=1.5),
        tts_conn_options=tts_conn,
    )

    # DataStreamIO (avatar path) does not support pause — resume_false_interruption is ignored and logs noise.
    resume_false_interruption = os.getenv("RESUME_FALSE_INTERRUPTION", "false").lower() in (
        "1",
        "true",
        "yes",
    )

    min_intr = reception_min_interrupt_speech_duration()
    false_intr_to = reception_false_interruption_timeout()
    discard_unintr = reception_discard_audio_if_uninterruptible()
    _mcsd_default = "0.10" if _iv else "0.0"
    if _iv and avatar_stability_mode() and not avatar_fast_response():
        _mcsd_default = "0.20"  # slight gap between playout segments → calmer Beyond lip-sync
    if _iv and avatar_fast_response():
        # Lower gap between TTS segments → faster perceived turn-taking (raise if audio sounds choppy).
        _mcsd_default = "0.07"
    min_consecutive_speech_delay = float(os.getenv("MIN_CONSECUTIVE_SPEECH_DELAY", _mcsd_default))

    _session_extras: dict[str, Any] = {}
    _u_away = reception_user_away_timeout()
    if _u_away is not USER_AWAY_TIMEOUT_SDK_DEFAULT:
        _session_extras["user_away_timeout"] = _u_away
    _min_iw = reception_min_interruption_words()
    if _min_iw is not None:
        _session_extras["min_interruption_words"] = _min_iw

    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        turn_detection=turn_detection,
        vad=None if turn_detection == "stt" else vad_model,  # turn detector model still needs VAD
        allow_interruptions=allow_interrupt,
        preemptive_generation=preemptive,
        resume_false_interruption=resume_false_interruption,
        min_endpointing_delay=min_ept,
        max_endpointing_delay=max_ept,
        min_interruption_duration=min_intr,
        false_interruption_timeout=false_intr_to,
        discard_audio_if_uninterruptible=discard_unintr,
        min_consecutive_speech_delay=min_consecutive_speech_delay,
        # Avatar path: better transcript timing to avatar worker (LiveKit virtual avatar overview)
        use_tts_aligned_transcript=True,
        conn_options=conn_options,
        **_session_extras,
    )
    logger.info(
        "AgentSession | turn=%s preemptive=%s interrupt=%s endpointing=%.2f/%.2f "
        "min_intr=%.2fs min_intr_words=%s false_intr_to=%s discard_unintr=%s",
        turn_detection_label,
        preemptive,
        allow_interrupt,
        min_ept,
        max_ept,
        min_intr,
        _min_iw if _min_iw is not None else "sdk-default",
        false_intr_to if false_intr_to is not None else "off",
        discard_unintr,
    )

    # Observability: per-event EOU/LLM/TTS/STT lines + final usage summary on shutdown.
    # https://docs.livekit.io/agents/build/metrics/
    attach_metrics_hooks(session, ctx=ctx)

    # One-line per-session timing summary on shutdown (start/connect/avatar_ready/first_tts/end).
    _session_tel = attach_session_summary(
        ctx,
        session,
        sid=ctx.job.id if ctx.job else "",
        room=ctx.room.name if ctx.room else "",
    )
    _session_tel.started_at = _session_t0  # align with worker entry, not summary attach time
    _session_tel.connect_s = _connect_seconds

    english_voice_id = (
        os.getenv("ELEVENLABS_RECEPTION_ENGLISH_VOICE_ID")
        or os.getenv("ELEVENLABS_ENGLISH_VOICE_ID")
        or ""
    ).strip() or voice_id
    arabic_voice_id = voice_id
    tts_route_cooldown_ms = float(os.getenv("TTS_LANG_SWITCH_COOLDOWN_MS", "2800" if _iv else "2500"))
    tts_router = TtsRouteContext(
        tts,
        arabic_voice_id=arabic_voice_id,
        english_voice_id=english_voice_id,
        supports_override=supports_override,
        cooldown_ms=tts_route_cooldown_ms,
        initial_voice_id=voice_id,
        initial_language=tts_language if supports_override else "n/a",
    )
    attach_user_transcript_routing(session, tts_router, reception_voice_defaults=_iv)

    if avatar_session:
        try:
            await avatar_session.start(agent_session=session, room=ctx.room)
            logger.debug("AvatarSession started")
            _session_tel.mark("avatar_ready_s")
            clear_buf = effective_avatar_clear_buffer_timeout()
            _apply_avatar_clear_buffer(avatar_session, session, clear_buf)
        except Exception as e:
            logger.error("AvatarSession start failed: %s", e, exc_info=True)
            avatar_session = None
            _session_tel.end_reason = "avatar_start_failed"

    # LiveKit virtual avatar: avatar.start before session.start; room audio_output=None so TTS → avatar worker
    # (not room). use_tts_aligned_transcript helps lip sync. See https://docs.livekit.io/agents/models/avatar/
    reception_agent = ReceptionAssistant(
        tts_router=tts_router,
        allow_interruptions=allow_interrupt,
        reception_context=reception_context or None,
    )

    _room_opts_kw: dict[str, Any] = {
        "audio_input": room_io.AudioInputOptions(
            noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
            if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
            else noise_cancellation.BVC(),
        ),
        "text_output": _livekit_room_text_output_options(),
        "audio_output": None,
        "close_on_disconnect": reception_room_close_on_disconnect(),
        "delete_room_on_close": reception_room_delete_on_close(),
    }
    if _linked_visitor_identity:
        _room_opts_kw["participant_identity"] = _linked_visitor_identity

    try:
        await session.start(
            agent=reception_agent,
            room=ctx.room,
            room_options=room_io.RoomOptions(**_room_opts_kw),
        )
        logger.debug("AgentSession started")
    except Exception as e:
        logger.error("AgentSession start failed: %s", e, exc_info=True)
        _session_tel.end_reason = "session_start_failed"
        raise

    if os.getenv("SKIP_INITIAL_GREETING", "0") != "1":
        try:
            use_llm_raw = os.getenv("RECEPTION_GREETING_USE_LLM") or os.getenv(
                "INITIAL_GREETING_USE_LLM", "false"
            )
            use_llm = use_llm_raw.lower() in (
                "1",
                "true",
                "yes",
            )
            if use_llm:
                await session.generate_reply(
                    instructions=_reception_initial_greeting_instructions(meta),
                    allow_interruptions=allow_interrupt,
                )
                logger.debug("initial greeting: LLM path (reception)")
            else:
                text = _canned_reception_greeting(meta).strip()
                if text:
                    await session.say(text, allow_interruptions=allow_interrupt)
                    logger.debug("initial greeting: TTS-only (reception canned)")
        except Exception as e:
            logger.warning("initial greeting failed: %s", e)

    exit_session = asyncio.Event()

    def _on_room_session_exit(*_: Any) -> None:
        exit_session.set()

    def _on_agent_session_close(_ev: CloseEvent) -> None:
        # Participant left → RoomIO closes AgentSession; the room may still be connected.
        # Job runner only advances after ctx.shutdown() or room disconnect (see livekit.agents job.run_job).
        # Defer shutdown so AgentSession._aclose_impl can finish its lock + RoomIO teardown after "close".
        def _deferred() -> None:
            try:
                ctx.shutdown("agent_session_closed")
            except Exception as ex:
                logger.debug("ctx.shutdown after session close skipped: %s", ex)
            exit_session.set()

        asyncio.get_running_loop().call_soon(_deferred)

    # Hard time limit for the reception demo: say a short goodbye, then close the room
    # so the visitor can reconnect for a fresh session. Disable with RECEPTION_MAX_SESSION_SECONDS=0.
    max_session_s = reception_max_session_seconds()
    time_limit_task: asyncio.Task[None] | None = None

    async def _enforce_session_time_limit(limit_s: float) -> None:
        try:
            await asyncio.sleep(limit_s)
        except asyncio.CancelledError:
            return
        logger.info("reception session time limit reached (%.0fs); closing", limit_s)
        _session_tel.end_reason = "time_limit"
        try:
            goodbye = reception_session_goodbye(_reception_greeting_language_mode())
            if goodbye:
                await session.say(goodbye, allow_interruptions=False)
        except Exception as ex:
            logger.debug("time-limit goodbye failed: %s", ex)
        try:
            ctx.shutdown("session_time_limit")
        except Exception as ex:
            logger.debug("ctx.shutdown on time limit skipped: %s", ex)
        exit_session.set()

    try:
        if hasattr(ctx.room, "on"):
            ctx.room.on("disconnected", _on_room_session_exit)
        session.on("close", _on_agent_session_close)
        if max_session_s > 0:
            time_limit_task = asyncio.create_task(
                _enforce_session_time_limit(max_session_s)
            )
        try:
            await asyncio.wait_for(exit_session.wait(), timeout=3600.0)
        except asyncio.TimeoutError:
            pass
        except asyncio.CancelledError:
            raise
        except Exception as wait_err:
            if is_websocket_closing_error(wait_err):
                logger.debug("session exit wait: websocket closing")
            else:
                while ctx.room and getattr(
                    ctx.room, "connection_state", getattr(ctx.room, "state", 0)
                ) != rtc.ConnectionState.CONN_DISCONNECTED:
                    try:
                        await asyncio.sleep(1.0)
                    except asyncio.CancelledError:
                        raise
                    except Exception as poll_err:
                        if is_websocket_closing_error(poll_err):
                            break
                        logger.warning("room poll: %s", poll_err)
                        break
    except asyncio.CancelledError:
        logger.debug("agent cancelled")
        _session_tel.end_reason = "cancelled"
        raise
    except Exception as e:
        if not is_websocket_closing_error(e):
            logger.error("main loop error: %s", e, exc_info=True)
            _session_tel.end_reason = "main_loop_error"
        else:
            _session_tel.end_reason = "ws_closed"
    finally:
        if time_limit_task is not None and not time_limit_task.done():
            time_limit_task.cancel()
        if hasattr(ctx.room, "on"):
            try:
                ctx.room.off("disconnected", _on_room_session_exit)
            except Exception:
                pass
        try:
            session.off("close", _on_agent_session_close)
        except Exception:
            pass
        # Beyond / avatar: close local avatar session. Do not await AgentSession.aclose() here:
        # session.start() registers JobContext shutdown callbacks that call _aclose_impl on job teardown.
        logger.debug("cleanup (avatar; AgentSession teardown via job shutdown callbacks)")
        if avatar_session:
            try:
                if hasattr(avatar_session, "aclose"):
                    await avatar_session.aclose()
            except Exception as e:
                if not is_websocket_closing_error(e):
                    logger.warning("avatar cleanup: %s", e)
            avatar_session = None
        logger.debug("cleanup done")


def run() -> None:
    configure_and_apply_playback_patches()
    cli.run_app(server)


if __name__ == "__main__":
    run()
