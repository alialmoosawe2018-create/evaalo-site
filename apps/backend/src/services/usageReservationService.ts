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
import * as creditBalanceRepo from '../repositories/creditBalanceRepository.js';

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
    /**
     * When the balance can't cover estimatedUnits, shrink the reservation to
     * what the org can afford instead of failing — callers shorten the session
     * to the granted units. Fails with INSUFFICIENT_CREDITS only below minUnits.
     */
    clampToAvailable?: boolean;
    /** Minimum acceptable units when clamping (default 1). */
    minUnits?: number;
};

export type ReserveUsageResult =
    | {
          ok: true;
          reservationId: string;
          reservedMicro: number;
          /** Units actually reserved (may be < estimatedUnits when clamped). */
          grantedUnits: number;
          duplicate?: boolean;
      }
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
                grantedUnits: existing.estimatedUnits,
                duplicate: true,
            };
        }
        return {
            ok: false,
            code: 'RESERVATION_CLOSED',
            message: `Reservation ${existing.status} — cannot reuse idempotency key`,
        };
    }

    let grantedUnits = Math.max(0, Math.floor(estimatedUnits));
    if (input.clampToAvailable) {
        const perUnitMicro = creditCostMicro(usageType, 1);
        if (perUnitMicro > 0) {
            const balance = await getCreditBalance(organizationId);
            const remainingMicro = balance?.balanceMicro ?? 0;
            const alreadyReserved = balance?.reservedMicro ?? 0;
            const affordableUnits = Math.floor(
                Math.max(0, remainingMicro - alreadyReserved) / perUnitMicro,
            );
            if (affordableUnits < grantedUnits) grantedUnits = affordableUnits;
            const minUnits = Math.max(1, Math.floor(input.minUnits ?? 1));
            if (grantedUnits < minUnits) {
                return {
                    ok: false,
                    code: 'INSUFFICIENT_CREDITS',
                    message: `Insufficient credits for the minimum session (${minUnits} units)`,
                };
            }
        }
    }

    const gate = await checkCredits(organizationId, usageType, grantedUnits);
    if (!gate.ok) {
        return { ok: false, code: gate.code, message: gate.message };
    }

    const reservedMicro = creditCostMicro(usageType, grantedUnits);
    // Atomic headroom hold — the single `$expr`-guarded update that closes the
    // TOCTOU: two concurrent reserves can never both pass the available-headroom
    // check. `reservedMicro` is released on finalize / release / expire.
    if (reservedMicro > 0) {
        const held = await creditBalanceRepo.reserveHeadroom(organizationId, reservedMicro);
        if (!held) {
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
            estimatedUnits: grantedUnits,
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
            grantedUnits,
        };
    } catch (err) {
        // The reservation row failed to persist — release the headroom we just held
        // so the atomic counter never drifts from the actual active reservations.
        if (reservedMicro > 0) {
            await creditBalanceRepo.releaseHeadroom(organizationId, reservedMicro).catch(() => undefined);
        }
        if (isDuplicateKeyError(err)) {
            const dup = await UsageReservation.findOne({ organizationId, idempotencyKey }).exec();
            if (dup) {
                return {
                    ok: true,
                    reservationId: String(dup._id),
                    reservedMicro: dup.reservedMicro,
                    grantedUnits: dup.estimatedUnits,
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
        await creditBalanceRepo
            .releaseHeadroom(input.organizationId, reservation.reservedMicro)
            .catch(() => undefined);
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
    // Release the held headroom — the actual debit already happened via consumeCredits.
    await creditBalanceRepo
        .releaseHeadroom(input.organizationId, reservation.reservedMicro)
        .catch(() => undefined);

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
    await creditBalanceRepo
        .releaseHeadroom(reservation.organizationId, reservation.reservedMicro)
        .catch(() => undefined);
    return { ok: true, reservationId: String(reservation._id) };
}

/**
 * Reconcile the `reservedMicro` counter to the authoritative sum of active
 * reservations. Self-heals rare drift (e.g. a crash between the atomic hold and the
 * reservation write, which drifts conservatively). Run as occasional maintenance;
 * a concurrent reserve is benign and corrected on the next run.
 */
export async function reconcileReservedMicro(organizationId: string): Promise<number> {
    const sum = await sumActiveReservedMicro(organizationId);
    await creditBalanceRepo.setReservedMicro(organizationId, sum);
    return sum;
}

/** Mark expired active reservations (maintenance / reconciliation). */
export async function expireStaleReservations(organizationId?: string): Promise<number> {
    const now = new Date();
    const filter: Record<string, unknown> = { status: 'active', expiresAt: { $lte: now } };
    if (organizationId) filter.organizationId = organizationId;

    // Fetch first, then transition each atomically so the held headroom is released
    // exactly once (a concurrent finalize/release that already moved it won't match).
    const expiring = await UsageReservation.find(filter)
        .select('organizationId reservedMicro')
        .lean();

    let expired = 0;
    for (const r of expiring) {
        const moved = await UsageReservation.findOneAndUpdate(
            { _id: r._id, status: 'active' },
            { $set: { status: 'expired' } },
        ).exec();
        if (moved) {
            expired += 1;
            await creditBalanceRepo
                .releaseHeadroom(String(r.organizationId), Number(r.reservedMicro ?? 0))
                .catch(() => undefined);
        }
    }
    return expired;
}
