/**
 * CandidateApplicationRepository — the ONLY place that issues Mongo IO for the
 * candidate-application listing paths. Services orchestrate + map; this layer
 * returns plain lean rows (never live Mongoose Documents), always org-scoped.
 *
 * Keeping the raw queries here is the seam that makes a future datastore swap a
 * repository change rather than a service rewrite (see architecture plan Phase 1).
 */

import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { clampLimit, decodeCursor, encodeCursor } from './pagination.js';

export type LeanRow = Record<string, unknown>;

export type ListApplicationsOpts = {
    organizationId: string;
    campaignId?: string;
    extraFilter?: Record<string, unknown>;
};

export type ApplicationsPage = {
    apps: LeanRow[];
    nextCursor: string | null;
    hasMore: boolean;
};

/** org + soft-delete + optional campaign/view filters, always tenant-scoped. */
function baseFilter(opts: ListApplicationsOpts): Record<string, unknown> {
    const q: Record<string, unknown> = {
        organizationId: opts.organizationId,
        deletedAt: null,
        ...(opts.extraFilter || {}),
    };
    if (opts.campaignId) q.campaignId = opts.campaignId;
    return q;
}

/** Stable order for cursor paging: newest first, _id as the tiebreak. */
const LIST_SORT = { createdAt: -1, _id: -1 } as const;

/** Full org-scoped listing (unpaginated) — backs the legacy full-list behavior. */
export async function findApplicationsForListing(opts: ListApplicationsOpts): Promise<LeanRow[]> {
    return CandidateApplication.find(baseFilter(opts)).sort(LIST_SORT).lean();
}

/** Cursor-paginated org-scoped listing. Fetches limit+1 to detect `hasMore`. */
export async function findApplicationsPage(
    opts: ListApplicationsOpts & { limit?: number; cursor?: string | null },
): Promise<ApplicationsPage> {
    const limit = clampLimit(opts.limit);
    const filter = baseFilter(opts);

    if (opts.cursor) {
        const c = decodeCursor(opts.cursor);
        if (c && mongoose.Types.ObjectId.isValid(c.i)) {
            const cAt = new Date(c.c);
            const cursorCond = {
                $or: [
                    { createdAt: { $lt: cAt } },
                    { createdAt: cAt, _id: { $lt: new mongoose.Types.ObjectId(c.i) } },
                ],
            };
            // Combine under $and so an existing extraFilter $or is never clobbered.
            filter.$and = [...((filter.$and as unknown[]) || []), cursorCond];
        }
    }

    const apps = (await CandidateApplication.find(filter)
        .sort(LIST_SORT)
        .limit(limit + 1)
        .lean()) as LeanRow[];

    const hasMore = apps.length > limit;
    const pageApps = hasMore ? apps.slice(0, limit) : apps;

    let nextCursor: string | null = null;
    if (hasMore && pageApps.length > 0) {
        const last = pageApps[pageApps.length - 1] as { createdAt: Date; _id: unknown };
        nextCursor = encodeCursor(last.createdAt, String(last._id));
    }

    return { apps: pageApps, nextCursor, hasMore };
}

/** Batch-load the person documents referenced by a set of applications. */
export async function loadPeopleByIds(candidateIds: string[]): Promise<Map<string, LeanRow>> {
    if (!candidateIds.length) return new Map();
    const people = (await Candidate.find({ _id: { $in: candidateIds } }).lean()) as LeanRow[];
    return new Map(people.map((p) => [String(p._id), p]));
}
