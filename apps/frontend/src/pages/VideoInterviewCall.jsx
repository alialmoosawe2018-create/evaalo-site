import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Room, RoomEvent, RemoteParticipant, RemoteTrack, Track, ParticipantKind, VideoQuality } from 'livekit-client';
import { useLanguage } from '../contexts/LanguageContext';
import { AvatarHostContainer } from '../components/videoInterview/AvatarHostContainer';
import VoiceInterviewPrepTips from '../components/VoiceInterviewPrepTips';
import InterviewLinkBlocked from '../components/InterviewLinkBlocked.jsx';
import { isVideoInterviewLinkConsumed, INTERVIEW_LINK_ALREADY_USED } from '../utils/interviewLinkAccess.js';
import { parseInterviewUrlLanguage } from '../utils/interviewShareLink.js';
import useLiveKitToken from '../hooks/useLiveKitToken';
import useLiveKitState from '../hooks/useLiveKitState';
import useSoundEffects from '../hooks/useSoundEffects';
import { connectWithRetry, handleConnectionError } from '../utils/connectionRetry';
import { isLocalHostDebug } from '../utils/isLocalHostDebug';
import { API_BASE_URL } from '../config/apiBase.js';
import '../design-styles.css';

const isBeyAvatarIdentity = (p) => p?.identity === 'bey-avatar-agent';

/** Remote tile: agent dispatch + avatar worker identities */
const isAvatarParticipant = (participant) => {
    if (!participant) return false;
    const identity = participant.identity;
    if (isBeyAvatarIdentity(participant)) return true;
    if (identity.startsWith('agent-')) return true;
    if (participant.kind === ParticipantKind.AGENT && participant.attributes?.['lk.publish_on_behalf']) return true;
    return false;
};

/** Audio from Beyond path only (no generic agent-* without publish_on_behalf) */
const isAvatarWorkerParticipant = (participant) => {
    if (!participant) return false;
    if (isBeyAvatarIdentity(participant)) return true;
    if (participant.kind === ParticipantKind.AGENT && participant.attributes?.['lk.publish_on_behalf']) return true;
    return false;
};

/** Dev-only logging — production console stays quiet */
const nativeLog = Reflect.get(console, 'log').bind(console);
const devLog = (...args) => {
    if (import.meta.env.DEV) nativeLog(...args);
};

/**
 * نافذة قصيرة: نهائيات STT مزدوجة لنفس المقطع (تصحيح/امتداد نصّي).
 */
const USER_TRANSCRIPT_MERGE_GAP_MS = 2800;

/**
 * STT قد يُرسل نهائيين متتابعين لنفس الكلام قبل رد الوكيل — ندمجهما في فقاعة واحدة.
 * لا يُدمَج إن كانت آخر رسالة من المساعد (بداية دور جديد للمستخدم).
 */
const USER_SAME_SPEECH_TURN_GAP_MS = 12000;

/**
 * يحوّل conversationHistory (state الواجهة) إلى صيغة الباكند { role, content }.
 * نُبقي الرسائل النهائية فقط (isFinal !== false) ونتجاهل الفارغة — كي يصل ترانسكريبت نظيف إلى n8n.
 */
function serializeTranscript(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((msg) => msg && msg.isFinal !== false && String(msg.content || '').trim())
        .map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content || '').trim(),
        }));
}

/** دمج نهائيين فقط إن كانا نفس موجة STT (امتداد/تصحيح/تكرار)، لا جملتين مستقلتين. */
function shouldMergeUserTranscriptFinals(prev, next) {
    const pn = (prev || '').trim().replace(/\s+/g, ' ');
    const nn = (next || '').trim().replace(/\s+/g, ' ');
    if (!pn || !nn) return false;
    if (pn === nn) return true;
    if (nn.startsWith(pn) || pn.startsWith(nn)) return true;
    if (pn.includes(nn) || nn.includes(pn)) return true;
    return false;
}

function mergeUserTranscriptFragments(prev, next) {
    const p = (prev || '').trim();
    const n = (next || '').trim();
    if (!p) return n;
    if (!n) return p;
    const pn = p.replace(/\s+/g, ' ');
    const nn = n.replace(/\s+/g, ' ');
    if (nn.startsWith(pn)) return n;
    if (pn.startsWith(nn)) return p;
    if (pn.includes(nn) || nn.includes(pn)) return pn.length >= nn.length ? p : n;
    return `${pn} ${nn}`.trim();
}

/** عرض فقاعة واحدة: النص المخزّن + تدفق live (الـ partials غالباً تراكمية وتتضمن النهائي القصير). */
function mergeLiveCaptionWithStored(stored, live) {
    const s = (stored || '').trim();
    const l = (live || '').trim();
    if (!l) return s || '';
    if (!s) return l;
    const sn = s.replace(/\s+/g, ' ');
    const ln = l.replace(/\s+/g, ' ');
    if (ln.startsWith(sn) || sn.startsWith(ln)) return ln.length >= sn.length ? l : s;
    if (sn.includes(ln) || ln.includes(sn)) return ln.length >= sn.length ? l : s;
    return `${sn} ${ln}`.trim();
}

/** Default HIGH: MEDIUM looked soft/blurry while the avatar speaks (motion + simulcast). Set medium|low if bandwidth is tight. */
const _envAvatarVQ = (import.meta.env?.VITE_AVATAR_VIDEO_QUALITY || 'high').toString().toLowerCase();
const AVATAR_SUBSCRIBE_VIDEO_QUALITY = (() => {
    if (_envAvatarVQ === 'high' || _envAvatarVQ === 'h') return VideoQuality.HIGH;
    if (_envAvatarVQ === 'low' || _envAvatarVQ === 'l') return VideoQuality.LOW;
    return VideoQuality.MEDIUM;
})();

/**
 * أبعاد دنيا للاشتراك — LiveKit يستخدمها بدل قياس العنصر فقط، فيطلب طبقة simulcast أعلى ويقلّل الضبابية أثناء حركة الأفاتار/الكلام.
 * رفع الدقة: VITE_AVATAR_SUBSCRIBE_MIN_WIDTH=1920 VITE_AVATAR_SUBSCRIBE_MIN_HEIGHT=1080 (أثقل على الشبكة)
 */
const AVATAR_VIDEO_MIN_DIMENSIONS = (() => {
    const w = Number(import.meta.env?.VITE_AVATAR_SUBSCRIBE_MIN_WIDTH ?? '1280');
    const h = Number(import.meta.env?.VITE_AVATAR_SUBSCRIBE_MIN_HEIGHT ?? '720');
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
        return { width: 1280, height: 720 };
    }
    const width = Math.max(640, Math.min(3840, Math.floor(w)));
    const height = Math.max(360, Math.min(2160, Math.floor(h)));
    return { width, height };
})();

/** false يعطّل setVideoDimensions ويبقي السلوك السابق (وفر نطاقاً إذا لزم). */
const AVATAR_PIN_SUBSCRIBE_DIMENSIONS =
    String(import.meta.env?.VITE_AVATAR_PIN_SUBSCRIBE_DIMENSIONS ?? 'true').toLowerCase() !== 'false';

/** أثناء speaking: إعادة تثبيت الجودة/الأبعاد كل N ms. 0 = معطّل (أهدأ للأفاتار؛ جرّب 4000–8000 إذا الشبكة تخفّض الطبقة باستمرار). */
const AVATAR_SPEAKING_QUALITY_REFRESH_MS = (() => {
    const n = Number(import.meta.env?.VITE_AVATAR_SPEAKING_QUALITY_REFRESH_MS ?? '0');
    if (!Number.isFinite(n)) return 0;
    return Math.min(8000, Math.max(0, Math.floor(n)));
})();

/** يحدّ تكرار setVideoDimensions/setVideoQuality — الاستدعاءات المتتالية تهز طبقة SFU وتُظهر تقطيعاً. */
let _avatarSubQualityLastMs = 0;
let _avatarSubQualityLastSid = '';
const AVATAR_SUBSCRIBE_QUALITY_MIN_INTERVAL_MS = (() => {
    const n = Number(import.meta.env?.VITE_AVATAR_SUBSCRIBE_QUALITY_MIN_INTERVAL_MS ?? '200');
    if (!Number.isFinite(n)) return 200;
    return Math.min(2000, Math.max(80, Math.floor(n)));
})();

const ensureAvatarVideoSubscriptionQuality = (publication) => {
    if (!publication || publication.kind !== Track.Kind.Video) return;
    const sid = publication.trackSid || '';
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
        sid &&
        sid === _avatarSubQualityLastSid &&
        now - _avatarSubQualityLastMs < AVATAR_SUBSCRIBE_QUALITY_MIN_INTERVAL_MS
    ) {
        return;
    }
    _avatarSubQualityLastSid = sid;
    _avatarSubQualityLastMs = now;
    try {
        if (
            AVATAR_PIN_SUBSCRIBE_DIMENSIONS &&
            typeof publication.setVideoDimensions === 'function'
        ) {
            publication.setVideoDimensions(AVATAR_VIDEO_MIN_DIMENSIONS);
        }
        publication.setVideoQuality?.(AVATAR_SUBSCRIBE_VIDEO_QUALITY);
    } catch (_) {
        /* non-simulcast or older server: no-op */
    }
};

// Polyfill for global (needed by opus-media-recorder)
if (typeof global === 'undefined') {
    window.global = window;
}

// ✅ LiveKit handles all audio - no MediaRecorder, AudioWorklet, or WebSocket needed

/** بعد انتهاء كلام الوكيل: تأخير قبل إعادة الميكروفون يقلّل ذيل الصدى؛ قيماً عالية (~400ms+) تُسقط أول كلمات لأن الصوت لا يُرسل للغرفة حتى enabled=true */
const _envMicDelay = import.meta.env?.VITE_AVATAR_MIC_UNMUTE_DELAY_MS;
const AVATAR_MIC_UNMUTE_DELAY_MS =
    _envMicDelay != null && _envMicDelay !== '' && !Number.isNaN(Number(_envMicDelay))
        ? Number(_envMicDelay)
        : 200;
/** عند انتهاء صوت الأفاتار فعلياً: كم ننتظر قبل عرض listening إذا بقي lk.agent.state متأخراً على speaking. */
const _envAgentUiAudioIdle = import.meta.env?.VITE_AGENT_STATE_AUDIO_IDLE_MS;
const AGENT_UI_AUDIO_IDLE_MS =
    _envAgentUiAudioIdle != null &&
    _envAgentUiAudioIdle !== '' &&
    !Number.isNaN(Number(_envAgentUiAudioIdle))
        ? Math.max(0, Number(_envAgentUiAudioIdle))
        : 160;

/** بعد انتهاء كلام الأفاتار قد يصل TrackUnsubscribed لحظي — detach فوري يقطّع الصورة حتى مع resubscribe سريع */
const _envVidUnsub = import.meta.env?.VITE_AVATAR_VIDEO_UNSUB_DEBOUNCE_MS;
const AVATAR_VIDEO_UNSUB_DEBOUNCE_MS =
    _envVidUnsub != null && _envVidUnsub !== '' && !Number.isNaN(Number(_envVidUnsub))
        ? Number(_envVidUnsub)
        : 2200;

// Legacy backend WS fallback can race with LiveKit media attachment and cause avatar instability.
const ENABLE_LEGACY_WEBSOCKET_FALLBACK =
    String(import.meta.env?.VITE_ENABLE_LEGACY_WS_FALLBACK ?? '').toLowerCase() === 'true';

/** كتم الميك أثناء thinking أيضاً — يقلّل التقاط صوت السماعة قبل أن يتحول lk.agent.state إلى speaking */
const AVATAR_MIC_MUTE_WHILE_THINKING =
    String(import.meta.env?.VITE_AVATAR_MIC_MUTE_WHILE_THINKING ?? '').toLowerCase() === 'true';

/** adaptiveStream: إن كان true يخفّض جودة فيديو المشترك تلقائياً → أفاتار قد يبدو أقل ثباتاً؛ افتراضي off. شبكة ضعيفة فقط: true */
const LIVEKIT_ADAPTIVE_STREAM =
    String(import.meta.env?.VITE_LIVEKIT_ADAPTIVE_STREAM ?? 'false').toLowerCase() === 'true';

/**
 * LiveKit docs (Adaptive stream): with `track.attach()`, prefer `pixelDensity: 'screen'` on HiDPI so simulcast layer matches display density.
 * Env: VITE_LIVEKIT_ADAPTIVE_PIXEL_DENSITY = screen | number | 0 (density off, pause-only)
 * https://docs.livekit.io/transport/media/subscribe/#adaptive-stream
 */
function livekitAdaptiveStreamRoomOption() {
    if (!LIVEKIT_ADAPTIVE_STREAM) {
        return false;
    }
    const raw = (import.meta.env?.VITE_LIVEKIT_ADAPTIVE_PIXEL_DENSITY ?? 'screen').toString().trim().toLowerCase();
    const pauseVideoInBackground =
        String(import.meta.env?.VITE_LIVEKIT_PAUSE_VIDEO_IN_BACKGROUND ?? 'true').toLowerCase() !== 'false';
    if (raw === '0' || raw === 'false' || raw === 'off') {
        return { pauseVideoInBackground };
    }
    if (raw === 'screen') {
        return { pixelDensity: 'screen', pauseVideoInBackground };
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
        return { pixelDensity: n, pauseVideoInBackground };
    }
    return { pixelDensity: 'screen', pauseVideoInBackground };
}

/** dynacast: يوقف طبقات غير مستخدمة على الناشر — يوفر CPU/نطاقاً؛ وثائق LiveKit غالباً adaptive+dynacast معاً لجلسات كبيرة. لمقابلة 1:1 افتراضياً off. */
const LIVEKIT_DYNACAST =
    String(import.meta.env?.VITE_LIVEKIT_DYNACAST ?? 'false').toLowerCase() === 'true';
/** @experimental LiveKit Cloud — قد يقلّل تعقيد ICE. جرّب عند عدم ثبات الوسائط: VITE_LIVEKIT_SINGLE_PC=true */
const LIVEKIT_SINGLE_PEER_CONNECTION =
    String(import.meta.env?.VITE_LIVEKIT_SINGLE_PC ?? 'false').toLowerCase() === 'true';
const LIVEKIT_CONNECT_MAX_ATTEMPTS = (() => {
    const n = Number(import.meta.env?.VITE_LIVEKIT_CONNECT_RETRIES ?? '3');
    if (!Number.isFinite(n)) return 3;
    return Math.min(5, Math.max(1, Math.floor(n)));
})();

/** After signal reconnect, wait this long before full avatar resync (coalesces rapid Reconnected bursts). */
const LIVEKIT_RECONNECTED_SYNC_DEBOUNCE_MS = (() => {
    const n = Number(import.meta.env?.VITE_LIVEKIT_RECONNECTED_DEBOUNCE_MS ?? '300');
    if (!Number.isFinite(n)) return 300;
    return Math.min(5000, Math.max(200, Math.floor(n)));
})();

/** If this many Reconnecting events fire within the window, disconnect — avoids infinite PC fail / resync loops (e.g. ERR_NETWORK_CHANGED). */
const LIVEKIT_RECONNECT_STORM_MAX = (() => {
    const n = Number(import.meta.env?.VITE_LIVEKIT_RECONNECT_STORM_MAX ?? '8');
    if (!Number.isFinite(n)) return 8;
    return Math.min(25, Math.max(4, Math.floor(n)));
})();
const LIVEKIT_RECONNECT_STORM_WINDOW_MS = (() => {
    const n = Number(import.meta.env?.VITE_LIVEKIT_RECONNECT_STORM_WINDOW_MS ?? '40000');
    if (!Number.isFinite(n)) return 40000;
    return Math.min(120000, Math.max(15000, Math.floor(n)));
})();

/** Detach avatar sinks only if signal reconnect lasts this long (avoids flash on transient Reconnecting). */
const LIVEKIT_RECONNECTING_HARD_RESET_MS = (() => {
    const n = Number(import.meta.env?.VITE_LIVEKIT_RECONNECTING_HARD_RESET_MS ?? '750');
    if (!Number.isFinite(n)) return 750;
    return Math.min(5000, Math.max(0, Math.floor(n)));
})();

/**
 * عد تنازلي بصري فقط على الواجهة (لا يؤثر على الوكيل/الأجنت).
 * الافتراضي 30→0؛ الإخفاء فور `avatarVideoSurfaceReady` (track.attach) إن وصل الفيديو قبل انتهاء العد.
 * عطّل العدّ واعرض سبينر فقط: VITE_PREPARATION_COUNTDOWN_SECONDS=0
 */
const PREPARATION_COUNTDOWN_SECONDS = (() => {
    const raw = import.meta.env?.VITE_PREPARATION_COUNTDOWN_SECONDS;
    const n =
        raw === undefined || String(raw).trim() === ''
            ? 30
            : Number(raw);
    if (!Number.isFinite(n) || n < 0) return 30;
    return Math.min(120, Math.floor(n));
})();

/** إن بقي الغطاء بدون فيديو أفاتار — إخفاء احتياطي (لا يرتبط بمدة عد تنازلي) */
const AVATAR_LOADING_MAX_WAIT_MS = (() => {
    const n = Number(import.meta.env?.VITE_AVATAR_LOADING_MAX_WAIT_MS ?? '45000');
    if (!Number.isFinite(n)) return 45000;
    return Math.min(120000, Math.max(15000, Math.floor(n)));
})();

const API_BASE = API_BASE_URL;
const WS_BASE = API_BASE.replace(/^http/, 'ws');

const VideoInterviewCall = () => {
    const [searchParams] = useSearchParams();
    const { t, currentLang, changeLanguage } = useLanguage();
    const candidateId = searchParams.get('candidateId');
    const campaignId = searchParams.get('campaignId');
    const applicationIdFromUrl = searchParams.get('applicationId');
    /** Transcript panel: localhost QA only — hidden on production (desktop + mobile). */
    const showTranscriptPanel = useMemo(() => isLocalHostDebug(), []);

    const [prepDone, setPrepDone] = useState(false);

    const [isReady, setIsReady] = useState(true); // ✅ يظهر زر "Start Video Interview" مباشرة
    const [preparationTime, setPreparationTime] = useState(() =>
        PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0
    );
    /** غطاء «جاري التحميل» من Start حتى جاهزية فيديو الأفاتار (أو مهلة قصوى) — بدون انتظار عد تنازلي إجباري */
    const [countdownActive, setCountdownActive] = useState(false);
    /** فيديو الأفاتار مربوط بعنصر الفيديو بنجاح (track.attach) */
    const [avatarVideoSurfaceReady, setAvatarVideoSurfaceReady] = useState(false);
    const [isInterviewActive, setIsInterviewActive] = useState(false);
    /** يتأخر ظهور زر الإنهاء قليلاً لتفادي نفس نقرة Start → End بالخطأ (مئات المللي ثانية فقط) */
    const [endInterviewButtonEnabled, setEndInterviewButtonEnabled] = useState(false);
    /** أثناء تنفيذ endInterview — تعطيل الزر ومنع نقرة ثانية تعتقد أن الأولى لم تعمل */
    const [isEndingInterview, setIsEndingInterview] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    /**
     * يحفظ sessionId الراجع من /prepare (قبل ضغط ابدأ) ليُستخدم في تنظيف الغرفة عند
     * إغلاق التبويب/المتصفح عبر sendBeacon → /end (يحذف الغرفة من LiveKit Cloud
     * ويلغي أي dispatch معلَّق). إن ضغط المستخدم "ابدأ" لاحقاً يبقى sessionId هو نفسه.
     */
    const prewarmSessionIdRef = useRef(null);
    const [conversationHistory, setConversationHistory] = useState([]);
    /** نسخة محدّثة دائماً من conversationHistory لقراءتها داخل endInterview/pagehide (تتجنّب closure قديمة) */
    const conversationHistoryRef = useRef([]);
    /** نص مباشر من ردّ المساعد أثناء توليد الـ LLM/TTS (partials) — فقاعة واحدة تتحدّث */
    const [assistantLiveCaption, setAssistantLiveCaption] = useState('');
    /** نص STT للمستخدم أثناء الكلام — فقاعة واحدة تتحدّث؛ تُرفع للتاريخ فقط عند النهائي (توقف الكلام) */
    const [userLiveCaption, setUserLiveCaption] = useState('');
    // ⚠️ CRITICAL: تتبع آخر partial transcript لكل role لمنع التكرار
    const lastPartialTranscriptRef = useRef({ user: null, assistant: null });
    /** آخر وقت استلمنا فيه final للمستخدم — لدمج مقاطع STT المتتالية في رسالة واحدة */
    const lastUserFinalAtRef = useRef(0);
    /** آخر وقت لنهائي ترانسكريبت المساعد — لدمج نهائيين متتابعين لنفس ردّ الوكيل */
    const lastAssistantFinalAtRef = useRef(0);
    // ✅ FIX: تتبع حالة الأيجنت لمنع معالجة Transcript أثناء حديث الأيجنت
    const isAgentSpeakingRef = useRef(false);
    /** يطابق الميكروفون/المؤشر مع انتهاء صوت الأفاتار؛ يتأخر lk.agent.state أحياناً عن السماعة. */
    const [uiAgentState, setUiAgentState] = useState(null);
    const latestRawAgentStateRef = useRef(null);
    const effectiveAgentStateForUiRef = useRef(null);
    const avatarHeardDuringSpeakingRef = useRef(false);
    const agentUiAudioIdleTimerRef = useRef(null);
    // ✅ ANTI-NOISE GATE: تتبع وقت و duration للـ transcripts لتجاهل الضوضاء القصيرة
    const userTranscriptTimingRef = useRef({ startTime: null, lastTime: null, duration: 0 });
    // ✅ FIX: منع النقر المزدوج على Start (يسبب إنشاء غرفتين وأفاتار غير مستقر)
    const isStartingRef = useRef(false);
    /** يزيد عند كل startInterview وعند endInterview — يلغي أي start غير متزامن بعد الإنهاء (غرفة LiveKit ثانية) */
    const sessionEpochRef = useRef(0);
    // ✅ FIX: Ref للـ messages container للـ auto-scroll
    const messagesContainerRef = useRef(null);
    
    // نُبقي الـ ref مزامناً مع آخر حالة للترانسكريبت (يُقرأ في endInterview/pagehide)
    useEffect(() => {
        conversationHistoryRef.current = conversationHistory;
    }, [conversationHistory]);

    // ✅ FIX: Auto-scroll للرسائل الجديدة
    useEffect(() => {
        if (
            messagesContainerRef.current &&
            (conversationHistory.length > 0 || assistantLiveCaption || userLiveCaption)
        ) {
            // Scroll إلى الأسفل عند إضافة رسالة جديدة
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [conversationHistory, assistantLiveCaption, userLiveCaption]);
    
    // LiveKit state
    const [livekitRoom, setLivekitRoom] = useState(null);
    const [livekitRoomName, setLivekitRoomName] = useState(null);
    const [livekitToken, setLivekitToken] = useState(null);
    const [livekitUrl, setLivekitUrl] = useState(null);
    const [connectionError, setConnectionError] = useState(null);
    
    // للاختبار: السماح بإدخال candidateId يدوياً
    // Candidate ID وهمي للاختبار (يمكن تغييره)
    const TEST_CANDIDATE_ID = '507f1f77bcf86cd799439011'; // ID وهمي للاختبار
    const [manualCandidateId, setManualCandidateId] = useState(TEST_CANDIDATE_ID);
    const [showCandidateInput, setShowCandidateInput] = useState(false);
    
    // استخدام candidateId من URL أو من الإدخال اليدوي أو الوهمي
    const urlOrManualId = candidateId || manualCandidateId;
    const [resolvedPersonId, setResolvedPersonId] = useState(urlOrManualId);
    const [resolvedApplicationId, setResolvedApplicationId] = useState(applicationIdFromUrl);
    const effectiveCandidateId = resolvedPersonId || urlOrManualId;

    const [candidate, setCandidate] = useState(null);
    const [loadingCandidate, setLoadingCandidate] = useState(!!urlOrManualId);
    const [candidateError, setCandidateError] = useState(null);
    const [videoLinkBlocked, setVideoLinkBlocked] = useState(false);

    useEffect(() => {
        if (!urlOrManualId) {
            setCandidate(null);
            setLoadingCandidate(false);
            setCandidateError(null);
            return;
        }
        let cancelled = false;
        setLoadingCandidate(true);
        setCandidateError(null);
        fetch(`${API_BASE}/api/candidates/${urlOrManualId}`)
            .then((res) => {
                if (!res.ok) throw new Error('Candidate not found');
                return res.json();
            })
            .then((result) => {
                if (!cancelled && result?.data) {
                    const row = result.data;
                    setCandidate(row);
                    const personId = row.candidateId
                        ? String(row.candidateId)
                        : String(row._id || urlOrManualId);
                    setResolvedPersonId(personId);
                    if (row.applicationId) setResolvedApplicationId(String(row.applicationId));
                    else if (applicationIdFromUrl) setResolvedApplicationId(applicationIdFromUrl);
                    if (isVideoInterviewLinkConsumed(row)) {
                        setVideoLinkBlocked(true);
                    }
                }
            })
            .catch((err) => {
                if (!cancelled) setCandidateError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoadingCandidate(false);
            });
        return () => {
            cancelled = true;
        };
    }, [urlOrManualId, applicationIdFromUrl]);

    /**
     * Pre-warm: ينشئ غرفة LiveKit + dispatch الوكيل + Beyond مبكرًا فور توفر candidateId،
     * قبل أن يضغط المستخدم "ابدأ". /start سيعيد استخدام نفس الغرفة عبر activeCandidateSessions
     * فلا تُنشأ غرفة ثانية ولا يُكرَّر dispatch. عطّله بـ VITE_DISABLE_VIDEO_PREPARE=1.
     */
    useEffect(() => {
        if (!effectiveCandidateId) return;
        if (import.meta.env.VITE_DISABLE_VIDEO_PREPARE === '1') return;
        const controller = new AbortController();
        const t = setTimeout(() => {
            fetch(`${API_BASE}/api/video-interview/prepare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: effectiveCandidateId,
                    campaignId: campaignId || undefined,
                    applicationId: resolvedApplicationId || undefined,
                }),
                signal: controller.signal
            })
                .then(async (res) => {
                    if (res.status === 409) {
                        const data = await res.json().catch(() => ({}));
                        if (data?.code === INTERVIEW_LINK_ALREADY_USED) {
                            setVideoLinkBlocked(true);
                        }
                        return null;
                    }
                    return res.ok ? res.json() : null;
                })
                .then((data) => {
                    if (data?.success) {
                        if (data.sessionId) {
                            prewarmSessionIdRef.current = data.sessionId;
                        }
                        devLog('✅ Video interview prewarm:', {
                            sessionId: data.sessionId,
                            reused: data.reused
                        });
                    }
                })
                .catch((err) => {
                    if (err?.name !== 'AbortError') {
                        devLog('Prewarm skipped:', err?.message || err);
                    }
                });
        }, 250);
        return () => {
            clearTimeout(t);
            controller.abort();
        };
    }, [effectiveCandidateId, campaignId, resolvedApplicationId]);

    /**
     * تنظيف عند إغلاق التبويب/المتصفح: يستدعي /end عبر sendBeacon لحذف الغرفة من LiveKit
     * Cloud وإلغاء أي dispatch معلَّق، حتى لا يستلم وركر لاحق dispatch قديم لجلسة منتهية.
     * pagehide أكثر موثوقية من beforeunload مع sendBeacon (راجع MDN). نُفضّل sessionId الفعلي
     * لو بدأ المستخدم المقابلة، وإلا نستخدم sessionId الراجع من /prepare.
     */
    useEffect(() => {
        const handlePageHide = () => {
            const sid = sessionId || prewarmSessionIdRef.current;
            if (!sid) return;
            try {
                const blob = new Blob(
                    [JSON.stringify({
                        sessionId: sid,
                        conversationHistory: serializeTranscript(conversationHistoryRef.current)
                    })],
                    { type: 'application/json' }
                );
                navigator.sendBeacon(`${API_BASE}/api/video-interview/end`, blob);
            } catch (_e) {
                // ignore - browser closing anyway
            }
        };
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('beforeunload', handlePageHide);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('beforeunload', handlePageHide);
        };
    }, [sessionId]);

    const displayName = candidate
        ? ((candidate.full_name || candidate.fullName) || '').trim() ||
          candidate.email?.split('@')[0] ||
          t('publicScreening_candidate')
        : t('publicScreening_candidate');
    const displayPosition = candidate?.position_applied_for || candidate?.positionAppliedFor || t('videoInterview_positionFallback');

    useEffect(() => {
        const fromUrl = parseInterviewUrlLanguage(searchParams.get('language'));
        if (fromUrl && fromUrl !== currentLang) {
            changeLanguage(fromUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const isRtl = currentLang === 'ar' || currentLang === 'ku';
    const candidateSubtitle =
        loadingCandidate
            ? t('videoInterview_call_loadingCandidate')
            : candidateError
              ? t('videoInterview_candidateUnavailable')
              : `${displayName} - ${displayPosition}`;
    
    // Hooks
    const { playSound, triggerHaptic } = useSoundEffects();
    const { 
        token: warmToken, 
        tokenUrl: warmTokenUrl, 
        fetchToken: fetchWarmToken,
        isLoading: isTokenLoading 
    } = useLiveKitToken(effectiveCandidateId, sessionId);
    const { 
        agentState, 
        customState, 
        sendState, 
        callRPC 
    } = useLiveKitState(livekitRoom);

    /**
     * يتبع lk.agent.state من وكيل الجلسة (انتهاء جولة الرد). لا نربط العرض بـ ActiveSpeakers أو بتوقف حركة الأفاتار.
     */
    const effectiveAgentStateForUi = useMemo(() => {
        if (agentState == null && uiAgentState == null) return null;
        if (agentState === 'thinking') return 'thinking';
        if (agentState === 'speaking') {
            // fast UI fallback: once avatar audio is done, do not keep speaking while lk.agent.state lags.
            if (uiAgentState === 'listening') return 'listening';
            return 'speaking';
        }
        return uiAgentState ?? agentState;
    }, [agentState, uiAgentState]);

    useEffect(() => {
        effectiveAgentStateForUiRef.current = effectiveAgentStateForUi;
    }, [effectiveAgentStateForUi]);
    
    // Refs للميكروفون والفيديو
    const userVideoRef = useRef(null);
    const [avatarContainerElement, setAvatarContainerElement] = useState(null); // container للـ avatar video (من Backend WebSocket)
    const avatarVideoRef = useRef(null); // Keep ref for backward compatibility
    // ✅ CRITICAL FIX: audioRef يستخدم فقط لـ LiveKit audio tracks (bey-avatar-agent)
    // ❌ لا تستخدم audioRef.current.src أو audioRef.current.play() - يسبب صدى فتاك
    // ❌ لا تشغّل أي audio من Backend - الصوت يأتي من LiveKit فقط
    const audioRef = useRef(null);
    const mediaStreamRef = useRef(null);
    // ✅ FIX: حفظ micTrack reference لتعطيل/تفعيل الميكروفون عند كلام الـ Agent
    const micTrackRef = useRef(null);
    /** تأخير إعادة الميكروفون بعد speaking — يمنع echo→STT→رد الوكيل بالتسلسل */
    const avatarMicUnmuteTimerRef = useRef(null);
    const prevAgentStateForMicRef = useRef(null);
    const latestAgentStateForMicRef = useRef(null);
    const avatarAudioActiveRef = useRef(false);
    // ✅ PRODUCTION FIX: React timing fix - pending video track state
    const [pendingVideoTrack, setPendingVideoTrack] = useState(null);
    /** يُزامَن مع pendingVideoTrack عند تأخر جاهزية الحاوية؛ بدون RemoteVideoPublication لا يُطبَّق setVideoDimensions/الجودة. */
    const pendingAvatarVideoPublicationRef = useRef(null);
    // ✅ PRODUCTION FIX: منع duplicate audio playback - تتبع audio tracks المرفقة
    const attachedAudioTracksRef = useRef(new Set()); // Set of track SIDs that are already attached
    // ✅ FIX: منع إعادة ربط video track (يسبب وميض/انهيار الأفاتار)
    const videoTrackAttachedRef = useRef(false);
    /** عنصر <video> واحد ثابت لبث الأفاتار من LiveKit (لا ننشئ عنصراً جديداً كل اشتراك) */
    const avatarLivekitVideoRef = useRef(null);
    /** آخر trackSid مرفوع على عنصر الأفاتار — يمنع attach مكرر لنفس المسار */
    const attachedAvatarVideoTrackSidRef = useRef(null);
    /** Debounce detach on avatar video unsubscribe (avoids post-reply choppiness from transient SDK events). */
    const avatarVideoUnsubDebounceRef = useRef(null);
    /** Debounce avatar track resync after RoomEvent.Reconnected (reduces detach/subscribe thrash when PC flaps). */
    const livekitReconnectedSyncTimerRef = useRef(null);
    /** Delayed hard detach during Reconnecting — cancelled if Reconnected quickly (smoother avatar). */
    const reconnectingHardResetTimerRef = useRef(null);
    /** Remote video publication — re-request HIGH when agent speaks (adaptive stream can drop layer). */
    const avatarVideoPublicationRef = useRef(null);
    /** يقلّل استدعاءات setVideoQuality المتكررة (كانت تسبب طبقات SFU ومزيد عدم ثبات مرئي). */
    const prevAgentStateForVideoQualityRef = useRef(null);
    // Legacy WebSocket refs (للـ video فقط - سيتم إزالتها لاحقاً)
    const videoWebSocketRef = useRef(null);
    // ✅ FIX: WebSocket لإرسال الصوت إلى Backend (STT)
    const audioWebSocketRef = useRef(null);
    const audioContextRef = useRef(null);
    const audioProcessorRef = useRef(null);
    const clonedAudioTrackRef = useRef(null); // لتخزين cloned audio track للتنظيف
    
    // LiveKit refs
    const livekitRoomRef = useRef(null);
    const isInterviewActiveRef = useRef(false);
    const livekitConnectedRef = useRef(false);
    /** يمنع إنهاء المقابلة فوراً بعد Start (نفس النقرة تُبدّل الزر فيُفعّل End بالخطأ) */
    const interviewStartedAtRef = useRef(null);
    /** بعد بدء المقابلة: فترة قصيرة قبل السماح بإنهاء من الزر (تفادي ghost click؛ ليس ثوانٍ) */
    const MIN_MS_BEFORE_END_BUTTON = 600;
    /** يمنع استدعاء endInterview مرتين (نقرة مزدوجة، تركيز، أو تسلسل أحداث) */
    const isEndingInterviewRef = useRef(false);

    useEffect(() => {
        latestRawAgentStateRef.current = agentState;
        if (agentState !== 'speaking') {
            avatarHeardDuringSpeakingRef.current = false;
            if (agentUiAudioIdleTimerRef.current != null) {
                clearTimeout(agentUiAudioIdleTimerRef.current);
                agentUiAudioIdleTimerRef.current = null;
            }
            setUiAgentState(agentState);
            return;
        }
        avatarHeardDuringSpeakingRef.current = false;
        if (agentUiAudioIdleTimerRef.current != null) {
            clearTimeout(agentUiAudioIdleTimerRef.current);
            agentUiAudioIdleTimerRef.current = null;
        }
        setUiAgentState('speaking');
    }, [agentState]);

    const canEnableMicNow = useCallback(() => {
        const state = latestAgentStateForMicRef.current;
        if (state === 'speaking') return false;
        if (AVATAR_MIC_MUTE_WHILE_THINKING && state === 'thinking') return false;
        // Guard against late playback_finished / clear_buffer races: do not unmute while avatar audio is still active.
        if (avatarAudioActiveRef.current) return false;
        return true;
    }, []);

    /** Same delay path as agentState effect — avoids opening mic on ActiveSpeakers clear before audio tail ends. */
    const scheduleMicUnmuteAfterAvatarOrAgent = useCallback(() => {
        if (!isInterviewActiveRef.current) return;
        if (avatarMicUnmuteTimerRef.current != null) {
            clearTimeout(avatarMicUnmuteTimerRef.current);
            avatarMicUnmuteTimerRef.current = null;
        }
        avatarMicUnmuteTimerRef.current = window.setTimeout(() => {
            if (!canEnableMicNow()) {
                avatarMicUnmuteTimerRef.current = window.setTimeout(() => {
                    avatarMicUnmuteTimerRef.current = null;
                    if (canEnableMicNow() && micTrackRef.current) {
                        micTrackRef.current.enabled = true;
                    }
                }, 120);
                return;
            }
            avatarMicUnmuteTimerRef.current = null;
            if (micTrackRef.current) micTrackRef.current.enabled = true;
        }, AVATAR_MIC_UNMUTE_DELAY_MS);
    }, [canEnableMicNow]);

    const ensureAvatarLivekitVideoElement = useCallback((container) => {
        if (!container) return null;
        let el = avatarLivekitVideoRef.current;
        if (el && container.contains(el)) {
            return el;
        }
        if (el && el.parentNode) {
            try {
                container.appendChild(el);
                return el;
            } catch (_) {
                /* ignore */
            }
        }
        if (el && typeof document !== 'undefined' && !document.contains(el)) {
            avatarLivekitVideoRef.current = null;
        }
        el = document.createElement('video');
        el.autoplay = true;
        el.playsInline = true;
        el.preload = 'auto';
        // Audio comes from audioRef (bey-avatar-agent track). Unmuted <video> can double-decode / fight playback → choppy lip-sync.
        el.muted = true;
        el.disablePictureInPicture = true;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.zIndex = '10';
        // High-motion avatar: auto avoids some browsers over-sharpening; crisp-edges can look harsher on H.264
        el.style.imageRendering = 'auto';
        try {
            el.disableRemotePlayback = true;
        } catch (_) {
            /* ignore */
        }
        container.appendChild(el);
        avatarLivekitVideoRef.current = el;
        devLog('✅ Avatar LiveKit: single <video> ensured (stable, no duplicate createElement per track)');
        return el;
    }, []);

    const attachAvatarLivekitVideoTrack = useCallback(
        (track, publication, source = 'attach') => {
            if (!track || track.kind !== Track.Kind.Video) return false;
            const container = avatarContainerElement || avatarVideoRef.current;
            if (!container) return false;
            const trackSid = publication?.trackSid || track.sid;
            if (
                attachedAvatarVideoTrackSidRef.current === trackSid &&
                videoTrackAttachedRef.current
            ) {
                const el = avatarLivekitVideoRef.current;
                const attached = track.attachedElements;
                if (el && Array.isArray(attached) && attached.includes(el)) {
                    setAvatarVideoSurfaceReady(true);
                    devLog(`⏭️ Avatar video already attached [${source}]:`, trackSid);
                    return true;
                }
            }
            const videoElement = ensureAvatarLivekitVideoElement(container);
            if (!videoElement) return false;
            try {
                // يجب استخدام track.attach() — تعيين srcObject يدوياً يعطل AdaptiveStream وقد يُظهر إطاراً ثابتاً
                track.attach(videoElement);
                videoElement.muted = true;
                void videoElement.play().catch(() => {
                    /* autoplay policies / race with attach; non-fatal */
                });
                if (publication) {
                    if (typeof publication.setVideoQuality === 'function') {
                        avatarVideoPublicationRef.current = publication;
                    }
                    ensureAvatarVideoSubscriptionQuality(publication);
                }
                attachedAvatarVideoTrackSidRef.current = trackSid;
                videoTrackAttachedRef.current = true;
                setAvatarVideoSurfaceReady(true);
                devLog(`✅ Avatar video attached (LiveKit) [${source}]:`, trackSid);
                return true;
            } catch (e) {
                console.error(`❌ Avatar video attach failed [${source}]:`, e);
                return false;
            }
        },
        [avatarContainerElement, ensureAvatarLivekitVideoElement]
    );

    /** Stable callback: one ref + state — avoids duplicate setState in ref callbacks; keeps avatar DOM isolated in AvatarHostContainer */
    const onAvatarHostContainerNode = useCallback((el) => {
        avatarVideoRef.current = el;
        setAvatarContainerElement(el);
    }, []);

    // ⚠️ CRITICAL: تحديث refs عند تغيير state
    useEffect(() => {
        isInterviewActiveRef.current = isInterviewActive;
    }, [isInterviewActive]);

    useEffect(() => {
        if (!isInterviewActive) {
            setEndInterviewButtonEnabled(false);
            return;
        }
        setEndInterviewButtonEnabled(false);
        const delayMs = MIN_MS_BEFORE_END_BUTTON;
        const t = window.setTimeout(() => setEndInterviewButtonEnabled(true), delayMs);
        return () => window.clearTimeout(t);
    }, [isInterviewActive]);
    
    useEffect(() => {
        livekitConnectedRef.current = isConnected;
    }, [isConnected]);
    
    // عد تنازلي اختياري فقط عند PREPARATION_COUNTDOWN_SECONDS > 0
    useEffect(() => {
        if (PREPARATION_COUNTDOWN_SECONDS <= 0 || !countdownActive || preparationTime <= 0) return;
            const timer = setTimeout(() => {
            setPreparationTime((prev) => (prev <= 1 ? 0 : prev - 1));
            }, 1000);
            return () => clearTimeout(timer);
    }, [countdownActive, preparationTime]);

    useEffect(() => {
        if (!countdownActive) return;
        if (avatarVideoSurfaceReady) {
            setCountdownActive(false);
        }
    }, [countdownActive, avatarVideoSurfaceReady]);

    /** من لحظة ظهور الغطاء: إن لم يُربَط فيديو الأفاتار، إخفاء احتياطي (لم يعد ينتظر انتهاء عدّ 15 ث) */
    useEffect(() => {
        if (!countdownActive || avatarVideoSurfaceReady) return;
        const t = window.setTimeout(() => {
            devLog('⚠️ Avatar loading overlay: max wait elapsed without video attach — dismissing');
            setCountdownActive(false);
        }, AVATAR_LOADING_MAX_WAIT_MS);
        return () => window.clearTimeout(t);
    }, [countdownActive, avatarVideoSurfaceReady]);

    // الاتصال بـ LiveKit Room
    // Deps عمداً ثابتة (اسم الغرفة، التوكن، الرابط، نشاط المقابلة) — لا تربط mediaStream هنا لتجنب unmount/remount للغرفة عند تغيير الميكروفون
    useEffect(() => {
        if (!isInterviewActive || !livekitRoomName || !livekitToken || !livekitUrl || !mediaStreamRef.current) {
            return;
        }

        let room = null;

        const connectToLiveKit = async () => {
            try {
                devLog('🔌 Connecting to LiveKit Room...', {
                    roomName: livekitRoomName,
                    url: livekitUrl
                });

                // RoomOptions — مواءمة مع وثائق LiveKit: adaptiveStream يعتمد attach() + (عند التفعيل) pixelDensity؛ dynacast اختياري لجلسات كبيرة / SVC.
                // https://docs.livekit.io/transport/media/subscribe/#adaptive-stream
                // disconnectOnPageLeave: false — SPA؛ إنهاء المقابلة يدوياً.
                room = new Room({
                    adaptiveStream: livekitAdaptiveStreamRoomOption(),
                    dynacast: LIVEKIT_DYNACAST,
                    disconnectOnPageLeave: false,
                    ...(LIVEKIT_SINGLE_PEER_CONNECTION ? { singlePeerConnection: true } : {}),
                });
                livekitRoomRef.current = room;

                /** Pre-warm DNS/TLS and (LiveKit Cloud) pick best edge — cuts region-hopping / pc failures. */
                const prepareLiveKitConnection = async (url, token) => {
                    for (let prepAttempt = 0; prepAttempt < 2; prepAttempt++) {
                        try {
                            await room.prepareConnection(url, token);
                            return;
                        } catch (prepErr) {
                            const msg = String(prepErr?.message || prepErr || '');
                            const retriable =
                                prepAttempt === 0 &&
                                (/network|changed|failed|abort/i.test(msg) ||
                                    prepErr?.name === 'ConnectionError');
                            if (retriable) {
                                devLog('LiveKit prepareConnection retry after brief delay (network flap)...');
                                await new Promise((r) => setTimeout(r, 900));
                                continue;
                            }
                            console.warn('LiveKit prepareConnection skipped:', prepErr?.message || prepErr);
                            return;
                        }
                    }
                };

                let reconnectStormWindowStart = 0;
                let reconnectStormCount = 0;

                // Align with LiveKit Cloud / regional latency: ICE can exceed 25s on constrained networks.
                const liveKitConnectResilience = {
                    peerConnectionTimeout: 45000,
                    websocketTimeout: 30000,
                    maxRetries: 6,
                };

                const clearAvatarAudioSink = () => {
                    if (!audioRef.current) return;
                    try {
                        audioRef.current.pause();
                    } catch (_) {}
                    try {
                        audioRef.current.srcObject = null;
                    } catch (_) {}
                    try {
                        audioRef.current.src = '';
                    } catch (_) {}
                };

                const attachAvatarAudioTrack = (track, publication, participant) => {
                    if (!track || track.kind !== Track.Kind.Audio) return;
                    if (participant?.isLocal) return;
                    if (!isAvatarWorkerParticipant(participant)) return;

                    const trackSid = publication?.trackSid || track.sid;
                    if (attachedAudioTracksRef.current.has(trackSid)) return;

                    clearAvatarAudioSink();
                    if (audioRef.current) {
                        audioRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
                        audioRef.current.setAttribute('playsinline', 'true');
                        audioRef.current.setAttribute('autoplay', 'true');
                        audioRef.current.setAttribute('muted', 'false');
                        audioRef.current.muted = false;
                        audioRef.current.play().catch((err) => {
                            console.warn('⚠️ Audio play() blocked:', err?.message || err);
                        });
                        attachedAudioTracksRef.current.add(trackSid);
                        devLog(`✅ Avatar audio → audioRef: ${trackSid} from ${participant.identity}`);
                    }
                };

                const syncAvatarTracksFromRemoteParticipants = async (reason = 'manual-sync', options = {}) => {
                    const mode = options.mode === 'soft' ? 'soft' : 'full';

                    devLog(`🔄 Syncing avatar tracks (${reason}) mode=${mode}...`, {
                        remoteParticipants: room.remoteParticipants.size,
                        roomName: room.name,
                    });

                    if (mode === 'soft' && room.state === 'connected' && videoTrackAttachedRef.current) {
                        const sid = attachedAvatarVideoTrackSidRef.current;
                        if (sid) {
                            for (const participant of room.remoteParticipants.values()) {
                                if (!isAvatarParticipant(participant)) continue;
                                for (const publication of participant.videoTrackPublications.values()) {
                                    if (publication.trackSid !== sid || !publication.track || !publication.isSubscribed) {
                                        continue;
                                    }
                                    const t = publication.track;
                                    const el = avatarLivekitVideoRef.current;
                                    const att = t.attachedElements;
                                    if (el && Array.isArray(att) && att.includes(el)) {
                                        ensureAvatarVideoSubscriptionQuality(publication);
                                        if (typeof publication.setVideoQuality === 'function') {
                                            avatarVideoPublicationRef.current = publication;
                                        }
                                        setAvatarVideoSurfaceReady(true);
                                        for (const p of room.remoteParticipants.values()) {
                                            if (!isAvatarWorkerParticipant(p)) continue;
                                            for (const ap of p.audioTrackPublications.values()) {
                                                if (!ap.track) continue;
                                                const aid = ap.trackSid || ap.track.sid;
                                                if (!attachedAudioTracksRef.current.has(aid)) {
                                                    attachAvatarAudioTrack(ap.track, ap, p);
                                                }
                                            }
                                        }
                                        devLog(`✅ Avatar sync soft (no detach): ${reason}`);
                                        return;
                                    }
                                }
                            }
                        }
                        devLog(`⏭️ Avatar sync soft miss → full: ${reason}`);
                    }

                    if (avatarVideoUnsubDebounceRef.current != null) {
                        clearTimeout(avatarVideoUnsubDebounceRef.current);
                        avatarVideoUnsubDebounceRef.current = null;
                    }

                    // Reset local attachment flags so reconnect can re-bind streams.
                    videoTrackAttachedRef.current = false;
                    attachedAvatarVideoTrackSidRef.current = null;
                    avatarVideoPublicationRef.current = null;
                    try {
                        for (const participant of room.remoteParticipants.values()) {
                            if (!isAvatarParticipant(participant)) continue;
                            for (const publication of participant.videoTrackPublications.values()) {
                                if (publication.track) {
                                    try {
                                        publication.track.detach();
                                    } catch (_) {
                                        /* ignore */
                                    }
                                }
                            }
                        }
                    } catch (_) {
                        /* ignore */
                    }
                    if (avatarLivekitVideoRef.current) {
                        try {
                            avatarLivekitVideoRef.current.srcObject = null;
                        } catch (_) {
                            /* ignore */
                        }
                    }
                    pendingAvatarVideoPublicationRef.current = null;
                    setPendingVideoTrack(null);
                    attachedAudioTracksRef.current.clear();
                    clearAvatarAudioSink();

                    for (const participant of room.remoteParticipants.values()) {
                        if (!isAvatarParticipant(participant)) continue;

                        for (const publication of participant.videoTrackPublications.values()) {
                            try {
                                if (!publication.isSubscribed) {
                                    await publication.setSubscribed(true);
                                }
                                ensureAvatarVideoSubscriptionQuality(publication);
                            } catch (videoSubError) {
                                console.warn('⚠️ Failed to subscribe avatar video during sync:', videoSubError);
                            }

                            if (publication.track) {
                                pendingAvatarVideoPublicationRef.current = publication;
                                setPendingVideoTrack(publication.track);
                            }
                        }

                        for (const publication of participant.audioTrackPublications.values()) {
                            try {
                                if (!publication.isSubscribed) {
                                    await publication.setSubscribed(true);
                                }
                            } catch (audioSubError) {
                                console.warn('⚠️ Failed to subscribe avatar audio during sync:', audioSubError);
                            }

                            if (publication.track) {
                                attachAvatarAudioTrack(publication.track, publication, participant);
                            }
                        }
                    }
                };

                // Event handlers
                room.on(RoomEvent.Connected, async () => {
                    devLog('✅✅✅ LiveKit Room Connected Event triggered ✅✅✅');
                    devLog('   📍 Room state:', room.state);
                    devLog('   📍 Room name:', room.name);
                    
                    // ⚠️ CRITICAL: Race Condition Fix - تحديث state فقط عند Connected Event
                    // الآن Room متصل بالفعل - نحدّث state
                    setLivekitRoom(room);
                    livekitRoomRef.current = room;
                    setIsConnected(true);
                    
                    devLog('✅ Connected to LiveKit Room - Room is now ready for use');
                    
                    // ✅ الاعتماد فقط على events - TrackPublished (room-level) يتولى الاشتراك
                    
                    // ⚠️ CRITICAL: نشر tracks فقط بعد Room Connected Event
                    // Race Condition Fix: لا ننشر tracks قبل اكتمال الاتصال
                    if (mediaStreamRef.current) {
                        devLog('📤 Publishing tracks after Room Connected event...');
                        const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
                        const videoTrack = mediaStreamRef.current.getVideoTracks()[0];

                        // ✅ PROFESSIONAL: نشر الصوت إلى LiveKit حسب LiveKit Best Practices
                        // بناءً على: https://docs.livekit.io/reference/client-sdk-js/interfaces/trackpublishoptions.html
                        // ✅ CRITICAL: منع loopback - لا نريد أن يسمع المستخدم صوته يرتد
                        if (audioTrack) {
                            try {
                                devLog('='.repeat(60));
                                devLog('📤 FRONTEND: PUBLISHING AUDIO TRACK');
                                devLog('='.repeat(60));
                                devLog('   Room:', room.name);
                                devLog('   Track ID:', audioTrack.id);
                                devLog('   Track enabled:', audioTrack.enabled);
                                devLog('   Track muted:', audioTrack.muted);
                                devLog('='.repeat(60));
                                
                                // ✅ PROFESSIONAL: Check if track is already published (prevent duplicate publish)
                                const existingAudioPub = Array.from(room.localParticipant.audioTrackPublications.values())
                                    .find(pub => pub.track === audioTrack);
                                
                                if (existingAudioPub) {
                                    devLog('ℹ️ Audio track already published - skipping duplicate publish');
                                } else {
                                // ✅ CRITICAL FIX: إعادة تطبيق echo cancellation constraints قبل النشر
                                // هذا يضمن أن echo cancellation يعمل حتى لو لم يتم تطبيقه في getUserMedia
                                try {
                                    await audioTrack.applyConstraints({
                                        echoCancellation: true,
                                        noiseSuppression: true,
                                        autoGainControl: false,
                                    });
                                    devLog('✅ Re-applied echo cancellation constraints before publishing');
                                } catch (constraintError) {
                                    console.warn('⚠️ Failed to re-apply constraints (non-critical):', constraintError);
                                }
                                
                                // ✅ PROFESSIONAL: Publish track with proper options
                                // LiveKit Best Practice: Avoid rapid publish/unpublish calls
                                devLog('🔄 Publishing audio track to LiveKit...');
                                await room.localParticipant.publishTrack(audioTrack, {
                                    source: Track.Source.Microphone,
                                    // ✅ CRITICAL: لا loopback - الصوت يذهب فقط إلى Agent
                                    // LiveKit automatically handles echo cancellation on server side
                                });
                                
                                // ✅ CRITICAL FIX: التحقق النهائي من echo cancellation بعد النشر
                                const finalSettings = audioTrack.getSettings();
                                devLog('='.repeat(60));
                                devLog('✅ FRONTEND: AUDIO TRACK PUBLISHED SUCCESSFULLY');
                                devLog('='.repeat(60));
                                devLog('   Track published to room:', room.name);
                                devLog('   Agent should now be able to receive audio');
                                devLog('   Echo cancellation:', finalSettings.echoCancellation);
                                devLog('   Noise suppression:', finalSettings.noiseSuppression);
                                devLog('='.repeat(60));
                                devLog('   ✅ Echo cancellation:', finalSettings.echoCancellation ? 'ENABLED ✅' : 'DISABLED ❌');
                                devLog('   ✅ Noise suppression:', finalSettings.noiseSuppression ? 'ENABLED ✅' : 'DISABLED ❌');
                                devLog('   ✅ Auto gain control:', finalSettings.autoGainControl ? 'ENABLED ⚠️' : 'DISABLED ✅');
                                
                                if (!finalSettings.echoCancellation) {
                                    console.error('❌ CRITICAL: Echo cancellation is STILL disabled after all attempts!');
                                    console.error('   ⚠️ This WILL cause echo when connecting from Backend!');
                                    console.error('   💡 Solution: Use headphones to prevent echo completely');
                                }
                                
                                devLog('   ✅ User voice goes to Agent ONLY - no local playback');
                                }
                            } catch (audioError) {
                                console.error('❌ Error publishing audio track:', audioError);
                                // ✅ PROFESSIONAL: Log detailed error for debugging
                                if (audioError.message) {
                                    console.error('   Error details:', audioError.message);
                                }
                            }
                        }

                        if (videoTrack) {
                            try {
                                await room.localParticipant.publishTrack(videoTrack, {
                                    source: Track.Source.Camera,
                                });
                                devLog('✅ Published video track to LiveKit (after Connected event)');
                            } catch (videoError) {
                                console.error('❌ Error publishing video track:', videoError);
                            }
                        }
                    } else {
                        console.warn('⚠️ No mediaStream available when Room Connected - tracks cannot be published');
                    }
                });

                // ✅ STEP 4: Logging - session closed = INFO (ليس ERROR)
                room.on(RoomEvent.Disconnected, (reason) => {
                    devLog('ℹ️ Room disconnected (INFO):', {
                        reason: reason || 'unknown',
                        roomState: room.state,
                        roomName: room.name
                    });
                    
                    // ✅ STEP 3: Interview Lifecycle - لا endInterview() هنا
                    // Room Disconnected = INFO - هذا جزء من lifecycle الطبيعي
                    // endInterview() فقط عند user action أو explicit server signal
                    
                    setIsConnected(false);
                    devLog('ℹ️ Room disconnected (INFO) - Agent session closed normally');
                });

                room.on(RoomEvent.Reconnecting, () => {
                    const now = Date.now();
                    if (now - reconnectStormWindowStart > LIVEKIT_RECONNECT_STORM_WINDOW_MS) {
                        reconnectStormWindowStart = now;
                        reconnectStormCount = 0;
                    }
                    reconnectStormCount += 1;
                    if (reconnectStormCount >= LIVEKIT_RECONNECT_STORM_MAX) {
                        console.error(
                            `LiveKit: reconnect storm (${reconnectStormCount} within ~${LIVEKIT_RECONNECT_STORM_WINDOW_MS}ms) — disconnecting (unstable network / ERR_NETWORK_CHANGED)`
                        );
                        reconnectStormCount = 0;
                        reconnectStormWindowStart = 0;
                        if (livekitReconnectedSyncTimerRef.current != null) {
                            clearTimeout(livekitReconnectedSyncTimerRef.current);
                            livekitReconnectedSyncTimerRef.current = null;
                        }
                        try {
                            room.disconnect();
                        } catch (_) {
                            /* ignore */
                        }
                        setConnectionError(
                            'تغيّر الاتصال أو الشبكة غير مستقرة. ثبّت Wi‑Fi أو استخدم كابل إنترنت، ثم ابدأ المقابلة من جديد.'
                        );
                        setIsConnected(false);
                        return;
                    }

                    devLog('LiveKit reconnecting — waiting before hard avatar reset (transient = smoother)');
                    setIsConnected(false);
                    if (reconnectingHardResetTimerRef.current != null) {
                        clearTimeout(reconnectingHardResetTimerRef.current);
                        reconnectingHardResetTimerRef.current = null;
                    }
                    if (LIVEKIT_RECONNECTING_HARD_RESET_MS <= 0) {
                        return;
                    }
                    reconnectingHardResetTimerRef.current = window.setTimeout(() => {
                        reconnectingHardResetTimerRef.current = null;
                        if (livekitRoomRef.current !== room) return;
                        if (room.state === 'connected') {
                            devLog('Reconnect hard reset skipped — room already connected');
                            return;
                        }
                        console.warn('⚠️ LiveKit reconnect slow — resetting avatar media sinks');
                        if (avatarVideoUnsubDebounceRef.current != null) {
                            clearTimeout(avatarVideoUnsubDebounceRef.current);
                            avatarVideoUnsubDebounceRef.current = null;
                        }
                        videoTrackAttachedRef.current = false;
                        attachedAvatarVideoTrackSidRef.current = null;
                        avatarVideoPublicationRef.current = null;
                        try {
                            for (const participant of room.remoteParticipants.values()) {
                                if (!isAvatarParticipant(participant)) continue;
                                for (const publication of participant.videoTrackPublications.values()) {
                                    if (publication.track) {
                                        try {
                                            publication.track.detach();
                                        } catch (_) {
                                            /* ignore */
                                        }
                                    }
                                }
                            }
                        } catch (_) {
                            /* ignore */
                        }
                        if (avatarLivekitVideoRef.current) {
                            try {
                                avatarLivekitVideoRef.current.srcObject = null;
                            } catch (_) {
                                /* ignore */
                            }
                        }
                        pendingAvatarVideoPublicationRef.current = null;
                        setPendingVideoTrack(null);
                        attachedAudioTracksRef.current.clear();
                        clearAvatarAudioSink();
                    }, LIVEKIT_RECONNECTING_HARD_RESET_MS);
                });

                room.on(RoomEvent.Reconnected, () => {
                    devLog(
                        `✅ LiveKit reconnected (signal) — avatar resync in ${LIVEKIT_RECONNECTED_SYNC_DEBOUNCE_MS}ms (debounced)`
                    );
                    if (reconnectingHardResetTimerRef.current != null) {
                        clearTimeout(reconnectingHardResetTimerRef.current);
                        reconnectingHardResetTimerRef.current = null;
                    }
                    setIsConnected(true);
                    if (livekitReconnectedSyncTimerRef.current != null) {
                        clearTimeout(livekitReconnectedSyncTimerRef.current);
                    }
                    livekitReconnectedSyncTimerRef.current = window.setTimeout(() => {
                        livekitReconnectedSyncTimerRef.current = null;
                        if (livekitRoomRef.current !== room) return;
                        if (room.state !== 'connected') return;
                        syncAvatarTracksFromRemoteParticipants('room-reconnected', { mode: 'soft' }).catch(
                            (e) => console.warn('avatar resync after reconnect:', e)
                        );
                    }, LIVEKIT_RECONNECTED_SYNC_DEBOUNCE_MS);
                });

                // Only the Beyond avatar worker carries synced agent TTS audio. Do NOT use isAvatarParticipant here:
                // identities like `agent-…` (session agent) can appear as active speakers and falsely gate the mic.
                room.on(RoomEvent.ActiveSpeakersChanged, (speakers = []) => {
                    const avatarSpeaking = speakers.some((p) => isAvatarWorkerParticipant(p));
                    avatarAudioActiveRef.current = avatarSpeaking;
                        const raw = latestRawAgentStateRef.current;
                        if (raw === 'speaking') {
                            if (avatarSpeaking) {
                            avatarHeardDuringSpeakingRef.current = true;
                            if (agentUiAudioIdleTimerRef.current != null) {
                                clearTimeout(agentUiAudioIdleTimerRef.current);
                                agentUiAudioIdleTimerRef.current = null;
                                }
                                setUiAgentState('speaking');
                        } else if (avatarHeardDuringSpeakingRef.current) {
                            if (agentUiAudioIdleTimerRef.current != null) {
                                clearTimeout(agentUiAudioIdleTimerRef.current);
                                agentUiAudioIdleTimerRef.current = null;
                            }
                            agentUiAudioIdleTimerRef.current = window.setTimeout(() => {
                                agentUiAudioIdleTimerRef.current = null;
                                    if (
                                        latestRawAgentStateRef.current === 'speaking' &&
                                        !avatarAudioActiveRef.current
                                    ) {
                                        setUiAgentState('listening');
                                    }
                            }, AGENT_UI_AUDIO_IDLE_MS);
                        }
                    }
                    if (avatarSpeaking) {
                        if (avatarMicUnmuteTimerRef.current != null) {
                            clearTimeout(avatarMicUnmuteTimerRef.current);
                            avatarMicUnmuteTimerRef.current = null;
                        }
                        if (micTrackRef.current) micTrackRef.current.enabled = false;
                    } else {
                        scheduleMicUnmuteAfterAvatarOrAgent();
                    }
                });

                room.on(RoomEvent.TrackPublished, async (publication, participant) => {
                    const trackKind = publication.kind === Track.Kind.Video ? 'video' : (publication.kind === Track.Kind.Audio ? 'audio' : 'unknown');
                    devLog(`📤📤📤 Track PUBLISHED Event: ${trackKind} from ${participant.identity} 📤📤📤`, {
                        trackName: publication.trackName,
                        trackSid: publication.trackSid,
                        isSubscribed: publication.isSubscribed,
                        participantIdentity: participant.identity,
                        isAgent: participant.identity.startsWith('agent-'),
                        isLocal: participant.isLocal
                    });
                    
                    // ✅ CRITICAL: منع أي subscribe للـ local audio tracks (منع loopback)
                    if (publication.kind === Track.Kind.Audio && participant.isLocal) {
                        devLog(`⏭️ CRITICAL: Preventing subscription to local audio track - NO LOOPBACK`);
                        devLog(`   ✅ User's voice goes to Agent ONLY - no local playback`);
                        // ✅ CRITICAL: لا نشترك في local audio tracks
                        if (publication.isSubscribed) {
                            try {
                                await publication.setSubscribed(false);
                                devLog(`✅ Unsubscribed from local audio track - preventing loopback`);
                            } catch (e) {
                                console.warn(`⚠️ Error unsubscribing from local audio:`, e);
                            }
                        }
                        return; // لا نتابع معالجة local audio tracks
                    }

                    /**
                     * الصوت المعروض للمستخدم يجب أن يأتي فقط من مسار الأفاتار (bey-avatar-agent أو publish_on_behalf).
                     * وكيل الجلسة (agent-*) قد ينشر مسار صوتي إضافياً بينما TTS يذهب للأفاتار — autoSubscribe يشترك فيهما فيسبب صرف نطاق/فك ترميز بلا حاجة وأحياناً طبقات صوتية غريبة.
                     */
                    if (publication.kind === Track.Kind.Audio && !participant.isLocal) {
                        if (!isAvatarWorkerParticipant(participant)) {
                            if (publication.isSubscribed) {
                                try {
                                    await publication.setSubscribed(false);
                                    devLog(`✅ Unsubscribed non–avatar-worker remote audio: ${participant.identity}`);
                                } catch (e) {
                                    console.warn('⚠️ Error unsubscribing non-avatar-worker audio:', e);
                                }
                            }
                            return;
                        }
                        if (!publication.isSubscribed) {
                            try {
                                await publication.setSubscribed(true);
                            } catch (subError) {
                                console.error('❌ Error subscribing to avatar audio:', subError);
                            }
                        }
                        return;
                    }
                    
                    // ✅ LiveKit Docs: الاعتماد فقط على events - subscribe عند TrackPublished
                    if (publication.kind === Track.Kind.Video && isAvatarParticipant(participant)) {
                        if (!publication.isSubscribed) {
                            try {
                                await publication.setSubscribed(true);
                            } catch (subError) {
                                console.error('❌ Error subscribing to video:', subError);
                            }
                        }
                        ensureAvatarVideoSubscriptionQuality(publication);
                    }
                });

                // ✅ FIX: Transcripts من registerTextStreamHandler('lk.transcription') فقط - لا نضيف من DataReceived (يمنع تكرار الرسائل)
                room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
                    if (
                        import.meta.env.DEV &&
                        topic &&
                        (topic.includes('transcript') || topic.includes('user') || topic.includes('agent'))
                    ) {
                        devLog('DataReceived (ignored; lk.transcription)', topic, participant?.identity);
                    }
                });
                
                // ⚠️ CRITICAL: استخدام registerTextStreamHandler للاستماع إلى lk.transcription
                // هذا هو الطريقة الصحيحة للاستماع إلى transcriptions من LiveKit Agents
                room.registerTextStreamHandler('lk.transcription', (reader, participant) => {
                    // قراءة جميع الرسائل من الـ stream
                    const readStream = async () => {
                        try {
                            // ⚠️ CRITICAL: readAll() قد يرجع string مباشرة أو array أو object
                            let messages = await reader.readAll();
                            
                            // التحقق من نوع messages واستخراج النص
                            let fullMessage = '';
                            if (typeof messages === 'string') {
                                fullMessage = messages;
                            } else if (Array.isArray(messages)) {
                                // إذا كان array، نحاول استخراج النص من كل عنصر
                                fullMessage = messages.map(msg => {
                                    if (typeof msg === 'string') return msg;
                                    if (typeof msg === 'object' && msg !== null) {
                                        // قد يكون object يحتوي على text أو content
                                        return msg.text || msg.content || msg.message || JSON.stringify(msg);
                                    }
                                    return String(msg || '');
                                }).join('');
                            } else if (typeof messages === 'object' && messages !== null) {
                                // إذا كان object، نحاول استخراج النص من properties
                                fullMessage = messages.text || messages.content || messages.message || messages.data || 
                                             (messages.toString && messages.toString() !== '[object Object]' ? messages.toString() : JSON.stringify(messages));
                            } else {
                                fullMessage = String(messages || '');
                            }
                            
                            // الحصول على attributes
                            const isFinal = reader.info?.attributes?.['lk.transcription_final'] === 'true';
                            
                            // ⚠️ CRITICAL: التحقق من أن fullMessage نص صحيح
                            if (fullMessage && 
                                typeof fullMessage === 'string' && 
                                fullMessage.trim().length > 0 && 
                                fullMessage !== '{}' && 
                                fullMessage !== '[object Object]' &&
                                !fullMessage.startsWith('{') && // ليس JSON object
                                !fullMessage.startsWith('[')) { // ليس JSON array
                                
                                // ✅ FIX: تحديد role بناءً على participant identity و local participant
                                // حسب وثائق LiveKit: "the sender identity is the transcribed participant"
                                // User transcripts تأتي من local participant
                                // Agent transcripts تأتي من agent participants
                                const isLocalParticipant = participant?.identity === room.localParticipant?.identity;
                                const isAgentParticipant = isAvatarParticipant(participant);
                                
                                // ✅ FIX: تحسين تحديد role - user transcripts قد تأتي من local participant أو من participant آخر
                                // LiveKit Agents يرسلون user transcripts من participant الذي يتحدث (ليس بالضرورة local participant)
                                let role = 'user'; // Default to user
                                if (isAgentParticipant) {
                                    role = 'assistant';
                                } else if (isLocalParticipant) {
                                    role = 'user';
                                } else {
                                    // ✅ FIX: إذا لم يكن agent، فهو user (حتى لو لم يكن local participant)
                                    // LiveKit Agents قد يرسلون user transcripts من remote participant
                                    role = 'user';
                                }
                                
                                // ✅ FIX: تجاهل Transcript الذي يأتي أثناء حديث الأيجنت (منع feedback loop)
                                // ⚠️ FIX: فقط نتجاهل partial transcripts أثناء حديث Agent (final transcripts يجب أن تظهر دائماً)
                                // هذا يضمن أن user transcripts النهائية (final) تظهر حتى لو كان Agent يتحدث
                                // اتبع حالة الوكيل من LiveKit لا من واجهة التزامن الصوتي (تجنب partials خاطئة أثناء وميض الحالة)
                                // قمع partials طوال جولة ردّ الوكيل (بما فيها فجوات TTS بين الجمل)
                                if (
                                    role === 'user' &&
                                    effectiveAgentStateForUiRef.current === 'speaking' &&
                                    !isFinal
                                ) {
                                    return; // تجاهل partial أثناء جولة speaking من وكيل الجلسة (lk.agent.state)
                                }
                                
                                // ✅ ANTI-NOISE GATE: تجاهل الضوضاء القصيرة (transcript فارغ فقط)
                                // ⚠️ FIX: إزالة duration check لأن duration = 0 يعني transcript جديد (ليس ضوضاء)
                                // فقط نتجاهل transcripts فارغة تماماً
                                if (role === 'user' && isFinal) {
                                    // ✅ FIX: تجاهل فقط transcripts فارغة تماماً (لا نتحقق من duration)
                                    // duration = 0 يعني transcript جديد، وليس ضوضاء
                                    if (!fullMessage.trim() || fullMessage.trim().length < 1) {
                                        return; // تجاهل transcript فارغ
                                    }
                                    
                                    // Reset timing بعد معالجة transcript صحيح
                                    const timing = userTranscriptTimingRef.current;
                                    timing.startTime = null;
                                    timing.lastTime = null;
                                    timing.duration = 0;
                                }
                                
                                // ✅ Mic/audio/isAgentSpeakingRef يتحكم بها agentState فقط - لا نغيّرها من transcript
                                // Never call play() from transcript events; audio attachment logic owns playback.
                                
                                // مستخدم جزئي: فقاعة واحدة (userLiveCaption) تتحدّث مع partials — لا تُدخل السجل حتى النهائي
                                if (role === 'user' && !isFinal) {
                                    const lastPartial = lastPartialTranscriptRef.current[role];
                                    if (lastPartial === fullMessage) return;
                                    lastPartialTranscriptRef.current[role] = fullMessage;
                                    setUserLiveCaption(fullMessage);
                                    return;
                                }

                                if (role === 'user' && isFinal) {
                                    setUserLiveCaption('');
                                }

                                setConversationHistory(prev => {
                                    // مستخدم: partial في صف واحد؛ finals متتابعة تُدمج مع آخر user final
                                    if (isFinal) {
                                        // ⚠️ FINAL TRANSCRIPT: نزيل جميع partial messages من نفس role ونضيف final
                                        const filtered = prev.filter((msg) => {
                                            if (msg.role === role && msg.isFinal === false) return false;
                                            return true;
                                        });
                                        
                                        if (role === 'user') {
                                            const now = Date.now();
                                            const last = filtered[filtered.length - 1];
                                            const msSinceUserFinal =
                                                now - lastUserFinalAtRef.current;
                                            const mergeShortBurst =
                                                last &&
                                                last.role === 'user' &&
                                                last.isFinal === true &&
                                                msSinceUserFinal < USER_TRANSCRIPT_MERGE_GAP_MS &&
                                                shouldMergeUserTranscriptFinals(
                                                    last.content,
                                                    fullMessage
                                                );
                                            const mergeSameSpeechTurn =
                                                last &&
                                                last.role === 'user' &&
                                                last.isFinal === true &&
                                                msSinceUserFinal < USER_SAME_SPEECH_TURN_GAP_MS;
                                            const canMerge =
                                                mergeShortBurst || mergeSameSpeechTurn;
                                        
                                        let newHistory;
                                            if (canMerge) {
                                                let merged;
                                                if (
                                                    shouldMergeUserTranscriptFinals(
                                                        last.content,
                                                        fullMessage
                                                    )
                                                ) {
                                                    merged = mergeUserTranscriptFragments(
                                                        last.content,
                                                        fullMessage
                                                    );
                                                } else {
                                                    merged =
                                                        `${last.content.trim()} ${fullMessage.trim()}`
                                                            .replace(/\s+/g, ' ')
                                                            .trim();
                                                }
                                                if (merged === last.content) {
                                            newHistory = filtered;
                                        } else {
                                                    lastUserFinalAtRef.current = now;
                                                    newHistory = [
                                                        ...filtered.slice(0, -1),
                                                        { ...last, content: merged, isFinal: true },
                                                    ];
                                                }
                                            } else {
                                                lastUserFinalAtRef.current = now;
                                                const lastFinalIndex = filtered.findLastIndex(
                                                    (msg) => msg.role === role && msg.isFinal === true
                                                );
                                                if (
                                                    lastFinalIndex !== -1 &&
                                                    filtered[lastFinalIndex].content === fullMessage
                                                ) {
                                                    newHistory = filtered;
                                                } else {
                                                    newHistory = [
                                                        ...filtered,
                                                        { role, content: fullMessage, isFinal: true },
                                                    ];
                                                }
                                            }
                                            lastPartialTranscriptRef.current[role] = null;
                                            return newHistory;
                                        }

                                        // assistant: دمج نهائيين متتابعين إن كانا نفس ردّ الوكيل (مثل مسار المستخدم)
                                        const nowA = Date.now();
                                        const lastA = filtered[filtered.length - 1];
                                        const msSinceAssistantFinal =
                                            nowA - lastAssistantFinalAtRef.current;
                                        const mergeAssistantShort =
                                            lastA &&
                                            lastA.role === 'assistant' &&
                                            lastA.isFinal === true &&
                                            msSinceAssistantFinal <
                                                USER_TRANSCRIPT_MERGE_GAP_MS &&
                                            shouldMergeUserTranscriptFinals(
                                                lastA.content,
                                                fullMessage
                                            );
                                        const mergeAssistantSameTurn =
                                            lastA &&
                                            lastA.role === 'assistant' &&
                                            lastA.isFinal === true &&
                                            msSinceAssistantFinal <
                                                USER_SAME_SPEECH_TURN_GAP_MS;
                                        const canMergeAssistant =
                                            mergeAssistantShort || mergeAssistantSameTurn;

                                        let newHistory;
                                        if (canMergeAssistant) {
                                            let mergedA;
                                            if (
                                                shouldMergeUserTranscriptFinals(
                                                    lastA.content,
                                                    fullMessage
                                                )
                                            ) {
                                                mergedA = mergeUserTranscriptFragments(
                                                    lastA.content,
                                                    fullMessage
                                                );
                                            } else {
                                                mergedA =
                                                    `${lastA.content.trim()} ${fullMessage.trim()}`
                                                        .replace(/\s+/g, ' ')
                                                        .trim();
                                            }
                                            if (mergedA === lastA.content) {
                                                newHistory = filtered;
                                            } else {
                                                lastAssistantFinalAtRef.current = nowA;
                                                newHistory = [
                                                    ...filtered.slice(0, -1),
                                                    {
                                                        ...lastA,
                                                        content: mergedA,
                                                        isFinal: true,
                                                    },
                                                ];
                                            }
                                        } else {
                                            const lastFinalIndex = filtered.findLastIndex(
                                                (msg) =>
                                                    msg.role === role && msg.isFinal === true
                                            );
                                            if (
                                                lastFinalIndex !== -1 &&
                                                filtered[lastFinalIndex].content === fullMessage
                                            ) {
                                                newHistory = filtered;
                                            } else {
                                                lastAssistantFinalAtRef.current = nowA;
                                                newHistory = [
                                                    ...filtered,
                                                    {
                                                        role,
                                                        content: fullMessage,
                                                        isFinal: true,
                                                    },
                                                ];
                                            }
                                        }

                                        lastPartialTranscriptRef.current[role] = null;
                                        setAssistantLiveCaption('');
                                        
                                        return newHistory;
                                    } else {
                                        const lastPartial = lastPartialTranscriptRef.current[role];
                                        if (lastPartial === fullMessage) return prev;
                                        
                                        lastPartialTranscriptRef.current[role] = fullMessage;
                                        if (role === 'assistant') {
                                            setAssistantLiveCaption(fullMessage);
                                        }
                                        return prev;
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('❌ Error reading text stream:', error?.message || error);
                        }
                    };
                    
                    // قراءة الـ stream
                    readStream();
                });
                
                room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
                    devLog('📦 Track subscribed:', track.kind === Track.Kind.Video ? 'video' : (track.kind === Track.Kind.Audio ? 'audio' : 'unknown'), 'from', participant.identity, {
                        trackName: publication.trackName,
                        trackSid: publication.trackSid,
                        participantIdentity: participant.identity
                    });
                    
                    if (track.kind === Track.Kind.Video) {
                        if (!isAvatarParticipant(participant)) {
                            devLog('⏭️ Skipping video track from non-avatar participant:', participant.identity);
                            return;
                        }

                        if (avatarVideoUnsubDebounceRef.current != null) {
                            clearTimeout(avatarVideoUnsubDebounceRef.current);
                            avatarVideoUnsubDebounceRef.current = null;
                        }

                        const vSid = publication?.trackSid || track.sid;
                        if (
                            videoTrackAttachedRef.current &&
                            attachedAvatarVideoTrackSidRef.current === vSid
                        ) {
                            ensureAvatarVideoSubscriptionQuality(publication);
                            if (typeof publication.setVideoQuality === 'function') {
                                avatarVideoPublicationRef.current = publication;
                            }
                            setAvatarVideoSurfaceReady(true);
                            devLog('⏭️ Avatar video already bound; refresh quality only:', vSid);
                            return;
                        }

                        devLog('🎥🎥🎥 VIDEO TRACK SUBSCRIBED FROM AGENT 🎥🎥🎥', {
                            trackName: publication.trackName,
                            trackSid: publication.trackSid,
                            participant: participant.identity,
                            hasAvatarRef: !!avatarVideoRef.current
                        });

                        ensureAvatarVideoSubscriptionQuality(publication);
                        if (typeof publication.setVideoQuality === 'function') {
                            avatarVideoPublicationRef.current = publication;
                        }
                        
                        // ✅ PRODUCTION FIX: React timing fix - حفظ track في state بدلاً من retry
                        pendingAvatarVideoPublicationRef.current = publication;
                        setPendingVideoTrack(track);
                    } else if (track.kind === Track.Kind.Audio) {
                        // ✅ CRITICAL FIX: القاعدة الذهبية - لا نشغّل صوت local participant (منع الصدى)
                        // ✅ لا نريد أن يسمع المستخدم صوته يرتد - الصوت يذهب فقط إلى Agent
                        if (participant.isLocal) {
                            devLog(`⏭️ CRITICAL: Skipping audio track from local participant - NO LOOPBACK (preventing echo/feedback)`);
                            devLog(`   ✅ User's voice goes to Agent ONLY - no local playback`);
                            // ✅ CRITICAL: لا نرفق track محلياً - الصوت يذهب فقط إلى Agent
                                    return;
                        }
                        
                        // ✅ LiveKit Docs: Avatar worker publishes synced audio+video - use only avatar worker audio
                        if (!isAvatarWorkerParticipant(participant)) {
                            devLog(`⏭️ Skipping audio track from non-avatar participant: ${participant.identity}`);
                            try {
                                if (publication?.isSubscribed && typeof publication.setSubscribed === 'function') {
                                    publication.setSubscribed(false);
                                }
                            } catch (e) {
                                console.warn('⚠️ Could not unsubscribe non-avatar audio:', e);
                            }
                            return;
                        }
                        
                        // ✅ Mic/audio يتحكم بها agentState فقط - لا نغيّرها هنا
                        devLog(`🔊 Attaching audio track from Avatar: ${participant.identity}`);

                        if (audioRef.current) {
                            attachAvatarAudioTrack(track, publication, participant);
                            devLog(
                                '✅ Avatar audio on audioRef — video uses track.attach() (animated stream)'
                            );
                        }
                    }
                });

                room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
                    
                    // ✅ STEP 4: TrackUnsubscribed = INFO - هذا طبيعي عند cleanup أو network changes
                    // لا نستدعي endInterview() هنا - هذا جزء من lifecycle الطبيعي
                    
                    // ✅ FIX: عند إلغاء اشتراك الفيديو - detach و reset للسماح بإعادة الربط عند إعادة الاشتراك
                    if (track.kind === Track.Kind.Video && participant && isAvatarParticipant(participant)) {
                        const pubSid = publication?.trackSid || track.sid;
                        if (avatarVideoUnsubDebounceRef.current != null) {
                            clearTimeout(avatarVideoUnsubDebounceRef.current);
                            avatarVideoUnsubDebounceRef.current = null;
                        }
                        avatarVideoUnsubDebounceRef.current = window.setTimeout(() => {
                            avatarVideoUnsubDebounceRef.current = null;
                            const latestPub =
                                publication?.trackSid && participant?.videoTrackPublications
                                    ? participant.videoTrackPublications.get(publication.trackSid)
                                    : publication;
                            if (latestPub?.isSubscribed) {
                                return;
                            }
                            if (attachedAvatarVideoTrackSidRef.current !== pubSid) {
                                return;
                            }
                            try {
                                track.detach();
                            } catch (detachErr) {
                                console.warn('⚠️ Error detaching avatar video (debounced unsubscribe):', detachErr);
                            }
                            videoTrackAttachedRef.current = false;
                            attachedAvatarVideoTrackSidRef.current = null;
                            avatarVideoPublicationRef.current = null;
                            pendingAvatarVideoPublicationRef.current = null;
                            setPendingVideoTrack(null);
                        }, AVATAR_VIDEO_UNSUB_DEBOUNCE_MS);
                        return; // تم التعامل - لا نكرر track.detach() أدناه
                    }
                    if (track.kind === Track.Kind.Audio) {
                        
                        // ✅ PRODUCTION FIX: لا detach فوري - LiveKit سيتعامل مع detach تلقائياً عند انتهاء playback
                        // هذا يمنع: "playback_finished called more times than playback segments were captured"
                        devLog('ℹ️ Audio track unsubscribed - LiveKit will handle cleanup (no manual detach to prevent playback corruption)');
                        
                        // ✅ CRITICAL FIX: تنظيف audio elements من DOM عند unsubscribe (منع audio elements قديمة)
                        try {
                            const allAudioElements = document.querySelectorAll('audio');
                            allAudioElements.forEach((audioEl) => {
                                // ✅ تنظيف audio elements التي تستخدم هذا track
                                if (audioEl.srcObject) {
                                    const stream = audioEl.srcObject;
                                    const hasTrack = stream.getTracks().some(t => t.id === track.mediaStreamTrack.id);
                                    if (hasTrack && audioEl !== audioRef.current) {
                                        try {
                                            audioEl.pause();
                                            audioEl.src = '';
                                            audioEl.srcObject = null;
                                            if (audioEl.parentNode) {
                                                audioEl.parentNode.removeChild(audioEl);
                                            }
                                            devLog('✅ Removed audio element from DOM on track unsubscribe');
                                        } catch (removeError) {
                                            console.warn('⚠️ Error removing audio element on unsubscribe:', removeError);
                                        }
                                    }
                                }
                            });
                        } catch (cleanupError) {
                            console.warn('⚠️ Error cleaning up audio elements on unsubscribe:', cleanupError);
                        }
                        
                        // ✅ PRODUCTION FIX: إزالة track SID من attachedAudioTracksRef عند unsubscribe
                        const trackSid = publication?.trackSid || track.sid;
                        if (trackSid && attachedAudioTracksRef.current.has(trackSid)) {
                            attachedAudioTracksRef.current.delete(trackSid);
                            devLog(`✅ Removed audio track ${trackSid} from attachedAudioTracksRef`);
                        }
                        
                        return; // لا detach يدوي للـ audio tracks
                    }
                    
                    // Video tracks (غير bey-avatar-agent) - detach آمن
                    try {
                    track.detach();
                    } catch (e) {
                        console.warn('⚠️ Error detaching track (non-critical):', e);
                    }
                });

                let tokenStr = livekitToken;
                if (tokenStr != null && typeof tokenStr.then === 'function') {
                    tokenStr = await tokenStr;
                }
                if (typeof tokenStr !== 'string') {
                    console.error('❌ LiveKit token invalid:', typeof tokenStr);
                    throw new Error('Invalid LiveKit token: must be a string');
                }
                if (tokenStr.length < 50) {
                    console.error('❌ LiveKit token is too short:', tokenStr.length);
                    throw new Error('Invalid LiveKit token: token is too short');
                }

                devLog('🔌 LiveKit connect', {
                    url: livekitUrl,
                    tokenLength: tokenStr.length,
                    adaptiveStream: livekitAdaptiveStreamRoomOption(),
                    dynacast: LIVEKIT_DYNACAST,
                    singlePeerConnection: LIVEKIT_SINGLE_PEER_CONNECTION,
                });

                // Minimal capture options — strict sampleRate/voiceIsolation breaks some browsers and can destabilize ICE.
                const liveKitConnectOpts = {
                    ...liveKitConnectResilience,
                    autoSubscribe: { audio: true, video: true },
                    audioCaptureOptions: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: false,
                    },
                };

                for (let attempt = 0; attempt < LIVEKIT_CONNECT_MAX_ATTEMPTS; attempt++) {
                    try {
                        if (attempt > 0) {
                            devLog(`LiveKit connect retry ${attempt + 1}/${LIVEKIT_CONNECT_MAX_ATTEMPTS}`);
                            try {
                                await room.disconnect();
                            } catch (_) {
                                /* ignore */
                            }
                            await new Promise((r) => setTimeout(r, 500 + attempt * 400));
                        }
                        await prepareLiveKitConnection(livekitUrl, tokenStr);
                        await room.connect(livekitUrl, tokenStr, liveKitConnectOpts);
                        break;
                    } catch (err) {
                        console.warn('LiveKit connect attempt failed:', err?.message || err);
                        if (attempt === LIVEKIT_CONNECT_MAX_ATTEMPTS - 1) {
                            throw err;
                        }
                    }
                }
                devLog('✅ room.connect() completed');
                await syncAvatarTracksFromRemoteParticipants('post-connect');
                window.setTimeout(() => {
                    if (livekitRoomRef.current !== room || room.state !== 'connected') return;
                    syncAvatarTracksFromRemoteParticipants('post-connect-settled', { mode: 'soft' }).catch(
                        () => {}
                    );
                }, 200);
                
                livekitRoomRef.current = room;

            } catch (error) {
                console.error('❌ Error connecting to LiveKit:', error);
                setIsConnected(false);
            }
        };

        // ⚠️ CRITICAL: التحقق من أن Room لم يتصل بالفعل قبل الاتصال
        // Race Condition Fix: منع إعادة الاتصال إذا كان Room متصل بالفعل
        const existingRoom = livekitRoomRef.current;
        if (existingRoom && (existingRoom.state === 'connected' || existingRoom.state === 'connecting')) {
            devLog('⏭️ Skipping LiveKit connection - Room already exists and connected/connecting', {
                roomState: existingRoom.state,
                roomName: existingRoom.name
            });
            return;
        }

        connectToLiveKit().catch((error) => {
            console.error('Error in connectToLiveKit:', error);
        });

        // ⚠️ CRITICAL FIX: Cleanup - فقط نغلق Room إذا كان Interview فعلاً ينتهي
        // Race Condition Fix: منع cleanup من إغلاق Room عند re-run بسبب dependency change
        return () => {
            if (reconnectingHardResetTimerRef.current != null) {
                clearTimeout(reconnectingHardResetTimerRef.current);
                reconnectingHardResetTimerRef.current = null;
            }
            if (livekitReconnectedSyncTimerRef.current != null) {
                clearTimeout(livekitReconnectedSyncTimerRef.current);
                livekitReconnectedSyncTimerRef.current = null;
            }
            // React Strict Mode: cleanup قد يُستدعى مع ref فارغ بعد disconnect — لا نكرر detach
            const currentRoom = livekitRoomRef.current;
            if (!currentRoom) {
                devLog('⏭️ LiveKit connect cleanup: skip (no room on ref — already cleared or Strict Mode remount)');
                return;
            }

            devLog('🧹 LiveKit useEffect cleanup called', {
                isInterviewActive,
                hasRoom: !!currentRoom,
                roomState: currentRoom?.state,
                roomName: currentRoom?.name,
                reason: 'Dependency changed or component unmounting'
            });
            
            // ⚠️ CRITICAL: فقط نغلق Room إذا كان Interview فعلاً ينتهي
            // لا نغلق Room إذا كان Interview لا يزال نشط (قد يكون re-run بسبب dependency change)
            if (currentRoom && currentRoom.state !== 'disconnected') {
                // التحقق من القيم الحالية - إذا كان Interview لا يزال نشط، لا نغلق Room
                if (!isInterviewActive) {
                    devLog('✅ Closing LiveKit Room - interview ended', {
                        roomState: currentRoom.state,
                        roomName: currentRoom.name
                    });
                    try {
                        if (currentRoom.state === 'connected' || currentRoom.state === 'connecting') {
                            currentRoom.disconnect();
                            devLog('✅ Room.disconnect() called');
                        }
                    } catch (disconnectError) {
                        console.warn('⚠️ Error disconnecting from Room:', disconnectError);
                    }
                    setLivekitRoom(null);
                    livekitRoomRef.current = null;
                    devLog('🧹 LiveKit Room disconnected and cleaned up');
                } else {
                    devLog('⏭️ SKIPPING Room cleanup - interview is still active', {
                        roomState: currentRoom.state,
                        roomName: currentRoom.name,
                        isInterviewActive,
                        reason: 'This cleanup was likely triggered by dependency change, not actual interview end'
                    });
                    devLog('   ⚠️ Room will stay connected to maintain session');
                    devLog('   📍 Room state will remain:', currentRoom.state);
                }
            } else {
                devLog('⏭️ No Room to clean up or Room already disconnected', {
                    hasRoom: !!currentRoom,
                    roomState: currentRoom?.state
                });
            }
        };
    }, [canEnableMicNow, isInterviewActive, livekitRoomName, livekitToken, livekitUrl, scheduleMicUnmuteAfterAvatarOrAgent]);

    // التأكد من أن الفيديو يعمل عند تغيير isInterviewActive
    useEffect(() => {
        if (isInterviewActive && userVideoRef.current && mediaStreamRef.current) {
            // إعادة تعيين srcObject للتأكد من أن الفيديو يعمل
            if (userVideoRef.current.srcObject !== mediaStreamRef.current) {
                userVideoRef.current.srcObject = mediaStreamRef.current;
            }
            // محاولة تشغيل الفيديو
            userVideoRef.current.play().catch(err => {
                console.warn('Video play error (may be normal):', err);
            });
            devLog('✅ Video element ready, stream active:', mediaStreamRef.current.active);
        }
    }, [isInterviewActive]);

    // fallback فوري ثم مرة قصيرة — نفس مسار attachAvatarLivekitVideoTrack (عنصر فيديو واحد)
    useEffect(() => {
        if (!livekitRoom || !avatarVideoRef.current) {
            return;
        }

        const currentRoom = livekitRoomRef.current;
        if (!currentRoom || currentRoom.state !== 'connected') {
            return;
        }

        const attachVideoIfAvailable = (reason) => {
            if (!avatarVideoRef.current) {
                return;
            }
            currentRoom.remoteParticipants.forEach((participant) => {
                if (!isAvatarParticipant(participant)) return;
                participant.videoTrackPublications.forEach((publication) => {
                    if (publication.isSubscribed && publication.track && !videoTrackAttachedRef.current) {
                        attachAvatarLivekitVideoTrack(publication.track, publication, reason);
                    }
                });
            });
        };

        attachVideoIfAvailable('fallback-immediate');
        const fallbackTimer = setTimeout(() => attachVideoIfAvailable('fallback-delayed'), 120);

        return () => {
            clearTimeout(fallbackTimer);
        };
    }, [livekitRoom, isConnected, attachAvatarLivekitVideoTrack]);

    // ✅ PRODUCTION FIX: ربط pending video track عندما يكون container جاهز (عنصر فيديو واحد)
    useEffect(() => {
        const container = avatarContainerElement || avatarVideoRef.current;
        if (!pendingVideoTrack || !container || videoTrackAttachedRef.current) {
            return;
        }

        devLog('✅ [Video] Attaching pending track (once)');
        const pub = pendingAvatarVideoPublicationRef.current;
        const ok = attachAvatarLivekitVideoTrack(
            pendingVideoTrack,
            pub && pub.kind === Track.Kind.Video ? pub : { trackSid: pendingVideoTrack.sid },
            'pending-state'
        );
        if (ok) {
            pendingAvatarVideoPublicationRef.current = null;
            setPendingVideoTrack(null);
        }
    }, [pendingVideoTrack, avatarContainerElement, attachAvatarLivekitVideoTrack]);

    // إدارة WebSocket connection لاستقبال video stream من Backend
    // ⚠️ DISABLED: LiveKit is REQUIRED - no fallback to WebSocket
    useEffect(() => {
        if (!ENABLE_LEGACY_WEBSOCKET_FALLBACK) {
            return;
        }
        // ⚠️ CRITICAL FIX: لا نفحص حالة الاتصال مباشرة - ننتظر حتى يكتمل
        // Race Condition Fix: الانتظار حتى Room Connected Event بدلاً من فحص مبكر
        
        // ⚠️ CRITICAL FIX: Race Condition - الانتظار حتى Room Connected Event
        // لا نفشل المقابلة مباشرة - ننتظر حتى يكتمل الاتصال
        const currentRoom = livekitRoomRef.current;
        
        // إذا كان LiveKit متوفراً ومتصل بالفعل، لا نستخدم WebSocket
        if (currentRoom && currentRoom.state === 'connected') {
            devLog('✅ LiveKit Room active and connected, skipping WebSocket video stream', {
                roomState: currentRoom.state,
                roomName: currentRoom.name
            });
            return;
        }
        
        // ⚠️ CRITICAL: إذا كان Interview نشط لكن Room غير متصل بعد، ننتظر
        // لا نفشل المقابلة - Race Condition Fix
        if (isInterviewActive) {
            if (!currentRoom) {
                devLog('⏳ Waiting for LiveKit Room connection...', {
                    isInterviewActive,
                    hasRoom: false,
                    reason: 'Room not created yet - waiting for useEffect to create it',
                    action: 'Will retry when Room is created'
                });
            } else if (currentRoom.state !== 'connected') {
                devLog('⏳ Waiting for LiveKit Room connection...', {
                    isInterviewActive,
                    hasRoom: true,
                    roomState: currentRoom.state,
                    reason: `Room state is '${currentRoom.state}', waiting for 'connected' state`,
                    action: 'Will retry when RoomEvent.Connected is triggered'
                });
            }
            // لا نفشل هنا - ننتظر حتى يكتمل الاتصال
            return;
        }

        // الاتصال فقط عند بدء المقابلة ووجود sessionId
        if (!isInterviewActive || !sessionId) {
            return;
        }

        // إنشاء video element إذا لم يكن موجوداً
        if (!avatarVideoRef.current) {
            return;
        }

        const videoElement = ensureAvatarLivekitVideoElement(avatarVideoRef.current);
        if (!videoElement) {
            return;
        }

        // إنشاء MediaSource لاستقبال video stream
        let mediaSource = null;
        let sourceBuffer = null;

        try {
            // الاتصال بـ WebSocket
            const wsUrl = `${WS_BASE}/ws/video-stream?sessionId=${sessionId}`;
            devLog('🔌 Connecting to video stream WebSocket...', wsUrl);

            const ws = new WebSocket(wsUrl);
            videoWebSocketRef.current = ws;

            // تجميع video chunks
            const videoChunks = [];

            ws.onopen = () => {
                devLog('✅ Video stream WebSocket connected');
            };

            ws.onmessage = (event) => {
                try {
                    devLog('📦 Video WebSocket message received:', {
                        type: typeof event.data,
                        isBlob: event.data instanceof Blob,
                        isArrayBuffer: event.data instanceof ArrayBuffer,
                        isString: typeof event.data === 'string',
                        size: event.data instanceof Blob ? event.data.size : 
                              event.data instanceof ArrayBuffer ? event.data.byteLength :
                              typeof event.data === 'string' ? event.data.length : 'unknown'
                    });

                    // إذا كان binary data (video chunk)
                    if (event.data instanceof Blob) {
                        devLog('🎥 Received Blob video chunk, size:', event.data.size);
                        event.data.arrayBuffer().then((buffer) => {
                            const uint8Array = new Uint8Array(buffer);
                            videoChunks.push(uint8Array);
                            devLog(`📹 Video chunks count: ${videoChunks.length}, total size: ${videoChunks.reduce((sum, chunk) => sum + chunk.length, 0)} bytes`);

                            // إنشاء blob من جميع chunks
                            const blob = new Blob(videoChunks, { type: 'video/mp4' });
                            const url = URL.createObjectURL(blob);
                            
                            if (videoElement) {
                                devLog('🎬 Setting video source from Blob chunks');
                                videoElement.src = url;
                                videoElement.play().catch(err => {
                                    console.warn('⚠️ Error playing video:', err);
                                });
                            }
                        });
                    }
                    // إذا كان ArrayBuffer
                    else if (event.data instanceof ArrayBuffer) {
                        devLog('🎥 Received ArrayBuffer video chunk, size:', event.data.byteLength);
                        const uint8Array = new Uint8Array(event.data);
                        videoChunks.push(uint8Array);
                        devLog(`📹 Video chunks count: ${videoChunks.length}, total size: ${videoChunks.reduce((sum, chunk) => sum + chunk.length, 0)} bytes`);

                        const blob = new Blob(videoChunks, { type: 'video/mp4' });
                        const url = URL.createObjectURL(blob);
                        
                        if (videoElement) {
                            devLog('🎬 Setting video source from ArrayBuffer chunks');
                            videoElement.src = url;
                            videoElement.play().catch(err => {
                                console.warn('⚠️ Error playing video:', err);
                            });
                        }
                    }
                    // إذا كان نص (string)
                    else if (typeof event.data === 'string') {
                        // تجاهل رسائل keep-alive (pong)
                        if (event.data === 'pong') {
                            // keep-alive message - تجاهلها
                            return;
                        }
                        
                        // التحقق من أن الرسالة هي JSON قبل التحليل
                        if (!event.data.startsWith('{') && !event.data.startsWith('[')) {
                            // ليست JSON - تجاهلها
                            console.warn('⚠️ Received non-JSON string message:', event.data.substring(0, 50));
                            return;
                        }
                        
                        // محاولة تحليل JSON
                        const message = JSON.parse(event.data);
                        if (message.type === 'connected') {
                            devLog('✅ Video stream connection confirmed:', message.message);
                        } else if (message.type === 'video' && message.data) {
                            devLog('🎥 Received JSON video data (base64), size:', message.data.length);
                            // Base64 video data
                            const binaryString = atob(message.data);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            videoChunks.push(bytes);
                            devLog(`📹 Video chunks count: ${videoChunks.length}, total size: ${videoChunks.reduce((sum, chunk) => sum + chunk.length, 0)} bytes`);

                            const blob = new Blob(videoChunks, { type: 'video/mp4' });
                            const url = URL.createObjectURL(blob);
                            
                            if (videoElement) {
                                devLog('🎬 Setting video source from base64 chunks');
                                videoElement.src = url;
                                videoElement.play().catch(err => {
                                    console.warn('⚠️ Error playing video:', err);
                                });
                            }
                        } else {
                            devLog('📨 Received JSON message:', message.type, message);
                        }
                    }
                } catch (error) {
                    console.error('❌ Error processing video message:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ Video stream WebSocket error:', error);
            };

            ws.onclose = (event) => {
                devLog('🔌 Video stream WebSocket closed', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                });
            };

            // إرسال ping كل 30 ثانية للحفاظ على الاتصال
            const pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('ping');
                }
            }, 30000);

            // Cleanup
            return () => {
                clearInterval(pingInterval);
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
                videoWebSocketRef.current = null;
                
                // تنظيف: نفس عنصر <video> المستخدم لـ LiveKit — لا نزيله من DOM (يقلل flicker لاحقاً)
                if (videoElement) {
                    try {
                        videoElement.pause();
                        videoElement.src = '';
                        videoElement.removeAttribute('src');
                    } catch (_) {
                        /* ignore */
                    }
                }

                // تنظيف MediaSource
                if (mediaSource && mediaSource.readyState === 'open') {
                    mediaSource.endOfStream();
                }

                devLog('🧹 Video stream WebSocket cleaned up');
            };

        } catch (error) {
            console.error('❌ Error setting up video stream:', error);
        }
    }, [isInterviewActive, sessionId, ensureAvatarLivekitVideoElement]);

    // ✅ LiveKit docs: "Disable the microphone when the agent is speaking"
    // https://docs.livekit.io/frontends/build/agent-state/
    // + تأخير إعادة الميكروفون بعد انتهاء كتم الوكيل (speaking و/أو thinking) لتقليل ذيل السماعة → صدى → تشويش STT
    useEffect(() => {
        if (!isInterviewActive) {
            if (avatarMicUnmuteTimerRef.current != null) {
                clearTimeout(avatarMicUnmuteTimerRef.current);
                avatarMicUnmuteTimerRef.current = null;
            }
            if (avatarVideoUnsubDebounceRef.current != null) {
                clearTimeout(avatarVideoUnsubDebounceRef.current);
                avatarVideoUnsubDebounceRef.current = null;
            }
            if (agentUiAudioIdleTimerRef.current != null) {
                clearTimeout(agentUiAudioIdleTimerRef.current);
                agentUiAudioIdleTimerRef.current = null;
            }
            prevAgentStateForMicRef.current = null;
            latestAgentStateForMicRef.current = null;
            setUiAgentState(null);
            avatarAudioActiveRef.current = false;
            if (audioRef.current) audioRef.current.muted = false;
            if (micTrackRef.current) micTrackRef.current.enabled = true;
            isAgentSpeakingRef.current = false;
            return;
        }
        if (!agentState) return;
        const micState = effectiveAgentStateForUi ?? agentState;
        latestAgentStateForMicRef.current = micState;

        const isSpeaking = micState === 'speaking';
        const muteForAgentAudio =
            isSpeaking || (AVATAR_MIC_MUTE_WHILE_THINKING && micState === 'thinking');
        isAgentSpeakingRef.current = isSpeaking;

        if (audioRef.current) audioRef.current.muted = false;

        if (muteForAgentAudio) {
            if (avatarMicUnmuteTimerRef.current != null) {
                clearTimeout(avatarMicUnmuteTimerRef.current);
                avatarMicUnmuteTimerRef.current = null;
            }
            if (micTrackRef.current) micTrackRef.current.enabled = false;
            prevAgentStateForMicRef.current = micState;
            return;
        }

        const prev = prevAgentStateForMicRef.current;
        const wasMutedForAgent =
            prev === 'speaking' ||
            (AVATAR_MIC_MUTE_WHILE_THINKING && prev === 'thinking');
        prevAgentStateForMicRef.current = micState;

        if (wasMutedForAgent) {
            scheduleMicUnmuteAfterAvatarOrAgent();
        } else if (avatarMicUnmuteTimerRef.current == null) {
            if (canEnableMicNow() && micTrackRef.current) micTrackRef.current.enabled = true;
        }
    }, [
        agentState,
        uiAgentState,
        effectiveAgentStateForUi,
        canEnableMicNow,
        isInterviewActive,
        scheduleMicUnmuteAfterAvatarOrAgent,
    ]);

    // إعادة طلب جودة الاشتراك فقط عند انتقال حالة الوكيل (وليس كل إعادة رسم) — استدعاء متكرر لـ setVideoQuality كان يهز SFU/الأفاتار.
    // مع adaptiveStream: نحدّث عند الدخول إلى speaking/thinking أو التبديل بينهما. بدون adaptiveStream: لا حاجة للقتال مع الطبقات.
    useEffect(() => {
        if (!isInterviewActive || !agentState) {
            prevAgentStateForVideoQualityRef.current = null;
            return;
        }
        if (!LIVEKIT_ADAPTIVE_STREAM) return;

        const pub = avatarVideoPublicationRef.current;
        if (!pub || typeof pub.setVideoQuality !== 'function') return;

        const animating = (s) => s === 'speaking' || s === 'thinking';
        const prev = prevAgentStateForVideoQualityRef.current;
        prevAgentStateForVideoQualityRef.current = agentState;

        const shouldRefresh =
            animating(agentState) &&
            (!animating(prev) || (prev !== agentState && animating(prev)));

        if (!shouldRefresh) return;
        ensureAvatarVideoSubscriptionQuality(pub);
    }, [agentState, isInterviewActive]);

    // أثناء الكلام: إعادة طلب طبقة/أبعاد عالية دورياً (ازدحام الشبكة يخفّض الوضوح أحياناً بدون أخطاء).
    useEffect(() => {
        if (!isInterviewActive || agentState !== 'speaking' || AVATAR_SPEAKING_QUALITY_REFRESH_MS <= 0) {
            return;
        }
        const refresh = () => {
            const p = avatarVideoPublicationRef.current;
            if (p) ensureAvatarVideoSubscriptionQuality(p);
        };
        refresh();
        const id = window.setInterval(refresh, AVATAR_SPEAKING_QUALITY_REFRESH_MS);
        return () => {
            clearInterval(id);
        };
    }, [isInterviewActive, agentState]);

    useEffect(() => {
        return () => {
            if (avatarMicUnmuteTimerRef.current != null) {
                clearTimeout(avatarMicUnmuteTimerRef.current);
                avatarMicUnmuteTimerRef.current = null;
            }
            if (agentUiAudioIdleTimerRef.current != null) {
                clearTimeout(agentUiAudioIdleTimerRef.current);
                agentUiAudioIdleTimerRef.current = null;
            }
        };
    }, []);

    // بدء المقابلة - الاتصال بالـ Backend
    const startInterview = async (e) => {
        // منع السلوك الافتراضي (منع الانتقال إلى صفحة أخرى)
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // ✅ FIX: منع النقر المزدوج (يسبب إنشاء غرفتين وأفاتار غير مستقر)
        if (isStartingRef.current) return;
        isStartingRef.current = true;
        const sessionEpoch = ++sessionEpochRef.current;

        const abortStartIfStale = (reason, localStream = null) => {
            if (sessionEpoch === sessionEpochRef.current) return false;
            devLog('⏭️ startInterview aborted:', reason);
            if (localStream) {
                try {
                    localStream.getTracks().forEach((t) => t.stop());
                } catch (_) {
                    /* ignore */
                }
            }
            if (mediaStreamRef.current) {
                try {
                    mediaStreamRef.current.getTracks().forEach((t) => t.stop());
                } catch (_) {
                    /* ignore */
                }
                mediaStreamRef.current = null;
            }
            micTrackRef.current = null;
            if (userVideoRef.current) {
                try {
                    userVideoRef.current.srcObject = null;
                } catch (_) {
                    /* ignore */
                }
            }
            setCountdownActive(false);
            setPreparationTime(PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0);
            setAvatarVideoSurfaceReady(false);
            return true;
        };

        try {
            if (!effectiveCandidateId) {
                isStartingRef.current = false;
                setShowCandidateInput(true);
                alert(t('videoInterview_candidateIdAlert'));
                return;
            }

            // غطاء التحميل — الإخفاء عند ربط فيديو الأفاتار (لا ينتظر عدّاً ثابتاً إذا PREPARATION=0)
            setCountdownActive(true);
            setPreparationTime(PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0);
            setAvatarVideoSurfaceReady(false);
            setConnectionError(null);

            // 1. الحصول على الميكروفون والكاميرا
            // ⚠️ CRITICAL: تفعيل echo cancellation لمنع الصدى
            // ✅ PROFESSIONAL: إعدادات محسّنة حسب LiveKit Best Practices
            // بناءً على: https://docs.livekit.io/transport/media/noise-cancellation/
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    // ✅ CRITICAL FIX: تحسين echo cancellation لتحسين STT accuracy
                    // بناءً على: https://docs.livekit.io/transport/media/noise-cancellation/
                    // echo cancellation مهم جداً لتحسين STT - يمنع Agent من سماع كلماته الخاصة
                    // ⚠️ FIX: استخدام ideal فقط (exact قد يسبب فشل getUserMedia في بعض المتصفحات)
                    channelCount: { ideal: 1 }, // Mono - أفضل للـ STT و echo cancellation
                    echoCancellation: true, // ✅ CRITICAL: منع echo - يحسن STT accuracy
                    noiseSuppression: true, // ✅ CRITICAL: منع noise - يحسن STT accuracy
                    autoGainControl: false, // ✅ CRITICAL: تعطيل AGC لمنع تضخيم في feedback loop
                    voiceIsolation: true, // ✅ Enhanced voice isolation (Chrome/Edge) - يقلل من التقاط الأصوات المحيطة
                    
                    // ✅ Google-specific constraints (Chrome/Edge) - LiveKit Best Practices
                    googEchoCancellation: true,
                    googEchoCancellation2: true, // Enhanced echo cancellation - يحسن STT accuracy
                    googNoiseSuppression: true,
                    googNoiseSuppression2: true, // Enhanced noise suppression - يحسن STT accuracy
                    googAutoGainControl: false, // ✅ CRITICAL: تعطيل AGC
                    googAutoGainControl2: false, // ✅ CRITICAL: تعطيل AGC
                    googHighpassFilter: true, // Filter low-frequency noise
                    googTypingNoiseDetection: true, // Detect typing noise
                    googAudioMirroring: false, // ✅ CRITICAL: منع mirroring للصوت (prevents loopback)
                    googDAEchoCancellation: true, // Double AEC for better echo cancellation - يحسن STT accuracy
                    
                    // ✅ CRITICAL FIX: إعدادات إضافية لتقليل التقاط الأصوات المحيطة وتحسين STT
                    sampleSize: 16, // 16-bit samples
                    
                    // ✅ Audio quality settings - محسّنة لـ STT
                    sampleRate: { ideal: 16000 }, // Optimal for STT (16kHz) - ideal فقط لتجنب فشل getUserMedia
                    latency: { ideal: 0.01 }, // Low latency
                },
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                }
            });

            if (abortStartIfStale('after getUserMedia', stream)) {
                return;
            }

            mediaStreamRef.current = stream;
            
            // ⚠️ CRITICAL: التحقق من أن echo cancellation يعمل بشكل صحيح
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                // ✅ FIX: حفظ micTrack reference لتعطيل/تفعيل الميكروفون عند كلام الـ Agent
                micTrackRef.current = audioTrack;
                
                const settings = audioTrack.getSettings();
                const constraints = audioTrack.getConstraints();
                
                devLog('🎤 Audio track settings:', {
                    echoCancellation: settings.echoCancellation,
                    noiseSuppression: settings.noiseSuppression,
                    autoGainControl: settings.autoGainControl,
                    sampleRate: settings.sampleRate,
                    channelCount: settings.channelCount,
                });
                
                devLog('🎤 Audio track constraints:', {
                    echoCancellation: constraints.echoCancellation,
                    noiseSuppression: constraints.noiseSuppression,
                    autoGainControl: constraints.autoGainControl,
                });
                
                // ✅ CRITICAL FIX: إعادة تطبيق constraints إذا لم يتم تطبيقها بشكل صحيح
                // هذا يضمن أن echo cancellation يعمل حتى لو لم يتم تطبيقه في getUserMedia
                if (!settings.echoCancellation || settings.echoCancellation === false) {
                    console.warn('⚠️ WARNING: Echo cancellation is NOT enabled in settings! Attempting to reapply...');
                    
                    // محاولة إعادة تطبيق constraints
                    try {
                        await audioTrack.applyConstraints({
                            echoCancellation: true, // ✅ CRITICAL: يحسن STT accuracy
                            noiseSuppression: true, // ✅ CRITICAL: يحسن STT accuracy
                            autoGainControl: false,
                            voiceIsolation: true, // ✅ Enhanced voice isolation
                            // ✅ CRITICAL FIX: إعدادات إضافية لتقليل التقاط الأصوات المحيطة وتحسين STT
                            sampleSize: 16, // 16-bit samples
                            sampleRate: { ideal: 16000 }, // ✅ CRITICAL: يحسن STT accuracy (ideal فقط لتجنب فشل applyConstraints)
                        });
                        
                        // التحقق مرة أخرى
                        const newSettings = audioTrack.getSettings();
                        if (newSettings.echoCancellation) {
                            devLog('✅ Echo cancellation re-enabled successfully via applyConstraints');
                } else {
                            console.error('❌ CRITICAL: Failed to enable echo cancellation - this WILL cause echo!');
                            alert(t('videoInterview_echoWarningDisabled'));
                        }
                    } catch (constraintError) {
                        console.error('❌ CRITICAL: Failed to apply echo cancellation constraints:', constraintError);
                        alert(t('videoInterview_echoWarningFailed'));
                    }
                } else {
                    // ✅ FIX: تحديث التحذير - الحل الصحيح هو تعطيل الميكروفون عند كلام الـ Agent
                    devLog('✅ Echo cancellation enabled - Microphone will be muted when Agent speaks to prevent echo');
                }
            }
            
            // عرض فيديو المستخدم
            if (userVideoRef.current) {
                userVideoRef.current.srcObject = stream;
                // التأكد من تشغيل الفيديو
                userVideoRef.current.play().catch(err => {
                    console.error('Error playing user video:', err);
                });
                devLog('✅ User video stream set:', {
                    videoTracks: stream.getVideoTracks().length,
                    audioTracks: stream.getAudioTracks().length,
                    active: stream.active,
                    videoTrackEnabled: stream.getVideoTracks()[0]?.enabled
                });
            } else {
                // هذا طبيعي - الفيديو سيتم تعيينه لاحقاً في useEffect
                // console.warn('⚠️ userVideoRef.current is null - video element not ready yet');
            }

            // 2. بدء المقابلة في Backend (سيبدأ الـ Agent تلقائياً)
            const startResponse = await fetch(`${API_BASE}/api/video-interview/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    candidateId: effectiveCandidateId,
                    campaignId: campaignId,
                    applicationId: resolvedApplicationId || undefined,
                    interviewMode: 'video',
                    language:
                        parseInterviewUrlLanguage(searchParams.get('language')) || currentLang,
                })
            });

            const startData = await startResponse.json();

            if (abortStartIfStale('after /api/video-interview/start')) {
                return;
            }

            if (
                startResponse.status === 409 ||
                startData?.code === INTERVIEW_LINK_ALREADY_USED
            ) {
                setVideoLinkBlocked(true);
                setCountdownActive(false);
                setPreparationTime(PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0);
                alert(t('interviewLinkBlocked_message'));
                return;
            }

            if (!startData.success) {
                throw new Error(startData.message || 'Failed to start interview');
            }

            // حفظ session ID
            const newSessionId = startData.sessionId;
            setSessionId(newSessionId);

            // 3. الاتصال بـ LiveKit Room (الـ Agent سيبدأ تلقائياً من Backend)
            if (startData.livekit && startData.livekit.roomName && startData.livekit.token && startData.livekit.url) {
                try {
                    // التحقق من أن token هو string
                    const token = startData.livekit.token;
                    if (typeof token !== 'string') {
                        console.error('❌ LiveKit token from backend is not a string:', typeof token, token);
                        throw new Error('Invalid LiveKit token from backend');
                    }
                    
                    devLog('🔌 Connecting to LiveKit Room...', {
                        roomName: startData.livekit.roomName,
                        url: startData.livekit.url,
                        tokenType: typeof token,
                        tokenLength: token.length
                    });
                    
                    setLivekitRoomName(startData.livekit.roomName);
                    setLivekitToken(token); // تأكد من أنه string
                    setLivekitUrl(startData.livekit.url);
                    
                    // سيتم الاتصال في useEffect منفصل
                } catch (livekitError) {
                    console.error('❌ CRITICAL: Failed to connect to LiveKit:', livekitError?.message || livekitError);
                    console.error('❌ LiveKit is REQUIRED. Interview cannot proceed without LiveKit.');
                    alert(t('videoInterview_liveKitFailed'));
                    throw livekitError; // Fail loudly instead of falling back
                }
            } else {
                console.error('❌ CRITICAL: LiveKit not available in response from backend');
                console.error('❌ LiveKit is REQUIRED. Interview cannot proceed without LiveKit.');
                alert(t('videoInterview_liveKitUnavailable'));
                throw new Error('LiveKit is required but not available');
            }

            if (abortStartIfStale('before activating interview session')) {
                return;
            }

            setIsInterviewActive(true);
            isInterviewActiveRef.current = true;  // ⚠️ CRITICAL: تحديث ref أيضاً
            interviewStartedAtRef.current = Date.now();
            setIsConnected(true);
            livekitConnectedRef.current = true;  // ⚠️ CRITICAL: تحديث ref أيضاً
        } catch (error) {
            console.error('❌ Error starting interview:', error);
            
            // معالجة أنواع مختلفة من الأخطاء
            let errorMessage = `${t('videoInterview_startFailed')} `;
            
            if (error.message?.includes('getUserMedia')) {
                errorMessage += t('videoInterview_permissionDenied');
            } else if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
                errorMessage += t('videoInterview_networkError');
            } else if (error.message?.includes('404')) {
                errorMessage += t('videoInterview_candidateNotFound');
            } else {
                errorMessage += error.message || t('videoInterview_tryAgain');
            }
            
            alert(errorMessage);
            setCountdownActive(false);
            setPreparationTime(PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0);
            setAvatarVideoSurfaceReady(false);
        } finally {
            isStartingRef.current = false;
        }
    };

    // Audio path: LiveKit only (no backend WS STT). Legacy cleanup: endInterview().

    // إنهاء المقابلة — options.force: true يتجاوز الحارس (unmount / إغلاق الصفحة)
    const endInterview = async (options = {}) => {
        const force = options.force === true;
        if (!force && interviewStartedAtRef.current != null) {
            const elapsed = Date.now() - interviewStartedAtRef.current;
            if (elapsed < MIN_MS_BEFORE_END_BUTTON) {
                console.warn(
                    '⏭️ endInterview ignored: too soon after start (',
                    elapsed,
                    'ms). Prevents ghost click when Start button swaps to End.'
                );
                return;
            }
        }

        if (isEndingInterviewRef.current) {
            console.warn('⏭️ endInterview ignored: shutdown already in progress (duplicate call)');
            return;
        }
        isEndingInterviewRef.current = true;
        setIsEndingInterview(true);
        sessionEpochRef.current += 1;

        try {
            devLog('endInterview() starting');
            if (avatarMicUnmuteTimerRef.current != null) {
                clearTimeout(avatarMicUnmuteTimerRef.current);
                avatarMicUnmuteTimerRef.current = null;
            }
            if (avatarVideoUnsubDebounceRef.current != null) {
                clearTimeout(avatarVideoUnsubDebounceRef.current);
                avatarVideoUnsubDebounceRef.current = null;
            }
            if (livekitReconnectedSyncTimerRef.current != null) {
                clearTimeout(livekitReconnectedSyncTimerRef.current);
                livekitReconnectedSyncTimerRef.current = null;
            }
            if (agentUiAudioIdleTimerRef.current != null) {
                clearTimeout(agentUiAudioIdleTimerRef.current);
                agentUiAudioIdleTimerRef.current = null;
            }
            if (reconnectingHardResetTimerRef.current != null) {
                clearTimeout(reconnectingHardResetTimerRef.current);
                reconnectingHardResetTimerRef.current = null;
            }
            setConnectionError(null);
            prevAgentStateForMicRef.current = null;
            isAgentSpeakingRef.current = false;
            videoTrackAttachedRef.current = false;
            attachedAvatarVideoTrackSidRef.current = null;
            avatarVideoPublicationRef.current = null;
            pendingAvatarVideoPublicationRef.current = null;
            setPendingVideoTrack(null);
            setAvatarVideoSurfaceReady(false);
            setCountdownActive(false);
            setPreparationTime(PREPARATION_COUNTDOWN_SECONDS > 0 ? PREPARATION_COUNTDOWN_SECONDS : 0);

            // ✅ FIX: إعادة تفعيل الميكروفون عند انتهاء المقابلة
            if (micTrackRef.current) {
                micTrackRef.current.enabled = true;
                devLog('🎤 Microphone re-enabled on interview end');
            }
            

            // ✅ CRITICAL FIX: تنظيف جميع المسارات الصوتية القديمة (لا نترك أي شيء معطل)
            
            // ✅ FIX: إغلاق Audio WebSocket (حتى لو كان معطل - تنظيف شامل)
            if (audioWebSocketRef.current) {
                try {
                    if (audioWebSocketRef.current.readyState === WebSocket.OPEN || 
                        audioWebSocketRef.current.readyState === WebSocket.CONNECTING) {
                        audioWebSocketRef.current.close();
                    }
                    audioWebSocketRef.current = null;
                    devLog('✅ Audio WebSocket cleaned up (even if disabled)');
                } catch (wsError) {
                    console.warn('⚠️ Error closing audio WebSocket:', wsError);
                }
            }

            // ✅ FIX: تنظيف AudioContext و AudioProcessor
            if (audioProcessorRef.current) {
                try {
                    audioProcessorRef.current.disconnect();
                    audioProcessorRef.current = null;
                    devLog('✅ Audio processor cleaned up');
                } catch (e) {
                    console.warn('⚠️ Error disconnecting audio processor:', e);
                }
            }
            if (audioContextRef.current) {
                try {
                    if (audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close();
                    }
                    audioContextRef.current = null;
                    devLog('✅ Audio context cleaned up');
                } catch (e) {
                    console.warn('⚠️ Error closing audio context:', e);
                }
            }
            
            // ✅ CRITICAL FIX: تنظيف clonedAudioTrackRef (لا نترك أي شيء معطل)
            if (clonedAudioTrackRef.current) {
                try {
                    if (clonedAudioTrackRef.current.stop) {
                        clonedAudioTrackRef.current.stop();
                    }
                    clonedAudioTrackRef.current = null;
                    devLog('✅ Cloned audio track cleaned up');
                } catch (e) {
                    console.warn('⚠️ Error stopping cloned audio track:', e);
                }
            }
            
            // ✅ CRITICAL FIX: تنظيف جميع audio elements من DOM (منع audio elements قديمة)
            try {
                const allAudioElements = document.querySelectorAll('audio');
                allAudioElements.forEach((audioEl) => {
                    // ✅ تنظيف audio elements التي ليست audioRef.current
                    if (audioEl !== audioRef.current) {
                        try {
                            // إيقاف الصوت
                            audioEl.pause();
                            audioEl.src = '';
                            audioEl.srcObject = null;
                            // إزالة من DOM
                            if (audioEl.parentNode) {
                                audioEl.parentNode.removeChild(audioEl);
                            }
                            devLog('✅ Removed old audio element from DOM');
                        } catch (removeError) {
                            console.warn('⚠️ Error removing audio element:', removeError);
                        }
                    }
                });
                devLog(`✅ Cleaned up ${allAudioElements.length} audio element(s) from DOM`);
            } catch (cleanupError) {
                console.warn('⚠️ Error cleaning up audio elements:', cleanupError);
            }

            if (videoWebSocketRef.current) {
                try {
                    if (videoWebSocketRef.current.readyState === WebSocket.OPEN) {
                        videoWebSocketRef.current.close();
                    }
                    videoWebSocketRef.current = null;
                    devLog('✅ Video WebSocket closed');
                } catch (wsError) {
                    console.warn('⚠️ Error closing video WebSocket:', wsError);
                }
            }

            // إرسال طلب إنهاء المقابلة إلى Backend (سيوقف الـ Agent)
            if (sessionId) {
                try {
                    const response = await fetch(`${API_BASE}/api/video-interview/end`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            sessionId: sessionId,
                            conversationHistory: serializeTranscript(conversationHistoryRef.current)
                        })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        devLog('✅ Interview ended successfully:', data);
                    } else {
                        const errorText = await response.text();
                        // ✅ STEP 2: Frontend Error Semantics - 400 = WARN (ليس Fatal)
                        if (response.status === 400) {
                            console.warn('⚠️ Bad Request (400) - interview session may already be closed:', errorText);
                            // ✅ STEP 2: لا ننهي المقابلة - هذا طبيعي إذا session مغلق بالفعل
                        } else {
                        console.warn('⚠️ Failed to end interview session:', response.status, response.statusText, errorText);
                        }
                    }
                } catch (fetchError) {
                    // ✅ STEP 2: Error ending session = WARN (ليس ERROR) - non-critical
                    console.warn('⚠️ Error ending interview session (non-critical):', fetchError);
                    // نتابع حتى لو فشل الطلب - هذا غير حرج
                }
            } else {
                console.warn('⚠️ No sessionId to end interview');
            }

            // إغلاق LiveKit Room بعد إيقاف الـ Agent
            const currentRoom = livekitRoomRef.current;
            if (currentRoom && (currentRoom.state === 'connected' || currentRoom.state === 'connecting')) {
                try {
                    devLog('🔌 Disconnecting from LiveKit Room...');
                    await currentRoom.disconnect();
                    devLog('✅ LiveKit Room disconnected');
                } catch (disconnectError) {
                    console.warn('⚠️ Error disconnecting from Room:', disconnectError);
                }
            }
            setLivekitRoom(null);
            livekitRoomRef.current = null;

        // ✅ CRITICAL FIX: إيقاف الميكروفون والكاميرا (تنظيف شامل)
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => {
                try {
                    track.stop();
                    devLog(`✅ Stopped track: ${track.kind} (${track.id})`);
                } catch (trackError) {
                    console.warn(`⚠️ Error stopping track ${track.id}:`, trackError);
                }
            });
            mediaStreamRef.current = null;
            devLog('✅ MediaStream cleaned up');
        }
        
        // ✅ CRITICAL FIX: تنظيف micTrackRef
        if (micTrackRef.current) {
            try {
                if (micTrackRef.current.stop) {
                    micTrackRef.current.stop();
                }
                micTrackRef.current = null;
                devLog('✅ Mic track reference cleaned up');
            } catch (micError) {
                console.warn('⚠️ Error stopping mic track:', micError);
            }
        }
        
        // ✅ CRITICAL FIX: تنظيف audioRef (منع أي audio قديم)
        if (audioRef.current) {
            try {
                audioRef.current.pause();
                audioRef.current.src = '';
                audioRef.current.srcObject = null;
                devLog('✅ AudioRef cleaned up');
            } catch (audioRefError) {
                console.warn('⚠️ Error cleaning up audioRef:', audioRefError);
            }
        }
        
        // ✅ CRITICAL FIX: تنظيف attachedAudioTracksRef
        if (attachedAudioTracksRef.current) {
            attachedAudioTracksRef.current.clear();
            devLog('✅ Attached audio tracks reference cleared');
        }

        // ✅ AudioContext removed - LiveKit handles all audio

        setIsInterviewActive(false);
        isInterviewActiveRef.current = false;
        interviewStartedAtRef.current = null;
        setUserLiveCaption('');
        setAssistantLiveCaption('');
        setIsConnected(false);
        setSessionId(null);
        setLivekitRoomName(null);
        setLivekitToken(null);
        setLivekitUrl(null);
        devLog('endInterview() completed');
        } catch (error) {
            console.error('Error in endInterview:', error);
        } finally {
            isEndingInterviewRef.current = false;
            setIsEndingInterview(false);
        }
    };

    // إغلاق الجلسة عند مغادرة الصفحة فعلياً (تبويب، تحديث، إغلاق)
    // لا نعتمد على useEffect cleanup لاستدعاء endInterview — في React 18 Strict Mode يُستدعى cleanup
    // مرتين أثناء التطوير ولا يمكن تمييزه بشكل موثوق عن unmount الحقيقي.
    // حدث pagehide لا يُطلق عند remount الوهمي لـ Strict Mode، فيُستخدم كنسخة احتياطية آمنة.
    useEffect(() => {
        const onPageHide = () => {
            if (!isInterviewActiveRef.current) return;
            const room = livekitRoomRef.current;
            if (!room || room.state === 'disconnected') return;
            try {
                devLog('🧹 pagehide: disconnecting LiveKit room (tab close / navigate away)');
                room.disconnect();
            } catch (e) {
                console.warn('⚠️ pagehide disconnect:', e);
            }
        };
        window.addEventListener('pagehide', onPageHide);
        return () => window.removeEventListener('pagehide', onPageHide);
    }, []);

    if (videoLinkBlocked || isVideoInterviewLinkConsumed(candidate)) {
        return (
            <InterviewLinkBlocked
                title={t('interviewLinkBlocked_title')}
                message={t('interviewLinkBlocked_message')}
                dir={isRtl ? 'rtl' : 'ltr'}
            />
        );
    }

    if (!prepDone) {
        return (
            <VoiceInterviewPrepTips
                title={t('publicVideoScreening_title')}
                subtitle={candidateSubtitle}
                onContinue={() => setPrepDone(true)}
                dir={isRtl ? 'rtl' : 'ltr'}
            />
        );
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(160deg, #f5f3ff 0%, #eef2ff 40%, #f8fafc 100%)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
        }}>
            {/* Background Effects */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(circle at 20% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(56, 189, 248, 0.08) 0%, transparent 50%)',
                pointerEvents: 'none'
            }}></div>

            {/* Main Content */}
            <div style={{
                position: 'relative',
                zIndex: 1,
                maxWidth: '1200px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '40px'
            }}>
                {/* Header */}
                <div style={{
                    textAlign: 'center',
                    marginBottom: '20px'
                }}>
                    <h1
                        style={{
                            fontSize: '30px',
                        fontWeight: 700,
                            margin: 0,
                            background: 'linear-gradient(135deg, #60A5FA, #3B82F6)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        }}
                    >
                        {t('publicVideoScreening_title')}
                    </h1>
                    <p style={{ margin: '12px 0 0', fontSize: '0.9rem', color: '#475569' }}>
                        {candidateSubtitle}
                    </p>
                    
                    {/* Candidate ID Input (للتطوير) */}
                    {!effectiveCandidateId && (
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.06)',
                            border: '2px solid rgba(239, 68, 68, 0.28)',
                            borderRadius: '12px',
                            padding: '20px',
                            marginTop: '20px',
                            maxWidth: '500px',
                            margin: '20px auto 0'
                        }}>
                            <p style={{
                                color: '#dc2626',
                                fontSize: '16px',
                                marginBottom: '12px',
                                fontWeight: 600
                            }}>
                                ⚠️ {t('videoInterview_candidateIdRequired')}
                            </p>
                            <input
                                type="text"
                                placeholder={t('videoInterview_candidateIdPlaceholder')}
                                value={manualCandidateId}
                                onChange={(e) => setManualCandidateId(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    border: '2px solid rgba(239, 68, 68, 0.28)',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    fontSize: '14px',
                                    outline: 'none'
                                }}
                            />
                            <p style={{
                                color: '#64748b',
                                fontSize: '12px',
                                marginTop: '8px',
                                textAlign: 'center'
                            }}>
                                {t('videoInterview_candidateIdUrlHint')}
                            </p>
                        </div>
                    )}
                </div>

                {/* غطاء بعد Start: عدّ بصري 30→0 (افتراضي) — يُخفى فور جاهزية فيديو الأفاتار أو بعد مهلة أمان */}
                {countdownActive && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(248, 250, 252, 0.92)',
                        backdropFilter: 'blur(20px)'
                    }}>
                        <div style={{
                            background: '#ffffff',
                        backdropFilter: 'blur(20px)',
                        border: '2px solid rgba(99, 102, 241, 0.28)',
                        borderRadius: '20px',
                        padding: '40px 60px',
                        textAlign: 'center',
                        boxShadow: '0 20px 60px rgba(99, 102, 241, 0.15)'
                    }}>
                        {PREPARATION_COUNTDOWN_SECONDS > 0 ? (
                        <div style={{
                                fontSize: '120px',
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #22d3ee, #60A5FA)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                                marginBottom: '24px',
                            lineHeight: '1'
                        }}>
                            {preparationTime}
                        </div>
                        ) : (
                        <div
                            aria-hidden
                            style={{
                                width: 56,
                                height: 56,
                                margin: '0 auto 24px',
                                borderRadius: '50%',
                                border: '3px solid rgba(34, 211, 238, 0.25)',
                                borderTopColor: 'rgba(34, 211, 238, 0.95)',
                                animation: 'niAvatarLoadSpin 0.85s linear infinite',
                            }}
                        />
                        )}
                        <h2 style={{
                            fontSize: '24px',
                            color: '#0f172a',
                            marginBottom: 0,
                            fontWeight: 600
                        }}>
                            {PREPARATION_COUNTDOWN_SECONDS > 0 ? t('videoInterview_preparingTitle') : t('videoInterview_preparingLoading')}
                        </h2>
                        <p style={{
                            fontSize: '15px',
                            color: '#64748b',
                            marginTop: '12px',
                            marginBottom: 0,
                            lineHeight: 1.6,
                            maxWidth: '320px'
                        }}>
                            {t('videoInterview_connectingNotice')}
                        </p>
                        </div>
                    </div>
                )}


                {/* Video Interview Interface - Avatar + Transcript Layout */}
                {/* ⚠️ CRITICAL: استخدام key ثابت لمنع re-render */}
                {isReady && (
                    <div 
                        key="video-interview-interface" // ✅ CRITICAL: key ثابت لمنع re-render
                        style={{
                            width: '100%',
                            maxWidth: '1400px',
                            display: 'grid',
                            gridTemplateColumns: showTranscriptPanel ? '2fr 1fr' : '1fr',
                            gap: '20px',
                            marginTop: '20px',
                            marginBottom: '20px', // ✅ FIX: إضافة margin-bottom
                            minHeight: '600px',
                            visibility: 'visible',
                            opacity: 1,
                            // ✅ FIX: إضافة position وz-index للتأكد من أنه داخل viewport
                            position: 'relative',
                            zIndex: 1,
                            // ✅ FIX: إضافة box-sizing
                            boxSizing: 'border-box',
                            // ✅ FIX: إضافة padding للتأكد من أن المحتوى ليس ملتصق بالحواف
                            padding: '0'
                        }}
                    >
                        {connectionError && isInterviewActive && (
                            <div
                                role="alert"
                                style={{
                                    gridColumn: '1 / -1',
                                    marginBottom: '4px',
                                    padding: '12px 16px',
                                    borderRadius: '10px',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.45)',
                                    color: '#fecaca',
                                    fontSize: '14px',
                                    lineHeight: 1.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                }}
                            >
                                <span>{connectionError}</span>
                                <button
                                    type="button"
                                    onClick={() => setConnectionError(null)}
                                    style={{
                                        flexShrink: 0,
                                        padding: '6px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255,255,255,0.35)',
                                        background: 'rgba(0,0,0,0.25)',
                                        color: '#fff',
                                        cursor: 'pointer',
                                    }}
                                >
                                    إغلاق
                                </button>
                            </div>
                        )}

                        {/* Avatar host: مكون معزول — حاوية DOM ثابتة؛ مسار الفيديو عبر ref واحد (يقلل flicker عند unmount/Strict Mode) */}
                        <AvatarHostContainer onContainerNode={onAvatarHostContainerNode}>
                            {/* الأفاتار يظهر دائماً - حتى قبل Start Interview */}
                            <>
                                {/* Container صغير للكاميرا والصورة داخل الأفاتار */}
                                {isInterviewActive && mediaStreamRef.current && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: '20px',
                                        right: '20px',
                                        width: '200px',
                                        height: '150px',
                                        background: 'rgba(15, 23, 42, 0.95)',
                                        border: '2px solid rgba(16, 185, 129, 0.5)',
                                        borderRadius: '12px',
                                        overflow: 'hidden',
                                        zIndex: 20,
                                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
                                    }}>
                                        <video
                                            ref={userVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover',
                                                transform: 'scaleX(-1)', // Mirror effect
                                                backgroundColor: '#000'
                                            }}
                                        />
                                    </div>
                                )}

                            </>
                        </AvatarHostContainer>

                        {/* Transcript: localhost only — hidden in production (desktop + mobile) */}
                        {showTranscriptPanel ? (
                        <div 
                            style={{
                                gridColumn: '2', // ✅ FIX: التأكد من أن Transcript في الـ column الثاني (الصغير)
                            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(99, 102, 241, 0.22)',
                            borderRadius: '16px',
                            padding: '0',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '600px', // ✅ FIX: حجم ثابت - لا يتغير
                            maxHeight: '600px', // ✅ FIX: حد أقصى ثابت
                            overflow: 'hidden', // ✅ Container لا يمرر - فقط Messages area
                            boxShadow: '0 8px 32px rgba(99, 102, 241, 0.12)'
                        }}>
                            {/* Chat Header - مثل الصورة */}
                            <div style={{
                                padding: '20px 24px',
                                borderBottom: '1px solid rgba(99, 102, 241, 0.14)',
                                background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                                position: 'relative'
                            }}>
                                <div style={{
                                    color: '#0f172a',
                                    fontSize: '20px',
                                    fontWeight: 700,
                                    letterSpacing: '0.5px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span>💬</span>
                                    <span>{t('videoInterview_chat')}</span>
                                </div>
                            </div>
                            
                            {/* Messages Container - فقط هذا ينزل للأسفل */}
                            <div 
                                ref={messagesContainerRef}
                                style={{
                                flex: 1,
                                    minHeight: 0, // ✅ CRITICAL: يسمح للـ flex child بالتمرير
                                    overflowY: 'auto', // ✅ فقط Messages area تتمرر
                                    overflowX: 'hidden',
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                    gap: '16px',
                                    scrollBehavior: 'smooth' // ✅ تمرير سلس
                                }}
                            >
                                {(() => {
                                    const chatMessages = conversationHistory;
                                    const lastIdx = chatMessages.length - 1;
                                    const lastMsg = lastIdx >= 0 ? chatMessages[lastIdx] : null;
                                    const hasAssistantLiveCaption = Boolean(
                                        assistantLiveCaption && assistantLiveCaption.trim()
                                    );
                                    const hasUserLiveCaption = Boolean(
                                        userLiveCaption && userLiveCaption.trim()
                                    );
                                    /** تدفق واحد في آخر فقاعة مساعد/مستخدم — لا فقاعة ثانية تحتها */
                                    const mergeAssistantIntoLast =
                                        hasAssistantLiveCaption &&
                                        lastMsg &&
                                        lastMsg.role === 'assistant';
                                    const mergeUserIntoLast =
                                        hasUserLiveCaption &&
                                        lastMsg &&
                                        lastMsg.role === 'user';
                                    const showStandaloneAssistantCaption =
                                        hasAssistantLiveCaption && !mergeAssistantIntoLast;
                                    const showStandaloneUserCaption =
                                        hasUserLiveCaption && !mergeUserIntoLast;

                                    if (
                                        chatMessages.length === 0 &&
                                        !showStandaloneAssistantCaption &&
                                        !showStandaloneUserCaption
                                    ) {
                                        return null;
                                    }

                                        return (
                                        <>
                                            {chatMessages.map((msg, idx) => {
                                                const isLast = idx === lastIdx;
                                                const isUser = msg.role === 'user';
                                                let rowStreaming = msg.isFinal === false;
                                                let displayContent = msg.content || '';

                                                if (
                                                    isLast &&
                                                    mergeAssistantIntoLast &&
                                                    msg.role === 'assistant'
                                                ) {
                                                    displayContent = mergeLiveCaptionWithStored(
                                                        msg.content,
                                                        assistantLiveCaption
                                                    );
                                                    rowStreaming = hasAssistantLiveCaption;
                                                } else if (
                                                    isLast &&
                                                    mergeUserIntoLast &&
                                                    msg.role === 'user'
                                                ) {
                                                    displayContent = mergeLiveCaptionWithStored(
                                                        msg.content,
                                                        userLiveCaption
                                                    );
                                                    rowStreaming = hasUserLiveCaption;
                                                }

                                                const bubbleColor = isUser
                                                    ? rowStreaming
                                                        ? '#64748b'
                                                        : '#334155'
                                                    : rowStreaming
                                                      ? '#6366f1'
                                                      : '#4f46e5';
                                    return (
                                                <div
                                                        key={`chat-${idx}-${rowStreaming ? 'p' : 'f'}-${displayContent?.substring(0, 12)}`}
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '4px',
                                                            alignSelf: isUser
                                                                ? 'flex-end'
                                                                : 'flex-start',
                                                            maxWidth: '85%',
                                                            minWidth: 0,
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                color: bubbleColor,
                                                        fontSize: '15px',
                                                        lineHeight: '1.6',
                                                        padding: '12px 16px',
                                                        borderRadius: '12px',
                                                                background: isUser
                                                                    ? rowStreaming
                                                                        ? 'rgba(16, 185, 129, 0.12)'
                                                                        : 'rgba(16, 185, 129, 0.2)'
                                                                    : rowStreaming
                                                                      ? 'rgba(34, 211, 238, 0.12)'
                                                            : 'rgba(34, 211, 238, 0.15)',
                                                                border: isUser
                                                                    ? rowStreaming
                                                                        ? '1px dashed rgba(16, 185, 129, 0.35)'
                                                                        : '1px solid rgba(16, 185, 129, 0.3)'
                                                                    : rowStreaming
                                                                      ? '1px dashed rgba(34, 211, 238, 0.45)'
                                                                      : '1px solid rgba(34, 211, 238, 0.3)',
                                                                fontStyle: rowStreaming
                                                                    ? 'italic'
                                                                    : 'normal',
                                                        wordWrap: 'break-word',
                                                                whiteSpace: 'pre-wrap',
                                                                overflowWrap: 'anywhere',
                                                            }}
                                                        >
                                                            {displayContent || '(empty message)'}
                                                    </div>
                                                </div>
                                                );
                                            })}
                                            {showStandaloneAssistantCaption && (
                                                <div
                                                    style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '4px',
                                                        alignSelf: 'flex-start',
                                                        maxWidth: '85%',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            color: '#a5f3fc',
                                                            fontSize: '15px',
                                                            lineHeight: '1.6',
                                                        padding: '12px 16px',
                                                        borderRadius: '12px',
                                                            background: 'rgba(34, 211, 238, 0.12)',
                                                            border: '1px dashed rgba(34, 211, 238, 0.45)',
                                                        fontStyle: 'italic',
                                                            wordWrap: 'break-word',
                                                            whiteSpace: 'pre-wrap',
                                                        }}
                                                    >
                                                        {assistantLiveCaption}
                                                    </div>
                                                </div>
                                            )}
                                            {showStandaloneUserCaption && (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '4px',
                                                        alignSelf: 'flex-end',
                                                        maxWidth: '85%',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            color: '#CBD5E1',
                                                            fontSize: '15px',
                                                            lineHeight: '1.6',
                                                            padding: '12px 16px',
                                                            borderRadius: '12px',
                                                            background: 'rgba(16, 185, 129, 0.12)',
                                                            border: '1px dashed rgba(16, 185, 129, 0.35)',
                                                            fontStyle: 'italic',
                                                            wordWrap: 'break-word',
                                                            whiteSpace: 'pre-wrap',
                                                        }}
                                                    >
                                                        {userLiveCaption}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                            
                            {/* Input Area (للرسائل النصية في المستقبل) */}
                            {isInterviewActive && (
                                <div style={{
                                    padding: '16px 20px',
                                    borderTop: '1px solid rgba(99, 102, 241, 0.16)',
                                    background: '#f8fafc',
                                    display: 'flex',
                                    gap: '12px',
                                    alignItems: 'center'
                                }}>
                                    <input
                                        type="text"
                                        placeholder={t('videoInterview_typeMessage')}
                                        style={{
                                            flex: 1,
                                            background: '#ffffff',
                                            border: '1px solid rgba(99, 102, 241, 0.28)',
                                            borderRadius: '8px',
                                            padding: '10px 16px',
                                            color: '#0f172a',
                                            fontSize: '14px',
                                            outline: 'none'
                                        }}
                                        disabled
                                    />
                                    <button
                                        style={{
                                            background: 'rgba(99, 102, 241, 0.12)',
                                            border: '1px solid rgba(99, 102, 241, 0.4)',
                                            borderRadius: '8px',
                                            padding: '10px 24px',
                                            color: '#4f46e5',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'not-allowed',
                                            opacity: 0.5
                                        }}
                                        disabled
                                    >
                                        {t('videoInterview_send')}
                                    </button>
                                </div>
                            )}
                        </div>
                        ) : null}
                    </div>
                )}

                {/* Audio Element (optional - for playing audio from Backend if needed) */}
                <audio ref={audioRef} autoPlay style={{ display: 'none' }} />

                {/* Interview Controls */}
                {isReady && (
                    <div className="vi-interview-controls">
                        {!isInterviewActive ? (
                            <button
                                type="button"
                                onClick={startInterview}
                                disabled={!effectiveCandidateId || countdownActive}
                                aria-label={t('videoInterview_startAria')}
                                title={t('videoInterview_startAria')}
                                className="workflow-btn-primary ni-continue-btn"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px',
                                    padding: '14px 28px',
                                    fontSize: '1.05rem',
                                    fontWeight: '600',
                                    cursor:
                                        effectiveCandidateId && !countdownActive ? 'pointer' : 'not-allowed',
                                    opacity: effectiveCandidateId && !countdownActive ? 1 : 0.6,
                                    width: '100%',
                                    maxWidth: '420px',
                                    boxSizing: 'border-box',
                                }}
                            >
                                <span style={{ fontSize: '1.25rem' }}>▶</span>
                                <span>{t('videoInterview_start')}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="vi-end-interview-btn"
                                disabled={!endInterviewButtonEnabled || isEndingInterview}
                                title={
                                    isEndingInterview
                                        ? t('videoInterview_endingTitle')
                                        : endInterviewButtonEnabled
                                          ? t('videoInterview_endTitle')
                                          : t('videoInterview_endAvailableSoon')
                                }
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!endInterviewButtonEnabled || isEndingInterview) return;
                                    endInterview({ force: false });
                                }}
                            >
                                {isEndingInterview
                                    ? `⏳ ${t('videoInterview_endingTitle')}`
                                    : endInterviewButtonEnabled
                                      ? `🛑 ${t('videoInterview_endTitle')}`
                                      : `⏳ ${t('videoInterview_endTitle')}`}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Voice/video handled via backend + LiveKit */}
            {/* Frontend only displays video/audio received from Backend */}

            {/* CSS Animation for avatar loading */}
            <style>{`
                @keyframes niAvatarLoadSpin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default VideoInterviewCall;

