/**
 * CreditBalanceRepository — the ONLY place that issues Mongo IO for credit_balances.
 *
 * Every method is org-scoped and session-aware so the billing service can compose
 * them inside a transaction. The SERVICE owns transactions, idempotency policy, and
 * ledger/domain events; this layer owns raw persistence. That split is the seam that
 * makes a future datastore swap (e.g. ledger → Postgres) a repository change rather
 * than a service rewrite (architecture plan Phase 1).
 */

import mongoose from 'mongoose';
import CreditBalance, { type ICreditBalance } from '../models/CreditBalance.js';

type Session = mongoose.ClientSession | undefined;
const opt = (s: Session) => (s ? { session: s } : {});

/** Live balance row for an org (or null when billing isn't seeded yet). */
export async function getByOrg(
    organizationId: string,
    session?: Session,
): Promise<ICreditBalance | null> {
    return CreditBalance.findOne({ organizationId }, null, opt(session)).exec();
}

/**
 * Atomic compare-and-decrement guarded by `balanceMicro >= costMicro`.
 * Returns the post-decrement balance, or null when there weren't enough credits.
 * This single-document CAS is what makes the balance safe under concurrency.
 */
export async function decrementIfSufficient(
    organizationId: string,
    costMicro: number,
    session?: Session,
): Promise<number | null> {
    const updated = await CreditBalance.findOneAndUpdate(
        { organizationId, balanceMicro: { $gte: costMicro } },
        { $inc: { balanceMicro: -costMicro } },
        { new: true, ...opt(session) },
    ).exec();
    return updated ? updated.balanceMicro : null;
}

/** Unconditional balance delta — used to compensate a failed ledger write. */
export async function incrementMicro(
    organizationId: string,
    deltaMicro: number,
    session?: Session,
): Promise<void> {
    await CreditBalance.updateOne(
        { organizationId },
        { $inc: { balanceMicro: deltaMicro } },
        opt(session),
    ).exec();
}

/**
 * Signed adjust; deductions are guarded so the balance can never go negative under
 * concurrency. Returns the post-adjust balance, or null when a deduction was blocked.
 */
export async function adjustGuarded(
    organizationId: string,
    amountMicro: number,
    session?: Session,
): Promise<number | null> {
    const filter =
        amountMicro < 0
            ? { organizationId, balanceMicro: { $gte: -amountMicro } }
            : { organizationId };
    const updated = await CreditBalance.findOneAndUpdate(
        filter,
        { $inc: { balanceMicro: amountMicro } },
        { new: true, ...opt(session) },
    ).exec();
    return updated ? updated.balanceMicro : null;
}

/**
 * Atomically hold reservation headroom: increments `reservedMicro` ONLY if the
 * available headroom (`balanceMicro - reservedMicro`) covers `micro`. This single
 * `$expr`-guarded update is what closes the reservation TOCTOU — two concurrent
 * reserves cannot both pass. Returns true when the hold was placed.
 */
export async function reserveHeadroom(
    organizationId: string,
    micro: number,
    session?: Session,
): Promise<boolean> {
    if (micro <= 0) return true;
    const updated = await CreditBalance.findOneAndUpdate(
        {
            organizationId,
            $expr: {
                $gte: [{ $subtract: ['$balanceMicro', { $ifNull: ['$reservedMicro', 0] }] }, micro],
            },
        },
        { $inc: { reservedMicro: micro } },
        { new: true, ...opt(session) },
    ).exec();
    return updated != null;
}

/** Release a previously-held reservation (finalize / release / expire). Floors at 0
 *  via a pipeline update so double-release or drift can never go negative. */
export async function releaseHeadroom(
    organizationId: string,
    micro: number,
    session?: Session,
): Promise<void> {
    if (micro <= 0) return;
    await CreditBalance.updateOne(
        { organizationId },
        [
            {
                $set: {
                    reservedMicro: {
                        $max: [0, { $subtract: [{ $ifNull: ['$reservedMicro', 0] }, micro] }],
                    },
                },
            },
        ],
        opt(session),
    ).exec();
}

/** Set the reservedMicro counter to an authoritative value (reconciliation). */
export async function setReservedMicro(
    organizationId: string,
    micro: number,
    session?: Session,
): Promise<void> {
    await CreditBalance.updateOne(
        { organizationId },
        { $set: { reservedMicro: Math.max(0, Math.floor(micro)) } },
        opt(session),
    ).exec();
}

/** Grant persisted (video packs) — separate from the credit balance. */
export async function addPurchasedVideoSeconds(
    organizationId: string,
    seconds: number,
): Promise<void> {
    await CreditBalance.updateOne(
        { organizationId },
        { $inc: { purchasedVideoSeconds: seconds } },
        { upsert: false },
    ).exec();
}

/** Upsert the period snapshot (seed / refresh / Stripe events). Returns the row. */
export async function upsertPeriod(
    organizationId: string,
    set: Record<string, unknown>,
    opts: { unset?: Record<string, unknown>; setDefaultsOnInsert?: boolean; session?: Session } = {},
): Promise<ICreditBalance | null> {
    const update: Record<string, unknown> = { $set: set };
    if (opts.unset) update.$unset = opts.unset;
    return CreditBalance.findOneAndUpdate({ organizationId }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: opts.setDefaultsOnInsert ?? true,
        ...opt(opts.session),
    }).exec();
}

/** In-place field update (no upsert) — e.g. plan-change catalog sync. */
export async function setFields(
    organizationId: string,
    set: Record<string, unknown>,
    session?: Session,
): Promise<void> {
    await CreditBalance.updateOne({ organizationId }, { $set: set }, opt(session)).exec();
}

/** Raw driver read used to detect the legacy pre-unified balance shape. */
export async function rawFindProjected(
    organizationId: string,
    projection: Record<string, 0 | 1>,
): Promise<Record<string, unknown> | null> {
    return CreditBalance.collection.findOne(
        { organizationId },
        { projection },
    ) as Promise<Record<string, unknown> | null>;
}
