// ============================================
// ملف: services/sttRouterService.ts
// الوظيفة: توجيه STT — بث Speechmatics ثنائي اللغة (ar_en) عند التوفّر، ثم Deepgram للإنجليزي إن نقص SM، ثم batch
// ============================================

import axios from "axios";
import FormData from "form-data";
import { convertPCM16ToWAV } from "./audioUtils.js";
import { detectLanguage } from "./languageDetection.js";
import { transcribePCM as deepgramTranscribe } from "./deepgramPreRecordedService.js";
import { transcribePCM as speechmaticsTranscribe } from "./speechmaticsBatchService.js";
import {
  createDeepgramConnection,
  sendAudioToDeepgram,
  closeDeepgramConnection,
  hasDeepgramConnection,
} from "./deepgramStreamingService.js";
import {
  createSpeechmaticsConnection,
  sendAudioToSpeechmatics,
  closeSpeechmaticsConnection,
  hasSpeechmaticsConnection,
} from "./speechmaticsStreamingService.js";
import { getVoiceVadSettings } from "../evaalo-only-voice/voiceTimingEnv.js";
import { getSttPurgeToken, shouldKeepLateBatch } from "../evaalo-only-voice/sttPurgeToken.js";
import { recordMetricAsync } from "./siteMetricService.js";

/** لقطة إعدادات VAD عند التشغيل — يعاد تشغيل الخادم بعد تغيير .env */
const STT_VAD = getVoiceVadSettings();

const OPENAI_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const MIN_AUDIO_LENGTH_MS = 600;
const MAX_AUDIO_LENGTH_MS = 10000; // max_duration: 10s
const MAX_UTTERANCE_MS = 10000;    // قص الجمل الطويلة: 10s
const MAX_CONSECUTIVE_ERRORS = 3;

function computePcmRms(buffer: Buffer): number {
  if (buffer.length < 2) return 0;
  let sum = 0;
  const len = Math.floor(buffer.length / 2);
  for (let i = 0; i < len; i++) {
    const s = buffer.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / len);
}

// Map لتخزين audio buffers لكل session
const audioBuffers = new Map<
  string,
  {
    buffers: Buffer[];
    onTranscript: (text: string, isFinal: boolean, confidence?: number) => void;
    /** دفعة عادت بعد إرسال الدور: تُقيَّد في السجلّ ولا تُشغّل دوراً جديداً. */
    onLateTranscript?: (text: string) => void;
    onError: (error: Error) => void;
    lastProcessTime: number;
    lastLoudTime: number;
    processingInterval?: NodeJS.Timeout;
    consecutiveErrors: number;
    isStopped: boolean;
    preferredLanguage?: "ar" | "en";
    lastDetectedLanguage?: "ar" | "en";
  }
>();

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

const warnedSessions = new Set<string>();

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY;
}

function hasDeepgram() {
  return !!process.env.DEEPGRAM_API_KEY;
}

function hasSpeechmatics() {
  return !!process.env.SPEECHMATICS_API_KEY;
}

/**
 * المسار الثقيل (LID عبر Whisper ثم Deepgram/Speechmatics) — عطّل افتراضياً.
 * فعّل فقط إذا احتجت التوجيه حسب لغة كل مقطع في وضع batch: STT_ENABLE_BATCH_LID_ROUTING=1
 */
function useAutoRouting() {
  const enabled =
    process.env.STT_ENABLE_BATCH_LID_ROUTING === "true" ||
    process.env.STT_ENABLE_BATCH_LID_ROUTING === "1";
  if (!enabled) return false;
  return hasDeepgram() && hasSpeechmatics() && !!getOpenAIKey();
}

const STT_BATCH_LIGHT_TIMEOUT_MS = 8000;

async function transcribeBatchLightweight(pcmBuffer: Buffer): Promise<string> {
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("STT timeout")), ms)),
    ]);

  if (hasSpeechmatics()) {
    try {
      return await withTimeout(speechmaticsTranscribe(pcmBuffer), STT_BATCH_LIGHT_TIMEOUT_MS);
    } catch (e: any) {
      console.warn(`[STT] Speechmatics batch failed: ${e?.message || e}`);
    }
  }
  if (hasDeepgram()) {
    try {
      return await withTimeout(deepgramTranscribe(pcmBuffer), STT_BATCH_LIGHT_TIMEOUT_MS);
    } catch (e: any) {
      console.warn(`[STT] Deepgram batch failed: ${e?.message || e}`);
    }
  }
  return whisperTranscribe(pcmBuffer);
}

/**
 * Whisper fallback - تحويل PCM16 إلى نص
 */
async function whisperTranscribe(pcmBuffer: Buffer): Promise<string> {
  const key = getOpenAIKey();
  if (!key) return "";

  const wavBuffer = convertPCM16ToWAV(pcmBuffer, 16000, 1);
  const formData = new FormData();
  formData.append("file", wavBuffer, {
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  formData.append("model", "whisper-1");
  formData.append("response_format", "json");

  const response = await axios.post(OPENAI_API_URL, formData, {
    headers: {
      Authorization: `Bearer ${key}`,
      ...formData.getHeaders(),
    },
    timeout: 30000,
  });

  return (response.data?.text || "").trim();
}

/**
 * تحويل PCM16 إلى نص حسب اللغة المكتشفة
 */
async function transcribeWithRouting(pcmBuffer: Buffer): Promise<string> {
  if (!useAutoRouting()) {
    return transcribeBatchLightweight(pcmBuffer);
  }

  const lang = await detectLanguage(pcmBuffer);

  const isRetriableError = (e: any) =>
    /socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(e?.message || "") ||
    e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT";

  const STT_PRIMARY_TIMEOUT_MS = 6000; // fallback سريع: 6s بدل انتظار طويل

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("STT timeout")), ms))]);

  try {
    if (lang === "en") {
      return await withTimeout(deepgramTranscribe(pcmBuffer), STT_PRIMARY_TIMEOUT_MS);
    }
    if (lang === "ar") {
      try {
        return await withTimeout(speechmaticsTranscribe(pcmBuffer), STT_PRIMARY_TIMEOUT_MS);
      } catch (err1: any) {
        if (isRetriableError(err1)) {
          console.log(`[STT RETRY] Speechmatics failed (${err1.message}), retrying once...`);
          return await withTimeout(speechmaticsTranscribe(pcmBuffer), STT_PRIMARY_TIMEOUT_MS);
        }
        throw err1;
      }
    }
  } catch (err: any) {
    console.error(`[STT FALLBACK] ${lang === "en" ? "Deepgram" : "Speechmatics"} failed, using Whisper: ${err.message}`);
  }

  return whisperTranscribe(pcmBuffer);
}

async function processAudioBuffer(sessionId: string): Promise<void> {
  const conn = audioBuffers.get(sessionId);
  if (!conn || conn.buffers.length === 0) return;
  if (conn.isStopped) {
    conn.buffers = [];
    return;
  }

  const totalBytes = conn.buffers.reduce((sum, buf) => sum + buf.length, 0);
  const durationMs = (totalBytes / 2 / 16000) * 1000;

  if (durationMs > MAX_AUDIO_LENGTH_MS) {
    conn.buffers = [];
    return;
  }
  if (durationMs < MIN_AUDIO_LENGTH_MS) return;

  const audioData = Buffer.concat(conn.buffers);
  const avgRms = computePcmRms(audioData);
  if (avgRms < STT_VAD.batchEnergyRms) return;

  const now = Date.now();
  const silenceMs = now - conn.lastLoudTime;
  const useArabicThreshold =
    conn.preferredLanguage === "ar" || conn.lastDetectedLanguage === "ar";
  const silenceThreshold = useArabicThreshold ? STT_VAD.batchSilenceArMs : STT_VAD.batchSilenceMs;
  const bySilence = silenceMs >= silenceThreshold;
  const byMaxDuration = durationMs >= MAX_UTTERANCE_MS;
  const shouldProcess = bySilence || byMaxDuration;
  if (!shouldProcess) return;

  const tokenAtBatchStart = getSttPurgeToken(sessionId);
  conn.buffers = [];
  conn.lastProcessTime = now;
  conn.lastLoudTime = now;

  const processReason = byMaxDuration ? "max_duration" : "silence";
  console.log(`[STT PROCESS] ${sessionId.substring(0, 8)}... reason: ${processReason} durationMs: ${Math.round(durationMs)} silenceMs: ${silenceMs}`);

  try {
    let transcript: string;
    if (conn.preferredLanguage === "ar" && hasSpeechmatics()) {
      transcript = await speechmaticsTranscribe(audioData);
    } else if (conn.preferredLanguage === "en" && hasDeepgram()) {
      transcript = await deepgramTranscribe(audioData);
    } else {
      transcript = await transcribeWithRouting(audioData);
    }
    if (getSttPurgeToken(sessionId) !== tokenAtBatchStart) {
      /**
       * الدفعة عادت بعد أن تقدّم الدور. الرمي هو التصرّف الصحيح إن كان الإيجنت قد
       * بدأ الكلام — فما وصل قد يكون صدى صوته. أمّا إن كان الرفع الوحيد هو إرسال
       * الدور، فهذا كلام المرشّح: قِيل، وسُجّل، ونُسخ بنجاح. رميُه يعني أن يحكم
       * المُقيّم على شظيّة من جواب كامل، وهو ما حدث في الجلسة 6afff73c.
       *
       * فيُسلَّم للسجلّ لا للحوار: `isFinal: false` هنا علامةٌ متّفق عليها مع
       * `handleTranscript` تعني «قيّده ولا تُشغّل به دوراً».
       */
      if (transcript.trim().length > 0 && shouldKeepLateBatch(sessionId, tokenAtBatchStart)) {
        console.log(
          `[STT LATE] ${sessionId.substring(0, 8)}... late batch kept for the record: "${transcript.trim().substring(0, 60)}"`
        );
        conn.onLateTranscript?.(transcript.trim());
        return;
      }
      console.log(`[STT DROP] ${sessionId.substring(0, 8)}... stale batch transcript (purged while transcribing)`);
      return;
    }
    if (conn) conn.consecutiveErrors = 0;

    if (transcript.trim().length > 0) {
      if (conn) conn.lastDetectedLanguage = isArabicText(transcript) ? "ar" : "en";
      conn.onTranscript(transcript, true, undefined);
    } else {
      console.warn(`[STT EMPTY] ${sessionId.substring(0, 8)}... audio ${Math.round(durationMs)}ms processed, no transcript`);
    }
  } catch (err: any) {
    if (conn) {
      conn.consecutiveErrors++;
      if (conn.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        conn.isStopped = true;
        if (conn.processingInterval) {
          clearInterval(conn.processingInterval);
          conn.processingInterval = undefined;
        }
        console.error(`[STT ERROR] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
        conn.onError(err);
      }
    }
  }
}

/**
 * أخطاء اتصال عابرة تستحقّ إعادة المحاولة — شبكة أو DNS، لا إعدادات.
 *
 * مفتاحٌ خاطئ أو غير مضبوط لن يُصلحه التكرار، فإعادةُ المحاولة عليه تُطيل صمت
 * المرشّح بلا فائدة.
 */
const TRANSIENT_STT_ERROR =
  /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|socket hang up|fetch failed|network|timed? ?out|502|503|504/i;

export function isTransientSttError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.message ?? ""} ${e?.code ?? ""} ${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""}`;
  if (/api key|not configured|unauthorized|401|403|invalid.*key/i.test(text)) return false;
  return TRANSIENT_STT_ERROR.test(text);
}

/**
 * جيلُ الاتصال لكل جلسة — تُبطِل إعادةَ محاولةٍ معلّقة بعد إغلاق الجلسة أو بدء
 * اتصال جديد. بدونه قد تُنشئ محاولةٌ متأخّرة اتصالاً لجلسةٍ انتهت.
 */
const sttConnectGeneration = new Map<string, number>();

/** مهل التراجع بين المحاولات. المجموع ~6.4s: يبتلع الانقطاع القصير، ولا يُطيل الصمت. */
const STT_RETRY_DELAYS_MS = [600, 1800, 4000];

/**
 * يصل بـSpeechmatics ويعيد المحاولة عند عطلٍ عابر.
 *
 * من 2026-09-08: انقطع DNS عن `mp.speechmatics.com` و`eu2.rt.speechmatics.com`
 * تسعين ثانية، فسقط إصدارُ رمز المصادقة (`createSpeechmaticsJWT`) — وبلا رمز لا
 * يوجد تعرّفٌ على الكلام إطلاقاً. المرشّح عقيل راضي حاول **سبع مرّات** في أربع
 * دقائق ولم يُسمع منه حرف، لأنّ محاولةً واحدة فاشلة كانت تُنهي المسار بلا إعادة.
 *
 * والصمت وحده لا يُصلح: تُرافقها رسالةٌ صريحة للمرشّح عند الفشل النهائي في
 * `voiceSessionCore` — «انتظر لحظة وحاول» بدل «fetch failed».
 */
function connectSpeechmaticsWithRetry(
  sessionId: string,
  onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
  onError: (error: Error) => void,
  onReady?: () => void
): void {
  const generation = (sttConnectGeneration.get(sessionId) ?? 0) + 1;
  sttConnectGeneration.set(sessionId, generation);

  const attempt = (index: number): void => {
    void createSpeechmaticsConnection(
      sessionId,
      onTranscript,
      (err) => {
        // جلسةٌ أُغلقت أو اتصالٌ أحدث بدأ: لا تُعِد المحاولة ولا تُبلّغ.
        if (sttConnectGeneration.get(sessionId) !== generation) return;
        const delay = STT_RETRY_DELAYS_MS[index];
        if (delay !== undefined && isTransientSttError(err)) {
          console.warn(
            `[STT RETRY] ${sessionId.substring(0, 8)}... attempt ${index + 2}/${STT_RETRY_DELAYS_MS.length + 1} in ${delay}ms — ${err?.message ?? err}`
          );
          setTimeout(() => {
            if (sttConnectGeneration.get(sessionId) !== generation) return;
            attempt(index + 1);
          }, delay);
          return;
        }
        if (index > 0) {
          console.error(
            `[STT GIVE UP] ${sessionId.substring(0, 8)}... ${index + 1} attempts failed — ${err?.message ?? err}`
          );
        }

        /**
         * آخر ما يُجرَّب قبل الاستسلام: المزوّد الثاني.
         *
         * إعادةُ المحاولة تبتلع الانقطاع القصير، وانقطاعُ عقيل راضي دام تسعين ثانية
         * — أطول من أيّ تراجعٍ معقول. والمخرج الحقيقي أنّ Deepgram **مدمجٌ في هذا
         * الملفّ أصلاً** ولا يُبلَغ أبداً: الفرع أعلاه يخرج عند `hasSpeechmatics()`
         * دائماً، فلا يصل التنفيذ إلى فرع Deepgram ما دام مفتاح Speechmatics موجوداً.
         *
         * اسمُ نطاقين لا يسقط معاً في العادة، فهذا يحوّل عطلاً يُفقد المقابلة إلى
         * تبديل مزوّد لا يشعر به المرشّح.
         *
         * وعلى الأعطال **العابرة** فقط: مفتاحٌ خاطئ في Speechmatics عطلُ إعداد يجب
         * أن يُرى ويُصلَح، لا أن يُغطّى بمزوّدٍ بديل إلى ما لا نهاية.
         *
         * ولا نستدعي `onReady` هنا: `createDeepgramConnection` يستدعيها بنفسه عند
         * فتح الاتصال (deepgramStreamingService ~146).
         */
        if (isTransientSttError(err) && hasDeepgram()) {
          console.warn(
            `[STT FAILOVER] ${sessionId.substring(0, 8)}... Speechmatics unreachable — falling back to Deepgram (multi)`
          );
          recordMetricAsync({
            scope: "interview",
            name: "voice:stt_failover",
            durationMs: STT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0),
            outcome: "deepgram",
          });
          createDeepgramConnection(sessionId, onTranscript, onError, onReady, "multi");
          return;
        }

        onError(err);
      },
      onReady
    ).catch(() => {});
  };

  attempt(0);
}

export function createSTTRouterConnection(
  sessionId: string,
  onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
  onError: (error: Error) => void,
  onReady?: () => void,
  language?: string,
  // آخر الوسائط عمداً: وضعُه في الوسط يُزيح onReady وlanguage عند كل مُستدعٍ قائم.
  onLateTranscript?: (text: string) => void
): void {
  const preferEn = language === "en" || language === "english";

  /** مسار موحّد: Speechmatics ar_en كلما كان المفتاح متوفراً (عربي + إنجليزي في جلسة واحدة)، بغضّ النظر عن language. */
  if (hasSpeechmatics()) {
    if (hasSpeechmaticsConnection(sessionId)) {
      console.log(`[STT LISTENING] ${sessionId.substring(0, 8)}... Speechmatics already open (ar_en)`);
      if (onReady) onReady();
      return;
    }
    closeSTTRouterConnection(sessionId);
    console.log(`[STT START] ${sessionId.substring(0, 8)}... mode: Speechmatics streaming (ar_en bilingual)`);
    connectSpeechmaticsWithRetry(sessionId, onTranscript, onError, onReady);
    return;
  }

  /** بدون Speechmatics: جلسة إنجليزية (?language=en) تستخدم Deepgram ثنائي اللغة حتى يُسمع العرب ويُمرَّر للـLLM نصاً صحيحاً. */
  if (preferEn && hasDeepgram()) {
    if (hasDeepgramConnection(sessionId)) {
      console.log(`[STT LISTENING] ${sessionId.substring(0, 8)}... Deepgram already open (multi)`);
      if (onReady) onReady();
      return;
    }
    closeSTTRouterConnection(sessionId);
    console.log(`[STT START] ${sessionId.substring(0, 8)}... mode: Deepgram streaming (multi, en site session)`);
    createDeepgramConnection(sessionId, onTranscript, onError, onReady, "multi");
    if (onReady) onReady();
    return;
  }

  // Fallback: لا Speechmatics → batch + LID (Whisper)
  const key = getOpenAIKey();
  if (!key) {
    onError(new Error("OpenAI API key is not configured (required for LID and Whisper fallback)"));
    return;
  }

  // batch mode: نبدأ وضع جديد دائماً
  closeSTTRouterConnection(sessionId);
  const mode = useAutoRouting()
    ? "Auto (LID → Deepgram en / Speechmatics ar)"
    : "Lightweight batch (Speechmatics → Deepgram → Whisper, no LID)";
  console.log(`[STT START] ${sessionId.substring(0, 8)}... mode: ${mode}`);

  audioBuffers.set(sessionId, {
    buffers: [],
    onTranscript,
    onLateTranscript,
    onError,
    lastProcessTime: Date.now(),
    lastLoudTime: Date.now(),
    consecutiveErrors: 0,
    isStopped: false,
  });

  const conn = audioBuffers.get(sessionId);
  if (conn) {
    conn.processingInterval = setInterval(
      () => processAudioBuffer(sessionId),
      STT_VAD.vadCheckIntervalMs
    );
  }

  if (onReady) onReady();
}

export async function sendAudioToSTTRouter(sessionId: string, audioChunk: Buffer): Promise<void> {
  if (hasDeepgramConnection(sessionId)) {
    await sendAudioToDeepgram(sessionId, audioChunk);
    return;
  }
  if (hasSpeechmaticsConnection(sessionId)) {
    await sendAudioToSpeechmatics(sessionId, audioChunk);
    return;
  }

  const conn = audioBuffers.get(sessionId);
  if (!conn) return;
  if (conn.isStopped) return;

  const rms = computePcmRms(audioChunk);
  if (rms > STT_VAD.batchEnergyRms) {
    conn.lastLoudTime = Date.now();
  }

  conn.buffers.push(audioChunk);

  const totalBytes = conn.buffers.reduce((sum, buf) => sum + buf.length, 0);
  const durationMs = (totalBytes / 2 / 16000) * 1000;
  if (durationMs > MAX_AUDIO_LENGTH_MS) {
    const chunksToKeep = Math.floor(conn.buffers.length / 2);
    conn.buffers = conn.buffers.slice(-chunksToKeep);
  }
}

export function closeSTTRouterConnection(sessionId: string): void {
  // يُبطل أي إعادة محاولة معلّقة: الجلسة انتهت أو يبدأ اتصال جديد.
  sttConnectGeneration.set(sessionId, (sttConnectGeneration.get(sessionId) ?? 0) + 1);
  closeDeepgramConnection(sessionId);
  closeSpeechmaticsConnection(sessionId);

  const conn = audioBuffers.get(sessionId);
  if (!conn) return;

  if (conn.processingInterval) {
    clearInterval(conn.processingInterval);
    conn.processingInterval = undefined;
  }
  conn.buffers = [];
  audioBuffers.delete(sessionId);
  warnedSessions.delete(sessionId);
  console.log(`[STT STOP] ${sessionId.substring(0, 8)}...`);
}

export function hasSTTRouterConnection(sessionId: string): boolean {
  return hasDeepgramConnection(sessionId) || hasSpeechmaticsConnection(sessionId) || audioBuffers.has(sessionId);
}

/** true إذا كان STT في وضع streaming (Deepgram أو Speechmatics) - لا يُغلق عند TTS */
export function isStreamingSTT(sessionId: string): boolean {
  return hasDeepgramConnection(sessionId) || hasSpeechmaticsConnection(sessionId);
}
