// ============================================
// ملف: services/headHunterCandidateStore.ts
// الحفظ الدائم لمرشّحي الهيد هانتر — من الخادم، قبل الفوترة
// ============================================
//
// The durable write that `postHeadHunterN8nInbound` was missing. See the header
// of `models/HeadHunterCandidate.ts` for the measured defect this closes and for
// the invariant it holds:
//
//     every billed candidate has a persisted row
//
// This module is the "persisted" half. It is called from inside
// `applyHeadHunterInboundMerge`, which already runs inside `runSerializedInbound`
// (so writes for one searchId never interleave), and it is called BEFORE
// `billNewHeadHunterCandidates`. That ordering is the enforcement: if this throws,
// the inbound handler 500s, n8n's `retryOnFail` on `Send Candidate to Evaalo`
// retries, and nothing was charged in the meantime.
//
// WHY IT THROWS INSTEAD OF WARNING. Every other best-effort write in this
// codebase logs and continues, which is right when the write is an optimisation.
// Here it is the product: a candidate the organization pays 6 credits for and we
// then drop is strictly worse than a candidate we never charge for. Note this
// costs nothing in the one failure mode people worry about — if Mongo is
// unreachable then `consumeCredits` cannot write `credit_ledger` either, so the
// old behaviour in that outage was "free candidates that vanish on restart", not
// "candidates safely billed".
//
// WHAT THE CALLER PASSES. Only the candidates the current inbound POST actually
// carried. `mergeHeadHunterInbound` folds incoming rows into the accumulated set
// and leaves every other key byte-identical, so a stored row can only be stale if
// the incoming body mentioned its key — which includes the case that matters, a
// profile re-arriving enriched (`mergeCandidateRow` is a shallow overwrite). Every
// other key in the merged set was published to the in-memory record only after its
// own write succeeded. So one delivered candidate costs one upsert, and a row that
// cannot be written can never block a later, writable one.

import mongoose from 'mongoose';
import HeadHunterCandidate from '../models/HeadHunterCandidate.js';

/**
 * Mongoose buffers a query on a dead connection and rejects ~10 s later. On this
 * path that would stall n8n's per-candidate loop, so an unavailable database is
 * answered immediately — and, unlike the caches elsewhere in this codebase, it is
 * answered with a failure rather than a shrug.
 */
function mongoReady(): boolean {
    return mongoose.connection?.readyState === 1;
}

export class HeadHunterPersistenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HeadHunterPersistenceError';
    }
}

export type HeadHunterCandidateWrite = {
    /** Raw `profileDedupeKey(row)`. */
    candidateKey: string;
    /** Exact `credit_ledger.idempotencyKey` for this candidate. */
    billingKey: string;
    /** Arrival index within the search, 0-based. */
    sequence: number;
    /** The candidate row as stored, after photo mirroring. */
    profile: unknown;
};

function isDuplicateKeyError(err: unknown): boolean {
    const e = err as { code?: number; writeErrors?: { code?: number }[] } | null;
    if (!e) return false;
    if (e.code === 11000) return true;
    return Array.isArray(e.writeErrors) && e.writeErrors.length > 0
        && e.writeErrors.every((w) => w?.code === 11000);
}

/**
 * Upsert one search's candidate rows. Idempotent on
 * `{ organizationId, searchId, candidateKey }`, so it is safe to call again for
 * the same candidate — which is exactly why it can be placed before billing.
 *
 * @throws HeadHunterPersistenceError when the rows were not durably written.
 */
export async function persistHeadHunterCandidates(args: {
    organizationId: string;
    searchId: string;
    receivedAt: string | Date;
    createdByClerkUserId?: string;
    rows: HeadHunterCandidateWrite[];
}): Promise<{ persisted: number; inserted: number }> {
    const { organizationId, searchId, receivedAt, createdByClerkUserId, rows } = args;
    if (!rows.length) return { persisted: 0, inserted: 0 };
    if (!organizationId || !searchId) {
        throw new HeadHunterPersistenceError('organizationId and searchId are required');
    }
    if (!mongoReady()) {
        throw new HeadHunterPersistenceError('database unavailable — candidate not stored, so not billed');
    }

    const when = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
    const ops = rows.map((row) => ({
        updateOne: {
            filter: { organizationId, searchId, candidateKey: row.candidateKey },
            update: {
                $set: {
                    billingKey: row.billingKey,
                    sequence: row.sequence,
                    profile: row.profile,
                },
                // `receivedAt` is when the candidate FIRST arrived: it orders the
                // reconstructed set, so a later enriching write must not move it.
                $setOnInsert: {
                    organizationId,
                    searchId,
                    candidateKey: row.candidateKey,
                    receivedAt: when,
                    ...(createdByClerkUserId ? { createdByClerkUserId } : {}),
                },
            },
            upsert: true,
        },
    }));

    try {
        const res = await HeadHunterCandidate.bulkWrite(ops, { ordered: false });
        return { persisted: rows.length, inserted: res.upsertedCount ?? 0 };
    } catch (err) {
        // Two inbound POSTs for the same profile can race the upsert and one loses
        // on the unique index. The row exists either way, which is all we needed.
        if (isDuplicateKeyError(err)) return { persisted: rows.length, inserted: 0 };
        throw new HeadHunterPersistenceError(
            `failed to store ${rows.length} candidate(s) for ${searchId}: ${(err as Error)?.message ?? 'unknown error'}`
        );
    }
}

/**
 * Rebuild a search's candidate set from the durable rows, in arrival order.
 * Returns the profiles only — the shape `/last-result` and the history routes
 * already serve, so nothing downstream has to learn a new one.
 */
export async function readHeadHunterCandidates(
    organizationId: string,
    searchId: string
): Promise<Record<string, unknown>[]> {
    if (!organizationId || !searchId || !mongoReady()) return [];
    const rows = await HeadHunterCandidate.find({ organizationId, searchId })
        .sort({ receivedAt: 1, sequence: 1 })
        .select('profile')
        .lean();
    return rows
        .map((r) => (r as { profile?: unknown }).profile)
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object');
}

/** Candidate counts per searchId, for listing without shipping every profile. */
export async function countHeadHunterCandidates(
    organizationId: string,
    searchIds: string[]
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = searchIds.filter(Boolean);
    if (!ids.length || !mongoReady()) return out;
    const rows = await HeadHunterCandidate.aggregate<{ _id: string; n: number }>([
        { $match: { organizationId, searchId: { $in: ids } } },
        { $group: { _id: '$searchId', n: { $sum: 1 } } },
    ]);
    for (const r of rows) out.set(r._id, r.n);
    return out;
}

/** Drop a search's candidate rows — used when its history row is deleted. */
export async function deleteHeadHunterCandidates(
    organizationId: string,
    searchIds: string[]
): Promise<number> {
    const ids = searchIds.filter(Boolean);
    if (!ids.length || !mongoReady()) return 0;
    const res = await HeadHunterCandidate.deleteMany({ organizationId, searchId: { $in: ids } });
    return res.deletedCount ?? 0;
}
