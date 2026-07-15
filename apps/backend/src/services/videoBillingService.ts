/**
 * Video interview billing (pack model) — included minutes first, then PURCHASED
 * minutes. Video NEVER spends credits.
 *
 * Rules (locked):
 *   - Consumption order: included video seconds, then purchased video seconds.
 *   - When both are exhausted, a new video session cannot start; the user must
 *     buy an extra video pack (one-time purchase). Credits are never touched.
 *   - At most one active video session per organization (atomic lock).
 *   - Settlement is atomic + idempotent (unique ledger key `vi_end:<sessionId>`),
 *     and writes a 0-credit ledger row (audit + capacity accounting).
 */

import mongoose from 'mongoose';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';

/** Extra wall-clock grace beyond maxAllowed before the sweep force-ends a lock. */
const VIDEO_LOCK_GRACE_SECONDS = 120;

/** Per-org alert threshold: warn when 80% of included video minutes are used. */
const ORG_INCLUDED_ALERT_RATIO = 0.8;

/** Global monthly video-minute capacity alert thresholds (operational, not customer caps). */
const GLOBAL_VIDEO_WARN_MINUTES = 1000;
const GLOBAL_VIDEO_CRITICAL_MINUTES = 1200;

function isDuplicateKeyError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
    );
}

/** Detect environments where MongoDB transactions are unavailable (standalone). */
function isTransactionUnsupported(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: number; codeName?: string; message?: string };
    if (e.code === 20 || e.codeName === 'IllegalOperation') return true;
    const msg = String(e.message || '');
    return /Transaction numbers are only allowed|replica set|mongos|not supported/i.test(msg);
}

// ── start: atomic single-active lock + server time cap ─────────────────────────

export type StartVideoResult =
    | {
          ok: true;
          maxAllowedVideoSeconds: number;
          includedVideoSecondsAtStart: number;
          purchasedVideoSecondsAtStart: number;
      }
    | { ok: false; code: 'NO_VIDEO_MINUTES' | 'ACTIVE_SESSION' | 'ORG_NOT_FOUND'; message: string };

interface StartVideoInput {
    organizationId: string;
    sessionId: string;
    maxInterviewSeconds: number;
}

/**
 * Acquire the single-active-video lock and compute the server-enforced cap.
 *
 * The cap is purely time-based: included + purchased remaining seconds (no credit
 * coverage). The acquire is a single atomic findOneAndUpdate guarded only by
 * "no active session" — an EXPIRED lock is NOT treated as free here; the sweep
 * must settle + release it first.
 */
export async function startVideoSession(input: StartVideoInput): Promise<StartVideoResult> {
    const { organizationId, sessionId, maxInterviewSeconds } = input;

    const balance = await CreditBalance.findOne({ organizationId }).exec();
    if (!balance) {
        return { ok: false, code: 'ORG_NOT_FOUND', message: 'Credit balance not initialized' };
    }

    const remainingIncluded = Math.max(
        0,
        (balance.includedVideoSeconds ?? 0) - (balance.usedIncludedVideoSeconds ?? 0),
    );
    const remainingPurchased = Math.max(
        0,
        (balance.purchasedVideoSeconds ?? 0) - (balance.usedPurchasedVideoSeconds ?? 0),
    );

    const maxAllowedVideoSeconds = Math.min(
        maxInterviewSeconds,
        remainingIncluded + remainingPurchased,
    );

    if (maxAllowedVideoSeconds <= 0) {
        return {
            ok: false,
            code: 'NO_VIDEO_MINUTES',
            message: 'No video minutes left. Purchase an extra video pack to continue.',
        };
    }

    const expiresAt = new Date(
        Date.now() + (maxAllowedVideoSeconds + VIDEO_LOCK_GRACE_SECONDS) * 1000,
    );

    const acquired = await CreditBalance.findOneAndUpdate(
        {
            organizationId,
            $or: [
                { activeVideoSessionId: null },
                { activeVideoSessionId: { $exists: false } },
            ],
        },
        {
            $set: {
                activeVideoSessionId: sessionId,
                activeVideoSessionExpiresAt: expiresAt,
            },
        },
        { new: true },
    ).exec();

    if (!acquired) {
        return {
            ok: false,
            code: 'ACTIVE_SESSION',
            message: 'Another video interview is already active for this organization',
        };
    }

    return {
        ok: true,
        maxAllowedVideoSeconds,
        includedVideoSecondsAtStart: remainingIncluded,
        purchasedVideoSecondsAtStart: remainingPurchased,
    };
}

// ── settle: atomic, idempotent consumption at end ──────────────────────────────

export type ConsumeVideoResult =
    | { ok: true; alreadyProcessed?: boolean; includedVideoSecondsUsed: number; purchasedVideoSecondsUsed: number }
    | { ok: false; code: 'ORG_NOT_FOUND'; message: string };

interface ConsumeVideoInput {
    organizationId: string;
    sessionId: string;
    /** Server-computed billed seconds, already clamped to maxAllowedVideoSeconds. */
    actualSeconds: number;
    /** Authoritative end time recorded for the session (server/sweep, not client). */
    billingEndedAt: Date;
    /** Remaining included seconds captured at /start for this session. */
    includedRemainingAtStart: number;
    /** Remaining purchased seconds captured at /start for this session. */
    purchasedRemainingAtStart: number;
    metadata?: Record<string, unknown>;
}

/**
 * Settle a finished video session exactly once.
 *
 * Inside a transaction: write the ledger first (unique `vi_end:<sessionId>` aborts
 * a concurrent duplicate), then decrement consumed included + purchased seconds
 * and release THIS session's lock only (guarded by activeVideoSessionId ===
 * sessionId). Credits are never touched (amountMicro = 0). A fully-included
 * session still writes a 0-charge ledger row for capacity accounting.
 */
export async function consumeVideoSeconds(input: ConsumeVideoInput): Promise<ConsumeVideoResult> {
    const {
        organizationId,
        sessionId,
        actualSeconds,
        billingEndedAt,
        includedRemainingAtStart,
        purchasedRemainingAtStart,
        metadata,
    } = input;

    const idempotencyKey = `vi_end:${sessionId}`;
    const includedToUse = Math.max(0, Math.min(actualSeconds, includedRemainingAtStart));
    const purchasedToUse = Math.max(
        0,
        Math.min(actualSeconds - includedToUse, purchasedRemainingAtStart),
    );

    const settle = async (txnSession?: mongoose.ClientSession): Promise<ConsumeVideoResult> => {
        const opts = txnSession ? { session: txnSession } : {};

        const bal = await CreditBalance.findOne({ organizationId }, null, opts).exec();
        if (!bal) {
            return { ok: false, code: 'ORG_NOT_FOUND', message: 'Credit balance not found' };
        }

        const balanceMicro = bal.balanceMicro;

        // Ledger-first: unique index makes this the idempotency gate. Video never
        // charges credits, so amountMicro is always 0 (balance unchanged).
        await CreditLedger.create(
            [
                {
                    organizationId,
                    usageType: 'VIDEO_SECONDS',
                    amountMicro: 0,
                    balanceBeforeMicro: balanceMicro,
                    balanceAfterMicro: balanceMicro,
                    units: actualSeconds,
                    source: 'video_interview',
                    sourceId: sessionId,
                    idempotencyKey,
                    videoSessionId: sessionId,
                    totalVideoSeconds: actualSeconds,
                    includedVideoSecondsUsed: includedToUse,
                    purchasedVideoSecondsUsed: purchasedToUse,
                    creditVideoSeconds: 0,
                    chargedMicroCredits: 0,
                    metadata: { ...(metadata ?? {}) },
                },
            ],
            opts,
        );

        // Decrement consumed minutes + release THIS session's lock.
        const updated = await CreditBalance.updateOne(
            { organizationId, activeVideoSessionId: sessionId },
            {
                $inc: {
                    usedIncludedVideoSeconds: includedToUse,
                    usedPurchasedVideoSeconds: purchasedToUse,
                },
                $set: {
                    activeVideoSessionId: null,
                    activeVideoSessionExpiresAt: null,
                },
            },
            opts,
        );

        // Lock not held by this session (e.g. already released) — still record the
        // consumption so minute counters stay accurate, without touching the lock.
        if (updated.matchedCount === 0) {
            await CreditBalance.updateOne(
                { organizationId },
                {
                    $inc: {
                        usedIncludedVideoSeconds: includedToUse,
                        usedPurchasedVideoSeconds: purchasedToUse,
                    },
                },
                opts,
            );
        }

        await VideoInterviewSession.updateOne(
            { sessionId },
            { $set: { billingStatus: 'settled', billingEndedAt } },
            opts,
        );

        return { ok: true, includedVideoSecondsUsed: includedToUse, purchasedVideoSecondsUsed: purchasedToUse };
    };

    let result: ConsumeVideoResult;
    const mongoSession = await mongoose.startSession();
    try {
        let captured: ConsumeVideoResult | null = null;
        await mongoSession.withTransaction(async () => {
            captured = await settle(mongoSession);
        });
        result =
            captured ?? { ok: true, includedVideoSecondsUsed: includedToUse, purchasedVideoSecondsUsed: purchasedToUse };
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            // Concurrent or repeat settlement already recorded — normal, not an error.
            return { ok: true, alreadyProcessed: true, includedVideoSecondsUsed: 0, purchasedVideoSecondsUsed: 0 };
        }
        if (isTransactionUnsupported(err)) {
            // Standalone Mongo (dev) — fall back to a non-transactional sequence.
            try {
                result = await settle(undefined);
            } catch (err2) {
                if (isDuplicateKeyError(err2)) {
                    return { ok: true, alreadyProcessed: true, includedVideoSecondsUsed: 0, purchasedVideoSecondsUsed: 0 };
                }
                throw err2;
            }
        } else {
            throw err;
        }
    } finally {
        await mongoSession.endSession();
    }

    // Capacity alerts are best-effort and must never affect billing.
    void checkVideoCapacityAlerts(organizationId).catch((e) =>
        console.warn(`[video-capacity] alert check failed: ${e?.message || e}`),
    );

    return result;
}

// ── sweep: force-end & settle expired locks ────────────────────────────────────

/**
 * Release locks whose session never sent /end (browser closed, crash, etc.).
 * For each expired lock: mark the session forced_ended, stop the agent/room, and
 * settle via consumeVideoSeconds (idempotent — a racing /end is harmless).
 */
export async function sweepStaleVideoLocks(): Promise<void> {
    const now = new Date();
    const stale = await CreditBalance.find({
        activeVideoSessionId: { $ne: null },
        activeVideoSessionExpiresAt: { $lt: now },
    })
        .select('organizationId activeVideoSessionId')
        .lean()
        .exec();

    if (!stale.length) return;

    const { stopAgent } = await import('./agentService.js');
    const { deleteLiveKitRoom } = await import('./livekitService.js');

    for (const row of stale) {
        const organizationId = row.organizationId;
        const sessionId = row.activeVideoSessionId as string;
        if (!sessionId) continue;

        try {
            const session = await VideoInterviewSession.findOne({ sessionId }).exec();
            const startMs = session?.billingStartedAt
                ? new Date(session.billingStartedAt).getTime()
                : session?.startedAt
                  ? new Date(session.startedAt).getTime()
                  : now.getTime();
            const cap = session?.maxAllowedVideoSeconds ?? 0;
            let actualSeconds = Math.floor(Math.max(0, now.getTime() - startMs) / 1000);
            if (cap > 0) actualSeconds = Math.min(actualSeconds, cap);

            // Force-end the provider side so we stop paying for an abandoned room.
            const roomName = `room-${sessionId}`;
            try {
                stopAgent(roomName);
            } catch {
                /* non-blocking */
            }
            void deleteLiveKitRoom(roomName).catch(() => undefined);

            if (session) {
                await VideoInterviewSession.updateOne(
                    { sessionId, billingStatus: 'active' },
                    { $set: { billingStatus: 'forced_ended' } },
                ).exec();
            }

            await consumeVideoSeconds({
                organizationId,
                sessionId,
                actualSeconds,
                billingEndedAt: now,
                includedRemainingAtStart: session?.includedVideoSecondsAtStart ?? 0,
                purchasedRemainingAtStart: session?.purchasedVideoSecondsAtStart ?? 0,
                metadata: { forcedBySweep: true },
            });
            console.warn(
                `[video-sweep] force-settled stale session org=${organizationId} session=${sessionId} seconds=${actualSeconds}`,
            );
        } catch (e: any) {
            console.warn(
                `[video-sweep] failed to settle org=${organizationId} session=${sessionId}: ${e?.message || e}`,
            );
        }
    }
}

// ── capacity alerts ────────────────────────────────────────────────────────────

/** UTC calendar-month window [start, nextStart) for global capacity aggregation. */
function utcMonthWindow(now = new Date()): { start: Date; next: Date; key: string } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    return { start, next, key };
}

/**
 * Best-effort server-side capacity warnings (no customer impact):
 *   - per-org: 80% of included video minutes used this period.
 *   - global: total video minutes across all orgs this UTC month at 1000 / 1200.
 * De-dup markers live in the `capacity_alerts` collection so each threshold logs once.
 */
async function checkVideoCapacityAlerts(organizationId: string): Promise<void> {
    const alertsCol = mongoose.connection.collection('capacity_alerts');

    // Per-org included-minutes 80% alert.
    const bal = await CreditBalance.findOne({ organizationId })
        .select('includedVideoSeconds usedIncludedVideoSeconds periodStart')
        .lean()
        .exec();
    if (bal && (bal.includedVideoSeconds ?? 0) > 0) {
        const ratio = (bal.usedIncludedVideoSeconds ?? 0) / bal.includedVideoSeconds;
        if (ratio >= ORG_INCLUDED_ALERT_RATIO) {
            const period = bal.periodStart ? new Date(bal.periodStart).toISOString().slice(0, 10) : 'na';
            const marker = `org-included-80:${organizationId}:${period}`;
            const res = await alertsCol.updateOne(
                { marker },
                { $setOnInsert: { marker, createdAt: new Date() } },
                { upsert: true },
            );
            if (res.upsertedCount && res.upsertedCount > 0) {
                console.warn(
                    `[video-capacity] org=${organizationId} reached ${Math.round(ratio * 100)}% of included video minutes`,
                );
            }
        }
    }

    // Global monthly aggregate across all video_interview ledger rows.
    const { start, next, key } = utcMonthWindow();
    const agg = await CreditLedger.aggregate([
        { $match: { source: 'video_interview', createdAt: { $gte: start, $lt: next } } },
        { $group: { _id: null, totalSeconds: { $sum: { $ifNull: ['$totalVideoSeconds', 0] } } } },
    ]).exec();
    const totalMinutes = Math.floor((agg[0]?.totalSeconds ?? 0) / 60);

    const maybeWarn = async (threshold: number, critical: boolean) => {
        if (totalMinutes < threshold) return;
        const marker = `global-video-warning:${key}:${threshold}`;
        const res = await alertsCol.updateOne(
            { marker },
            { $setOnInsert: { marker, createdAt: new Date() } },
            { upsert: true },
        );
        if (res.upsertedCount && res.upsertedCount > 0) {
            const tag = critical ? 'CRITICAL' : 'WARNING';
            console.warn(
                `[video-capacity] ${tag}: global video usage reached ${totalMinutes} minutes in ${key} (threshold ${threshold}). Consider increasing avatar capacity.`,
            );
        }
    };

    await maybeWarn(GLOBAL_VIDEO_WARN_MINUTES, false);
    await maybeWarn(GLOBAL_VIDEO_CRITICAL_MINUTES, true);
}
