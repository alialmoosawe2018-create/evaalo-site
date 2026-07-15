// ============================================
// ملف: models/ProcessedWebhook.ts
// الوظيفة: idempotency ledger لـ webhooks (Clerk + n8n).
// السطر الواحد: قبل أي معالجة، نطالب بمفتاح فريد عبر claimWebhook؛
// لو مكرر → نُعيد 200 بدون آثار جانبية (لا appendWebhookFiles، لا upsert).
// ============================================
//
// مفاتيح الـ source المدعومة:
//   - 'clerk'           : يستخدم svix-id header
//   - 'n8n'             : يستخدم X-Idempotency-Key | body.executionId | sha256 fallback
//   - 'n8n-head-hunter'   : نفس الترتيب لمسار /webhook/n8n/head-hunter
//   - 'n8n-cv-comparison' : مسار /webhook/n8n/cv-comparison
//   - 'stripe'            : يستخدم Stripe event.id (unique guaranteed)
//
// TTL: 30 يومًا (مناسب لشبّاك retry من Clerk + n8n + Stripe معاً).

import mongoose, { Schema, Document } from 'mongoose';

export type WebhookSource =
    | 'clerk'
    | 'n8n'
    | 'n8n-head-hunter'
    | 'n8n-screening-ai-compare'
    | 'n8n-voice-ai-compare'
    | 'n8n-video-ai-compare'
    | 'n8n-campaign-compare'
    | 'n8n-cv-comparison'
    | 'stripe';
export type ProcessedWebhookStatus = 'processing' | 'completed' | 'failed';

export interface IProcessedWebhook extends Document {
    source: WebhookSource;
    idempotencyKey: string;
    status: ProcessedWebhookStatus;
    metadata?: Record<string, unknown>;
    /** كم مرة وصل نفس المفتاح (1 عند الأصل، يزيد عند duplicate). */
    attemptCount: number;
    /** آخر رسالة فشل عند failWebhook (يساعد التشخيص). */
    lastError?: string;
    /** أول مرة تم فيها قبول هذا المفتاح. */
    firstProcessedAt: Date;
    /** آخر تحديث لحالة المعالجة (complete/fail). */
    processedAt?: Date;
    /** TTL — يحذفه Mongo تلقائيًا بعد 30 يوم. */
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const ProcessedWebhookSchema = new Schema<IProcessedWebhook>(
    {
        source: {
            type: String,
            required: true,
            enum: [
                'clerk',
                'n8n',
                'n8n-head-hunter',
                'n8n-screening-ai-compare',
                'n8n-voice-ai-compare',
                'n8n-video-ai-compare',
                'n8n-campaign-compare',
                'n8n-cv-comparison',
                'stripe',
            ],
            index: true,
        },
        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            required: true,
            enum: ['processing', 'completed', 'failed'],
            default: 'processing',
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: undefined,
        },
        attemptCount: {
            type: Number,
            required: true,
            default: 1,
            min: 1,
        },
        lastError: {
            type: String,
            default: undefined,
        },
        firstProcessedAt: {
            type: Date,
            required: true,
            default: () => new Date(),
        },
        processedAt: {
            type: Date,
            default: undefined,
        },
        expiresAt: {
            type: Date,
            required: true,
            default: () => new Date(Date.now() + TTL_MS),
        },
    },
    {
        timestamps: true,
        collection: 'processed_webhooks',
    }
);

// Idempotency: نفس (source + key) لا يجوز أن يتكرر — هذا هو ضامن dedupe.
ProcessedWebhookSchema.index({ source: 1, idempotencyKey: 1 }, { unique: true });
// TTL — Mongo يحذف السجلات التي تجاوزت expiresAt تلقائياً.
ProcessedWebhookSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IProcessedWebhook>('ProcessedWebhook', ProcessedWebhookSchema);
