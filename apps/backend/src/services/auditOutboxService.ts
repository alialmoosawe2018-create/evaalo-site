/**
 * Durable audit outbox — enqueue inside Mongo transactions, flush after commit.
 */

import type { ClientSession } from 'mongoose';
import AuditOutbox from '../models/AuditOutbox.js';
import AuditLog from '../models/AuditLog.js';

export interface AuditOutboxEnqueueInput {
    organizationId: string;
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
}

export async function enqueueAuditOutbox(
    input: AuditOutboxEnqueueInput,
    session?: ClientSession,
): Promise<string> {
    const opts = session ? { session } : {};
    const [doc] = await AuditOutbox.create(
        [
            {
                organizationId: input.organizationId,
                status: 'pending',
                action: input.action,
                targetType: input.targetType,
                targetId: input.targetId,
                payload: input.payload,
                attempts: 0,
            },
        ],
        opts,
    );
    return String(doc._id);
}

export async function flushAuditOutboxEntry(outboxId: string): Promise<void> {
    const entry = await AuditOutbox.findById(outboxId).exec();
    if (!entry || entry.status === 'processed') return;

    try {
        await AuditLog.create({
            organizationId: entry.organizationId,
            actorClerkUserId: entry.payload.actorClerkUserId,
            actorEmail: entry.payload.actorEmail,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            metadata: entry.payload.metadata,
            ip: entry.payload.ip,
            userAgent: entry.payload.userAgent,
        });
        entry.status = 'processed';
        entry.processedAt = new Date();
        entry.lastError = undefined;
        await entry.save();
    } catch (err) {
        entry.attempts += 1;
        entry.lastError = err instanceof Error ? err.message : String(err);
        if (entry.attempts >= 5) {
            entry.status = 'failed';
        }
        await entry.save();
        throw err;
    }
}

/** Fire-and-forget flush after the billing/reveal transaction commits. */
export function dispatchAuditOutbox(outboxId: string): void {
    void flushAuditOutboxEntry(outboxId).catch((err) => {
        console.error('[auditOutbox] flush failed:', outboxId, err);
    });
}
