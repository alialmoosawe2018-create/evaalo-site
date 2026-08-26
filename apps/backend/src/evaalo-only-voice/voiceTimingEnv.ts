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
  /** سقف أقصى إن لم يصل playback_ended من العميل بعد رد الإيجنت */
  playbackEndedTimeoutMs: number;
  /**
   * يُضاف على مدة الصوت الفعلية لتكوين مهلة الانتظار عند فقدان playback_ended.
   * السقف وحده كان يعني نصف دقيقة صمت إذا جمّد المتصفح تبويبةً خلفية.
   */
  playbackEndedMarginMs: number;
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
  /** يُضاف على نافذة الصمت حين ينتهي الدور بذيل غير مكتمل (حرف ربط أو كلمة مبتورة) */
  incompleteTailExtraMs: number;
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
    playbackEndedMarginMs: n(process.env.VOICE_PLAYBACK_ENDED_MARGIN_MS, 3000, 500),
    playbackFallbackMs: n(process.env.VOICE_PLAYBACK_FALLBACK_MS, 15000, 3000),
    postPlaybackResumeMs: n(process.env.VOICE_POST_PLAYBACK_RESUME_MS, 600, 0),
    lateTranscriptIgnoreMs: n(process.env.VOICE_LATE_TRANSCRIPT_IGNORE_MS, 300, 0),
    incompleteTailExtraMs: n(process.env.VOICE_INCOMPLETE_TAIL_EXTRA_MS, 700, 0),
  };
}

/** أقل عدد كلمات يُسمح معه بالنافذة القصيرة — الردود الأقصر غالباً لم تكتمل بعد */
export const MIN_WORDS_FOR_FAST_END = 4;

/**
 * أدوات ربط وجرّ وحشو: وجودها في آخر الدور يعني أن المتحدث لم يُكمل جملته، حتى لو
 * ألحق الـ STT نقطة بعدها.
 */
const DANGLING_TAIL_TOKENS = new Set([
  "و", "او", "أو", "ثم", "في", "من", "الى", "إلى", "على", "عن", "مع", "بين", "عند",
  "لكن", "ولكن", "حتى", "لان", "لأن", "لانه", "لأنه", "اللي", "الي", "يعني", "انه",
  "إنه", "اني", "إني", "ان", "أن", "ما", "مو", "بس", "كان", "چان", "هم", "هي", "هو",
  "and", "or", "but", "so", "because", "with", "for", "to", "of", "in", "on", "at",
  "the", "a", "an", "that", "which", "if", "when", "then", "my", "our", "their", "as",
]);

/** كلمات قصيرة قائمة بذاتها — لا تُعدّ مبتورة */
const STANDALONE_SHORT_TOKENS = new Set(["لا", "اي", "no", "ok"]);

const tailToken = (text: string): string => {
  const stripped = text.trim().replace(/[.,!?؟،؛:]+$/u, "").trim();
  if (!stripped) return "";
  const words = stripped.split(/\s+/);
  return (words[words.length - 1] || "").toLowerCase();
};

/**
 * ذيل غير مكتمل: الدور ينتهي بحرف ربط أو بكلمة عربية مبتورة (حرف أو حرفان مثل «كم»
 * وهي بداية «كأخصائي»). جلسة الإنتاج 788a5d4a قُطعت وسط الكلمة لهذا السبب، فالنقطة
 * التي يضيفها Speechmatics بعد مثل هذه الذيول وهمية ولا تعني انتهاء الجملة.
 */
export function tailLooksIncomplete(text: string): boolean {
  const last = tailToken(text);
  if (!last) return false;
  if (STANDALONE_SHORT_TOKENS.has(last)) return false;
  if (DANGLING_TAIL_TOKENS.has(last)) return true;
  return /^[\u0621-\u064A]{1,2}$/.test(last);
}

export function countTurnWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * نافذة إنهاء الدور، ثلاث حالات:
 *   - ذيل غير مكتمل → نافذة ممتدة (defaultMs + extra) حتى يُكمل المتحدث.
 *   - ذيل نهائي مُثبَّت + ترقيم + طول كافٍ → النافذة القصيرة (استجابة أسرع).
 *   - ما عدا ذلك → النافذة الافتراضية.
 * ترقيم الجزئيات غير موثوق (Speechmatics يضيف "." وسط الجملة)، وكذلك ترقيم المقاطع
 * النهائية القصيرة، فكلاهما لا يُفعّل النافذة القصيرة.
 */
export function resolveTurnSilenceMs(opts: {
  tailIsFinal: boolean;
  endsWithPunctuation: boolean;
  punctuationMs: number;
  defaultMs: number;
  /** نص الدور المتراكم — بدونه يعود السلوك للسابق (نافذة الترقيم دون فحص الذيل) */
  text?: string;
  incompleteTailExtraMs?: number;
}): number {
  if (opts.text !== undefined) {
    if (tailLooksIncomplete(opts.text)) {
      return opts.defaultMs + (opts.incompleteTailExtraMs ?? 0);
    }
    if (countTurnWords(opts.text) < MIN_WORDS_FOR_FAST_END) return opts.defaultMs;
  }
  return opts.tailIsFinal && opts.endsWithPunctuation ? opts.punctuationMs : opts.defaultMs;
}

/**
 * مهلة سماح تُمنح **مرّة واحدة** عند انطلاق مؤقّت الصمت: ننتظر قليلاً لينزل النهائي
 * المتأخّر من Speechmatics (حتى ~1.35s) أو ليستأنف المتحدث كلامه، قبل إرسال الدور.
 * كانت تُمنح فقط عند وجود جزئي معلّق، فالذيل النهائي كان يُرسل بلا أي هامش ويُبتر
 * كلام المرشح بعد توقّف قصير للتفكير. مرّة واحدة فقط كي لا يتأخّر الرد بلا حدّ.
 */
export function shouldGraceBeforeSend(alreadyGraced: boolean): boolean {
  return !alreadyGraced;
}
