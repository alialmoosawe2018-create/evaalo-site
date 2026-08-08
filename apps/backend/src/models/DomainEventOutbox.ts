/**
 * Durable domain-event outbox — generalization of the Stage1/Audit outbox pattern.
 *
 * A DomainEvent is enqueued (ideally in the same transaction as its business
 * mutation), then relayed asynchronously to in-process consumers today and to
 * Redis pub/sub once realtime (Phase 3) lands. Rows are retained after publish so
 * a reconnecting client can replay events with `seq > lastAckedSeq`.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type DomainEventStatus = 'pending' | 'published' | 'failed';

export interface IDomainEventOutbox extends Document {
    organizationId: string;
    /** Past-tense domain fact, e.g. 'CandidateStatusChanged'. */
    type: string;
    /** Payload contract version for this event type (lets payloads evolve). */
    schemaVersion: number;
    /** Monotonic per-organization sequence — the replay cursor. */
    seq: number;
    payload: Record<string, unknown>;
    status: DomainEventStatus;
    attempts: number;
    lastError?: string;
    /** Unique per (organizationId, idempotencyKey) — dedupes duplicate emits. */
    idempotencyKey: string;
    occurredAt: Date;
    publishedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const DomainEventOutboxSchema = new Schema<IDomainEventOutbox>(
    {
        organizationId: { type: String, required: true, index: true, trim: true },
        type: { type: String, required: true, trim: true },
        schemaVersion: { type: Number, required: true, default: 1 },
        seq: { type: Number, required: true },
        payload: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
        status: {
            type: String,
            enum: ['pending', 'published', 'failed'],
            required: true,
            default: 'pending',
            index: true,
        },
        attempts: { type: Number, required: true, default: 0, min: 0 },
        lastError: { type: String, trim: true },
        idempotencyKey: { type: String, required: true, trim: true },
        occurredAt: { type: Date, required: true, default: Date.now },
        publishedAt: { type: Date },
    },
    { timestamps: true, collection: 'domain_event_outbox' },
);

// Retry sweep scans by status+age.
DomainEventOutboxSchema.index({ status: 1, createdAt: 1 });
// Replay-on-reconnect: per-org ordered scan by seq.
DomainEventOutboxSchema.index({ organizationId: 1, seq: 1 });
// Idempotency gate.
DomainEventOutboxSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.model<IDomainEventOutbox>('DomainEventOutbox', DomainEventOutboxSchema);
