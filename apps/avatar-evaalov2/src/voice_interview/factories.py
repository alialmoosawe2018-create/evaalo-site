"""STT, TTS, LLM, VAD, and Beyond AvatarSession construction."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Literal

from livekit.plugins import elevenlabs, openai, silero
from livekit.plugins.bey import AvatarSession  # pyright: ignore[reportMissingImports]
from livekit.plugins.elevenlabs import VoiceSettings
from livekit.plugins.elevenlabs.tts import NOT_GIVEN

from voice_interview.config import (
    ARABIC_VOICE_ID,
    DEFAULT_AVATAR_ID,
    INVALID_ELEVEN_VOICE_IDS,
    LEGACY_WRONG_AVATAR_ID,
    avatar_fast_response,
    avatar_stability_mode,
    interview_defaults_enabled,
)

logger = logging.getLogger("agent")

try:
    from livekit.plugins import speechmatics
    from livekit.plugins.speechmatics import AdditionalVocabEntry
    from speechmatics.rt import OperatingPoint

    SPEECHMATICS_AVAILABLE = True
    IRAQI_ADDITIONAL_VOCAB = [
        AdditionalVocabEntry(content="تحچيلي", sounds_like=["تحكيلي", "تحجيلي"]),
        AdditionalVocabEntry(content="تحچيلنا", sounds_like=["تحجيلنا", "تحكيلنا"]),
        AdditionalVocabEntry(content="شلونچ", sounds_like=["شلونك", "شلونج"]),
        AdditionalVocabEntry(content="شلون", sounds_like=["شلون"]),
        AdditionalVocabEntry(content="شلونك", sounds_like=["شلونج"]),
        AdditionalVocabEntry(content="شنو", sounds_like=["شنو", "شني"]),
        AdditionalVocabEntry(content="هواية", sounds_like=["هواي", "هوايه"]),
        AdditionalVocabEntry(content="هسة", sounds_like=["هسه", "هسا"]),
        AdditionalVocabEntry(content="هسه", sounds_like=["هسا", "هسة"]),
        AdditionalVocabEntry(content="چنت", sounds_like=["كنت", "جنت"]),
        AdditionalVocabEntry(content="چان", sounds_like=["كان", "جان"]),
        AdditionalVocabEntry(content="اشتغلت", sounds_like=["اشتغلت", "شتغلت"]),
        AdditionalVocabEntry(content="اشتغل", sounds_like=["اشتغل", "شتغل"]),
        AdditionalVocabEntry(content="شغل", sounds_like=["شغل", "شغول"]),
        AdditionalVocabEntry(content="شغلة", sounds_like=["شغله"]),
        AdditionalVocabEntry(content="آني", sounds_like=["اني", "آني"]),
        AdditionalVocabEntry(content="انته", sounds_like=["انت", "انته"]),
        AdditionalVocabEntry(content="انتي", sounds_like=["انت", "انتي"]),
        AdditionalVocabEntry(content="إحنا", sounds_like=["احنا", "إحنا"]),
        AdditionalVocabEntry(content="هذا", sounds_like=["هاذا", "هذا"]),
        AdditionalVocabEntry(content="هاي", sounds_like=["هاي", "هاذي"]),
        AdditionalVocabEntry(content="هاذي", sounds_like=["هاي", "هذه"]),
        AdditionalVocabEntry(content="ماكو", sounds_like=["ماكو", "ما اكو"]),
        AdditionalVocabEntry(content="اكو", sounds_like=["اكو", "أكو"]),
        AdditionalVocabEntry(content="گلت", sounds_like=["قلت", "كلت"]),
        AdditionalVocabEntry(content="گال", sounds_like=["قال", "كال"]),
        AdditionalVocabEntry(content="رحت", sounds_like=["رحت", "روحت"]),
        AdditionalVocabEntry(content="جذي", sounds_like=["كذا", "جذي", "هيج"]),
        AdditionalVocabEntry(content="هيچ", sounds_like=["هيك", "هيج"]),
        AdditionalVocabEntry(content="ويا", sounds_like=["وية", "ويه"]),
        AdditionalVocabEntry(content="هم", sounds_like=["هم", "همين"]),
        AdditionalVocabEntry(content="بعد", sounds_like=["بعد"]),
        AdditionalVocabEntry(content="چم", sounds_like=["كم", "جم"]),
        AdditionalVocabEntry(content="ليش", sounds_like=["ليش", "لش"]),
        AdditionalVocabEntry(content="وين", sounds_like=["وين", "فين"]),
        AdditionalVocabEntry(content="منو", sounds_like=["منو", "مين"]),
        AdditionalVocabEntry(content="بَلكَت", sounds_like=["بلكت", "يمكن"]),
        AdditionalVocabEntry(content="گدامي", sounds_like=["قدامي", "كدامي"]),
        AdditionalVocabEntry(content="ديري بالك", sounds_like=["دير بالك"]),
        AdditionalVocabEntry(content="ماشاء الله", sounds_like=["ماشالله"]),
    ]
    # Default hints for interview / HR Arabic (MSA + common mis-hears). Merged with IRAQI + env extras.
    AR_INTERVIEW_DEFAULT_VOCAB = [
        AdditionalVocabEntry(content="الموارد البشرية", sounds_like=["الموارد البشريه", "الموارد البشري"]),
        AdditionalVocabEntry(content="مقابلة شخصية", sounds_like=["مقابله شخصيه", "مقابلة شخصيه"]),
        AdditionalVocabEntry(content="الخبرة العملية", sounds_like=["الخبره العمليه"]),
        AdditionalVocabEntry(content="المهارات", sounds_like=["مهارات", "مهاره"]),
        AdditionalVocabEntry(content="الإنجليزية", sounds_like=["الانجليزية", "الانجليزي"]),
        AdditionalVocabEntry(content="السيرة الذاتية", sounds_like=["السيره الذاتيه", "سيرة ذاتية"]),
        AdditionalVocabEntry(content="كربلاء", sounds_like=["كربلا"]),
        AdditionalVocabEntry(content="مطور برمجيات", sounds_like=["Software Developer", "ديفلوبر"]),
        AdditionalVocabEntry(content="إيفالو", sounds_like=["ايفالو", "Evaalo", "Evalo"]),
        AdditionalVocabEntry(content="التوظيف", sounds_like=["التوضيف"]),
        AdditionalVocabEntry(content="تأهيل", sounds_like=["تاهيل"]),
        AdditionalVocabEntry(content="استقطاب", sounds_like=["استكطاب"]),
        AdditionalVocabEntry(content="الموظفين", sounds_like=["الموضفين", "الموظفون"]),
        AdditionalVocabEntry(content="رواتب", sounds_like=["رواتيب"]),
        AdditionalVocabEntry(content="إجازة", sounds_like=["اجازه", "اجازة"]),
        AdditionalVocabEntry(content="عقد عمل", sounds_like=["عقد عمل", "عكد عمل"]),
        AdditionalVocabEntry(content="بكالوريوس", sounds_like=["بكالوريس", "بكلوريوس"]),
        AdditionalVocabEntry(content="ماجستير", sounds_like=["ماجستر", "ماجيستير"]),
        AdditionalVocabEntry(content="دبلوم", sounds_like=["ديبلوم"]),
        AdditionalVocabEntry(content="شهادة", sounds_like=["شهاده"]),
        AdditionalVocabEntry(content="مدير الموارد البشرية", sounds_like=["مدير الموارد البشريه"]),
        AdditionalVocabEntry(content="أخصائي موارد بشرية", sounds_like=["اخصائي موارد بشريه"]),
        AdditionalVocabEntry(content="قائد فريق", sounds_like=["كائد فريق"]),
        AdditionalVocabEntry(content="مشروع", sounds_like=["مشرووع"]),
        AdditionalVocabEntry(content="إنجاز", sounds_like=["انجاز"]),
        AdditionalVocabEntry(content="بغداد", sounds_like=["بغدااد"]),
        AdditionalVocabEntry(content="البصرة", sounds_like=["البصره"]),
        AdditionalVocabEntry(content="الموصل", sounds_like=["الموصول"]),
        AdditionalVocabEntry(content="أربيل", sounds_like=["اربيل"]),
        AdditionalVocabEntry(content="LinkedIn", sounds_like=["لينكدإن", "لينك إن"]),
        AdditionalVocabEntry(content="Excel", sounds_like=["إكسل", "اكسل"]),
        AdditionalVocabEntry(content="Word", sounds_like=["ورد"]),
        AdditionalVocabEntry(content="ChatGPT", sounds_like=["شات جي بي تي", "شات جبت"]),
    ]
    # English HR / interview loanwords commonly mixed into Arabic speech in Iraq.
    # The ar_en pack handles code-switching natively, but unbalanced additional_vocab
    # (mostly Arabic) biases the model away from English terms — so we add the most
    # common interview loanwords with explicit Arabic phonetic ``sounds_like`` aliases.
    EN_INTERVIEW_DEFAULT_VOCAB = [
        # Recruiting & HR core
        AdditionalVocabEntry(content="recruitment", sounds_like=["ريكروتمنت", "ركروتمنت", "ريكروتمنت"]),
        AdditionalVocabEntry(content="recruiter", sounds_like=["ريكروتر", "ركروتر"]),
        AdditionalVocabEntry(content="HR", sounds_like=["إتش آر", "اتش ار", "اج ار"]),
        AdditionalVocabEntry(content="manager", sounds_like=["مانجر", "مانيجر", "ماناجر"]),
        AdditionalVocabEntry(content="management", sounds_like=["مانجمنت", "مانيجمنت"]),
        AdditionalVocabEntry(content="team leader", sounds_like=["تيم ليدر", "تيمليدر"]),
        AdditionalVocabEntry(content="supervisor", sounds_like=["سوبرفايزر", "سوبرڤايزر"]),
        AdditionalVocabEntry(content="coordinator", sounds_like=["كوردنيتر", "كوردينيتر"]),
        AdditionalVocabEntry(content="onboarding", sounds_like=["اون بوردنغ", "اونبوردنغ"]),
        AdditionalVocabEntry(content="offboarding", sounds_like=["اوف بوردنغ"]),
        AdditionalVocabEntry(content="interview", sounds_like=["انترفيو", "انترڤيو", "إنترفيو"]),
        AdditionalVocabEntry(content="candidate", sounds_like=["كانديديت", "كانديد"]),
        AdditionalVocabEntry(content="employee", sounds_like=["إمبلوي", "امبلوي"]),
        AdditionalVocabEntry(content="employer", sounds_like=["إمبلوير", "امبلوير"]),
        AdditionalVocabEntry(content="payroll", sounds_like=["بايرول", "بيرول"]),
        AdditionalVocabEntry(content="performance", sounds_like=["بيرفورمنس", "برفورمانس"]),
        AdditionalVocabEntry(content="KPI", sounds_like=["كي بي اي", "كيه بي اي"]),
        AdditionalVocabEntry(content="OKR", sounds_like=["او كي ار", "اوكي ار"]),
        AdditionalVocabEntry(content="CV", sounds_like=["سي في", "سيڤي"]),
        # Functional skills & departments
        AdditionalVocabEntry(content="marketing", sounds_like=["ماركتنغ", "ماركتينغ"]),
        AdditionalVocabEntry(content="sales", sounds_like=["سيلز"]),
        AdditionalVocabEntry(content="finance", sounds_like=["فاينانس", "فايننس"]),
        AdditionalVocabEntry(content="accounting", sounds_like=["اكاونتنغ", "اكاونتينغ"]),
        AdditionalVocabEntry(content="operations", sounds_like=["اوبريشنز", "اوبريشن"]),
        AdditionalVocabEntry(content="customer service", sounds_like=["كستمر سرفس"]),
        AdditionalVocabEntry(content="logistics", sounds_like=["لوجستيكس", "لوجستيك"]),
        AdditionalVocabEntry(content="procurement", sounds_like=["بروكيرمنت"]),
        AdditionalVocabEntry(content="IT", sounds_like=["آي تي", "اي تي"]),
        AdditionalVocabEntry(content="developer", sounds_like=["ديفلوبر", "ديفيلوبر"]),
        AdditionalVocabEntry(content="engineer", sounds_like=["إنجنير", "انجينير"]),
        AdditionalVocabEntry(content="designer", sounds_like=["ديزاينر"]),
        AdditionalVocabEntry(content="freelance", sounds_like=["فري لانس", "فريلانس"]),
        AdditionalVocabEntry(content="full time", sounds_like=["فل تايم", "فولتايم"]),
        AdditionalVocabEntry(content="part time", sounds_like=["بارت تايم"]),
        AdditionalVocabEntry(content="remote", sounds_like=["ريموت"]),
        AdditionalVocabEntry(content="hybrid", sounds_like=["هايبرد", "هايبرايد"]),
        AdditionalVocabEntry(content="onsite", sounds_like=["اون سايت", "اونسايت"]),
        # Tools / platforms candidates name-drop in interviews
        AdditionalVocabEntry(content="PowerPoint", sounds_like=["باور بوينت", "باوربوينت"]),
        AdditionalVocabEntry(content="Outlook", sounds_like=["اوت لوك", "اوتلوك"]),
        AdditionalVocabEntry(content="Slack", sounds_like=["سلاك"]),
        AdditionalVocabEntry(content="Zoom", sounds_like=["زوم"]),
        AdditionalVocabEntry(content="Teams", sounds_like=["تيمز"]),
        AdditionalVocabEntry(content="Google", sounds_like=["جوجل", "غوغل"]),
        AdditionalVocabEntry(content="Microsoft", sounds_like=["مايكروسوفت"]),
        AdditionalVocabEntry(content="WhatsApp", sounds_like=["واتساب", "وتساب"]),
        AdditionalVocabEntry(content="Photoshop", sounds_like=["فوتوشوب"]),
        AdditionalVocabEntry(content="Canva", sounds_like=["كانفا", "كانڤا"]),
        AdditionalVocabEntry(content="Python", sounds_like=["بايثون"]),
        AdditionalVocabEntry(content="JavaScript", sounds_like=["جافا سكريبت", "جافاسكريبت"]),
        AdditionalVocabEntry(content="SQL", sounds_like=["إس كيو إل", "اس كيو ال"]),
        # Soft-skill labels candidates often say in English
        AdditionalVocabEntry(content="leadership", sounds_like=["ليدرشب"]),
        AdditionalVocabEntry(content="teamwork", sounds_like=["تيم ورك", "تيمورك"]),
        AdditionalVocabEntry(content="communication", sounds_like=["كوميونيكيشن"]),
        AdditionalVocabEntry(content="problem solving", sounds_like=["بروبلم سولفنغ"]),
        AdditionalVocabEntry(content="multitasking", sounds_like=["ملتي تاسكنغ"]),
        AdditionalVocabEntry(content="time management", sounds_like=["تايم مانجمنت"]),
    ]
except ImportError:
    SPEECHMATICS_AVAILABLE = False
    IRAQI_ADDITIONAL_VOCAB = []
    AR_INTERVIEW_DEFAULT_VOCAB = []
    EN_INTERVIEW_DEFAULT_VOCAB = []


def resolve_speechmatics_eou_mode(raw: str) -> Any:
    e = (raw or "fixed").strip().lower()
    try:
        from livekit.plugins.speechmatics import EndOfUtteranceMode
    except ImportError:
        try:
            from livekit.plugins.speechmatics.stt import EndOfUtteranceMode
        except ImportError:
            return e if e in ("fixed", "adaptive", "none") else "fixed"
    if e == "adaptive":
        return EndOfUtteranceMode.ADAPTIVE
    if e == "none":
        return EndOfUtteranceMode.NONE
    return EndOfUtteranceMode.FIXED


def load_vad():
    if os.getenv("DISABLE_VAD", "true").lower() == "true":
        return None
    try:
        return silero.VAD.load(
            min_silence_duration=0.35,
            min_speech_duration=0.05,
            activation_threshold=0.35,
        )
    except Exception as e:
        logger.warning("VAD load failed: %s", e)
        return None


def load_turn_detector_model() -> Any | None:
    """Load LiveKit's contextual end-of-turn model when ``TURN_DETECTOR_MODEL`` selects it.

    Values:
      * ``multilingual`` (recommended for Arabic/English/bilingual sessions)
      * ``english`` (English-only deployments)
      * ``stt`` / ``vad`` / unset / empty → returns ``None`` (caller falls back to STT or VAD turn-taking)

    Returns the model instance to pass as ``AgentSession(turn_detection=...)`` or ``None``.

    Notes:
      * Models download on first use; ensure ``python -m livekit.agents.cli download-files`` ran during deploy.
      * The model still needs a VAD source (``Silero VAD``) when used with streaming STT.
        If ``DISABLE_VAD=true`` we keep the prior behaviour and skip the detector.

    See https://docs.livekit.io/agents/logic/turns/turn-detector/.
    """
    raw = (os.getenv("TURN_DETECTOR_MODEL") or "").strip().lower()
    if raw in ("", "stt", "vad", "off", "disabled", "none"):
        return None
    if raw not in ("multilingual", "english"):
        logger.warning(
            "Invalid TURN_DETECTOR_MODEL=%r — expected multilingual|english|stt|vad. Falling back to None.",
            raw,
        )
        return None
    try:
        if raw == "multilingual":
            from livekit.plugins.turn_detector.multilingual import MultilingualModel

            logger.info("Turn detector: MultilingualModel (Arabic/English supported)")
            return MultilingualModel()
        from livekit.plugins.turn_detector.english import EnglishModel

        logger.info("Turn detector: EnglishModel")
        return EnglishModel()
    except Exception as e:
        msg = str(e).lower()
        if "job context" in msg or "entrypoint" in msg:
            # Expected when called from prewarm/import-time; the model only resolves inside a job.
            logger.debug("Turn detector init deferred (no JobContext yet): %s", e)
        else:
            logger.warning(
                "Turn detector load failed (%s); falling back to legacy turn handling. "
                "Run: uv run python -m livekit.agents.cli download-files",
                e,
            )
        return None


def maybe_warmup_elevenlabs() -> None:
    """Optional ElevenLabs warmup at worker prewarm: cuts first-call DNS/TLS/auth.

    Disabled by default. Enable with ELEVENLABS_WARMUP_ON_WORKER_START=true. Sends a tiny HEAD/GET
    against the public ElevenLabs API to prime the connection pool. No audio is generated and no
    extra cost beyond a single auth check. Falls back silently on any error.
    """
    if os.getenv("ELEVENLABS_WARMUP_ON_WORKER_START", "false").strip().lower() not in (
        "1",
        "true",
        "yes",
    ):
        return
    api_key = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    if not api_key:
        logger.debug("ElevenLabs warmup skipped: ELEVENLABS_API_KEY not set")
        return
    try:
        import urllib.request
        import urllib.error

        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": api_key, "accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            logger.info("ElevenLabs warmup: HTTP %s", resp.status)
    except urllib.error.HTTPError as e:
        logger.debug("ElevenLabs warmup HTTP error %s (still primes TCP/TLS)", e.code)
    except Exception as e:
        logger.debug("ElevenLabs warmup skipped: %s", e)


def create_openai_llm():
    api_key = os.getenv("OPENAI_API_KEY")
    # Lower = faster tokens + shorter answers (better for avatar latency). Override with OPENAI_TEMPERATURE.
    # Slightly lower = shorter, more decisive tokens → faster first audio to avatar.
    temp = float(os.getenv("OPENAI_TEMPERATURE", "0.22"))
    kwargs: dict[str, Any] = {"model": "gpt-4o-mini", "temperature": temp}
    if api_key:
        kwargs["api_key"] = api_key
    # Default ~80 words / 2-3 short sentences — enough for clear Arabic questions. Override in .env.local.
    raw_max = (os.getenv("OPENAI_MAX_COMPLETION_TOKENS", "160") or "").strip()
    if raw_max and raw_max != "0":
        try:
            cap = int(raw_max)
            if cap > 0:
                kwargs["max_completion_tokens"] = cap
        except ValueError:
            logger.warning("Invalid OPENAI_MAX_COMPLETION_TOKENS=%s (ignored)", raw_max)
    llm = openai.LLM(**kwargs)
    logger.debug(
        "OpenAI LLM model=%s temperature=%s max_completion_tokens=%s",
        kwargs["model"],
        temp,
        kwargs.get("max_completion_tokens", "unset"),
    )
    return llm


def _optional_elevenlabs_voice_settings() -> VoiceSettings | None:
    """Build VoiceSettings tuned for Arabic-first interview clarity.

    Defaults (when env unset):
      stability=0.65, similarity_boost=0.80, style=NOT_GIVEN, speed=NOT_GIVEN.

    Rationale: ElevenLabs Turbo at default stability=0.5/similarity=0.75 produces softer
    Arabic emphatic letters (ض/ظ/ع/غ/ق) and unstable cadence on long Arabic sentences.
    Slightly higher stability locks tone; higher similarity preserves voice identity for
    Arabic phonemes that drift more than English ones.

    Override any field via ``ELEVENLABS_VOICE_STABILITY|SIMILARITY|STYLE|SPEED``.
    Set ``ELEVENLABS_VOICE_NEUTRAL_DEFAULTS=true`` to fall back to plugin defaults
    (only fires when no other ``ELEVENLABS_VOICE_*`` env is set).
    """

    def _f(key: str) -> float | None:
        raw = (os.getenv(key) or "").strip()
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            logger.warning("Invalid %s=%r (ignored)", key, raw)
            return None

    stab = _f("ELEVENLABS_VOICE_STABILITY")
    sim = _f("ELEVENLABS_VOICE_SIMILARITY")
    style = _f("ELEVENLABS_VOICE_STYLE")
    speed = _f("ELEVENLABS_VOICE_SPEED")

    if (
        stab is None
        and sim is None
        and style is None
        and speed is None
        and _env_bool("ELEVENLABS_VOICE_NEUTRAL_DEFAULTS", False)
    ):
        return None

    stab_c = 0.65 if stab is None else max(0.0, min(1.0, stab))
    sim_c = 0.80 if sim is None else max(0.0, min(1.0, sim))
    style_v: Any = NOT_GIVEN if style is None else max(0.0, min(1.0, style))
    speed_v: Any = NOT_GIVEN
    if speed is not None:
        speed_v = max(0.8, min(1.2, speed))

    return VoiceSettings(
        stability=stab_c,
        similarity_boost=sim_c,
        style=style_v,
        speed=speed_v,
    )


def _elevenlabs_apply_text_normalization() -> Literal["auto", "off", "on"] | None:
    """Default ``off`` — ElevenLabs auto-normalization mangles Arabic numbers/abbreviations.

    Override with ``ELEVENLABS_APPLY_TEXT_NORMALIZATION=auto`` for English-heavy projects.
    """
    raw = (os.getenv("ELEVENLABS_APPLY_TEXT_NORMALIZATION") or "").strip().lower()
    if not raw:
        return "off"
    if raw in ("auto", "off", "on"):
        return raw  # type: ignore[return-value]
    logger.warning("Invalid ELEVENLABS_APPLY_TEXT_NORMALIZATION=%r (use auto|off|on)", raw)
    return "off"


def _env_bool(key: str, default: bool) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


def _elevenlabs_streaming_latency_opt() -> int | None:
    """ElevenLabs ``optimize_streaming_latency`` (0-4) for HTTP ``/stream`` synthesize path.

    WebSocket multi-stream (Agent voice) always streams; this tightens latency where the plugin
    applies the query param. Use ``off`` / ``none`` to omit (plugin default).
    """
    if not _env_bool("ELEVENLABS_TTS_STREAMING", True):
        return None
    raw = (os.getenv("ELEVENLABS_STREAMING_LATENCY") or "").strip().lower()
    if raw in ("off", "none", "skip", "not_given"):
        return None
    if raw == "":
        return 4
    try:
        v = int(raw)
        if 0 <= v <= 4:
            return v
    except ValueError:
        pass
    logger.warning(
        "Invalid ELEVENLABS_STREAMING_LATENCY=%r (use 0-4, off, or empty for default 4)",
        os.getenv("ELEVENLABS_STREAMING_LATENCY"),
    )
    return 4


def _elevenlabs_chunk_length_schedule() -> list[int] | None:
    """Optional chunk schedule (50-500 each); when ``auto_mode`` is false, plugin uses word chunks."""
    raw = (os.getenv("ELEVENLABS_CHUNK_LENGTH_SCHEDULE") or "").strip()
    if not raw:
        return None
    out: list[int] = []
    for p in raw.replace(";", ",").split(","):
        p = p.strip()
        if not p:
            continue
        try:
            n = int(p)
            if 50 <= n <= 500:
                out.append(n)
            else:
                logger.warning(
                    "ELEVENLABS_CHUNK_LENGTH_SCHEDULE value %s outside 50-500 (skipped)", n
                )
        except ValueError:
            logger.warning("Invalid chunk in ELEVENLABS_CHUNK_LENGTH_SCHEDULE: %r", p)
    return out if out else None


def create_elevenlabs_tts():
    voice_id = (os.getenv("ELEVENLABS_VOICE_ID") or "").strip() or ARABIC_VOICE_ID
    if voice_id != ARABIC_VOICE_ID and voice_id in INVALID_ELEVEN_VOICE_IDS:
        logger.warning("Invalid ELEVENLABS_VOICE_ID, using default: %s", ARABIC_VOICE_ID)
        voice_id = ARABIC_VOICE_ID
    eleven_api_key = (
        (os.getenv("ELEVENLABS_API_KEY") or "").strip()
        or (os.getenv("ELEVEN_API_KEY") or "").strip()
        or None
    )
    eleven_inactivity = int(os.getenv("ELEVENLABS_INACTIVITY_TIMEOUT", "300"))
    tts_model = os.getenv("ELEVENLABS_MODEL", "eleven_turbo_v2_5").strip() or "eleven_turbo_v2_5"
    tts_streaming_enabled = _env_bool("ELEVENLABS_TTS_STREAMING", True)
    tts_auto_mode = os.getenv("ELEVENLABS_AUTO_MODE", "true").lower() == "true"
    raw_lang = (os.getenv("ELEVENLABS_TTS_LANGUAGE") or "").strip().lower()
    supports_override = "turbo" in tts_model.lower()
    tts_language = "ar" if raw_lang in ("", "auto", "none", "null") else raw_lang
    if not supports_override:
        logger.debug(
            "TTS model %s ignores ELEVENLABS_TTS_LANGUAGE (no turbo language override)",
            tts_model,
        )
    kwargs: dict[str, Any] = {
        "api_key": eleven_api_key,
        "voice_id": voice_id,
        "model": tts_model,
        "inactivity_timeout": eleven_inactivity,
        "auto_mode": tts_auto_mode,
    }
    vsettings = _optional_elevenlabs_voice_settings()
    if vsettings is not None:
        kwargs["voice_settings"] = vsettings
        logger.debug(
            "ElevenLabs voice_settings stability=%s similarity=%s",
            vsettings.stability,
            vsettings.similarity_boost,
        )
    tnorm = _elevenlabs_apply_text_normalization()
    if tnorm is not None:
        kwargs["apply_text_normalization"] = tnorm
        logger.debug("ElevenLabs apply_text_normalization=%s (Arabic-friendly default)", tnorm)
    if supports_override:
        kwargs["language"] = tts_language
    lat = _elevenlabs_streaming_latency_opt()
    if lat is not None:
        kwargs["streaming_latency"] = lat
    chunks = _elevenlabs_chunk_length_schedule()
    if chunks is not None:
        kwargs["chunk_length_schedule"] = chunks
    tts = elevenlabs.TTS(**kwargs)
    logger.info(
        "ElevenLabs TTS streaming=%s auto_mode=%s streaming_latency=%s chunk_schedule=%s (WebSocket multi-stream + plugin capabilities.streaming)",
        tts_streaming_enabled,
        tts_auto_mode,
        lat if lat is not None else "default",
        len(chunks) if chunks else "default",
    )
    logger.debug(
        "ElevenLabs voice=%s model=%s auto_mode=%s lang=%s override=%s text_norm=%s",
        voice_id,
        tts_model,
        tts_auto_mode,
        tts_language if supports_override else "n/a",
        supports_override,
        tnorm or "auto(default)",
    )
    return tts, voice_id, tts_language, supports_override


def _speechmatics_is_ar_en_pack(lang: str) -> bool:
    x = (lang or "").strip().lower().replace("-", "_")
    return x == "ar_en" or ("ar" in x and "en" in x)


def _speechmatics_is_arabic_pack(lang: str) -> bool:
    """True when STT language targets Arabic (ar_en, ar, ar-XX, etc.)."""
    x = (lang or "").strip().lower().replace("-", "_")
    if not x:
        return False
    if _speechmatics_is_ar_en_pack(lang):
        return True
    return x == "ar" or x.startswith("ar_") or x.startswith("arabic")


def _speechmatics_is_monolingual_arabic(lang: str) -> bool:
    """Arabic-only language code (not ``ar_en``). Speechmatics rejects ``output_locale=ar`` with ``ar_en``."""
    if _speechmatics_is_ar_en_pack(lang):
        return False
    x = (lang or "").strip().lower().replace("-", "_")
    if not x:
        return False
    return x == "ar" or x.startswith("ar_") or x.startswith("arabic")


def _resolve_speechmatics_output_locale(lang: str) -> str | None:
    """Default ``output_locale=ar`` only for monolingual Arabic (e.g. ``ar``). Not valid for ``ar_en`` (API error).

    Set ``SPEECHMATICS_OUTPUT_LOCALE=`` (empty) to omit. For ``ar_en``, use only values Speechmatics documents for
    that pack, or leave unset.
    """
    key = "SPEECHMATICS_OUTPUT_LOCALE"
    if key not in os.environ:
        out = "ar" if _speechmatics_is_monolingual_arabic(lang) else None
    else:
        out = (os.environ.get(key) or "").strip() or None
    if out and _speechmatics_is_ar_en_pack(lang) and out.lower() in ("ar", "ara"):
        logger.warning(
            "speechmatics: output_locale=%r is not supported for lang=%s; omitting (use ar_en docs or SPEECHMATICS_LANGUAGE=ar)",
            out,
            lang,
        )
        return None
    return out


def _parse_speechmatics_extra_vocab_env(raw: str) -> list:
    """Parse ``SPEECHMATICS_EXTRA_VOCAB`` — JSON array of objects, or ``content|alias1|alias2;...``."""
    s = (raw or "").strip()
    if not s:
        return []
    if not SPEECHMATICS_AVAILABLE:
        return []
    if s.startswith("["):
        try:
            data = json.loads(s)
        except json.JSONDecodeError as e:
            logger.warning("SPEECHMATICS_EXTRA_VOCAB JSON invalid: %s", e)
            return []
        out: list = []
        if not isinstance(data, list):
            logger.warning("SPEECHMATICS_EXTRA_VOCAB JSON must be a list")
            return []
        for item in data:
            if not isinstance(item, dict):
                continue
            c = item.get("content")
            if not isinstance(c, str) or not c.strip():
                continue
            sl = item.get("sounds_like")
            sounds: list[str] | None = None
            if isinstance(sl, list):
                sounds = [str(x).strip() for x in sl if str(x).strip()]
            elif isinstance(sl, str) and sl.strip():
                sounds = [sl.strip()]
            out.append(AdditionalVocabEntry(content=c.strip(), sounds_like=sounds or None))
        return out
    out2: list = []
    for seg in s.split(";"):
        seg = seg.strip()
        if not seg:
            continue
        parts = [p.strip() for p in seg.split("|")]
        if not parts or not parts[0]:
            continue
        content = parts[0]
        sounds = [p for p in parts[1:] if p]
        out2.append(AdditionalVocabEntry(content=content, sounds_like=sounds if sounds else None))
    return out2


def _merge_additional_vocab_entries(*lists) -> list:
    seen: set[str] = set()
    merged: list = []
    for lst in lists:
        for e in lst:
            key = getattr(e, "content", None)
            if not isinstance(key, str) or not key.strip():
                continue
            if key in seen:
                continue
            seen.add(key)
            merged.append(e)
    return merged


def create_speechmatics_stt():
    """Build Speechmatics STT for AgentSession.

    Aligns with LiveKit plugin parameters (``language``, ``operating_point``, ``max_delay``,
    ``end_of_utterance_*``, ``enable_partials``) per https://docs.livekit.io/agents/models/stt/plugins/speechmatics/

    Note (livekit-plugins-speechmatics): ``ConversationConfig`` / server EOU silence is only sent when
    ``end_of_utterance_mode`` is **FIXED**. ADAPTIVE/NONE rely on server + client fallback timer — for
    ``ar_en`` interviews we default FIXED unless you override.
    """
    api_key = os.getenv("SPEECHMATICS_API_KEY")
    if not SPEECHMATICS_AVAILABLE or not api_key:
        raise ValueError(
            "Speechmatics required: install livekit-agents[speechmatics] and set SPEECHMATICS_API_KEY"
        )
    lang = os.getenv("SPEECHMATICS_LANGUAGE", "ar_en")
    interview_boost = interview_defaults_enabled()
    # Fixed STT pack: honor SPEECHMATICS_EOU_SILENCE / SPEECHMATICS_MAX_DELAY without interview-boost floors (e.g. 0.6 / 0.9).
    stt_fixed_pack = os.getenv("SPEECHMATICS_INTERVIEW_FIXED_STT", "true").lower() in ("1", "true", "yes")
    _ar_en_pack = _speechmatics_is_ar_en_pack(lang)
    # Bilingual ar_en: adaptive EOU + SM Fallback EOU in logs often aligns with extra pipeline jitter vs avatar.
    # Default FIXED for interview+ar_en unless SPEECHMATICS_EOU_MODE is set or SPEECHMATICS_AR_EN_DEFAULT_FIXED_EOU=false.
    _eou_env = os.getenv("SPEECHMATICS_EOU_MODE")
    _ar_en_fixed_default = os.getenv("SPEECHMATICS_AR_EN_DEFAULT_FIXED_EOU", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    if _eou_env is not None and _eou_env.strip() != "":
        eou_mode_raw = _eou_env.strip().lower()
    elif interview_boost and _ar_en_pack and _ar_en_fixed_default:
        eou_mode_raw = "fixed"
        logger.debug(
            "speechmatics interview: ar_en default EOU=fixed (override with SPEECHMATICS_EOU_MODE=adaptive)"
        )
    else:
        eou_mode_raw = "adaptive" if interview_boost else "fixed"

    # ar_en + interview: adaptive EOU is often the source of repeated fallback EOU and jittery handoffs.
    # Keep fixed unless explicitly allowed.
    allow_adaptive_ar_en = os.getenv("SPEECHMATICS_AR_EN_ALLOW_ADAPTIVE", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    if interview_boost and _ar_en_pack and eou_mode_raw == "adaptive" and not allow_adaptive_ar_en:
        logger.warning(
            "speechmatics interview: forcing ar_en EOU to fixed (set SPEECHMATICS_AR_EN_ALLOW_ADAPTIVE=true to keep adaptive)"
        )
        eou_mode_raw = "fixed"

    op_raw = os.getenv("SPEECHMATICS_OPERATING_POINT", "enhanced").strip().lower()
    if op_raw not in ("enhanced", "standard"):
        op_raw = "enhanced"

    if stt_fixed_pack:
        # Speechmatics RT rejects max_delay < 0.7 (server: transcription_config.max_delay).
        _api_min_max = float(os.getenv("SPEECHMATICS_API_MIN_MAX_DELAY", "0.7"))
        configured_max = float(os.getenv("SPEECHMATICS_MAX_DELAY", "0.70"))
        _max_abs_floor = float(os.getenv("SPEECHMATICS_MAX_DELAY_MIN", str(_api_min_max)))
        _max_abs_floor = max(_api_min_max, _max_abs_floor)
        max_delay = min(2.0, max(_max_abs_floor, configured_max))
        eou_silence = float(os.getenv("SPEECHMATICS_EOU_SILENCE", "0.40"))
        logger.debug(
            "speechmatics SPEECHMATICS_INTERVIEW_FIXED_STT: max_delay=%.2f eou_silence=%.2f (interview boost skipped)",
            max_delay,
            eou_silence,
        )
    else:
        configured_max = float(os.getenv("SPEECHMATICS_MAX_DELAY", "1.0"))
        max_delay = min(2.0, max(0.7, configured_max))
        if configured_max < 0.7:
            logger.warning("SPEECHMATICS_MAX_DELAY=%s clamped to 0.7", configured_max)
        eou_silence = float(os.getenv("SPEECHMATICS_EOU_SILENCE", "0.75"))

    if interview_boost and not stt_fixed_pack:
        _fast = avatar_fast_response()
        # Stability-driven STT floors only when not asking for fast avatar turns.
        _stt_stable = avatar_stability_mode() and not _fast
        if op_raw == "standard":
            logger.debug("speechmatics interview boost: operating_point enhanced (was standard)")
            op_raw = "enhanced"
        # Keep interview defaults responsive by default; allow explicit env override for stricter stability.
        # Latency (AVATAR_FAST_RESPONSE / INTERVIEW_PROFILE=latency): lower target → faster finals after EOU.
        # Stability: higher buffer → fuller lines, fewer dropped onsets (ar_en).
        _target_max_default = (
            "0.95"
            if (_fast and not _stt_stable)
            else ("1.06" if not _stt_stable else "1.22")
        )
        _target_max = float(os.getenv("SPEECHMATICS_INTERVIEW_TARGET_MAX_DELAY", _target_max_default))
        if max_delay < _target_max:
            logger.debug(
                "speechmatics interview boost: max_delay=%.2f (responsive default; was %.2f)",
                _target_max,
                max_delay,
            )
            max_delay = min(2.0, max(0.7, _target_max))
        _min_eou_default = "0.56" if not _stt_stable else "0.72"
        _min_eou = float(os.getenv("SPEECHMATICS_INTERVIEW_MIN_EOU_SILENCE", _min_eou_default))
        if eou_silence < _min_eou:
            logger.debug("speechmatics interview boost: eou_silence=%.2f (was %.2f)", _min_eou, eou_silence)
            eou_silence = _min_eou
        if os.getenv("SPEECHMATICS_INTERVIEW_FORCE_FIXED_EOU", "false").lower() in (
            "1",
            "true",
            "yes",
        ) and eou_mode_raw in ("adaptive", "none"):
            logger.debug(
                "speechmatics interview: eou_mode=fixed (SPEECHMATICS_INTERVIEW_FORCE_FIXED_EOU; was %s)",
                eou_mode_raw,
            )
            eou_mode_raw = "fixed"
        if max_delay >= 0.95 and eou_silence < 0.75:
            cap = min(0.78, max_delay - 0.12)
            if cap > eou_silence:
                logger.debug("speechmatics stability: eou_silence %.2f -> %.2f", eou_silence, cap)
                eou_silence = cap
        # Only enforce very high EOU floor in strict stability mode; otherwise keep faster turn-taking.
        if _stt_stable and eou_silence < 0.76:
            eou_silence = min(0.78, max_delay - 0.08)
            logger.debug(
                "speechmatics interview (strict): eou_silence -> %.2f (fewer micro-fragments)",
                eou_silence,
            )
        # FIXED: long silence before EOU reduces cut-off mid-thought. ADAPTIVE: softer floor so SM can
        # adjust per pause (avoids over-rigid 0.88s that can feel like word-by-word splits vs full lines).
        if eou_mode_raw == "adaptive":
            # Lower cap vs fixed mode: faster finals / less dead air before LLM→TTS→avatar (tunable).
            soft_cap = float(os.getenv("SPEECHMATICS_INTERVIEW_ADAPTIVE_SOFT_CAP", "0.76"))
            soft_cap = max(0.55, min(0.88, soft_cap))
            soft_floor = min(soft_cap, max(0.52, max_delay - 0.28))
            if eou_silence < soft_floor:
                logger.debug(
                    "speechmatics interview (adaptive): eou_silence %.2f -> %.2f (EOU floor; avatar latency)",
                    eou_silence,
                    soft_floor,
                )
                eou_silence = soft_floor
        else:
            # Fast profile: shorter pause before EOU → earlier finals → quicker lip animation start.
            floor = (
                min(0.78, max_delay - 0.15)
                if _fast
                else min(0.88, max_delay - 0.1)
            )
            if eou_silence < floor:
                logger.debug(
                    "speechmatics interview (fixed): eou_silence %.2f -> %.2f (%s)",
                    eou_silence,
                    floor,
                    "AVATAR_FAST_RESPONSE" if _fast else "full utterance before agent",
                )
                eou_silence = floor
        if _fast:
            logger.debug("speechmatics: AVATAR_FAST_RESPONSE=true")

    operating_point = (
        OperatingPoint.ENHANCED if op_raw == "enhanced" else OperatingPoint.STANDARD
    )
    eou_mode = resolve_speechmatics_eou_mode(eou_mode_raw)

    if eou_silence >= max_delay:
        eou_silence = max(0.15, max_delay - 0.05)
        logger.warning("SPEECHMATICS_EOU_SILENCE clamped to %.2f (must be < max_delay)", eou_silence)

    # Plugin + RT: keep a minimum gap so finals are not rushed vs silence trigger (fewer odd EOU timings).
    min_gap = float(os.getenv("SPEECHMATICS_MAX_DELAY_EOU_GAP", "0.08"))
    if max_delay < eou_silence + min_gap:
        new_max = min(2.0, eou_silence + min_gap)
        logger.debug(
            "speechmatics: max_delay %.2f -> %.2f (ensure >= eou_silence + %.2f)",
            max_delay,
            new_max,
            min_gap,
        )
        max_delay = new_max

    # Speechmatics RT: transcription_config.max_delay must be >= 0.7 (override env if lower).
    _api_min_max = float(os.getenv("SPEECHMATICS_API_MIN_MAX_DELAY", "0.7"))
    if max_delay < _api_min_max:
        logger.warning(
            "speechmatics: max_delay %.2f -> %.2f (Speechmatics RT API minimum)",
            max_delay,
            _api_min_max,
        )
        max_delay = _api_min_max
    if max_delay < eou_silence + min_gap:
        max_delay = min(2.0, eou_silence + min_gap)
    if max_delay < _api_min_max:
        max_delay = _api_min_max
        if eou_silence >= max_delay - min_gap:
            eou_silence = max(0.15, max_delay - min_gap - 0.02)
            logger.warning(
                "speechmatics: eou_silence -> %.2f (must be < max_delay with gap %.2f)",
                eou_silence,
                min_gap,
            )

    # Real-time partial transcripts (streaming): on for fixed pack + explicit env; interview boost alone defaulted off.
    _partials_default = (
        "true"
        if (stt_fixed_pack or not interview_boost)
        else "false"
    )
    enable_partials = os.getenv("SPEECHMATICS_ENABLE_PARTIALS", _partials_default).lower() not in (
        "0",
        "false",
        "no",
    )

    output_locale = _resolve_speechmatics_output_locale(lang)
    extra_vocab_raw = os.getenv("SPEECHMATICS_EXTRA_VOCAB", "")
    # English HR/interview loanwords are merged in only for bilingual (ar_en) packs.
    # On a monolingual ar pack they would be wasted; on en they're already covered.
    # Disable explicitly with SPEECHMATICS_DISABLE_EN_INTERVIEW_VOCAB=true if needed.
    disable_en_vocab = os.getenv("SPEECHMATICS_DISABLE_EN_INTERVIEW_VOCAB", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    en_vocab: list = []
    if _speechmatics_is_ar_en_pack(lang) and not disable_en_vocab:
        en_vocab = list(EN_INTERVIEW_DEFAULT_VOCAB)
    additional_vocab = _merge_additional_vocab_entries(
        IRAQI_ADDITIONAL_VOCAB,
        AR_INTERVIEW_DEFAULT_VOCAB,
        en_vocab,
        _parse_speechmatics_extra_vocab_env(extra_vocab_raw),
    )
    rt_url = (os.getenv("SPEECHMATICS_RT_URL") or "").strip()
    domain = (os.getenv("SPEECHMATICS_DOMAIN") or "").strip() or None

    try:
        sample_rate = int(os.getenv("SPEECHMATICS_SAMPLE_RATE", "16000"))
    except ValueError:
        sample_rate = 16000
    sample_rate = max(8000, min(48000, sample_rate))
    try:
        chunk_size = int(os.getenv("SPEECHMATICS_CHUNK_SIZE", "160"))
    except ValueError:
        chunk_size = 160
    chunk_size = max(80, min(4096, chunk_size))

    stt_kw: dict[str, Any] = {
        "api_key": api_key,
        "language": lang,
        "enable_partials": enable_partials,
        "operating_point": operating_point,
        "max_delay": max_delay,
        "end_of_utterance_silence_trigger": eou_silence,
        "end_of_utterance_mode": eou_mode,
        "additional_vocab": additional_vocab,
        "sample_rate": sample_rate,
        "chunk_size": chunk_size,
    }
    if output_locale:
        stt_kw["output_locale"] = output_locale
    if rt_url:
        stt_kw["base_url"] = rt_url
    if domain:
        stt_kw["domain"] = domain

    stt = speechmatics.STT(**stt_kw)
    logger.info(
        "Speechmatics STT | lang=%s op=%s max_delay=%.2f eou_silence=%.2f eou_mode=%s partials=%s "
        "sample_rate=%d chunk=%d rt=%s domain=%s output_locale=%s vocab=%d",
        lang,
        op_raw,
        max_delay,
        eou_silence,
        eou_mode_raw,
        enable_partials,
        sample_rate,
        chunk_size,
        "default" if not rt_url else "SPEECHMATICS_RT_URL",
        domain or "-",
        output_locale or "-",
        len(additional_vocab),
    )
    return stt


def create_avatar_session() -> AvatarSession | None:
    api_key = os.getenv("BEYOND_PRESENCE_API_KEY")
    avatar_id = os.getenv("BEYOND_PRESENCE_AVATAR_ID")
    api_url = os.getenv("BEYOND_PRESENCE_API_URL")
    if not api_key or not avatar_id:
        logger.error("BEYOND_PRESENCE_API_KEY and BEYOND_PRESENCE_AVATAR_ID are required")
        return None
    if avatar_id == LEGACY_WRONG_AVATAR_ID:
        logger.warning("Replacing legacy avatar id with %s", DEFAULT_AVATAR_ID)
        avatar_id = DEFAULT_AVATAR_ID
    try:
        session = AvatarSession(
            avatar_id=avatar_id,
            api_key=api_key,
            api_url=api_url if api_url else None,
        )
        logger.debug("AvatarSession created | avatar_id=%s", avatar_id)
        return session
    except Exception as e:
        logger.error("AvatarSession failed: %s", e, exc_info=True)
        return None
