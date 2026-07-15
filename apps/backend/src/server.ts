// ============================================
// ملف: server.ts
// الوظيفة: السيرفر الرئيسي للتطبيق
// ============================================
// ⚠️ مهم: تحميل .env أولاً قبل أي import آخر
import './loadEnv.js';

import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { clerkMiddleware } from '@clerk/express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { networkInterfaces } from 'os';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleVoiceInterviewWsConnection } from './evaalo-only-voice/voiceInterviewWs.js';
import { handleVoiceReceptionWsConnection } from './evaalo-only-voice-reception/voiceReceptionWs.js';
import { connectDatabase } from './config/database.js';
import candidateRoutes from './routes/candidates.js';
import publicCampaignRoutes from './routes/publicCampaign.js';
import recruitmentCampaignRoutes, {
    postScreeningAiCompareN8nInbound,
    postVoiceAiCompareN8nInbound,
    postVideoAiCompareN8nInbound,
} from './routes/recruitmentCampaigns.js';
import healthRoutes from './routes/health.js';
import orgChartPdfRoutes from './routes/orgChartPdf.js';
import videoInterviewRoutes from './routes/videoInterview.js';
import interviewBlueprintRoutes from './routes/interviewBlueprints.js';
import receptionDemoRoutes from './routes/receptionDemo.js';
import voiceInterviewRoutes from './routes/voiceInterview.js';
import voiceReceptionRoutes from './routes/voiceReception.js';
import marketingChatRoutes from './routes/marketingChat.js';
import headHunterRoutes, { postHeadHunterN8nInbound } from './routes/headHunter.js';
import cvComparisonRoutes, { postCvComparisonN8nInbound } from './routes/cvComparison.js';
import campaignCompareRoutes from './routes/campaignCompare.js';
import { postCampaignCompareN8nInbound } from './services/campaignCompareN8nInbound.js';
import { normalizeStage3CallbackPayload } from './services/stage3CallbackNormalizer.js';
import billingRoutes from './routes/billing.js';
import clerkWebhookRoutes from './routes/clerkWebhooks.js';
import userProfileRoutes from './routes/userProfile.js';
import integrationsRoutes from './routes/integrations.js';
import devMigrationRoutes from './routes/devMigration.js';
import { stripeWebhookHandler } from './routes/stripeWebhooks.js';
import { validateStripePrices } from './config/stripePrices.js';
import {
    buildN8nStageIdempotencyKey,
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from './services/webhookIdempotency.js';
import { candidateCorrelationRef } from './services/stageCallbackAuth.js';
import {
    postStageN8nInbound,
    type StageN8nIngressRequest,
} from './services/stageN8nInbound.js';
import {
    validateStage1WrittenEvaluationPersistence,
} from './services/stage1WrittenEvaluationGate.js';
import { normalizeRubricResultsFromWebhook } from './services/stage1RubricResults.js';
import { processPendingStage1EvaluationOutbox } from './services/stage1EvaluationOutboxService.js';
import {
    formatStage2EvaluationGateDiagnostic,
    getStage2EvaluationGateMode,
    shouldBlockStage2IncompleteEvaluation,
    validateStage2VoiceEvaluationPersistence,
} from './services/stage2VoiceEvaluationGate.js';
import {
    formatStage3EvaluationGateDiagnostic,
    getStage3EvaluationGateMode,
    shouldBlockStage3IncompleteEvaluation,
    validateStage3VideoEvaluationPersistence,
} from './services/stage3VideoEvaluationGate.js';
import Candidate from './models/Candidate.js';
import CandidateApplication from './models/CandidateApplication.js';
import {
    findApplicationForCallback,
    pushApplicationEvent,
} from './services/candidateApplicationService.js';
import { addVideoStreamConnection } from './services/videoStreamService.js';
import { createLiveKitRoom, createUserToken } from './services/livekitService.js';

// للحصول على مسار المجلد الحالي في ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** أول عنوان IPv4 غير داخلي (لطباعة روابط الشبكة المحلية) */
function getLanIPv4(): string | null {
    const nets = networkInterfaces();
    for (const key of Object.keys(nets)) {
        for (const net of nets[key] ?? []) {
            const isV4 = net.family === 'IPv4';
            if (isV4 && !net.internal) return net.address;
        }
    }
    return null;
}

// إنشاء تطبيق Express
const app = express();
const PORT = Number(process.env.PORT) || 5000;
/** استخدم 0.0.0.0 للاستماع على جميع الواجهات (LAN / Docker). استبدله بـ 127.0.0.1 للربط المحلي فقط. */
const LISTEN_HOST = (process.env.LISTEN_HOST || '0.0.0.0').trim() || '0.0.0.0';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// إنشاء HTTP server للسماح بـ WebSocket
const httpServer = createServer(app);

// ============================================
// Middleware (البرمجيات الوسيطة)
// ============================================

// السماح بطلبات من Frontend - جميع المنافذ المحتملة
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Clerk-User-Id', 'X-User-Email'],
}));

// مهم: clerk webhook يجب أن يستقبل raw body قبل express.json حتى يتمكن svix من التحقق من التوقيع.
app.use(
    '/api/webhooks/clerk',
    express.raw({ type: 'application/json' }),
    clerkWebhookRoutes
);

// Stripe webhook: signature verification needs the unparsed raw body. Mount BEFORE express.json().
app.post(
    '/webhook/stripe',
    express.raw({ type: 'application/json' }),
    stripeWebhookHandler,
);

// السماح بقراءة JSON في الطلبات مع زيادة الحد الأقصى لحجم الـ body
// للسماح بإرسال audio chunks كبيرة
app.use(express.json({ limit: '10mb' })); // زيادة الحد من 100kb إلى 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// Clerk Authentication Middleware
// ============================================
// `clerkMiddleware()` is non-blocking — it verifies the Clerk JWT when present
// and attaches `req.auth` (userId, sessionClaims, orgId, …). Requests without
// a token continue through as anonymous, which is required for candidate-facing
// flows (application form, interview links, voice/video sessions).
//
// To enforce auth on a specific route, import `requireAuth` from '@clerk/express'
// and add it to that route handler only (NOT at mount level — would break public
// candidate flows). Example:
//   import { requireAuth } from '@clerk/express';
//   router.delete('/:id', requireAuth(), requirePermission('candidate.delete'), handler);
//
// Once all HR users have publicMetadata.role set in Clerk Dashboard, switch
// `RBAC_ENFORCEMENT=on` in .env so requirePermission actually blocks.
if (process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY) {
    const clerk = clerkMiddleware();
    app.use((req, res, next) => {
        const safeNext: typeof next = (err?: unknown) => {
            if (err) {
                console.warn(
                    '[clerkMiddleware] auth skipped — continuing as anonymous:',
                    err instanceof Error ? err.message : err
                );
                return next();
            }
            return next();
        };
        try {
            const result = clerk(req, res, safeNext) as unknown;
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch((err) => {
                    console.warn(
                        '[clerkMiddleware] auth skipped — continuing as anonymous:',
                        err instanceof Error ? err.message : err
                    );
                    next();
                });
            }
        } catch (err) {
            console.warn(
                '[clerkMiddleware] auth skipped — continuing as anonymous:',
                err instanceof Error ? err.message : err
            );
            next();
        }
    });
} else if (process.env.CLERK_SECRET_KEY || process.env.CLERK_PUBLISHABLE_KEY) {
    console.warn(
        '[server] Clerk partially configured — clerkMiddleware skipped. ' +
        'Set both CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY in .env.'
    );
} else {
    console.warn('[server] Clerk keys not set — clerkMiddleware skipped. req.auth will be undefined.');
}

// إعداد multer لحفظ الملفات
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads');
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // حفظ الملف باسم فريد: timestamp-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB حد أقصى
    },
    fileFilter: (req, file, cb) => {
        // قبول جميع أنواع الملفات (يمكنك تحديد أنواع معينة إذا أردت)
        cb(null, true);
    }
});

// ============================================
// Routes (المسارات)
// ============================================

// API Routes
app.use('/api/candidates', candidateRoutes);
app.use('/api/public', publicCampaignRoutes);
app.use('/api/recruitment-campaigns', recruitmentCampaignRoutes);
app.use('/api/video-interview', videoInterviewRoutes);
app.use('/api/interview-blueprints', interviewBlueprintRoutes);
app.use('/api/reception-demo', receptionDemoRoutes);
app.use('/api/voice-interview', voiceInterviewRoutes);
app.use('/api/voice-reception', voiceReceptionRoutes);
app.use('/api/marketing-chat', marketingChatRoutes);
app.use('/api/head-hunter', headHunterRoutes);
app.use('/api/cv-comparison', cvComparisonRoutes);
app.use('/api/campaign-compare', campaignCompareRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/users', userProfileRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/dev', devMigrationRoutes);
// Head Hunter: استقبال JSON من n8n — منفصل عن مقابلات المرشحين /webhook/.../stage* (لا multer، لا candidateId)
app.post('/webhook/n8n/head-hunter', postHeadHunterN8nInbound);
app.post('/webhook/head-hunter', postHeadHunterN8nInbound);
app.post('/webhook/n8n/cv-comparison', postCvComparisonN8nInbound);
// Stage 1 AI Compare Top: استقبال نتيجة المقارنة من n8n — مستقل عن باقي الـ webhooks
app.post('/webhook/n8n/screening-ai-compare', postScreeningAiCompareN8nInbound);
app.post('/webhook/screening-ai-compare', postScreeningAiCompareN8nInbound);
app.post('/webhook/n8n/voice-ai-compare', postVoiceAiCompareN8nInbound);
app.post('/webhook/voice-ai-compare', postVoiceAiCompareN8nInbound);
app.post('/webhook/n8n/video-ai-compare', postVideoAiCompareN8nInbound);
app.post('/webhook/video-ai-compare', postVideoAiCompareN8nInbound);
app.post('/webhook/n8n/campaign-compare/stage1', (req, res) =>
    postCampaignCompareN8nInbound(req, res, 'stage1')
);
app.post('/webhook/n8n/campaign-compare/stage2', (req, res) =>
    postCampaignCompareN8nInbound(req, res, 'stage2')
);
app.post('/webhook/n8n/campaign-compare/stage3', (req, res) =>
    postCampaignCompareN8nInbound(req, res, 'stage3')
);
app.use('/api/health', healthRoutes);
app.use('/api/org-chart', orgChartPdfRoutes);

// Skeleton: GET /health يرجع "OK" فقط (للتحقق من أن السيرفر واقف)
app.get('/health', (_req, res) => {
    res.type('text/plain').send('OK');
});

// Route لتحميل الملفات (للملفات المحفوظة)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Route أساسي
app.get('/', (req, res) => {
    res.json({ 
        message: 'Evaalo Career Portal API',
        version: '1.0.0'
    });
});

// ============================================
// n8n Webhook Handler (استقبال نتائج التحليل من n8n)
// ============================================

/** تقييم n8n/LLM قد يصل كنص مثل "4.2/10" أو "85/100" — المخطط يتوقع Number 0–100 */
function normalizePercent0to100(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(0, Math.min(100, raw));
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (frac) {
            const num = parseFloat(frac[1]);
            const den = parseFloat(frac[2]);
            if (den > 0 && Number.isFinite(num)) {
                return Math.max(0, Math.min(100, (num / den) * 100));
            }
            return undefined;
        }
        const n = parseFloat(s.replace(/,/g, ''));
        if (Number.isFinite(n)) {
            return Math.max(0, Math.min(100, n));
        }
    }
    return undefined;
}

function withNormalizedOverallScore<T extends Record<string, unknown>>(obj: T): T {
    const copy = { ...obj } as T;
    const key = 'overall_score' as keyof T;
    if (key in copy && copy[key] !== undefined) {
        const n = normalizePercent0to100(copy[key]);
        if (n !== undefined) (copy as any)[key] = n;
        else delete (copy as any).overall_score;
    }
    return copy;
}

function normalizeRecommendation(raw: unknown): 'Hire' | 'Consider' | 'Reject' | undefined {
    if (raw === undefined || raw === null) return undefined;
    const s = String(raw).trim().toLowerCase();
    if (!s) return undefined;
    if (s.includes('no hire') || s.includes('not hire') || s.includes('reject') || s.includes('unsuitable')) {
        return 'Reject';
    }
    if (s.includes('consider') || s.includes('maybe') || s.includes('review')) {
        return 'Consider';
    }
    if (s.includes('hire') || s.includes('recommended')) {
        return 'Hire';
    }
    return undefined;
}

function toLooseKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** رفض القيم النصية الخاطئة الشائعة من n8n/JS (مثل "undefined") */
const INVALID_WEBHOOK_ID_TOKENS = new Set(['', 'undefined', 'null', 'nan']);

function pickLoose(obj: unknown, aliases: string[]): unknown {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const rec = obj as Record<string, unknown>;
    const wanted = new Set(aliases.map((a) => toLooseKey(a)));
    for (const [k, v] of Object.entries(rec)) {
        if (wanted.has(toLooseKey(k))) return v;
    }
    return undefined;
}

function pickLooseFromSources(sources: unknown[], aliases: string[]): unknown {
    for (const src of sources) {
        const v = pickLoose(src, aliases);
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) return v;
        const s = String(v).trim();
        if (!s || INVALID_WEBHOOK_ID_TOKENS.has(s.toLowerCase())) continue;
        return v;
    }
    return undefined;
}

/** أسماء شائعة لدرجة 0–100 من n8n / LLM (غير `overall_score` فقط) */
const OVERALL_SCORE_ALIASES = [
    'overall_score',
    'Overall Score',
    'overallScore',
    'score',
    'Score',
    'match_score',
    'matchScore',
    'fit_score',
    'fitScore',
    'percentage',
    'percent',
    'total_score',
    'final_score',
    'evaluation_score',
];

function buildStageEvalSources(data: Record<string, unknown>, nestedKey: string): unknown[] {
    const nested = data[nestedKey] as Record<string, unknown> | undefined;
    const sources: unknown[] = [];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) sources.push(nested);
    sources.push(data);
    const ai = data.aiEvaluation;
    if (ai && typeof ai === 'object' && !Array.isArray(ai)) sources.push(ai);
    return sources;
}

function pickOverallScoreFromSources(sources: unknown[]): number | undefined {
    return normalizePercent0to100(pickLooseFromSources(sources, OVERALL_SCORE_ALIASES));
}

function toPlainSubdoc(val: unknown): Record<string, unknown> | undefined {
    if (val == null || typeof val !== 'object') return undefined;
    const o = val as Record<string, unknown> & { toObject?: () => Record<string, unknown> };
    if (typeof o.toObject === 'function') {
        try {
            return o.toObject() as Record<string, unknown>;
        } catch {
            return { ...o };
        }
    }
    return { ...(val as Record<string, unknown>) };
}

/** دمج تحديث n8n فوق التقييم المخزّن — القيم undefined/null في patch لا تمس الحقول القديمة */
function mergeEval(
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const base = existing ? { ...existing } : {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && INVALID_WEBHOOK_ID_TOKENS.has(v.trim().toLowerCase())) continue;
        base[k] = v;
    }
    for (const [k, v] of Object.entries(base)) {
        if (typeof v === 'string' && INVALID_WEBHOOK_ID_TOKENS.has(v.trim().toLowerCase())) {
            delete base[k];
        }
    }
    return base;
}

function normalizeEvaluationSourceToken(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim().toLowerCase();
}

function isVideoWebhookPayload(data: Record<string, unknown>): boolean {
    const src = normalizeEvaluationSourceToken(
        pickLoose(data, ['evaluationSource', 'evaluation_source'])
    );
    if (src === 'video' || src === 'video_interview') return true;
    const stage = data.stage ?? data.evaluationStage;
    if (stage === 3 || stage === '3') return true;
    const ev = data.event;
    if (typeof ev === 'string' && ev.toLowerCase().includes('video')) return true;
    return false;
}

function normalizeWebhookIdString(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!s || INVALID_WEBHOOK_ID_TOKENS.has(s.toLowerCase())) return null;
    return s;
}

/** ObjectId صالح لاستعلام Mongoose (24 hex) */
function parseCandidateObjectIdFromWebhook(data: Record<string, unknown>): string | null {
    const candidates = [
        data.candidateId,
        data.id,
        (data.candidate as Record<string, unknown> | undefined)?.id,
        data._id,
        (data.candidate as Record<string, unknown> | undefined)?._id,
    ];
    for (const raw of candidates) {
        const s = normalizeWebhookIdString(raw);
        if (!s) continue;
        if (!mongoose.Types.ObjectId.isValid(s)) continue;
        if (!/^[a-fA-F0-9]{24}$/.test(s)) continue;
        try {
            return new mongoose.Types.ObjectId(s).toString();
        } catch {
            continue;
        }
    }
    return null;
}

/**
 * يستخرج campaignId الوارد مع نتيجة المرحلة لإعادة ربط المرشح بحملته عند الحاجة.
 * الأولوية: claims الموقّعة (secure ingress) ← جسم الطلب ← query الرابط. يُرجع سلسلة
 * غير فارغة أو undefined. لا يتحقق من صيغة hex كي يقبل معرّفات الحملات كما هي.
 */
function resolveInboundCampaignId(
    req: StageN8nIngressRequest,
    data: Record<string, unknown>
): string | undefined {
    const fromIngress = req.stageN8nIngress?.campaignId;
    if (typeof fromIngress === 'string' && fromIngress.trim()) return fromIngress.trim();
    for (const key of ['campaignId', 'campaignID', 'CampaignID']) {
        const v = data[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    const q = req.query?.campaignId;
    const qStr = Array.isArray(q) ? q[0] : q;
    if (typeof qStr === 'string' && qStr.trim()) return qStr.trim();
    return undefined;
}

function resolveInboundApplicationId(
    req: StageN8nIngressRequest,
    data: Record<string, unknown>
): string | undefined {
    const q = req.query?.applicationId;
    const qStr = Array.isArray(q) ? q[0] : q;
    if (typeof qStr === 'string' && qStr.trim()) return qStr.trim();
    for (const key of ['applicationId', 'application_id']) {
        const v = data[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
}

/** Dual-write: Candidate (توافق) + CandidateApplication (مصدر الحقيقة بعد M2M). */
async function dualWriteStageEvaluationUpdate(
    candidateId: string,
    updateData: Record<string, unknown>,
    opts: {
        applicationId?: string;
        campaignId?: string;
        mode: 'stage1' | 'stage2' | 'stage3';
    }
): Promise<void> {
    await Candidate.findByIdAndUpdate(candidateId, updateData, { new: true });
    const app = await findApplicationForCallback({
        applicationId: opts.applicationId,
        candidateId,
        campaignId: opts.campaignId,
    });
    if (!app) {
        console.warn(
            `⚠️ No CandidateApplication for ${candidateId} (${opts.mode}) — wrote Candidate only`
        );
        return;
    }
    await CandidateApplication.findByIdAndUpdate(app._id, updateData, { new: true });
    const eventType =
        opts.mode === 'stage1'
            ? 'screening_completed'
            : opts.mode === 'stage2'
              ? 'voice_completed'
              : 'video_completed';
    await pushApplicationEvent(String(app._id), eventType, {
        candidateId,
        campaignId: opts.campaignId,
    }).catch(() => undefined);
    console.log(
        `✅ ${opts.mode} dual-write → application ${app.applicationId} (+ candidate ${candidateId})`
    );
}

/** تحويل نقاط القوة/الضعف من n8n (نص/سطر/مصفوفة) إلى مصفوفة نصوص */
/** ي parse JSON string من n8n multipart/form عند الحاجة */
function parseWebhookJsonValue<T>(raw: unknown): T | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return undefined;
        try {
            return JSON.parse(trimmed) as T;
        } catch {
            return undefined;
        }
    }
    return raw as T;
}

function normalizeStringArrayForWebhook(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
        const out = raw
            .flatMap((x) => {
                if (typeof x === 'string') {
                    const trimmed = x.trim();
                    if (trimmed.startsWith('[')) {
                        const parsed = parseWebhookJsonValue<string[]>(trimmed);
                        if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim());
                    }
                }
                return [String(x).trim()];
            })
            .filter((x) => x && !INVALID_WEBHOOK_ID_TOKENS.has(x.toLowerCase()));
        return out.length ? out : undefined;
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t || INVALID_WEBHOOK_ID_TOKENS.has(t.toLowerCase())) return undefined;
        if (t.startsWith('[')) {
            const parsed = parseWebhookJsonValue<string[]>(t);
            if (Array.isArray(parsed)) return normalizeStringArrayForWebhook(parsed);
        }
        const parts = t
            .split(/\n+|(?:\s*,\s*)/)
            .map((s) => s.trim())
            .filter((s) => s && !INVALID_WEBHOOK_ID_TOKENS.has(s.toLowerCase()));
        return parts.length ? parts : undefined;
    }
    return undefined;
}

/**
 * Stage 1 فقط — حقول التقييم الكتابي (لا صوت/فيديو):
 * fit_for_role, strengths, weaknesses, summary, final_hr_evaluation, recommendation, overall_score
 */
function buildStrictStage1WrittenPatch(data: Record<string, unknown>): Record<string, unknown> {
    const sources = buildStageEvalSources(data, 'writtenInterviewEvaluation');
    const patch: Record<string, unknown> = {};

    const fit = pickLooseFromSources(sources, [
        'fit_for_role',
        'Fit for Role',
        'Fit for the role',
        'Fit for role',
        'fitForRole',
    ]);
    if (fit !== undefined && fit !== null && String(fit).trim() !== '') {
        patch.fit_for_role = String(fit).trim();
    }

    const strS = normalizeStringArrayForWebhook(pickLooseFromSources(sources, ['strengths', 'Strengths']));
    if (strS !== undefined) patch.strengths = strS;

    const strW = normalizeStringArrayForWebhook(pickLooseFromSources(sources, ['weaknesses', 'Weaknesses']));
    if (strW !== undefined) patch.weaknesses = strW;

    const summary = pickLooseFromSources(sources, ['summary', 'Summary']);
    if (summary !== undefined && summary !== null && String(summary).trim() !== '') {
        patch.summary = String(summary).trim();
    }

    const finalHr = pickLooseFromSources(sources, [
        'final_hr_evaluation',
        'finalHrEvaluation',
        'Final HR Evaluation',
        'Final HR evaluation',
    ]);
    if (finalHr !== undefined && finalHr !== null && String(finalHr).trim() !== '') {
        patch.final_hr_evaluation = String(finalHr).trim();
    }

    const rec = normalizeRecommendation(
        pickLooseFromSources(sources, ['recommendation', 'Recommendation', 'Final HR Recommendation'])
    );
    if (rec) patch.recommendation = rec;

    const n = pickOverallScoreFromSources(sources);
    if (n !== undefined) patch.overall_score = n;

    const rubricResults = normalizeRubricResultsFromWebhook(data);
    if (rubricResults) patch.rubricResults = rubricResults;

    return patch;
}

/**
 * Stage 2 فقط — حقول المقابلة الصوتية (لا كتابي):
 * المهارات الخمس + summary + strengths + weaknesses + professional_attitude + final_hr_evaluation + overall_score + recommendation
 */
function buildStrictStage2VoicePatch(data: Record<string, unknown>): Record<string, unknown> {
    const sources = buildStageEvalSources(data, 'voiceInterviewEvaluation');
    const patch: Record<string, unknown> = {};

    const comm = pickLooseFromSources(sources, ['communication', 'Communication Skills']);
    if (comm !== undefined && comm !== null && String(comm).trim() !== '') {
        patch.communication =
            typeof comm === 'number' && Number.isFinite(comm)
                ? comm
                : Number.isFinite(Number(comm))
                  ? Number(comm)
                  : String(comm).trim();
    }

    const lf = pickLooseFromSources(sources, ['language_fluency', 'English Fluency']);
    if (lf !== undefined && lf !== null && String(lf).trim() !== '') {
        patch.language_fluency = String(lf).trim();
    }

    const conf = pickLooseFromSources(sources, ['confidence', 'Confidence Level']);
    if (conf !== undefined && conf !== null && String(conf).trim() !== '') {
        patch.confidence = String(conf).trim();
    }

    const ps = pickLooseFromSources(sources, ['problem_solving', 'Problem Solving']);
    if (ps !== undefined && ps !== null && String(ps).trim() !== '') {
        patch.problem_solving =
            typeof ps === 'number' && Number.isFinite(ps)
                ? ps
                : Number.isFinite(Number(ps))
                  ? Number(ps)
                  : String(ps).trim();
    }

    const ds = pickLooseFromSources(sources, ['digital_skills', 'Computer Skills']);
    if (ds !== undefined && ds !== null && String(ds).trim() !== '') {
        patch.digital_skills = String(ds).trim();
    }

    const summ = pickLooseFromSources(sources, ['summary', 'Summary']);
    if (summ !== undefined && summ !== null && String(summ).trim() !== '') {
        patch.summary = String(summ).trim();
    }

    const strStrengths = normalizeStringArrayForWebhook(pickLooseFromSources(sources, ['strengths', 'Strengths']));
    if (strStrengths !== undefined) patch.strengths = strStrengths;

    const strWeak = normalizeStringArrayForWebhook(pickLooseFromSources(sources, ['weaknesses', 'Weaknesses']));
    if (strWeak !== undefined) patch.weaknesses = strWeak;

    const pa = pickLooseFromSources(sources, ['professional_attitude', 'Professional Attitude']);
    if (pa !== undefined && pa !== null && String(pa).trim() !== '') {
        patch.professional_attitude = String(pa).trim();
    }

    const fh = pickLooseFromSources(sources, [
        'final_hr_evaluation',
        'finalHrEvaluation',
        'Final HR Evaluation',
    ]);
    if (fh !== undefined && fh !== null && String(fh).trim() !== '') {
        patch.final_hr_evaluation = String(fh).trim();
    }

    const n = pickOverallScoreFromSources(sources);
    if (n !== undefined) patch.overall_score = n;

    const rec = normalizeRecommendation(
        pickLooseFromSources(sources, ['recommendation', 'Recommendation', 'Final HR Recommendation'])
    );
    if (rec) patch.recommendation = rec;

    return patch;
}

function pickVideoCompetencyScore(sources: unknown[], aliases: string[]): number | undefined {
    const v = pickLooseFromSources(sources, aliases);
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Stage 3 فقط — حقول المقابلة بالفيديو:
 * الكفاءات العشر + summary + overall_score + recommendation (+ competencyScores اختياري)
 */
function buildStrictStage3VideoPatch(data: Record<string, unknown>): Record<string, unknown> {
    const sources = buildStageEvalSources(data, 'videoInterviewEvaluation');
    const patch: Record<string, unknown> = {};

    const fields: Array<[string, string[]]> = [
        ['role_understanding', ['role_understanding', 'Role Understanding']],
        ['professional_depth', ['professional_depth', 'Professional Depth']],
        ['problem_handling', ['problem_handling', 'Problem Handling']],
        ['decision_making', ['decision_making', 'Decision Making']],
        ['prioritization', ['prioritization', 'Prioritization']],
        ['process_thinking', ['process_thinking', 'Process Thinking']],
        ['responsibility', ['responsibility', 'Responsibility']],
        ['learning_ability', ['learning_ability', 'Learning Ability']],
        ['job_readiness', ['job_readiness', 'Job Readiness']],
        ['final_role_fit', ['final_role_fit', 'Final Role Fit']],
    ];
    for (const [key, aliases] of fields) {
        const n = pickVideoCompetencyScore(sources, aliases);
        if (n !== undefined) patch[key] = n;
    }

    const summ = pickLooseFromSources(sources, ['summary', 'Summary']);
    if (summ !== undefined && summ !== null && String(summ).trim() !== '') {
        patch.summary = String(summ).trim();
    }

    const n = pickOverallScoreFromSources(sources);
    if (n !== undefined) patch.overall_score = n;

    const rec = normalizeRecommendation(
        pickLooseFromSources(sources, ['recommendation', 'Recommendation', 'Final HR Recommendation'])
    );
    if (rec) patch.recommendation = rec;

    const compScores = parseWebhookJsonValue<Array<Record<string, unknown>>>(
        pickLooseFromSources(sources, ['competencyScores', 'competency_scores'])
    );
    if (compScores !== undefined && Array.isArray(compScores) && compScores.length > 0) {
        patch.competencyScores = compScores;
    }

    return patch;
}

/** معالجة رفض n8n: status=rejected + تخزين rejectCode في الملاحظات */
function applyN8nRejectHandling(
    dataRec: Record<string, unknown>,
    updateData: Record<string, unknown>,
    patch: Record<string, unknown>,
    existingNotes?: string
): void {
    const rejectCodeRaw = pickLooseFromSources([dataRec], ['rejectCode', 'reject_code']);
    const rejectCode = rejectCodeRaw != null ? String(rejectCodeRaw).trim() : '';
    const ingress = String(pickLooseFromSources([dataRec], ['ingress']) ?? '').toLowerCase();
    const rec = normalizeRecommendation(
        patch.recommendation ?? pickLooseFromSources([dataRec], ['recommendation', 'Recommendation'])
    );
    const isReject = Boolean(rejectCode) || ingress.includes('reject') || rec === 'Reject';

    if (isReject && !dataRec.status) {
        updateData.status = 'rejected';
    }

    const incomingNotes = (dataRec.notes || dataRec.comments) as string | undefined;
    if (incomingNotes?.trim()) {
        updateData.notes = incomingNotes.trim();
    } else if (rejectCode) {
        const summary = pickLooseFromSources([dataRec], ['summary', 'Summary']);
        const line = `[n8n:${rejectCode}]${summary ? ` ${String(summary).trim()}` : ''}`;
        const base = existingNotes?.trim() || '';
        updateData.notes = base ? `${base}\n${line}` : line;
    }
}

/** نقطة استقبال n8n: stage1 كتابي، stage2 صوت، stage3 فيديو */
type N8nIngressMode = 'stage1' | 'stage2' | 'stage3';

// Webhook endpoints — فصل استقبال المراحل يمنع تضارب التحديثات بين الاستمارة والصوت
async function handleN8nWebhook(req: StageN8nIngressRequest, res: Response, mode: N8nIngressMode) {
    // مفتاح Idempotency يُحدَّد بعد parse candidateId؛ يُستخدم في الـ catch أيضاً.
    let idempotencyKey = '';
    const ingress = req.stageN8nIngress;
    try {
        const data = req.body;
        const files = req.files as Express.Multer.File[];
        
        console.log(`📥 Received webhook from n8n [ingress=${mode}]`);
        console.log('📋 Data:', JSON.stringify(data, null, 2));
        console.log('📎 Files:', files?.length || 0, 'file(s)');

        let candidateId: string;

        if (ingress) {
            candidateId = ingress.candidateId;
            idempotencyKey = ingress.idempotencyKey;
        } else {
            const parsedId = parseCandidateObjectIdFromWebhook(data as Record<string, unknown>);
            if (!parsedId) {
            return res.status(400).json({
                success: false,
                error: 'Valid candidate ID is required',
                hint: 'Send a 24-character MongoDB ObjectId in candidateId, id, or candidate.id. Do not send the literal string "undefined".',
            });
        }
            candidateId = parsedId;

        // Idempotency — قبل أي كتابة في Mongo أو ضمّ ملفات.
        // n8n retries عند 5xx؛ بدون هذا الحارس قد تُضاف ملفات CV/audio لكل محاولة (appendWebhookFiles).
        idempotencyKey = buildN8nStageIdempotencyKey(req, mode, candidateId);
        const claim = await claimWebhook('n8n', idempotencyKey, {
            mode,
            candidateId,
            filesCount: files?.length || 0,
        });
        if (claim.duplicate) {
            console.log(`♻️ n8n ${mode} duplicate webhook ignored:`, candidateId, idempotencyKey);
            return res.status(200).json({
                success: true,
                duplicate: true,
                message: 'Webhook already processed (idempotency)',
                candidateId,
                filesReceived: files?.length || 0,
                ingress: mode,
                attemptCount: claim.record?.attemptCount,
            });
            }
        }

        // البحث عن المرشح في قاعدة البيانات
        const candidate = await Candidate.findById(candidateId);
        
        if (!candidate) {
            console.error(`❌ Candidate not found: ${candidateId}`);
            await failWebhook('n8n', idempotencyKey, `Candidate not found: ${candidateId}`).catch(() => undefined);
            return res.status(404).json({ 
                success: false,
                error: 'Candidate not found' 
            });
        }

        // Backfill الحملة: يبقى تجميع المراحل (Stage 2/3) داخل حملة واحدة حتى لو لم
        // يُخزَّن campaignId على المرشح وقت إنشائه (مثلاً روابط صوتية/عامة). المصدر:
        // claims موقّعة (secure) ← جسم الطلب/الـ query (legacy). لا نكتب فوق قيمة موجودة.
        if (!candidate.campaignId || !String(candidate.campaignId).trim()) {
            const inboundCampaignId = resolveInboundCampaignId(req, data as Record<string, unknown>);
            if (inboundCampaignId) {
                candidate.campaignId = inboundCampaignId;
                await Candidate.findByIdAndUpdate(candidateId, { campaignId: inboundCampaignId }).catch(
                    (err) => console.warn(`⚠️ campaignId backfill failed for ${candidateId}: ${err?.message || err}`)
                );
                console.log(`🔗 campaignId backfilled for ${candidateId} → ${inboundCampaignId}`);
            }
        }

        const dataRec = data as Record<string, unknown>;
        const inboundApplicationId = resolveInboundApplicationId(req, dataRec);
        const inboundCampaignIdForWrite =
            resolveInboundCampaignId(req, dataRec) ||
            (typeof candidate.campaignId === 'string' ? candidate.campaignId : undefined);
        const writtenExisting = toPlainSubdoc(candidate.writtenInterviewEvaluation);
        const voiceExisting = toPlainSubdoc(candidate.voiceInterviewEvaluation);
        const videoExisting = toPlainSubdoc(candidate.videoInterviewEvaluation);

        const appendWebhookFiles = (upd: Record<string, unknown>) => {
            if (!files || files.length === 0) return;
            const fileRecords = files.map((file) => ({
                filename: file.filename,
                originalName: file.originalname,
                path: file.path,
                mimeType: file.mimetype,
                size: file.size,
                uploadedAt: new Date(),
            }));
            const existingFiles = candidate.files || [];
            upd.files = [...existingFiles, ...fileRecords];
            console.log(`✅ ${files.length} file(s) received for candidate:`, candidateId);
        };

        /** Stage 1: كتابي فقط — عقد ثابت (لا voice/video) */
        if (mode === 'stage1') {
            const patch = buildStrictStage1WrittenPatch(dataRec);
            const stage1EvalCheck = validateStage1WrittenEvaluationPersistence(dataRec, patch);
            if (!stage1EvalCheck.ok) {
                console.log(
                    `[stage_ingress] stage1_incomplete_evaluation candidateRef=${candidateCorrelationRef(candidateId)}`
                );
                return res.status(400).json({
                    success: false,
                    error: stage1EvalCheck.error,
                    message: stage1EvalCheck.message,
                });
            }
            const updateData: Record<string, unknown> = {};
            if (data.aiEvaluation) updateData.aiEvaluation = data.aiEvaluation;
            if (Object.keys(patch).length > 0) {
                updateData.writtenInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(writtenExisting, patch) as Record<string, unknown>
                );
            }
            applyN8nRejectHandling(dataRec, updateData, patch, candidate.notes);
            if (data.status) updateData.status = data.status;
            appendWebhookFiles(updateData);
            if (Object.keys(updateData).length > 0) {
                await dualWriteStageEvaluationUpdate(candidateId, updateData, {
                    applicationId: inboundApplicationId,
                    campaignId: inboundCampaignIdForWrite,
                    mode: 'stage1',
                });
                console.log('✅ Stage1 strict written update:', candidateId);
            }
            if (!ingress) {
            await completeWebhook('n8n', idempotencyKey);
            }
            return res.status(200).json({
                success: true,
                message:
                    'Stage1 (written): fit_for_role, strengths, weaknesses, summary, final_hr_evaluation, recommendation, overall_score',
                candidateId,
                filesReceived: files?.length || 0,
                ingress: mode,
            });
        }

        /** Stage 2: صوت فقط — عقد ثابت (لا written) */
        if (mode === 'stage2') {
            const patch = buildStrictStage2VoicePatch(dataRec);
            const stage2EvalGateMode = getStage2EvaluationGateMode();
            const stage2EvalCheck = validateStage2VoiceEvaluationPersistence(dataRec, patch);
            if (!stage2EvalCheck.ok) {
                console.log(
                    formatStage2EvaluationGateDiagnostic({
                        mode: stage2EvalGateMode,
                        gateResult: 'incomplete',
                        issues: stage2EvalCheck.issues,
                        candidateRef: candidateCorrelationRef(candidateId),
                    })
                );
                if (shouldBlockStage2IncompleteEvaluation(stage2EvalGateMode, stage2EvalCheck)) {
                    return res.status(400).json({
                        success: false,
                        error: stage2EvalCheck.error,
                        message: stage2EvalCheck.message,
                    });
                }
            }
            const updateData: Record<string, unknown> = {};
            if (Object.keys(patch).length > 0) {
                updateData.voiceInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(voiceExisting, patch) as Record<string, unknown>
                );
            }
            applyN8nRejectHandling(dataRec, updateData, patch, candidate.notes);
            if (data.status) updateData.status = data.status;
            appendWebhookFiles(updateData);
            if (Object.keys(updateData).length > 0) {
                await dualWriteStageEvaluationUpdate(candidateId, updateData, {
                    applicationId: inboundApplicationId,
                    campaignId: inboundCampaignIdForWrite,
                    mode: 'stage2',
                });
                console.log('✅ Stage2 strict voice update:', candidateId);
            }
            if (!ingress) {
            await completeWebhook('n8n', idempotencyKey);
            }
            return res.status(200).json({
                success: true,
                message:
                    'Stage2 (voice): Communication Skills, English Fluency, Confidence, Problem Solving, Computer Skills, summary, strengths, weaknesses, professional_attitude, final_hr_evaluation, overall_score, recommendation',
                candidateId,
                filesReceived: files?.length || 0,
                ingress: mode,
            });
        }

        /** Stage 3: فيديو فقط — normalizer (مرن) → strict patch → gate (observe default) */
        if (mode === 'stage3') {
            const normalizedRec = normalizeStage3CallbackPayload(dataRec);
            const patch = buildStrictStage3VideoPatch(normalizedRec);
            const stage3EvalGateMode = getStage3EvaluationGateMode();
            const stage3EvalCheck = validateStage3VideoEvaluationPersistence(normalizedRec, patch);
            if (!stage3EvalCheck.ok) {
                console.log(
                    formatStage3EvaluationGateDiagnostic({
                        mode: stage3EvalGateMode,
                        gateResult: 'incomplete',
                        issues: stage3EvalCheck.issues,
                        candidateRef: candidateCorrelationRef(candidateId),
                    })
                );
                if (shouldBlockStage3IncompleteEvaluation(stage3EvalGateMode, stage3EvalCheck)) {
                    return res.status(400).json({
                        success: false,
                        error: stage3EvalCheck.error,
                        message: stage3EvalCheck.message,
                    });
                }
            }
            const updateData: Record<string, unknown> = {};
            if (data.aiEvaluation) updateData.aiEvaluation = data.aiEvaluation;
            if (Object.keys(patch).length > 0) {
                updateData.videoInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(videoExisting, patch) as Record<string, unknown>
                );
            }
            applyN8nRejectHandling(normalizedRec, updateData, patch, candidate.notes);
            if (data.status) updateData.status = data.status;
            appendWebhookFiles(updateData);
        if (Object.keys(updateData).length > 0) {
            await dualWriteStageEvaluationUpdate(candidateId, updateData, {
                applicationId: inboundApplicationId,
                campaignId: inboundCampaignIdForWrite,
                mode: 'stage3',
            });
                console.log('✅ Stage3 strict video update:', candidateId);
        }
            if (!ingress) {
        await completeWebhook('n8n', idempotencyKey);
            }
            return res.status(200).json({
            success: true,
                message:
                    'Stage3 (video): role_understanding, professional_depth, problem_handling, decision_making, prioritization, process_thinking, responsibility, learning_ability, job_readiness, final_role_fit, summary, overall_score, recommendation',
                candidateId,
            filesReceived: files?.length || 0,
                ingress: mode,
            });
        }

        return res.status(400).json({
            success: false,
            error: 'Unknown ingress mode',
        });

    } catch (error: any) {
        console.error('❌ Error processing n8n webhook:', error);
        if (idempotencyKey) {
            await failWebhook('n8n', idempotencyKey, wbErrorMessage(error)).catch(() => undefined);
        }
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            message: error.message 
        });
    }
}

const n8nUpload = upload.array('files', 10);
const stage1Ingress = (req: Request, res: Response) => {
    void postStageN8nInbound(req as StageN8nIngressRequest, res, 'stage1', handleN8nWebhook);
};
const stage2Ingress = (req: Request, res: Response) => {
    void postStageN8nInbound(req as StageN8nIngressRequest, res, 'stage2', handleN8nWebhook);
};
const stage3Ingress = (req: Request, res: Response) => {
    void postStageN8nInbound(req as StageN8nIngressRequest, res, 'stage3', handleN8nWebhook);
};
app.post('/webhook/n8n/stage1', n8nUpload, stage1Ingress);
app.post('/webhook/n8n/stage2', n8nUpload, stage2Ingress);
app.post('/webhook/n8n/stage3', n8nUpload, stage3Ingress);
// Aliases without /n8n/ (matches n8n Webhook URLs like POST /webhook/stage1)
app.post('/webhook/stage1', n8nUpload, stage1Ingress);
app.post('/webhook/stage2', n8nUpload, stage2Ingress);
app.post('/webhook/stage3', n8nUpload, stage3Ingress);
app.post('/webhook/n8n/written', n8nUpload, stage1Ingress);
app.post('/webhook/n8n/voice', n8nUpload, stage2Ingress);
app.post('/webhook/n8n/video', n8nUpload, stage3Ingress);

// ============================================
// WebSocket Server (Unified - Manual Routing)
// ============================================

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathname = url.pathname;

    console.log(`🔌 New WebSocket connection: ${pathname}`);

    // ============================================
    // Voice Interview WebSocket (voice-only, independent)
    // ============================================
    if (pathname === '/ws/voice-interview') {
        handleVoiceInterviewWsConnection(ws, req);
        return;
    }

    // ============================================
    // Voice Reception WebSocket (voice-only reception agent)
    // ============================================
    if (pathname === '/ws/voice-reception') {
        handleVoiceReceptionWsConnection(ws, req);
        return;
    }

    // ============================================
    // Video Stream WebSocket
    // ============================================
    if (pathname === '/ws/video-stream') {
        const sessionId = url.searchParams.get('sessionId');

        if (!sessionId) {
            console.warn('⚠️ Video WebSocket connection without sessionId, closing...');
            ws.close(1008, 'sessionId is required');
            return;
        }

        // إضافة connection إلى videoStreamService
        addVideoStreamConnection(sessionId, ws);

        ws.on('message', (message) => {
            // Frontend قد يرسل ping messages
            if (message.toString() === 'ping') {
                ws.send('pong');
            }
        });

        ws.on('close', () => {
            console.log(`🔌 Video WebSocket closed for session: ${sessionId.substring(0, 8)}...`);
        });

        ws.on('error', (error) => {
            console.error(`❌ Video WebSocket error for session ${sessionId.substring(0, 8)}...:`, error);
        });

        // إرسال رسالة تأكيد الاتصال فوراً
        ws.send(JSON.stringify({
            type: 'connected',
            sessionId: sessionId,
            message: 'Video stream connection established'
        }));

        return;
    }

    // ============================================
    // Audio Stream WebSocket (DISABLED - LiveKit STT Only)
    // ============================================
    if (pathname === '/ws/audio-stream') {
        // ✅ PRODUCTION FIX: تعطيل Backend Whisper STT تماماً
        // الاعتماد فقط على LiveKit STT (Agent STT) - لا Whisper Backend STT
        // هذا يمنع: تداخل transcripts، hallucinations، صدى، وفوضى
        const sessionId = url.searchParams.get('sessionId');
        const candidateId = url.searchParams.get('candidateId');

        console.warn(`⚠️ PRODUCTION FIX: /ws/audio-stream is DISABLED - using LiveKit STT only`);
        console.warn(`   Session: ${sessionId?.substring(0, 8) || 'unknown'}...`);
        console.warn(`   ✅ Mic → LiveKit Room → Agent STT (Deepgram)`);
        console.warn(`   ❌ AudioWorklet → WebSocket → Backend Whisper STT (DISABLED)`);
        ws.close(1003, 'Backend Whisper STT is disabled - use LiveKit STT only');
            return;
    }

    // إذا كان path غير معروف، نغلق الاتصال
    console.warn(`⚠️ Unknown WebSocket path: ${pathname}`);
    ws.close(1008, 'Unknown path');
});

// ============================================
// تشغيل السيرفر
// ============================================

// Stripe Phase 2b — fail-fast price ID validation when Stripe is enabled.
// In dev without Stripe keys we only warn so the rest of the app keeps working.
if ((process.env.STRIPE_SECRET_KEY || '').trim()) {
    try {
        validateStripePrices();
    } catch (err) {
        console.error('[server] Stripe price validation failed:', err);
        process.exit(1);
    }
    void import('./services/stripePortalConfig.js')
        .then((m) => m.ensureBillingPortalConfiguration())
        .catch((e) =>
            console.warn(
                `[server] Stripe portal config sync skipped: ${e instanceof Error ? e.message : e}`,
            ),
        );
} else {
    console.warn(
        '[server] STRIPE_SECRET_KEY not set — skipping price validation. Billing checkout will be disabled until configured.',
    );
}

// الاتصال بقاعدة البيانات ثم تشغيل السيرفر
connectDatabase().then(() => {
    // Billing background jobs: video stale-lock sweep + compare-email timeout refunds.
    void import('./services/billingSchedulers.js')
        .then((m) => m.startBillingSchedulers())
        .catch((e) => console.warn(`⚠️ Failed to start billing schedulers: ${e?.message || e}`));

    const outboxRetryMs = Number(process.env.STAGE1_OUTBOX_RETRY_MS || 5 * 60 * 1000);
    if (Number.isFinite(outboxRetryMs) && outboxRetryMs > 0) {
        setInterval(() => {
            void processPendingStage1EvaluationOutbox(10).catch((err) => {
                console.warn('[stage1Outbox] retry sweep failed:', err?.message || err);
            });
        }, outboxRetryMs);
    }

    httpServer.listen(PORT, LISTEN_HOST, () => {
        const lan = getLanIPv4();
        console.log(`🚀 Server listening on http://${LISTEN_HOST}:${PORT}`);
        console.log(`   ↳ Local:   http://127.0.0.1:${PORT}  ·  http://localhost:${PORT}`);
        if (LISTEN_HOST === '0.0.0.0' && lan) {
            console.log(`   ↳ LAN:     http://${lan}:${PORT}`);
            console.log(`🔗 n8n Stage1 written: http://${lan}:${PORT}/webhook/n8n/stage1`);
            console.log(`🔗 n8n Stage2 voice: http://${lan}:${PORT}/webhook/n8n/stage2`);
            console.log(`🔗 n8n Stage3 video: http://${lan}:${PORT}/webhook/n8n/stage3`);
            console.log(`   ↳ same handlers: /webhook/stage1 · /webhook/stage2 · /webhook/stage3`);
            console.log(`🔗 Head Hunter (from n8n → store for UI): http://${lan}:${PORT}/webhook/n8n/head-hunter`);
            console.log(`   ↳ alias: /webhook/head-hunter`);
        } else if (LISTEN_HOST === '0.0.0.0') {
            console.log(`🌐 LISTEN_HOST=0.0.0.0 — reach API from other devices using this machine’s IP:${PORT}`);
            console.log(
                `🔗 n8n: interviews …/webhook/n8n/stage1|2|3 · Head Hunter inbound …/webhook/n8n/head-hunter`,
            );
        }
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🎥 WebSocket Server (Video): ws://localhost:${PORT}/ws/video-stream`);
        console.log(`🎤 WebSocket Server (Audio): ws://localhost:${PORT}/ws/audio-stream`);
        console.log(`🗣️ WebSocket Server (Voice Interview): ws://localhost:${PORT}/ws/voice-interview`);
        console.log(`🛎️ WebSocket Server (Voice Reception): ws://localhost:${PORT}/ws/voice-reception`);
        if (lan) {
            console.log(`   ↳ WS (LAN): ws://${lan}:${PORT}/ws/...`);
        }
        console.log(`🔑 Voice Agent API Keys: OPENAI=${process.env.OPENAI_API_KEY ? '✅' : '❌'}, ELEVENLABS=${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}, DEEPGRAM=${process.env.DEEPGRAM_API_KEY ? '✅' : '❌'}, SPEECHMATICS=${process.env.SPEECHMATICS_API_KEY ? '✅' : '❌'}`);
    });
}).catch((error) => {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️ Starting server without database connection...');
    // Start server anyway for development
    httpServer.listen(PORT, LISTEN_HOST, () => {
        const lan = getLanIPv4();
        console.log(`🚀 Server listening on http://${LISTEN_HOST}:${PORT} (without database)`);
        console.log(`   ↳ Local:   http://127.0.0.1:${PORT}  ·  http://localhost:${PORT}`);
        if (LISTEN_HOST === '0.0.0.0' && lan) {
            console.log(`   ↳ LAN:     http://${lan}:${PORT}`);
            console.log(`🔗 n8n Stage1 written: http://${lan}:${PORT}/webhook/n8n/stage1`);
            console.log(`🔗 n8n Stage2 voice: http://${lan}:${PORT}/webhook/n8n/stage2`);
            console.log(`🔗 n8n Stage3 video: http://${lan}:${PORT}/webhook/n8n/stage3`);
            console.log(`   ↳ same handlers: /webhook/stage1 · /webhook/stage2 · /webhook/stage3`);
            console.log(`🔗 Head Hunter (from n8n → store for UI): http://${lan}:${PORT}/webhook/n8n/head-hunter`);
            console.log(`   ↳ alias: /webhook/head-hunter`);
        } else if (LISTEN_HOST === '0.0.0.0') {
            console.log(`🌐 LISTEN_HOST=0.0.0.0 — reach API from other devices using this machine’s IP:${PORT}`);
            console.log(
                `🔗 n8n: interviews …/webhook/n8n/stage1|2|3 · Head Hunter inbound …/webhook/n8n/head-hunter`,
            );
        }
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🎥 WebSocket Server (Video): ws://localhost:${PORT}/ws/video-stream`);
        console.log(`🎤 WebSocket Server (Audio): ws://localhost:${PORT}/ws/audio-stream`);
        console.log(`🗣️ WebSocket Server (Voice Interview): ws://localhost:${PORT}/ws/voice-interview`);
        console.log(`🛎️ WebSocket Server (Voice Reception): ws://localhost:${PORT}/ws/voice-reception`);
        if (lan) {
            console.log(`   ↳ WS (LAN): ws://${lan}:${PORT}/ws/...`);
        }
        console.log(`🔑 Voice Agent API Keys: OPENAI=${process.env.OPENAI_API_KEY ? '✅' : '❌'}, ELEVENLABS=${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}, DEEPGRAM=${process.env.DEEPGRAM_API_KEY ? '✅' : '❌'}, SPEECHMATICS=${process.env.SPEECHMATICS_API_KEY ? '✅' : '❌'}`);
        console.log('⚠️ Warning: Database connection failed. Some features may not work.');
    });
});

// ============================================
// معالجة الأخطاء
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});
