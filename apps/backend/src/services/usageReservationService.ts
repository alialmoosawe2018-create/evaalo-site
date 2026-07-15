/**
 * Usage reservation — validate → reserve headroom → finalize debit → release unused.
 *
 * Prevents concurrent sessions from overspending a shared credit pool by tracking
 * active reservedMicro until finalize or release.
 */

import UsageReservation, { type IUsageReservation } from '../models/UsageReservation.js';
import type { ConsumeCreditsResult, LedgerSource, UsageType } from '../types/billing.js';
import { creditCostMicro } from './billingEngine.js';
import { checkCredits, consumeCredits, getCreditBalance } from './billingRuntimeService.js';

const DEFAULT_TTL_MS = Number(process.env.USAGE_RESERVATION_TTL_MS || 2 * 60 * 60 * 1000);

export type ReserveUsageInput = {
    organizationId: string;
    usageType: UsageType;
    estimatedUnits: number;
    source: string;
    sourceId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    ttlMs?: number;
};

export type ReserveUsageResult =
    | { ok: true; reservationId: string; reservedMicro: number; duplicate?: boolean }
    | { ok: false; code: string; message: string };

export type FinalizeUsageInput = {
    reservationId?: string;
    sourceId?: string;
    organizationId: string;
    actualUnits: number;
    consumeSource: LedgerSource;
    consumeIdempotencyKey: string;
    metadata?: Record<string, unknown>;
};

export type FinalizeUsageResult =
    | {
          ok: true;
          reservationId: string;
          balanceAfterMicro: number;
          ledgerEntryId: string;
          duplicate?: boolean;
      }
    | { ok: false; code: string; message: string };

function isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

async function sumActiveReservedMicro(organizationId: string): Promise<number> {
    const now = new Date();
    const rows = await UsageReservation.aggregate<{ total: number }>([
        {
            $match: {
                organizationId,
                status: 'active',
                expiresAt: { $gt: now },
            },
        },
        { $group: { _id: null, total: { $sum: '$reservedMicro' } } },
    ]).exec();
    return rows[0]?.total ?? 0;
}

async function findReservation(input: {
    reservationId?: string;
    sourceId?: string;
    organizationId: string;
}): Promise<IUsageReservation | null> {
    if (input.reservationId) {
        return UsageReservation.findOne({
            _id: input.reservationId,
            organizationId: input.organizationId,
        }).exec();
    }
    if (input.sourceId) {
        return UsageReservation.findOne({
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            status: { $in: ['active', 'finalized'] },
        })
            .sort({ createdAt: -1 })
            .exec();
    }
    return null;
}

/**
 * Validate entitlements + credit headroom (including other active reservations), then hold a reservation.
 */
export async function reserveUsage(input: ReserveUsageInput): Promise<ReserveUsageResult> {
    const {
        organizationId,
        usageType,
        estimatedUnits,
        source,
        sourceId,
        idempotencyKey,
        metadata,
        ttlMs = DEFAULT_TTL_MS,
    } = input;

    const existing = await UsageReservation.findOne({ organizationId, idempotencyKey }).exec();
    if (existing) {
        if (existing.status === 'active' || existing.status === 'finalized') {
            return {
                ok: true,
                reservationId: String(existing._id),
                reservedMicro: existing.reservedMicro,
                duplicate: true,
            };
        }
        return {
            ok: false,
            code: 'RESERVATION_CLOSED',
            message: `Reservation ${existing.status} — cannot reuse idempotency key`,
        };
    }

    const gate = await checkCredits(organizationId, usageType, estimatedUnits);
    if (!gate.ok) {
        return { ok: false, code: gate.code, message: gate.message };
    }

    const reservedMicro = creditCostMicro(usageType, estimatedUnits);
    if (reservedMicro > 0) {
        const balance = await getCreditBalance(organizationId);
        const remainingMicro = balance?.balanceMicro ?? 0;
        const alreadyReserved = await sumActiveReservedMicro(organizationId);
        if (remainingMicro - alreadyReserved < reservedMicro) {
            return {
                ok: false,
                code: 'INSUFFICIENT_CREDITS',
                message: 'Insufficient credits (active reservations)',
            };
        }
    }

    const expiresAt = new Date(Date.now() + Math.max(60_000, ttlMs));

    try {
        const doc = await UsageReservation.create({
            organizationId,
            usageType,
            status: 'active',
            estimatedUnits,
            reservedMicro,
            source,
            sourceId,
            idempotencyKey,
            metadata,
            expiresAt,
        });
        return {
            ok: true,
            reservationId: String(doc._id),
            reservedMicro,
        };
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            const dup = await UsageReservation.findOne({ organizationId, idempotencyKey }).exec();
            if (dup) {
                return {
                    ok: true,
                    reservationId: String(dup._id),
                    reservedMicro: dup.reservedMicro,
                    duplicate: true,
                };
            }
        }
        throw err;
    }
}

/**
 * Finalize a reservation — debit actual usage via consumeCredits, mark reservation finalized.
 */
export async function finalizeUsageReservation(
    input: FinalizeUsageInput,
): Promise<FinalizeUsageResult> {
    const reservation = await findReservation(input);
    if (!reservation) {
        return { ok: false, code: 'RESERVATION_NOT_FOUND', message: 'Usage reservation not found' };
    }

    if (reservation.status === 'finalized' && reservation.ledgerEntryId) {
        return {
            ok: true,
            reservationId: String(reservation._id),
            balanceAfterMicro: 0,
            ledgerEntryId: reservation.ledgerEntryId,
            duplicate: true,
        };
    }

    if (reservation.status !== 'active') {
        return {
            ok: false,
            code: 'RESERVATION_NOT_ACTIVE',
            message: `Reservation is ${reservation.status}`,
        };
    }

    const actualUnits = Math.max(0, Math.floor(input.actualUnits));
    let consumeResult: ConsumeCreditsResult;

    if (actualUnits <= 0) {
        reservation.status = 'finalized';
        reservation.actualUnits = 0;
        reservation.finalizedAt = new Date();
        reservation.ledgerEntryId = 'noop';
        await reservation.save();
        return {
            ok: true,
            reservationId: String(reservation._id),
            balanceAfterMicro: 0,
            ledgerEntryId: 'noop',
        };
    }

    consumeResult = await consumeCredits({
        organizationId: input.organizationId,
        usageType: reservation.usageType,
        units: actualUnits,
        idempotencyKey: input.consumeIdempotencyKey,
        source: input.consumeSource,
        sourceId: reservation.sourceId,
        metadata: {
            ...(reservation.metadata ?? {}),
            ...(input.metadata ?? {}),
            reservationId: String(reservation._id),
            estimatedUnits: reservation.estimatedUnits,
            actualUnits,
        },
    });

    if (!consumeResult.ok) {
        return {
            ok: false,
            code: consumeResult.code,
            message: consumeResult.message,
        };
    }

    reservation.status = 'finalized';
    reservation.actualUnits = actualUnits;
    reservation.finalizedAt = new Date();
    reservation.ledgerEntryId = consumeResult.ledgerEntryId;
    await reservation.save();

    return {
        ok: true,
        reservationId: String(reservation._id),
        balanceAfterMicro: consumeResult.balanceAfterMicro,
        ledgerEntryId: consumeResult.ledgerEntryId,
        duplicate: consumeResult.duplicate,
    };
}

/** Release an active reservation without billing (session cancelled / never started). */
export async function releaseUsageReservation(input: {
    reservationId?: string;
    sourceId?: string;
    organizationId: string;
    reason?: string;
}): Promise<{ ok: boolean; reservationId?: string }> {
    const reservation = await findReservation(input);
    if (!reservation || reservation.status !== 'active') {
        return { ok: false };
    }
    reservation.status = 'released';
    reservation.releasedAt = new Date();
    if (input.reason) {
        reservation.metadata = { ...(reservation.metadata ?? {}), releaseReason: input.reason };
    }
    await reservation.save();
    return { ok: true, reservationId: String(reservation._id) };
}

/** Mark expired active reservations (maintenance / reconciliation). */
export async function expireStaleReservations(organizationId?: string): Promise<number> {
    const now = new Date();
    const filter: Record<string, unknown> = { status: 'active', expiresAt: { $lte: now } };
    if (organizationId) filter.organizationId = organizationId;
    const result = await UsageReservation.updateMany(filter, {
        $set: { status: 'expired' },
    }).exec();
    return result.modifiedCount ?? 0;
}
