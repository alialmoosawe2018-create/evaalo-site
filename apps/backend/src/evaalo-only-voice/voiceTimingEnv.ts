/**
 * إعدادات VAD (Voice Activity Detection) — Deepgram endpointing، Speechmatics، مسار batch، عتبة RMS.
 * اضبط عبر المتغيرات البيئية؛ القيم الافتراضية موازنة لمقابلات عربي/إنجليزي.
 */
export function getVoiceVadSettings(): {
  /** Deepgram: صمت (ms) قبل اعتبار نهاية الجملة — أقل = استجابة أسرع، أعلى = قطع أقل */
  deepgramEndpointingMs: number;
  /** مسار batch: صمت قبل إرسال المقطع للـ STT */
  batchSilenceMs: number;
  batchSilenceArMs: number;
  /** مسار WebSocket streaming: تجاهل مقاطع أقل من هذا RMS (PCM16، نفس مقياس computePcmRms) */
  pcmStreamingMinRms: number;
  /** مسار batch: متوسط RMS أدنى لاعتبار الصوت كلاماً */
  batchEnergyRms: number;
  /** مسار batch: تكرار فحص الصمت (ms) */
  vadCheckIntervalMs: number;
  /** Speechmatics: تأخير أقصى للجزئيات (ثوانٍ) — أقل = نتائج نهائية أسرع */
  speechmaticsMaxDelaySec: number;
} {
  const n = (v: string | undefined, def: number, min: number, max?: number) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < min) return def;
    if (max !== undefined && x > max) return max;
    return x;
  };
  return {
    deepgramEndpointingMs: n(process.env.VOICE_DEEPGRAM_ENDPOINTING_MS, 800, 100, 3000),
    batchSilenceMs: n(process.env.VOICE_BATCH_SILENCE_MS, 1000, 300, 5000),
    batchSilenceArMs: n(process.env.VOICE_BATCH_SILENCE_AR_MS, 1150, 300, 5000),
    pcmStreamingMinRms: n(process.env.VOICE_PCM_MIN_RMS, 48, 0, 4000),
    batchEnergyRms: n(process.env.VOICE_BATCH_ENERGY_RMS, 175, 50, 4000),
    vadCheckIntervalMs: n(process.env.VOICE_VAD_CHECK_INTERVAL_MS, 350, 100, 2000),
    speechmaticsMaxDelaySec: n(process.env.VOICE_SPEECHMATICS_MAX_DELAY_SEC, 1.35, 0.2, 2.5),
  };
}

/**
 * مؤقتات مسار الصوت — قابلة للضبط عبر .env لتسريع الاستجابة أو زيادة الاستقرار.
 */
export function getVoiceResponseTiming(): {
  userStoppedSpeakingMs: number;
  userStoppedPunctuationMs: number;
  speechSilenceMs: number;
  ttsToSttDelayMs: number;
  postAudioPaddingMs: number;
  postTtsPaddingMs: number;
  useTtsTimestamps: boolean;
  /** مهلة أقصاها إن لم يصل playback_ended من العميل بعد رد الإيجنت */
  playbackEndedTimeoutMs: number;
  /** مهلة احتياطية للترحيب/الإغلاق إن لم يُبلغ العميل عن انتهاء التشغيل */
  playbackFallbackMs: number;
  /** بعد انتهاء التشغيل قبل استئناف الاستماع */
  postPlaybackResumeMs: number;
  /**
   * نافذة إسقاط أي transcript يصل مباشرة بعد فتح الاستماع.
   * الحماية الأساسية من تسرّب الدور السابق هي إغلاق اتصال STT وإعادة فتحه أثناء كلام
   * الإيجنت (sttPurgeToken)؛ هذه النافذة طبقة ثانية فقط، لذلك تبقى قصيرة كي لا تبتلع
   * أول كلمة يقولها المرشح.
   */
  lateTranscriptIgnoreMs: number;
} {
  const n = (v: string | undefined, def: number, min: number) => {
    const x = Number(v);
    if (Number.isFinite(x) && x >= min) return x;
    return def;
  };
  return {
    /** بعد آخر حرف STT: صمت أطول بدون علامة ترقيم — يقلل القطع وسط التفكير */
    userStoppedSpeakingMs: n(process.env.VOICE_USER_STOPPED_MS, 1300, 400),
    /** مع . ؟ ! — يُفترض انتهاء الجملة أسرع */
    userStoppedPunctuationMs: n(process.env.VOICE_USER_STOPPED_PUNCT_MS, 1050, 300),
    speechSilenceMs: n(process.env.VOICE_SPEECH_SILENCE_MS, 1000, 300),
    ttsToSttDelayMs: n(process.env.VOICE_TTS_TO_STT_DELAY_MS, 600, 0),
    postAudioPaddingMs: n(process.env.VOICE_POST_AUDIO_PADDING_MS, 250, 0),
    postTtsPaddingMs: n(process.env.VOICE_POST_TTS_PADDING_MS, 200, 0),
    useTtsTimestamps:
      process.env.VOICE_TTS_USE_TIMESTAMPS !== "false" &&
      process.env.VOICE_TTS_USE_TIMESTAMPS !== "0",
    playbackEndedTimeoutMs: n(process.env.VOICE_PLAYBACK_ENDED_TIMEOUT_MS, 30000, 5000),
    playbackFallbackMs: n(process.env.VOICE_PLAYBACK_FALLBACK_MS, 15000, 3000),
    postPlaybackResumeMs: n(process.env.VOICE_POST_PLAYBACK_RESUME_MS, 600, 0),
    lateTranscriptIgnoreMs: n(process.env.VOICE_LATE_TRANSCRIPT_IGNORE_MS, 300, 0),
  };
}
