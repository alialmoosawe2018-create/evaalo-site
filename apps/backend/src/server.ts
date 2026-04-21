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

        console.warn(`⚠️ PRODUCTION FIX: /ws/audio-stream is DISABLED - using LiveKit STT only`);
        console.warn(`   Session: ${sessionId?.substring(0, 8) || 'unknown'}...`);
        console.warn(`   ✅ Mic → LiveKit Room → Agent STT (Deepgram)`);
        console.warn(`   ❌ AudioWorklet → WebSocket → Backend Whisper STT (DISABLED)`);
        ws.close(1003, 'Backend Whisper STT is disabled - use LiveKit STT only');
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
