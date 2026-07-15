/**
 * Usage reservation — holds estimated credit headroom while a billable session runs.
 * Finalize debits actual usage; release cancels without charge.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { LedgerSource, UsageType } from '../types/billing.js';

export type UsageReservationStatus =
    | 'active'
    | 'finalized'
    | 'released'
    | 'expired';

export interface IUsageReservation extends Document {
    organizationId: string;
    usageType: UsageType;
    status: UsageReservationStatus;
    /** Estimated units reserved at start (seconds or operation count). */
    estimatedUnits: number;
    /** Actual units billed on finalize (if any). */
    actualUnits?: number;
    /** microCredits held against concurrent headroom while active. */
    reservedMicro: number;
    source: string;
    sourceId: string;
    idempotencyKey: string;
    ledgerEntryId?: string;
    metadata?: Record<string, unknown>;
    expiresAt: Date;
    finalizedAt?: Date;
    releasedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const UsageReservationSchema = new Schema<IUsageReservation>(
    {
        organizationId: { type: String, required: true, index: true, trim: true },
        usageType: {
            type: String,
            required: true,
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
        status: {
            type: String,
            required: true,
            enum: ['active', 'finalized', 'released', 'expired'],
            default: 'active',
            index: true,
        },
        estimatedUnits: { type: Number, required: true, min: 0 },
        actualUnits: { type: Number, min: 0 },
        reservedMicro: { type: Number, required: true, min: 0 },
        source: { type: String, required: true, trim: true },
        sourceId: { type: String, required: true, trim: true, index: true },
        idempotencyKey: { type: String, required: true, trim: true },
        ledgerEntryId: { type: String, trim: true },
        metadata: { type: Schema.Types.Mixed },
        expiresAt: { type: Date, required: true, index: true },
        finalizedAt: { type: Date },
        releasedAt: { type: Date },
    },
    { timestamps: true, collection: 'usage_reservations' },
);

UsageReservationSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
UsageReservationSchema.index({ organizationId: 1, status: 1, expiresAt: 1 });

export default mongoose.model<IUsageReservation>('UsageReservation', UsageReservationSchema);
