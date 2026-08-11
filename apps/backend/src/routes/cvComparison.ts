import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getOrgId, getClerkUserId } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { logAudit } from '../services/auditService.js';
import { emitDomainEventBestEffort } from '../services/domainEventService.js';
import {
    assertCvComparisonInboundSecretConfigured,
    buildCvComparisonCallbackUrl,
    cvComparisonConfigErrorResponse,
    generateCvComparisonCallbackToken,
    verifyCvComparisonCallbackToken,
    verifyCvComparisonInboundSecret,
    assertCvComparisonOutboundReady,
} from '../services/cvComparisonSecurity.js';
import {
    buildCvComparisonIdempotencyKey,
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
    type ClaimResult,
} from '../services/webhookIdempotency.js';
import {
    optionalCriteriaToPhrases,
    parseOptionalCriteria,
} from '../utils/optionalSearchCriteria.js';
import { consumeCredits, adjustCredits } from '../services/billingRuntimeService.js';
import { creditCostMicro } from '../services/billingEngine.js';

const router = Router();

const BILLING_ENFORCE = process.env.BILLING_ENFORCE !== 'false';

/** استرداد رسم تحليل الـ CV عند فشل الإرسال إلى n8n (idempotent). */
async function refundCvAnalysisCharge(
    organizationId: string,
    comparisonId: string,
    cvCount: number,
    reason: string
): Promise<void> {
    if (cvCount <= 0) return;
    await adjustCredits({
        organizationId,
        amountMicro: creditCostMicro('CV_ANALYSIS', cvCount),
        idempotencyKey: `cv-analysis-refund:${comparisonId}`,
        metadata: { kind: 'cv_analysis_refund', reason, comparisonId, cvCount },
    }).catch((e) =>
        console.warn(
            `[cv-comparison] refund failed comparison=${comparisonId}: ${e?.message || e}`
        )
    );
}

type CvComparisonStatus = 'submitted' | 'completed' | 'failed';

export type CvComparisonRecord = {
    comparisonId: string;
    status: CvComparisonStatus;
    organizationId: string;
    userId: string;
    submittedAt: string;
    callbackToken: string;
    /** CVs billed for this comparison (for refund audit). */
    cvCountCharged?: number;
    receivedAt?: string;
    payload?: unknown;
    errorMessage?: string;
};

const cvComparisonInboundById = new Map<string, CvComparisonRecord>();

const MAX_RECORDS = 200;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LEN = 500;
const MAX_QUERY = 2000;
const MAX_OPTION_LEN = 80;
const MIN_CVS = 2;
const MAX_CV_BYTES = 5 * 1024 * 1024;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

const cvUpload = upload.array('cvs');

type CvComparisonInboundTestOverrides = {
    claimWebhook?: (
        source: Parameters<typeof claimWebhook>[0],
        idempotencyKey: string,
        metadata?: Record<string, unknown>
    ) => Promise<ClaimResult>;
    completeWebhook?: (
        source: Parameters<typeof completeWebhook>[0],
        idempotencyKey: string
    ) => Promise<void>;
    failWebhook?: (
        source: Parameters<typeof failWebhook>[0],
        idempotencyKey: string,
        message: string
    ) => Promise<void>;
};

let inboundTestOverrides: CvComparisonInboundTestOverrides = {};

/** @internal Offline security tests only. */
export function setCvComparisonInboundTestOverrides(
    overrides: CvComparisonInboundTestOverrides | null
): void {
    inboundTestOverrides = overrides ?? {};
}

/** @internal Offline security tests only. */
export function seedCvComparisonRecordForTests(record: CvComparisonRecord): void {
    cvComparisonInboundById.set(record.comparisonId, record);
}

/** @internal Offline security tests only. */
export function clearCvComparisonRecordsForTests(): void {
    cvComparisonInboundById.clear();
}

function clientIp(req: Request): string {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function rateLimitOk(ip: string): boolean {
    const now = Date.now();
    let b = ipBuckets.get(ip);
    if (!b || now > b.resetAt) {
        b = { count: 1, resetAt: now + RATE_WINDOW_MS };
        ipBuckets.set(ip, b);
        return true;
    }
    if (b.count >= RATE_MAX) return false;
    b.count += 1;
    return true;
}

function parseBool(v: unknown): boolean {
    if (v === true) return true;
    if (v === false || v == null) return false;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes';
    }
    return false;
}

function generateComparisonId(): string {
    return `cvcomp_${crypto.randomUUID()}`;
}

function cleanupStaleRecords(): void {
    const now = Date.now();
    for (const [id, rec] of cvComparisonInboundById) {
        const ts = Date.parse(rec.receivedAt || rec.submittedAt);
        if (!Number.isFinite(ts) || now - ts > RECORD_TTL_MS) {
            cvComparisonInboundById.delete(id);
        }
    }
    if (cvComparisonInboundById.size <= MAX_RECORDS) return;
    const sorted = [...cvComparisonInboundById.entries()].sort((a, b) => {
        const ta = Date.parse(a[1].receivedAt || a[1].submittedAt) || 0;
        const tb = Date.parse(b[1].receivedAt || b[1].submittedAt) || 0;
        return ta - tb;
    });
    const excess = sorted.length - MAX_RECORDS;
    for (let i = 0; i < excess; i += 1) {
        cvComparisonInboundById.delete(sorted[i][0]);
    }
}

function isPdfFile(file: Express.Multer.File): boolean {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    return mime === 'application/pdf' || ext === '.pdf';
}

function removeUploadedFiles(files: Express.Multer.File[]): void {
    for (const f of files) {
        if (f.path) {
            fs.unlink(f.path, () => undefined);
        }
    }
}

function pickComparisonId(req: Request, body: unknown): string {
    const q = typeof req.query.comparisonId === 'string' ? req.query.comparisonId.trim() : '';
    if (q) return q;
    if (body != null && typeof body === 'object' && !Array.isArray(body)) {
        const o = body as Record<string, unknown>;
        const fromBody =
            typeof o.comparisonId === 'string'
                ? o.comparisonId.trim()
                : typeof o.comparison_id === 'string'
                  ? o.comparison_id.trim()
                  : '';
        if (fromBody) return fromBody;
    }
    return '';
}

function pickCallbackToken(req: Request): string {
    return typeof req.query.token === 'string' ? req.query.token.trim() : '';
}

function authorizeRecord(req: Request, record: CvComparisonRecord): boolean {
    const orgId = getOrgId(req);
    const userId = getClerkUserId(req);
    return record.organizationId === orgId && record.userId === userId;
}

function isRecordExpired(record: CvComparisonRecord): boolean {
    const ts = Date.parse(record.receivedAt || record.submittedAt);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > RECORD_TTL_MS;
}

async function claimCvComparisonWebhook(
    idempotencyKey: string,
    metadata: Record<string, unknown>
): Promise<ClaimResult> {
    const claimFn = inboundTestOverrides.claimWebhook ?? claimWebhook;
    return claimFn('n8n-cv-comparison', idempotencyKey, metadata);
}

/**
 * POST /webhook/n8n/cv-comparison — استقبال نتائج المقارنة من n8n.
 * التحقق بالترتيب: comparisonId → السجل → token → secret → idempotency → الحفظ.
 */
export async function postCvComparisonN8nInbound(req: Request, res: Response): Promise<void> {
    const comparisonId = pickComparisonId(req, req.body);
    if (!comparisonId) {
        res.status(400).json({ ok: false, error: 'comparisonId is required' });
        return;
    }

    const existing = cvComparisonInboundById.get(comparisonId);
    if (!existing || isRecordExpired(existing)) {
        if (existing) cvComparisonInboundById.delete(comparisonId);
        res.status(404).json({ ok: false, error: 'Unknown comparisonId' });
        return;
    }

    const tokenQ = pickCallbackToken(req);
    if (!verifyCvComparisonCallbackToken(existing.callbackToken, tokenQ)) {
        res.status(401).json({ ok: false, error: 'Invalid or missing callback token' });
        return;
    }

    let inboundSecret: string;
    try {
        inboundSecret = assertCvComparisonInboundSecretConfigured();
    } catch (err) {
        const { status, body } = cvComparisonConfigErrorResponse(err);
        res.status(status).json(body);
        return;
    }

    const h = req.headers['x-cv-comparison-secret'];
    const headerSecret = typeof h === 'string' ? h.trim() : '';
    if (!verifyCvComparisonInboundSecret(inboundSecret, headerSecret)) {
        res.status(401).json({ ok: false, error: 'Invalid or missing X-Cv-Comparison-Secret' });
        return;
    }

    const idempotencyKey = buildCvComparisonIdempotencyKey(req, comparisonId);
    let claimed = false;
    try {
        const claim = await claimCvComparisonWebhook(idempotencyKey, {
            route: '/webhook/n8n/cv-comparison',
            comparisonId,
        });
        if (claim.duplicate) {
            const receivedAt = existing.receivedAt || new Date().toISOString();
            console.log('[cv-comparison] duplicate webhook ignored:', comparisonId);
            res.json({
                ok: true,
                duplicate: true,
                comparisonId,
                receivedAt,
                message: 'Webhook already processed (idempotency)',
                attemptCount: claim.record?.attemptCount,
            });
            return;
        }
        claimed = true;

        const receivedAt = new Date().toISOString();
        const payload = req.body;
        cvComparisonInboundById.set(comparisonId, {
            ...existing,
            status: 'completed',
            receivedAt,
            payload,
        });
        cleanupStaleRecords();

        console.log(`[cv-comparison] inbound completed comparisonId=${comparisonId} status=completed`);

        // Domain event (Phase 4) — lets the client drop its 2.8s result poll.
        void emitDomainEventBestEffort({
            organizationId: existing.organizationId,
            type: 'CvComparisonCompleted',
            payload: { comparisonId, requestedByClerkUserId: existing.userId },
            idempotencyKey: `cv-comparison-done:${comparisonId}`,
        });

        const completeFn = inboundTestOverrides.completeWebhook ?? completeWebhook;
        await completeFn('n8n-cv-comparison', idempotencyKey);
        res.json({
            ok: true,
            comparisonId,
            receivedAt,
            message: 'Payload stored; fetch via GET /api/cv-comparison/last-result?comparisonId=…',
        });
    } catch (err) {
        if (claimed) {
            const failFn = inboundTestOverrides.failWebhook ?? failWebhook;
            await failFn('n8n-cv-comparison', idempotencyKey, wbErrorMessage(err)).catch(
                () => undefined
            );
        }
        console.error('[cv-comparison] inbound handler error:', wbErrorMessage(err));
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
}

/** GET /api/cv-comparison/last-result?comparisonId= */
router.get(
    '/last-result',
    conditionalRequireAuth(),
    requirePermission('cvComparison.compare'),
    (req: Request, res: Response) => {
        const comparisonId =
            typeof req.query.comparisonId === 'string' ? req.query.comparisonId.trim() : '';
        if (!comparisonId) {
            return res.status(400).json({ ok: false, message: 'comparisonId query parameter is required' });
        }

        const record = cvComparisonInboundById.get(comparisonId);
        if (!record || isRecordExpired(record)) {
            if (record) cvComparisonInboundById.delete(comparisonId);
            return res.status(404).json({ ok: false, message: 'Comparison not found' });
        }
        if (!authorizeRecord(req, record)) {
            return res.status(403).json({ ok: false, message: 'Forbidden' });
        }

        const hasData = record.status === 'completed' && record.payload != null;
        return res.json({
            ok: true,
            comparisonId: record.comparisonId,
            status: record.status,
            hasData,
            receivedAt: record.receivedAt ?? null,
            payload: hasData ? record.payload : null,
            errorMessage: record.errorMessage ?? null,
        });
    }
);

/** POST /api/cv-comparison/compare — multipart: criteria (JSON string) + cvs[] */
router.post(
    '/compare',
    conditionalRequireAuth(),
    requirePermission('cvComparison.compare'),
    (req: Request, res: Response) => {
        cvUpload(req, res, async (uploadErr: unknown) => {
            const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];

            if (uploadErr) {
                removeUploadedFiles(files);
                const msg =
                    uploadErr instanceof Error ? uploadErr.message : 'File upload failed';
                return res.status(400).json({ ok: false, message: msg });
            }

            const ip = clientIp(req);
            if (!rateLimitOk(ip)) {
                removeUploadedFiles(files);
                return res.status(429).json({ ok: false, error: 'Too many requests' });
            }

            let outboundConfig;
            try {
                outboundConfig = assertCvComparisonOutboundReady();
            } catch (err) {
                removeUploadedFiles(files);
                const { status, body } = cvComparisonConfigErrorResponse(err);
                return res.status(status).json(body);
            }

            const { webhookUrl, inboundSecret, publicApiBase } = outboundConfig;

            let criteria: Record<string, unknown> = {};
            try {
                const raw =
                    typeof req.body?.criteria === 'string'
                        ? req.body.criteria
                        : typeof req.body?.criteria === 'object' && req.body.criteria
                          ? JSON.stringify(req.body.criteria)
                          : '';
                if (raw) criteria = JSON.parse(raw) as Record<string, unknown>;
            } catch {
                removeUploadedFiles(files);
                return res.status(400).json({ ok: false, message: 'Invalid criteria JSON' });
            }

            const position = typeof criteria.position === 'string' ? criteria.position.trim() : '';
            const location = typeof criteria.location === 'string' ? criteria.location.trim() : '';
            const rawQuery = typeof criteria.query === 'string' ? criteria.query.trim() : '';

            const aiCompareTop = parseBool(criteria.aiCompareTop);
            const availableEmployeesOnly =
                parseBool(criteria.availableEmployeesOnly) ||
                parseBool(criteria.employeesWithoutPositionsOnly);
            const arabicTranslation = parseBool(criteria.arabicTranslation);
            // UI locale (ar | en | ku). Forwarded to n8n, where it takes absolute priority over
            // content-based detection: an Arabic UI must produce an Arabic analysis even when the
            // position, location and the CVs are all English. Sanitized — it reaches an LLM prompt.
            const language =
                typeof criteria.language === 'string'
                    ? criteria.language.trim().toLowerCase().replace(/[^a-z-]/g, '').slice(0, 8)
                    : '';

            const rawYears =
                typeof criteria.yearsOfExperience === 'string'
                    ? criteria.yearsOfExperience.trim()
                    : '';
            let yearsOfExperience: string | undefined;
            if (rawYears) {
                if (rawYears.length > MAX_OPTION_LEN) {
                    removeUploadedFiles(files);
                    return res.status(400).json({
                        ok: false,
                        message: `yearsOfExperience must be at most ${MAX_OPTION_LEN} characters`,
                    });
                }
                yearsOfExperience = rawYears;
            }

            const rawAge = typeof criteria.ageRange === 'string' ? criteria.ageRange.trim() : '';
            let ageRange: string | undefined;
            if (rawAge) {
                if (rawAge.length > MAX_OPTION_LEN) {
                    removeUploadedFiles(files);
                    return res.status(400).json({
                        ok: false,
                        message: `ageRange must be at most ${MAX_OPTION_LEN} characters`,
                    });
                }
                ageRange = rawAge;
            }

            if (!position || !location) {
                removeUploadedFiles(files);
                return res.status(400).json({
                    ok: false,
                    message: 'position and location are required',
                });
            }
            if (position.length > MAX_LEN || location.length > MAX_LEN) {
                removeUploadedFiles(files);
                return res.status(400).json({
                    ok: false,
                    message: `position and location must be at most ${MAX_LEN} characters`,
                });
            }
            if (rawQuery.length > MAX_QUERY) {
                removeUploadedFiles(files);
                return res.status(400).json({
                    ok: false,
                    message: `query must be at most ${MAX_QUERY} characters`,
                });
            }

            const optionalParse = parseOptionalCriteria(criteria, MAX_LEN);
            if (optionalParse.error) {
                removeUploadedFiles(files);
                return res.status(400).json({ ok: false, message: optionalParse.error });
            }
            const optionalCriteria = optionalParse.criteria;
            const optionsPhrases = optionalCriteriaToPhrases(optionalCriteria);
            const optionsSummaryEn = optionsPhrases.map((p) => p.en).join(' | ');
            const optionsSummaryAr = optionsPhrases.map((p) => p.ar).join(' | ');

            if (files.length < MIN_CVS) {
                removeUploadedFiles(files);
                return res.status(400).json({
                    ok: false,
                    message: `At least ${MIN_CVS} CV files are required`,
                });
            }
            for (const f of files) {
                if (!isPdfFile(f)) {
                    removeUploadedFiles(files);
                    return res.status(400).json({ ok: false, message: 'Only PDF files are allowed' });
                }
                if (f.size > MAX_CV_BYTES) {
                    removeUploadedFiles(files);
                    return res.status(400).json({
                        ok: false,
                        message: `Each CV must be at most ${MAX_CV_BYTES / (1024 * 1024)}MB`,
                    });
                }
            }

            const organizationId = getOrgId(req);
            const userId = getClerkUserId(req);
            const comparisonId = generateComparisonId();
            const submittedAt = new Date().toISOString();
            const callbackToken = generateCvComparisonCallbackToken();

            let callbackUrl: string;
            try {
                callbackUrl = buildCvComparisonCallbackUrl(
                    publicApiBase,
                    comparisonId,
                    callbackToken
                );
            } catch (err) {
                removeUploadedFiles(files);
                const { status, body } = cvComparisonConfigErrorResponse(err);
                return res.status(status).json(body);
            }

            // تحصيل CV_ANALYSIS (2 كردت/سيرة — السعر المعلن في الكتالوج).
            // يُسترد تلقائياً إذا فشل الإرسال إلى n8n أدناه.
            const cvCount = files.length;
            let cvAnalysisChargedUnits = 0;
            if (BILLING_ENFORCE) {
                const billing = await consumeCredits({
                    organizationId,
                    usageType: 'CV_ANALYSIS',
                    units: cvCount,
                    idempotencyKey: `cv-analysis:${comparisonId}`,
                    source: 'cv_analysis',
                    sourceId: comparisonId,
                    metadata: { position, cvCount },
                });
                if (!billing.ok) {
                    removeUploadedFiles(files);
                    const status = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 403;
                    return res.status(status).json({
                        ok: false,
                        error: billing.code,
                        message: billing.message,
                    });
                }
                cvAnalysisChargedUnits = billing.duplicate ? 0 : cvCount;
            }

            cvComparisonInboundById.set(comparisonId, {
                comparisonId,
                status: 'submitted',
                organizationId,
                userId,
                submittedAt,
                callbackToken,
                cvCountCharged: cvAnalysisChargedUnits || undefined,
            });
            cleanupStaleRecords();

            const criteriaPayload = {
                position,
                location,
                ...(yearsOfExperience ? { yearsOfExperience } : {}),
                ...(ageRange ? { ageRange } : {}),
                ...(rawQuery ? { query: rawQuery } : {}),
                aiCompareTop,
                availableEmployeesOnly,
                employeesWithoutPositionsOnly: availableEmployeesOnly,
                arabicTranslation,
                ...(language ? { language } : {}),
                ...optionalCriteria,
                optionsPhrases,
                optionsSummaryEn: optionsSummaryEn || '',
                optionsSummaryAr: optionsSummaryAr || '',
                source: 'ai-cv-comparison',
                submittedAt,
            };

            try {
                const formData = new FormData();
                formData.append('comparisonId', comparisonId);
                formData.append('organizationId', organizationId);
                formData.append('userId', userId);
                formData.append('callbackUrl', callbackUrl);
                formData.append('criteria', JSON.stringify(criteriaPayload));
                formData.append('inboundSecret', inboundSecret);

                for (const key of [
                    'position',
                    'location',
                    'yearsOfExperience',
                    'ageRange',
                    'query',
                    'requiredLanguages',
                    'requiredSkills',
                    'certifications',
                    'company',
                    'gender',
                ] as const) {
                    const v = criteriaPayload[key as keyof typeof criteriaPayload];
                    if (typeof v === 'string' && v) formData.append(key, v);
                }
                formData.append('aiCompareTop', aiCompareTop ? 'true' : 'false');
                formData.append('availableEmployeesOnly', availableEmployeesOnly ? 'true' : 'false');
                formData.append('arabicTranslation', arabicTranslation ? 'true' : 'false');
                if (language) formData.append('language', language);
                formData.append('source', 'ai-cv-comparison');
                formData.append('submittedAt', submittedAt);

                for (const f of files) {
                    const buffer = fs.readFileSync(f.path);
                    const blob = new Blob([buffer], { type: f.mimetype || 'application/pdf' });
                    formData.append('cvs', blob, f.originalname || 'cv.pdf');
                }

                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 60_000);
                const n8nRes = await fetch(webhookUrl, {
                    method: 'POST',
                    body: formData,
                    signal: ctrl.signal,
                });
                clearTimeout(t);

                removeUploadedFiles(files);

                if (!n8nRes.ok) {
                    const text = await n8nRes.text().catch(() => '');
                    console.warn('[cv-comparison] n8n non-OK:', n8nRes.status, text?.slice(0, 200));
                    cvComparisonInboundById.set(comparisonId, {
                        ...cvComparisonInboundById.get(comparisonId)!,
                        status: 'failed',
                        errorMessage: 'n8n webhook returned an error',
                    });
                    if (cvAnalysisChargedUnits > 0) {
                        await refundCvAnalysisCharge(
                            organizationId,
                            comparisonId,
                            cvAnalysisChargedUnits,
                            'n8n_non_ok'
                        );
                    }
                    return res.status(502).json({
                        ok: false,
                        message: 'n8n webhook returned an error',
                        comparisonId,
                        status: 'failed',
                    });
                }

                logAudit(req, {
                    action: 'cvComparison.compare',
                    targetType: 'cvComparison',
                    metadata: {
                        comparisonId,
                        position,
                        location,
                        cvCount: files.length,
                    },
                });

                console.log(
                    `[cv-comparison] submitted comparisonId=${comparisonId} cvCount=${files.length}`
                );

                return res.json({
                    ok: true,
                    comparisonId,
                    status: 'submitted',
                });
            } catch (err: unknown) {
                removeUploadedFiles(files);
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[cv-comparison] fetch error:', msg);
                const existing = cvComparisonInboundById.get(comparisonId);
                if (existing) {
                    cvComparisonInboundById.set(comparisonId, {
                        ...existing,
                        status: 'failed',
                        errorMessage: 'Failed to reach n8n webhook',
                    });
                }
                if (cvAnalysisChargedUnits > 0) {
                    await refundCvAnalysisCharge(
                        organizationId,
                        comparisonId,
                        cvAnalysisChargedUnits,
                        'n8n_unreachable'
                    );
                }
                return res.status(502).json({
                    ok: false,
                    message: 'Failed to reach n8n webhook',
                    comparisonId,
                    status: 'failed',
                });
            }
        });
    }
);

export default router;
