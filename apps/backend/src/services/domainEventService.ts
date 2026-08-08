/**
 * Domain-event bus (Phase 2).
 *
 * Contract:
 *   - enqueueDomainEvent(input, session?) writes a durable outbox row. When a
 *     session is passed it commits ATOMICALLY with the business mutation
 *     (transactional outbox). Idempotent per (organizationId, idempotencyKey).
 *   - dispatchDomainEvent(id) publishes a single row after commit (fire-and-forget).
 *   - processPendingDomainEvents(limit) is the retry sweep (started in server.ts).
 *   - onDomainEvent(listener) subscribes an in-process consumer (audit / analytics /
 *     notifications). In Phase 3 the Redis relay becomes the transport here.
 *
 * Money never depends on this bus: events are side-effect fan-out only.
 */

import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import DomainEventOutbox from '../models/DomainEventOutbox.js';
import OrgEventSequence from '../models/OrgEventSequence.js';

export type DomainEventType =
    | 'CandidateStatusChanged'
    | 'ScreeningEvaluationCompleted'
    | 'VoiceEvaluationCompleted'
    | 'VideoEvaluationCompleted'
    | 'VideoSessionCompleted'
    | 'CompareCompleted'
    | 'CompareFailed'
    | 'CreditsConsumed'
    | 'CreditBalanceRefreshed'
    | 'CandidateApplied'
    | 'HeadHunterSearchCompleted'
    | 'CvComparisonCompleted';

export type EnqueueDomainEventInput = {
    organizationId: string;
    type: DomainEventType;
    payload?: Record<string, unknown>;
    /** Payload contract version for this event type (default 1). */
    schemaVersion?: number;
    /** Stable key so a retried mutation does not emit the same event twice. */
    idempotencyKey: string;
    occurredAt?: Date;
};

export type PublishedDomainEvent = {
    outboxId: string;
    organizationId: string;
    type: string;
    schemaVersion: number;
    seq: number;
    payload: Record<string, unknown>;
    occurredAt: Date;
};

const MAX_ATTEMPTS = 10;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

/** Subscribe an in-process consumer. Listeners MUST NOT throw (they are isolated). */
export function onDomainEvent(listener: (evt: PublishedDomainEvent) => void): void {
    emitter.on('domainEvent', (evt: PublishedDomainEvent) => {
        try {
            listener(evt);
        } catch (err) {
            console.warn('[domainEvent] consumer threw (ignored):', (err as Error).message);
        }
    });
}

function isDuplicateKeyError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
    );
}

/** Atomic per-org sequence. Participates in the caller's transaction when given. */
async function nextOrgSeq(
    organizationId: string,
    session?: mongoose.ClientSession,
): Promise<number> {
    const doc = await OrgEventSequence.findOneAndUpdate(
        { organizationId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, ...(session ? { session } : {}) },
    ).exec();
    return doc.seq;
}

/**
 * Enqueue a durable domain event. Returns null only if a duplicate row could not
 * be re-read. Never throws for the duplicate case (idempotent).
 */
export async function enqueueDomainEvent(
    input: EnqueueDomainEventInput,
    session?: mongoose.ClientSession,
): Promise<{ outboxId: string; seq: number; duplicate: boolean } | null> {
    try {
        const seq = await nextOrgSeq(input.organizationId, session);
        const created = await DomainEventOutbox.create(
            [
                {
                    organizationId: input.organizationId,
                    type: input.type,
                    schemaVersion: input.schemaVersion ?? 1,
                    seq,
                    payload: input.payload || {},
                    idempotencyKey: input.idempotencyKey,
                    occurredAt: input.occurredAt || new Date(),
                    status: 'pending',
                },
            ],
            session ? { session } : {},
        );
        return { outboxId: String(created[0]._id), seq, duplicate: false };
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            const dup = await DomainEventOutbox.findOne({
                organizationId: input.organizationId,
                idempotencyKey: input.idempotencyKey,
            }).lean();
            return dup ? { outboxId: String(dup._id), seq: dup.seq, duplicate: true } : null;
        }
        throw err;
    }
}

/**
 * Best-effort emit for NON-transactional call sites: enqueue then dispatch, never
 * throwing back into the business flow. A lost enqueue is recovered by the sweep
 * only if it committed; a pre-commit crash simply means the client refetches.
 */
export async function emitDomainEventBestEffort(input: EnqueueDomainEventInput): Promise<void> {
    try {
        const res = await enqueueDomainEvent(input);
        if (res && !res.duplicate) {
            void dispatchDomainEvent(res.outboxId);
        }
    } catch (err) {
        console.warn('[domainEvent] best-effort emit failed (ignored):', (err as Error).message);
    }
}

async function publishOne(outboxId: string): Promise<void> {
    const row = await DomainEventOutbox.findById(outboxId);
    if (!row || row.status === 'published') return;
    try {
        emitter.emit('domainEvent', {
            outboxId: String(row._id),
            organizationId: row.organizationId,
            type: row.type,
            schemaVersion: row.schemaVersion ?? 1,
            seq: row.seq,
            payload: (row.payload as Record<string, unknown>) || {},
            occurredAt: row.occurredAt,
        } satisfies PublishedDomainEvent);
        row.status = 'published';
        row.publishedAt = new Date();
        await row.save();
    } catch (err) {
        row.attempts += 1;
        row.lastError = (err as Error).message;
        if (row.attempts >= MAX_ATTEMPTS) row.status = 'failed';
        await row.save();
    }
}

/** Fire-and-forget publish of a freshly-committed event. */
export async function dispatchDomainEvent(outboxId: string): Promise<void> {
    void publishOne(outboxId).catch((err) =>
        console.warn('[domainEvent] dispatch failed:', (err as Error)?.message || err),
    );
}

/** Retry sweep — republishes pending/failed rows. Returns how many it processed. */
export async function processPendingDomainEvents(limit = 20): Promise<number> {
    const rows = await DomainEventOutbox.find({
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: MAX_ATTEMPTS },
    })
        .sort({ createdAt: 1 })
        .limit(limit)
        .select('_id')
        .lean();

    for (const r of rows) {
        await publishOne(String(r._id));
    }
    return rows.length;
}
