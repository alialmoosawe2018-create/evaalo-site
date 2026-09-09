import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';

export interface CandidateHideResult {
    /** Documents the ids actually addressed. 0 means the hide did nothing. */
    matchedCount: number;
    /** Documents changed. Lower than matched when a card was already hidden. */
    modifiedCount: number;
}

/**
 * Applies a hide/unhide to whichever collection the given ids belong to.
 *
 * The stage list serves APPLICATION rows: `applicationToStageListRow` sets
 * `_id = application._id` and moves the person to `candidateId`, and the list's
 * read filter tests the application's own `hiddenFromViews`. The hide route,
 * however, only ever wrote to `Candidate` keyed by those same ids — ids from a
 * different collection — so no document could ever match. Nothing was hidden,
 * yet the route answered success and the frontend removed the card
 * optimistically, so the card reappeared on the next reload.
 *
 * Both collections are addressed here: applications for the current rows,
 * candidates for the legacy rows served when an org has no application rows yet.
 * An id belongs to exactly one of them, so the counts never double-count.
 *
 * `matchedCount` is returned alongside `modifiedCount` because `$addToSet` is
 * idempotent — on its own, `modified: 0` reads the same whether the card was
 * already hidden or nothing matched at all, which is precisely what kept this
 * failure invisible.
 */
export async function applyCandidateHide(input: {
    organizationId: string;
    ids: string[];
    update: Record<string, unknown>;
}): Promise<CandidateHideResult> {
    const { organizationId, ids, update } = input;
    if (!ids.length) return { matchedCount: 0, modifiedCount: 0 };

    const scoped = { organizationId, _id: { $in: ids } };
    const [application, person] = await Promise.all([
        CandidateApplication.updateMany(scoped, update),
        Candidate.updateMany(scoped, update),
    ]);

    return {
        matchedCount: (application.matchedCount ?? 0) + (person.matchedCount ?? 0),
        modifiedCount: (application.modifiedCount ?? 0) + (person.modifiedCount ?? 0),
    };
}
