/**
 * Append-only credit ledger — audit trail for every balance change.
 * Amounts are in microCredits (signed: negative for consumption, positive for grants).
 * Idempotency: unique compound index on (organizationId, idempotencyKey).
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { LedgerSource, UsageType } from '../types/billing.js';

export interface ICreditLedger extends Document {
    organizationId: string;
    usageType?: UsageType;
    /** Signed microCredits delta applied to the balance. */
    amountMicro: number;
    balanceBeforeMicro: number;
    balanceAfterMicro: number;
    /** Raw units billed (seconds for interviews, count for per-operation usage). */
    units?: number;
    /** Optional real provider cost (USD) captured for monitoring/reconciliation. */
    providerCost?: number;
    source: LedgerSource;
    sourceId?: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    /** Video interview audit fields (source = 'video_interview'). */
    videoSessionId?: string;
    /** Total billed seconds of the video session (included + credit-paid). */
    totalVideoSeconds?: number;
    /** Seconds covered by the plan's included video allowance (free). */
    includedVideoSecondsUsed?: number;
    /** Seconds covered by purchased extra video packs. */
    purchasedVideoSecondsUsed?: number;
    /** Seconds charged against the credit balance (legacy; 0 under the pack model). */
    creditVideoSeconds?: number;
    /** microCredits actually deducted for the credit-paid portion (may be 0). */
    chargedMicroCredits?: number;
    createdAt: Date;
    updatedAt: Date;
}

const CreditLedgerSchema = new Schema<ICreditLedger>(
    {
        organizationId: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        usageType: {
            type: String,
            enum: [
                'VOICE_SECONDS',
                'VIDEO_SECONDS',
                'SEARCH_CANDIDATE',
                'SCREENING',
                'TOP_CANDIDATES',
                'CV_ANALYSIS',
                'JOB_AD',
                'CONTACT_REVEAL',
                'COMPARE_EMAIL',
            ],
        },
        amountMicro: { type: Number, required: true },
        balanceBeforeMicro: { type: Number, required: true, min: 0 },
        balanceAfterMicro: { type: Number, required: true, min: 0 },
        units: { type: Number },
        providerCost: { type: Number },
        source: {
            type: String,
            required: true,
            enum: [
                'video_interview',
                'voice_ws',
                'headhunter',
                'contact_reveal',
                'ai_compare_email',
                'cv_analysis',
                'job_ad',
                'manual_adjustment',
                'monthly_refresh',
                'topup',
                'video_pack',
            ],
        },
        sourceId: { type: String, trim: true },
        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
        },
        metadata: { type: Schema.Types.Mixed },
        // Video interview audit fields (source = 'video_interview').
        videoSessionId: { type: String, trim: true, index: true },
        totalVideoSeconds: { type: Number, min: 0 },
        includedVideoSecondsUsed: { type: Number, min: 0 },
        purchasedVideoSecondsUsed: { type: Number, min: 0 },
        creditVideoSeconds: { type: Number, min: 0 },
        chargedMicroCredits: { type: Number, min: 0 },
    },
    { timestamps: true, collection: 'credit_ledger' },
);

CreditLedgerSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
CreditLedgerSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.model<ICreditLedger>('CreditLedger', CreditLedgerSchema);
