// ============================================
// ملف: services/webhookIdempotency.ts
// الوظيفة: claim/complete/fail لـ ProcessedWebhook + بناء مفاتيح dedupe
// مستقرة لـ n8n عند غياب X-Idempotency-Key.
// ============================================
//
// الاستعمال (n8n stage مثلاً):
//   const key = buildN8nStageIdempotencyKey(req, mode, candidateId);
//   const { duplicate } = await claimWebhook('n8n', key, { mode, candidateId });
//   if (duplicate) return res.status(200).json({ success: true, duplicate: true, ... });
//   try { ...process...; await completeWebhook('n8n', key); }
//   catch (err) { await failWebhook('n8n', key, msg(err)); throw err; }
//
// قاعدة الذهبية:
//   - claimWebhook قبل أي كتابة (Mongo, files).
//   - duplicate دائماً يُعيد 200 بنفس شكل الـ response الناجح حتى لا يكسر retry من المرسل.

import { createHash } from 'crypto';
import type { Request } from 'express';
import ProcessedWebhook, {
    IProcessedWebhook,
    WebhookSource,
} from '../models/ProcessedWebhook.js';

export interface ClaimResult {
    duplicate: boolean;
    record: IProcessedWebhook | null;
    /** True when a failed or stale processing record was reclaimed for retry. */
    reclaimed?: boolean;
}

/** Stale processing records older than this may be reclaimed (Stripe retry safety). */
const PROCESSING_STALE_MS = 15 * 60 * 1000;

function processingStaleSince(record: IProcessedWebhook): number {
    const anchor = record.updatedAt ?? record.firstProcessedAt;
    return Date.now() - anchor.getTime();
}

/**
 * يحاول حجز معالجة جديدة بمفتاح فريد.
 * - duplicate=false  → سجل جديد أو reclaim بعد failed/stale processing.
 * - duplicate=true   → completed already, or still processing (not stale).
 *
 * Failed webhooks MUST be retriable: Stripe replays the same event.id after 500.
 * Returning 200 on duplicate+failed permanently drops the event — fixed here.
 */
export async function claimWebhook(
    source: WebhookSource,
    idempotencyKey: string,
    metadata?: Record<string, unknown>
): Promise<ClaimResult> {
    if (!idempotencyKey) {
        return { duplicate: false, record: null };
    }

    try {
        const record = await ProcessedWebhook.create({
            source,
            idempotencyKey,
            status: 'processing',
            metadata,
            attemptCount: 1,
            firstProcessedAt: new Date(),
        });
        return { duplicate: false, record };
    } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code !== 11000) {
            throw err;
        }

        const existing = await ProcessedWebhook.findOne({ source, idempotencyKey });
        if (!existing) {
            throw err;
        }

        if (existing.status === 'completed') {
            const updated = await ProcessedWebhook.findOneAndUpdate(
                { source, idempotencyKey, status: 'completed' },
                { $inc: { attemptCount: 1 } },
                { new: true },
            );
            return { duplicate: true, record: updated ?? existing };
        }

        if (existing.status === 'failed') {
            const reclaimed = await ProcessedWebhook.findOneAndUpdate(
                { source, idempotencyKey, status: 'failed' },
                {
                    $set: {
                        status: 'processing',
                        lastError: undefined,
                        ...(metadata ? { metadata } : {}),
                    },
                    $inc: { attemptCount: 1 },
                },
                { new: true },
            );
            if (reclaimed) {
                return { duplicate: false, record: reclaimed, reclaimed: true };
            }
        }

        if (existing.status === 'processing' && processingStaleSince(existing) > PROCESSING_STALE_MS) {
            const reclaimed = await ProcessedWebhook.findOneAndUpdate(
                { source, idempotencyKey, status: 'processing' },
                {
                    $set: {
                        status: 'processing',
                        ...(metadata ? { metadata } : {}),
                    },
                    $inc: { attemptCount: 1 },
                },
                { new: true },
            );
            if (reclaimed) {
                return { duplicate: false, record: reclaimed, reclaimed: true };
            }
        }

        const bumped = await ProcessedWebhook.findOneAndUpdate(
            { source, idempotencyKey },
            { $inc: { attemptCount: 1 } },
            { new: true },
        );
        return { duplicate: true, record: bumped ?? existing };
    }
}

export async function completeWebhook(
    source: WebhookSource,
    idempotencyKey: string
): Promise<void> {
    if (!idempotencyKey) return;
    await ProcessedWebhook.updateOne(
        { source, idempotencyKey },
        { $set: { status: 'completed', processedAt: new Date(), lastError: undefined } }
    );
}

export async function failWebhook(
    source: WebhookSource,
    idempotencyKey: string,
    errorMessage: string
): Promise<void> {
    if (!idempotencyKey) return;
    await ProcessedWebhook.updateOne(
        { source, idempotencyKey },
        {
            $set: {
                status: 'failed',
                processedAt: new Date(),
                lastError: errorMessage.slice(0, 2000),
            },
        }
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers لبناء مفاتيح Idempotency
// ────────────────────────────────────────────────────────────────────────────

const VOLATILE_KEYS = new Set([
    'submittedAt',
    'receivedAt',
    'timestamp',
    'currentTime',
    '_id',
]);

/**
 * تسلسل ثابت للـ JSON: ترتيب مفاتيح مرتب + تجاهل الحقول الزمنية المتقلبة.
 * يضمن أن body مكرر يُنتج نفس hash حتى لو اختلف ترتيب الـ keys.
 */
export function stableJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map((v) => stableJson(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
        .filter((k) => !VOLATILE_KEYS.has(k))
        .sort();
    return (
        '{' +
        keys
            .map((k) => JSON.stringify(k) + ':' + stableJson(obj[k]))
            .join(',') +
        '}'
    );
}

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function getHeaderString(req: Request, name: string): string | undefined {
    const raw = req.headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
    if (typeof raw === 'string') return raw.trim() || undefined;
    return undefined;
}

/**
 * مفتاح idempotency لمسارات n8n stage1|2|3.
 * الأولوية:
 *   1. X-Idempotency-Key header  (الموصى به — {{ $execution.id }} من n8n)
 *   2. body.executionId
 *   3. sha256(mode + candidateId + [sessionId for stage1|stage2|stage3] + stableJson(body))   ← fallback أخير
 */
export function buildN8nStageIdempotencyKey(
    req: Request,
    mode: string,
    candidateId: string,
    sessionId = ''
): string {
    const headerKey = getHeaderString(req, 'x-idempotency-key');
    if (headerKey) return `n8n:${mode}:${headerKey}`;

    const body = (req.body || {}) as Record<string, unknown>;
    const executionId =
        typeof body.executionId === 'string' && body.executionId.trim()
            ? body.executionId.trim()
            : undefined;
    if (executionId) return `n8n:${mode}:exec:${executionId}`;

    const hashInput =
        mode === 'stage1' || mode === 'stage2' || mode === 'stage3'
            ? `${mode}|${candidateId}|${sessionId.trim()}|${stableJson(body)}`
            : `${mode}|${candidateId}|${stableJson(body)}`;
    const hash = sha256Hex(hashInput);
    return `n8n:${mode}:hash:${hash}`;
}

/**
 * مفتاح idempotency لـ /webhook/n8n/head-hunter (لا يوجد candidateId).
 */
export function buildHeadHunterIdempotencyKey(req: Request): string {
    const headerKey = getHeaderString(req, 'x-idempotency-key');
    if (headerKey) return `hh:${headerKey}`;

    const qSearchId =
        typeof req.query.searchId === 'string' && req.query.searchId.trim()
            ? req.query.searchId.trim()
            : '';
    const body = (req.body || {}) as Record<string, unknown>;
    const bodySearchId =
        typeof body.searchId === 'string' && body.searchId.trim()
            ? body.searchId.trim()
            : typeof body.search_id === 'string' && body.search_id.trim()
              ? body.search_id.trim()
              : '';
    const searchId = qSearchId || bodySearchId;
    const searchPrefix = searchId ? `search:${searchId}:` : '';

    const executionId =
        typeof body.executionId === 'string' && body.executionId.trim()
            ? body.executionId.trim()
            : undefined;
    if (executionId) return `hh:${searchPrefix}exec:${executionId}`;

    return `hh:${searchPrefix}hash:${sha256Hex(stableJson(body))}`;
}

/**
 * مفتاح idempotency لـ /webhook/n8n/cv-comparison.
 * الأولوية: X-Idempotency-Key؛ وإلا comparisonId + stableJson(body).
 */
export function buildCvComparisonIdempotencyKey(req: Request, comparisonId: string): string {
    const headerKey = getHeaderString(req, 'x-idempotency-key');
    if (headerKey) return `cvcomp:${headerKey}`;

    const body = (req.body || {}) as Record<string, unknown>;
    const hash = sha256Hex(`${comparisonId}|${stableJson(body)}`);
    return `cvcomp:${comparisonId}:hash:${hash}`;
}

/**
 * مفتاح idempotency لـ /webhook/n8n/campaign-compare/stage1|stage2|stage3.
 * الأولوية: X-Idempotency-Key؛ وإلا hash(compareStage + requestId + stableJson(body)).
 */
export function buildCampaignCompareIdempotencyKey(
    req: Request,
    requestId: string,
    compareStage: string,
    body?: Record<string, unknown>
): string {
    const headerKey = getHeaderString(req, 'x-idempotency-key');
    if (headerKey) return `ccmp:${compareStage}:${headerKey}`;

    const payload = body ?? ((req.body || {}) as Record<string, unknown>);
    const hash = sha256Hex(`${compareStage}|${requestId}|${stableJson(payload)}`);
    return `ccmp:${compareStage}:${requestId}:hash:${hash}`;
}

/** Helper لاستخراج رسالة خطأ آمنة (للتسجيل في lastError). */
export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
