// ============================================
// ملف: routes/videoInterview.ts
// الوظيفة: Routes للمقابلة بالفيديو
// ============================================

import express from 'express';
import Candidate from '../models/Candidate.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import HeadHunterSourcingContext from '../models/HeadHunterSourcingContext.js';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { getOrgId } from '../middleware/auth.js';
import { checkCredits } from '../services/billingRuntimeService.js';
import {
    finalizeUsageReservation,
    reserveUsage,
} from '../services/usageReservationService.js';
import { startVideoSession, consumeVideoSeconds, type StartVideoResult } from '../services/videoBillingService.js';
import { emitDomainEventBestEffort } from '../services/domainEventService.js';
import type { UsageType } from '../types/billing.js';
import { transcribeAudio } from '../services/sttService.js';
import { createLiveKitRoom, createUserToken, dispatchAgentToRoom, deleteLiveKitRoom } from '../services/livekitService.js';
import { stopAgent } from '../services/agentService.js';
import { sendVideoTranscriptToN8N } from '../services/n8nService.js';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';
import {
    hasMeaningfulConversation,
    isVideoLinkConsumedById,
    markVideoLinkConsumed,
    INTERVIEW_LINK_ALREADY_USED,
} from '../services/interviewLinkAccess.js';
import {
    buildBlueprintSnapshot,
    ensureBlueprintForCampaign,
    getLockedBlueprintForCampaign,
    isBlueprintFeatureEnabled,
    type LockedBlueprintBundle,
} from '../services/expertise/ensureBlueprint.js';
import {
    applyBlueprintMetadataToLiveKit,
    buildBlueprintMetadata,
} from '../services/expertise/blueprintMetadata.js';

const router = express.Router();

function rejectIfStageCallbackSecurityMisconfigured(res: express.Response): boolean {
    try {
        assertStageOutboundSecurityForTrigger();
        return false;
    } catch (err) {
        if (err instanceof StageCallbackConfigurationError) {
            res.status(503).json({
                success: false,
                error: 'Stage callback security is not configured',
            });
            return true;
        }
        throw err;
    }
}

/**
 * ✅ FIX: منع إنشاء غرفتين لنفس المرشح في نفس الوقت (يسبب أفاتار غير مستقر)
 * يُحذف عند /end أو بعد 5 دقائق
 */
const activeCandidateSessions = new Map<string, {
    roomName: string;
    token: string;
    sessionId: string;
    createdAt: number;
    campaignId?: string;
}>();

const ACTIVE_SESSION_TTL_MS = 5 * 60 * 1000; // 5 دقائق

/**
 * Unified credits: interviews are metered by ACTUAL duration at /end.
 * /start only runs a preflight (feature gate + non-zero balance). The
 * preflight checks at least PREFLIGHT_SECONDS of headroom so a session never
 * begins with an empty wallet.
 */
const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';
const PREFLIGHT_SECONDS = 1;
/** Hard cap on a single interview's billable duration (anti-runaway). */
const MAX_INTERVIEW_SECONDS = 60 * 60;

/** Maps the client interview mode to the metered usage type. */
function usageTypeForInterviewMode(mode: string): UsageType {
    return mode === 'video' ? 'VIDEO_SECONDS' : 'VOICE_SECONDS';
}

function billingHttpStatus(code: string): number {
    switch (code) {
        case 'INSUFFICIENT_CREDITS':
        // Out of video minutes (included + purchased) → 402 so the client can
        // surface a "buy video pack" CTA, same payment-required semantics.
        case 'NO_VIDEO_MINUTES':
            return 402;
        case 'FEATURE_DENIED':
        case 'INACTIVE_SUBSCRIPTION':
            return 403;
        case 'ORG_NOT_FOUND':
            return 404;
        default:
            return 400;
    }
}

/**
 * يبني نصاً مختصراً جاهزاً (ROLE CONTEXT) من معايير الحملة — يُرسل للوكيل عبر metadata.
 * نتجنّب إرسال الإعلان الكامل أو المعايير الخام بسبب حد حجم metadata في LiveKit؛
 * لذا نُنتج نصاً مدمجاً (Position / Skills / Experience / Education ... إلخ).
 * يُستهلك كما هو في وكيل بايثون (مصدر واحد للحقيقة).
 */
const ROLE_CONTEXT_SKIP_KEYS = new Set([
    'interviewtype', 'templatetype', 'templatename', 'step', 'timestamp',
    'aicomparetop', 'aicomparetopemails', 'jobpostingid', 'jobid', 'job_id',
]);

function buildCompactRoleContext(criteria?: Record<string, any>, jobAdvertisement?: string): string {
    const lines: string[] = [];
    if (criteria && typeof criteria === 'object') {
        for (const [rawKey, rawVal] of Object.entries(criteria)) {
            if (rawVal == null) continue;
            const key = String(rawKey).trim();
            if (!key || ROLE_CONTEXT_SKIP_KEYS.has(key.toLowerCase())) continue;
            let val = '';
            if (Array.isArray(rawVal)) val = rawVal.map((v) => String(v).trim()).filter(Boolean).join(', ');
            else val = String(rawVal).trim();
            if (!val) continue;
            // نقصّ القيم الطويلة جداً للحفاظ على حجم metadata
            if (val.length > 300) val = `${val.slice(0, 300)}…`;
            const label = key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            lines.push(`- ${label.charAt(0).toUpperCase()}${label.slice(1)}: ${val}`);
        }
    }
    // ملخص قصير جداً من الإعلان (اختياري) — سطر واحد فقط لتجنّب تضخيم metadata
    const ad = (jobAdvertisement || '').trim();
    if (!lines.length && !ad) return '';
    let block = 'These are the JOB requirements (not data the candidate provided). '
        + 'Use them to steer questions toward the role; do NOT assume the candidate possesses any — probe to find out.';
    if (lines.length) block += `\n\nRequirements:\n${lines.join('\n')}`;
    if (ad) {
        const shortAd = ad.length > 600 ? `${ad.slice(0, 600)}…` : ad;
        block += `\n\nJob advertisement (brief reference):\n${shortAd}`;
    }
    return block;
}

/**
 * يبني كتلة role context للمرشحين القادمين من الهيد هانتر (HeadHunterSourcingContext):
 *  - معايير البحث (position/location/experience/query) كمتطلبات للدور.
 *  - خلفية المرشح المستمدة من LinkedIn (للاسترشاد فقط — يجب التحقق منها أثناء المقابلة).
 * يُلحَق بأي role context من الحملة (لا يستبدله) ويُقصّ للحفاظ على حجم metadata.
 */
function buildHeadHunterRoleContext(ctx?: {
    searchCriteria?: Record<string, any> | null;
    candidateProfile?: Record<string, any> | null;
}): string {
    if (!ctx) return '';
    const sections: string[] = [];

    const crit = ctx.searchCriteria && typeof ctx.searchCriteria === 'object' ? ctx.searchCriteria : null;
    if (crit) {
        const labels: Record<string, string> = {
            position: 'Target role',
            location: 'Location',
            yearsExperience: 'Years of experience',
            ageRange: 'Age range',
            query: 'Search brief',
        };
        const lines: string[] = [];
        for (const [key, label] of Object.entries(labels)) {
            let val = typeof crit[key] === 'string' ? crit[key].trim() : '';
            if (!val) continue;
            if (val.length > 300) val = `${val.slice(0, 300)}…`;
            lines.push(`- ${label}: ${val}`);
        }
        if (lines.length) {
            sections.push(
                'These are the SOURCING search criteria the recruiter used to find this candidate '
                    + '(treat as JOB requirements; probe to verify, do NOT assume):\n'
                    + lines.join('\n')
            );
        }
    }

    const prof = ctx.candidateProfile && typeof ctx.candidateProfile === 'object' ? ctx.candidateProfile : null;
    if (prof) {
        const lines: string[] = [];
        const pStr = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
        const title = pStr(prof.current_title) || pStr(prof.headline);
        if (title) lines.push(`- Current title: ${title.length > 200 ? `${title.slice(0, 200)}…` : title}`);
        if (pStr(prof.current_company)) lines.push(`- Current company: ${pStr(prof.current_company)}`);
        if (pStr(prof.location)) lines.push(`- Location: ${pStr(prof.location)}`);
        const years = pStr(prof.years_experience);
        if (years) lines.push(`- Years of experience: ${years}`);
        if (Array.isArray(prof.skills) && prof.skills.length) {
            const skills = prof.skills.map((s: unknown) => pStr(s)).filter(Boolean).slice(0, 20).join(', ');
            if (skills) lines.push(`- Skills: ${skills.length > 300 ? `${skills.slice(0, 300)}…` : skills}`);
        }
        if (Array.isArray(prof.languages) && prof.languages.length) {
            const langs = prof.languages.map((s: unknown) => pStr(s)).filter(Boolean).slice(0, 10).join(', ');
            if (langs) lines.push(`- Languages: ${langs}`);
        }
        const summary = pStr(prof.ai_summary) || pStr(prof.summary);
        if (summary) lines.push(`- Summary: ${summary.length > 400 ? `${summary.slice(0, 400)}…` : summary}`);
        if (lines.length) {
            sections.push(
                'Candidate background (sourced from LinkedIn before the interview — this is UNVERIFIED context, '
                    + 'confirm key claims during the conversation):\n'
                    + lines.join('\n')
            );
        }
    }

    return sections.join('\n\n');
}

/** يدمج كتلة سياق الهيد هانتر مع role context القائم (إن وُجد) دون استبدال. */
function mergeRoleContext(base: string, addition: string): string {
    const b = (base || '').trim();
    const a = (addition || '').trim();
    if (!a) return b;
    if (!b) return a;
    return `${b}\n\n${a}`;
}

/** يجلب حزمة Blueprint المقفلة للحملة بأمان (fail-open) لاستخدامها في metadata/snapshot. */
async function loadBlueprintBundleSafe(campaignId?: string): Promise<LockedBlueprintBundle | null> {
    if (!isBlueprintFeatureEnabled()) return null;
    const id = (campaignId || '').trim();
    if (!id) return null;
    try {
        return await getLockedBlueprintForCampaign(id);
    } catch (err: any) {
        console.warn(`⚠️ loadBlueprintBundleSafe failed for ${id}:`, err?.message || err);
        return null;
    }
}

/** أقصى انتظار عند بدء المقابلة لتوليد Blueprint جارٍ بالفعل (ms). */
const BLUEPRINT_START_WAIT_MS = Math.max(
    0,
    Number(process.env.BLUEPRINT_START_WAIT_MS ?? 30000) || 0
);
const BLUEPRINT_START_POLL_MS = 1000;

/**
 * ينتظر Blueprint الحملة إن كان توليده ما زال جارياً.
 *
 * `ensureBlueprintForCampaign` يُطلَق بلا انتظار عند إنشاء الحملة ويستغرق ~دقيقة.
 * مرشّح يفتح الرابط قبل أن يُقفَل يبدأ مقابلة بلا كفاءات — فيرجع الوكيل لبنك
 * الأسئلة ويصل نصّ المقابلة إلى المصحّح بلا أدلّة كفاءات.
 */
async function awaitBlueprintBundle(campaignId?: string): Promise<LockedBlueprintBundle | null> {
    const first = await loadBlueprintBundleSafe(campaignId);
    if (first || !campaignId || BLUEPRINT_START_WAIT_MS <= 0) return first;

    const deadline = Date.now() + BLUEPRINT_START_WAIT_MS;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, BLUEPRINT_START_POLL_MS));
        const bundle = await loadBlueprintBundleSafe(campaignId);
        if (bundle) {
            console.log(`✅ awaitBlueprintBundle: blueprint landed for ${campaignId} before start`);
            return bundle;
        }
    }
    console.warn(
        `⚠️ awaitBlueprintBundle: no locked blueprint for ${campaignId} after ${BLUEPRINT_START_WAIT_MS}ms — starting without competencies`
    );
    return null;
}

/**
 * يستخرج campaignId عند الإنهاء دون الاعتماد على مستند الجلسة.
 *
 * وضع الاختبار لا يحفظ جلسة، ومسار «إعادة استخدام جلسة» يخرج من /start قبل
 * إنشائها — ففي الحالتين تبقى الجلسة null ويضيع campaignId ومعه لقطة الكفاءات.
 */
async function resolveCampaignIdForEnd(
    session: { campaignId?: unknown } | null,
    candidateId?: string
): Promise<string | undefined> {
    const fromSession =
        typeof session?.campaignId === 'string' ? session.campaignId.trim() : '';
    if (fromSession) return fromSession;
    if (!candidateId || !/^[0-9a-fA-F]{24}$/.test(candidateId)) return undefined;

    const candidate = (await Candidate.findById(candidateId)
        .select('campaignId')
        .lean()
        .catch(() => null)) as { campaignId?: unknown } | null;
    const fromCandidate =
        typeof candidate?.campaignId === 'string' ? candidate.campaignId.trim() : '';
    return fromCandidate || undefined;
}

/** يحمّل لقطة سياق الهيد هانتر من المرشح (إن كان headHunterContextId موجوداً). */
async function loadHeadHunterContextForCandidate(
    candidate: Record<string, any>
): Promise<{ searchCriteria?: Record<string, any> | null; candidateProfile?: Record<string, any> | null } | null> {
    const id = typeof candidate.headHunterContextId === 'string' ? candidate.headHunterContextId.trim() : '';
    if (!id) return null;
    try {
        const ctx = await HeadHunterSourcingContext.findOne({ contextId: id }).lean();
        if (!ctx) return null;
        return {
            searchCriteria: (ctx.searchCriteria as Record<string, any> | undefined) || null,
            candidateProfile: (ctx.candidateProfile as Record<string, any> | undefined) || null,
        };
    } catch (err: any) {
        console.warn(`⚠️ loadHeadHunterContextForCandidate failed for ${id}:`, err?.message || err);
        return null;
    }
}

function cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [candidateId, data] of activeCandidateSessions.entries()) {
        if (now - data.createdAt > ACTIVE_SESSION_TTL_MS) {
            activeCandidateSessions.delete(candidateId);
            const roomName = data.roomName;
            if (roomName) {
                deleteLiveKitRoom(roomName).catch((err: any) => {
                    console.warn(`⚠️ cleanupExpiredSessions: failed to delete room ${roomName}:`, err?.message || err);
                });
            }
        }
    }
}

/** Reuse prewarmed room only when campaign matches — prevents HR link using petroleum metadata. */
function resolvePreparedSessionReuse(
    candidateId: string,
    requestedCampaignId: string | undefined,
    maxAgeMs = 2 * 60 * 1000
): { roomName: string; token: string; sessionId: string } | null {
    cleanupExpiredSessions();
    const existing = activeCandidateSessions.get(candidateId);
    if (!existing || (Date.now() - existing.createdAt) >= maxAgeMs) {
        return null;
    }
    const reqCamp = (requestedCampaignId || '').trim();
    const storedCamp = (existing.campaignId || '').trim();
    if (reqCamp && storedCamp && reqCamp !== storedCamp) {
        console.warn(
            `⚠️ Session reuse blocked for candidate ${candidateId}: campaign mismatch ` +
                `(stored=${storedCamp}, requested=${reqCamp})`
        );
        activeCandidateSessions.delete(candidateId);
        if (existing.roomName) {
            deleteLiveKitRoom(existing.roomName).catch((err: any) => {
                console.warn(`⚠️ Failed to delete stale room ${existing.roomName}:`, err?.message || err);
            });
        }
        return null;
    }
    return {
        roomName: existing.roomName,
        token: existing.token,
        sessionId: existing.sessionId,
    };
}

/** Stable key for agent question bank — must match JSON keys in voice_interview/data/interview_questions.json */
function slugForJobQuestions(position: string | undefined | null): string {
    if (!position || typeof position !== 'string') return '';
    const t = position.trim();
    if (!t || t.toUpperCase() === 'N/A') return '';
    return t
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9\u0600-\u06ff-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function parseStateBool(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
    }
    return fallback;
}

/** MongoDB ObjectId as 24 hex chars (BSON ObjectId string form). */
const MONGO_OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

function isValidMongoObjectId(id: string): boolean {
    return typeof id === 'string' && MONGO_OBJECT_ID_HEX.test(id.trim());
}

const INTERVIEW_MODES = ['video', 'voice', 'screen'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

function normalizeInterviewMode(raw: unknown): InterviewMode {
    if (typeof raw === 'string' && INTERVIEW_MODES.includes(raw as InterviewMode)) {
        return raw as InterviewMode;
    }
    return 'video';
}

/**
 * لغة المقابلة كما يفهمها وكيل LiveKit: `ar` أو `en` فقط. الكردية تُطوى إلى
 * العربية لأن الوكيل لا يملك صوتاً ولا STT كرديين، والصوت العربي ثنائي اللغة.
 * الغياب يعني «لا قفل» فيبقى الوكيل على سلوكه الافتراضي.
 */
function normalizeAgentLanguage(raw: unknown): 'ar' | 'en' | undefined {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'en' || s === 'english') return 'en';
    if (s === 'ar' || s === 'arabic' || s === 'ku' || s === 'kurdish' || s === 'ckb') return 'ar';
    return undefined;
}

/**
 * LiveKit question bank metadata (high-quality path):
 * 1) jobId in request body (valid Mongo ObjectId) wins.
 * 2) Else candidate.jobPostingId from DB.
 * 3) Else campaign.criteria.jobPostingId | jobId | job_id from RecruitmentCampaign.
 * position_slug is always computed for the agent to try after primary key misses.
 * If VIDEO_INTERVIEW_REQUIRE_MONGO_JOB_ID=true, a primary ObjectId must be found (body or DB).
 */
async function resolveLiveKitQuestionBankForStart(
    candidate: Record<string, unknown>,
    bodyJobId: string | undefined,
    isTestMode: boolean,
    strictRequireMongoJobId: boolean
): Promise<{ error?: string; jobIdForBank: string; positionSlug: string }> {
    const positionLabel =
        typeof candidate.position_applied_for === 'string' ? candidate.position_applied_for : undefined;
    const positionSlug = slugForJobQuestions(positionLabel);
    let jobIdForBank = '';
    const trimmedBody = typeof bodyJobId === 'string' ? bodyJobId.trim() : '';
    if (trimmedBody) {
        if (!isValidMongoObjectId(trimmedBody)) {
            return {
                error: 'jobId must be a valid MongoDB ObjectId (24 hexadecimal characters)',
                jobIdForBank: '',
                positionSlug
            };
        }
        jobIdForBank = trimmedBody;
    } else if (!isTestMode) {
        const jp = candidate.jobPostingId;
        if (jp != null && isValidMongoObjectId(String(jp).trim())) {
            jobIdForBank = String(jp).trim();
        } else if (typeof candidate.campaignId === 'string' && candidate.campaignId.trim()) {
            const camp = await RecruitmentCampaign.findOne({ campaignId: candidate.campaignId.trim() }).lean();
            const crit = camp?.criteria as Record<string, unknown> | undefined;
            if (crit) {
                const raw = crit.jobPostingId ?? crit.jobId ?? crit.job_id;
                if (raw != null && isValidMongoObjectId(String(raw).trim())) {
                    jobIdForBank = String(raw).trim();
                }
            }
        }
    }
    if (strictRequireMongoJobId && !jobIdForBank) {
        return {
            error:
                'jobId is required (VIDEO_INTERVIEW_REQUIRE_MONGO_JOB_ID). Pass jobId in the request body, or set candidate.jobPostingId / campaign.criteria.jobPostingId (or jobId) in the database.',
            jobIdForBank: '',
            positionSlug
        };
    }
    return { jobIdForBank, positionSlug };
}

/**
 * POST /api/video-interview/prepare
 *
 * Warm-up: ينشئ غرفة LiveKit ويستدعي Agent dispatch + تكوين metadata كاملة من DB
 * قبل أن يضغط المستخدم "ابدأ". يحفظ النتيجة في activeCandidateSessions حتى يعيد
 * /start استخدامها (لا غرفة ثانية ولا أفاتار مكرر). الـ session في DB يُنشأ في /start.
 */
router.post('/prepare', async (req, res) => {
    if (rejectIfStageCallbackSecurityMisconfigured(res)) return;
    try {
        const {
            candidateId,
            campaignId,
            applicationId: prepareApplicationId,
            jobId: prepareJobId,
            clarificationRequested,
            followUpRequired,
            questionLocked,
            currentPhase,
            currentQuestion,
            language: prepareLanguage
        } = req.body as {
            candidateId?: string;
            campaignId?: string;
            applicationId?: string;
            jobId?: string;
            clarificationRequested?: boolean | string;
            followUpRequired?: boolean | string;
            questionLocked?: boolean | string;
            currentPhase?: string;
            currentQuestion?: string;
            language?: string;
        };

        if (!candidateId) {
            return res.status(400).json({
                success: false,
                message: 'candidateId is required'
            });
        }

        const strictMongoJobId = process.env.VIDEO_INTERVIEW_REQUIRE_MONGO_JOB_ID === 'true';
        if (typeof prepareJobId === 'string' && prepareJobId.trim() && !isValidMongoObjectId(prepareJobId)) {
            return res.status(400).json({
                success: false,
                message: 'jobId must be a valid MongoDB ObjectId (24 hexadecimal characters)'
            });
        }

        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
        let candidate: any;
        if (isTestMode) {
            candidate = {
                _id: candidateId,
                full_name: 'Test Candidate',
                email: 'test@example.com',
                position_applied_for: 'Software Developer',
                skills: ['JavaScript', 'React', 'Node.js'],
                years_of_experience: '3-5 years'
            };
        } else {
            candidate = await Candidate.findById(candidateId);
            if (!candidate) {
                return res.status(404).json({
                    success: false,
                    message: 'Candidate not found'
                });
            }
            const prepareCamp =
                typeof campaignId === 'string' && campaignId.trim()
                    ? campaignId.trim()
                    : undefined;
            if (
                await isVideoLinkConsumedById(candidateId, {
                    applicationId: prepareApplicationId,
                    campaignId: prepareCamp,
                })
            ) {
                return res.status(409).json({
                    success: false,
                    code: INTERVIEW_LINK_ALREADY_USED,
                    message: 'This interview link has already been used.',
                });
            }
        }

        // إن وُجدت جلسة محضّرة سابقًا لنفس المرشح (TTL 2د) أعِد استخدامها فقط إذا تطابق campaignId
        const prepareCandidateCampaignIdEarly = typeof (candidate as { campaignId?: string }).campaignId === 'string'
            ? (candidate as { campaignId?: string }).campaignId?.trim()
            : undefined;
        const prepareCampaignIdEarly =
            (typeof campaignId === 'string' && campaignId.trim() ? campaignId.trim() : undefined)
            || prepareCandidateCampaignIdEarly;
        const reusedSession = resolvePreparedSessionReuse(candidateId, prepareCampaignIdEarly);
        if (reusedSession) {
            return res.status(200).json({
                success: true,
                sessionId: reusedSession.sessionId,
                candidate: {
                    id: candidate._id,
                    full_name: candidate.full_name,
                    email: candidate.email,
                    position_applied_for: candidate.position_applied_for,
                    skills: candidate.skills,
                    years_of_experience: candidate.years_of_experience
                },
                livekit: {
                    roomName: reusedSession.roomName,
                    url: process.env.LIVEKIT_URL,
                    token: reusedSession.token
                },
                reused: true
            });
        }

        const bankMeta = await resolveLiveKitQuestionBankForStart(
            candidate as unknown as Record<string, unknown>,
            prepareJobId,
            isTestMode,
            strictMongoJobId
        );
        if (bankMeta.error) {
            return res.status(400).json({
                success: false,
                message: bankMeta.error
            });
        }

        const sessionId = `video-interview-${candidateId}-${Date.now()}`;
        let livekitRoomName: string | null = null;
        let livekitToken: string | null = null;

        // المسار العام (public_screening): نحقن ROLE CONTEXT في metadata الإحماء أيضاً،
        // لأن /start قد يعيد استخدام الغرفة المحضّرة هنا دون إعادة dispatch.
        const prepareCandidateCampaignId = typeof (candidate as { campaignId?: string }).campaignId === 'string'
            ? (candidate as { campaignId?: string }).campaignId?.trim()
            : undefined;
        const prepareCampaignId =
            (typeof campaignId === 'string' && campaignId.trim() ? campaignId.trim() : undefined)
            || prepareCandidateCampaignId;
        const prepareIsPublic = !isTestMode
            && String((candidate as { sourceType?: string }).sourceType || '').trim().toLowerCase() === 'public_screening';
        let prepareRoleContext = '';
        if (prepareIsPublic && prepareCampaignId) {
            try {
                const camp = await RecruitmentCampaign.findOne({ campaignId: prepareCampaignId }).lean();
                if (camp) {
                    prepareRoleContext = buildCompactRoleContext(
                        (camp.criteria && typeof camp.criteria === 'object') ? camp.criteria as Record<string, any> : undefined,
                        camp.jobAdvertisement
                    );
                }
            } catch (campErr: any) {
                console.warn(`⚠️ /prepare: failed to load campaign criteria for ${prepareCampaignId}: ${campErr?.message || campErr}`);
            }
        }
        // الهيد هانتر: نحقن خلفية المرشح + معايير البحث حتى بلا حملة فعلية.
        if (!isTestMode) {
            const hhCtx = await loadHeadHunterContextForCandidate(candidate as Record<string, any>);
            if (hhCtx) {
                prepareRoleContext = mergeRoleContext(prepareRoleContext, buildHeadHunterRoleContext(hhCtx));
            }
        }

        // Blueprint المتخصص (إن وُجد مقفل للحملة) — fail-open: الغياب يعني رجوع لبنك JSON.
        // /start قد يعيد استخدام هذه الغرفة دون dispatch جديد، فلا بد أن تصل الكفاءات هنا.
        let prepareBlueprintBundle = isTestMode
            ? null
            : await awaitBlueprintBundle(prepareCampaignId);
        if (!isTestMode && !prepareBlueprintBundle && prepareCampaignId) {
            try {
                prepareBlueprintBundle = await ensureBlueprintForCampaign(prepareCampaignId);
            } catch (ensureErr: any) {
                console.warn(
                    `⚠️ /prepare: ensureBlueprintForCampaign failed for ${prepareCampaignId}: ${ensureErr?.message || ensureErr}`
                );
            }
        }
        const prepareBlueprintMeta = buildBlueprintMetadata(prepareBlueprintBundle);

        if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
            try {
                livekitRoomName = await createLiveKitRoom(sessionId);

                const metadata: Record<string, string> = {
                    candidate_id: candidateId,
                    session_id: sessionId,
                    position: candidate.position_applied_for || 'N/A',
                    candidate_name: (candidate.full_name || '').trim() || candidate.email?.split('@')[0] || 'Unknown',
                    ...(typeof candidate.gender === 'string' && candidate.gender.trim()
                        ? { candidate_gender: candidate.gender.trim().toLowerCase() }
                        : {}),
                    company_applied_to: typeof candidate.company_applied_to === 'string' && candidate.company_applied_to.trim()
                        ? candidate.company_applied_to.trim()
                        : 'N/A',
                    highest_education_level: typeof candidate.highest_education_level === 'string' && candidate.highest_education_level.trim()
                        ? candidate.highest_education_level.trim()
                        : 'N/A',
                    years_of_experience: typeof candidate.years_of_experience === 'string' && candidate.years_of_experience.trim()
                        ? candidate.years_of_experience.trim()
                        : 'N/A',
                    certifications: typeof candidate.certifications === 'string' && candidate.certifications.trim()
                        ? candidate.certifications.trim()
                        : 'N/A',
                    clarification_requested: String(parseStateBool(clarificationRequested, false)),
                    follow_up_required: String(parseStateBool(followUpRequired, false)),
                    question_locked: String(parseStateBool(questionLocked, false)),
                    current_phase: typeof currentPhase === 'string' && currentPhase.trim() ? currentPhase.trim() : 'L1',
                    current_question: typeof currentQuestion === 'string' && currentQuestion.trim() ? currentQuestion.trim() : 'N/A',
                    // /start قد يعيد استخدام هذه الغرفة دون dispatch جديد، فلا بد
                    // أن يصلها قفل اللغة هنا أيضاً.
                    ...(normalizeAgentLanguage(prepareLanguage)
                        ? { language: normalizeAgentLanguage(prepareLanguage)! }
                        : {}),
                };
                if (bankMeta.jobIdForBank) {
                    metadata.job_id = bankMeta.jobIdForBank;
                    metadata.question_bank_job_id = bankMeta.jobIdForBank;
                }
                if (bankMeta.positionSlug) {
                    metadata.position_slug = bankMeta.positionSlug;
                }
                if (typeof campaignId === 'string' && campaignId.trim()) {
                    metadata.campaign_id = campaignId.trim();
                }
                if (prepareRoleContext) {
                    metadata.role_context = prepareRoleContext;
                }
                // الطبقات 2/3/4 للمقابلة المتخصصة (إن وُجد Blueprint مقفل للحملة).
                applyBlueprintMetadataToLiveKit(metadata, prepareBlueprintMeta);

                livekitToken = await createUserToken(livekitRoomName, `user-${candidateId}`, metadata);
                if (typeof livekitToken !== 'string') {
                    throw new Error('Invalid LiveKit token: must be a string');
                }

                console.log(`✅ Prepared LiveKit room: ${livekitRoomName}`, {
                    explicitDispatch: true,
                    jobIdForBank: bankMeta.jobIdForBank || null,
                    positionSlug: bankMeta.positionSlug || null
                });

                try {
                    await dispatchAgentToRoom(livekitRoomName, metadata);
                } catch (agentError: any) {
                    console.error('❌ Failed to dispatch Agent via API:', agentError.message);
                    throw new Error(`Failed to dispatch agent: ${agentError.message}`);
                }

                activeCandidateSessions.set(candidateId, {
                    roomName: livekitRoomName,
                    token: livekitToken,
                    sessionId,
                    createdAt: Date.now(),
                    campaignId: prepareCampaignId || undefined,
                });
            } catch (error: any) {
                console.error('⚠️ Failed to prepare LiveKit room:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to prepare LiveKit room',
                    error: error.message
                });
            }
        }

        res.status(200).json({
            success: true,
            sessionId,
            candidate: {
                id: candidate._id,
                full_name: candidate.full_name,
                email: candidate.email,
                position_applied_for: candidate.position_applied_for,
                skills: candidate.skills,
                years_of_experience: candidate.years_of_experience
            },
            livekit: livekitRoomName && livekitToken ? {
                roomName: livekitRoomName,
                url: process.env.LIVEKIT_URL,
                token: livekitToken
            } : null,
            reused: false
        });
    } catch (error: any) {
        console.error('Error in /prepare:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to prepare interview',
            error: error.message
        });
    }
});

/**
 * POST /api/video-interview/start
 * بدء مقابلة فيديو جديدة
 * 
 * التدفق:
 * 1. جلب بيانات المرشح من قاعدة البيانات
 * 2. إنشاء session ID
 * 3. إرجاع بيانات المرشح و session ID
 */
router.post('/start', async (req, res) => {
    if (rejectIfStageCallbackSecurityMisconfigured(res)) return;
    try {
        const {
            candidateId,
            campaignId,
            applicationId: startApplicationId,
            jobId: bodyJobId,
            clarificationRequested,
            followUpRequired,
            questionLocked,
            currentPhase,
            currentQuestion,
            interviewMode: bodyInterviewMode,
            language: bodyLanguage
        } = req.body as {
            candidateId?: string;
            campaignId?: string;
            applicationId?: string;
            jobId?: string;
            clarificationRequested?: boolean | string;
            followUpRequired?: boolean | string;
            questionLocked?: boolean | string;
            currentPhase?: string;
            currentQuestion?: string;
            interviewMode?: string;
            language?: string;
        };

        const interviewMode = normalizeInterviewMode(bodyInterviewMode);
        // لغة رابط المشاركة (اختيار الموظف) — تُخزَّن لتمريرها لـ n8n عند التقييم.
        const sessionLanguage = (() => {
            const s = String(bodyLanguage ?? '').trim().toLowerCase();
            if (s === 'en' || s === 'english') return 'en';
            if (s === 'ku' || s === 'kurdish' || s === 'ckb') return 'ku';
            if (s === 'ar' || s === 'arabic') return 'ar';
            return undefined;
        })();

        if (!candidateId) {
            return res.status(400).json({
                success: false,
                message: 'candidateId is required'
            });
        }

        // للاختبار: إذا كان candidateId يبدأ بـ "test-" نستخدم بيانات وهمية
        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
        
        let candidate;
        if (isTestMode) {
            // بيانات وهمية للاختبار
            candidate = {
                _id: candidateId,
                full_name: 'Test Candidate',
                email: 'test@example.com',
                position_applied_for: 'Software Developer',
                skills: ['JavaScript', 'React', 'Node.js'],
                years_of_experience: '3-5 years'
            };
        } else {
            // جلب بيانات المرشح من قاعدة البيانات
            candidate = await Candidate.findById(candidateId);

            if (!candidate) {
                return res.status(404).json({
                    success: false,
                    message: 'Candidate not found'
                });
            }
            if (
                await isVideoLinkConsumedById(candidateId, {
                    applicationId: startApplicationId,
                    campaignId:
                        typeof campaignId === 'string' && campaignId.trim()
                            ? campaignId.trim()
                            : undefined,
                })
            ) {
                return res.status(409).json({
                    success: false,
                    code: INTERVIEW_LINK_ALREADY_USED,
                    message: 'This interview link has already been used.',
                });
            }
        }

        // ✅ FIX: منع إنشاء غرفة ثانية لنفس المرشح خلال 2 دقيقة — فقط إذا campaignId يطابق
        const candidateCampaignIdEarly =
            typeof (candidate as { campaignId?: string }).campaignId === 'string'
                ? (candidate as { campaignId?: string }).campaignId?.trim()
                : undefined;
        const normalizedCampaignIdEarly =
            (typeof campaignId === 'string' && campaignId.trim() ? campaignId.trim() : undefined)
            || candidateCampaignIdEarly;
        const reusedStartSession = resolvePreparedSessionReuse(candidateId, normalizedCampaignIdEarly);
        if (reusedStartSession) {
            console.log(`ℹ️ Reusing existing session for candidate ${candidateId} (prevents duplicate avatar)`);
            // /prepare لا يحفظ في Mongo. بدون هذا السطر يصل /end بجلسة null
            // فيضيع campaignId ولقطة الكفاءات ويُقيَّم النص بلا blueprint.
            if (!isTestMode) {
                try {
                    const alreadySaved = await VideoInterviewSession.findOne({
                        sessionId: reusedStartSession.sessionId,
                    }).select('_id').lean();
                    if (!alreadySaved) {
                        const reuseBundle = await loadBlueprintBundleSafe(normalizedCampaignIdEarly);
                        const reuseSnapshot = buildBlueprintSnapshot(reuseBundle);
                        const reuseOrganizationId =
                            (candidate as { organizationId?: string }).organizationId
                                ? (candidate as { organizationId: string }).organizationId
                                : DEFAULT_ORG_ID;
                        const inheritedOrgId =
                            reuseOrganizationId !== DEFAULT_ORG_ID ? reuseOrganizationId : undefined;

                        // Arm video billing on the prewarm-reuse path too. The full /start
                        // path acquires the video lock and freezes the minute snapshot; the
                        // reuse path used to skip it, so a prewarmed interview ran without a
                        // lock and /end could never settle it — the minutes escaped the video
                        // pool entirely (billingStatus stayed undefined, nothing was deducted
                        // and nothing appeared in the operations log). Mirror the full path.
                        let reuseVideoBilling: Extract<StartVideoResult, { ok: true }> | null = null;
                        if (BILLING_ENFORCE && usageTypeForInterviewMode(interviewMode) === 'VIDEO_SECONDS') {
                            const gate = await checkCredits(
                                reuseOrganizationId,
                                'VIDEO_SECONDS',
                                PREFLIGHT_SECONDS
                            );
                            if (!gate.ok && gate.code !== 'INSUFFICIENT_CREDITS') {
                                return res.status(billingHttpStatus(gate.code)).json({
                                    success: false,
                                    code: gate.code,
                                    message: gate.message,
                                });
                            }
                            const lock = await startVideoSession({
                                organizationId: reuseOrganizationId,
                                sessionId: reusedStartSession.sessionId,
                                maxInterviewSeconds: MAX_INTERVIEW_SECONDS,
                            });
                            if (!lock.ok) {
                                const httpStatus =
                                    lock.code === 'ACTIVE_SESSION' ? 409 : billingHttpStatus(lock.code);
                                return res.status(httpStatus).json({
                                    success: false,
                                    code: lock.code,
                                    message: lock.message,
                                });
                            }
                            reuseVideoBilling = lock;
                        }

                        await VideoInterviewSession.create({
                            sessionId: reusedStartSession.sessionId,
                            candidateId: candidate._id,
                            campaignId: normalizedCampaignIdEarly,
                            conversationHistory: [],
                            status: 'active',
                            interviewMode,
                            startedAt: new Date(),
                            ...(reuseSnapshot ? { blueprintSnapshot: reuseSnapshot } : {}),
                            ...(inheritedOrgId ? { organizationId: inheritedOrgId } : {}),
                            // Video billing snapshot — frozen at start; /end + sweep settle against it.
                            ...(reuseVideoBilling
                                ? {
                                      billingStartedAt: new Date(),
                                      maxAllowedVideoSeconds: reuseVideoBilling.maxAllowedVideoSeconds,
                                      includedVideoSecondsAtStart:
                                          reuseVideoBilling.includedVideoSecondsAtStart,
                                      purchasedVideoSecondsAtStart:
                                          reuseVideoBilling.purchasedVideoSecondsAtStart,
                                      billingStatus: 'active',
                                  }
                                : {}),
                        });
                    }
                } catch (persistErr: any) {
                    console.warn(
                        `⚠️ /start reuse: failed to persist session ${reusedStartSession.sessionId}: ${persistErr?.message || persistErr}`
                    );
                }
            }
            return res.status(200).json({
                success: true,
                sessionId: reusedStartSession.sessionId,
                candidate: {
                    id: candidate._id,
                    full_name: candidate.full_name,
                    email: candidate.email,
                    position_applied_for: candidate.position_applied_for,
                    skills: candidate.skills,
                    years_of_experience: candidate.years_of_experience
                },
                livekit: {
                    roomName: reusedStartSession.roomName,
                    url: process.env.LIVEKIT_URL,
                    token: reusedStartSession.token
                }
            });
        }

        const strictMongoJobId = process.env.VIDEO_INTERVIEW_REQUIRE_MONGO_JOB_ID === 'true';
        const bankMeta = await resolveLiveKitQuestionBankForStart(
            candidate as unknown as Record<string, unknown>,
            bodyJobId,
            isTestMode,
            strictMongoJobId
        );
        if (bankMeta.error) {
            return res.status(400).json({
                success: false,
                message: bankMeta.error
            });
        }

        // إنشاء session ID
        const sessionId = `video-interview-${candidateId}-${Date.now()}`;
        const candidateCampaignId =
            typeof (candidate as { campaignId?: string }).campaignId === 'string'
                ? (candidate as { campaignId?: string }).campaignId?.trim()
                : undefined;
        const normalizedCampaignId =
            (typeof campaignId === 'string' && campaignId.trim() ? campaignId.trim() : undefined)
            || candidateCampaignId;

        // المسار العام (public_screening): نحقن معايير الحملة في الوكيل ونلتقط Snapshot.
        // المسار العادي (Specific) لا يتأثّر — لا نحمّل المعايير ولا نضيف role_context.
        const candidateSourceType = !isTestMode
            ? String((candidate as { sourceType?: string }).sourceType || '').trim().toLowerCase()
            : '';
        const isPublicScreening = candidateSourceType === 'public_screening';
        let roleContextSnapshot = '';
        let jobCriteriaSnapshot: Record<string, any> | undefined;
        if (isPublicScreening && normalizedCampaignId) {
            try {
                const camp = await RecruitmentCampaign.findOne({ campaignId: normalizedCampaignId }).lean();
                if (camp) {
                    jobCriteriaSnapshot = (camp.criteria && typeof camp.criteria === 'object')
                        ? camp.criteria as Record<string, any>
                        : undefined;
                    roleContextSnapshot = buildCompactRoleContext(jobCriteriaSnapshot, camp.jobAdvertisement);
                }
            } catch (campErr: any) {
                console.warn(`⚠️ /start: failed to load campaign criteria for ${normalizedCampaignId}: ${campErr?.message || campErr}`);
            }
        }
        // الهيد هانتر: نحقن خلفية المرشح + معايير البحث حتى بلا حملة فعلية.
        if (!isTestMode) {
            const hhCtx = await loadHeadHunterContextForCandidate(candidate as Record<string, any>);
            if (hhCtx) {
                roleContextSnapshot = mergeRoleContext(roleContextSnapshot, buildHeadHunterRoleContext(hhCtx));
            }
        }

        // Blueprint المتخصص (إن وُجد مقفل للحملة) — يُحقن في الوكيل ويُلتقط snapshot للثبات والتقييم.
        const startBlueprintBundle = isTestMode ? null : await awaitBlueprintBundle(normalizedCampaignId);
        const startBlueprintMeta = buildBlueprintMetadata(startBlueprintBundle);
        const blueprintSnapshot = buildBlueprintSnapshot(startBlueprintBundle);

        const organizationId =
            !isTestMode && (candidate as { organizationId?: string }).organizationId
                ? (candidate as { organizationId: string }).organizationId
                : DEFAULT_ORG_ID;

        // Unified-credit preflight — verify the plan includes this interview mode
        // (video is gated to Team+) and the wallet has headroom. The real charge
        // happens at /end based on actual session duration. Skip in test mode.
        //
        // Video has a dedicated path: included + purchased minutes cover a session
        // regardless of credit balance, so we DON'T let the balance gate block it.
        // We validate feature/subscription, then atomically lock the single video
        // session and compute the server-enforced cap (startVideoSession). Video
        // never spends credits — when minutes run out, /start returns NO_VIDEO_MINUTES.
        let videoBilling: Extract<StartVideoResult, { ok: true }> | null = null;
        if (BILLING_ENFORCE && !isTestMode) {
            const usageType = usageTypeForInterviewMode(interviewMode);

            if (usageType === 'VIDEO_SECONDS') {
                // Feature / subscription gate only (ignore pure-balance — included
                // minutes are evaluated by startVideoSession below).
                const gate = await checkCredits(organizationId, 'VIDEO_SECONDS', PREFLIGHT_SECONDS);
                if (!gate.ok && gate.code !== 'INSUFFICIENT_CREDITS') {
                    return res.status(billingHttpStatus(gate.code)).json({
                        success: false,
                        code: gate.code,
                        message: gate.message,
                    });
                }

                const lock = await startVideoSession({
                    organizationId,
                    sessionId,
                    maxInterviewSeconds: MAX_INTERVIEW_SECONDS,
                });
                if (!lock.ok) {
                    const httpStatus = lock.code === 'ACTIVE_SESSION' ? 409 : billingHttpStatus(lock.code);
                    return res.status(httpStatus).json({
                        success: false,
                        code: lock.code,
                        message: lock.message,
                    });
                }
                videoBilling = lock;
            } else {
                const preflight = await checkCredits(organizationId, usageType, PREFLIGHT_SECONDS);
                if (!preflight.ok) {
                    return res.status(billingHttpStatus(preflight.code)).json({
                        success: false,
                        code: preflight.code,
                        message: preflight.message,
                    });
                }

                const reservation = await reserveUsage({
                    organizationId,
                    usageType,
                    estimatedUnits: MAX_INTERVIEW_SECONDS,
                    source: 'video_interview',
                    sourceId: sessionId,
                    idempotencyKey: `reservation:vi:${sessionId}`,
                    metadata: { interviewMode },
                });
                if (!reservation.ok) {
                    return res.status(billingHttpStatus(reservation.code)).json({
                        success: false,
                        code: reservation.code,
                        message: reservation.message,
                    });
                }
            }
        }

        // إنشاء session جديد في قاعدة البيانات
        // في وضع الاختبار، نحفظ sessionId فقط بدون candidateId (لأنه وهمي)
        // multi-tenancy: organizationId يُورَّث من الـ candidate (الجلسة candidate-initiated فلا يوجد Clerk auth).
        const inheritedOrgId = organizationId !== DEFAULT_ORG_ID ? organizationId : undefined;
        const session = new VideoInterviewSession({
            sessionId: sessionId,
            candidateId: isTestMode ? new (await import('mongoose')).Types.ObjectId() : candidate._id,
            campaignId: normalizedCampaignId,
            ...(startApplicationId && String(startApplicationId).trim()
                ? { applicationId: String(startApplicationId).trim() }
                : {}),
            conversationHistory: [],
            status: 'active',
            interviewMode,
            ...(sessionLanguage ? { language: sessionLanguage } : {}),
            startedAt: new Date(),
            ...(candidateSourceType ? { sourceType: candidateSourceType } : {}),
            ...(jobCriteriaSnapshot ? { jobCriteriaSnapshot } : {}),
            ...(roleContextSnapshot ? { roleContextSnapshot } : {}),
            ...(blueprintSnapshot ? { blueprintSnapshot } : {}),
            ...(inheritedOrgId ? { organizationId: inheritedOrgId } : {}),
            // Video billing snapshot — frozen at start; /end + sweep settle against it.
            ...(videoBilling
                ? {
                      billingStartedAt: new Date(),
                      maxAllowedVideoSeconds: videoBilling.maxAllowedVideoSeconds,
                      includedVideoSecondsAtStart: videoBilling.includedVideoSecondsAtStart,
                      purchasedVideoSecondsAtStart: videoBilling.purchasedVideoSecondsAtStart,
                      billingStatus: 'active',
                  }
                : {}),
        });

        // في وضع الاختبار، لا نحفظ في DB (أو نحفظ بدون candidateId)
        if (!isTestMode) {
            await session.save();
        }

        // إنشاء LiveKit Room (إذا كان LiveKit مفعّل)
        let livekitRoomName = null;
        let livekitToken = null;
        
        if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
            try {
                livekitRoomName = await createLiveKitRoom(sessionId);
                
                // ✅ job_id في metadata = مفتاح بنك الأسئلة: Mongo ObjectId (مفضل) أو slug من المنصب (legacy)
                // ✅ FIX: إعداد metadata للـ Agent — job_id يحدد بنك الأسئلة على الوكيل (بدون تمرير الأسئلة)
                const metadata: Record<string, string> = {
                    candidate_id: candidateId,
                    session_id: sessionId,
                    position: candidate.position_applied_for || 'N/A',
                    candidate_name: (candidate.full_name || '').trim() || candidate.email?.split('@')[0] || 'Unknown',
                    ...(typeof candidate.gender === 'string' && candidate.gender.trim()
                        ? { candidate_gender: candidate.gender.trim().toLowerCase() }
                        : {}),
                    company_applied_to: typeof candidate.company_applied_to === 'string' && candidate.company_applied_to.trim()
                        ? candidate.company_applied_to.trim()
                        : 'N/A',
                    highest_education_level: typeof candidate.highest_education_level === 'string' && candidate.highest_education_level.trim()
                        ? candidate.highest_education_level.trim()
                        : 'N/A',
                    years_of_experience: typeof candidate.years_of_experience === 'string' && candidate.years_of_experience.trim()
                        ? candidate.years_of_experience.trim()
                        : 'N/A',
                    certifications: typeof candidate.certifications === 'string' && candidate.certifications.trim()
                        ? candidate.certifications.trim()
                        : 'N/A',
                    clarification_requested: String(parseStateBool(clarificationRequested, false)),
                    follow_up_required: String(parseStateBool(followUpRequired, false)),
                    question_locked: String(parseStateBool(questionLocked, false)),
                    current_phase: typeof currentPhase === 'string' && currentPhase.trim() ? currentPhase.trim() : 'L1',
                    current_question: typeof currentQuestion === 'string' && currentQuestion.trim() ? currentQuestion.trim() : 'N/A',
                    // قفل لغة المقابلة من رابط المشاركة — بدونه لا يعرف الوكيل
                    // أن المقابلة إنجليزية فيرحّب بالعربية افتراضياً.
                    ...(normalizeAgentLanguage(sessionLanguage)
                        ? { language: normalizeAgentLanguage(sessionLanguage)! }
                        : {}),
                };
                if (bankMeta.jobIdForBank) {
                    metadata.job_id = bankMeta.jobIdForBank;
                    metadata.question_bank_job_id = bankMeta.jobIdForBank;
                }
                if (bankMeta.positionSlug) {
                    metadata.position_slug = bankMeta.positionSlug;
                }
                // المسار العام: نمرّر ROLE CONTEXT المختصر للوكيل ليصوغ أسئلة موجّهة للدور (بدون بيانات مرشح).
                if (roleContextSnapshot) {
                    metadata.role_context = roleContextSnapshot;
                }
                // الطبقات 2/3/4 للمقابلة المتخصصة (إن وُجد Blueprint مقفل للحملة).
                applyBlueprintMetadataToLiveKit(metadata, startBlueprintMeta);
                // Server-enforced video cap — the agent must end the room at this
                // limit; the backend sweep is the fallback if the agent/browser dies.
                if (videoBilling) {
                    metadata.max_video_seconds = String(videoBilling.maxAllowedVideoSeconds);
                }
                console.log('[video-interview/start] LiveKit question bank metadata', {
                    jobIdForBank: bankMeta.jobIdForBank || null,
                    positionSlug: bankMeta.positionSlug || null,
                    candidateId
                });

                // ✅ EXPLICIT DISPATCH: إنشاء Token (Agent سيتم إرساله عبر API)
                livekitToken = await createUserToken(livekitRoomName, `user-${candidateId}`, metadata);
                
                // التحقق من أن token هو string
                if (typeof livekitToken !== 'string') {
                    console.error('❌ LiveKit token is not a string:', typeof livekitToken, livekitToken);
                    throw new Error('Invalid LiveKit token: must be a string');
                }
                
                console.log(`✅ LiveKit room created for session: ${sessionId.substring(0, 8)}...`, {
                    roomName: livekitRoomName,
                    tokenType: typeof livekitToken,
                    tokenLength: livekitToken.length,
                    tokenPreview: livekitToken.substring(0, 20) + '...',
                    explicitDispatch: true
                });
                
                // ✅ EXPLICIT DISPATCH: إرسال Agent عبر API (Explicit Dispatch)
                // Agent يجب أن يكون مسجلاً بـ agent_name="video-interview-agent" في agent.py
                try {
                    console.log(`🚀 Dispatching Agent via API (Explicit Dispatch): ${livekitRoomName}`);
                    console.log(`   - Agent name: video-interview-agent ✅`);
                    await dispatchAgentToRoom(livekitRoomName, metadata);
                } catch (agentError: any) {
                    console.error('❌ Failed to dispatch Agent via API:', agentError.message);
                    // هذا خطأ حرج - Agent لن ينضم للغرفة بدون explicit dispatch
                    throw new Error(`Failed to dispatch agent: ${agentError.message}`);
                }

                // ✅ حفظ الجلسة النشطة لمنع إنشاء غرفة ثانية لنفس المرشح
                activeCandidateSessions.set(candidateId, {
                    roomName: livekitRoomName,
                    token: livekitToken,
                    sessionId,
                    createdAt: Date.now(),
                    campaignId: normalizedCampaignId || undefined,
                });
            } catch (error: any) {
                console.warn('⚠️ Failed to create LiveKit room (non-blocking):', error.message);
                // نتابع بدون LiveKit
            }
        }

        // إرجاع البيانات
        res.status(200).json({
            success: true,
            sessionId: sessionId,
            candidate: {
                id: candidate._id,
                full_name: candidate.full_name,
                email: candidate.email,
                position_applied_for: candidate.position_applied_for,
                skills: candidate.skills,
                years_of_experience: candidate.years_of_experience
            },
            livekit: livekitRoomName && livekitToken ? {
                roomName: livekitRoomName,
                url: process.env.LIVEKIT_URL,
                token: typeof livekitToken === 'string' ? livekitToken : String(livekitToken) // تأكد من أنه string
            } : null
        });

    } catch (error: any) {
        console.error('Error in /start:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start video interview',
            error: error.message
        });
    }
});

/**
 * POST /api/video-interview/audio
 * استقبال audio chunks من الواجهة الأمامية
 * 
 * التدفق:
 * 1. استقبال audio chunk (base64)
 * 2. تحويل الصوت إلى نص (STT)
 * 3. LiveKit Agent يتعامل مع المحادثة تلقائياً
 * 4. إرجاع رسالة للمستخدم (LiveKit Agent سيرد فعلياً)
 */
router.post('/audio', async (req, res) => {
    try {
        const { audio, sessionId, candidateId } = req.body;

        // Validation
        if (!audio || !sessionId || !candidateId) {
            return res.status(400).json({
                success: false,
                message: 'audio, sessionId, and candidateId are required'
            });
        }

        // للاختبار: إذا كان candidateId يبدأ بـ "test-" نستخدم بيانات وهمية
        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
        
        let candidate;
        if (isTestMode) {
            // بيانات وهمية للاختبار
            candidate = {
                _id: candidateId,
                full_name: 'Test Candidate',
                email: 'test@example.com',
                position_applied_for: 'Software Developer',
                skills: ['JavaScript', 'React', 'Node.js'],
                years_of_experience: '3-5 years'
            };
        } else {
            // جلب بيانات المرشح من قاعدة البيانات
            try {
                candidate = await Candidate.findById(candidateId);
                if (!candidate) {
                    return res.status(404).json({
                        success: false,
                        message: 'Candidate not found'
                    });
                }
            } catch (dbError: any) {
                console.error('❌ Database error fetching candidate:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Database error. Please try again.',
                    userSafeMessage: 'We encountered an issue. Please try again in a moment.'
                });
            }
        }

        // تحويل base64 إلى Buffer مع error handling
        let audioBuffer: Buffer;
        try {
            audioBuffer = Buffer.from(audio, 'base64');
            if (audioBuffer.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid audio data'
                });
            }
        } catch (bufferError: any) {
            console.error('❌ Error decoding audio buffer:', bufferError);
            return res.status(400).json({
                success: false,
                message: 'Invalid audio format',
                userSafeMessage: 'Could you please try speaking again?'
            });
        }

        // Step 1: تحويل الصوت إلى نص (STT)
        // STT service لديه fallback مدمج
        console.log('='.repeat(60));
        console.log('🎤 BACKEND: RECEIVED AUDIO CHUNK');
        console.log('='.repeat(60));
        console.log('   Buffer size:', audioBuffer.length, 'bytes');
        console.log('   Session ID:', sessionId.substring(0, 8) + '...');
        console.log('   Candidate ID:', candidateId.substring(0, 8) + '...');
        console.log('='.repeat(60));
        
        let userText: string;
        try {
            console.log('🔄 BACKEND: Starting STT transcription...');
            userText = await transcribeAudio(audioBuffer, 'webm');
            console.log('='.repeat(60));
            console.log('📝 BACKEND: TRANSCRIPTION RESULT');
            console.log('='.repeat(60));
            console.log('   Text length:', userText?.length || 0, 'characters');
            console.log('   Text:', userText?.substring(0, 100) || '(empty)');
            console.log('='.repeat(60));
        } catch (sttError: any) {
            console.error('❌ STT error:', sttError);
            // Fallback: إرجاع رسالة للمستخدم
            return res.status(200).json({
                success: true,
                reply: "I'm having trouble hearing you. Could you please speak more clearly?",
                transcribedText: '',
                warning: 'STT service temporarily unavailable'
            });
        }

        // إذا كان النص فارغاً، إرجاع fallback response
        if (!userText || userText.trim().length === 0) {
            console.warn('⚠️ Empty transcription - audio may be too short, silent, or unclear');
            return res.status(200).json({
                success: true,
                reply: 'Could you please repeat that? I didn\'t catch what you said.',
                transcribedText: ''
            });
        }

        // Step 2: جلب session من قاعدة البيانات (أو إنشاء وهمي في وضع الاختبار)
        type ConversationEntry = { role: 'user' | 'assistant'; content: string; timestamp: Date };
        type SessionLike = {
            conversationHistory: ConversationEntry[];
            addMessage?: (role: string, content: string) => void;
            save: () => Promise<unknown>;
            markModified?: (path: string) => void;
        };
        let session: SessionLike | null = null;
        if (isTestMode) {
            // في وضع الاختبار، ننشئ session وهمي في الذاكرة
            const mockSession: SessionLike = {
                conversationHistory: [] as ConversationEntry[],
                addMessage(role: string, content: string) {
                    this.conversationHistory.push({
                        role: role as 'user' | 'assistant',
                        content,
                        timestamp: new Date()
                    });
                },
                async save() {
                    return Promise.resolve();
                },
                markModified() { /* no-op for mock */ }
            };
            session = mockSession;
        } else {
            try {
                const dbSession = await VideoInterviewSession.findOne({ sessionId: sessionId });
                if (!dbSession) {
                    return res.status(404).json({
                        success: false,
                        message: 'Session not found',
                        userSafeMessage: 'Your interview session has expired. Please start a new interview.'
                    });
                }
                session = dbSession as unknown as SessionLike;
            } catch (sessionError: any) {
                console.error('❌ Database error fetching session:', sessionError);
                return res.status(500).json({
                    success: false,
                    message: 'Database error. Please try again.',
                    userSafeMessage: 'We encountered an issue. Please try again in a moment.'
                });
            }
        }

        // Step 3: إعداد سياق المقابلة مع conversation history
        const conversationHistory = (session?.conversationHistory ?? []).map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        const context = {
            candidateProfile: {
                full_name: candidate.full_name,
                email: candidate.email,
                position_applied_for: candidate.position_applied_for,
                skills: candidate.skills,
                experience: candidate.years_of_experience
            },
            conversationHistory: conversationHistory,
            sessionId: sessionId,
            avatarId: process.env.BEYOND_PRESENCE_AVATAR_ID || undefined
        };

        // Step 4: LiveKit Agent يتعامل مع المحادثة
        // لا نعالج المحادثة هنا - LiveKit Agent (Python) سيتعامل معها تلقائياً
        console.log('='.repeat(60));
        console.log('⏭️ BACKEND: LIVEKIT AGENT WILL HANDLE CONVERSATION');
        console.log('='.repeat(60));
        console.log('   User text (for logging only):', `"${userText.substring(0, 50)}..."`);
        console.log('   Note: Agent should receive audio directly from LiveKit');
        console.log('='.repeat(60));
        
        // نُرجع رسالة بسيطة للمستخدم - LiveKit Agent سيرد فعلياً
        const replyText = "Processing your message...";

        // Step 5: حفظ الرسائل في conversation history
        try {
            if (session) {
            session.conversationHistory.push(
                { role: 'user', content: userText, timestamp: new Date() },
                { role: 'assistant', content: replyText, timestamp: new Date() }
            );
                session.markModified?.('conversationHistory');
            await session.save();
            }
        } catch (saveError: any) {
            // Log error لكن لا نوقف التدفق
            console.error('⚠️ Error saving conversation history (non-blocking):', saveError);
            // نتابع - المحادثة ستستمر حتى لو فشل الحفظ
        }

        // Step 6: إرجاع النص للمستخدم
        // حتى لو فشل بعض الخطوات، نُرجع رداً للمستخدم
        res.status(200).json({
            success: true,
            reply: replyText,
            transcribedText: userText
        });

    } catch (error: any) {
        // Catch-all error handler
        console.error('❌ Unexpected error in /audio:', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            sessionId: req.body?.sessionId?.substring(0, 20) + '...'
        });

        // إرجاع user-safe error message
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            userSafeMessage: 'We encountered an issue processing your audio. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/video-interview/end
 * إنهاء مقابلة فيديو
 * 
 * التدفق:
 * 1. جلب session من قاعدة البيانات
 * 2. تحديث status إلى 'completed'
 * 3. حفظ endedAt timestamp
 */
// POST /api/video-interview/heartbeat
// The transcript lives only in the candidate's browser and is uploaded by /end, so
// closing the tab loses the whole interview — a real session ended cleanly on the
// agent side (reason=ok, 28 turns) and was stored with zero turns and no endedAt.
// The same missing /end also costs money: the stale-lock sweep settles at sweep
// time, which by construction is past the full allotment, so an abandoned 6-minute
// interview billed the entire 20-minute cap.
//
// This keeps a running copy server-side and stamps a liveness marker the sweep can
// settle against. Unauthenticated and keyed by sessionId, exactly like /end — same
// trust model, and it only ever touches a session that is still active.
router.post('/heartbeat', async (req, res) => {
    try {
        const { sessionId, conversationHistory: incomingHistory } = req.body || {};
        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'sessionId is required' });
        }
        const session = await VideoInterviewSession.findOne({ sessionId }).catch(() => null) as any;
        // Unknown or already-finished session: accept and do nothing, so a late
        // beacon from a closing tab can never resurrect or re-open it.
        if (!session || session.status !== 'active') {
            return res.json({ success: true, ignored: true });
        }

        session.lastActivityAt = new Date();

        const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(incomingHistory)
            ? incomingHistory
                .map((m: any) => ({
                    role: m?.role === 'assistant' ? 'assistant' : 'user' as 'user' | 'assistant',
                    content: String(m?.content || '').trim(),
                }))
                .filter((m: { content: string }) => m.content.length > 0)
            : [];
        // Only ever grow. A late or out-of-order beat carrying a shorter transcript
        // must not truncate what we already hold.
        if (normalized.length > (session.conversationHistory?.length || 0)) {
            session.conversationHistory = normalized as any;
            session.markModified?.('conversationHistory');
        }
        await session.save().catch(() => undefined);
        return res.json({ success: true, turns: session.conversationHistory?.length || 0 });
    } catch (error: any) {
        // Never fail the interview over a heartbeat.
        console.warn(`⚠️ /heartbeat failed: ${error?.message || error}`);
        return res.json({ success: true, ignored: true });
    }
});

router.post('/end', async (req, res) => {
    try {
        const { sessionId, conversationHistory: incomingHistory } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'sessionId is required'
            });
        }

        // جلب session من DB (قد لا يوجد في وضع الاختبار - لا نحفظ session)
        const session = await VideoInterviewSession.findOne({ sessionId: sessionId }).catch(() => null) as any;

        // ✅ سدّ ثغرة الترانسكريبت: مسار LiveKit لا يكتب conversationHistory في الجلسة.
        // الواجهة ترسل الترانسكريبت في body عند الإنهاء؛ نكتبه في الجلسة إن كانت فارغة قبل الإرسال لـ n8n.
        const normalizedIncoming: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(incomingHistory)
            ? incomingHistory
                .map((m: any) => ({
                    role: m?.role === 'assistant' ? 'assistant' : 'user' as 'user' | 'assistant',
                    content: String(m?.content || '').trim(),
                }))
                .filter((m: { content: string }) => m.content.length > 0)
            : [];
        if (session && normalizedIncoming.length && !(session.conversationHistory?.length)) {
            try {
                session.conversationHistory = normalizedIncoming as any;
                session.markModified?.('conversationHistory');
            } catch (histErr: any) {
                console.warn(`⚠️ /end: failed to persist incoming transcript: ${histErr?.message || histErr}`);
            }
        }

        // ✅ إيقاف LiveKit Agent دائماً (حتى لو session غير موجود في DB - وضع الاختبار)
        const roomName = `room-${sessionId}`;
        try {
            console.log(`🛑 Stopping LiveKit Agent for room: ${roomName}`);
            stopAgent(roomName);
            console.log(`✅ LiveKit Agent stopped successfully`);
        } catch (agentError: any) {
            console.warn(`⚠️ Error stopping LiveKit Agent (non-blocking): ${agentError.message}`);
        }

        // ✅ إزالة الجلسة النشطة للسماح ببدء مقابلة جديدة لنفس المرشح
        let candidateIdToRemove = session?.candidateId?.toString?.();
        if (!candidateIdToRemove && sessionId) {
            const parts = sessionId.split('-');
            if (parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1])) {
                candidateIdToRemove = parts.slice(2, -1).join('-');
            }
        }
        const roomFromMap = candidateIdToRemove
            ? activeCandidateSessions.get(candidateIdToRemove)?.roomName
            : undefined;
        if (candidateIdToRemove) {
            activeCandidateSessions.delete(candidateIdToRemove);
        }

        // ✅ حذف الغرفة من LiveKit Cloud لإلغاء أي dispatch معلَّق ومنع إعادة استلامه
        // عند إعادة تشغيل الوركر. غير حاجب: لو فشل، نسجّل تحذيراً ونكمل.
        const roomToDelete = roomFromMap || roomName;
        deleteLiveKitRoom(roomToDelete).catch((err: any) => {
            console.warn(`⚠️ /end: failed to delete LiveKit room ${roomToDelete}:`, err?.message || err);
        });

        // إرسال ترانسكريبت مقابلة الفيديو إلى n8n (مثل الصوت)
        // المصدر الفعّال: ترانسكريبت الجلسة إن وُجد، وإلا الوارد من الواجهة (مسار LiveKit/وضع الاختبار).
        const effectiveTranscript: Array<{ role: 'user' | 'assistant'; content: string }> =
            (session?.conversationHistory?.length
                ? session.conversationHistory.map((msg: any) => ({
                    role: msg.role === 'assistant' ? 'assistant' : 'user' as 'user' | 'assistant',
                    content: String(msg.content || ''),
                }))
                : normalizedIncoming);

        const resolvedCandidateId =
            session?.candidateId?.toString?.() || candidateIdToRemove || undefined;
        if (
            resolvedCandidateId &&
            hasMeaningfulConversation(effectiveTranscript)
        ) {
            void markVideoLinkConsumed(resolvedCandidateId, sessionId, {
                applicationId: session?.applicationId,
                campaignId: session?.campaignId,
            }).catch((markErr: any) => {
                console.warn(`⚠️ /end: failed to mark video link consumed: ${markErr?.message || markErr}`);
            });
        }

        if (effectiveTranscript.length) {
            // المسار العام (public_screening): نرسل إلى الرابط المخصص مع معايير الوظيفة من Snapshot الجلسة.
            const isPublicSession = String(session?.sourceType || '').trim().toLowerCase() === 'public_screening';
            const jobCriteriaSnapshot =
                session?.jobCriteriaSnapshot && typeof session.jobCriteriaSnapshot === 'object'
                    ? (session.jobCriteriaSnapshot as Record<string, unknown>)
                    : undefined;
            // لو بدأت المقابلة قبل أن يُقفَل blueprint الحملة، لا تحمل الجلسة لقطة —
            // فيصل النصّ للمصحّح بلا كفاءات ويسقط حتماً إلى insufficient_data.
            // التوليد انتهى قطعاً الآن، فنلتقطها هنا بدل خسارة التقييم كلّه.
            const resolvedCampaignId = await resolveCampaignIdForEnd(
                session,
                resolvedCandidateId
            );
            // لقطة تُعدّ صالحة فقط إن حملت كفاءات فعليّة؛ لقطة فارغة {} أو جزئية
            // (بدأت المقابلة قبل قفل blueprint الحملة) لا تنفع المصحّح وتُسقَط لاحقاً.
            const snapshotHasCompetencies = (
                snap: Record<string, unknown> | undefined | null
            ): snap is Record<string, unknown> =>
                !!snap &&
                Array.isArray((snap as any).competencies) &&
                (snap as any).competencies.length > 0;
            const sessionSnapshot =
                session?.blueprintSnapshot && typeof session.blueprintSnapshot === 'object'
                    ? (session.blueprintSnapshot as Record<string, unknown>)
                    : undefined;
            let blueprintSnapshot = snapshotHasCompetencies(sessionSnapshot)
                ? sessionSnapshot
                : undefined;
            // إن لم تحمل الجلسة كفاءات (جلسة غير محفوظة أو لقطة فارغة/جزئية) نُعيد البناء
            // من blueprint الحملة المقفل — التوليد انتهى قطعاً الآن، فنلتقطها بدل خسارة التقييم كلّه.
            if (!blueprintSnapshot && resolvedCampaignId) {
                const rebuilt = buildBlueprintSnapshot(
                    await loadBlueprintBundleSafe(resolvedCampaignId)
                );
                if (snapshotHasCompetencies(rebuilt)) blueprintSnapshot = rebuilt;
                console.log(
                    blueprintSnapshot
                        ? `ℹ️ /end: recovered blueprint snapshot for ${sessionId} (campaign ${resolvedCampaignId}, ${(blueprintSnapshot as any).competencies.length} competencies)`
                        : `⚠️ /end: no locked blueprint competencies for campaign ${resolvedCampaignId} — ${sessionId} will score without competencies`
                );
            }
            sendVideoTranscriptToN8N({
                sessionId,
                candidateId: session?.candidateId?.toString?.() || candidateIdToRemove || undefined,
                conversationHistory: effectiveTranscript,
                // لغة رابط المشاركة (اختيار الموظف) ثم لغة الـ blueprint، وإلا 'auto' ليكتشفها n8n.
                language:
                    (session as any)?.language ||
                    (session as any)?.blueprintSnapshot?.language ||
                    'auto',
                campaignId: resolvedCampaignId,
                ...(jobCriteriaSnapshot ? { jobCriteria: jobCriteriaSnapshot } : {}),
                ...(blueprintSnapshot ? { blueprintSnapshot } : {}),
                ...(isPublicSession ? { mode: 'public' as const } : {}),
            }).catch((n8nError: unknown) => {
                if (n8nError instanceof StageCallbackConfigurationError) {
                    console.log(
                        '[stage_outbound] ingress=stage3 outcome=failed errorCategory=stage_callback_config_invalid'
                    );
                    return;
                }
                const message = n8nError instanceof Error ? n8nError.message : String(n8nError);
                console.warn(`⚠️ Error sending video transcript to n8n (non-blocking): ${message}`);
            });
        } else {
            console.log(`ℹ️ Skipping video transcript n8n send for ${sessionId}: no conversation history`);
        }

        // إنهاء الجلسة في DB إن وُجدت
        if (session) {
            try {
                (session as any).endSession();
                await session.save();
            } catch (saveError: any) {
                console.warn(`⚠️ Error saving session end (non-blocking): ${(saveError as Error).message}`);
            }

            // Domain event (Phase 2) — session completion for all modes (best-effort;
            // the video-billing settle path only covers video-mode).
            void emitDomainEventBestEffort({
                organizationId: (session.organizationId as string) || DEFAULT_ORG_ID,
                type: 'VideoSessionCompleted',
                payload: {
                    sessionId,
                    candidateId: session.candidateId?.toString?.() ?? null,
                    campaignId: (session.campaignId as string) ?? null,
                    applicationId: (session.applicationId as string) ?? null,
                    interviewMode: session.interviewMode ?? null,
                    status: session.status ?? 'completed',
                },
                idempotencyKey: `video-session:${sessionId}:completed`,
            });
        }

        // Unified-credit charge — bill the ACTUAL interview duration once, at end.
        // Non-blocking: the interview already happened, so a billing miss must not
        // fail the response. The /start preflight guaranteed headroom; MAX caps runaway.
        if (session && BILLING_ENFORCE) {
            try {
                const organizationId = (session.organizationId as string) || DEFAULT_ORG_ID;
                const usageType = usageTypeForInterviewMode(String(session.interviewMode || 'voice'));
                const isManagedVideo =
                    usageType === 'VIDEO_SECONDS' &&
                    session.billingStatus &&
                    session.billingStatus !== 'settled';

                if (isManagedVideo) {
                    // Pack model: included minutes first, then PURCHASED minutes —
                    // never credits. Duration is server-authoritative (billingStartedAt → now) and
                    // clamped to the cap frozen at /start. billingEndedAt is recorded
                    // by the settlement, never taken from the client.
                    const billingEndedAt = new Date();
                    const startMs = session.billingStartedAt
                        ? new Date(session.billingStartedAt).getTime()
                        : session.startedAt
                          ? new Date(session.startedAt).getTime()
                          : billingEndedAt.getTime();
                    const cap = session.maxAllowedVideoSeconds ?? MAX_INTERVIEW_SECONDS;
                    const actualSeconds = Math.min(
                        cap,
                        Math.floor(Math.max(0, billingEndedAt.getTime() - startMs) / 1000),
                    );

                    const result = await consumeVideoSeconds({
                        organizationId,
                        sessionId,
                        actualSeconds,
                        billingEndedAt,
                        includedRemainingAtStart: session.includedVideoSecondsAtStart ?? 0,
                        purchasedRemainingAtStart: session.purchasedVideoSecondsAtStart ?? 0,
                        metadata: {
                            candidateId: session.candidateId?.toString?.(),
                            interviewMode: session.interviewMode,
                        },
                    });
                    if (!result.ok) {
                        console.warn(
                            `⚠️ /end video billing not settled for ${sessionId}: ${result.code} — ${result.message}`,
                        );
                    }
                } else {
                    // Voice / screen / legacy-video: flat per-second charge at end.
                    const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
                    const endedAtMs = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
                    let durationSeconds = Math.ceil(Math.max(0, endedAtMs - startedAtMs) / 1000);
                    durationSeconds = Math.min(durationSeconds, MAX_INTERVIEW_SECONDS);

                    if (durationSeconds > 0) {
                        const billingResult = await finalizeUsageReservation({
                            organizationId,
                            sourceId: sessionId,
                            actualUnits: durationSeconds,
                            consumeSource: 'video_interview',
                            consumeIdempotencyKey: `vi_end:${sessionId}`,
                            metadata: {
                                candidateId: session.candidateId?.toString?.(),
                                interviewMode: session.interviewMode,
                                durationSeconds,
                            },
                        });
                        if (!billingResult.ok) {
                            console.warn(
                                `⚠️ /end billing not charged for ${sessionId}: ${billingResult.code} — ${billingResult.message}`,
                            );
                        }
                    }
                }
            } catch (billErr: any) {
                console.warn(`⚠️ /end billing error (non-blocking) for ${sessionId}: ${billErr?.message || billErr}`);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Interview session ended successfully',
            sessionId: sessionId
        });

    } catch (error: any) {
        console.error('Error in /end:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to end video interview',
            error: error.message
        });
    }
});

/**
 * GET /api/video-interview/status/:sessionId
 * الحصول على حالة المقابلة
 */
router.get('/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await VideoInterviewSession.findOne({ sessionId: sessionId })
            .populate('candidateId', 'full_name email')
            .select('sessionId status startedAt endedAt conversationHistory.length');

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            session: {
                sessionId: session.sessionId,
                status: session.status,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                messageCount: session.conversationHistory.length,
                candidate: session.candidateId
            }
        });

    } catch (error: any) {
        console.error('Error in /status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get session status',
            error: error.message
        });
    }
});

/**
 * GET /api/video-interview/history/:sessionId
 * الحصول على تاريخ المحادثة الكامل
 */
router.get('/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await VideoInterviewSession.findOne({ sessionId: sessionId })
            .select('conversationHistory');

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            conversationHistory: session.conversationHistory
        });

    } catch (error: any) {
        console.error('Error in /history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversation history',
            error: error.message
        });
    }
});

/**
 * GET /api/video-interview/sessions/recent
 * قائمة جلسات الفيديو لهذه المؤسسة فقط.
 *
 * Requires a signed-in caller: an API key carries no organization identity, so
 * key-only access could not be scoped and returned every tenant's sessions.
 */
router.get('/sessions/recent', conditionalRequireAuth(), async (req, res) => {
    try {
        const raw = parseInt(String(req.query.limit ?? '50'), 10);
        const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
        const sessions = await VideoInterviewSession.find({ organizationId: getOrgId(req) })
            .sort({ startedAt: -1 })
            .limit(limit)
            .select('sessionId startedAt endedAt status interviewMode')
            .lean()
            .exec();

        return res.status(200).json({
            success: true,
            sessions: sessions.map((s) => ({
                sessionId: s.sessionId,
                startedAt: s.startedAt,
                endedAt: s.endedAt ?? null,
                status: s.status,
                interviewMode: s.interviewMode ?? 'video'
            }))
        });
    } catch (error: any) {
        console.error('Error in /sessions/recent:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to list interview sessions',
            error: error.message
        });
    }
});

export default router;

