/**
 * Durable audit outbox — written in the same Mongo transaction as billing/reveal
 * mutations, then flushed to AuditLog asynchronously after commit.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type AuditOutboxStatus = 'pending' | 'processed' | 'failed';

export interface IAuditOutbox extends Document {
    organizationId: string;
    status: AuditOutboxStatus;
    action: string;
    targetType: string;
    targetId?: string;
    payload: {
        actorClerkUserId?: string;
        actorEmail?: string;
        metadata?: Record<string, unknown>;
        ip?: string;
        userAgent?: string;
    };
    attempts: number;
    lastError?: string;
    processedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AuditOutboxSchema = new Schema<IAuditOutbox>(
    {
        organizationId: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['pending', 'processed', 'failed'],
            required: true,
            default: 'pending',
            index: true,
        },
        action: { type: String, required: true, trim: true },
        targetType: { type: String, required: true, trim: true },
        targetId: { type: String, trim: true },
        payload: {
            type: Schema.Types.Mixed,
            required: true,
            default: () => ({}),
        },
        attempts: { type: Number, required: true, default: 0, min: 0 },
        lastError: { type: String, trim: true },
        processedAt: { type: Date },
    },
    { timestamps: true, collection: 'audit_outbox' },
);

AuditOutboxSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model<IAuditOutbox>('AuditOutbox', AuditOutboxSchema);
