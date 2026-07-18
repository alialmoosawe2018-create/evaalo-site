"""AgentServer, job lifecycle, and rtc_session entrypoint."""

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
    JobContext,
    JobProcess,
    JobRequest,
    cli,
    room_io,
)
from livekit.agents.voice.agent_session import SessionConnectOptions
from livekit.plugins import noise_cancellation
from livekit.rtc.room import ConnectError

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.config import (
    apply_interview_endpointing_boost,
    avatar_fast_response,
    avatar_stability_mode,
    effective_avatar_clear_buffer_timeout,
    env_allow_interruption,
    env_preemptive_generation,
    interview_defaults_enabled,
    interview_discard_audio_if_uninterruptible,
    interview_false_interruption_timeout,
    interview_min_interruption_duration,
    interview_profile_normalized,
)
from voice_interview.factories import (
    create_avatar_session,
    create_elevenlabs_tts,
    create_openai_llm,
    create_speechmatics_stt,
    load_turn_detector_model,
    load_vad,
    maybe_warmup_elevenlabs,
    preflight_elevenlabs_voice,
)
from voice_interview.metrics_hooks import attach_metrics_hooks
from voice_interview.session_summary import attach_session_summary
from voice_interview.job_questions import (
    format_questions_block,
    position_slug_from_meta,
    primary_job_id_from_meta,
    resolve_livekit_questions,
)
from voice_interview.entity_policy import build_role_glossary
from voice_interview.experience_tracks import parse_experience_tracks, parse_interview_paths
from voice_interview.netutil import is_websocket_closing_error
from voice_interview.transcript_hooks import attach_user_transcript_routing
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


# Single interview job per process: load 0.9 at one job — threshold 1.0 avoids noisy "full capacity" while still rejecting extras
server = AgentServer(load_threshold=1.0, load_fnc=_load_fnc)


async def _on_job_request(req: JobRequest) -> None:
    try:
        jobs = getattr(server, "active_jobs", None)
        if jobs is not None and len(jobs) >= 1:
            logger.debug("rejecting job (worker busy): job_id=%s", req.id)
            await req.reject()
            return
    except Exception as e:
        logger.debug("busy check skipped: %s", e)
    try:
        await req.accept()
    except AssignmentTimeoutError:
        logger.debug(
            "job assignment timed out (another worker likely took it, or server delayed): job_id=%s",
            req.id,
        )


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = load_vad()
    maybe_warmup_elevenlabs()


server.setup_fnc = prewarm


def _neutral_greeting_address() -> bool:
    raw = (os.getenv("INITIAL_GREETING_NEUTRAL_ADDRESS") or "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _parse_blueprint(meta: dict[str, Any]) -> dict[str, Any] | None:
    """Parse the specialized interview blueprint injected by the backend (metadata.blueprint).

    Returns a dict with ``anchorQuestions`` and ``competencies`` when present and valid,
    otherwise ``None`` (the agent then falls back to the legacy question bank).
    """
    raw = meta.get("blueprint")
    if not raw:
        return None
    try:
        bp = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.warning("blueprint parse failed: %s", e)
        return None
    if not isinstance(bp, dict):
        return None
    anchors = bp.get("anchorQuestions") or []
    if not isinstance(anchors, list) or not anchors:
        return None
    return bp


def _format_blueprint_block(
    bp: dict[str, Any],
    expertise_prompt: str,
    domain_guidance: str,
) -> str:
    """Build the specialized interview block (layers 2/3/4) from the blueprint metadata.

    Layer 2 = domain_guidance, Layer 3 = expertise_prompt, Layer 4 = blueprint (anchors + competencies).
    Keeps the fair 3+2 model: 3 fixed anchor questions for all candidates + adaptive follow-ups.
    """
    lines: list[str] = []
    dg = (domain_guidance or "").strip()
    if dg:
        lines.extend(["", "DOMAIN KNOWLEDGE (use this expertise to interview like a specialist):", dg])
    ep = (expertise_prompt or "").strip()
    if ep:
        lines.extend(["", "JOB EXPERTISE (how to think for THIS specific role):", ep])

    anchors = [str(q).strip() for q in (bp.get("anchorQuestions") or []) if str(q).strip()]
    lines.extend(
        [
            "",
            "INTERVIEW BLUEPRINT — CORE QUESTIONS (fixed for ALL candidates of this campaign; "
            "reshape into one short SPOKEN question in the candidate's language — never translate "
            "word-for-word, never read verbatim):",
        ]
    )
    for i, q in enumerate(anchors[:3], 1):
        lines.append(f"  {i}. {q}")

    competencies = bp.get("competencies") or []
    if isinstance(competencies, list) and competencies:
        lines.extend(["", "COMPETENCIES TO ASSESS (drive your follow-ups from these):"])
        for c in competencies[:6]:
            if not isinstance(c, dict):
                continue
            title = str(c.get("title") or c.get("key") or "").strip()
            objective = str(c.get("objective") or "").strip()
            evidence = [str(e).strip() for e in (c.get("evidence") or []) if str(e).strip()]
            red_flags = [str(e).strip() for e in (c.get("redFlags") or []) if str(e).strip()]
            follow_ups = [str(e).strip() for e in (c.get("followUps") or []) if str(e).strip()]
            if title:
                lines.append(f"- {title}" + (f": {objective}" if objective else ""))
            if evidence:
                lines.append(f"    Strong answer shows: {', '.join(evidence)}")
            if red_flags:
                lines.append(f"    Red flags: {', '.join(red_flags)}")
            if follow_ups:
                lines.append(f"    Follow-up if needed: {' | '.join(follow_ups)}")

    lines.extend(
        [
            "",
            "3+2 GUIDANCE (specialized mode):",
            "- Ask the 3 core questions above to every candidate (same backbone → fair comparison).",
            "- After each anchor answer, ask at least 2 adaptive follow-ups tailored to THIS candidate's answer and CV, "
            "guided by the competency evidence/red-flags/follow-up rules above (max 2 per topic, then pivot).",
            "- If an answer is generic, ask for a specific real example, the data/steps used, and the outcome.",
            "- Evaluate on evidence, not confidence or answer length. Do not invent facts not in the role/domain context.",
        ]
    )
    return "\n".join(lines)


def _build_interview_context(meta: dict[str, Any]) -> str:
    """Human-readable block from LiveKit job metadata (backend video-interview routes)."""
    if not meta:
        return ""
    lines: list[str] = []
    name = str(meta.get("candidate_name") or "").strip()
    if name:
        lines.append(f"- Candidate name: {name}")
    gender = str(meta.get("candidate_gender") or "").strip().lower()
    if gender in ("female", "male"):
        lines.append(f"- Candidate gender: {gender}")
    cid = str(meta.get("candidate_id") or "").strip()
    if cid:
        lines.append(f"- Candidate ID: {cid}")
    sid = str(meta.get("session_id") or "").strip()
    if sid:
        lines.append(f"- Session ID: {sid}")
    pos = str(meta.get("position") or "").strip()
    if pos and pos.upper() != "N/A":
        lines.append(f"- Role applied for: {pos}")
    job_pk = primary_job_id_from_meta(meta)
    slug_pk = position_slug_from_meta(meta)
    lines.append(f"- Question bank primary job_id (metadata): {job_pk or '(none)'}")
    lines.append(f"- Question bank position_slug: {slug_pk or '(none)'}")
    bank = resolve_livekit_questions(meta)
    lines.append(
        f"- Question bank resolution: {bank.resolution}"
        + (f" (matched_key={bank.matched_key})" if bank.matched_key else "")
    )
    if bank.category:
        lines.append(f"- Question bank category: {bank.category}")
    if bank.industry_family:
        lines.append(f"- Question bank industry_family: {bank.industry_family}")
    if bank.question_bank_source:
        lines.append(f"- Question bank source: {bank.question_bank_source}")
    lines.append(f"- Question bank override_used: {'true' if bank.override_used else 'false'}")
    for key, label in (
        ("company_applied_to", "Company applied to"),
        ("highest_education_level", "Highest education level"),
        ("years_of_experience", "Years of experience"),
        ("certifications", "Certifications"),
        ("company", "Company"),
    ):
        v = str(meta.get(key) or "").strip()
        if v:
            lines.append(f"- {label}: {v}")
    # Specialized path: a locked Interview Blueprint (layers 2/3/4) takes precedence over the
    # legacy static question bank. Falls back safely to the bank when no blueprint is present.
    blueprint = _parse_blueprint(meta)
    if blueprint is not None:
        expertise_prompt = str(meta.get("expertise_prompt") or "").strip()
        domain_guidance = str(meta.get("domain_guidance") or "").strip()
        # تشخيص فقط: مستوى عمق المعرفة (deep_pack/taxonomy_generated/fallback) دون تغيير السلوك.
        knowledge_depth = str(meta.get("knowledge_depth") or "").strip()
        if knowledge_depth:
            logger.info("interview blueprint in use (knowledge_depth=%s)", knowledge_depth)
        lines.append(_format_blueprint_block(blueprint, expertise_prompt, domain_guidance))
    elif bank.has_bank:
        lines.append(format_questions_block(bank))
    else:
        lines.extend(
            [
                "",
                "Question bank: no dedicated question set matched for this session (start_no_bank).",
                "Conduct a structured interview using the role and candidate context only.",
                "Do not imply that a fixed mandatory question list exists unless you add questions yourself naturally.",
            ]
        )
    # Public screening (shared link): backend injects a ready-made ROLE CONTEXT block built from the
    # campaign's job criteria. There is NO trusted application data — steer questions toward the role's
    # requirements and probe; never assume the candidate possesses any listed skill/qualification.
    role_context = str(meta.get("role_context") or "").strip()
    if role_context:
        lines.extend(
            [
                "",
                "ROLE CONTEXT (public screening — job requirements, NOT candidate-provided data):",
                role_context,
            ]
        )
    return "\n".join(lines)


def _meta_bool(meta: dict[str, Any], key: str, default: bool = False) -> bool:
    raw = str(meta.get(key) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _candidate_gender_from_meta(meta: dict[str, Any]) -> str:
    g = str(meta.get("candidate_gender") or "").strip().lower()
    return g if g in ("female", "male") else ""


def _build_interview_state(meta: dict[str, Any]) -> str:
    """Static state flags from backend metadata.

    Hybrid mode: these are advisory hints. The runtime decision frame produced by the
    Agent's ``on_user_turn_completed`` (heuristics + memory) takes precedence.
    """
    clarification_requested = _meta_bool(meta, "clarification_requested", default=False)
    follow_up_required = _meta_bool(meta, "follow_up_required", default=False)
    question_locked = _meta_bool(meta, "question_locked", default=False)
    current_phase = str(meta.get("current_phase") or "").strip() or "L1"
    current_question = str(meta.get("current_question") or "").strip() or "N/A"
    return "\n".join(
        [
            f"clarification_requested: {'true' if clarification_requested else 'false'}",
            f"follow_up_required: {'true' if follow_up_required else 'false'}",
            f"question_locked: {'true' if question_locked else 'false'}",
            f"current_phase: {current_phase}",
            f"current_question: {current_question}",
            "",
            "Dynamic guidance (advisory — runtime decision-frame messages take precedence):",
            "- clarification_requested=true ⇒ lean toward rephrasing the same question.",
            "- follow_up_required=true ⇒ lean toward one probing follow-up.",
            "- question_locked=true ⇒ avoid switching topics unless the runtime frame says otherwise.",
        ]
    )


def _initial_greeting_instructions(meta: dict[str, Any]) -> str:
    """One-shot instructions for session.generate_reply — dynamic welcome from metadata."""
    name = str(meta.get("candidate_name") or "").strip()
    pos = str(meta.get("position") or "").strip()
    if pos.upper() == "N/A":
        pos = ""
    mode = (os.getenv("INITIAL_GREETING_LANGUAGE") or "ar").strip().lower()
    neutral = _neutral_greeting_address()
    gender = _candidate_gender_from_meta(meta)
    gender_hint = ""
    if not neutral:
        if gender == "male":
            gender_hint = "Address the candidate with masculine Arabic forms (تفضل، خبرتك) — never تفضلي."
        elif gender == "female":
            gender_hint = "Address the candidate with feminine Arabic forms (تفضلي، خبرتج) — never تفضل."
    if mode in ("bilingual", "auto", "mixed"):
        parts = [
            "You are opening a professional video interview.",
            "Speak one short warm welcome (1-2 sentences maximum, under ~35 words total).",
            "Use Arabic if the candidate would expect Arabic; otherwise English.",
        ]
        if name:
            parts.append(f"Address them by name: {name}.")
        else:
            parts.append("Greet them professionally; do not invent a name.")
        if pos:
            parts.append(f"Acknowledge the role they applied for: {pos}.")
        parts.append(
            "Do not ask them to introduce themselves; you already have their context. "
            "Transition straight into the interview: if a required-questions list exists in session instructions, ask question 1 only; "
            "otherwise one short relevant opening question about experience or fit for the role."
        )
        parts.append("Do not ask technical or case-study questions in this turn.")
        if gender_hint:
            parts.append(gender_hint)
        return " ".join(parts)
    if mode in ("en", "english"):
        parts = [
            "You are opening a professional video interview.",
            "Speak only in English.",
            "One short warm welcome: 1-2 sentences maximum, under ~35 words total.",
        ]
        if name:
            parts.append(f"Address them by name: {name}.")
        else:
            parts.append("Greet them professionally; do not invent a name.")
        if pos:
            parts.append(f"Acknowledge the role they applied for: {pos}.")
        parts.append(
            "Do not ask them to introduce themselves; you already have their context. "
            "Transition straight into the interview: if a required-questions list exists in session instructions, ask question 1 only; "
            "otherwise one short relevant opening question about experience or fit for the role."
        )
        parts.append("Do not ask technical or case-study questions in this turn.")
        if gender_hint:
            parts.append(gender_hint)
        return " ".join(parts)

    # Default: Arabic welcome (فصحى بسيطة أو عربية واضحة)
    parts = [
        "أنت تفتتح مقابلة فيديو مهنية.",
        "تحدّث بالعربية فقط في هذه الجملة (عربية فصحى بسيطة أو عربية واضحة محايدة).",
        "ترحيب قصير دافئ: جملة إلى جملتين كحد أقصى، دون إطالة.",
    ]
    if neutral:
        parts.append(
            "استخدم تحية محايدة بدون تفضل/تفضلي — مثال: «حياك الله» أو «مرحباً» ثم الاسم إن وُجد."
        )
    if name:
        parts.append(
            f"خاطب المرشح بالاسم كما ورد: {name} (يمكن الإبقاء على الأسماء الأجنبية كما هي)."
        )
    else:
        parts.append("رحّب باحترافية بالعربية دون اختلاق اسم.")
    if pos:
        parts.append(f"أشر باختصار إلى الوظيفة أو المنصب بالعربية (المنصب من الجلسة: {pos}).")
    parts.append(
        "لا تطلب منه أن يعرّف نفسه عامة؛ بياناته موجودة في سياق الجلسة. "
        "انتقل مباشرة لبدء المقابلة: إن وُجدت قائمة أسئلة مطلوبة في التعليمات فاسأل السؤال الأول فقط؛ "
        "وإلا فاسأل سؤالاً افتتاحياً واحداً وقصيراً عن الخبرة أو الملاءمة للمنصب."
    )
    parts.append("لا تطرح أسئلة تقنية أو دراسات حالة في هذه الجولة.")
    if gender_hint:
        parts.append(gender_hint)
    return " ".join(parts)


def _canned_initial_greeting(meta: dict[str, Any]) -> str:
    """Short welcome + first bank question (or generic opener) — TTS only, no LLM round-trip."""
    name = str(meta.get("candidate_name") or "").strip()
    pos = str(meta.get("position") or "").strip()
    if pos.upper() == "N/A":
        pos = ""
    bank = resolve_livekit_questions(meta)
    first_q = bank.questions[0] if bank.questions else None
    mode = (os.getenv("INITIAL_GREETING_LANGUAGE") or "ar").strip().lower()
    short_mode = (os.getenv("INITIAL_GREETING_SHORT_MODE", "true").strip().lower() in ("1", "true", "yes"))
    include_first_q = (
        os.getenv("INITIAL_GREETING_INCLUDE_FIRST_QUESTION", "false").strip().lower()
        in ("1", "true", "yes")
    )

    if short_mode:
        if mode in ("en", "english"):
            if include_first_q and first_q:
                return f"Hello {name},".strip(", ") + f" let's begin. {first_q}"
            return f"Hello {name},".strip(", ") + " let's begin the interview."
        if mode in ("bilingual", "auto", "mixed"):
            if include_first_q and first_q:
                return f"Hello {name},".strip(", ") + f" let's begin. {first_q}"
            return f"Hello {name},".strip(", ") + " let's begin."
        # Arabic short mode (default)
        if include_first_q and first_q:
            if name:
                return f"مرحباً {name}، لنبدأ المقابلة. {first_q}"
            return f"مرحباً، لنبدأ المقابلة. {first_q}"
        if _neutral_greeting_address():
            if name:
                return f"حياك الله {name}، نبدأ من خبرتك العملية."
            return "حياك الله، نبدأ من خبرتك العملية."
        if name:
            return f"مرحباً {name}، لنبدأ المقابلة."
        return "مرحباً، لنبدأ المقابلة."

    if mode in ("en", "english"):
        head: list[str] = ["Hello"]
        if name:
            head.append(f"{name},")
        head.append("I'm your interviewer today.")
        if pos:
            head.append(f"We're discussing the {pos} role.")
        tail = first_q if first_q else "Let's begin the interview."
        return " ".join([*head, tail])

    if mode in ("bilingual", "auto", "mixed"):
        head = ["Hello"]
        if name:
            head.append(f"{name},")
        head.append("I'm your interviewer today.")
        if pos:
            head.append(f"We'll discuss the {pos} role.")
        tail = first_q if first_q else "Let's begin the interview."
        return " ".join([*head, tail])

    # Arabic (default)
    head_ar: list[str] = []
    if name:
        head_ar.append(f"مرحباً {name}،")
    else:
        head_ar.append("مرحباً،")
    head_ar.append("معك المُقابِل اليوم.")
    if pos:
        head_ar.append(f"نناقش منصب {pos}.")
    tail_ar = first_q if first_q else "لنبدأ المقابلة."
    return " ".join([*head_ar, tail_ar])


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


async def _wait_for_candidate(ctx: JobContext, identity: str | None, tel: Any) -> bool:
    """Block until the candidate actually joins before greeting (silent-greeting fix).

    The agent used to greet ~5s after session start while the candidate was still
    on the mic-permission screen; live audio is not replayed so the greeting
    landed in an empty room. ``ctx.wait_for_participant`` handles the
    already-joined case and, with ``identity=None``, waits for the first
    STANDARD/SIP participant (the Beyond avatar joins as AGENT kind, never
    mistaken for the candidate)."""
    timeout = float(os.getenv("INTERVIEW_GREETING_WAIT_TIMEOUT", "60"))
    post_delay = float(os.getenv("INTERVIEW_GREETING_POST_JOIN_DELAY", "1.0"))
    try:
        kwargs: dict[str, Any] = {}
        if identity:
            kwargs["identity"] = identity
        participant = await asyncio.wait_for(ctx.wait_for_participant(**kwargs), timeout=timeout)
        tel.mark("candidate_joined_s")
        logger.info("candidate joined | identity=%s (greeting unblocked)", getattr(participant, "identity", ""))
        if post_delay > 0:
            await asyncio.sleep(post_delay)
        return True
    except asyncio.TimeoutError:
        logger.warning("greeting_skipped_no_candidate | no candidate within %.0fs (identity=%s)", timeout, identity or "any")
        return False
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("candidate wait failed (%s) — greeting immediately", e)
        return True


def _interview_tts_failure_text() -> str:
    return "نعتذر — نواجه مشكلة تقنية مؤقتة بالصوت. سيتم إعلامك لإعادة جدولة المقابلة."


@server.rtc_session(agent_name="video-interview-agent", on_request=_on_job_request)
async def my_agent(ctx: JobContext):
    # Connect before anything else — minimizes time-to-_ctx_connect for LiveKit job_entry watchdog.
    _session_t0 = time.monotonic()
    await _connect_job_room(ctx)
    _connect_seconds = round(time.monotonic() - _session_t0, 3)
    ctx.log_context_fields = {"room": ctx.room.name, "agent_name": "video-interview-agent"}
    logger.debug(
        "connected to room | room=%s job=%s",
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

    interview_context = _build_interview_context(meta)
    interview_state = _build_interview_state(meta)
    bank_res = resolve_livekit_questions(meta)
    bank_questions = bank_res.questions
    bank_key = bank_res.matched_key
    # Specialized path: prefer the locked blueprint's anchor questions for the agent's memory
    # pre-seed and first topic (fair 3-question backbone). Falls back to the legacy bank.
    _blueprint = _parse_blueprint(meta)
    if _blueprint is not None:
        _anchors = [str(q).strip() for q in (_blueprint.get("anchorQuestions") or []) if str(q).strip()]
        if _anchors:
            bank_questions = _anchors[:3]
            bank_key = "blueprint"
    interview_position = str(meta.get("position") or "").strip()
    if interview_position.upper() == "N/A":
        interview_position = ""
    candidate_gender = _candidate_gender_from_meta(meta)
    has_domain_guidance = bool(str(meta.get("domain_guidance") or "").strip())

    _iv = interview_defaults_enabled()

    avatar_session = create_avatar_session()
    # Fail-safe: validate the configured ElevenLabs voice; swap to a premade
    # fallback if it no longer exists (voice_id_does_not_exist). A candidate in a
    # real paid interview must never face a mute avatar.
    _preflight_voice = await asyncio.to_thread(preflight_elevenlabs_voice)
    tts, voice_id, tts_language, supports_override = create_elevenlabs_tts(
        voice_id_override=_preflight_voice
    )

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
    _default_min_ept = "0.05" if interview_profile_normalized() == "latency" else "0.08"
    min_ept = float(os.getenv("MIN_ENDPOINTING_DELAY", _default_min_ept))
    max_ept = float(os.getenv("MAX_ENDPOINTING_DELAY", "2.0"))
    min_ept, max_ept = apply_interview_endpointing_boost(min_ept, max_ept)
    preemptive = env_preemptive_generation()
    allow_interrupt = env_allow_interruption()
    logger.info(
        "interruption policy | allow_interruptions=%s INTERVIEW_FORCE_ALLOW_INTERRUPTION=%r "
        "INTERVIEW_HARD_NO_INTERRUPT=%r ALLOW_INTERRUPTION=%r MIN_INTERRUPTION_DURATION=%r "
        "MIN_ENDPOINTING_DELAY=%r (if these mismatch .env.local, fix working directory or LiveKit Cloud env)",
        allow_interrupt,
        os.getenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION"),
        os.getenv("INTERVIEW_HARD_NO_INTERRUPT"),
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

    min_intr = interview_min_interruption_duration()
    false_intr_to = interview_false_interruption_timeout()
    discard_unintr = interview_discard_audio_if_uninterruptible()
    _mcsd_default = "0.10" if _iv else "0.0"
    if _iv and avatar_stability_mode() and not avatar_fast_response():
        _mcsd_default = "0.20"  # slight gap between playout segments → calmer Beyond lip-sync
    if _iv and avatar_fast_response():
        # Lower gap between TTS segments → faster perceived turn-taking (raise if audio sounds choppy).
        _mcsd_default = "0.07"
    min_consecutive_speech_delay = float(os.getenv("MIN_CONSECUTIVE_SPEECH_DELAY", _mcsd_default))

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
    )
    logger.debug(
        "AgentSession | turn=%s preemptive=%s interrupt=%s endpointing=%.2f/%.2f min_intr=%.2fs",
        turn_detection_label,
        preemptive,
        allow_interrupt,
        min_ept,
        max_ept,
        min_intr,
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
    _session_tel.bank_resolution = bank_res.resolution
    _session_tel.bank_category = bank_res.category
    _session_tel.bank_override_used = bank_res.override_used

    english_voice_id = (os.getenv("ELEVENLABS_ENGLISH_VOICE_ID") or "").strip() or voice_id
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
    attach_user_transcript_routing(session, tts_router, interview_defaults=_iv)

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
    role_glossary = build_role_glossary(meta, bank_res, _blueprint)
    blueprint_competencies: list[dict[str, Any]] = []
    if _blueprint and isinstance(_blueprint.get("competencies"), list):
        blueprint_competencies = [
            c for c in _blueprint["competencies"] if isinstance(c, dict)
        ]
    experience_tracks = parse_experience_tracks(
        (_blueprint or {}).get("experienceTracks")
    )
    interview_paths = parse_interview_paths(
        (_blueprint or {}).get("interviewPaths")
    )
    if (
        meta.get("profile_terminology")
        or meta.get("role_glossary")
        or experience_tracks
        or meta.get("domain_pack_key")
    ):
        logger.info(
            "Phase B metadata | glossary_terms=%d tracks=%d paths=%d pack=%s content_ver=%s",
            len(role_glossary),
            len(experience_tracks),
            len(interview_paths),
            meta.get("domain_pack_key") or "n/a",
            meta.get("blueprint_content_version") or "n/a",
        )
    career_level = str(meta.get("career_level") or "").strip()

    interview_agent = InterviewAssistant(
        tts_router=tts_router,
        allow_interruptions=allow_interrupt,
        interview_state=interview_state,
        interview_context=interview_context or None,
        position=interview_position,
        bank_questions=bank_questions,
        bank_key=bank_key,
        candidate_gender=candidate_gender or None,
        has_domain_guidance=has_domain_guidance,
        role_glossary=role_glossary,
        blueprint_competencies=blueprint_competencies,
        experience_tracks=experience_tracks,
        interview_paths=interview_paths,
        career_level=career_level or None,
        domain_pack_key=str(meta.get("domain_pack_key") or ""),
        domain_guidance=str(meta.get("domain_guidance") or ""),
        pack_version=str(meta.get("pack_version") or ""),
        knowledge_depth=str(meta.get("knowledge_depth") or ""),
        pack_match_confidence=str(meta.get("pack_match_confidence") or ""),
        role_key=str(meta.get("role_key") or ""),
    )
    if bank_questions:
        first_q = bank_questions[0]
        interview_agent._memory.current_topic = first_q
        interview_agent._memory.last_sample = first_q
        logger.info(
            "Hybrid memory pre-seed | bank_key=%s first_topic=%r",
            bank_key or "(none)",
            first_q,
        )

    try:
        await session.start(
            agent=interview_agent,
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=room_io.AudioInputOptions(
                    noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
                    if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                    else noise_cancellation.BVC(),
                ),
                text_output=_livekit_room_text_output_options(),
                audio_output=None,
            ),
        )
        logger.debug("AgentSession started")
    except Exception as e:
        logger.error("AgentSession start failed: %s", e, exc_info=True)
        _session_tel.end_reason = "session_start_failed"
        raise

    disconnect_event = asyncio.Event()

    # ── Terminal TTS guard ────────────────────────────────────────────────────
    # The SDK retries transient TTS failures; this catches the terminal case
    # (dead voice id / dead key): after N consecutive TTS errors with no audio,
    # tell the candidate in text and end instead of a silent avatar.
    _tts_error_limit = max(1, int(os.getenv("INTERVIEW_TTS_ERROR_LIMIT", "3")))
    _tts_error_count = 0
    _tts_terminal_fired = False

    async def _tts_terminal_shutdown() -> None:
        nonlocal _tts_terminal_fired
        if _tts_terminal_fired:
            return
        _tts_terminal_fired = True
        logger.error("tts_terminal_failure | %d consecutive TTS errors — notifying candidate and ending", _tts_error_count)
        try:
            await ctx.room.local_participant.send_text(_interview_tts_failure_text(), topic="lk.transcription")
        except Exception as ex:
            logger.debug("tts failure text notify skipped: %s", ex)
        _session_tel.end_reason = "tts_terminal_failure"
        try:
            ctx.shutdown("tts_terminal_failure")
        except Exception:
            pass
        disconnect_event.set()

    def _on_session_error(ev: Any) -> None:
        nonlocal _tts_error_count
        try:
            source = getattr(ev, "source", None)
            label = f"{type(source).__module__}.{type(source).__name__}".lower() if source is not None else ""
            if "tts" not in label:
                return
            _tts_error_count += 1
            logger.warning("tts error %d/%d | %s", _tts_error_count, _tts_error_limit, getattr(ev, "error", ev))
            if _tts_error_count >= _tts_error_limit and not _tts_terminal_fired:
                asyncio.get_running_loop().create_task(_tts_terminal_shutdown())
        except Exception as ex:
            logger.debug("session error hook failed: %s", ex)

    def _on_metrics_reset_tts_errors(ev: Any) -> None:
        nonlocal _tts_error_count
        try:
            from livekit.agents import metrics as _metrics

            m = getattr(ev, "metrics", None)
            if isinstance(m, _metrics.TTSMetrics) and (getattr(m, "audio_duration", 0) or 0) > 0:
                _tts_error_count = 0
        except Exception:
            pass

    try:
        session.on("error", _on_session_error)
        session.on("metrics_collected", _on_metrics_reset_tts_errors)
    except Exception as e:
        logger.debug("tts terminal guard hooks skipped: %s", e)

    # ── Wait for the candidate before greeting (silent-greeting fix) ──────────
    _cand_id = str(meta.get("candidate_id") or "").strip()
    _cand_identity = f"user-{_cand_id}" if _cand_id else None
    _candidate_present = await _wait_for_candidate(ctx, _cand_identity, _session_tel)

    if _candidate_present and os.getenv("SKIP_INITIAL_GREETING", "0") != "1":
        try:
            use_llm = os.getenv("INITIAL_GREETING_USE_LLM", "false").lower() in (
                "1",
                "true",
                "yes",
            )
            if use_llm:
                await session.generate_reply(
                    instructions=_initial_greeting_instructions(meta),
                    allow_interruptions=allow_interrupt,
                )
                logger.debug("initial greeting: LLM path")
            else:
                text = _canned_initial_greeting(meta).strip()
                if text:
                    await session.say(text, allow_interruptions=allow_interrupt)
                    logger.debug("initial greeting: TTS-only (canned) path")
        except Exception as e:
            logger.warning("initial greeting failed: %s", e)

    # ── Session safety cap (abandoned interviews) ────────────────────────────
    # The interview ends itself naturally via the agent's end-interview tool;
    # this only reaps abandoned sessions. Generous (30 min) — never cuts a real
    # interview short.
    _max_session_s = float(os.getenv("INTERVIEW_MAX_SESSION_SECONDS", "1800"))

    async def _session_time_cap() -> None:
        try:
            await asyncio.sleep(_max_session_s)
            if disconnect_event.is_set():
                return
            logger.warning("interview session safety cap reached (%.0fs) — closing abandoned session", _max_session_s)
            _session_tel.end_reason = "session_time_limit"
            try:
                ctx.shutdown("session_time_limit")
            except Exception:
                pass
            disconnect_event.set()
        except asyncio.CancelledError:
            pass
        except Exception as ex:
            logger.warning("session cap task error: %s", ex)

    _cap_task: asyncio.Task | None = asyncio.create_task(_session_time_cap()) if _max_session_s > 0 else None

    try:
        if hasattr(ctx.room, "on"):
            ctx.room.on("disconnected", lambda: disconnect_event.set())
        try:
            _safety_timeout = max(_max_session_s + 120.0, 600.0) if _max_session_s > 0 else 3600.0
            await asyncio.wait_for(disconnect_event.wait(), timeout=_safety_timeout)
        except asyncio.TimeoutError:
            pass
        except asyncio.CancelledError:
            raise
        except Exception as wait_err:
            if is_websocket_closing_error(wait_err):
                logger.debug("disconnect wait: websocket closing")
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
        disconnect_event.set()  # release the cap task's sleep guard
        if _cap_task is not None and not _cap_task.done():
            _cap_task.cancel()
        # Beyond / avatar worker only. Do NOT await AgentSession.aclose() here: session.start() already
        # registered JobContext shutdown hooks, and ipc/job_proc_lazy_main awaits _primary_agent_session.aclose()
        # when the room shuts down. Doing both in this task races the IPC teardown and triggers
        # "Task was destroyed but it is pending!" on job_user_entrypoint (Windows asyncio).
        logger.debug("cleanup (avatar only; AgentSession closed by SDK job lifecycle)")
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
