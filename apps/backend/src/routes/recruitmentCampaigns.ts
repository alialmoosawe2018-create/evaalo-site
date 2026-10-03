import express, { Request, Response } from 'express';
import crypto from 'crypto';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import {
    generateJobAdvertisement,
    translateJobAdvertisement,
    suggestJobCriteria,
    rewriteJobDescriptionText,
} from '../services/llmService.js';
import { compareNumbers, JOB_DESCRIPTION_MAX_CHARS, readJobDescription } from '../services/jobDescription.js';
import { getProfileForClerkUser } from '../services/userProfileService.js';
import { orgScopedQuery, orgScopedDefaults } from '../middleware/orgScope.js';
import { requirePermission } from '../middleware/rbac.js';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { getOrgId, getClerkUserId, isMissingProductionOrg } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { cacheGetOrSet } from '../services/cache.js';
import { ensureBlueprintForCampaign } from '../services/expertise/ensureBlueprint.js';
import InterviewBlueprint from '../models/InterviewBlueprint.js';
import {
    buildEvaluationRubricFromCampaignBody,
    deriveLegacyRubricFromCriteria,
    RubricValidationError,
    stripRubricAndTemplateKeysFromCriteria,
} from '../services/evaluationRubricService.js';
import {
    createFormBindingForTemplate,
    hashRubricContent,
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
import { consumeCredits, adjustCredits } from '../services/billingRuntimeService.js';
import { creditCostMicro } from '../services/billingEngine.js';
import { normalizeInterviewLanguage, resolveCampaignInterviewLanguage } from '../services/interviewLanguage.js';
import {
    checkJdQuestionSet,
    ensureJdInterviewQuestions,
    generateJdInterviewQuestions,
    isJdInterviewQuestionsEnabled,
    isJdQuestionLanguageEnabled,
    jdQuestionLanguages,
    jdQuestionNames,
    jdQuestionsHash,
    jdQuestionsModel,
    JD_QUESTIONS_PROMPT_VERSION,
    readSubmittedJdQuestions,
} from '../services/jdInterviewQuestions.js';

const router = express.Router();

const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';

/** استرداد رسم توليد الإعلان عند فشل التوليد (idempotent، fire-and-forget). */
async function refundJobAd(organizationId: string, genId: string, reason: string): Promise<void> {
    await adjustCredits({
        organizationId,
        amountMicro: creditCostMicro('JOB_AD', 1),
        idempotencyKey: `job-ad-refund:${genId}`,
        metadata: { kind: 'job_ad_refund', reason, genId },
    }).catch((e) =>
        console.warn(`[job-ad] refund failed genId=${genId}: ${e?.message || e}`)
    );
}

/** استرداد رسم اقتراح المعايير عند الفشل (idempotent، fire-and-forget). */
async function refundCriteriaSuggestion(organizationId: string, genId: string, reason: string): Promise<void> {
    await adjustCredits({
        organizationId,
        amountMicro: creditCostMicro('CRITERIA_SUGGESTION', 1),
        idempotencyKey: `criteria-suggestion-refund:${genId}`,
        metadata: { kind: 'criteria_suggestion_refund', reason, genId },
    }).catch((e) =>
        console.warn(`[criteria-suggestion] refund failed genId=${genId}: ${e?.message || e}`)
    );
}

// POST /api/recruitment-campaigns/generate-ad - توليد إعلان الوظيفة تلقائياً من المعايير
router.post('/generate-ad', async (req: Request, res: Response) => {
    const genId = crypto.randomUUID();
    let organizationId = '';
    let jobAdCharged = false;
    try {
        const { language, jobDescription, ...criteria } = req.body || {};
        organizationId = getOrgId(req);

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

        // تحصيل JOB_AD (1 كردت/توليد — السعر المعلن في الكتالوج). يُسترد إذا فشل التوليد أدناه.
        if (BILLING_ENFORCE) {
            const billing = await consumeCredits({
                organizationId,
                usageType: 'JOB_AD',
                units: 1,
                idempotencyKey: `job-ad:${genId}`,
                source: 'job_ad',
                sourceId: genId,
                metadata: { language: language || null },
            });
            if (!billing.ok) {
                const status = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    error: billing.code,
                    message: billing.message,
                });
            }
            jobAdCharged = !billing.duplicate;
        }

        const ad = await generateJobAdvertisement(
            criteria,
            language,
            company,
            typeof jobDescription === 'string' ? jobDescription : undefined
        );
        if (!ad) {
            if (jobAdCharged) await refundJobAd(organizationId, genId, 'empty_generation');
            return res.status(400).json({
                success: false,
                error: 'Unable to generate advertisement',
                message: 'No criteria provided or OpenAI not configured'
            });
        }

        logAudit(req, {
            action: 'recruitmentCampaign.generateAd',
            targetType: 'recruitmentCampaign',
            metadata: { language: language || null, charged: jobAdCharged },
        });

        res.json({
            success: true,
            jobAdvertisement: ad,
            language: language || null
        });
    } catch (error: any) {
        if (jobAdCharged) await refundJobAd(organizationId, genId, 'exception');
        console.error('❌ Error generating job advertisement:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate job advertisement',
            message: error.message
        });
    }
});

// POST /api/recruitment-campaigns/suggest-criteria - اقتراح معايير التقييم تلقائياً من الدور (1 كردت)
router.post('/suggest-criteria', async (req: Request, res: Response) => {
    const genId = crypto.randomUUID();
    let organizationId = '';
    let charged = false;
    try {
        const body = req.body || {};
        const position = typeof body.position === 'string' ? body.position.trim() : '';
        if (!position) {
            return res.status(400).json({
                success: false,
                error: 'Missing position',
                message: 'position is required to suggest criteria',
            });
        }
        organizationId = getOrgId(req);

        // تحصيل CRITERIA_SUGGESTION (1 كردت/اقتراح). يُسترد إذا فشل الاقتراح أدناه.
        if (BILLING_ENFORCE) {
            const billing = await consumeCredits({
                organizationId,
                usageType: 'CRITERIA_SUGGESTION',
                units: 1,
                idempotencyKey: `criteria-suggestion:${genId}`,
                source: 'criteria_suggestion',
                sourceId: genId,
                metadata: { position },
            });
            if (!billing.ok) {
                const status = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    error: billing.code,
                    message: billing.message,
                });
            }
            charged = !billing.duplicate;
        }

        const criteria = await suggestJobCriteria({
            position,
            roleKey: typeof body.roleKey === 'string' ? body.roleKey : undefined,
            careerLevel: typeof body.careerLevel === 'string' ? body.careerLevel : undefined,
            jobAdvertisement:
                typeof body.jobAdvertisement === 'string' ? body.jobAdvertisement : undefined,
            jobDescription: typeof body.jobDescription === 'string' ? body.jobDescription : undefined,
            language: typeof body.language === 'string' ? body.language : undefined,
        });

        if (!criteria.length) {
            if (charged) await refundCriteriaSuggestion(organizationId, genId, 'empty_suggestion');
            return res.status(400).json({
                success: false,
                error: 'No criteria suggested',
                message: 'Could not suggest criteria (OpenAI not configured or empty result)',
            });
        }

        logAudit(req, {
            action: 'recruitmentCampaign.suggestCriteria',
            targetType: 'recruitmentCampaign',
            metadata: { position, count: criteria.length, charged },
        });

        res.json({ success: true, criteria });
    } catch (error: any) {
        if (charged) await refundCriteriaSuggestion(organizationId, genId, 'exception');
        console.error('❌ Error suggesting job criteria:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to suggest criteria',
            message: error.message,
        });
    }
});

// ── «Job description & requirements»: the free AI rewrite ───────────────────────
// Free, so it is signed-in only and capped per organization (in-memory, best-effort —
// one process). A request makes at most REWRITE_ATTEMPTS model calls.
const REWRITE_WINDOW_MS = 60 * 60 * 1000;
const REWRITE_MAX_PER_WINDOW = 20;
const REWRITE_ATTEMPTS = 2;
const rewriteHits = new Map<string, number[]>();

function rewriteRateLimited(organizationId: string): boolean {
    const now = Date.now();
    const hits = (rewriteHits.get(organizationId) || []).filter((t) => now - t < REWRITE_WINDOW_MS);
    if (hits.length >= REWRITE_MAX_PER_WINDOW) {
        rewriteHits.set(organizationId, hits);
        return true;
    }
    hits.push(now);
    rewriteHits.set(organizationId, hits);
    return false;
}

// POST /api/recruitment-campaigns/rewrite-description — rewords the recruiter's job
// description. The answer is a proposal the recruiter accepts or discards, and it is
// offered only if it kept every number of the original and added none (a changed
// number is a changed requirement); otherwise the model gets one more try.
router.post(
    '/rewrite-description',
    conditionalRequireAuth(),
    requirePermission('campaign.write'),
    async (req: Request, res: Response) => {
        try {
            const organizationId = getOrgId(req);
            if (isMissingProductionOrg(organizationId)) {
                return res.status(403).json({
                    success: false,
                    error: 'ORG_REQUIRED',
                    message: 'You must create or select an organization first.',
                });
            }
            const read = readJobDescription(req.body?.text);
            if (!read.ok) {
                return res.status(400).json({ success: false, error: read.code, message: read.message });
            }
            if (!read.value) {
                return res.status(400).json({
                    success: false,
                    error: 'JOB_DESCRIPTION_EMPTY',
                    message: 'Write or paste the job description first.',
                });
            }
            if (rewriteRateLimited(organizationId)) {
                return res.status(429).json({
                    success: false,
                    error: 'RATE_LIMITED',
                    message: 'Too many rewrites in the last hour. Please try again later.',
                });
            }

            const original = read.value;
            let rejected: 'numbers' | 'too_long' | null = null;
            for (let attempt = 1; attempt <= REWRITE_ATTEMPTS; attempt += 1) {
                const raw = await rewriteJobDescriptionText(original);
                if (!raw) {
                    return res.status(503).json({
                        success: false,
                        error: 'REWRITE_UNAVAILABLE',
                        message: 'The rewrite is unavailable right now. Your text is unchanged.',
                    });
                }
                const text = raw.replace(/\r\n?/g, '\n').trim();
                if (text.length > JOB_DESCRIPTION_MAX_CHARS) {
                    rejected = 'too_long';
                    continue;
                }
                const { invented, dropped } = compareNumbers(original, text);
                if (invented.length || dropped.length) {
                    rejected = 'numbers';
                    console.warn(
                        `[rewrite-description] attempt ${attempt} changed numbers (added ${invented.length}, dropped ${dropped.length}) — not offered`
                    );
                    continue;
                }
                logAudit(req, {
                    action: 'recruitmentCampaign.rewriteDescription',
                    targetType: 'recruitmentCampaign',
                    metadata: { chars: original.length, attempts: attempt, accepted: true },
                });
                return res.json({ success: true, text, attempts: attempt });
            }

            logAudit(req, {
                action: 'recruitmentCampaign.rewriteDescription',
                targetType: 'recruitmentCampaign',
                metadata: { chars: original.length, attempts: REWRITE_ATTEMPTS, accepted: false, reason: rejected },
            });
            return res.status(422).json({
                success: false,
                error: 'REWRITE_REJECTED',
                reason: rejected,
                message: "The rewrite changed the job's requirements, so it was not used. Your text is unchanged.",
            });
        } catch (error: any) {
            console.error('❌ Error rewriting job description:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to rewrite job description',
                message: error.message,
            });
        }
    }
);

// ── Part one of the video interview: questions from the job description ────────
// The recruiter sees the three questions BEFORE the job exists (preview), may edit
// them, and the same set is stored when the job is created — so no candidate can
// start before they are ready. Off unless JD_INTERVIEW_QUESTIONS=true.
const JD_PREVIEW_WINDOW_MS = 60 * 60 * 1000;
const JD_PREVIEW_MAX_PER_WINDOW = 20;
const jdPreviewHits = new Map<string, number[]>();

function jdPreviewRateLimited(organizationId: string): boolean {
    const now = Date.now();
    const hits = (jdPreviewHits.get(organizationId) || []).filter((t) => now - t < JD_PREVIEW_WINDOW_MS);
    if (hits.length >= JD_PREVIEW_MAX_PER_WINDOW) {
        jdPreviewHits.set(organizationId, hits);
        return true;
    }
    hits.push(now);
    jdPreviewHits.set(organizationId, hits);
    return false;
}

// GET /api/recruitment-campaigns/jd-interview-questions/config — what the job form may show.
router.get('/jd-interview-questions/config', conditionalRequireAuth(), (_req: Request, res: Response) => {
    const enabled = isJdInterviewQuestionsEnabled();
    res.json({ success: true, enabled, languages: enabled ? jdQuestionLanguages() : [] });
});

// POST /api/recruitment-campaigns/jd-interview-questions/preview — three questions or none.
// Nothing is stored: the browser shows them, the recruiter may edit them, and they come
// back with the create request, where they are checked again.
router.post(
    '/jd-interview-questions/preview',
    conditionalRequireAuth(),
    requirePermission('campaign.write'),
    async (req: Request, res: Response) => {
        try {
            if (!isJdInterviewQuestionsEnabled()) {
                return res.status(404).json({ success: false, error: 'FEATURE_DISABLED' });
            }
            const organizationId = getOrgId(req);
            if (isMissingProductionOrg(organizationId)) {
                return res.status(403).json({
                    success: false,
                    error: 'ORG_REQUIRED',
                    message: 'You must create or select an organization first.',
                });
            }
            const read = readJobDescription(req.body?.text);
            if (!read.ok) {
                return res.status(400).json({ success: false, error: read.code, message: read.message });
            }
            if (!read.value) {
                return res.status(400).json({
                    success: false,
                    error: 'JOB_DESCRIPTION_EMPTY',
                    message: 'Write or paste the job description first.',
                });
            }
            const language = normalizeInterviewLanguage(req.body?.interviewLanguage) ?? 'ar';
            if (!isJdQuestionLanguageEnabled(language)) {
                return res.status(409).json({
                    success: false,
                    error: 'LANGUAGE_NOT_ENABLED',
                    message: 'Interview questions from the description are not available for this interview language yet.',
                });
            }
            if (jdPreviewRateLimited(organizationId)) {
                return res.status(429).json({
                    success: false,
                    error: 'RATE_LIMITED',
                    message: 'Too many attempts in the last hour. Please try again later.',
                });
            }
            const result = await generateJdInterviewQuestions({
                jobDescription: read.value,
                language,
                names: jdQuestionNames(null, [req.body?.position, req.body?.company]),
            });
            logAudit(req, {
                action: 'recruitmentCampaign.jdQuestionsPreview',
                targetType: 'recruitmentCampaign',
                metadata: { chars: read.value.length, language, attempts: result.attempts, ok: result.ok, reason: result.reason || null },
            });
            if (!result.ok) {
                return res.status(422).json({
                    success: false,
                    error: 'GENERATION_FAILED',
                    message:
                        'The interview questions could not be prepared. You can try again, or continue: the interview will run without them.',
                });
            }
            return res.json({
                success: true,
                language,
                questions: result.questions,
                promptVersion: JD_QUESTIONS_PROMPT_VERSION,
            });
        } catch (error: any) {
            console.error('❌ Error previewing job-description interview questions:', error);
            res.status(500).json({ success: false, error: 'PREVIEW_FAILED', message: error.message });
        }
    }
);

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
        /* لغة المقابلة — تُحدَّد هنا وحدها (قرار المالك ٢٠٢٦-٠٩-٢٣)، ولا يغيّرها رابطٌ لاحقاً.
           الغياب مقبول: حملاتٌ من واجهةٍ أقدم، ونافذة النشر بين الخادم والواجهة. الإلزام
           في النموذج. أما قيمةٌ غير مفهومة فتُرفض — تخزينها صمتاً يعني تخميناً لاحقاً. */
        const rawInterviewLanguage = body.interviewLanguage;
        const interviewLanguage = normalizeInterviewLanguage(rawInterviewLanguage);
        if (rawInterviewLanguage != null && String(rawInterviewLanguage).trim() !== '' && !interviewLanguage) {
            return res.status(400).json({
                success: false,
                error: 'invalid_interview_language',
                message: "interviewLanguage must be 'ar' or 'en'.",
            });
        }
        const formTemplateId =
            typeof body.formTemplateId === 'string' ? body.formTemplateId.trim() : '';
        const isScreeningForm = interviewType === 'form' || Boolean(formTemplateId);

        /* The ad is read from the request body itself. It used to be read from
           `criteria` AFTER stripRubricAndTemplateKeysFromCriteria — which removes it
           (so it never becomes a scored criterion) — so it was always undefined and
           no campaign ever stored its ad: 0 of 68 in production on 2026-10-01. */
        const jobAdvertisement =
            typeof body.jobAdvertisement === 'string' && body.jobAdvertisement.trim()
                ? body.jobAdvertisement.trim()
                : undefined;
        /* «Job description & requirements» — read from the body like the ad, and kept out of
           `criteria` by the strip: it is context, never a scored criterion. */
        const jobDescriptionRead = readJobDescription(body.jobDescription);
        if (!jobDescriptionRead.ok) {
            return res.status(400).json({
                success: false,
                error: jobDescriptionRead.code,
                message: jobDescriptionRead.message,
            });
        }
        const criteria = stripRubricAndTemplateKeysFromCriteria({ ...body });

        const shareLangRaw = String(body.language || '').toLowerCase();
        const evaluationLanguage =
            shareLangRaw === 'en' ? 'en' : shareLangRaw === 'ar' || shareLangRaw === 'ku' ? 'ar' : 'ar';
        criteria.evaluationLanguage = evaluationLanguage;

        /* Part one of the video interview (JD_INTERVIEW_QUESTIONS). The set the recruiter
           saw in the preview comes back with the job and is checked again here — an edit
           is free text — so a set that fails is refused with each question's reasons, and
           no job is created. Three questions or none. «Continue without» is remembered
           as `failed: skipped_by_owner` and never generated behind the recruiter's back.
           Checked before anything below has side effects. */
        let jdInterviewQuestionsField: Record<string, unknown> | undefined;
        let generateJdQuestionsInBackground = false;
        if (isJdInterviewQuestionsEnabled()) {
            const description = jobDescriptionRead.value;
            const jdLanguage =
                interviewLanguage ?? resolveCampaignInterviewLanguage({ criteria }).language;
            const submitted = readSubmittedJdQuestions(body.jdInterviewQuestions);
            if (submitted) {
                if (!description) {
                    return res.status(400).json({
                        success: false,
                        error: 'JD_QUESTIONS_WITHOUT_DESCRIPTION',
                        message: 'Interview questions need the job description they were made from.',
                    });
                }
                if (!isJdQuestionLanguageEnabled(jdLanguage)) {
                    return res.status(409).json({
                        success: false,
                        error: 'LANGUAGE_NOT_ENABLED',
                        message: 'Interview questions from the description are not available for this interview language yet.',
                    });
                }
                const check = checkJdQuestionSet(submitted, jdLanguage, jdQuestionNames(criteria));
                if (!check.ok) {
                    return res.status(400).json({
                        success: false,
                        error: 'JD_QUESTIONS_INVALID',
                        problems: check.problems,
                        setProblems: check.setProblems,
                        message: 'Some interview questions need a change before the job can be created.',
                    });
                }
                const source = body.jdInterviewQuestionsSource === 'edited' ? 'edited' : 'preview';
                jdInterviewQuestionsField = {
                    status: 'ready',
                    questions: submitted,
                    source,
                    language: jdLanguage,
                    jdHash: jdQuestionsHash(description, jdLanguage),
                    promptVersion: JD_QUESTIONS_PROMPT_VERSION,
                    model: source === 'preview' ? jdQuestionsModel() : undefined,
                    generatedAt: new Date(),
                };
            } else if (description && body.jdInterviewQuestionsSkip === true) {
                jdInterviewQuestionsField = {
                    status: 'failed',
                    error: 'skipped_by_owner',
                    language: jdLanguage,
                    jdHash: jdQuestionsHash(description, jdLanguage),
                    promptVersion: JD_QUESTIONS_PROMPT_VERSION,
                    generatedAt: new Date(),
                };
            } else if (description && isJdQuestionLanguageEnabled(jdLanguage)) {
                // A job created without the preview (API, older page): fallback only.
                generateJdQuestionsInBackground = true;
            }
        }

        /* Keys that say WHICH role this is, or how to process it — none of them
           is something a candidate can be measured against. The role picker
           fills `position` and its companions on its own, so counting them let
           a campaign be published carrying nothing but its own job title. */
        const NON_SCORING_CRITERIA = new Set([
            'position',
            'roleKey',
            'careerLevel',
            'managementTrack',
            'labelKey',
            'roleMatchSource',
            'researchDomain',
            'job',
            'job_level',
            'evaluationLanguage',
            'aiCompareTop',
            'aiCompareTopEmails',
        ]);
        const scoringCriteria = Object.entries(criteria).filter(
            ([k, v]) =>
                !NON_SCORING_CRITERIA.has(k) &&
                v != null &&
                !(typeof v === 'string' && !v.trim()) &&
                !(Array.isArray(v) && v.length === 0)
        );

        if (Object.keys(criteria).length === 0 && !isScreeningForm) {
            return res.status(400).json({
                success: false,
                error: 'Missing criteria',
                message: 'At least one criterion is required',
            });
        }

        /* A campaign that will be screened in writing needs something to score.
           Without this a campaign was published carrying only its job title,
           and every applicant came back with no score and "not enough criteria
           evaluated — needs human review".

           An earlier version of this check hung off `isScreeningForm`, which is
           `interviewType === 'form' || formTemplateId` — and the start-process
           flow sets neither, so the check never once ran. Audio and video
           campaigns are the ones deliberately exempt: they are scored from the
           interview itself, not from a written rubric. */
        const isInterviewOnly = interviewType === 'audio' || interviewType === 'video';
        if (!isInterviewOnly && scoringCriteria.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'rubric_required',
                message:
                    'A screening campaign needs at least one criterion to measure candidates against — a requirement, a skill, a certification, or a custom rubric item. Without one, every applicant is returned unscored.',
            });
        }

        /* `career_level_experience_conflict` REMOVED 2026-09-16, by the owner: the
           employer advertises what they want, and the API must not refuse a level +
           experience pairing the recruiter chose on purpose.

           It was added hours earlier to stop a 0-minimum band making the experience
           criterion unfalsifiable in the Stage-1 scorer. That hole is now closed
           where it belonged — at the scorer: credit is months-based for a 0-minimum
           band, and capped at the position fraction when the role match is only
           partial. Zero relevant months earns zero instead of the full 25. The
           pairing is priced correctly now, so forbidding it is redundant, and the
           form's copy of this rule was worse than redundant — it read the level
           resolved from the role catalog, not the Job Level the recruiter had just
           picked, and refused "intern" on a campaign the recruiter had set to
           intern. Do not reinstate either side without re-reading that scorer. */

        let formBinding;
        let evaluationRubric;
        let rubricVersion = 1;
        let rubricSnapshotHash: string | undefined;

        /**
         * ⚠️ ثبّت المعايير التي سيُقاس عليها المرشّح فعلاً — لكل حملة تُصنّف.
         *
         * كان الحقلان معلَّقين على `isScreeningForm` (`interviewType==='form' ||
         * formTemplateId`) ومسار بدء العملية لا يضبط أيّاً منهما — تماماً كما اكتُشف
         * أعلاه في فحص `rubric_required`. النتيجة: **صفر من ١٥ حملة** تحمل لقطة،
         * فكل حملة تُطبَّع إلى `'legacy'`. وذلك ما جعل تصادم مفتاح صندوق المرحلة ١
         * **مضموناً** لا نادراً، وترك المرشّحين يُقيَّمون على معايير غير مثبَّتة.
         *
         * والتجزئة تُحسب من المعايير **المشتَقّة** لا من قائمةٍ نخزّنها، لأنّ
         * `resolveCampaignEvaluationRubric` تشتقّ من `criteria` ما لم يكن
         * `evaluationRubric` مخزَّناً. تخزينُ قائمةٍ هنا كان سيغيّر ما يُقيَّم عليه
         * الناس فعلاً — وهذا إصلاحٌ لا يجوز أن يفعله. فنحن نثبّت الواقع، لا نبدّله.
         */
        if (!isInterviewOnly) {
            rubricSnapshotHash = hashRubricContent(deriveLegacyRubricFromCriteria(criteria));
        }

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
            jobDescription: jobDescriptionRead.value,
            jdInterviewQuestions: jdInterviewQuestionsField,
            interviewType: body.interviewType || undefined,
            interviewLanguage: interviewLanguage ?? undefined,
            templateType: body.templateType || undefined,
            templateName: body.templateName || undefined,
            publicApplicationToken,
            formBinding,
            evaluationRubric,
            rubricVersion: rubricVersion || undefined,
            rubricSnapshotHash: rubricSnapshotHash || undefined,
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

        // Every campaign can reach the video stage — its link is shared from the
        // board later, whatever `interviewType` it was created with — so the
        // competency blueprint is generated for all of them here, in the background.
        // The old `interviewType === 'video'` gate matched no real campaign (production
        // ones are "audio" or unset), which left generation to the candidate's own
        // /prepare, about a hundred seconds before they pressed Start, and the first
        // interview of every campaign ran without competencies.
        // idempotent, fail-open: a failure never blocks creation — /prepare and /start
        // start the generation again (deduped) and the agent falls back to the JSON
        // bank only if it has still not locked by then.
        ensureBlueprintForCampaign(campaignId).catch((err) => {
            console.error(`⚠️ ensureBlueprintForCampaign (campaign create) failed for ${campaignId} (non-blocking):`, err?.message || err);
        });
        if (generateJdQuestionsInBackground) {
            ensureJdInterviewQuestions(campaignId).catch((err) => {
                console.error(`⚠️ ensureJdInterviewQuestions (campaign create) failed for ${campaignId} (non-blocking):`, err?.message || err);
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

        // Read-through cache (Phase 5): campaign display metadata changes rarely.
        // Keyed by org + the requested id set; 30s TTL, no explicit invalidation —
        // brief staleness of display fields is acceptable. No-op without Redis.
        const orgId = getOrgId(req);
        const cacheKey = `campaigns-batch:${orgId}:${[...ids].sort().join(',')}`;
        const data = await cacheGetOrSet(cacheKey, 30, async () => {
            const campaigns = await RecruitmentCampaign.find(
                orgScopedQuery(req, { campaignId: { $in: ids } })
            )
                .select('campaignId criteria jobAdvertisement jobDescription interviewType templateType templateName status closedAt createdAt updatedAt')
                .lean();
            return campaigns.map((c) => ({
                campaignId: c.campaignId,
                criteria: c.criteria,
                jobAdvertisement: c.jobAdvertisement,
                jobDescription: c.jobDescription,
                interviewType: c.interviewType,
                templateType: c.templateType,
                templateName: c.templateName,
                status: c.status || 'active',
                closedAt: c.closedAt || null,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            }));
        });

        res.json({ success: true, data });
    } catch (error: any) {
        console.error('❌ Error batch-fetching recruitment campaigns:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch recruitment campaigns',
            message: error.message,
        });
    }
});

/**
 * GET /api/recruitment-campaigns/shareable
 *
 * The campaigns a Head Hunter video invitation may be attached to.
 *
 * ⚠️ Must be declared BEFORE `/:campaignId`, or Express matches "shareable" as
 * a campaign id.
 *
 * Why a dedicated route rather than an ids-less branch on `GET /`:
 *   * that route's 400 on a missing `ids` is a live guard — `RecentInterviewsCard`
 *     calls it with no empty-array check, so an ids-less branch would turn a
 *     harmless 400 into a full-organization download the caller then indexes as
 *     "the ids I asked for";
 *   * its 30s cache has no invalidation (its own comment says so), and
 *     create-a-campaign-then-pick-it is the primary flow here;
 *   * its projection ships the whole `criteria` object per row.
 *
 * The projection below is narrow but keeps EXACTLY the shape the frontend's
 * `resolveTitleFromMeta` already consumes, so no third mirror of "what a
 * campaign is called" is introduced.
 *
 * `formBinding` present = a screening-form campaign, whose form validation the
 * short video intake cannot satisfy (it collects neither `skills` nor a CV).
 * Those are excluded here and refused again at `/sourcing-context`.
 */
router.get(
    '/shareable',
    conditionalRequireAuth(),
    requirePermission('campaign.read'),
    async (req: Request, res: Response) => {
        try {
            const LIMIT = 200;
            const rows = await RecruitmentCampaign.find(
                orgScopedQuery(req, {
                    status: { $ne: 'closed' },
                    formBinding: { $exists: false },
                })
            )
                .select(
                    'campaignId criteria.position criteria.position_applied_for criteria.job templateName interviewType status createdAt'
                )
                .sort({ createdAt: -1 })
                .limit(LIMIT + 1)
                .lean();

            const hasMore = rows.length > LIMIT;
            const page = rows.slice(0, LIMIT);

            /*
             * 🔴 The language of an interview belongs to the JOB, not to whoever
             * copies its link.
             *
             * The share link used to carry the recruiter's UI language, so a
             * recruiter browsing in English sent an English interview — measured
             * 2026-09-18: `session.language="en"` against a blueprint whose
             * anchors are Arabic. The agent then translated an Arabic instrument
             * turn by turn. And there is nothing to translate TO: all 54 locked
             * blueprints in production are `ar`; not one is English.
             *
             * So the language travels with the campaign, from the only record
             * that states it. A campaign whose blueprint has not locked yet
             * reports none, and the link then omits the parameter entirely
             * rather than inventing one — the server and the agent already have
             * their own fallbacks for that.
             */
            const languageByCampaign = new Map<string, string>();
            if (page.length > 0) {
                const blueprints = await InterviewBlueprint.find({
                    campaignId: { $in: page.map((c: any) => c.campaignId) },
                    status: 'locked',
                })
                    .select('campaignId language')
                    .lean()
                    .catch(() => [] as any[]);
                for (const b of blueprints as any[]) {
                    if (b?.campaignId && typeof b.language === 'string' && b.language.trim()) {
                        languageByCampaign.set(b.campaignId, b.language.trim());
                    }
                }
            }

            return res.json({
                success: true,
                campaigns: page.map((c: any) => ({
                    campaignId: c.campaignId,
                    criteria: c.criteria || {},
                    templateName: c.templateName || '',
                    interviewType: c.interviewType || '',
                    status: c.status || 'active',
                    createdAt: c.createdAt,
                    language: languageByCampaign.get(c.campaignId) || '',
                })),
                hasMore,
            });
        } catch (error: any) {
            console.error('❌ Error listing shareable campaigns:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to list campaigns',
                message: error.message,
            });
        }
    }
);

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
                jobDescription: campaign.jobDescription,
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
// Closing a campaign turns applicants away, so a signed-out caller must be told
// "sign in" (401) rather than reach RBAC — where an anonymous request inherits the
// default role's permissions and is stopped only by an empty org id, which reads
// as a 404 "campaign not found".
router.patch(
    '/:campaignId/status',
    conditionalRequireAuth(),
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
        defaultUrl: 'https://n8n.evaalo.com/webhook/cceec6bc-9ffc-42ee-bd57-845c7ee04eb0',
        source: 'voice-ai-compare-top',
        wbSource: 'n8n-voice-ai-compare',
    },
    video: {
        field: 'videoAiCompareTopResult',
        envKey: 'N8N_VIDEO_AI_COMPARE_WEBHOOK_URL',
        defaultUrl: 'https://n8n.evaalo.com/webhook/b1a5a3ea-b9be-4d81-b613-48212d0b0be7',
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

