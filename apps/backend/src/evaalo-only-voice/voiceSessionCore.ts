import type { IncomingMessage } from "http";
import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import { createRateLimiter } from "./rateLimiter.js";
import { createSession, removeSession, touchSession, updateState } from "./sessionStore.js";
import { createInterviewState, getInterviewState, removeInterviewState, onExchangeComplete, FOLLOW_UP_MAX_PER_INTERVIEW, FOLLOW_UP_MIN_GAP_TURNS } from "./interviewState.js";
import { getControllerOutput } from "./interviewController.js";
import { selectNextQuestion, detectIntent, getAvailableTopicsForPhase1, inferTopicFromQuestion, validateLLMQuestion, extractTopicsFromAnswer, getFallbackForTopic, getFollowUpPromptPair, isWantsArabicSwitch, isEvasiveNonAnswer } from "./questionEngine.js";
import { isVoiceTopicMemoryEnabled } from "./interviewConfig.js";
import { stripEmojisAndSymbols, isNoiseTranscript, dedupeRepeats, normalizeForMerge, endsWithSemanticEnd } from "./transcriptCleaner.js";
import { getVoiceResponseTiming, getVoiceVadSettings, resolveTurnSilenceMs, shouldGraceBeforeSend } from "./voiceTimingEnv.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { createSTTRouterConnection, sendAudioToSTTRouter, closeSTTRouterConnection } from "../services/sttRouterService.js";
import { getLLMResponse, getTimeEndedApologyMessage, getInitialGreetingMessage, getVoiceTestGreeting, getVoiceTestChatResponse, polishVoiceArabicReply, type InterviewPhase } from "../services/llmService.js";
import { textToSpeech, textToSpeechWithTimestamps } from "../services/ttsService.js";
import Candidate from "../models/Candidate.js";
import RecruitmentCampaign from "../models/RecruitmentCampaign.js";
import { resolveApplicationJobContext } from "../services/applicationJobContext.js";
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
// سقف تنبيهات التهرّب لكل مقابلة — «أعطني مثالاً محدداً» بعد نفي التحدي. صارم كي لا
// يبدو الوكيل ملحّاً وكي لا يبتلع وقت المقابلة المحدود.
const DEFLECTION_PROBE_MAX = Number(process.env.VOICE_DEFLECTION_PROBE_MAX) || 1;

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
type SpeechBuffer = {
  /** النتائج النهائية فقط — هذا هو النص الذي يُرسَل للـ LLM */
  parts: string[];
  /** آخر نتيجة جزئية: ذيل لم يُثبَّت بعد. تُستبدل مع كل جزئية وتُمسح عند وصول نهائية */
  partial?: string;
  timeout?: NodeJS.Timeout;
  /** هل مُنحت مهلة السماح للذيل غير المثبّت في هذه السكتة؟ (مرّة واحدة لكل سكتة) */
  graced?: boolean;
};
const speechBuffers = new Map<string, SpeechBuffer>();

/**
 * نص الدور الحالي = النتائج النهائية + الذيل الجزئي إن لم يُثبَّت بعد.
 * Speechmatics يصفّر فرضيته الجزئية بعد كل نتيجة نهائية، فخلط الاثنين في مصفوفة
 * واحدة كان يكرّر الكلمات مرتين وثلاثاً في النص الذاهب للتقييم.
 */
function bufferedSentence(buffer: SpeechBuffer): string {
  const tail = buffer.partial?.trim();
  const parts = tail ? [...buffer.parts, tail] : buffer.parts;
  return parts.join(" ").trim();
}
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
  /**
   * قفل لغة المقابلة — مصدره رابط المشاركة، وهو المرجع الوحيد لاختيار الصوت
   * ولغة ردود الايجنت. لا يتغير بتغيّر لغة كلام المرشح؛ يتغير فقط بطلب تحويل
   * صريح. الكردية تُعامل كعربية لأن الصوت العربي هو الوحيد الذي يخدمها.
   */
  let interviewLanguage: 'ar' | 'en' =
    language === 'en' || language === 'english' ? 'en' : 'ar';
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
  const LATE_TRANSCRIPT_IGNORE_MS = voiceTiming.lateTranscriptIgnoreMs;
  /** يُقاس مرة واحدة لكل نافذة استماع: الفجوة بين فتح الميك وأول كلمة تُلتقط */
  let firstTranscriptLogged = false;
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
      firstTranscriptLogged = false;
    }
    createSTTRouterConnection(
      sessionId,
      (text, isFinal, confidence) => {
        if (getSttPurgeToken(sessionId) !== sttTokenAtCurrentListen) return;
        if (voiceState === "SPEAKING") return;
        if (lastListeningStartedAt > 0 && Date.now() - lastListeningStartedAt < LATE_TRANSCRIPT_IGNORE_MS) return;
        const t = text.trim();
        if (t) {
          if (!firstTranscriptLogged && lastListeningStartedAt > 0) {
            firstTranscriptLogged = true;
            console.log(
              `[LISTEN LATENCY] ${sessionId.substring(0, 8)}... first transcript ${Date.now() - lastListeningStartedAt}ms after LISTENING`
            );
          }
          handleTranscript(t, isFinal, confidence);
          // إرسال النص المتراكم (تدفقي) للعرض - وليس آخر chunk فقط
          const buffer = speechBuffers.get(sessionId);
          let displayText = (buffer ? bufferedSentence(buffer) : "") || t;
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
  // مهلة سماح تُمنَح مرّة واحدة لينزل النهائي المتأخّر قبل إرسال الدور (يمنع بتر الذيل).
  const FINAL_GRACE_MS = Number(process.env.VOICE_FINAL_GRACE_MS) || 400;
  const INCOMPLETE_TAIL_EXTRA_MS = voiceTiming.incompleteTailExtraMs;
  const MIN_CHARS = 10;
  const MIN_CONFIDENCE = 0.6; // 3) فلترة: if (confidence < 0.6) ignore (عند توفره من STT)

  // 4) دمج الجمل: buffer += partial؛ إذا صمت → sendToLLM(buffer) فقط
  const sendCompleteSentence = () => {
    const buffer = speechBuffers.get(sessionId);
    if (!buffer) return;

    let completeSentence = bufferedSentence(buffer);
    if (!completeSentence) return;
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

  // انطلق مؤقّت الصمت: نمنح مهلة سماح واحدة قصيرة لينزل النهائي المتأخّر من
  // Speechmatics أو ليستأنف المرشح كلامه — يمنع بتر آخر كلمة/حرف.
  const onSilenceElapsed = () => {
    const buffer = speechBuffers.get(sessionId);
    if (!buffer) return;
    if (shouldGraceBeforeSend(buffer.graced === true)) {
      buffer.graced = true;
      buffer.timeout = setTimeout(onSilenceElapsed, FINAL_GRACE_MS);
      return;
    }
    sendCompleteSentence();
  };

  /**
   * يعيد تسليح مؤقّت الصمت على الدور المتراكم. يُستدعى عند كل دليل على أن المرشح ما
   * زال يتكلم — بما فيه المقاطع التي نُسقطها لانخفاض الثقة.
   */
  const armSilenceTimer = () => {
    const buffer = speechBuffers.get(sessionId);
    if (!buffer) return;
    if (buffer.timeout) clearTimeout(buffer.timeout);
    // حدث جديد وصل: نُتيح مهلة سماح جديدة عند التوقف القادم
    buffer.graced = false;
    const completeSentence = bufferedSentence(buffer);
    const silenceMs = resolveTurnSilenceMs({
      tailIsFinal: buffer.partial === undefined,
      endsWithPunctuation: endsWithSemanticEnd(completeSentence),
      punctuationMs: USER_STOPPED_WITH_PUNCTUATION_MS,
      defaultMs: USER_STOPPED_SPEAKING_MS,
      text: completeSentence,
      incompleteTailExtraMs: INCOMPLETE_TAIL_EXTRA_MS,
    });
    buffer.timeout = setTimeout(onSilenceElapsed, silenceMs);
  };

  // عند أي transcript (partial أو final): انتظار توقف المستخدم عن الكلام قبل الإرسال للـ LLM
  const handleTranscript = (transcript: string, isFinal: boolean, confidence?: number) => {
    if (confidence !== undefined && confidence < MIN_CONFIDENCE) {
      // النص لا يدخل الدور (ثقة منخفضة)، لكنه دليل أن المرشح ما زال يتكلم — غالباً
      // تبديل لغوي ar↔en يخفض الثقة. بدون تمديد النافذة كان يُحتسب صمتاً فيُقطع الدور.
      armSilenceTimer();
      return;
    }

    const cleaned = stripEmojisAndSymbols(transcript.trim());
    if (isFinal) console.log(`[STT FINAL] ${sessionId.substring(0, 8)}... "${cleaned.substring(0, 60)}${cleaned.length > 60 ? '...' : ''}"`);
    if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LENGTH) return;

    let buffer = speechBuffers.get(sessionId);
    if (!buffer) {
      buffer = { parts: [] };
      speechBuffers.set(sessionId, buffer);
    }

    if (isFinal) {
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
      buffer.partial = undefined;
    } else {
      buffer.partial = cleaned;
    }

    // الجزئيات تعيد ضبط مؤقت الصمت أيضاً — فهي دليل أن المرشح ما زال يتكلم
    armSilenceTimer();
  };

  /** TTS + محاذاة كلمات + انتظار playback_ended + استئناف الاستماع — مشترك بين المقابلة ووضع اختبار الصوت */
  const speakAgentReply = async (llmReply: string, options?: { resumeListening?: boolean; endSession?: boolean }) => {
    const resumeListening = options?.resumeListening ?? true;
    const endSession = options?.endSession ?? false;
    // الصوت يتبع لغة الجلسة لا نص الرد: الصوت العربي ثنائي اللغة فيغطي أسئلة
    // الإنجليزية داخل مقابلة عربية بلا تبديل مفاجئ لهوية المتحدث.
    const ttsLanguage = interviewLanguage;

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
    // المهلة مشتقّة من مدة الصوت لا من سقف ثابت: طوابع الحروف تعطينا المدة، فإذا لم
    // يصل playback_ended (تبويبة مجمّدة تجمّد مؤقّتات العميل أيضاً) ننتظر المدة + هامشاً
    // بدل نصف دقيقة يُهمَل فيها كل كلام المرشح. المسار الطبيعي لا يتغيّر: وصول الرسالة
    // يتقدّم فوراً. بلا طوابع (chunkOffsetSeconds = 0) نعود إلى السقف كما كان.
    const audioMs = Math.round(chunkOffsetSeconds * 1000);
    const PLAYBACK_ENDED_TIMEOUT_MS =
      audioMs > 0
        ? Math.min(voiceTiming.playbackEndedTimeoutMs, audioMs + voiceTiming.playbackEndedMarginMs)
        : voiceTiming.playbackEndedTimeoutMs;
    const minDelay = new Promise<void>((r) => setTimeout(r, TTS_TO_STT_DELAY_MS));
    const playbackEnded = new Promise<void>((resolve) => {
      const done = () => {
        if (t) clearTimeout(t);
        pendingPlaybackEnded.delete(sessionId);
        resolve();
      };
      pendingPlaybackEnded.set(sessionId, done);
      const t = setTimeout(() => {
        console.warn(
          `[PLAYBACK TIMEOUT] ${sessionId.substring(0, 8)}... no playback_ended after ${PLAYBACK_ENDED_TIMEOUT_MS}ms (audio ${audioMs}ms)`
        );
        done();
      }, PLAYBACK_ENDED_TIMEOUT_MS);
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
        const apologyMsg = await getTimeEndedApologyMessage(cleaned, interviewLanguage);
        send(ws, { type: "agent_reply", text: apologyMsg });
        const history = conversationHistory.get(sessionId) || [];
        history.push({ role: "user", content: cleaned });
        history.push({ role: "assistant", content: apologyMsg });
        conversationHistory.set(sessionId, history);
        const sendChunk = (c: Buffer) => {
          recordChunk("agent", "mp3", c);
          send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
        };
        await textToSpeech(apologyMsg, interviewLanguage, sendChunk);
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
            // Identity and background come from the person. The job does not:
            // the person's copy is the one they first applied for, so a
            // returning applicant would be interviewed about the wrong role.
            const job = await resolveApplicationJobContext({
              applicationId: applicationIdParam,
              candidateId,
              campaignId: resolvedCampaignId,
            });
            candidateProfile = {
              full_name: c.full_name,
              email: c.email,
              phone: c.phone,
              gender: c.gender,
              position_applied_for: job ? job.position_applied_for : c.position_applied_for,
              company_applied_to: job ? job.company_applied_to : c.company_applied_to,
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

      // كسر القفل بطلب صريح فقط. الصوت الإنجليزي أحادي اللغة، لذا التحول إلى
      // العربية يستدعي تبديل الصوت أيضاً — وهو ما يفعله تحديث `interviewLanguage`.
      // الجلسة العربية تحتفظ بسلوكها القائم (صدّ الطلب المبكر حتى Phase 3).
      if (interviewLanguage === 'en' && isWantsArabicSwitch(cleaned)) {
        interviewLanguage = 'ar';
        console.log(`[LANG SWITCH] ${sessionId.substring(0, 8)}... en -> ar (candidate request)`);
      }

      const userMessageCount = history.filter((m) => m.role === "user").length;
      const interviewState = getInterviewState(sessionId);
      const controllerOutput = getControllerOutput(userMessageCount, interviewState, interviewLanguage);
      const { phase: currentPhase, isFirstPhase3Message, mandatoryQuestionDue } = controllerOutput;

      // الجلسة الإنجليزية المقفلة: لا تُستنتج اللغة من كلام المرشح إطلاقاً،
      // وإلا انقلب `preferArabic` وعادت الأسئلة عربية.
      const candidateLastLang =
        interviewLanguage === 'en'
          ? ('en' as const)
          : /[\u0600-\u06FF]/.test(cleaned)
          ? ('ar' as const)
          : ('en' as const);
      const intent = detectIntent(cleaned);
      const changeRequested = intent === 'change_question';
      const clarificationRequested = intent === 'clarification';
      const lastAssistantMessage = history.filter((m) => m.role === 'assistant').pop()?.content;
      const recentAssistantQuestions = history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .slice(-4);

      // تعميق التهرّب: إذا نفى المرشح وجود تحدٍّ («ما واجهت تحديات») رداً على سؤال
      // يطلب موقفاً/مثالاً، نطرح تنبيهاً لطيفاً واحداً يطلب مثالاً محدداً بدل تبديل
      // الموضوع فوراً. مسقوف بـ DEFLECTION_PROBE_MAX، ولا يعمل في Phase 3 (الإنجليزية).
      const lastQAskedForExample = /(تحدي|تحديات|موقف|صعب|صعوبة|مثال|challenge|example|situation|difficult)/i.test(
        lastAssistantMessage ?? ''
      );
      const deflectionProbe =
        currentPhase !== 3 &&
        !changeRequested &&
        !clarificationRequested &&
        (interviewState?.deflectionProbesUsed ?? 0) < DEFLECTION_PROBE_MAX &&
        lastQAskedForExample &&
        isEvasiveNonAnswer(cleaned);

      // المتابعة — قواعد صارمة: سقف FOLLOW_UP_MAX_PER_INTERVIEW للمقابلة كلها، وفاصل
      // FOLLOW_UP_MIN_GAP_TURNS أدوار (سؤالان عاديان) بين متابعتين. طلب التوضيح أو تغيير
      // السؤال لا يمنح متابعة إضافية ولا يعيد ضبط العدّادات.
      const turnIndex = userMessageCount + 1;
      const followUpsUsed = interviewState?.totalFollowUps ?? 0;
      const lastFollowUpTurn = interviewState?.lastFollowUpTurn ?? -FOLLOW_UP_MIN_GAP_TURNS;
      const followUpBudgetLeft = followUpsUsed < FOLLOW_UP_MAX_PER_INTERVIEW;
      const followUpGapOk = turnIndex - lastFollowUpTurn >= FOLLOW_UP_MIN_GAP_TURNS;
      const allowFollowUp =
        userMessageCount >= 2 &&
        !changeRequested &&
        !clarificationRequested &&
        !deflectionProbe &&
        followUpBudgetLeft &&
        followUpGapOk;
      const followUpNext: 1 | undefined = allowFollowUp && intent === 'challenge' ? 1 : undefined;
      if (intent === 'challenge' && !followUpNext) {
        console.log(
          `[FOLLOW-UP BLOCKED] ${sessionId.substring(0, 8)}... used=${followUpsUsed}/${FOLLOW_UP_MAX_PER_INTERVIEW} turn=${turnIndex} lastAt=${lastFollowUpTurn} budget=${followUpBudgetLeft} gap=${followUpGapOk}`
        );
      }

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

      // تنبيه التهرّب يتجاوز السؤال المختار: رسالة ثابتة لطيفة (بلا LLM) تطلب مثالاً
      // محدداً. مرة واحدة فقط لكل موقف — ثم يُقبل أي رد ويُكمل التدفق بلا إلحاح.
      if (deflectionProbe) {
        const probeText =
          candidateLastLang === 'ar'
            ? 'ولو موقف بسيط — تكدر تعطيني مثال محدد صار وياك وشلون تعاملت وياه؟'
            : 'Even a small one — can you give me one specific example and how you handled it?';
        selectedQuestion = {
          text: probeText,
          isFixed: true,
          preferArabic: candidateLastLang === 'ar',
        };
        console.log(`[DEFLECTION PROBE] ${sessionId.substring(0, 8)}... used=${(interviewState?.deflectionProbesUsed ?? 0) + 1}/${DEFLECTION_PROBE_MAX}`);
      }

      const mode = clarificationRequested ? 'clarify' : deflectionProbe ? 'deflection-probe' : followUpNext ? `follow-up:${followUpNext}` : selectedQuestion?.availableTopics ? 'topic-choice' : selectedQuestion?.topic ? 'topic' : selectedQuestion?.isFixed ? 'fixed' : 'rephrase';
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
              followUpRotation: interviewState?.totalFollowUps ?? 0,
              timeEndedForInterview: timeEndedSent,
              sessionLanguage: interviewLanguage,
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
                followUpRotation: interviewState?.totalFollowUps ?? 0,
                timeEndedForInterview: timeEndedSent,
                sessionLanguage: interviewLanguage,
              }),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('LLM timeout after 10s (retry)')), 10000)
              )
            ]);
          } catch (retryErr: any) {
            llmReply =
              interviewLanguage === 'en' || currentPhase === 3
                ? 'Could you repeat your answer, please?'
                : 'ممكن تعيد الإجابة؟';
            console.warn(`[LLM FALLBACK] ${sessionId.substring(0, 8)}... using fallback after retry failed`);
          }
        }
        const llmTime = Date.now() - llmStartTime;
        console.log(`[LLM TIME] ${sessionId.substring(0, 8)}... ${llmTime}ms`);

        // Hybrid Intelligence: Engine يتحقق من اقتراح الـ LLM.
        // المتابعة وطلب الإعادة يعودان لنفس الموضوع بقصد، فلا يخضعان لحارس التكرار.
        const duplicateGuard =
          clarificationRequested || followUpNext ? undefined : recentAssistantQuestions;
        if (!validateLLMQuestion(llmReply, duplicateGuard)) {
          // احتياطيات المواضيع مكتوبة بالعراقية فقط — الجلسة الإنجليزية تأخذ
          // بديلاً إنجليزياً محايداً بدلاً من كسر قفل اللغة عند أول فشل تحقق.
          // Phase 3 إنجليزية دائماً حتى في جلسة عربية ثنائية: أي fallback هنا يجب أن
          // يكون إنجليزياً وإلا تسرّب سؤال عربي وسط اختبار الإنجليزية (كان
          // getFallbackForTopic يُرجع عربية لأن اللغة 'ar' رغم أننا في Phase 3).
          const forceEnglish = interviewLanguage === 'en' || currentPhase === 3;
          const genericFallback = forceEnglish
            ? 'Could you tell me more about that?'
            : 'ممكن تحچيلي أكثر عن هالموضوع؟';
          const topicFallback = (topic: string) =>
            forceEnglish
              ? genericFallback
              : getFallbackForTopic(topic, candidateProfile?.gender);
          // بلا موضوع محدد (وضع rephrase): ننتقل لموضوع لم يُطرح بعد بدل إعادة
          // آخر سؤال — هذا كان مصدر تكرار السؤال على المرشح.
          const unaskedTopic = getAvailableTopicsForPhase1(interviewState)[0];
          const fallback = clarificationRequested && lastAssistantMessage
            ? lastAssistantMessage
            : followUpNext
              ? ((fp) => (!forceEnglish && candidateLastLang === 'ar' ? fp.ar : fp.en))(getFollowUpPromptPair(selectedQuestion, interviewState?.totalFollowUps ?? 0))
              : selectedQuestion?.topic
                ? topicFallback(selectedQuestion.topic)
                : selectedQuestion?.availableTopics?.length
                ? topicFallback(selectedQuestion.availableTopics[0])
                : unaskedTopic
                ? topicFallback(unaskedTopic)
                : selectedQuestion?.text ?? genericFallback;
          console.warn(`[ENGINE VALIDATE] ${sessionId.substring(0, 8)}... LLM reply invalid, using fallback`);
          llmReply = polishVoiceArabicReply(fallback, {
            gender: candidateProfile?.gender,
            acknowledgmentTurn: ackTurn,
          });
        }
      }

      console.log(`[AGENT] ${sessionId.substring(0, 8)}... "${llmReply.substring(0, 160)}${llmReply.length > 160 ? '...' : ''}"`);
      history.push({ role: "user", content: cleaned });
      history.push({ role: "assistant", content: llmReply });
      conversationHistory.set(sessionId, history);
      const nextFollowUpCount: 0 | 1 = followUpNext ? 1 : 0;
      const topicUsed = followUpNext ? undefined
        : selectedQuestion?.topic
        ? selectedQuestion.topic
        : selectedQuestion?.availableTopics
        ? inferTopicFromQuestion(llmReply)
        : undefined;
      // إشارتا Phase 3 لمحاسبة الحالة: هل نحن في مرحلة الـ controller 3، وهل كان رد
      // هذا الدور إعلان اختبار الإنجليزية («جاهز؟»).
      // العلَم صريح الآن: كان يُستنتج من isFixed، فأي رسالة ثابتة أخرى داخل المرحلة
      // الثالثة (تنبيه تهرّب، أو سؤال الترجمة الحرفي) كانت تُحسب «إعلاناً» فيتجمّد
      // عدّاد أسئلة الإنجليزية ويُعاد السؤال نفسه.
      const englishIntroEmitted = currentPhase === 3 && selectedQuestion?.isEnglishIntro === true;
      onExchangeComplete(sessionId, llmReply, userMessageCount, {
        mandatoryQuestion1Asked: mandatoryQuestionDue === 1,
        mandatoryQuestion2Asked: mandatoryQuestionDue === 2,
        poolUsed: clarificationRequested || followUpNext ? undefined : selectedQuestion?.pool,
        topicUsed: isVoiceTopicMemoryEnabled() ? topicUsed : undefined,
        followUpCount: nextFollowUpCount,
        followUpAsked: followUpNext === 1,
        phase3Reached: currentPhase === 3,
        englishIntroEmitted,
        deflectionProbeUsed: deflectionProbe,
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
                    // The greeting names the role out loud — the first thing
                    // the candidate hears, and the first thing to be wrong.
                    const job = await resolveApplicationJobContext({
                      applicationId: applicationIdParam,
                      candidateId,
                      campaignId: resolvedCampaignId,
                    });
                    candidateProfile = {
                      full_name: c.full_name,
                      position_applied_for: job ? job.position_applied_for : c.position_applied_for,
                      company_applied_to: job ? job.company_applied_to : c.company_applied_to,
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
            await textToSpeech(greetingMsg, interviewLanguage, sendChunk);
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
        console.log(`[TIME_ENDED] ${sessionId.substring(0, 8)}... concluding + closing`);
        // انتهى الوقت = نهاية المقابلة. نوقف الاستماع فوراً (وإلا يدخل المرشح في حلقة
        // اعتذارات لا تنتهي، والوكيل يظل يتكلّم حتى سقف المدة القصوى)، ثم نُشغّل ختاماً
        // ثابتاً بلغة الجلسة — لا LLM، لتفادي أخطاء الصياغة/الهلوسة — ونغلق الاتصال من
        // جهة الخادم كما في المسار الطبيعي (isInterviewEnd).
        voiceState = "IDLE";
        closeSTTRouterConnection(sessionId);
        (async () => {
          try {
            const history = conversationHistory.get(sessionId) || [];
            const closingMsg =
              interviewLanguage === 'en'
                ? 'Thank you for your time. The interview has now ended, and our HR team will review your answers and contact you with the next steps.'
                : 'شكراً على وقتك. انتهت المقابلة الآن، وسيراجع فريق الموارد البشرية إجاباتك ويتواصل معك بالخطوات التالية.';
            startSpeaking();
            send(ws, { type: "agent_reply", text: closingMsg });
            history.push({ role: "assistant", content: closingMsg });
            conversationHistory.set(sessionId, history);
            const sendChunk = (c: Buffer) => {
              recordChunk("agent", "mp3", c);
              send(ws, { type: "audio_chunk", chunkBase64: c.toString("base64"), format: "mp3" });
            };
            await textToSpeech(closingMsg, interviewLanguage, sendChunk);
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
          } catch (err: any) {
            console.warn(`[TIME_ENDED] ${sessionId.substring(0, 8)}... ${err?.message || err}`);
          } finally {
            updateState(sessionId, "IDLE");
            send(ws, { type: "state", state: "IDLE" });
            if (ws.readyState === ws.OPEN) ws.close(1000, "interview_complete");
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

      const durationSec = Math.ceil(Math.max(0, Date.now() - sessionStartedAt) / 1000);
      const { assessVoiceInterviewEvidence } = await import(
        "../services/voiceInterviewEvidenceGate.js"
      );
      const evidence = assessVoiceInterviewEvidence(historyCopy, durationSec);

      // Only lock the share link after a session that is thick enough to score.
      // Thin/cut-off calls stay reusable so the candidate can retry.
      if (
        evidence.ok &&
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
          durationSec,
          applicationId: applicationIdParam,
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
