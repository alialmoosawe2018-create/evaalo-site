/**
 * The blueprint an interview is SCORED against: the one pinned when it started.
 *
 * 🔴 `/end` used to rebuild this from the campaign whenever the session carried
 * nothing — reasoning that generation had certainly finished by then, so it beat
 * losing the evaluation. It does not. Generation finishing LATER is exactly the
 * case where the agent never had the competencies, so the candidate was asked one
 * set of questions and graded against another. Measured on four real sessions:
 * coverage 0.22, 0.11, 0 and 0.33, one of them scoring ZERO.
 *
 * A blueprint that locks after the interview does not get to rewrite the past.
 *
 * Lives here rather than inline in the route so the rule can be tested against
 * the code that actually runs: an earlier version of its test reimplemented the
 * check locally, and every mutation of the route stayed green.
 */

/** A snapshot counts only when it carries real competencies. */
export function snapshotHasCompetencies(
    snap: Record<string, unknown> | undefined | null
): snap is Record<string, unknown> {
    return (
        !!snap &&
        Array.isArray((snap as { competencies?: unknown }).competencies) &&
        ((snap as { competencies: unknown[] }).competencies.length > 0)
    );
}

/**
 * What the scorer may weigh for this session — nothing else.
 *
 * ⚠️ An EMPTY or partial pin is treated as no pin: a scorer handed zero
 * competencies would weigh nothing while still reporting a specialist result.
 */
export function pinnedBlueprintForScoring(
    session: { blueprintSnapshot?: unknown } | null | undefined
): Record<string, unknown> | undefined {
    const snap =
        session?.blueprintSnapshot && typeof session.blueprintSnapshot === 'object'
            ? (session.blueprintSnapshot as Record<string, unknown>)
            : undefined;
    return snapshotHasCompetencies(snap) ? snap : undefined;
}
