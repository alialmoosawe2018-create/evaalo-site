/**
 * CreditLedgerRepository — the ONLY place that issues Mongo IO for credit_ledger.
 *
 * The ledger is append-only; idempotency is enforced by the unique
 * (organizationId, idempotencyKey) index. The SERVICE decides WHEN to write and
 * inside which transaction; this layer performs the write. Session-aware so a
 * ledger row commits atomically with the balance change and the domain event.
 */

import mongoose from 'mongoose';
import CreditLedger, { type ICreditLedger } from '../models/CreditLedger.js';

type Session = mongoose.ClientSession | undefined;
const opt = (s: Session) => (s ? { session: s } : {});

/** Idempotency lookup — returns the prior row when this key was already applied. */
export async function findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
    session?: Session,
): Promise<ICreditLedger | null> {
    return CreditLedger.findOne({ organizationId, idempotencyKey }, null, opt(session)).exec();
}

/** Append one ledger row (array form so a session can participate). */
export async function create(
    doc: Record<string, unknown>,
    session?: Session,
): Promise<ICreditLedger> {
    const created = await CreditLedger.create([doc], opt(session));
    return created[0];
}

/** Generic lean lookup (seed/reconcile detection). */
export async function findOneLean(
    query: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
    return CreditLedger.findOne(query).lean().exec() as Promise<Record<string, unknown> | null>;
}

/** Lean list for the activity feed (plain rows, read-only). */
export async function list(
    query: Record<string, unknown>,
    opts: { sort?: Record<string, 1 | -1>; limit?: number } = {},
): Promise<ICreditLedger[]> {
    let q = CreditLedger.find(query);
    if (opts.sort) q = q.sort(opts.sort);
    if (opts.limit) q = q.limit(opts.limit);
    return q.lean().exec() as unknown as ICreditLedger[];
}
