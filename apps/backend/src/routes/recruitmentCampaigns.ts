import express, { Request, Response } from 'express';
import crypto from 'crypto';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { generateJobAdvertisement, translateJobAdvertisement } from '../services/llmService.js';
import { getProfileForClerkUser } from '../services/userProfileService.js';
import { orgScopedQuery, orgScopedDefaults } from '../middleware/orgScope.js';
import { requirePermission } from '../middleware/rbac.js';
import { getOrgId, getClerkUserId, isMissingProductionOrg } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { ensureBlueprintForCampaign } from '../services/expertise/ensureBlueprint.js';
import {
    buildEvaluationRubricFromCampaignBody,
    RubricValidationError,
    stripRubricAndTemplateKeysFromCriteria,
} from '../services/evaluationRubricService.js';
import {
    createFormBindingForTemplate,
    mintPublicApplicationToken,
} from '../services/formTemplateService.js';
import { DEFAULT_FORM_TEMPLATE_ID } from '../shared/formTemplates/index.js';
import {
    chargeCompareTopCredits,
    refundCompareEmail,
    COMPARE_EMAIL_DEADLINE_MS,
} from '../services/compareEmailBilling.js';
import {
    getCompareTopV2Result,
    isCompareTopV2EnabledForStage,
    triggerCompareTopV2,
} from '../services/compareTopV2Adapter.js';
import {
    buildCampaignComparePool,
    CampaignComparePoolError,
} from '../services/campaignComparePool.js';
import type { CampaignCompareStage } from '../services/campaignCompareCallbackAuth.js';
import {
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from '../services/webhookIdempotency.js';

const router = express.Router();

// POST /api/recruitment-campaigns/generate-ad - توليد إعلان الوظيفة تلقائياً من المعايير
router.post('/generate-ad', async (req: Request, res: Response) => {
    try {
        const { language, ...criteria } = req.body || {};

        // معلومات الشركة من بروفايل المستخدم (best-effort — الإعلان يتولد حتى بدونها)
        let company: { name?: string; description?: string } | undefined;
        try {
            const clerkUserId = getClerkUserId(req);
            if (clerkUserId) {
                const profile = await getProfileForClerkUser(clerkUserId);
                if (profile.companyName || profile.companyDescription) {
                    company = {
                        name: profile.companyName || undefined,
                        description: profile.companyDescription || undefined,
                    };
                }
            }
        } catch {
            /* الملف غير موجود أو Clerk غير مهيأ — نكمل بدون معلومات الشركة */
        }

        const ad = await generateJobAdvertisement(criteria, language, company);
        if (!ad) {
            return res.status(400).json({
                success: false,
                error: 'Unable to generate advertisement',
                message: 'No criteria provided or OpenAI not configured'
            });
        }
        res.json({
            success: true,
            jobAdvertisement: ad,
            language: language || null
        });
    } catch (error: any) {
        console.error('❌ Error generating job advertisement:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate job advertisement',
            message: error.message
        });
    }
});

// POST /api/recruitment-campaigns/translate-ad - ترجمة إعلان الوظيفة إلى لغة أخرى
router.post('/translate-ad', async (req: Request, res: Response) => {
    try {
        const { text, targetLanguage } = req.body || {};
        if (!text || !String(text).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Missing text',
                message: 'Advertisement text is required to translate'
            });
        }
        if (!targetLanguage || !String(targetLanguage).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Missing targetLanguage',
                message: 'Target language is required'
            });
        }
        const translated = await translateJobAdvertisement(String(text), String(targetLanguage));
        if (!translated) {
            return res.status(400).json({
                success: false,
                error: 'Unable to translate advertisement',
                message: 'Translation returned empty result or OpenAI not configured'
            });
        }
        res.json({
            success: true,
            translatedText: translated,
            language: String(targetLanguage)
        });
    } catch (error: any) {
        console.error('❌ Error translating job advertisement:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to translate job advertisement',
            message: error.message
        });
    }
});

// POST /api/recruitment-campaigns - إنشاء حملة توظيف جديدة وحفظها في قاعدة البيانات
router.post('/', requirePermission('campaign.write'), async (req: Request, res: Response) => {
    try {
        // Fail-closed on missing Clerk org: without an active organization the
        // organizationId default is empty and Mongoose would reject the save with
        // a raw "Path `organizationId` is required" error leaking to the client.
        // Return a clean, actionable response instead (mirrors billing's ORG_REQUIRED).
        if (isMissingProductionOrg(getOrgId(req))) {
            return res.status(403).json({
                success: false,
                error: 'ORG_REQUIRED',
                message: 'You must create or select an organization before creating a campaign.',
            });
        }

        const campaignData = req.body;
        
        console.log('📥 Received recruitment campaign data:', JSON.stringify(campaignData, null, 2));
        
        const body = (campaignData || {}) as Record<string, unknown>;
        const interviewType = String(body.interviewType || '').trim().toLowerCase();
        const formTemplateId =
            typeof body.formTemplateId === 'string' ? body.formTemplateId.trim() : '';
        const isScreeningForm = interviewType === 'form' || Boolean(formTemplateId);

        const criteria = stripRubricAndTemplateKeysFromCriteria({ ...body });
        const jobAdvertisement =
            typeof criteria.jobAdvertisement === 'string'
                ? criteria.jobAdvertisement
                : undefined;
        delete criteria.jobAdvertisement;

        const shareLangRaw = String(body.language || '').toLowerCase();
        const evaluationLanguage =
            shareLangRaw === 'en' ? 'en' : shareLangRaw === 'ar' || shareLangRaw === 'ku' ? 'ar' : 'ar';
        criteria.evaluationLanguage = evaluationLanguage;

        if (Object.keys(criteria).length === 0 && !isScreeningForm) {
            return res.status(400).json({
                success: false,
                error: 'Missing criteria',
                message: 'At least one criterion is required',
            });
        }

        let formBinding;
        let evaluationRubric;
        let rubricVersion = 1;
        let rubricSnapshotHash: string | undefined;

        if (isScreeningForm) {
            try {
                const rubric = buildEvaluationRubricFromCampaignBody(body);
                evaluationRubric = rubric.items;
                rubricVersion = rubric.rubricVersion;
                rubricSnapshotHash = rubric.rubricSnapshotHash;
                formBinding = createFormBindingForTemplate(
                    formTemplateId || DEFAULT_FORM_TEMPLATE_ID
                );
            } catch (e) {
                if (e instanceof RubricValidationError) {
                    return res.status(400).json({
                        success: false,
                        error: e.code,
                        message: e.message,
                        details: e.details,
                    });
                }
                throw e;
            }
        }

        const publicApplicationToken = mintPublicApplicationToken();

        // إنشاء campaign ID فريد
        const campaignId = crypto.randomBytes(16).toString('hex');

        // حفظ المعايير في قاعدة البيانات
        const campaign = new RecruitmentCampaign({
            campaignId,
            criteria,
            jobAdvertisement: jobAdvertisement || undefined,
            interviewType: body.interviewType || undefined,
            templateType: body.templateType || undefined,
            templateName: body.templateName || undefined,
            publicApplicationToken,
            formBinding,
            evaluationRubric,
            rubricVersion: isScreeningForm ? rubricVersion : undefined,
            rubricSnapshotHash: isScreeningForm ? rubricSnapshotHash : undefined,
            ...orgScopedDefaults(req),
        });
        
        await campaign.save();
        logAudit(req, {
            action: 'campaign.created',
            targetType: 'campaign',
            targetId: campaignId,
            metadata: { criteria, interviewType: campaignData.interviewType },
        });
        
        console.log('✅ Recruitment campaign saved:', campaignId);

        // مقابلات الفيديو فقط: ولّد وثبّت Blueprint الحملة تلقائياً قبل إرسال الرابط (idempotent، fail-open).
        // لا يمنع إنشاء الحملة عند الفشل — الوكيل يرجع لبنك JSON.
        if (String(campaignData.interviewType || '').trim().toLowerCase() === 'video') {
            ensureBlueprintForCampaign(campaignId).catch((err) => {
                console.error(`⚠️ ensureBlueprintForCampaign (campaign create) failed for ${campaignId} (non-blocking):`, err?.message || err);
            });
        }

        // إرجاع campaign ID للاستخدام في الرابط
        const shareLang =
            shareLangRaw === 'en' ? 'en' : shareLangRaw === 'ar' || shareLangRaw === 'ku' ? 'ar' : null;
        const publicFormPath = shareLang
            ? `/form?pub=${encodeURIComponent(publicApplicationToken)}&language=${shareLang}`
            : `/form?pub=${encodeURIComponent(publicApplicationToken)}`;

        res.status(201).json({
            success: true,
            message: 'Recruitment campaign created successfully',
            campaignId: campaignId,
            publicApplicationToken,
            publicFormPath,
            data: campaignData,
        });
    } catch (error: any) {
        console.error('❌ Error creating recruitment campaign:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create recruitment campaign',
            message: error.message
        });
    }
});

// GET /api/recruitment-campaigns?ids=id1,id2,... — batch metadata (must be before /:campaignId)
router.get('/', async (req: Request, res: Response) => {
    try {
        const rawIds = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
        if (!rawIds) {
            return res.status(400).json({
                success: false,
                error: 'Missing ids',
                message: 'Query parameter ids is required (comma-separated campaign IDs)',
            });
        }
        const maxIds = Math.min(100, Math.max(1, Number(process.env.RECRUITMENT_CAMPAIGNS_BATCH_MAX_IDS) || 100));
        const ids = [...new Set(
            rawIds.split(',').map((s) => s.trim()).filter(Boolean)
        )].slice(0, maxIds);

        if (ids.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const campaigns = await RecruitmentCampaign.find(
            orgScopedQuery(req, { campaignId: { $in: ids } })
        )
            .select('campaignId criteria jobAdvertisement interviewType templateType templateName status closedAt createdAt updatedAt')
            .lean();

        res.json({
            success: true,
            data: campaigns.map((c) => ({
                campaignId: c.campaignId,
                criteria: c.criteria,
                jobAdvertisement: c.jobAdvertisement,
                interviewType: c.interviewType,
                templateType: c.templateType,
                templateName: c.templateName,
                status: c.status || 'active',
                closedAt: c.closedAt || null,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            })),
        });
    } catch (error: any) {
        console.error('❌ Error batch-fetching recruitment campaigns:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch recruitment campaigns',
            message: error.message,
        });
    }
});

// GET /api/recruitment-campaigns/:campaignId - الحصول على معايير حملة محددة
router.get('/:campaignId', async (req: Request, res: Response) => {
    try {
        const { campaignId } = req.params;
        
        const campaign = await RecruitmentCampaign.findOne(orgScopedQuery(req, { campaignId }));
        
        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                campaignId: campaign.campaignId,
                criteria: campaign.criteria, // جميع المعايير الديناميكية
                jobAdvertisement: campaign.jobAdvertisement,
                interviewType: campaign.interviewType,
                templateType: campaign.templateType,
                templateName: campaign.templateName,
                status: campaign.status || 'active',
                closedAt: campaign.closedAt || null
            }
        });
    } catch (error: any) {
        console.error('❌ Error fetching recruitment campaign:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch recruitment campaign',
            message: error.message
        });
    }
});

// PATCH /api/recruitment-campaigns/:campaignId/status - فتح/إغلاق استلام الطلبات
router.patch(
    '/:campaignId/status',
    requirePermission('campaign.write'),
    async (req: Request, res: Response) => {
        try {
            const { campaignId } = req.params;
            const raw = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
            if (raw !== 'active' && raw !== 'closed') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status',
                    message: "status must be either 'active' or 'closed'",
                });
            }

            const campaign = await RecruitmentCampaign.findOne(orgScopedQuery(req, { campaignId }));
            if (!campaign) {
                return res.status(404).json({ success: false, error: 'Campaign not found' });
            }

            campaign.status = raw;
            campaign.closedAt = raw === 'closed' ? new Date() : null;
            await campaign.save();

            logAudit(req, {
                action: raw === 'closed' ? 'campaign.closed' : 'campaign.reopened',
                targetType: 'campaign',
                targetId: campaignId,
                metadata: { status: raw },
            });

            return res.json({
                success: true,
                data: {
                    campaignId: campaign.campaignId,
                    status: campaign.status,
                    closedAt: campaign.closedAt || null,
                },
            });
        } catch (error: any) {
            console.error('❌ Error updating campaign status:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update campaign status',
                message: error.message,
            });
        }
    }
);

// ============================================================================
// AI Compare Top (Stage 1) — مستقل تماماً عن webhooks المقابلات و Head Hunter
// ============================================================================

/**
 * إعدادات المقارنة لكل مرحلة — حقل التخزين، رابط n8n، مصدر idempotency.
 * كل مرحلة تخزّن نتيجتها بشكل مستقل على نفس الحملة.
 */
type AiCompareStage = 'screening' | 'voice' | 'video';

const AI_COMPARE_STAGES: Record<
    AiCompareStage,
    {
        field: 'aiCompareTopResult' | 'voiceAiCompareTopResult' | 'videoAiCompareTopResult';
        envKey: string;
        defaultUrl: string;
        source: string;
        wbSource: 'n8n-screening-ai-compare' | 'n8n-voice-ai-compare' | 'n8n-video-ai-compare';
    }
> = {
    screening: {
        field: 'aiCompareTopResult',
        envKey: 'N8N_SCREENING_AI_COMPARE_WEBHOOK_URL',
        defaultUrl: 'https://n8n.evaalo.com/webhook/9391209e-26c0-48f9-858e-8136e62ab787',
        source: 'screening-ai-compare-top',
        wbSource: 'n8n-screening-ai-compare',
    },
    voice: {
        field: 'voiceAiCompareTopResult',
        envKey: 'N8N_VOICE_AI_COMPARE_WEBHOOK_URL',
        defaultUrl: 'https://n8n.evaalo.com/webhook/a7b9b932-43e6-4666-b107-9bc664542392',
        source: 'voice-ai-compare-top',
        wbSource: 'n8n-voice-ai-compare',
    },
    video: {
        field: 'videoAiCompareTopResult',
        envKey: 'N8N_VIDEO_AI_COMPARE_WEBHOOK_URL',
        defaultUrl: 'https://n8n.evaalo.com/webhook/c0de9126-4c40-484f-afa3-ba8708b67965',
        source: 'video-ai-compare-top',
        wbSource: 'n8n-video-ai-compare',
    },
};

function resolveAiCompareStage(value: unknown): AiCompareStage | null {
    const s = typeof value === 'string' && value.trim() ? value.trim() : 'screening';
    return s === 'screening' || s === 'voice' || s === 'video' ? s : null;
}

function getAiCompareWebhookUrl(stage: AiCompareStage): string {
    const cfg = AI_COMPARE_STAGES[stage];
    const fromEnv = (process.env[cfg.envKey] || '').trim();
    return fromEnv || cfg.defaultUrl;
}

function aiCompareStageToPoolStage(stage: AiCompareStage): CampaignCompareStage {
    if (stage === 'screening') return 'stage1';
    if (stage === 'voice') return 'stage2';
    return 'stage3';
}

function getAiCompareCallbackUrl(stage: AiCompareStage): string {
    const base = (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
    const path =
        stage === 'screening'
            ? '/webhook/screening-ai-compare'
            : stage === 'voice'
              ? '/webhook/voice-ai-compare'
              : '/webhook/video-ai-compare';
    return `${base}${path}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AI_COMPARE_EMAILS = 20;

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim() !== '') return v.trim();
        if (typeof v === 'number') return String(v);
    }
    return undefined;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return undefined;
}

/** يستخرج مصفوفة الترتيب من حمولة n8n مهما اختلف شكلها. */
function normalizeRanking(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload.filter(isPlainObject);
    if (!isPlainObject(payload)) return [];
    for (const key of [
        'candidate_ranking',
        'ranking',
        'ranked',
        'candidates',
        'results',
        'items',
        'comparison',
        'data',
    ]) {
        const v = payload[key];
        if (Array.isArray(v)) return v.filter(isPlainObject);
    }
    return [];
}

function mapRankingRows(rows: Array<Record<string, unknown>>) {
    return rows.map((r, i) => ({
        rank: pickNum(r, ['rank', 'position', 'order']) ?? i + 1,
        candidateName: pickStr(r, [
            'candidateName',
            'candidate_name',
            'name',
            'full_name',
            'fullName',
            'candidate',
        ]),
        candidateEmail: pickStr(r, ['candidateEmail', 'email', 'mail']),
        score: pickNum(r, ['score', 'initial_screening_score', 'rating', 'points', 'total']),
        strengths: pickStr(r, ['strengths', 'strength', 'pros', 'competitive_advantage']),
        weaknesses: pickStr(r, ['weaknesses', 'weakness', 'cons']),
        reason: pickStr(r, [
            'reason',
            'rationale',
            'justification',
            'summary',
            'notes',
            'competitive_advantage',
        ]),
    }));
}

/**
 * POST /api/recruitment-campaigns/:campaignId/ai-compare-top[?stage=screening|voice|video]
 * يطلق المقارنة: ينشئ requestId، يحفظ النتيجة كـ pending، ويرسل لـ n8n (حسب المرحلة).
 */
router.post(
    '/:campaignId/ai-compare-top',
    requirePermission('campaign.write'),
    async (req: Request, res: Response) => {
        try {
            const stage = resolveAiCompareStage(req.query.stage);
            if (!stage) {
                return res.status(400).json({ success: false, error: 'Invalid stage' });
            }

            if (isCompareTopV2EnabledForStage(stage)) {
                const { campaignId } = req.params;
                const body = req.body || {};
                const rawEmails: unknown = body.emails ?? body.aiCompareTopEmails ?? [];
                const emails = (Array.isArray(rawEmails) ? rawEmails : [])
                    .map((e) => (typeof e === 'string' ? e.trim() : ''))
                    .filter(Boolean);

                if (emails.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing emails',
                        message: 'At least one recipient email is required',
                    });
                }
                if (emails.length > MAX_AI_COMPARE_EMAILS) {
                    return res.status(400).json({
                        success: false,
                        error: 'Too many emails',
                        message: `A maximum of ${MAX_AI_COMPARE_EMAILS} emails is allowed`,
                    });
                }
                const invalid = emails.find((e) => !EMAIL_RE.test(e));
                if (invalid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid email',
                        message: `Invalid email address: ${invalid}`,
                    });
                }

                await triggerCompareTopV2(req, res, stage, campaignId, emails);
                return;
            }

            const cfg = AI_COMPARE_STAGES[stage];

            const { campaignId } = req.params;
            const body = req.body || {};
            const rawEmails: unknown = body.emails ?? body.aiCompareTopEmails ?? [];
            const emails = (Array.isArray(rawEmails) ? rawEmails : [])
                .map((e) => (typeof e === 'string' ? e.trim() : ''))
                .filter(Boolean);

            if (emails.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing emails',
                    message: 'At least one recipient email is required',
                });
            }
            if (emails.length > MAX_AI_COMPARE_EMAILS) {
                return res.status(400).json({
                    success: false,
                    error: 'Too many emails',
                    message: `A maximum of ${MAX_AI_COMPARE_EMAILS} emails is allowed`,
                });
            }
            const invalid = emails.find((e) => !EMAIL_RE.test(e));
            if (invalid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid email',
                    message: `Invalid email address: ${invalid}`,
                });
            }

            const campaign = await RecruitmentCampaign.findOne(orgScopedQuery(req, { campaignId }));
            if (!campaign) {
                return res.status(404).json({ success: false, error: 'Campaign not found' });
            }

            const requestId = crypto.randomBytes(16).toString('hex');
            const organizationId = getOrgId(req);

            let comparePool;
            try {
                comparePool = await buildCampaignComparePool({
                    compareStage: aiCompareStageToPoolStage(stage),
                    campaignId,
                    organizationId,
                    topN: body.topN ?? body.top_n,
                });
            } catch (err) {
                if (err instanceof CampaignComparePoolError) {
                    return res.status(err.statusCode).json({
                        success: false,
                        error: err.code,
                        message: err.message,
                    });
                }
                throw err;
            }

            const candidateCount = comparePool.candidatePool.length;
            const billing = await chargeCompareTopCredits({
                organizationId,
                campaignId,
                requestId,
                stage,
                emailCount: emails.length,
                candidateCount,
            });
            if (!billing.ok) {
                const httpStatus = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 409;
                return res.status(httpStatus).json({
                    success: false,
                    error: billing.code,
                    message: billing.message,
                });
            }

            const chargedMicroCredits = billing.chargedMicroCredits ?? 0;
            campaign[cfg.field] = {
                requestId,
                status: 'pending',
                emails,
                requestedByClerkUserId: getClerkUserId(req),
                requestedAt: new Date(),
                completedAt: undefined,
                error: undefined,
                summary: undefined,
                ranking: undefined,
                raw: undefined,
                // Charge bookkeeping — refund uses the stored amount, never a recompute.
                chargedMicroCredits,
                chargeIdempotencyKey: `compare-top:${requestId}`,
                refundIdempotencyKey: `compare-top-refund:${requestId}`,
                deadlineAt: new Date(Date.now() + COMPARE_EMAIL_DEADLINE_MS),
            };
            await campaign.save();

            const payload = {
                source: cfg.source,
                stage,
                campaignId,
                organizationId,
                requestId,
                emails,
                criteria: comparePool.criteria,
                topN: comparePool.topN,
                candidatePool: comparePool.candidatePool,
                candidateSnapshotHash: comparePool.candidateSnapshotHash,
                callbackUrl: getAiCompareCallbackUrl(stage),
                submittedAt: new Date().toISOString(),
            };

            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 20_000);
                const n8nRes = await fetch(getAiCompareWebhookUrl(stage), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: ctrl.signal,
                });
                clearTimeout(timer);

                if (!n8nRes.ok) {
                    const text = await n8nRes.text().catch(() => '');
                    console.warn('[ai-compare] n8n non-OK:', stage, n8nRes.status, text?.slice(0, 200));
                    campaign[cfg.field]!.status = 'failed';
                    campaign[cfg.field]!.error = `n8n responded with ${n8nRes.status}`;
                    campaign[cfg.field]!.completedAt = new Date();
                    await campaign.save();
                    // Charge already taken upfront → refund since the report won't be produced.
                    await refundCompareEmail({
                        campaignId,
                        organizationId,
                        field: cfg.field,
                        requestId,
                        reason: 'failed',
                    }).catch((e) => console.warn(`[ai-compare] refund failed: ${e?.message || e}`));
                    return res.status(502).json({
                        success: false,
                        error: 'n8n webhook returned an error',
                        status: n8nRes.status,
                    });
                }
            } catch (err: any) {
                console.error('[ai-compare] fetch error:', stage, err?.message || err);
                campaign[cfg.field]!.status = 'failed';
                campaign[cfg.field]!.error = 'Failed to reach n8n webhook';
                campaign[cfg.field]!.completedAt = new Date();
                await campaign.save();
                await refundCompareEmail({
                    campaignId,
                    organizationId,
                    field: cfg.field,
                    requestId,
                    reason: 'failed',
                }).catch((e) => console.warn(`[ai-compare] refund failed: ${e?.message || e}`));
                return res.status(502).json({
                    success: false,
                    error: 'Failed to reach n8n webhook',
                });
            }

            // Dispatched successfully — move to processing (awaiting n8n callback).
            campaign[cfg.field]!.status = 'processing';
            await campaign.save();

            logAudit(req, {
                action: 'campaign.ai_compare_top.requested',
                targetType: 'campaign',
                targetId: campaignId,
                metadata: { stage, requestId, emailCount: emails.length, candidateCount },
            });

            return res.status(202).json({
                success: true,
                requestId,
                status: 'pending',
                message: 'Comparison requested; poll for results',
            });
        } catch (error: any) {
            console.error('❌ Error triggering AI compare top:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to trigger comparison',
                message: error.message,
            });
        }
    }
);

/**
 * GET /api/recruitment-campaigns/:campaignId/ai-compare-top[?stage=screening|voice|video]
 * استطلاع نتيجة المقارنة لمرحلة محددة (polling من الواجهة).
 */
router.get('/:campaignId/ai-compare-top', async (req: Request, res: Response) => {
    try {
        const stage = resolveAiCompareStage(req.query.stage);
        if (!stage) {
            return res.status(400).json({ success: false, error: 'Invalid stage' });
        }

        if (isCompareTopV2EnabledForStage(stage)) {
            const { campaignId } = req.params;
            await getCompareTopV2Result(req, res, stage, campaignId);
            return;
        }

        const cfg = AI_COMPARE_STAGES[stage];

        const { campaignId } = req.params;
        const campaign = await RecruitmentCampaign.findOne(
            orgScopedQuery(req, { campaignId })
        ).select('campaignId aiCompareTopResult voiceAiCompareTopResult videoAiCompareTopResult');

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        return res.json({
            success: true,
            campaignId,
            stage,
            result: campaign[cfg.field] || null,
        });
    } catch (error: any) {
        console.error('❌ Error fetching AI compare top result:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch comparison result',
            message: error.message,
        });
    }
});

/**
 * POST /webhook/n8n/screening-ai-compare — مدخل n8n لنتائج المقارنة.
 * يتحقق من campaignId + organizationId + requestId، ويتجاهل الردود القديمة (stale).
 * مُسجَّل في server.ts قبل المسارات المحمية (لا يتطلب auth؛ يُحمى بـ secret + requestId).
 */
async function handleAiCompareInbound(
    req: Request,
    res: Response,
    stage: AiCompareStage
): Promise<void> {
    const cfg = AI_COMPARE_STAGES[stage];

    const secret = (process.env.N8N_SCREENING_AI_COMPARE_INBOUND_SECRET || '').trim();
    if (secret) {
        const h = req.headers['x-ai-compare-secret'];
        const token = typeof h === 'string' ? h.trim() : '';
        if (token !== secret) {
            res.status(401).json({ ok: false, error: 'Invalid or missing X-AI-Compare-Secret' });
            return;
        }
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
    const organizationId =
        typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';

    if (!campaignId || !organizationId || !requestId) {
        res.status(400).json({
            ok: false,
            error: 'campaignId, organizationId and requestId are required',
        });
        return;
    }

    const idempotencyKey = `ai-compare:${stage}:${campaignId}:${requestId}`;
    let claimed = false;
    try {
        const claim = await claimWebhook(cfg.wbSource, idempotencyKey, {
            route: `/webhook/n8n/${stage === 'screening' ? 'screening' : stage}-ai-compare`,
            campaignId,
            stage,
        });
        if (claim.duplicate) {
            console.log('♻️ ai-compare duplicate webhook ignored:', idempotencyKey);
            res.json({ ok: true, duplicate: true, message: 'Already processed (idempotency)' });
            return;
        }
        claimed = true;

        const campaign = await RecruitmentCampaign.findOne({ campaignId, organizationId });
        if (!campaign) {
            await completeWebhook(cfg.wbSource, idempotencyKey);
            res.status(404).json({ ok: false, error: 'Campaign not found' });
            return;
        }

        const current = campaign[cfg.field];
        // Stale guard: تجاهل الردود التي لا تطابق آخر requestId مطلوب.
        if (!current || current.requestId !== requestId) {
            await completeWebhook(cfg.wbSource, idempotencyKey);
            console.log('🗑️ ai-compare stale response ignored:', stage, requestId);
            res.json({ ok: true, stale: true, message: 'Stale requestId ignored' });
            return;
        }

        // Terminal-state guard: if the charge was already refunded (timeout/failure),
        // a late n8n callback must NOT complete the request or imply the email was
        // legitimately sent. `refunded` is terminal. n8n must check request status
        // BEFORE sending the final email (external contract) to avoid free service.
        if (current.status === 'refunded' || current.status === 'expired') {
            await completeWebhook(cfg.wbSource, idempotencyKey);
            console.warn(
                `[ai-compare] late callback after ${current.status} ignored: ${stage} ${requestId}`,
            );
            res.json({
                ok: true,
                rejected: true,
                status: current.status,
                message: 'Request already refunded/expired; callback ignored',
            });
            return;
        }

        const errorText = typeof body.error === 'string' ? body.error.trim() : '';
        if (errorText) {
            current.status = 'failed';
            current.error = errorText.slice(0, 2000);
            current.completedAt = new Date();
            campaign.markModified(cfg.field);
            await campaign.save();
            // Refund the upfront charge — report failed.
            await refundCompareEmail({
                campaignId,
                organizationId,
                field: cfg.field,
                requestId,
                reason: 'failed',
            }).catch((e) => console.warn(`[ai-compare] inbound refund failed: ${e?.message || e}`));
            await completeWebhook(cfg.wbSource, idempotencyKey);
            res.json({ ok: true, message: 'Comparison failure recorded; charge refunded' });
            return;
        } else {
            const rows = mapRankingRows(normalizeRanking(body));
            current.status = 'completed';
            current.summary =
                pickStr(body, [
                    'comparative_summary',
                    'summary',
                    'overview',
                    'conclusion',
                    'top_recommendation',
                    'recommendation',
                ]) || undefined;
            current.ranking = rows.length > 0 ? rows : undefined;
            current.raw = body;
            current.completedAt = new Date();
            current.error = undefined;
        }
        campaign.markModified(cfg.field);
        await campaign.save();

        await completeWebhook(cfg.wbSource, idempotencyKey);
        res.json({ ok: true, message: 'Comparison result stored' });
    } catch (err) {
        if (claimed) {
            await failWebhook(cfg.wbSource, idempotencyKey, wbErrorMessage(err)).catch(
                () => undefined
            );
        }
        console.error('[ai-compare] inbound handler error:', stage, err);
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
}

export function postScreeningAiCompareN8nInbound(req: Request, res: Response): Promise<void> {
    return handleAiCompareInbound(req, res, 'screening');
}

export function postVoiceAiCompareN8nInbound(req: Request, res: Response): Promise<void> {
    return handleAiCompareInbound(req, res, 'voice');
}

export function postVideoAiCompareN8nInbound(req: Request, res: Response): Promise<void> {
    return handleAiCompareInbound(req, res, 'video');
}

export default router;

