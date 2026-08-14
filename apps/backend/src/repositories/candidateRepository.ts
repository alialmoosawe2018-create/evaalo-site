/**
 * CandidateRepository — a domain-shaped, org-scoped seam over the `candidates`
 * collection. Closes the "candidate-repo 100%" gap from the architecture plan
 * (Phase 1) by routing person-level candidate reads off the raw Mongoose model.
 *
 * Every method scopes by `organizationId` or `_id` (both tenant-guard safe keys, so
 * they never trip strict mode) and returns plain lean rows — no Mongoose Document or
 * ObjectId leaks across the boundary, which is what keeps a future datastore swap a
 * repository change rather than a route rewrite.
 */

import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';

type Session = mongoose.ClientSession | undefined;
const opt = (s: Session) => (s ? { session: s } : {});

/** A single person row by `_id` (lean); null when absent. `_id` is a guard-safe key. */
export async function findByIdLean(
    id: string | mongoose.Types.ObjectId,
    session?: Session,
): Promise<Record<string, unknown> | null> {
    return Candidate.findById(id, null, opt(session)).lean().exec() as Promise<Record<
        string,
        unknown
    > | null>;
}

/**
 * Legacy candidate list (pre-application "candidate" rows): the caller's filter,
 * org-scoped, newest first, lean. Mirrors the old `Candidate.find(orgScopedQuery(...))`
 * exactly (organizationId injected → guard-safe) but returns plain rows.
 */
export async function listLegacyScoped(
    organizationId: string,
    filter: Record<string, unknown> = {},
    session?: Session,
): Promise<Record<string, unknown>[]> {
    return Candidate.find({ ...filter, organizationId }, null, opt(session))
        .sort({ createdAt: -1 })
        .lean()
        .exec() as Promise<Record<string, unknown>[]>;
}
