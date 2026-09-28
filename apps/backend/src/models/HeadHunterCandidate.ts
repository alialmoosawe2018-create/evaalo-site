// ============================================
// ملف: models/HeadHunterCandidate.ts
// مرشّحو الهيد هانتر — صفّ دائم لكل مرشّح، يُكتب من الخادم لا من المتصفّح
// ============================================
//
// Why this collection exists (2026-09-28).
//
// `head_hunter_search_history` already moved the search LIST off the browser,
// but the candidate SET still never reached the database from the server: the
// n8n callback wrote only a process-local Map, and the only code that persisted
// candidates was `PUT /api/head-hunter/history`, called by the page itself. So
// durability depended on a tab staying open long enough to poll the last wave.
//
// It did not. Measured on 2026-09-28 against production, on 2 of 2 real searches:
//
//   search          billed (credit_ledger)   durably kept   lost
//   Store Manager           13                    4           9
//   Sales Manager           20                   11           9
//
// Both times the durable copy froze at the phase-1 count and the loss was
// exactly the phase-2 wave, which arrives ~138 s later. The organization had
// already been debited 6 credits for every one of those candidates. Losing the
// row is losing money already spent — the same reason the history collection
// exists, one level deeper.
//
// THE INVARIANT THIS COLLECTION EXISTS TO HOLD:
//
//     every billed candidate has a persisted row
//
// It is enforced by ORDER, not by a later assertion: the inbound webhook writes
// here BEFORE `billNewHeadHunterCandidates` runs, and a failed write throws, so
// nothing is charged for a candidate that was not stored. The converse is
// deliberately allowed — a persisted row with no ledger row is harmless, and
// happens legitimately whenever billing is disabled or a candidate re-arrives
// enriched. The asymmetry is the point.
//
// IDENTITY. `candidateKey` is the RAW `profileDedupeKey()` from the inbound
// route — the same function billing dedupes on, so the two can never disagree
// about what "one candidate" is. `billingKey` additionally stores the exact
// `credit_ledger.idempotencyKey` string that was (or would be) charged, because
// that string is a LOSSY transform of the key (non-alphanumerics collapse to `_`
// and it truncates at 120 chars). Keeping both means the invariant above is
// checkable as an exact join instead of a re-derivation that could drift.
//
// SCOPE IS THE ORGANIZATION, matching the history collection: a search paid for
// by an org belongs to the org. The originating user is kept for attribution,
// never for filtering.
//
// LIFETIME. These rows deliberately OUTLIVE the history row they belong to.
// `pruneHistory` drops a tenant's 51st-oldest search so the list stays short; that
// is a DISPLAY decision, and letting it delete the record of a billed candidate
// would recreate, in milder form, the exact loss this collection was added to stop.
// `credit_ledger` keeps its row forever, so this keeps its row for a year.
//
// Deleted early in exactly one case: the user deletes the search themselves.
//
// The bound is a Mongo TTL index rather than a sweeper because this repo has no
// cron or queue — only in-process `setInterval` timers — and a TTL costs nothing to
// run and nothing to get wrong. Measured cost is ~9 KB per candidate, so a
// 20-candidate search is ~180 KB and a year of them stays far inside the tier.

import mongoose, { Schema, type Document } from 'mongoose';

export interface IHeadHunterCandidate extends Document {
    organizationId: string;
    /** The n8n search this candidate was sourced by. */
    searchId: string;
    /**
     * Raw `profileDedupeKey(row)` — `li:<url>` | `em:<email>` | `name|occ|loc`.
     * Unique per (org, search): the de facto primary key of a sourced profile.
     */
    candidateKey: string;
    /**
     * The exact `credit_ledger.idempotencyKey` for this candidate
     * (`hh-search:<searchId>:<safeKey>`). Stored verbatim so "billed" and
     * "persisted" can be reconciled by an exact join, never by re-deriving.
     */
    billingKey: string;
    /**
     * Arrival index within this search, 0-based. n8n's per-candidate POST carries
     * only profile fields, so the WAVE (phase 1 vs the expansion) is not knowable
     * here and is deliberately not stored; the order candidates arrived in is.
     */
    sequence: number;
    /** The candidate as stored, after photo mirroring. Shape owned by n8n. */
    profile: unknown;
    /** When this candidate arrived from n8n. Orders the reconstructed set. */
    receivedAt: Date;
    /**
     * Set ONLY on rows rebuilt after the fact, naming where they came from (e.g.
     * `n8n-execution-2032`). Absent on every row written by the live inbound path.
     *
     * It exists so a recovered row can never be mistaken for one that arrived
     * normally: `receivedAt` on these is reconstructed from the billing timestamp,
     * and a photo may still point at the provider rather than our mirror.
     */
    recoveredFrom?: string;
    createdByClerkUserId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const HeadHunterCandidateSchema = new Schema<IHeadHunterCandidate>(
    {
        organizationId: { type: String, required: true },
        searchId: { type: String, required: true },
        candidateKey: { type: String, required: true },
        billingKey: { type: String, default: '' },
        sequence: { type: Number, default: 0 },
        profile: { type: Schema.Types.Mixed },
        receivedAt: { type: Date, required: true },
        recoveredFrom: { type: String },
        createdByClerkUserId: { type: String },
    },
    { timestamps: true, collection: 'head_hunter_candidates' }
);

// The row identity within a tenant. Unique so that a n8n retry, an idempotency
// collision, or the same profile arriving enriched in a later wave UPDATES the
// row instead of duplicating it — which is what makes the inbound write safe to
// repeat, and therefore safe to place before billing.
HeadHunterCandidateSchema.index({ organizationId: 1, searchId: 1, candidateKey: 1 }, { unique: true });
// Rebuilding one search's candidate set, in arrival order.
HeadHunterCandidateSchema.index({ organizationId: 1, searchId: 1, receivedAt: 1 });
// Reconciling "billed vs persisted" for a whole tenant. NOT unique: `billingKey`
// derives from a lossy transform of `candidateKey` (non-alphanumerics collapse to
// `_`, truncated at 120), so two distinct profiles can legitimately share one. That
// direction is safe — the collision makes billing skip the second candidate while
// both are stored, i.e. it under-bills and cannot violate the invariant.
HeadHunterCandidateSchema.index({ organizationId: 1, billingKey: 1 });
// The storage bound. See LIFETIME above.
HeadHunterCandidateSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export default mongoose.model<IHeadHunterCandidate>('HeadHunterCandidate', HeadHunterCandidateSchema);
