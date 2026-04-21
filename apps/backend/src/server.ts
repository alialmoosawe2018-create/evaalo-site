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
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleVoiceWsConnection } from './voice/voiceWs.js';
import { connectDatabase } from './config/database.js';
import candidateRoutes from './routes/candidates.js';
import recruitmentCampaignRoutes from './routes/recruitmentCampaigns.js';
import healthRoutes from './routes/health.js';
import videoInterviewRoutes from './routes/videoInterview.js';
import voiceInterviewRoutes from './routes/voiceInterview.js';
import Candidate from './models/Candidate.js';
import { addVideoStreamConnection } from './services/videoStreamService.js';
import { createOpenAIConnection, sendAudioToOpenAI, closeOpenAIConnection } from './services/openaiSTTService.js';
import { getLLMResponse } from './services/llmService.js';
import { textToSpeech } from './services/ttsService.js';
import { createLiveKitRoom, createUserToken } from './services/livekitService.js';
import { sendAudioToAvatar, closeAvatarConnection, setAvatarSessionState, hasAvatarConnection } from './services/avatarAudioService.js';
import VideoInterviewSession from './models/VideoInterviewSession.js';

// للحصول على مسار المجلد الحالي في ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// إنشاء تطبيق Express
const app = express();
const PORT = Number(process.env.PORT) || 5000;
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// السماح بقراءة JSON في الطلبات مع زيادة الحد الأقصى لحجم الـ body
// للسماح بإرسال audio chunks كبيرة
app.use(express.json({ limit: '10mb' })); // زيادة الحد من 100kb إلى 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/recruitment-campaigns', recruitmentCampaignRoutes);
app.use('/api/video-interview', videoInterviewRoutes);
app.use('/api/voice-interview', voiceInterviewRoutes);
app.use('/api/health', healthRoutes);

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
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
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
        base[k] = v;
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

/** رفض القيم النصية الخاطئة الشائعة من n8n/JS (مثل "undefined") */
const INVALID_WEBHOOK_ID_TOKENS = new Set(['', 'undefined', 'null', 'nan']);

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

/** تحويل نقاط القوة/الضعف من n8n (نص/سطر/مصفوفة) إلى مصفوفة نصوص */
function normalizeStringArrayForWebhook(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
        const out = raw
            .map((x) => String(x).trim())
            .filter((x) => x && !/^undefined$/i.test(x) && !/^null$/i.test(x));
        return out.length ? out : undefined;
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t || /^undefined$/i.test(t) || /^null$/i.test(t)) return undefined;
        const parts = t
            .split(/\n+|(?:\s*,\s*)/)
            .map((s) => s.trim())
            .filter(Boolean);
        return parts.length ? parts : [t];
    }
    return undefined;
}

/**
 * Stage 1 فقط — حقول التقييم الكتابي (لا صوت/فيديو):
 * fit_for_role, strengths, weaknesses, summary, final_hr_evaluation, recommendation, overall_score
 */
function buildStrictStage1WrittenPatch(data: Record<string, unknown>): Record<string, unknown> {
    const nested = (data.writtenInterviewEvaluation as Record<string, unknown> | undefined) || {};
    const sources: unknown[] = [nested, data];
    const patch: Record<string, unknown> = {};

    const fit = pickLooseFromSources(sources, ['fit_for_role', 'Fit for Role', 'Fit for the role', 'Fit for role']);
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
    ]);
    if (finalHr !== undefined && finalHr !== null && String(finalHr).trim() !== '') {
        patch.final_hr_evaluation = String(finalHr).trim();
    }

    const rec = normalizeRecommendation(
        pickLooseFromSources(sources, ['recommendation', 'Recommendation', 'Final HR Recommendation'])
    );
    if (rec) patch.recommendation = rec;

    const os = pickLooseFromSources(sources, ['overall_score', 'Overall Score']);
    const n = normalizePercent0to100(os);
    if (n !== undefined) patch.overall_score = n;

    return patch;
}

/**
 * Stage 2 فقط — حقول المقابلة الصوتية (لا كتابي):
 * المهارات الخمس + summary + strengths + weaknesses + professional_attitude + final_hr_evaluation + overall_score + recommendation
 */
function buildStrictStage2VoicePatch(data: Record<string, unknown>): Record<string, unknown> {
    const nested = (data.voiceInterviewEvaluation as Record<string, unknown> | undefined) || {};
    const sources: unknown[] = [nested, data];
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

    const os = pickLooseFromSources(sources, ['overall_score', 'Overall Score']);
    const n = normalizePercent0to100(os);
    if (n !== undefined) patch.overall_score = n;

    const rec = normalizeRecommendation(
        pickLooseFromSources(sources, ['recommendation', 'Recommendation', 'Final HR Recommendation'])
    );
    if (rec) patch.recommendation = rec;

    return patch;
}

/** نقطة استقبال n8n: stage1 كتابي، stage2 صوت، stage3 فيديو */
type N8nIngressMode = 'stage1' | 'stage2' | 'stage3';

// Webhook endpoints — فصل استقبال المراحل يمنع تضارب التحديثات بين الاستمارة والصوت
async function handleN8nWebhook(req: Request, res: Response, mode: N8nIngressMode) {
    try {
        const data = req.body;
        const files = req.files as Express.Multer.File[];
        
        console.log(`📥 Received webhook from n8n [ingress=${mode}]`);
        console.log('📋 Data:', JSON.stringify(data, null, 2));
        console.log('📎 Files:', files?.length || 0, 'file(s)');

        const candidateId = parseCandidateObjectIdFromWebhook(data as Record<string, unknown>);
        if (!candidateId) {
            return res.status(400).json({
                success: false,
                error: 'Valid candidate ID is required',
                hint: 'Send a 24-character MongoDB ObjectId in candidateId, id, or candidate.id. Do not send the literal string "undefined".',
            });
        }

        // البحث عن المرشح في قاعدة البيانات
        const candidate = await Candidate.findById(candidateId);
        
        if (!candidate) {
            console.error(`❌ Candidate not found: ${candidateId}`);
            return res.status(404).json({ 
                success: false,
                error: 'Candidate not found' 
            });
        }

        const dataRec = data as Record<string, unknown>;
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
            const updateData: Record<string, unknown> = {};
            if (data.aiEvaluation) updateData.aiEvaluation = data.aiEvaluation;
            if (Object.keys(patch).length > 0) {
                updateData.writtenInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(writtenExisting, patch) as Record<string, unknown>
                );
            }
            if (data.status) updateData.status = data.status;
            if (data.notes || data.comments) updateData.notes = data.notes || data.comments;
            appendWebhookFiles(updateData);
            if (Object.keys(updateData).length > 0) {
                await Candidate.findByIdAndUpdate(candidateId, updateData, { new: true });
                console.log('✅ Stage1 strict written update:', candidateId);
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
            const updateData: Record<string, unknown> = {};
            if (Object.keys(patch).length > 0) {
                updateData.voiceInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(voiceExisting, patch) as Record<string, unknown>
                );
            }
            if (data.status) updateData.status = data.status;
            if (data.notes || data.comments) updateData.notes = data.notes || data.comments;
            appendWebhookFiles(updateData);
            if (Object.keys(updateData).length > 0) {
                await Candidate.findByIdAndUpdate(candidateId, updateData, { new: true });
                console.log('✅ Stage2 strict voice update:', candidateId);
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

        // بعد الإنهاء المبكر لـ stage1/stage2 يبقى stage3 (فيديو) فقط
        const updateData: any = {};

        if (data.aiEvaluation) {
            updateData.aiEvaluation = data.aiEvaluation;
            console.log('✅ Updating AI evaluation for candidate:', candidateId);
        }

        let forceVideo = isVideoWebhookPayload(dataRec);
        forceVideo = true;

        if (data.videoInterviewEvaluation) {
            updateData.videoInterviewEvaluation = withNormalizedOverallScore(
                mergeEval(videoExisting, { ...(data.videoInterviewEvaluation as Record<string, unknown>) }) as Record<
                    string,
                    unknown
                >
            );
            console.log('✅ Updating Video Interview evaluation for candidate:', candidateId);
            console.log('📋 Video Interview Data:', JSON.stringify(data.videoInterviewEvaluation, null, 2));
        }

        if (
            data.overall_score ||
            data['Overall Score'] ||
            data.recommendation ||
            data['Recommendation'] ||
            data['Final HR Recommendation'] ||
            data['Final HR Evaluation'] ||
            data.final_hr_evaluation ||
            data.finalHrEvaluation ||
            forceVideo
        ) {
            if (
                data.videoInterviewEvaluation ||
                data.role_understanding ||
                data.professional_depth ||
                forceVideo
            ) {
                const videoPrior = toPlainSubdoc(updateData.videoInterviewEvaluation) ?? videoExisting;
                const directVideoPatch = {
                    role_understanding: data.role_understanding || data.videoInterviewEvaluation?.role_understanding,
                    professional_depth: data.professional_depth || data.videoInterviewEvaluation?.professional_depth,
                    problem_handling: data.problem_handling || data.videoInterviewEvaluation?.problem_handling,
                    decision_making: data.decision_making || data.videoInterviewEvaluation?.decision_making,
                    prioritization: data.prioritization || data.videoInterviewEvaluation?.prioritization,
                    process_thinking: data.process_thinking || data.videoInterviewEvaluation?.process_thinking,
                    responsibility: data.responsibility || data.videoInterviewEvaluation?.responsibility,
                    learning_ability: data.learning_ability || data.videoInterviewEvaluation?.learning_ability,
                    job_readiness: data.job_readiness || data.videoInterviewEvaluation?.job_readiness,
                    final_role_fit: data.final_role_fit || data.videoInterviewEvaluation?.final_role_fit,
                    overall_score:
                        data.overall_score ??
                        data['Overall Score'] ??
                        data.videoInterviewEvaluation?.overall_score,
                    recommendation:
                        normalizeRecommendation(
                            data.recommendation || data['Recommendation'] || data['Final HR Recommendation']
                        ) || data.videoInterviewEvaluation?.recommendation,
                    summary: data.summary || data.videoInterviewEvaluation?.summary
                } as Record<string, unknown>;
                updateData.videoInterviewEvaluation = withNormalizedOverallScore(
                    mergeEval(videoPrior, directVideoPatch) as Record<string, unknown>
                );
                console.log('✅ Updating Video Interview evaluation (direct format) for candidate:', candidateId);
            }
        }

        // إذا كان هناك حالة محدثة
        if (data.status) {
            updateData.status = data.status;
            console.log('✅ Updating status for candidate:', candidateId, 'to', data.status);
        }

        // إذا كان هناك ملاحظات أو تعليقات
        if (data.notes || data.comments) {
            updateData.notes = data.notes || data.comments;
        }

        // معالجة الملفات المرسلة
        if (files && files.length > 0) {
            const fileRecords = files.map(file => ({
                filename: file.filename,
                originalName: file.originalname,
                path: file.path,
                mimeType: file.mimetype,
                size: file.size,
                uploadedAt: new Date()
            }));

            // إضافة الملفات الجديدة إلى الملفات الموجودة
            const existingFiles = candidate.files || [];
            updateData.files = [...existingFiles, ...fileRecords];
            
            console.log(`✅ ${files.length} file(s) received and saved for candidate:`, candidateId);
            files.forEach(file => {
                console.log(`   - ${file.originalname} (${file.size} bytes) saved as ${file.filename}`);
            });
        }

        // تحديث المرشح إذا كان هناك بيانات للتحديث
        if (Object.keys(updateData).length > 0) {
            await Candidate.findByIdAndUpdate(candidateId, updateData, { new: true });
            console.log('✅ Candidate updated successfully:', candidateId);
        }

        // إرجاع استجابة نجاح
        res.status(200).json({ 
            success: true,
            message: 'Webhook received and processed successfully',
            candidateId: candidateId,
            filesReceived: files?.length || 0,
            ingress: mode
        });

    } catch (error: any) {
        console.error('❌ Error processing n8n webhook:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            message: error.message 
        });
    }
}

const n8nUpload = upload.array('files', 10);
app.post('/webhook/n8n/stage1', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage1'));
app.post('/webhook/n8n/stage2', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage2'));
app.post('/webhook/n8n/stage3', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage3'));
app.post('/webhook/n8n/written', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage1'));
app.post('/webhook/n8n/voice', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage2'));
app.post('/webhook/n8n/video', n8nUpload, (req, res) => handleN8nWebhook(req, res, 'stage3'));

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
        handleVoiceWsConnection(ws, req);
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
        let candidate: any = null;
        
        // جلب candidate (مع دعم test mode) - أولاً لأنه أسرع
        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
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
            // جلب candidate مع timeout
            try {
                const Candidate = (await import('./models/Candidate.js')).default;
                candidate = await Promise.race([
                    Candidate.findById(candidateId).maxTimeMS(2000).lean().exec(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Candidate fetch timeout')), 2000)
                    )
                ]) as any;
                if (!candidate) {
                    console.warn(`⚠️ Candidate not found: ${candidateId.substring(0, 8)}...`);
                } else {
                    console.log(`✅ Candidate loaded: ${candidateId.substring(0, 8)}...`);
                }
            } catch (error: any) {
                console.warn(`⚠️ Error fetching candidate (non-blocking): ${error.message}`);
                // نتابع بدون candidate
            }
        }

        // جلب أو إنشاء session (غير متزامن - لا نوقف الاتصال)
        Promise.race([
            VideoInterviewSession.findOne({ sessionId }).maxTimeMS(2000).exec(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Session fetch timeout')), 2000)
            )
        ]).then(async (foundSession: any) => {
            if (!foundSession) {
                // إنشاء session جديد إذا لم يكن موجوداً
                console.log(`🆕 Session not found, creating new session: ${sessionId.substring(0, 8)}...`);
                try {
                    const mongoose = await import('mongoose');
                    const newSession = new VideoInterviewSession({
                        sessionId: sessionId,
                        candidateId: isTestMode ? new mongoose.default.Types.ObjectId() : (candidate?._id || new mongoose.default.Types.ObjectId()),
                        conversationHistory: [],
                        status: 'active',
                        startedAt: new Date()
                    });
                    
                    // محاولة حفظ في DB (غير متزامن)
                    newSession.save().then((savedSession: any) => {
                        session = savedSession;
                        console.log(`✅ Session created and saved: ${sessionId.substring(0, 8)}...`);
                    }).catch((saveError: any) => {
                        // إذا فشل الحفظ، نستخدم session في الذاكرة
                        console.warn(`⚠️ Error saving new session (non-blocking): ${saveError.message}`);
                        session = newSession;
                        console.log(`✅ Session created in memory: ${sessionId.substring(0, 8)}...`);
                    });
                } catch (createError: any) {
                    console.warn(`⚠️ Error creating session (non-blocking): ${createError.message}`);
                    // نتابع بدون session - سيتم استخدام test mode
                }
            } else {
                session = foundSession;
                console.log(`✅ Session loaded: ${sessionId.substring(0, 8)}...`);
            }
        }).catch((error: any) => {
            console.warn(`⚠️ Error fetching session (non-blocking): ${error.message}`);
            // محاولة إنشاء session جديد حتى لو فشل الجلب
            (async () => {
                try {
                    const mongoose = await import('mongoose');
                    const newSession = new VideoInterviewSession({
                        sessionId: sessionId,
                        candidateId: isTestMode ? new mongoose.default.Types.ObjectId() : (candidate?._id || new mongoose.default.Types.ObjectId()),
                        conversationHistory: [],
                        status: 'active',
                        startedAt: new Date()
                    });
                    newSession.save().then((savedSession: any) => {
                        session = savedSession;
                        console.log(`✅ Session created after timeout: ${sessionId.substring(0, 8)}...`);
                    }).catch(() => {
                        session = newSession;
                        console.log(`✅ Session created in memory after timeout: ${sessionId.substring(0, 8)}...`);
                    });
                } catch (createError: any) {
                    console.warn(`⚠️ Error creating session after timeout: ${createError.message}`);
                }
            })();
        });

        // ✅ PRODUCTION FIX: Whisper STT - اختياري (Agent STT يعمل ممتاز)
        // Agent STT (LiveKit/Deepgram) يعمل بشكل ممتاز ويستخدم فعلياً في الردود
        // Whisper Backend STT = اختياري (للـ recording/analytics فقط)
        const ENABLE_WHISPER_STT = process.env.ENABLE_WHISPER_STT !== 'false'; // Default: true (يمكن تعطيله)
        
        // ✅ PRODUCTION FIX: عند بدء audio stream، نعتبر AvatarSession متصل افتراضياً
        // Agent سيبدأ AvatarSession بعد إنشاء LiveKit Room
        // إذا فشل الاتصال (ECONNREFUSED)، سنحدّث الحالة تلقائياً
        setAvatarSessionState(sessionId, true); // افتراضياً متصل - سيتم تحديثه عند ECONNREFUSED
        
        // ✅ PRODUCTION GATE 1: Transcript Aggregation - إجباري (غير قابل للتفاوض)
        // المعيار الصارم: لا يُرسل إلى LLM إلا إذا: final === true AND صمت ≥ 800-1200ms
        let transcriptBuffer: string[] = [];
        let transcriptBufferTimeout: NodeJS.Timeout | null = null;
        let lastTranscriptTime = Date.now();
        let lastFlushTime = Date.now(); // ✅ PRODUCTION GATE 1: تتبع آخر flush للتحقق من الصمت
        let turnLock = false; // ✅ PRODUCTION GATE 4: Turn lock - منع TTS قبل اكتمال الجملة
        
        // ✅ PRODUCTION GATE 1: صمت ≥ 800-1200ms (نستخدم 1000ms - غير قابل للتفاوض)
        const AGGREGATION_DELAY_MS = 1000; // 1000ms = 1 ثانية (ضمن نطاق 800-1200ms)
        const MIN_WORDS_FOR_IMMEDIATE = 7; // ✅ FIX: زيادة إلى 7 كلمات (جملة مكتملة فعلاً)
        const MIN_WORDS_FOR_PROCESSING = 5; // ✅ FIX: زيادة إلى 5 كلمات (لا fragments)
        const MIN_SILENCE_MS = 1200; // الحد الأدنى للصمت (1200ms)
        
        // ✅ PRODUCTION GATE 1: التحقق من اكتمال الجملة (لا جمل ناقصة)
        const isCompleteSentence = (text: string): boolean => {
            const trimmed = text.trim();
            if (trimmed.length === 0) return false;
            
            // ✅ FIX: جملة مكتملة إذا:
            // 1. انتهت بـ: . ! ? (علامات ترقيم نهائية)
            // 2. أو تحتوي على 7+ كلمات (جملة مكتملة فعلاً)
            const hasEndingPunctuation = /[.!?]$/.test(trimmed);
            const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
            
            // ✅ FIX: رفض fragments واضحة
            if (wordCount < 3) return false; // "Can you", "My name" = fragments
            if (wordCount < 5 && !hasEndingPunctuation) return false; // جمل قصيرة بدون ترقيم = fragments
            
            return hasEndingPunctuation || wordCount >= MIN_WORDS_FOR_IMMEDIATE;
        };
        
        const flushTranscriptBuffer = async () => {
            if (transcriptBuffer.length === 0) return;
            
            const aggregatedTranscript = transcriptBuffer.join(' ').trim();
            
            if (aggregatedTranscript.length === 0) return;
            
            const wordCount = aggregatedTranscript.split(/\s+/).filter(w => w.length > 0).length;
            const now = Date.now();
            const silenceSinceLastTranscript = now - lastTranscriptTime; // ✅ FIX: صمت منذ آخر transcript
            
            console.log(`📦 Flushing transcript buffer: "${aggregatedTranscript}" (${wordCount} words, silence: ${silenceSinceLastTranscript}ms)`);
            
            // ✅ PRODUCTION GATE 1: التحقق الصارم - لا نرسل إلا بعد صمت ≥ 800ms
            if (silenceSinceLastTranscript < MIN_SILENCE_MS) {
                console.log(`⏭️ PRODUCTION GATE 1: Skipping - silence too short (${silenceSinceLastTranscript}ms < ${MIN_SILENCE_MS}ms) - waiting for more silence`);
                // نترك transcript في buffer وننتظر صمت أطول
                return; // لا نرسل - ننتظر صمت أطول
            }
            
            // ✅ PRODUCTION GATE 1: لا تُقبل جمل ناقصة (fragments)
            if (!isCompleteSentence(aggregatedTranscript)) {
                console.log(`⏭️ PRODUCTION GATE 1: Skipping incomplete sentence/fragment: "${aggregatedTranscript}" (${wordCount} words) - waiting for complete sentence`);
                // نترك transcript في buffer وننتظر جملة مكتملة
                return; // لا نرسل fragments إلى LLM
            }
            
            // ✅ PRODUCTION GATE 1: التحقق من الحد الأدنى للكلمات
            if (wordCount < MIN_WORDS_FOR_PROCESSING) {
                console.log(`⏭️ PRODUCTION GATE 1: Skipping - too few words (${wordCount} < ${MIN_WORDS_FOR_PROCESSING}) - waiting for more words`);
                return; // لا نرسل fragments
            }
            
            // ✅ PRODUCTION GATE 1: كل الشروط محققة - نرسل إلى LLM
            transcriptBuffer = []; // مسح buffer بعد التحقق
            lastFlushTime = now; // تحديث وقت آخر flush
            lastTranscriptTime = now; // تحديث وقت آخر transcript
            
            // إرسال transcript إلى Frontend (final)
                    if (ws.readyState === WebSocket.OPEN) {
                        const transcriptMessage = JSON.stringify({
                            type: 'transcript',
                    text: aggregatedTranscript,
                    isFinal: true
                        });
                        ws.send(transcriptMessage);
                console.log(`✅✅✅ PRODUCTION GATE 1: Sent complete sentence to frontend (FINAL): "${aggregatedTranscript}" (${wordCount} words, silence: ${silenceSinceLastTranscript}ms)`);
            }
            
            // ✅ PRODUCTION GATE 4: Turn lock - منع TTS قبل اكتمال الجملة
            turnLock = true;
            
            // ✅ PRODUCTION GATE 1: معالجة مع LLM (كل الشروط محققة)
            await processTranscriptWithLLM(aggregatedTranscript);
        };
        
        const processTranscriptWithLLM = async (transcript: string) => {
            try {
                console.log(`✅✅✅ Processing aggregated transcript with LLM: "${transcript}"`);
                        // إذا لم يكن session متوفراً بعد، نستخدم test mode
                        let currentSession = session;
                        let currentCandidate = candidate;
                        
                        if (!currentCandidate) {
                            currentCandidate = {
                                _id: candidateId,
                                full_name: 'Test Candidate',
                                email: 'test@example.com',
                                position_applied_for: 'Software Developer',
                                skills: ['JavaScript', 'React', 'Node.js'],
                                years_of_experience: '3-5 years'
                            };
                        }
                        
                        if (!currentSession) {
                            // محاولة جلب session من DB مرة أخرى
                            try {
                                const foundSession = await VideoInterviewSession.findOne({ sessionId }).maxTimeMS(1000).exec();
                                if (foundSession) {
                                    currentSession = foundSession;
                                    console.log(`✅ Session found in DB: ${sessionId.substring(0, 8)}...`);
                                } else {
                                    // إنشاء session جديد
                                    console.log(`🆕 Creating new session in onTranscript: ${sessionId.substring(0, 8)}...`);
                                    const mongoose = await import('mongoose');
                                    const newSession = new VideoInterviewSession({
                                        sessionId: sessionId,
                                        candidateId: isTestMode ? new mongoose.default.Types.ObjectId() : (candidate?._id || new mongoose.default.Types.ObjectId()),
                                        conversationHistory: [],
                                        status: 'active',
                                        startedAt: new Date()
                                    });
                                    
                                    try {
                                        await newSession.save();
                                        currentSession = newSession;
                                        session = newSession; // تحديث session في scope الخارجي
                                        console.log(`✅ Session created and saved in onTranscript: ${sessionId.substring(0, 8)}...`);
                                    } catch (saveError: any) {
                                        // إذا فشل الحفظ، نستخدم session في الذاكرة
                                        console.warn(`⚠️ Error saving session in onTranscript (non-blocking): ${saveError.message}`);
                                        currentSession = newSession;
                                        session = newSession;
                                    }
                                }
                            } catch (dbError: any) {
                                // إذا فشل كل شيء، نستخدم session وهمي في الذاكرة
                                console.warn(`⚠️ Error fetching/creating session in onTranscript: ${dbError.message}`);
                                currentSession = {
                                    conversationHistory: [],
                                    addMessage: function(role: string, content: string) {
                                        this.conversationHistory.push({
                                            role: role as 'user' | 'assistant',
                                            content: content,
                                            timestamp: new Date()
                                        });
                                    },
                                    save: async function() {
                                        return Promise.resolve();
                                    }
                                };
                            }
                        }
                        // التحقق من أن transcript غير فارغ
                        if (!transcript || transcript.trim().length === 0) {
                            console.warn(`⚠️ Empty transcript received - skipping processing`);
                            return; // لا نعالج transcripts فارغة
                        }
                        console.log(`📝 Processing final transcript (length: ${transcript.length}): ${transcript.substring(0, 100)}...`);

                        // جلب conversation history
                        const conversationHistory = currentSession.conversationHistory.map((msg: any) => ({
                            role: msg.role,
                            content: msg.content
                        }));

                        // إعداد context
                        const context = {
                            candidateProfile: {
                                full_name: currentCandidate.full_name,
                                email: currentCandidate.email,
                                position_applied_for: currentCandidate.position_applied_for,
                                skills: currentCandidate.skills,
                                experience: currentCandidate.years_of_experience
                            },
                            conversationHistory: conversationHistory,
                            sessionId: sessionId,
                            avatarId: process.env.BEYOND_PRESENCE_AVATAR_ID || undefined
                        };

                        // ✅ Backend مستقل: STT → LLM → TTS → AvatarSession → LiveKit
                        console.log(`🤖 Processing with Backend (STT → LLM → TTS → Avatar)`);
                        
                        // حفظ transcript في session
                        (currentSession as any).addMessage('user', transcript);
                        
                        // تحديث session في scope الخارجي
                        session = currentSession;
                        
                        // محاولة حفظ في DB (غير متزامن - لا نوقف التدفق)
                        if (currentSession.save && typeof currentSession.save === 'function') {
                            currentSession.save().catch((saveError: any) => {
                                console.warn(`⚠️ Error saving session (non-blocking): ${saveError.message}`);
                            });
                        }
                        
                        // ✅ استخدام LLM للحصول على الرد
                        try {
                            console.log(`🤖 Calling LLM with transcript: "${transcript}"`);
                            console.log(`   Conversation history length: ${conversationHistory.length}`);
                            
                            const llmReply = await getLLMResponse(transcript, {
                                candidateProfile: context.candidateProfile,
                                conversationHistory: conversationHistory,
                                sessionId: sessionId,
                                position: currentCandidate.position_applied_for
                            });
                            
                            console.log(`✅✅✅ LLM Reply received: "${llmReply}"`);
                            console.log(`   Reply length: ${llmReply.length} characters`);
                            
                            // حفظ رد LLM في session
                            (currentSession as any).addMessage('assistant', llmReply);
                    
                    // ✅ PRODUCTION GATE 4: Timing Governance - لا يبدأ TTS إلا بعد اكتمال الجملة وتثبيت الدور
                    if (!turnLock) {
                        console.warn('⚠️ PRODUCTION GATE 4: Turn lock not set - skipping TTS (safety check)');
                        turnLock = false;
                        return;
                    }
                            
                            // ✅ استخدام TTS streaming لتحويل الرد إلى صوت وإرساله تدريجياً
                    console.log(`🔊 Starting TTS streaming (turn locked): "${llmReply.substring(0, 50)}..."`);
                            console.log(`   Session ID: ${sessionId.substring(0, 8)}...`);
                            console.log(`   LLM Reply length: ${llmReply.length} characters`);
                            
                            try {
                                let chunkCount = 0;
                                // ✅ FIX: استخدام streaming TTS - إرسال chunks تدريجياً
                                const audioBuffer = await textToSpeech(llmReply, undefined, async (chunk: Buffer) => {
                                    chunkCount++;
                                    console.log(`📤 TTS chunk #${chunkCount} received from ElevenLabs: ${chunk.length} bytes`);
                                    
                            // ✅ PRODUCTION FIX: إرسال كل chunk فوراً إلى Avatar Agent (Drop إذا AvatarSession غير متصل)
                            // ✅ PRODUCTION FIX: لا retry - Drop فوراً عند ECONNREFUSED
                            await sendAudioToAvatar(sessionId, chunk).catch((chunkError: any) => {
                                // ✅ PRODUCTION FIX: ECONNREFUSED = Drop (لا log spam)
                                if (chunkError.code === 'ECONNREFUSED' || chunkError.message?.includes('ECONNREFUSED')) {
                                    // Log مرة واحدة فقط (لا spam)
                                    if (chunkCount === 1) {
                                        console.warn(`⚠️ PRODUCTION FIX: Avatar WebSocket connection refused - dropping TTS chunks (AvatarSession not connected)`);
                                    }
                                    // Drop chunk - لا نرمي error
                                    return;
                                }
                                // أخطاء أخرى - log مرة واحدة فقط
                                if (chunkCount <= 3) {
                                    console.error(`❌ Error sending TTS chunk #${chunkCount} to Avatar:`, chunkError.message);
                                }
                                // Drop chunk - لا نرمي error
                            });
                                });
                                
                                console.log(`✅ TTS streaming completed: ${chunkCount} chunks sent, total ${audioBuffer.length} bytes for session: ${sessionId.substring(0, 8)}...`);
                        
                        // ✅ PRODUCTION GATE 4: إلغاء turn lock بعد اكتمال TTS
                        turnLock = false;
                            } catch (avatarError: any) {
                                console.error(`❌ Error in TTS streaming:`, avatarError);
                                console.error(`   Error message: ${avatarError.message}`);
                                console.error(`   Session ID: ${sessionId.substring(0, 8)}...`);
                        // ✅ PRODUCTION GATE 4: إلغاء turn lock عند error
                        turnLock = false;
                                // نتابع حتى لو فشل إرسال الصوت إلى Avatar
                            }
                            
                            // إرسال رد LLM إلى Frontend عبر WebSocket (للعرض)
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'reply',
                                    text: llmReply
                                }));
                            }
                            
                        } catch (llmError: any) {
                            console.error('❌ Error in LLM/TTS processing:', llmError);
                    // ✅ PRODUCTION GATE 4: إلغاء turn lock عند error
                    turnLock = false;
                    // ✅ PRODUCTION GATE 3: Backpressure - 400/429 = WARN (لا توقف STT/Audio)
                    if (llmError.message?.includes('400') || llmError.message?.includes('429')) {
                        console.warn('⚠️ PRODUCTION GATE 3: Backpressure detected (400/429) - continuing STT/Audio:', llmError.message);
                        // لا نوقف STT أو Audio - نتابع
                    } else {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: llmError.message || 'Error processing response'
                                }));
                            }
                        }
                    }
                } catch (error: any) {
                    console.error('❌ Error processing transcript:', error);
            }
        };
            
            // ✅ PRODUCTION FIX: Whisper STT اختياري - Agent STT يعمل ممتاز
            if (!ENABLE_WHISPER_STT) {
                console.log(`ℹ️ PRODUCTION FIX: Whisper STT disabled - Agent STT (LiveKit/Deepgram) is used instead`);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'connected',
                        sessionId: sessionId,
                        message: 'Audio stream connection established - Agent STT (LiveKit) will handle transcription'
                    }));
                }
            } else {
                // إنشاء OpenAI Whisper connection
                createOpenAIConnection(
                    sessionId,
                    // onTranscript callback
                    async (transcript: string, isFinal: boolean) => {
                try {
                    console.log(`📝✅ Received transcript from OpenAI Whisper (${isFinal ? 'FINAL' : 'PARTIAL'}):`, transcript);
                    console.log(`   Transcript length: ${transcript.length} characters`);
                    
                    // ✅ FIX: إرسال partial transcripts للعرض فقط (real-time feedback)
                    if (!isFinal) {
                        if (ws.readyState === WebSocket.OPEN) {
                            const transcriptMessage = JSON.stringify({
                                type: 'transcript',
                                text: transcript,
                                isFinal: false
                            });
                            ws.send(transcriptMessage);
                            console.log(`✅ Sent PARTIAL transcript to frontend (real-time):`, transcript);
                        }
                        return; // لا نعالج partial transcripts
                    }
                    
                    // ✅ PRODUCTION GATE 1: تجميع final transcripts في buffer
                    // المعيار الصارم: final === true AND صمت ≥ 800-1200ms
                    if (isFinal && transcript.trim().length > 0) {
                        const now = Date.now();
                        const silenceDuration = now - lastTranscriptTime;
                        lastTranscriptTime = now;
                        
                        transcriptBuffer.push(transcript.trim());
                        const currentBuffer = transcriptBuffer.join(' ');
                        const wordCount = currentBuffer.split(/\s+/).filter(w => w.length > 0).length;
                        
                        console.log(`📦 Added to buffer: "${transcript}" (buffer: "${currentBuffer}", ${wordCount} words, silence: ${silenceDuration}ms)`);
                        
                        // ✅ PRODUCTION GATE 1: إلغاء timeout السابق
                        if (transcriptBufferTimeout) {
                            clearTimeout(transcriptBufferTimeout);
                            transcriptBufferTimeout = null;
                        }
                        
                        // ✅ PRODUCTION GATE 1: التحقق الصارم - لا نرسل إلا بعد صمت ≥ 800ms
                        // حتى لو وصلنا 7+ كلمات، ننتظر صمت فعلي
                        if (silenceDuration >= MIN_SILENCE_MS && wordCount >= MIN_WORDS_FOR_IMMEDIATE && isCompleteSentence(currentBuffer)) {
                            // ✅ PRODUCTION GATE 1: كل الشروط محققة - إرسال فوري
                            console.log(`⚡ PRODUCTION GATE 1: All conditions met (silence: ${silenceDuration}ms, words: ${wordCount}, complete: true) - flushing immediately`);
                            await flushTranscriptBuffer();
                        } else {
                            // ✅ PRODUCTION GATE 1: انتظر AGGREGATION_DELAY_MS (1000ms = صمت ≥ 800-1200ms)
                            // هذا يضمن صمت فعلي قبل الإرسال
                            transcriptBufferTimeout = setTimeout(async () => {
                                const finalSilence = Date.now() - lastTranscriptTime;
                                console.log(`⏱️ PRODUCTION GATE 1: Aggregation delay (${AGGREGATION_DELAY_MS}ms) elapsed - final silence: ${finalSilence}ms - flushing buffer`);
                                await flushTranscriptBuffer();
                                transcriptBufferTimeout = null;
                            }, AGGREGATION_DELAY_MS);
                        }
                    }
                } catch (error: any) {
                    console.error('❌ Error in transcript aggregation:', error);
                }
            },
            // onError callback
            (error: Error) => {
                // ✅ FIX: تنظيف buffer عند error
                if (transcriptBufferTimeout) {
                    clearTimeout(transcriptBufferTimeout);
                    transcriptBufferTimeout = null;
                }
                // إرسال أي transcripts متبقية قبل الإغلاق
                if (transcriptBuffer.length > 0) {
                    flushTranscriptBuffer().catch((flushError) => {
                        console.error('❌ Error flushing buffer on error:', flushError);
                    });
                }
                console.error('❌ OpenAI Whisper error:', error);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: error.message
                    }));
                }
            },
            // onReady callback - إرسال "connected" بعد جاهزية OpenAI Whisper
            () => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'connected',
                        sessionId: sessionId,
                        message: 'Audio stream connection established - OpenAI Whisper ready'
                    }));
                    console.log(`✅ Audio stream ready for session: ${sessionId.substring(0, 8)}...`);
                }
            }
        );
            } // End of ENABLE_WHISPER_STT check

        // معالجة الرسائل من Frontend (audio chunks) - Binary فقط
        ws.on('message', (message: any, isBinary: boolean) => {
            try {
                // معالجة ping/pong (text messages)
                if (!isBinary) {
                    const textMessage = message.toString();
                    
                    // ping message (نص عادي أو JSON)
                    if (textMessage === 'ping') {
                        ws.send('pong');
                        return;
                    }
                    
                    // JSON ping message
                    try {
                        const data = JSON.parse(textMessage);
                        if (data.type === 'ping') {
                            ws.send(JSON.stringify({ type: 'pong' }));
                            return;
                        }
                        if (data.type === 'init' || data.type === 'control') {
                            return; // Control messages
                        }
                    } catch {
                        // ليس JSON - تجاهله
                    }
                    return;
                }

                // Binary message = audio chunk (PCM16 من AudioWorklet)
                // ✅ PRODUCTION FIX: Whisper STT اختياري - Agent STT يعمل ممتاز
                const audioBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
                if (audioBuffer.length > 0) {
                    // ✅ FIX: Log واضح لكل chunk (في البداية) ثم كل 50 chunk
                    const chunkDurationMs = (audioBuffer.length / 2 / 16000) * 1000; // PCM16 = 2 bytes per sample
                    
                    if (ENABLE_WHISPER_STT) {
                        console.log(`🎧 Received audio chunk from Frontend: ${audioBuffer.length} bytes (${chunkDurationMs.toFixed(1)}ms @ 16kHz) for session: ${sessionId.substring(0, 8)}... - sending to Whisper`);
                    
                    // إرسال PCM16 إلى OpenAI Whisper
                        // ✅ PRODUCTION GATE 3: Backpressure - 400/429 = WARN (لا توقف STT)
                        sendAudioToOpenAI(sessionId, audioBuffer).catch((error: any) => {
                            if (error.message?.includes('400') || error.message?.includes('429')) {
                                console.warn(`⚠️ PRODUCTION GATE 3: Backpressure (400/429) - continuing STT:`, error.message);
                                // لا نوقف STT - نتابع
                            } else {
                        console.error(`❌ Error sending audio to OpenAI Whisper:`, error);
                            }
                        });
                    } else {
                        // ✅ PRODUCTION FIX: Whisper معطل - Agent STT (LiveKit) يعمل
                        // لا نرسل إلى Whisper - Agent STT يعمل بشكل ممتاز
                        if (audioBuffer.length % 100 === 0) { // Log كل 100 chunk فقط
                            console.log(`🎧 Received audio chunk (Whisper disabled - Agent STT handles transcription): ${audioBuffer.length} bytes`);
                        }
                    }
                } else {
                    console.warn(`⚠️ Empty audio chunk received for session: ${sessionId.substring(0, 8)}...`);
                }
            } catch (error: any) {
                console.error('❌ Error processing audio message:', error);
            }
        });

        ws.on('close', () => {
            console.log(`🔌 Audio stream WebSocket closed for session: ${sessionId.substring(0, 8)}...`);
            // ✅ FIX: تنظيف buffer و timeout عند إغلاق الاتصال
            if (transcriptBufferTimeout) {
                clearTimeout(transcriptBufferTimeout);
                transcriptBufferTimeout = null;
            }
            // إرسال أي transcripts متبقية قبل الإغلاق
            if (transcriptBuffer.length > 0) {
                flushTranscriptBuffer().catch((flushError) => {
                    console.error('❌ Error flushing buffer on close:', flushError);
                });
            }
            // ✅ PRODUCTION FIX: إغلاق OpenAI Whisper connection (إذا كان مفعلاً)
            if (ENABLE_WHISPER_STT) {
            closeOpenAIConnection(sessionId);
            }
            // ✅ PRODUCTION FIX: إغلاق Avatar connection وتحديث الحالة
            // AvatarSession انتهت - لا نرسل TTS بعد الآن
            setAvatarSessionState(sessionId, false);
            closeAvatarConnection(sessionId);
        });

        ws.on('error', (error) => {
            console.error(`❌ Audio stream WebSocket error:`, error);
        });

        return;
    }

    // ============================================
    // Video Stream WebSocket (continues...)
    // ============================================

    // إذا كان path غير معروف، نغلق الاتصال
    console.warn(`⚠️ Unknown WebSocket path: ${pathname}`);
    ws.close(1008, 'Unknown path');
});

// ============================================
// تشغيل السيرفر
// ============================================

// الاتصال بقاعدة البيانات ثم تشغيل السيرفر
connectDatabase().then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
        console.log(`🌐 Server is accessible from network: http://192.168.1.104:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Stage1 written: http://192.168.1.104:${PORT}/webhook/n8n/stage1`);
        console.log(`🔗 n8n Stage2 voice: http://192.168.1.104:${PORT}/webhook/n8n/stage2`);
        console.log(`🔗 n8n Stage3 video: http://192.168.1.104:${PORT}/webhook/n8n/stage3`);
        console.log(`🎥 WebSocket Server (Video): ws://localhost:${PORT}/ws/video-stream`);
        console.log(`🎤 WebSocket Server (Audio): ws://localhost:${PORT}/ws/audio-stream`);
        console.log(`🗣️ WebSocket Server (Voice Interview): ws://localhost:${PORT}/ws/voice-interview`);
        console.log(`🔑 Voice Agent API Keys: OPENAI=${process.env.OPENAI_API_KEY ? '✅' : '❌'}, ELEVENLABS=${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}, DEEPGRAM=${process.env.DEEPGRAM_API_KEY ? '✅' : '❌'}, SPEECHMATICS=${process.env.SPEECHMATICS_API_KEY ? '✅' : '❌'}`);
    });
}).catch((error) => {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️ Starting server without database connection...');
    // Start server anyway for development
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT} (without database)`);
        console.log(`🌐 Server is accessible from network: http://192.168.1.104:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Stage1 written: http://192.168.1.104:${PORT}/webhook/n8n/stage1`);
        console.log(`🔗 n8n Stage2 voice: http://192.168.1.104:${PORT}/webhook/n8n/stage2`);
        console.log(`🔗 n8n Stage3 video: http://192.168.1.104:${PORT}/webhook/n8n/stage3`);
        console.log(`🎥 WebSocket Server (Video): ws://localhost:${PORT}/ws/video-stream`);
        console.log(`🎤 WebSocket Server (Audio): ws://localhost:${PORT}/ws/audio-stream`);
        console.log(`🗣️ WebSocket Server (Voice Interview): ws://localhost:${PORT}/ws/voice-interview`);
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
