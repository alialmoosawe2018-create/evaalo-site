import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Candidate, { ICandidate } from '../models/Candidate.js';
import * as candidateRepo from '../repositories/candidateRepository.js';
import CandidateApplication from '../models/CandidateApplication.js';
import {
    upsertCandidateApplication,
    listApplicationsAsStageRows,
    listApplicationsAsStageRowsPage,
    syncEmailDenormForCandidate,
    applicationToStageListRow,
    findApplicationForCallback,
    pushApplicationEvent,
    toApplicationAttachments,
} from '../services/candidateApplicationService.js';
import { emitDomainEventBestEffort } from '../services/domainEventService.js';
import HeadHunterSourcingContext from '../models/HeadHunterSourcingContext.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import {
    buildSubmissionInputFromRequest,
    mergeValidatedIntoCandidateData,
    validateApplicationSubmission,
} from '../services/applicationSubmitValidation.js';
import {
    markFirstCandidateIfNeeded,
    resolveCampaignFormBindingForCandidateSubmit,
} from '../services/publicCampaignService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';
import type { CampaignFormBinding } from '../shared/formTemplates/types.js';
import { CERTIFICATES_MAX_FILES } from '../shared/formTemplates/types.js';
import { sendStatusUpdateToN8N } from '../services/n8nService.js';
import {
    enqueueStage1EvaluationOutbox,
    dispatchStage1EvaluationOutbox,
    normalizeStage1RubricSnapshotHash,
} from '../services/stage1EvaluationOutboxService.js';
import { normalizeStage1EvaluationLanguage } from '../services/stage1EvaluationLanguage.js';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';
import { extractHoneypotFields, isHoneypotTriggered } from '../constants/n8nStage1.js';
import { upload } from '../middleware/upload.js';
import { getOrgId } from '../middleware/auth.js';
import { DEFAULT_ORG_ID } from '../config/multiTenant.js';
import { orgScopedQuery, orgScopedDefaults } from '../middleware/orgScope.js';
import { requirePermission } from '../middleware/rbac.js';
import { logAudit } from '../services/auditService.js';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { getPresignedDownloadUrl } from '../services/r2Service.js';
import { ensureBlueprintForCampaign } from '../services/expertise/ensureBlueprint.js';
import {
    clearVoiceLinkAccess,
    clearVideoLinkAccess,
} from '../services/interviewLinkAccess.js';

const router = express.Router();

/** الاستمارة قد ترسل languages كـ [{ name, level }] بينما المخطط يخزن string[] */
function normalizeLanguagesToStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of input) {
        let s = '';
        if (typeof item === 'string') {
            s = item.trim();
        } else if (item && typeof item === 'object' && item !== null && 'name' in item) {
            const name = String((item as { name?: string }).name || '').trim();
            const level = String((item as { level?: string }).level || '').trim();
            if (!name && !level) s = '';
            else if (level) s = `${name} (${level})`;
            else s = name;
        } else {
            s = String(item ?? '').trim();
        }
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

// GET /api/candidates - جلب جميع المرشحين
// قائمة المرشحين — لوحات HR المصادقة فقط (التدفقات العامة للمرشح تستخدم POST / و GET /:id).
router.get('/', conditionalRequireAuth(), requirePermission('candidate.read'), async (req: Request, res: Response) => {
    try {
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            console.warn('⚠️ Database not connected. Returning empty array.');
            return res.json({
                success: true,
                count: 0,
                data: [],
                warning: 'Database is not connected. Please check database connection.'
            });
        }
        
        const campaignFilter = typeof req.query.campaignId === 'string' && req.query.campaignId.trim()
            ? { campaignId: req.query.campaignId.trim() }
            : {};
        const forView =
            typeof req.query.forView === 'string' ? req.query.forView.trim() : '';
        const viewFilter =
            forView === 'candidates'
                ? { hiddenFromViews: { $nin: ['candidates'] } }
                : {};

        const orgId = getOrgId(req);
        const listExtraFilter =
            forView === 'candidates' ? { hiddenFromViews: { $nin: ['candidates'] } } : {};

        // Opt-in cursor pagination: engaged only when the client sends limit/cursor,
        // so the existing full-list frontend behavior stays unchanged until it adopts
        // paging. An empty first page falls through to the legacy candidate list.
        const wantsPage =
            typeof req.query.limit === 'string' || typeof req.query.cursor === 'string';
        if (wantsPage) {
            const page = await listApplicationsAsStageRowsPage({
                organizationId: orgId,
                campaignId: campaignFilter.campaignId as string | undefined,
                extraFilter: listExtraFilter,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
            });
            if (page.rows.length > 0 || typeof req.query.cursor === 'string') {
                return res.json({
                    success: true,
                    count: page.rows.length,
                    data: page.rows,
                    nextCursor: page.nextCursor,
                    hasMore: page.hasMore,
                    rowKind: 'application',
                });
            }
            // first page empty → fall through to legacy candidate list below
        }

        // Many-to-Many: فضّل صفوف Application إن وُجدت؛ وإلا fallback لـ Candidate القديم.
        const appRows = await listApplicationsAsStageRows({
            organizationId: orgId,
            campaignId: campaignFilter.campaignId as string | undefined,
            extraFilter: listExtraFilter,
        });
        if (appRows.length > 0) {
            const filtered =
                forView === 'candidates'
                    ? appRows.filter((r) => {
                          const hidden = r.hiddenFromViews;
                          return !(Array.isArray(hidden) && hidden.includes('candidates'));
                      })
                    : appRows;
            return res.json({
                success: true,
                count: filtered.length,
                data: filtered,
                rowKind: 'application',
            });
        }

        const candidates = await candidateRepo.listLegacyScoped(getOrgId(req), {
            ...campaignFilter,
            ...viewFilter,
        });
        res.json({
            success: true,
            count: candidates.length,
            data: candidates,
            rowKind: 'candidate_legacy',
        });
    } catch (error: any) {
        console.error('Error fetching candidates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch candidates',
            message: error.message
        });
    }
});

// GET /api/candidates/notification-summary
// The notifications badge needs a count, not the candidate list. Serving it from
// GET / meant every protected page downloaded ~413 KB (105 rows x 39 fields,
// `videoInterviewEvaluation` alone ~4 KB each) to produce one number, and that
// cost grows linearly with the tenant's candidate count.
//
// The final count cannot be computed here: it depends on `lastViewedAt` and the
// dismissed-notification keys, which live in the viewer's localStorage. So this
// returns the same rows as GET /, projected down to exactly the fields the
// client predicates read — `getCandidateActivityTime` (the three dates),
// `getNotificationDismissKey` (_id) and `screeningAnalysisHoldUntil`
// (entryStage, files length, createdAt, and the scalar keys
// `hasMeaningfulStageEvaluation` tests). Field names and shapes are unchanged,
// so the shared frontend helpers work against this response untouched.
//
// MUST stay above `GET /:id`, which would otherwise capture this path.
const EVAL_PREDICATE_KEYS = [
    'recommendation',
    'overall_score',
    'summary',
    'final_hr_evaluation',
    'role_understanding',
    'professional_depth',
    'final_role_fit',
] as const;

/**
 * The client only asks "does this stage have a real evaluation?" — it never
 * reads the content here. Two of the keys it tests (`summary`,
 * `final_hr_evaluation`) are long narrative text and are the bulk of the
 * response, so report the answer instead of shipping the evidence:
 * `{ hasContent: true }`, which `hasMeaningfulStageEvaluation` accepts.
 */
function projectEvaluation(value: unknown): { hasContent: true } | null {
    if (!value || typeof value !== 'object') return null;
    const src = value as Record<string, unknown>;
    const meaningful = EVAL_PREDICATE_KEYS.some((k) => {
        const v = src[k];
        return typeof v === 'string' ? v.length > 0 : v != null;
    });
    return meaningful ? { hasContent: true } : null;
}

router.get(
    '/notification-summary',
    conditionalRequireAuth(),
    requirePermission('candidate.read'),
    async (req: Request, res: Response) => {
        try {
            if (mongoose.connection.readyState !== 1) {
                return res.json({ success: true, count: 0, data: [] });
            }
            const orgId = getOrgId(req);
            const viewFilter = { hiddenFromViews: { $nin: ['candidates'] } };
            // Same Application-first / legacy-Candidate fallback as GET /, so an
            // org still on legacy rows keeps its badge instead of silently
            // counting zero.
            const appRows = await listApplicationsAsStageRows({
                organizationId: orgId,
                extraFilter: viewFilter,
            });
            const rows =
                appRows.length > 0
                    ? appRows
                    : ((await candidateRepo.listLegacyScoped(orgId, {
                          ...viewFilter,
                      })) as unknown as Record<string, unknown>[]);
            const data = rows.map((r) => ({
                _id: r._id,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                interviewDate: r.interviewDate,
                entryStage: r.entryStage,
                // Only the length is read, but it must stay an array for
                // `Array.isArray(c.files)`; ids keep it real data, not a stub.
                files: Array.isArray(r.files)
                    ? (r.files as Record<string, unknown>[]).map((f) => ({ _id: f?._id }))
                    : [],
                writtenInterviewEvaluation: projectEvaluation(r.writtenInterviewEvaluation),
                voiceInterviewEvaluation: projectEvaluation(r.voiceInterviewEvaluation),
                videoInterviewEvaluation: projectEvaluation(r.videoInterviewEvaluation),
            }));
            return res.json({ success: true, count: data.length, data });
        } catch (error: any) {
            console.error('❌ notification-summary failed:', error?.message);
            // The badge is not worth failing a page over — an empty list just
            // renders no badge, and the next cycle retries.
            return res.json({ success: true, count: 0, data: [] });
        }
    }
);

// POST /api/candidates/:id/hiring-outcome
// Record what the employer actually did. This is the only signal in the product
// that says whether an AI evaluation was RIGHT — everything else is the model
// grading itself, which is why "does the agent improve over time?" had no data to
// stand on.
//
// The AI's verdict is frozen here rather than read back later: prompts, blueprints
// and Stage 2 scoring all change (three of them changed today), so a pair formed
// now and read next month would compare a human decision against a verdict that no
// longer exists. Snapshot at decision time or the dataset rewrites its own history.
//
// MUST stay above `GET /:id`.
router.post(
    '/:id/hiring-outcome',
    conditionalRequireAuth(),
    requirePermission('candidate.write'),
    async (req: Request, res: Response) => {
        try {
            const id = String(req.params.id || '').trim();
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, message: 'invalid application id' });
            }
            const decision = String(req.body?.decision || '').trim();
            const VALID = ['hired', 'not_hired', 'withdrawn'];
            if (!VALID.includes(decision)) {
                return res
                    .status(400)
                    .json({ success: false, message: `decision must be one of ${VALID.join(', ')}` });
            }

            const orgId = getOrgId(req);
            const app = await CandidateApplication.findOne({ _id: id, organizationId: orgId }).exec();
            if (!app) {
                return res.status(404).json({ success: false, message: 'application not found' });
            }

            // Freeze the AI verdict from the furthest stage that actually produced one,
            // and record which stage that was — a "Hire" off a CV screen and a "Hire"
            // after a video interview are not the same prediction.
            const stages: Array<['screening' | 'voice' | 'video', any]> = [
                ['video', (app as any).videoInterviewEvaluation],
                ['voice', (app as any).voiceInterviewEvaluation],
                ['screening', (app as any).writtenInterviewEvaluation],
            ];
            let stageAtDecision: 'screening' | 'voice' | 'video' | undefined;
            let aiRecommendationAtDecision: string | undefined;
            let aiScoreAtDecision: number | undefined;
            for (const [stage, evaluation] of stages) {
                const rec = evaluation?.recommendation;
                if (!rec) continue;
                stageAtDecision = stage;
                aiRecommendationAtDecision = String(rec);
                const score = Number(evaluation?.overall_score);
                if (Number.isFinite(score)) aiScoreAtDecision = score;
                break;
            }

            (app as any).hiringOutcome = {
                decision,
                decidedAt: new Date(),
                decidedByClerkUserId: (req as any).auth?.userId || undefined,
                stageAtDecision,
                aiRecommendationAtDecision,
                aiScoreAtDecision,
                note: typeof req.body?.note === 'string' ? req.body.note.trim() : undefined,
            };
            await app.save();

            return res.json({ success: true, hiringOutcome: (app as any).hiringOutcome });
        } catch (error: any) {
            console.error('❌ hiring-outcome failed:', error?.message || error);
            return res.status(500).json({ success: false, message: 'failed to record outcome' });
        }
    }
);

// Mock مرشح للتطوير (عند استخدام candidateId=xxx أو test)
const MOCK_CANDIDATE = {
    _id: '000000000000000000000001',
    full_name: 'Test User',
    email: 'test@example.com',
    position_applied_for: 'Developer',
    skills: [],
    years_of_experience: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
};

// GET /api/candidates/:id - جلب مرشح محدد
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const isDevMock = (id === 'xxx' || id === 'test') && process.env.NODE_ENV !== 'production';
        if (isDevMock) {
            return res.json({
                success: true,
                data: MOCK_CANDIDATE,
                _mock: true
            });
        }
        if (!mongoose.Types.ObjectId.isValid(id) || id.length !== 24) {
            return res.status(400).json({
                success: false,
                error: 'Invalid candidate ID',
                message: 'candidateId must be a valid 24-character hex string (e.g. 65f1c2b8e9a3d41c0a12b345)'
            });
        }

        const authOrgId = getOrgId(req);
        const isPublicInterviewLookup = !authOrgId;

        // قد يكون المعرّف Application MongoId (صفوف Stage بعد M2M)
        const appQuery: Record<string, unknown> = { _id: id, deletedAt: null };
        if (!isPublicInterviewLookup) {
            Object.assign(appQuery, orgScopedQuery(req, {}));
        }
        const asApp = await CandidateApplication.findOne(appQuery).lean();
        if (asApp) {
            const person = await candidateRepo.findByIdLean(
                asApp.candidateId as string | mongoose.Types.ObjectId,
            );
            if (
                isPublicInterviewLookup &&
                String((person as { sourceType?: string } | null)?.sourceType || '').toLowerCase() !==
                    'public_screening'
            ) {
                return res.status(404).json({
                    success: false,
                    error: 'Candidate not found',
                });
            }
            return res.json({
                success: true,
                data: applicationToStageListRow(
                    asApp as Record<string, unknown>,
                    person as Record<string, unknown> | null
                ),
                rowKind: 'application',
            });
        }

        const candidate = isPublicInterviewLookup
            ? await Candidate.findOne({ _id: id, sourceType: 'public_screening' })
            : await Candidate.findOne(orgScopedQuery(req, { _id: id }));
        
        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        
        res.json({
            success: true,
            data: candidate
        });
    } catch (error: any) {
        console.error('Error fetching candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch candidate',
            message: error.message
        });
    }
});

// توليد رابط تنزيل موقّت (Presigned URL) لتسجيل المقابلة الصوتية للمرشح.
// لا تُخزَّن روابط دائمة؛ نخزّن المفتاح فقط ونولّد الرابط عند الطلب.
// لمراجعي HR فقط (VoiceRecordingCell في اللوحة) — ليس جزءاً من تدفق المرشح العام.
router.get('/:id/voice-recording', conditionalRequireAuth(), requirePermission('candidate.read'), async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id) || id.length !== 24) {
            return res.status(400).json({ success: false, error: 'Invalid candidate ID' });
        }
        const candidate = await Candidate.findOne(orgScopedQuery(req, { _id: id }))
            .select('voiceRecording')
            .lean();
        let key = (candidate as any)?.voiceRecording?.key as string | undefined;
        if (!key) {
            const app = await CandidateApplication.findOne({
                $or: [{ _id: id }, { candidateId: id }],
                deletedAt: null,
            })
                .select('voiceRecording organizationId')
                .lean();
            key = (app as any)?.voiceRecording?.key as string | undefined;
        }
        if (!key) {
            return res.status(404).json({ success: false, error: 'No recording for this candidate' });
        }
        const expiresIn = 3600;
        const url = await getPresignedDownloadUrl(key, expiresIn);
        res.json({ success: true, data: { url, expiresIn } });
    } catch (error: any) {
        console.error('Error generating voice recording URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate recording URL',
            message: error.message
        });
    }
});

// إعادة فتح رابط مقابلة صوتية أو فيديو (HR) بعد استخدام الرابط.
router.post(
    '/:id/interview-link-reset',
    conditionalRequireAuth(),
    requirePermission('candidate.write'),
    async (req: Request, res: Response) => {
        try {
            const id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id) || id.length !== 24) {
                return res.status(400).json({ success: false, error: 'Invalid candidate ID' });
            }
            const stage = String(req.body?.stage || '').trim().toLowerCase();
            if (stage !== 'voice' && stage !== 'video') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid stage',
                    message: 'stage must be "voice" or "video"',
                });
            }

            const bodyApplicationId =
                typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
            const bodyCampaignId =
                typeof req.body?.campaignId === 'string' ? req.body.campaignId.trim() : '';

            // :id قد يكون Application MongoId (صفوف Stage بعد M2M)
            let personId = id;
            let linkScope: { applicationId?: string; campaignId?: string } = {
                applicationId: bodyApplicationId || undefined,
                campaignId: bodyCampaignId || undefined,
            };
            const asApp = await CandidateApplication.findOne({
                _id: id,
                deletedAt: null,
            })
                .select('candidateId applicationId campaignId organizationId')
                .lean();
            if (asApp) {
                personId = String(asApp.candidateId);
                linkScope = {
                    applicationId: asApp.applicationId || bodyApplicationId || undefined,
                    campaignId: asApp.campaignId || bodyCampaignId || undefined,
                };
            }

            const existing = await Candidate.findById(personId)
                .select('organizationId voiceInterviewLinkConsumedAt videoInterviewLinkConsumedAt full_name')
                .lean();
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }
            const reqOrg = getOrgId(req);
            const candidateOrg = existing.organizationId || DEFAULT_ORG_ID;
            if (candidateOrg !== reqOrg) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }

            const cleared =
                stage === 'voice'
                    ? await clearVoiceLinkAccess(personId, linkScope)
                    : await clearVideoLinkAccess(personId, linkScope);
            if (!cleared) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }

            logAudit(req, {
                action: 'candidate.interview_link_reset',
                targetType: 'candidate',
                targetId: personId,
                metadata: {
                    stage,
                    applicationId: linkScope.applicationId || null,
                    campaignId: linkScope.campaignId || null,
                    requestId: id,
                },
            });

            return res.json({
                success: true,
                message:
                    stage === 'voice'
                        ? 'Voice interview link has been reopened.'
                        : 'Video interview link has been reopened.',
            });
        } catch (error: any) {
            console.error('Error resetting interview link:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to reset interview link',
                message: error.message,
            });
        }
    }
);

const ALLOWED_PHOTO_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

// رفع/استبدال صورة شخصية لمرشح موجود (من مودال التفاصيل).
router.post(
    '/:id/photo',
    requirePermission('candidate.write'),
    upload.single('photo'),
    async (req: Request, res: Response) => {
        try {
            const id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id) || id.length !== 24) {
                return res.status(400).json({ success: false, error: 'Invalid candidate ID' });
            }
            const file = req.file;
            if (!file) {
                return res.status(400).json({ success: false, error: 'No photo file uploaded' });
            }
            if (!ALLOWED_PHOTO_MIMES.has(file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP',
                });
            }

            const candidate = await Candidate.findOne(orgScopedQuery(req, { _id: id }));
            if (!candidate) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }

            const existingFiles = Array.isArray(candidate.files) ? [...candidate.files] : [];
            const withoutPhoto = existingFiles.filter(
                (f) => f.kind !== 'photo' && !String(f.mimeType || '').startsWith('image/')
            );
            const newPhoto = {
                kind: 'photo' as const,
                filename: file.filename,
                originalName: file.originalname,
                path: file.path,
                mimeType: file.mimetype,
                size: file.size,
                uploadedAt: new Date(),
            };
            candidate.files = [...withoutPhoto, newPhoto];
            await candidate.save();

            logAudit(req, {
                action: 'candidate.photo_uploaded',
                targetType: 'candidate',
                targetId: candidate._id?.toString(),
            });

            res.json({
                success: true,
                message: 'Photo uploaded successfully',
                data: candidate,
            });
        } catch (error: any) {
            console.error('Error uploading candidate photo:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to upload photo',
                message: error.message,
            });
        }
    }
);

// Multer للحصول على multipart/form-data (مع الملفات أو بدونه)
const candidateUpload = upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'certificates', maxCount: CERTIFICATES_MAX_FILES }
]);

/** JSON body: لا نمرّر multer لأنه يستهلك الـ stream؛ multipart فقط للاستمارة مع الملفات */
const candidateUploadOptional = (req: Request, res: Response, next: NextFunction) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
        return candidateUpload(req, res, next);
    }
    next();
};

/** توحيد مفاتيح المرشح: camelCase → snake_case + دمج firstName/lastName → full_name */
const CAMEL_TO_SNAKE_CANDIDATE: [string, string][] = [
    ['fullName', 'full_name'],
    ['positionAppliedFor', 'position_applied_for'],
    ['companyAppliedTo', 'company_applied_to'],
    ['yearsOfExperience', 'years_of_experience'],
    ['currentCompany', 'current_company'],
    ['highestEducationLevel', 'highest_education_level'],
];

function normalizeCandidateBodyKeys(body: Record<string, any>): void {
    for (const [camel, snake] of CAMEL_TO_SNAKE_CANDIDATE) {
        const snakeVal = body[snake];
        const snakeEmpty =
            snakeVal == null || (typeof snakeVal === 'string' && !String(snakeVal).trim());
        if (snakeEmpty && body[camel] != null && body[camel] !== '') {
            body[snake] = body[camel];
        }
        delete body[camel];
    }
    const fn = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const ln = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const existingFull = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    if (!existingFull && (fn || ln)) {
        body.full_name = [fn, ln].filter(Boolean).join(' ').trim();
    }
    delete body.firstName;
    delete body.lastName;
}

function parseSkillsOrLanguagesArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return normalizeLanguagesToStringArray(raw);
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return normalizeLanguagesToStringArray(parsed);
            }
        } catch {
            /* ليست JSON */
        }
        return s
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    }
    return [];
}

// POST /api/candidates - إضافة مرشح جديد
router.post('/', requirePermission('candidate.write'), candidateUploadOptional, async (req: Request, res: Response) => {
    try {
        let candidateData: any = req.body || {};
        
        // skills / languages: JSON array أو سلسلة مفصولة
        candidateData.skills = parseSkillsOrLanguagesArray(candidateData.skills);
        candidateData.languages = parseSkillsOrLanguagesArray(candidateData.languages);
        if (typeof candidateData.agreeToTerms === 'string') {
            candidateData.agreeToTerms = candidateData.agreeToTerms === 'true';
        }
        
        // Build uploaded file records (attach to candidate after form validation)
        const uploadedFiles: Array<{ kind: 'cv' | 'photo' | 'certificate'; filename: string; originalName: string; path: string; mimeType: string; size: number; uploadedAt: Date }> = [];
        const uploads = (req as any).files as { cv?: Express.Multer.File[]; photo?: Express.Multer.File[]; certificates?: Express.Multer.File[] } | undefined;
        if (uploads?.cv?.length) {
            const f = uploads.cv[0];
            uploadedFiles.push({
                kind: 'cv',
                filename: f.filename,
                originalName: f.originalname,
                path: f.path,
                mimeType: f.mimetype,
                size: f.size,
                uploadedAt: new Date()
            });
        }
        if (uploads?.photo?.length) {
            const f = uploads.photo[0];
            uploadedFiles.push({
                kind: 'photo',
                filename: f.filename,
                originalName: f.originalname,
                path: f.path,
                mimeType: f.mimetype,
                size: f.size,
                uploadedAt: new Date()
            });
        }
        for (const f of (uploads?.certificates ?? []).slice(0, CERTIFICATES_MAX_FILES)) {
            uploadedFiles.push({
                kind: 'certificate',
                filename: f.filename,
                originalName: f.originalname,
                path: f.path,
                mimeType: f.mimetype,
                size: f.size,
                uploadedAt: new Date()
            });
        }

        normalizeCandidateBodyKeys(candidateData);

        const honeypotForN8n = extractHoneypotFields(candidateData);
        if (isHoneypotTriggered(honeypotForN8n)) {
            console.warn('🤖 Honeypot triggered — submission discarded (no DB write)');
            return res.status(201).json({
                success: true,
                message: 'Application submitted successfully',
            });
        }
        
        // Log received data for debugging
        console.log('📥 Received candidate data:', JSON.stringify({ ...candidateData, uploadedFileCount: uploadedFiles.length }, null, 2));
        
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            console.error('❌ Database not connected. ReadyState:', mongoose.connection.readyState);
            return res.status(503).json({
                success: false,
                error: 'Database not connected',
                message: 'Please check database connection. Server is running but database is not available.'
            });
        }
        
        const campaignId =
            typeof candidateData.campaignId === 'string' && candidateData.campaignId.trim()
                ? candidateData.campaignId.trim()
                : undefined;
        const rawSourceType =
            typeof candidateData.sourceType === 'string'
                ? candidateData.sourceType.trim().toLowerCase()
                : '';
        let campaignFormBinding: CampaignFormBinding | null = null;
        let campaignRubricVersion = 1;
        let campaignRubricHash = '';
        let campaignOrganizationId: string | undefined;
        let campaignCreatedByClerkUserId: string | undefined;
        if (campaignId) {
            candidateData.campaignId = campaignId;
            // رفض الطلبات الجديدة إذا كانت الحملة مُغلقة (إيقاف استلام الطلبات)
            try {
                const campaign = await RecruitmentCampaign.findOne({ campaignId })
                    .select(
                        'status formBinding rubricVersion rubricSnapshotHash firstCandidateAt organizationId createdByClerkUserId'
                    )
                    .lean();
                if (campaign && campaign.status === 'closed') {
                    return res.status(403).json({
                        success: false,
                        error: 'Campaign closed',
                        code: 'CAMPAIGN_CLOSED',
                        message: 'This campaign is no longer accepting applications.',
                    });
                }
                if (campaign) {
                    campaignFormBinding = resolveCampaignFormBindingForCandidateSubmit(
                        campaign as CampaignFormContext,
                        { sourceType: rawSourceType }
                    );
                    campaignRubricVersion = campaign.rubricVersion ?? 1;
                    campaignRubricHash = campaign.rubricSnapshotHash ?? '';
                    if (typeof campaign.organizationId === 'string' && campaign.organizationId.trim()) {
                        campaignOrganizationId = campaign.organizationId.trim();
                    }
                    if (
                        typeof campaign.createdByClerkUserId === 'string' &&
                        campaign.createdByClerkUserId.trim()
                    ) {
                        campaignCreatedByClerkUserId = campaign.createdByClerkUserId.trim();
                    }
                }
            } catch (statusErr) {
                console.warn('⚠️ Campaign status check failed (allowing submission):', statusErr);
            }
            // SECURITY (multi-tenant): a submission that names a campaign MUST be
            // attributed to THAT campaign's organization — never to the submitter's
            // session org. Otherwise, when the applicant's browser is signed into a
            // different Evaalo account, the application would be misrouted to that
            // other org (data leak). If the campaign can't be resolved to an org,
            // reject instead of falling back to orgScopedDefaults(req).
            if (!campaignOrganizationId) {
                return res.status(404).json({
                    success: false,
                    error: 'Campaign not found',
                    code: 'CAMPAIGN_NOT_FOUND',
                    message:
                        'This application link is invalid or the campaign no longer exists.',
                });
            }
        } else {
            delete candidateData.campaignId;
        }

        if (campaignFormBinding) {
            const uploads = req.files as Record<string, Express.Multer.File[]> | undefined;
            const submissionInput = buildSubmissionInputFromRequest(candidateData, {
                cv: uploads?.cv?.[0],
                photo: uploads?.photo?.[0],
                certificates: uploads?.certificates ?? [],
            });
            const validation = validateApplicationSubmission(
                campaignFormBinding.snapshot,
                submissionInput
            );
            if (!validation.ok) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    code: 'APPLICATION_VALIDATION_FAILED',
                    details: validation.errors,
                });
            }
            const merged = mergeValidatedIntoCandidateData(
                validation.normalized,
                campaignFormBinding.snapshot
            );
            for (const key of Object.keys(candidateData)) {
                if (
                    !(key in merged) &&
                    key !== 'campaignId' &&
                    key !== 'files' &&
                    key !== 'headHunterContextId' &&
                    key !== 'evaluationLanguage' &&
                    key !== 'roleKey' &&
                    key !== 'careerLevel' &&
                    key !== 'managementTrack' &&
                    key !== 'labelKey' &&
                    key !== 'roleMatchSource'
                ) {
                    delete candidateData[key];
                }
            }
            Object.assign(candidateData, merged);
        }

        if (uploadedFiles.length) {
            candidateData.files = uploadedFiles;
        }

        // Whitelist entryStage to prevent arbitrary client values from polluting routing.
        if (typeof candidateData.entryStage === 'string') {
            const stage = candidateData.entryStage.trim().toLowerCase();
            if (stage === 'audio' || stage === 'video' || stage === 'screening') {
                candidateData.entryStage = stage;
            } else {
                delete candidateData.entryStage;
            }
        } else if (candidateData.entryStage != null) {
            delete candidateData.entryStage;
        }
        // Whitelist sourceType (candidate origin) — kept separate from entryStage (pipeline stage).
        if (typeof candidateData.sourceType === 'string') {
            const src = candidateData.sourceType.trim().toLowerCase();
            const ALLOWED_SOURCE_TYPES = ['public_screening', 'linkedin', 'career_page', 'referral', 'manual'];
            if (ALLOWED_SOURCE_TYPES.includes(src)) {
                candidateData.sourceType = src;
            } else {
                delete candidateData.sourceType;
            }
        } else if (candidateData.sourceType != null) {
            delete candidateData.sourceType;
        }

        // إثراء من لقطة سياق الهيد هانتر (headHunterContextId) — نملأ الحقول الفارغة فقط ببيانات LinkedIn.
        const headHunterContextId =
            typeof candidateData.headHunterContextId === 'string'
                ? candidateData.headHunterContextId.trim()
                : '';
        if (headHunterContextId && /^[a-f0-9]{8,64}$/i.test(headHunterContextId)) {
            candidateData.headHunterContextId = headHunterContextId;
            try {
                const ctx = await HeadHunterSourcingContext.findOne({
                    contextId: headHunterContextId,
                }).lean();
                const profile = (ctx?.candidateProfile || {}) as Record<string, unknown>;
                const isEmpty = (v: unknown) =>
                    v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
                const profStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

                if (Array.isArray(profile.skills) && profile.skills.length && isEmpty(candidateData.skills)) {
                    candidateData.skills = profile.skills;
                }
                if (Array.isArray(profile.languages) && profile.languages.length && isEmpty(candidateData.languages)) {
                    candidateData.languages = profile.languages;
                }
                if (isEmpty(candidateData.linkedin) && profStr(profile.linkedin_url)) {
                    candidateData.linkedin = profStr(profile.linkedin_url);
                }
                if (isEmpty(candidateData.current_company) && profStr(profile.current_company)) {
                    candidateData.current_company = profStr(profile.current_company);
                }
                if (isEmpty(candidateData.location) && profStr(profile.location)) {
                    candidateData.location = profStr(profile.location);
                }
                const yearsRaw = profile.years_experience;
                const yearsStr =
                    typeof yearsRaw === 'number' && Number.isFinite(yearsRaw)
                        ? String(yearsRaw)
                        : profStr(yearsRaw);
                const curYears = profStr(candidateData.years_of_experience);
                if (yearsStr && (!curYears || curYears.toUpperCase() === 'N/A')) {
                    candidateData.years_of_experience = yearsStr;
                }
                const summary = profStr(profile.ai_summary) || profStr(profile.summary);
                if (summary) {
                    const prefix = 'LinkedIn (sourced via Head Hunter): ';
                    candidateData.notes = isEmpty(candidateData.notes)
                        ? `${prefix}${summary}`
                        : `${profStr(candidateData.notes)}\n\n${prefix}${summary}`;
                }
            } catch (enrichErr) {
                console.warn(
                    `⚠️ candidate enrich from sourcing context ${headHunterContextId} failed:`,
                    enrichErr instanceof Error ? enrichErr.message : enrichErr
                );
            }
        } else if (candidateData.headHunterContextId != null) {
            delete candidateData.headHunterContextId;
        }

        delete candidateData.agreeToTerms;

        const candidateDataForDB = candidateData;

        const orgForLookup = campaignOrganizationId || getOrgId(req);
        const emailNorm = String(candidateDataForDB.email || '').trim().toLowerCase();

        // Many-to-Many: البريد مكرر على مستوى المنظمة مسموح عبر حملات مختلفة.
        // الرفض فقط عند تقديم مسبق لنفس الحملة (أو شخص موجود بدون حملة جديدة ويُطلب نفس الحملة).
        let existingPerson = emailNorm
            ? await Candidate.findOne(
                  orgScopedQuery(
                      req,
                      campaignOrganizationId
                          ? { email: emailNorm, organizationId: campaignOrganizationId }
                          : { email: emailNorm }
                  )
              )
            : null;
        // orgScopedQuery قد يتجاهل organizationId الممرّر إن كان من الحملة — أعد البحث المباشر عند الحاجة
        if (!existingPerson && emailNorm && campaignOrganizationId) {
            existingPerson = await Candidate.findOne({
                email: emailNorm,
                organizationId: campaignOrganizationId,
            });
        }

        if (existingPerson && campaignId) {
            const existingApp = await CandidateApplication.findOne({
                candidateId: existingPerson._id,
                campaignId,
                deletedAt: null,
            }).lean();
            if (existingApp) {
                return res.status(400).json({
                    success: false,
                    error: 'Already applied to this campaign',
                    code: 'APPLICATION_EXISTS',
                    message: 'This email is already registered for this campaign',
                    applicationId: existingApp.applicationId,
                    candidateId: String(existingPerson._id),
                });
            }
        }

        if (existingPerson && !campaignId) {
            return res.status(400).json({
                success: false,
                error: 'Email already exists',
                message: 'This email is already registered',
            });
        }
        
        // Validate required fields (legacy path when no formBinding snapshot)
        if (!campaignFormBinding) {
            if (!candidateDataForDB.full_name || !candidateDataForDB.email || !candidateDataForDB.phone) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'Full name, email, and phone are required',
                });
            }
        }

        const n8nWebhookConfigured = Boolean(process.env.N8N_WEBHOOK_URL?.trim());
        const willSendStage1N8n =
            candidateDataForDB.sourceType !== 'public_screening' && n8nWebhookConfigured;
        const submissionEvaluationLanguage = normalizeStage1EvaluationLanguage(
            candidateDataForDB.evaluationLanguage ?? candidateDataForDB.language
        );
        delete candidateDataForDB.evaluationLanguage;
        delete candidateDataForDB.language;
        if (willSendStage1N8n) {
            try {
                assertStageOutboundSecurityForTrigger();
            } catch (e) {
                if (e instanceof StageCallbackConfigurationError) {
                    return res.status(503).json({
                        success: false,
                        error: 'Stage callback security is not configured',
                    });
                }
                throw e;
            }
        }

        let candidate: ICandidate;
        let createdNewPerson = false;

        if (existingPerson) {
            // حدّث ملف الشخص بالحقول غير الفارغة الواردة، ثم أنشئ Application جديد للحملة.
            const personPatch: Record<string, unknown> = {};
            for (const key of [
                'full_name',
                'phone',
                'location',
                'gender',
                'linkedin',
                'skills',
                'languages',
                'current_company',
                'current_title',
                'years_of_experience',
            ] as const) {
                const v = candidateDataForDB[key];
                if (v != null && !(typeof v === 'string' && !String(v).trim())) {
                    personPatch[key] = v;
                }
            }
            if (Object.keys(personPatch).length) {
                await Candidate.findByIdAndUpdate(existingPerson._id, { $set: personPatch });
            }
            // Dual-write campaignId على الشخص لأحدث تقديم
            if (campaignId) {
                await Candidate.findByIdAndUpdate(existingPerson._id, { $set: { campaignId } });
            }
            const refreshed = await Candidate.findById(existingPerson._id);
            if (!refreshed) {
                return res.status(500).json({ success: false, error: 'Failed to load existing candidate' });
            }
            candidate = refreshed;
        } else {
            createdNewPerson = true;
            candidate = new Candidate({
                ...candidateDataForDB,
                ...(campaignOrganizationId
                    ? {
                          organizationId: campaignOrganizationId,
                          ...(campaignCreatedByClerkUserId
                              ? { createdByClerkUserId: campaignCreatedByClerkUserId }
                              : {}),
                      }
                    : orgScopedDefaults(req)),
                ...(campaignFormBinding
                    ? {
                          status: willSendStage1N8n ? 'pending_evaluation' : 'pending',
                          evaluationContext: {
                              formSchemaVersion: campaignFormBinding.schemaVersion,
                              formSchemaHash: campaignFormBinding.schemaHash,
                              rubricVersion: campaignRubricVersion,
                              rubricSnapshotHash: normalizeStage1RubricSnapshotHash(campaignRubricHash),
                              evaluationLanguage: submissionEvaluationLanguage,
                          },
                      }
                    : {}),
            });
            await candidate.save();
        }

        // أنشئ Application (أو أعد استخدامه) لكل تقديم لحملة.
        const application = await upsertCandidateApplication({
            organizationId:
                (typeof candidate.organizationId === 'string' && candidate.organizationId) ||
                orgForLookup,
            candidate,
            campaignId,
            entryStage: candidate.entryStage,
            sourceType: candidate.sourceType,
            source:
                typeof (candidateDataForDB as { source?: string }).source === 'string'
                    ? (candidateDataForDB as { source?: string }).source
                    : candidate.headHunterContextId
                      ? 'HeadHunter'
                      : undefined,
            headHunterContextId: candidate.headHunterContextId,
            jobPostingId: candidate.jobPostingId,
            status: campaignFormBinding
                ? willSendStage1N8n
                    ? 'pending_evaluation'
                    : 'pending'
                : candidate.status,
            evaluationContext: candidate.evaluationContext,
            reuseExisting: true,
            eventType: 'applied',
        });

        // Domain event (Phase 2) — new-applicant fan-out. Reused applications keep the
        // same _id → same idempotency key, so only a genuinely new application emits.
        void emitDomainEventBestEffort({
            organizationId: String(application.organizationId),
            type: 'CandidateApplied',
            payload: {
                candidateId: String(candidate._id),
                applicationId: String(application._id),
                campaignId: application.campaignId ?? campaignId ?? null,
                entryStage: application.entryStage ?? candidate.entryStage ?? null,
                sourceType: application.sourceType ?? candidate.sourceType ?? null,
            },
            idempotencyKey: `candidate-applied:${String(application._id)}`,
        });

        // إن كان الشخص موجوداً مسبقاً ونقلنا بيانات الاستمارة من هذا الطلب، حدّث Application.
        if (!createdNewPerson) {
            const normalizedAttachments = toApplicationAttachments(
                candidateDataForDB.files as Parameters<typeof toApplicationAttachments>[0]
            );
            await CandidateApplication.findByIdAndUpdate(application._id, {
                $set: {
                    position_applied_for: candidateDataForDB.position_applied_for,
                    company_applied_to: candidateDataForDB.company_applied_to,
                    years_of_experience: candidateDataForDB.years_of_experience,
                    current_company: candidateDataForDB.current_company,
                    highest_education_level: candidateDataForDB.highest_education_level,
                    skills: candidateDataForDB.skills || [],
                    languages: candidateDataForDB.languages || [],
                    coverLetter: candidateDataForDB.coverLetter,
                    files: normalizedAttachments,
                    attachments: normalizedAttachments,
                    ...(campaignFormBinding
                        ? {
                              status: willSendStage1N8n ? 'pending_evaluation' : 'pending',
                              evaluationContext: {
                                  formSchemaVersion: campaignFormBinding.schemaVersion,
                                  formSchemaHash: campaignFormBinding.schemaHash,
                                  rubricVersion: campaignRubricVersion,
                                  rubricSnapshotHash: normalizeStage1RubricSnapshotHash(campaignRubricHash),
                                  evaluationLanguage: submissionEvaluationLanguage,
                              },
                          }
                        : {}),
                },
            });
        }

        if (campaignId) {
            await markFirstCandidateIfNeeded(campaignId);
        }
        logAudit(req, {
            action: createdNewPerson ? 'candidate.created' : 'application.created',
            targetType: 'candidate',
            targetId: candidate._id?.toString(),
            metadata: {
                email: candidate.email,
                campaignId,
                applicationId: application.applicationId,
                createdNewPerson,
            },
        });
        
        console.log(
            `✅ Candidate/Application saved: person=${candidate._id} app=${application.applicationId} newPerson=${createdNewPerson}`
        );
        if (campaignId) {
            console.log('📋 Campaign ID found:', campaignId);
        }

        // مقابلات الفيديو فقط (مرشح Specific/Head Hunter): ولّد وثبّت Blueprint الحملة تلقائياً
        // قبل إرسال رابط الفيديو (idempotent، fail-open). يتخطّى بأمان عند غياب campaignId.
        if (campaignId && String(candidateDataForDB.entryStage || '').trim().toLowerCase() === 'video') {
            ensureBlueprintForCampaign(campaignId).catch((err) => {
                console.error(`⚠️ ensureBlueprintForCampaign (candidate create) failed for ${campaignId} (non-blocking):`, err?.message || err);
            });
        }
        
        // إرسال البيانات + المعايير إلى n8n للتحليل (غير متزامن - لا يمنع الاستجابة)
        // المسار العام (public_screening): لا توجد مقابلة مكتوبة — نتخطّى Stage 1؛ فقط الترانسكريبت الصوتي يُرسل لاحقاً.
        const candidateObj = candidate.toObject();
        if (candidateObj.sourceType === 'public_screening') {
            console.log('↩️ Skipping Stage 1 n8n send for public_screening candidate:', candidateObj._id?.toString?.() || candidateObj._id);
        } else if (createdNewPerson || campaignFormBinding) {
            try {
                const { outboxId, shouldDispatch } = await enqueueStage1EvaluationOutbox({
                    candidateId: String(candidateObj._id?.toString?.() || candidateObj._id),
                    campaignId,
                    organizationId:
                        typeof candidateObj.organizationId === 'string'
                            ? candidateObj.organizationId
                            : undefined,
                    rubricSnapshotHash: normalizeStage1RubricSnapshotHash(campaignRubricHash),
                    formSchemaHash: campaignFormBinding?.schemaHash,
                });
                if (shouldDispatch) {
                    dispatchStage1EvaluationOutbox(outboxId);
                }
            } catch (err) {
                if (err instanceof StageCallbackConfigurationError) {
                    console.error('Stage callback security configuration error (post-save):', err.message);
                } else {
                    console.error('Failed to enqueue Stage 1 evaluation outbox (non-blocking):', err);
                }
            }
        }
        
        res.status(201).json({
            success: true,
            message: createdNewPerson
                ? 'Candidate added successfully'
                : 'Application created for existing candidate',
            data: {
                ...candidate.toObject(),
                applicationId: application.applicationId,
                applicationMongoId: application._id,
                candidateId: candidate._id,
            },
        });
    } catch (error: any) {
        console.error('❌ Error creating candidate:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        // Better error messages
        let errorMessage = error.message || 'Failed to create candidate';
        let statusCode = 500;
        
        if (error.name === 'ValidationError') {
            statusCode = 400;
            errorMessage = 'Validation error: ' + Object.values(error.errors).map((e: any) => e.message).join(', ');
        } else if (error.name === 'MongoServerError' && error.code === 11000) {
            statusCode = 400;
            errorMessage = 'Duplicate entry: This email already exists';
        } else if (error.name === 'CastError') {
            statusCode = 400;
            errorMessage = 'Invalid data format';
        }
        
        res.status(statusCode).json({
            success: false,
            error: 'Failed to create candidate',
            message: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/candidates/:id - تحديث مرشح
router.put('/:id', requirePermission('candidate.write'), async (req: Request, res: Response) => {
    try {
        const body = { ...req.body };
        normalizeCandidateBodyKeys(body);
        if (body.languages !== undefined) {
            if (typeof body.languages === 'string') {
                try {
                    body.languages = JSON.parse(body.languages) || [];
                } catch {
                    body.languages = [];
                }
            }
            body.languages = normalizeLanguagesToStringArray(body.languages);
        }
        // Status is per-application: CandidateApplication is the source of truth.
        // Resolve the exact target application BEFORE mutating anything so an
        // ambiguous person-level status change (a candidate with several campaigns)
        // is rejected instead of silently overwriting other campaigns' outcomes.
        // Legacy candidates with no application fall back to person-level status.
        const orgId = getOrgId(req);
        const newStatus = typeof body.status === 'string' ? body.status.trim() : undefined;
        const statusApplicationId =
            typeof body.applicationId === 'string' ? body.applicationId.trim() : undefined;
        const statusCampaignId =
            typeof body.campaignId === 'string' ? body.campaignId.trim() : undefined;
        // applicationId is targeting context only — never persisted onto Candidate.
        delete body.applicationId;

        let targetApplication: Awaited<ReturnType<typeof findApplicationForCallback>> = null;
        if (newStatus && mongoose.Types.ObjectId.isValid(req.params.id)) {
            targetApplication = await findApplicationForCallback({
                applicationId: statusApplicationId,
                candidateId: req.params.id,
                campaignId: statusCampaignId,
            });
            if (targetApplication && String(targetApplication.organizationId) !== String(orgId)) {
                targetApplication = null;
            }
            if (!targetApplication) {
                const appCount = await CandidateApplication.countDocuments({
                    candidateId: req.params.id,
                    organizationId: orgId,
                    deletedAt: null,
                });
                if (appCount > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'campaign_context_required',
                        message:
                            'Status change is ambiguous for a candidate with multiple applications. Provide applicationId or campaignId to target one.',
                    });
                }
                // appCount === 0 → legacy candidate with no application: mirror to Candidate only.
            }
        }

        const candidate = await Candidate.findOneAndUpdate(
            orgScopedQuery(req, { _id: req.params.id }),
            body,
            { new: true, runValidators: true }
        );

        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        if (typeof body.email === 'string' && body.email.trim()) {
            await syncEmailDenormForCandidate(String(candidate._id), body.email).catch((err) =>
                console.warn('emailDenorm sync failed:', err?.message || err)
            );
        }

        // Persist status to the targeted application (source of truth) + timeline event.
        // Candidate.status was already mirrored via the update above (person-view display).
        if (newStatus && targetApplication) {
            await CandidateApplication.updateOne(
                { _id: targetApplication._id, organizationId: orgId },
                { $set: { status: newStatus } }
            );
            await pushApplicationEvent(targetApplication._id, 'status_changed', {
                status: newStatus,
            }).catch((err) =>
                console.warn('application status timeline push failed:', err?.message || err)
            );
        }

        // Domain event (Phase 2) — side-effect fan-out only; never blocks the response.
        if (newStatus) {
            void emitDomainEventBestEffort({
                organizationId: orgId,
                type: 'CandidateStatusChanged',
                payload: {
                    candidateId: String(candidate._id),
                    applicationId: targetApplication ? String(targetApplication._id) : null,
                    campaignId:
                        statusCampaignId ||
                        (targetApplication ? targetApplication.campaignId ?? null : null),
                    status: newStatus,
                },
                idempotencyKey: `candidate-status:${
                    targetApplication ? String(targetApplication._id) : String(candidate._id)
                }:${newStatus}:${Date.now()}`,
            });
        }

        logAudit(req, {
            action: 'candidate.updated',
            targetType: 'candidate',
            targetId: candidate._id?.toString(),
            metadata: {
                fields: Object.keys(body),
                ...(targetApplication
                    ? { applicationId: String(targetApplication._id), status: newStatus }
                    : {}),
            },
        });

        // إرسال تحديث الحالة إلى n8n إذا تم تحديث الحالة
        if (req.body.status) {
            sendStatusUpdateToN8N(
                candidate._id.toString(),
                req.body.status,
                req.body.aiEvaluation
            ).catch(err => {
                console.error('Failed to send status update to n8n (non-blocking):', err);
            });
        }
        
        res.json({
            success: true,
            message: 'Candidate updated successfully',
            data: candidate
        });
    } catch (error: any) {
        console.error('Error updating candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update candidate',
            message: error.message
        });
    }
});

// DELETE /api/candidates/:id - حذف مرشح
const HIDEABLE_STAGES = ['screening', 'voice', 'video'] as const;
type HideableStage = (typeof HIDEABLE_STAGES)[number];
const HIDEABLE_VIEWS = ['candidates'] as const;
type HideableView = (typeof HIDEABLE_VIEWS)[number];

/**
 * POST /api/candidates/bulk-hide
 * إخفاء بطاقة حملة من قائمة مرحلة، أو إخفاء مرشح من واجهة (مثل Database) — دون حذف البيانات.
 * body: { ids, stage?: 'screening'|'voice'|'video', view?: 'candidates', hidden?: boolean }
 * stage → hiddenFromStages | view → hiddenFromViews (exactly one of stage | view required)
 */
router.post(
    '/bulk-hide',
    conditionalRequireAuth(),
    requirePermission('candidate.write'),
    async (req: Request, res: Response) => {
        try {
            const body = req.body || {};
            const rawIds: unknown = body.ids;
            const ids = (Array.isArray(rawIds) ? rawIds : [])
                .map((x) => (typeof x === 'string' ? x.trim() : ''))
                .filter((x) => x && mongoose.Types.ObjectId.isValid(x));

            const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
            const view = typeof body.view === 'string' ? body.view.trim() : '';
            const hasStage = Boolean(stage);
            const hasView = Boolean(view);

            if (hasStage === hasView) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid hide target',
                    message: 'Provide exactly one of: stage or view',
                });
            }

            if (hasStage && !HIDEABLE_STAGES.includes(stage as HideableStage)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid stage',
                    message: `stage must be one of: ${HIDEABLE_STAGES.join(', ')}`,
                });
            }

            if (hasView && !HIDEABLE_VIEWS.includes(view as HideableView)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid view',
                    message: `view must be one of: ${HIDEABLE_VIEWS.join(', ')}`,
                });
            }

            if (ids.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid candidate ids provided',
                });
            }
            if (ids.length > 1000) {
                return res.status(400).json({
                    success: false,
                    error: 'Too many ids (max 1000)',
                });
            }

            const hidden = body.hidden !== false;
            let update: Record<string, unknown>;
            let auditAction: string;
            let auditMeta: Record<string, unknown>;

            if (hasStage) {
                update = hidden
                    ? { $addToSet: { hiddenFromStages: stage } }
                    : { $pull: { hiddenFromStages: stage } };
                auditAction = hidden ? 'candidate.card_hidden' : 'candidate.card_unhidden';
                auditMeta = { stage, requested: ids.length };
            } else {
                update = hidden
                    ? { $addToSet: { hiddenFromViews: view } }
                    : { $pull: { hiddenFromViews: view } };
                auditAction = hidden ? 'candidate.view_hidden' : 'candidate.view_unhidden';
                auditMeta = { view, requested: ids.length };
            }

            const result = await Candidate.updateMany(
                orgScopedQuery(req, { _id: { $in: ids } }),
                update
            );

            logAudit(req, {
                action: auditAction,
                targetType: 'candidate',
                targetId: ids.join(','),
                metadata: { ...auditMeta, modified: result.modifiedCount ?? 0 },
            });

            return res.json({
                success: true,
                modifiedCount: result.modifiedCount ?? 0,
                hidden,
                ...(hasStage ? { stage } : { view }),
                message: hidden
                    ? hasStage
                        ? 'Campaign card hidden'
                        : 'Candidate cleared from view'
                    : hasStage
                      ? 'Campaign card restored'
                      : 'Candidate restored to view',
            });
        } catch (error: any) {
            console.error('Error bulk-hiding candidates:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to hide campaign card',
                message: error.message,
            });
        }
    }
);

router.delete('/:id', conditionalRequireAuth(), requirePermission('candidate.delete'), async (req: Request, res: Response) => {
    try {
        const candidate = await Candidate.findOneAndDelete(orgScopedQuery(req, { _id: req.params.id }));
        
        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        logAudit(req, {
            action: 'candidate.deleted',
            targetType: 'candidate',
            targetId: candidate._id?.toString(),
            metadata: { email: candidate.email, full_name: candidate.full_name },
        });
        
        res.json({
            success: true,
            message: 'Candidate deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete candidate',
            message: error.message
        });
    }
});

export default router;

















