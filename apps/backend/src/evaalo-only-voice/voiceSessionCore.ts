import type { IncomingMessage } from "http";
import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import { createRateLimiter } from "./rateLimiter.js";
import { createSession, removeSession, touchSession, updateState } from "./sessionStore.js";
import { createInterviewState, getInterviewState, removeInterviewState, onExchangeComplete } from "./interviewState.js";
import { getControllerOutput } from "./interviewController.js";
import { selectNextQuestion, detectIntent, getAvailableTopicsForPhase1, inferTopicFromQuestion, validateLLMQuestion, extractTopicsFromAnswer, getFallbackForTopic, getFollowUpPromptPair } from "./questionEngine.js";
import { isVoiceTopicMemoryEnabled } from "./interviewConfig.js";
import { stripEmojisAndSymbols, isNoiseTranscript, dedupeRepeats, normalizeForMerge, endsWithSemanticEnd } from "./transcriptCleaner.js";
import { getVoiceResponseTiming, getVoiceVadSettings } from "./voiceTimingEnv.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { createSTTRouterConnection, sendAudioToSTTRouter, closeSTTRouterConnection } from "../services/sttRouterService.js";
import { getLLMResponse, getTimeEndedClosingMessage, getTimeEndedApologyMessage, getInitialGreetingMessage, getVoiceTestGreeting, getVoiceTestChatResponse, polishVoiceArabicReply, type InterviewPhase } from "../services/llmService.js";
import { textToSpeech, textToSpeechWithTimestamps } from "../services/ttsService.js";
import Candidate from "../models/Candidate.js";
import RecruitmentCampaign from "../models/RecruitmentCampaign.js";
import { finalizeAndSendVoiceTranscriptToN8N } from "../services/n8nService.js";
import {
  assertStageSecureMintConfiguration,
  getStageCallbackSecurityMode,
  StageCallbackConfigurationError,
} from "../services/stageCallbackAuth.js";
import {
  hasMeaningfulConversation,
  isVoiceLinkConsumedById,
  markVoiceLinkConsumed,
  INTERVIEW_LINK_ALREADY_USED,
} from "../services/interviewLinkAccess.js";
import { bumpSttPurgeToken, getSttPurgeToken, clearSttPurgeToken } from "./sttPurgeToken.js";
import {
  finalizeUsageReservation,
  reserveUsage,
} from "../services/usageReservationService.js";
import { DEFAULT_ORG_ID } from "../config/multiTenant.js";
import {
  finalizeVoiceRecording,
  isVoiceRecordingEnabled,
  type RecordingSegment,
} from "../services/voiceRecordingService.js";

const maxConnections = Number(process.env.VOICE_WS_MAX_CONNECTIONS || "200");
const maxMessageBytes = Number(process.env.VOICE_WS_MESSAGE_MAX_BYTES || "65536");
const rateLimitPerMin = Number(process.env.VOICE_WS_RATE_LIMIT_PER_MIN || "60");
const limiter = createRateLimiter(rateLimitPerMin);

/** Unified-credit billing for standalone voice WS sessions (charged at close). */
const VOICE_WS_BILLING_ENFORCE = process.env.BILLING_ENFORCE !== "false";
// قرار المالك: سقف المقابلة الصوتية 15 دقيقة (900s). كان 3600 (سخي جداً).
// فائدة جانبية: الحجز المسبق للرصيد (estimatedUnits) ينكمش من 3600 إلى 900.
const VOICE_WS_MAX_SESSION_MS = (Number(process.env.VOICE_MAX_INTERVIEW_SECONDS) || 900) * 1000;
const VOICE_WS_IDLE_TIMEOUT_MS = (Number(process.env.VOICE_IDLE_TIMEOUT_SECONDS) || 120) * 1000;
// أدنى مدة جلسة يقبلها الحجز المُقلَّم — أقل من ذلك تُرفض الجلسة (رصيد لا يكفي لمقابلة مجدية).
const VOICE_WS_MIN_SESSION_SECONDS = Number(process.env.VOICE_MIN_SESSION_SECONDS) || 120;

/**
 * Resolve the billing organization for a candidate-initiated voice session.
 * The WS query carries only candidateId/campaignId — derive the org from the
 * candidate (or its campaign), falling back to the default tenant.
 */
async function resolveVoiceSessionOrgId(
  candidateId?: string,
  campaignId?: string,
): Promise<string> {
  try {
    if (candidateId && /^[a-fA-F0-9]{24}$/.test(candidateId)) {
      const c = await Candidate.findById(candidateId).select("organizationId campaignId").lean();
      const orgFromCandidate = (c as any)?.organizationId;
      if (typeof orgFromCandidate === "string" && orgFromCandidate.trim()) {
        return orgFromCandidate.trim();
      }
      if (!campaignId && (c as any)?.campaignId) {
        campaignId = (c as any).campaignId;
      }
    }
    if (campaignId) {
      const camp = await RecruitmentCampaign.findOne({ campaignId })
        .select("organizationId")
        .lean();
      const orgFromCamp = (camp as any)?.organizationId;
      if (typeof orgFromCamp === "string" && orgFromCamp.trim()) {
        return orgFromCamp.trim();
      }
    }
  } catch (err: any) {
    console.warn(`[VOICE BILLING] org resolution failed: ${err?.message || err}`);
  }
  return DEFAULT_ORG_ID;
}

const conversationHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
const speechBuffers = new Map<string, { parts: string[]; timeout?: NodeJS.Timeout }>();
const lastSentBySession = new Map<string, { text: string; time: number }>();
const DUPLICATE_GUARD_MS = 1200;
/** كشف نهاية التشغيل: الخادم ينتظر playback_ended من العميل قبل إعادة STT */
const pendingPlaybackEnded = new Map<string, () => void>();
let activeConnections = 0;

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function parseMessage(data: Buffer | ArrayBuffer | string): ClientMessage | null {
  try {
    const text = typeof data === "string" ? data : Buffer.from(data as any).toString();
    return JSON.parse(text) as ClientMessage;
  } catch {
    return null;
  }
}

export function handleVoiceWsConnection(ws: WebSocket, req: IncomingMessage) {
  if (activeConnections >= maxConnections) {
    ws.close(1013, "voice ws busy");
    return;
  }

  if (getStageCallbackSecurityMode() === 'required') {
    try {
      assertStageSecureMintConfiguration();
    } catch (err) {
      if (err instanceof StageCallbackConfigurationError) {
        console.log(
          '[stage_outbound] ingress=stage2 outcome=rejected errorCategory=stage_callback_config_invalid'
        );
        ws.close(1013, 'stage callback security not configured');
        return;
      }
      throw err;
    }
  }

  activeConnections += 1;

  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const candidateId = url.searchParams.get("candidateId") || undefined;
  const language = url.searchParams.get("language") || undefined;
  const isVoiceTest = url.searchParams.get("voiceTest") === "1";
  // المسار العام (رابط مشارَك): mode=public => حقن معايير الوظيفة + إرسالها مع الترانسكريبت إلى n8n.
  const sessionMode = url.searchParams.get("mode") === "public" ? ("public" as const) : undefined;
  const positionParam = url.searchParams.get("position") || undefined;
  const campaignIdParam = url.searchParams.get("campaignId") || undefined;
  const applicationIdParam = url.searchParams.get("applicationId") || undefined;
  const linkScope = {
    applicationId: applicationIdParam || undefined,
    campaignId: campaignIdParam || undefined,
  };
  const sessionId = randomUUID();

  let jobCriteria: Record<string, any> | undefined;
  let jobAdvertisement: string | undefined;
  let resolvedCampaignId: string | undefined = campaignIdParam;

  type PublicCampaignContext = {
    jobCriteria?: Record<string, any>;
    jobAdvertisement?: string;
    resolvedCampaignId?: string;
  };

  const loadPublicCampaignContext = async (): Promise<PublicCampaignContext> => {
    try {
      let campId = campaignIdParam;
      if (!campId && candidateId && /^[a-fA-F0-9]{24}$/.test(candidateId)) {
        const c = await Candidate.findById(candidateId).select("campaignId").lean();
        campId = (c as any)?.campaignId || undefined;
      }
      if (!campId) return {};
      const camp = await RecruitmentCampaign.findOne({ campaignId: campId })
        .select("criteria jobAdvertisement campaignId")
        .lean();
      if (!camp) return { resolvedCampaignId: campId };
      const rawCriteria = (camp as any).criteria;
      const criteriaObj =
        rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)
          ? { ...(rawCriteria as Record<string, unknown>) }
          : undefined;
      return {
        jobCriteria: criteriaObj,
        jobAdvertisement: (camp as any).jobAdvertisement || undefined,
        resolvedCampaignId: campId,
      };
    } catch (err: any) {
      console.warn(`[PUBLIC] ${sessionId.substring(0, 8)}... campaign load failed: ${err?.message || err}`);
      return {};
    }
  };

  const applyPublicCampaignContext = (ctx: PublicCampaignContext) => {
    if (ctx.jobCriteria && Object.keys(ctx.jobCriteria).length > 0) {
      jobCriteria = ctx.jobCriteria;
    }
    if (ctx.jobAdvertisement) {
      jobAdvertisement = ctx.jobAdvertisement;
    }
    if (ctx.resolvedCampaignId) {
      resolvedCampaignId = ctx.resolvedCampaignId;
    }
  };

  const publicCampaignContextPromise =
    sessionMode === "public"
      ? loadPublicCampaignContext().then((ctx) => {
          applyPublicCampaignContext(ctx);
          console.log(
            `[PUBLIC] ${sessionId.substring(0, 8)}... campaign=${ctx.resolvedCampaignId || "none"} criteriaKeys=${jobCriteria ? Object.keys(jobCriteria).length : 0}`
          );
          return ctx;
        })
      : undefined;

  console.log(
    `[SESSION START] ${sessionId.substring(0, 8)}... candidateId: ${candidateId || "none"} language: ${language || "auto"} voiceTest: ${isVoiceTest}${sessionMode === "public" ? ` mode=public campaignId=${campaignIdParam || "from-candidate"}` : ""}`
  );

  const voiceTiming = getVoiceResponseTiming();

  // ── تسجيل المحادثة الكاملة (المرشح PCM + الوكيل MP3) ورفعها إلى R2 عند الإغلاق ──
  const recordingEnabled = !isVoiceTest && isVoiceRecordingEnabled(candidateId);
  const recordingMaxBytes = Number(process.env.VOICE_RECORDING_MAX_BYTES || String(60 * 1024 * 1024));
  const recordingSegments: RecordingSegment[] = [];
  let recordingBytes = 0;
  const recordChunk = (speaker: "user" | "agent", format: "pcm" | "mp3", chunk: Buffer) => {
    if (!recordingEnabled || !chunk || chunk.length === 0) return;
    if (recordingBytes + chunk.length > recordingMaxBytes) return;
    recordingBytes += chunk.length;
    const last = recordingSegments[recordingSegments.length - 1];
    if (last && last.speaker === speaker) {
      last.buffer = Buffer.concat([last.buffer, chunk]);
    } else {
      recordingSegments.push({ speaker, format, buffer: Buffer.from(chunk) });
    }
  };
  if (candidateId) {
    console.log(`[VOICE RECORDING] ${sessionId.substring(0, 8)}... ${recordingEnabled ? "enabled" : "disabled"}`);
  }

  createSession(sessionId, candidateId);
  createInterviewState(sessionId);
  conversationHistory.set(sessionId, []);

  // Billing + safety timers: track when the session began, auto-close on idle or
  // on hitting the hard max duration so an abandoned socket can't drain credits.
  const sessionStartedAt = Date.now();
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try { ws.close(1000, "idle timeout"); } catch { /* noop */ }
    }, VOICE_WS_IDLE_TIMEOUT_MS);
  };
  let maxTimer = setTimeout(() => {
    try { ws.close(1000, "max duration"); } catch { /* noop */ }
  }, VOICE_WS_MAX_SESSION_MS);
  resetIdleTimer();

  let voiceReservationReady = false;
  if (VOICE_WS_BILLING_ENFORCE && !isVoiceTest) {
    void (async () => {
      try {
        const organizationId = await resolveVoiceSessionOrgId(candidateId, resolvedCampaignId);
        const maxSessionSeconds = Math.floor(VOICE_WS_MAX_SESSION_MS / 1000);
        // Clamp the reservation to what the balance affords (low-credit plans
        // couldn't cover a full max-length session upfront and were hard-denied
        // right after the greeting). The session timer shrinks to the granted
        // seconds so actual usage can never exceed the hold.
        const reserve = await reserveUsage({
          organizationId,
          usageType: "VOICE_SECONDS",
          estimatedUnits: maxSessionSeconds,
          clampToAvailable: true,
          minUnits: VOICE_WS_MIN_SESSION_SECONDS,
          source: "voice_ws",
          sourceId: sessionId,
          idempotencyKey: `reservation:voice_ws:${sessionId}`,
          metadata: { candidateId, campaignId: resolvedCampaignId, mode: sessionMode },
        });
        if (!reserve.ok) {
          console.warn(
            `[VOICE BILLING] ${sessionId.substring(0, 8)}... reservation denied: ${reserve.code}`,
          );
          try {
            send(ws, { type: "error", code: reserve.code, message: "billing denied" });
          } catch { /* noop */ }
          try { ws.close(1008, "billing denied"); } catch { /* noop */ }
          return;
        }
        if (reserve.grantedUnits < maxSessionSeconds) {
          const remainingMs = Math.max(
            0,
            reserve.grantedUnits * 1000 - (Date.now() - sessionStartedAt),
          );
          clearTimeout(maxTimer);
          maxTimer = setTimeout(() => {
            try { ws.close(1000, "max duration"); } catch { /* noop */ }
          }, remainingMs);
          console.log(
            `[VOICE BILLING] ${sessionId.substring(0, 8)}... clamped session to ${reserve.grantedUnits}s (credits headroom)`,
          );
        }
        voiceReservationReady = true;
      } catch (err: any) {
        console.warn(`[VOICE BILLING] ${sessionId.substring(0, 8)}... reserve error: ${err?.message || err}`);
      }
    })();
  }

  // State machine صارمة: IDLE | LISTENING | SPEAKING
  // ممنوع تشغيل STT و TTS بنفس الوقت إطلاقًا
  let voiceState: "IDLE" | "LISTENING" | "SPEAKING" = "IDLE";
  /** تجاهل transcripts المتأخرة التي تصل بعد انتهاء الإيجنت (تجنب تداخل مع الرسالة التالية) */
  let lastListeningStartedAt = 0;
  const LATE_TRANSCRIPT_IGNORE_MS = 800;
  /** يطابق getSttPurgeToken عند آخر startListening حقيقي — أي بثّ بعد مزامنة الجيل يُهمل (كلام من جولة سابقة) */
  let sttTokenAtCurrentListen = 0;
  /** تم إرسال تنبيه انتهاء الوقت */
  let timeEndedSent = false;
  /** تم إرسال الترحيب الأولي */
  let initialGreetingSent = false;

  const startListening = (preConnectOnly?: boolean) => {
    // preConnectOnly: فتح الاتصال أثناء الترحيب دون تغيير الحالة (لتقليل التأخير)
    if (!preConnectOnly) {
      if (voiceState === "LISTENING") return;
      const wasSpeaking = voiceState === "SPEAKING";
      voiceState = "LISTENING";
      if (wasSpeaking) lastListeningStartedAt = Date.now();
      updateState(sessionId, "LISTENING");
      send(ws, { type: "state", state: "LISTENING" });
      const buffer = speechBuffers.get(sessionId);
      if (buffer?.timeout) {
        clearTimeout(buffer.timeout);
      }
      speechBuffers.delete(sessionId);
      // بداية استماع جديدة = جيل STT جديد؛ أي transcript متأخر من الجولة السابقة يجب أن يسقط
      sttTokenAtCurrentListen = bumpSttPurgeToken(sessionId);
    }
    createSTTRouterConnection(
      sessionId,
      (text, isFinal, confidence) => {
        if (getSttPurgeToken(sessionId) !== sttTokenAtCurrentListen) return;
        if (voiceState === "SPEAKING") return;
        if (lastListeningStartedAt > 0 && Date.now() - lastListeningStartedAt < LATE_TRANSCRIPT_IGNORE_MS) return;
        const t = text.trim();
        if (t) {
          handleTranscript(t, isFinal, confidence);
          // إرسال النص المتراكم (تدفقي) للعرض - وليس آخر chunk فقط
          const buffer = speechBuffers.get(sessionId);
          let displayText = buffer && buffer.parts.length > 0
            ? buffer.parts.join(" ").trim()
            : t;
          displayText = dedupeRepeats(displayText);
          send(ws, { type: "transcript", text: displayText, isFinal });
        }
      },
      (err) => send(ws, { type: "error", message: err.message }),
      undefined,
      language
    );
  };

  const startSpeaking = () => {
    bumpSttPurgeToken(sessionId);
    voiceState = "SPEAKING";
    // إلغاء speech buffer timer عند بدء التحدث
    const buffer = speechBuffers.get(sessionId);
    if (buffer?.timeout) {
      clearTimeout(buffer.timeout);
    }
    speechBuffers.delete(sessionId);
    // إعادة ضبط STT عند حدّ الدور: إغلاق اتصال Speechmatics الحالي يتخلّص فوراً من الصوت
    // المخزّن داخلياً ومن النتائج النهائية المتأخرة للدور المنتهي (تُفرَّغ الآن أثناء كلام
    // الإيجنت، قبل نافذة الاستماع التالية بثوانٍ، بدل تسرّبها لاحقاً للدور التالي). ثم نفتح
    // اتصالاً نظيفاً جاهزاً (preConnectOnly): لا يُرسَل صوت أثناء SPEAKING فلا يتسرّب أي كلام،
    // وزمن إعادة الاتصال مخفيّ خلف كلام الإيجنت. هذا يزيل التسرّب من المصدر بدل الاعتماد على
    // نافذة LATE_TRANSCRIPT_IGNORE_MS وحدها.
    closeSTTRouterConnection(sessionId);
    startListening(true);
    updateState(sessionId, "SPEAKING");
    send(ws, { type: "state", state: "SPEAKING" });
  };

  send(ws, { type: "ready", sessionId });
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
  const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;
  const hasSpeechmatics = !!process.env.SPEECHMATICS_API_KEY;
  send(ws, { type: "config", hasOpenAI, hasElevenLabs, hasDeepgram, hasSpeechmatics });
  send(ws, { type: "state", state: "IDLE" });

  const MIN_TRANSCRIPT_LENGTH = 2;
  const MIN_WORDS_COUNT = 3; // قيمة مرجعية فقط - لا نستخدمها الآن لقص الجمل
  const vad = getVoiceVadSettings();
  const USER_STOPPED_SPEAKING_MS = voiceTiming.userStoppedSpeakingMs;
  const USER_STOPPED_WITH_PUNCTUATION_MS = voiceTiming.userStoppedPunctuationMs;
  const MIN_CHARS = 10;
  const MIN_CONFIDENCE = 0.6; // 3) فلترة: if (confidence < 0.6) ignore (عند توفره من STT)

  // 4) دمج الجمل: buffer += partial؛ إذا صمت → sendToLLM(buffer) فقط
  const sendCompleteSentence = () => {
    const buffer = speechBuffers.get(sessionId);
    if (!buffer || buffer.parts.length === 0) return;

    let completeSentence = buffer.parts.join(' ').trim();
    completeSentence = dedupeRepeats(completeSentence);
    speechBuffers.delete(sessionId);

    // منع استدعاء LLM مرتين لنفس الجملة (interim timeout + final)
    const last = lastSentBySession.get(sessionId);
    const norm = normalizeForMerge(completeSentence);
    if (last && Date.now() - last.time < DUPLICATE_GUARD_MS && normalizeForMerge(last.text) === norm) {
      console.log(`[SKIP] ${sessionId.substring(0, 8)}... duplicate`);
      return;
    }

    bumpSttPurgeToken(sessionId);
    lastSentBySession.set(sessionId, { text: completeSentence, time: Date.now() });
    runPipeline(completeSentence);
  };

  // عند أي transcript (partial أو final): انتظار توقف المستخدم عن الكلام قبل الإرسال للـ LLM
  const handleTranscript = (transcript: string, isFinal: boolean, confidence?: number) => {
    if (confidence !== undefined && confidence < MIN_CONFIDENCE) return;

    const cleaned = stripEmojisAndSymbols(transcript.trim());
    if (isFinal) console.log(`[STT FINAL] ${sessionId.substring(0, 8)}... "${cleaned.substring(0, 60)}${cleaned.length > 60 ? '...' : ''}"`);
    if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LENGTH) return;

    let buffer = speechBuffers.get(sessionId);
    if (!buffer) {
      buffer = { parts: [] };
      speechBuffers.set(sessionId, buffer);
    }

    const last = buffer.parts[buffer.parts.length - 1];
    const lastNorm = last !== undefined ? normalizeForMerge(last) : "";
    const cleanedNorm = normalizeForMerge(cleaned);
    // استبدال عند: امتداد (cleaned يبدأ بـ last) أو تصحيح (last يبدأ بـ cleaned) - يمنع تكرار الكلمات
    const isExtensionOrCorrection =
      last !== undefined &&
      (cleaned === last ||
        cleaned.startsWith(last) ||
        last.startsWith(cleaned) ||
        (lastNorm.length > 0 && cleanedNorm.length > 0 &&
          (cleanedNorm.startsWith(lastNorm) || lastNorm.startsWith(cleanedNorm))));

    if (isExtensionOrCorrection) {
      buffer.parts[buffer.parts.length - 1] = cleaned;
    } else {
      buffer.parts.push(cleaned);
    }

    if (buffer.timeout) clearTimeout(buffer.timeout);

    const completeSentence = buffer.parts.join(" ").trim();
    // مع علامة ترقيم (. ? ! ؟): صمت أقصر. بدونها: صمت أطول لتجنب القطع وسط الجملة
    const silenceMs = endsWithSemanticEnd(completeSentence)
      ? USER_STOPPED_WITH_PUNCTUATION_MS
      : USER_STOPPED_SPEAKING_MS;
    buffer.timeout = setTimeout(() => sendCompleteSentence(), silenceMs);
  };

  /** TTS + محاذاة كلمات + انتظار playback_ended + استئناف الاستماع — مشترك بين المقابلة ووضع اختبار الصوت */
  const speakAgentReply = async (llmReply: string, options?: { resumeListening?: boolean; endSession?: boolean }) => {
    const resumeListening = options?.resumeListening ?? true;
    const endSession = options?.endSession ?? false;
    const ttsLanguage = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(llmReply.trim()) ? ("ar" as const) : ("en" as const);

    const alignmentToWords = (
      alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
    ) => {
      const { characters, character_start_times_seconds } = alignment;
      if (!characters?.length || !character_start_times_seconds?.length) return [];
      const words: { text: string; startSeconds: number }[] = [];
      let word = "";
      let wordStart = 0;
      for (let i = 0; i < characters.length; i++) {
        const c = characters[i];
        const start = character_start_times_seconds[i] ?? 0;
        if (/\s/.test(c)) {
          if (word) {
            words.push({ text: word, startSeconds: wordStart });
            word = "";
          }
        } else {
          if (!word) wordStart = start;
          word += c;
        }
      }
      if (word) words.push({ text: word, startSeconds: wordStart });
      return words;
    };

    const splitIntoChunks = (text: string): string[] => {
      const trimmed = text.trim();
      if (!trimmed) return [];
      const parts = trimmed.split(/(?<=[.!?؟])\s+/);
      const chunks: string[] = [];
      let buf = "";
      for (const p of parts) {
        if (!p.trim()) continue;
        if (buf && (buf + " " + p).length > 120) {
          chunks.push(buf.trim());
          buf = p;
        } else {
          buf = buf ? buf + " " + p : p;
        }
      }
      if (buf.trim()) chunks.push(buf.trim());
      return chunks.length > 0 ? chunks : [trimmed];
    };

    const ttsChunks = splitIntoChunks(llmReply);
    const ttsStartTime = Date.now();
    let chunkOffsetSeconds = 0;
    const sendChunk = (c: Buffer) => {
      recordChunk("agent", "mp3", c);
      send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
    };
    const runTts = async () => {
      for (const chunk of ttsChunks) {
        if (!chunk.trim()) continue;
        if (!voiceTiming.useTtsTimestamps) {
          await textToSpeech(chunk, ttsLanguage, sendChunk);
          continue;
        }
        try {
          let lastEndInChunk = 0;
          await textToSpeechWithTimestamps(chunk, ttsLanguage, (audio, alignment) => {
            sendChunk(audio);
            if (alignment && ws.readyState === ws.OPEN) {
              const words = alignmentToWords(alignment);
              const withOffset = words.map((w) => ({ text: w.text, startSeconds: chunkOffsetSeconds + w.startSeconds }));
              send(ws, { type: "agent_reply_alignment", words: withOffset });
            }
            const last = alignment?.character_end_times_seconds?.[alignment.character_end_times_seconds.length - 1];
            if (typeof last === "number") lastEndInChunk = last;
          });
          chunkOffsetSeconds += lastEndInChunk;
        } catch (tsErr: any) {
          console.warn(`[TTS TIMESTAMPS FALLBACK] ${sessionId.substring(0, 8)}... ${tsErr?.message || tsErr}`);
          await textToSpeech(chunk, ttsLanguage, sendChunk);
        }
      }
    };
    try {
      await runTts();
    } catch (err: any) {
      console.log(`[TTS RETRY] ${sessionId.substring(0, 8)}... retrying after error: ${err.message}`);
      chunkOffsetSeconds = 0;
      for (const chunk of ttsChunks) {
        if (!chunk.trim()) continue;
        if (!voiceTiming.useTtsTimestamps) {
          await textToSpeech(chunk, ttsLanguage, sendChunk);
          continue;
        }
        try {
          let lastEndInChunk = 0;
          await textToSpeechWithTimestamps(chunk, ttsLanguage, (audio, alignment) => {
            sendChunk(audio);
            if (alignment && ws.readyState === ws.OPEN) {
              const words = alignmentToWords(alignment);
              const withOffset = words.map((w) => ({ text: w.text, startSeconds: chunkOffsetSeconds + w.startSeconds }));
              send(ws, { type: "agent_reply_alignment", words: withOffset });
            }
            const last = alignment?.character_end_times_seconds?.[alignment.character_end_times_seconds.length - 1];
            if (typeof last === "number") lastEndInChunk = last;
          });
          chunkOffsetSeconds += lastEndInChunk;
        } catch (tsErr: any) {
          await textToSpeech(chunk, ttsLanguage, sendChunk);
        }
      }
    }
    const ttsTime = Date.now() - ttsStartTime;
    console.log(`[TTS TIME] ${sessionId.substring(0, 8)}... ${ttsTime}ms (${ttsChunks.length} chunk(s), timestamps=${voiceTiming.useTtsTimestamps})`);

    await new Promise((r) => setTimeout(r, voiceTiming.postAudioPaddingMs));
    if (ws.readyState !== ws.OPEN) return;
    send(ws, { type: "agent_reply", text: llmReply });
    send(ws, { type: "tts_complete" });
    const TTS_TO_STT_DELAY_MS = voiceTiming.ttsToSttDelayMs;
    const PLAYBACK_ENDED_TIMEOUT_MS = voiceTiming.playbackEndedTimeoutMs;
    const minDelay = new Promise<void>((r) => setTimeout(r, TTS_TO_STT_DELAY_MS));
    const playbackEnded = new Promise<void>((resolve) => {
      const done = () => {
        if (t) clearTimeout(t);
        pendingPlaybackEnded.delete(sessionId);
        resolve();
      };
      pendingPlaybackEnded.set(sessionId, done);
      const t = setTimeout(done, PLAYBACK_ENDED_TIMEOUT_MS);
    });
    await Promise.all([minDelay, playbackEnded]);
    if (ws.readyState !== ws.OPEN) return;
    // المقابلة انتهت: الخادم يغلق الاتصال من جهته بعد سماع الرسالة الختامية كاملة (مهلة قصيرة)
    if (endSession) {
      console.log(`[SESSION CLOSE] ${sessionId.substring(0, 8)}... interview ended, closing connection`);
      voiceState = "IDLE";
      closeSTTRouterConnection(sessionId);
      updateState(sessionId, "IDLE");
      send(ws, { type: "state", state: "IDLE" });
      await new Promise((r) => setTimeout(r, voiceTiming.postPlaybackResumeMs));
      if (ws.readyState === ws.OPEN) ws.close(1000, "interview_complete");
      return;
    }
    if (!resumeListening) return;
    startListening();
  };

  const runPipeline = async (transcript: string) => {
    const cleaned = stripEmojisAndSymbols(transcript.trim());
    if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LENGTH) return;
    if (isNoiseTranscript(cleaned)) return;

    const history = conversationHistory.get(sessionId) || [];

    // 1) Logging: transcript (نظيف، بدون إيموجي)
    console.log(`[TRANSCRIPT] ${sessionId.substring(0, 8)}... "${cleaned}"`);

    // إذا انتهى وقت المقابلة والمستخدم يحاول الحديث: اعتذار وشكر
    if (timeEndedSent) {
      startSpeaking();
      send(ws, { type: "transcript", text: cleaned, isFinal: true });
      try {
        const apologyMsg = await getTimeEndedApologyMessage(cleaned);
        const ttsLang = /[\u0600-\u06FF]/.test(apologyMsg) ? ('ar' as const) : ('en' as const);
        send(ws, { type: "agent_reply", text: apologyMsg });
        const history = conversationHistory.get(sessionId) || [];
        history.push({ role: "user", content: cleaned });
        history.push({ role: "assistant", content: apologyMsg });
        conversationHistory.set(sessionId, history);
        const sendChunk = (c: Buffer) => {
          recordChunk("agent", "mp3", c);
          send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
        };
        await textToSpeech(apologyMsg, ttsLang, sendChunk);
        send(ws, { type: "tts_complete" });
        await new Promise((r) => setTimeout(r, voiceTiming.postPlaybackResumeMs));
        if (ws.readyState === ws.OPEN) startListening();
      } catch (err: any) {
        console.warn(`[TIME_ENDED_APOLOGY] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
        if (ws.readyState === ws.OPEN) startListening();
      }
      return;
    }

    if (isVoiceTest) {
      startSpeaking();
      send(ws, { type: "transcript", text: cleaned, isFinal: true });
      try {
        const llmReply = await getVoiceTestChatResponse(cleaned, history, language);
        history.push({ role: "user", content: cleaned });
        history.push({ role: "assistant", content: llmReply });
        conversationHistory.set(sessionId, history);
        await speakAgentReply(llmReply);
      } catch (err: any) {
        console.error(`[VOICE_TEST] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
        if (ws.readyState === ws.OPEN) startListening();
      }
      return;
    }

    startSpeaking();
    send(ws, { type: "transcript", text: cleaned, isFinal: true });

    try {
      let candidateProfile: { full_name?: string; email?: string; phone?: string; gender?: string; position_applied_for?: string; company_applied_to?: string; skills?: string[]; experience?: string; certifications?: string; highest_education_level?: string; current_company?: string; languages?: string[] } | undefined;
      if (candidateId && typeof candidateId === 'string' && candidateId.length === 24 && /^[a-fA-F0-9]{24}$/.test(candidateId)) {
        try {
          const c = await Candidate.findById(candidateId).lean();
          if (c) {
            candidateProfile = {
              full_name: c.full_name,
              email: c.email,
              phone: c.phone,
              gender: c.gender,
              position_applied_for: c.position_applied_for,
              company_applied_to: c.company_applied_to,
              skills: c.skills,
              experience: c.years_of_experience,
              certifications: c.certifications,
              highest_education_level: c.highest_education_level,
              current_company: c.current_company,
              languages: c.languages,
            };
          }
        } catch {
          // ignore
        }
      }

      const userMessageCount = history.filter((m) => m.role === "user").length;
      const interviewState = getInterviewState(sessionId);
      const controllerOutput = getControllerOutput(userMessageCount, interviewState);
      const { phase: currentPhase, isFirstPhase3Message, mandatoryQuestionDue } = controllerOutput;

      const candidateLastLang = /[\u0600-\u06FF]/.test(cleaned) ? ('ar' as const) : ('en' as const);
      const intent = detectIntent(cleaned);
      const changeRequested = intent === 'change_question';
      const clarificationRequested = intent === 'clarification';
      const lastAssistantMessage = history.filter((m) => m.role === 'assistant').pop()?.content;
      const recentAssistantQuestions = history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .slice(-2);

      // المتابعة: مرة واحدة لكل سؤال — عند ذكر تحدي (بعد المتابعة نعيد للصفر للسؤال التالي)
      const currentFollowUp = changeRequested || clarificationRequested ? 0 : (interviewState?.followUpCount ?? 0);
      let followUpNext: 1 | undefined;
      const allowFollowUp = userMessageCount >= 2;
      if (allowFollowUp && currentFollowUp === 0 && intent === 'challenge') followUpNext = 1;
      else followUpNext = undefined;

      let selectedQuestion: ReturnType<typeof selectNextQuestion>;

      // LLM يختار الموضوع — Phase 1 بدون إلزامي أو متابعة
      if (!clarificationRequested && !changeRequested && !followUpNext && currentPhase === 1 && !mandatoryQuestionDue) {
        const availableTopics = getAvailableTopicsForPhase1(interviewState);
        if (availableTopics.length > 0) {
          selectedQuestion = { availableTopics, preferArabic: candidateLastLang === 'ar' };
        } else {
          selectedQuestion = selectNextQuestion(
            controllerOutput,
            interviewState,
            candidateLastLang,
            changeRequested,
            candidateProfile
              ? {
                  skills: candidateProfile.skills,
                  certifications: candidateProfile.certifications,
                  highest_education_level: candidateProfile.highest_education_level,
                  current_company: candidateProfile.current_company,
                  position_applied_for: candidateProfile.position_applied_for,
                  experience: candidateProfile.experience,
                  languages: candidateProfile.languages,
                  gender: candidateProfile.gender,
                }
              : undefined,
            cleaned,
            recentAssistantQuestions
          );
        }
      } else {
        selectedQuestion = selectNextQuestion(
          controllerOutput,
          interviewState,
          candidateLastLang,
          changeRequested,
          candidateProfile ? {
            skills: candidateProfile.skills,
            certifications: candidateProfile.certifications,
            highest_education_level: candidateProfile.highest_education_level,
            current_company: candidateProfile.current_company,
            position_applied_for: candidateProfile.position_applied_for,
            experience: candidateProfile.experience,
            languages: candidateProfile.languages,
            gender: candidateProfile.gender,
          } : undefined,
          cleaned,
          recentAssistantQuestions
        );
      }

      if (!candidateId || !candidateProfile) {
        console.warn(`[PHASE] ${sessionId.substring(0, 8)}... NO candidateId — Phase 2 will skip application questions. Connect with ?candidateId=xxx`);
      }
      const mode = clarificationRequested ? 'clarify' : followUpNext ? `follow-up:${followUpNext}` : selectedQuestion?.availableTopics ? 'topic-choice' : selectedQuestion?.topic ? 'topic' : selectedQuestion?.isFixed ? 'fixed' : 'rephrase';
      console.log(`[PHASE] ${sessionId.substring(0, 8)}... userMsgs=${userMessageCount} phase=${currentPhase} mode=${mode} candidateData=${candidateProfile ? 'yes' : 'no'}`);

      let llmReply: string;
      const ackTurn = history.filter((m) => m.role === 'assistant').length;
      if (selectedQuestion?.isFixed) {
        llmReply = polishVoiceArabicReply(selectedQuestion.text ?? '', {
          gender: candidateProfile?.gender,
          acknowledgmentTurn: ackTurn,
        });
        console.log(`[FIXED] ${sessionId.substring(0, 8)}... skip LLM, using Question Engine`);
      } else {
        const llmStartTime = Date.now();
        try {
          llmReply = await Promise.race([
            getLLMResponse(cleaned, {
              sessionId,
              candidateProfile,
              position: candidateProfile?.position_applied_for || positionParam,
              mode: sessionMode,
              jobCriteria,
              jobAdvertisement,
              conversationHistory: history,
              interviewDurationMinutes: 12,
              currentPhase,
              isFirstPhase3Message,
              mandatoryQuestionDue,
              selectedQuestion: selectedQuestion ?? undefined,
              changeRequested,
              clarificationRequested,
              lastAssistantMessage,
              extractedTopics: extractTopicsFromAnswer(cleaned),
              candidateLastAnswer: cleaned,
              followUpNext,
              timeEndedForInterview: timeEndedSent,
            }),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('LLM timeout after 10s')), 10000)
            )
          ]);
        } catch (err: any) {
          try {
            console.log(`[LLM RETRY] ${sessionId.substring(0, 8)}... retrying after: ${err.message}`);
            llmReply = await Promise.race([
              getLLMResponse(cleaned, {
        sessionId,
        candidateProfile,
        position: candidateProfile?.position_applied_for || positionParam,
        mode: sessionMode,
        jobCriteria,
        jobAdvertisement,
        conversationHistory: history,
                interviewDurationMinutes: 12,
                currentPhase,
                isFirstPhase3Message,
                mandatoryQuestionDue,
                selectedQuestion: selectedQuestion ?? undefined,
                changeRequested,
                clarificationRequested,
                lastAssistantMessage,
                extractedTopics: extractTopicsFromAnswer(cleaned),
                candidateLastAnswer: cleaned,
                followUpNext,
                timeEndedForInterview: timeEndedSent,
              }),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('LLM timeout after 10s (retry)')), 10000)
              )
            ]);
          } catch (retryErr: any) {
            llmReply = currentPhase === 3 ? 'Could you repeat your answer, please?' : 'ممكن تعيد الإجابة؟';
            console.warn(`[LLM FALLBACK] ${sessionId.substring(0, 8)}... using fallback after retry failed`);
          }
        }
        const llmTime = Date.now() - llmStartTime;
        console.log(`[LLM TIME] ${sessionId.substring(0, 8)}... ${llmTime}ms`);

        // Hybrid Intelligence: Engine يتحقق من اقتراح الـ LLM
        if (!validateLLMQuestion(llmReply)) {
          const fallback = clarificationRequested && lastAssistantMessage
            ? lastAssistantMessage
            : followUpNext
              ? (candidateLastLang === 'ar' ? getFollowUpPromptPair(selectedQuestion).ar : getFollowUpPromptPair(selectedQuestion).en)
              : selectedQuestion?.topic
                ? getFallbackForTopic(selectedQuestion.topic, candidateProfile?.gender)
                : selectedQuestion?.availableTopics?.length
                ? getFallbackForTopic(selectedQuestion.availableTopics[0], candidateProfile?.gender)
                : selectedQuestion?.text ?? (currentPhase === 3 ? 'Could you tell me more about that?' : 'ممكن تحچيلي أكثر عن هالموضوع؟');
          console.warn(`[ENGINE VALIDATE] ${sessionId.substring(0, 8)}... LLM reply invalid, using fallback`);
          llmReply = polishVoiceArabicReply(fallback, {
            gender: candidateProfile?.gender,
            acknowledgmentTurn: ackTurn,
          });
        }
      }

      console.log(`[AGENT] ${sessionId.substring(0, 8)}... "${llmReply.substring(0, 80)}${llmReply.length > 80 ? '...' : ''}"`);
      history.push({ role: "user", content: cleaned });
      history.push({ role: "assistant", content: llmReply });
      conversationHistory.set(sessionId, history);
      const nextFollowUpCount: 0 | 1 | undefined = changeRequested ? 0
        : followUpNext ? 1
        : currentFollowUp >= 1 ? 0
        : undefined;
      const topicUsed = followUpNext ? undefined
        : selectedQuestion?.topic
        ? selectedQuestion.topic
        : selectedQuestion?.availableTopics
        ? inferTopicFromQuestion(llmReply)
        : undefined;
      onExchangeComplete(sessionId, llmReply, userMessageCount, {
        mandatoryQuestion1Asked: mandatoryQuestionDue === 1,
        mandatoryQuestion2Asked: mandatoryQuestionDue === 2,
        poolUsed: clarificationRequested || followUpNext ? undefined : selectedQuestion?.pool,
        topicUsed: isVoiceTopicMemoryEnabled() ? topicUsed : undefined,
        followUpCount: nextFollowUpCount,
      });

      await speakAgentReply(llmReply, { endSession: selectedQuestion?.isInterviewEnd === true });
    } catch (err: any) {
      // 1) Logging: errors فقط
      console.error(`[ERROR] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
      startListening();
    }
  };

  ws.on("message", (data) => {
    resetIdleTimer();
    const byteLength = typeof data === "string" ? Buffer.byteLength(data) : Buffer.byteLength(Buffer.from(data as any));
    if (byteLength > maxMessageBytes) {
      ws.close(1009, "message too big");
      return;
    }

    const msg = parseMessage(data as any);
    if (!msg) {
      send(ws, { type: "error", message: "invalid message" });
      return;
    }

    // Rate limit: فقط رسائل التحكم (لا تحسب audio_chunk — العميل يرسل عشرات القطع/ثانية)
    if (msg.type !== "audio_chunk") {
      const ip = req.socket.remoteAddress || "unknown";
      if (!limiter(ip)) {
        send(ws, { type: "error", message: "rate limit exceeded" });
        return;
      }
    }

    touchSession(sessionId);

    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong" });
        break;
      case "init":
        break;
      case "control": {
        if (msg.action === "stop") {
          voiceState = "IDLE";
          closeSTTRouterConnection(sessionId);
          updateState(sessionId, "IDLE");
          send(ws, { type: "state", state: "IDLE" });
        }
        if (msg.action === "start") {
          startListening();
        }
        break;
      }
      case "start_listening": {
        if (initialGreetingSent) {
          startListening();
          break;
        }
        initialGreetingSent = true;
        (async () => {
          try {
            if (
              !isVoiceTest &&
              candidateId &&
              /^[a-fA-F0-9]{24}$/.test(candidateId) &&
              (await isVoiceLinkConsumedById(candidateId, linkScope))
            ) {
              initialGreetingSent = false;
              send(ws, {
                type: "error",
                code: INTERVIEW_LINK_ALREADY_USED,
                message: "This interview link has already been used.",
              });
              ws.close(4001, "link_consumed");
              return;
            }
            let greetingMsg: string;
            if (isVoiceTest) {
              greetingMsg = getVoiceTestGreeting(language);
            } else {
              let candidateProfile: { full_name?: string; position_applied_for?: string; company_applied_to?: string } | undefined;
              if (candidateId && /^[a-fA-F0-9]{24}$/.test(candidateId)) {
                try {
                  const c = await Candidate.findById(candidateId).lean();
                  if (c) {
                    candidateProfile = {
                      full_name: c.full_name,
                      position_applied_for: c.position_applied_for,
                      company_applied_to: c.company_applied_to,
                    };
                  }
                } catch { /* ignore */ }
              }
              greetingMsg = await getInitialGreetingMessage({
                full_name: candidateProfile?.full_name,
                position: candidateProfile?.position_applied_for || positionParam,
                company: candidateProfile?.company_applied_to,
                language,
              });
            }
            const history = conversationHistory.get(sessionId) || [];
            history.push({ role: "assistant", content: greetingMsg });
            conversationHistory.set(sessionId, history);
            startSpeaking();
            startListening(true);
            send(ws, { type: "agent_reply", text: greetingMsg });
            const sendChunk = (c: Buffer) => {
          recordChunk("agent", "mp3", c);
          send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
        };
            const ttsLang = /[\u0600-\u06FF]/.test(greetingMsg) ? ("ar" as const) : ("en" as const);
            await textToSpeech(greetingMsg, ttsLang, sendChunk);
            send(ws, { type: "tts_complete" });
            const playbackEnded = new Promise<void>((resolve) => {
              const done = () => {
                pendingPlaybackEnded.delete(sessionId);
                resolve();
              };
              pendingPlaybackEnded.set(sessionId, done);
              setTimeout(done, voiceTiming.playbackFallbackMs);
            });
            await playbackEnded;
            await new Promise((r) => setTimeout(r, voiceTiming.postPlaybackResumeMs));
            if (ws.readyState === ws.OPEN) startListening();
          } catch (err: any) {
            console.warn(`[INITIAL_GREETING] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
            if (ws.readyState === ws.OPEN) startListening();
          }
        })();
        break;
      }
      case "playback_ended": {
        const done = pendingPlaybackEnded.get(sessionId);
        if (done) {
          console.log(`[PLAYBACK_ENDED] ${sessionId.substring(0, 8)}...`);
          done();
        }
        break;
      }
      case "interview_time_ended": {
        if (isVoiceTest) break;
        if (timeEndedSent) break;
        timeEndedSent = true;
        console.log(`[TIME_ENDED] ${sessionId.substring(0, 8)}...`);
        (async () => {
          try {
            const history = conversationHistory.get(sessionId) || [];
            const closingMsg = await getTimeEndedClosingMessage(history);
            const ttsLang = /[\u0600-\u06FF]/.test(closingMsg) ? ('ar' as const) : ('en' as const);
            startSpeaking();
            send(ws, { type: "agent_reply", text: closingMsg });
            history.push({ role: "assistant", content: closingMsg });
            conversationHistory.set(sessionId, history);
            const sendChunk = (c: Buffer) => {
          recordChunk("agent", "mp3", c);
          send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
        };
            await textToSpeech(closingMsg, ttsLang, sendChunk);
            send(ws, { type: "tts_complete" });
            const playbackEnded = new Promise<void>((resolve) => {
              const done = () => {
                pendingPlaybackEnded.delete(sessionId);
                resolve();
              };
              pendingPlaybackEnded.set(sessionId, done);
              setTimeout(done, voiceTiming.playbackFallbackMs);
            });
            await playbackEnded;
            await new Promise((r) => setTimeout(r, voiceTiming.postPlaybackResumeMs));
            if (ws.readyState === ws.OPEN) startListening();
          } catch (err: any) {
            console.warn(`[TIME_ENDED] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
          }
        })();
        break;
      }
      case "stop_listening":
        voiceState = "IDLE";
        closeSTTRouterConnection(sessionId);
        updateState(sessionId, "IDLE");
        send(ws, { type: "state", state: "IDLE" });
        break;
      case "audio_chunk": {
        // 4) Safety: تجاهل المايك أثناء SPEAKING
        if (voiceState !== "LISTENING") return;
        if (!msg.pcmBase64) return;
        if (!process.env.OPENAI_API_KEY && !process.env.DEEPGRAM_API_KEY && !process.env.SPEECHMATICS_API_KEY) return;
        
          try {
            const buf = Buffer.from(msg.pcmBase64, "base64");

          // تسجيل صوت المرشح كاملاً (قبل فلتر الصمت) ضمن مسار المحادثة.
          recordChunk("user", "pcm", buf);

          // 3) Silence detection: لا ترسل audio إذا volume منخفض جداً
          const pcm16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
          const rms = Math.sqrt(pcm16.reduce((sum, sample) => sum + sample * sample, 0) / pcm16.length);
          const threshold = vad.pcmStreamingMinRms;

          if (rms < threshold) {
            return; // صمت - لا نرسل للـ STT
          }
          
          sendAudioToSTTRouter(sessionId, buf);
        } catch {
          send(ws, { type: "error", message: "invalid audio chunk" });
        }
        break;
      }
      default:
        send(ws, { type: "error", message: "unsupported message type" });
    }
  });

  ws.on("close", () => {
    activeConnections = Math.max(0, activeConnections - 1);
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    closeSTTRouterConnection(sessionId);
    clearSttPurgeToken(sessionId);

    // Unified-credit charge — bill actual voice session duration (skip test sessions).
    // Non-blocking and capped at the hard max; idempotent on the session id.
    if (VOICE_WS_BILLING_ENFORCE && !isVoiceTest) {
      const elapsedSeconds = Math.min(
        Math.ceil(Math.max(0, Date.now() - sessionStartedAt) / 1000),
        Math.floor(VOICE_WS_MAX_SESSION_MS / 1000),
      );
      if (elapsedSeconds > 0) {
        void (async () => {
          try {
            const organizationId = await resolveVoiceSessionOrgId(candidateId, resolvedCampaignId);
            const result = await finalizeUsageReservation({
              organizationId,
              sourceId: sessionId,
              actualUnits: elapsedSeconds,
              consumeSource: "voice_ws",
              consumeIdempotencyKey: `voice_ws:${sessionId}`,
              metadata: {
                candidateId,
                campaignId: resolvedCampaignId,
                durationSeconds: elapsedSeconds,
                mode: sessionMode,
                hadReservation: voiceReservationReady,
              },
            });
            if (!result.ok) {
              console.warn(`[VOICE BILLING] ${sessionId.substring(0, 8)}... not charged: ${result.code} — ${result.message}`);
            }
          } catch (err: any) {
            console.warn(`[VOICE BILLING] ${sessionId.substring(0, 8)}... error: ${err?.message || err}`);
          }
        })();
      }
    }
    lastSentBySession.delete(sessionId);
    const buffer = speechBuffers.get(sessionId);
    if (buffer?.timeout) {
      clearTimeout(buffer.timeout);
    }
    speechBuffers.delete(sessionId);
    const history = conversationHistory.get(sessionId);
    const historyCopy =
      history && history.length > 0 && !isVoiceTest ? [...history] : null;
    const interviewState = getInterviewState(sessionId);
    const evalContext = interviewState
      ? {
          phase: interviewState.phase,
          englishQuestionsAsked: interviewState.englishQuestionsAsked,
        }
      : undefined;
    conversationHistory.delete(sessionId);
    removeInterviewState(sessionId);
    removeSession(sessionId);

    void (async () => {
      if (!historyCopy?.length) return;

      if (
        candidateId &&
        /^[a-fA-F0-9]{24}$/.test(candidateId) &&
        hasMeaningfulConversation(historyCopy)
      ) {
        try {
          await markVoiceLinkConsumed(candidateId, sessionId, {
            applicationId: applicationIdParam,
            campaignId: resolvedCampaignId,
          });
        } catch (markErr: any) {
          console.warn(`[VOICE LINK] mark consumed failed: ${markErr?.message || markErr}`);
        }
      }

      if (sessionMode === "public") {
        const ctx = publicCampaignContextPromise
          ? await publicCampaignContextPromise
          : await loadPublicCampaignContext();
        applyPublicCampaignContext(ctx);
      }

      try {
        await finalizeAndSendVoiceTranscriptToN8N({
          sessionId,
          candidateId,
          conversationHistory: historyCopy,
          language,
          mode: sessionMode,
          jobCriteria,
          campaignId: resolvedCampaignId,
          jobAdvertisement,
          evalContext,
        });
      } catch (err: any) {
        console.warn(`[VOICE TRANSCRIPT] n8n send failed: ${err?.message || err}`);
      }
    })();

    if (recordingEnabled && recordingSegments.length > 0) {
      const segments = recordingSegments.splice(0);
      void finalizeVoiceRecording(sessionId, candidateId, segments, {
        applicationId: applicationIdParam,
        campaignId: resolvedCampaignId,
      });
    }

    console.log(`[SESSION END] ${sessionId.substring(0, 8)}...`);
  });
}

/**
 * نقطة دخول لـ voiceInterviewWs — نفس منطق handleVoiceWsConnection (متوافق مع وضع الاختبار الصوتي).
 */
export function attachVoiceSession(ws: WebSocket, req: IncomingMessage, _mode?: "interview" | "test"): void {
  handleVoiceWsConnection(ws, req);
}
