/**
 * What the pre-interview screen does with a blueprint readiness state.
 *
 * Extracted from the page so the decision is testable: the page module cannot be
 * loaded outside Vite, and this is the rule that decides whether a candidate can
 * begin — the one place where getting it wrong either blocks everybody or lets a
 * blind specialist interview through.
 *
 * Why the gate exists: three consecutive public-path interviews ran without
 * competencies while `/end` later handed the scorer the full rubric — coverage
 * 0.22, 0.11, 0, 0.33, and one scored ZERO. It opens on READINESS, never on a
 * clock: measured generation on the deployed model is 88–132 s and rising with
 * deep packs, so any fixed wait is a number that goes stale.
 *
 * @typedef {'ready'|'generating'|'absent'|null} BlueprintState
 */

/**
 * @param {BlueprintState} state
 * @returns {{ blocked: boolean, note: 'preparing'|'failed'|'', retry: boolean }}
 */
export function blueprintGateDecision(state) {
    if (state === 'generating') {
        // No retry button: polling itself restarts a failed generation and joins
        // a running one, so a button here would only invite pointless clicking.
        return { blocked: true, note: 'preparing', retry: false };
    }
    if (state === 'absent') {
        // A terminal failure DOES get a button — the owner's rule: a clear,
        // retryable state, never an endless spinner, and never a start without
        // competencies.
        return { blocked: true, note: 'failed', retry: true };
    }
    // 'ready' — and, deliberately, null.
    //
    // ⚠️ Unknown must NOT block. /prepare can be skipped by env or fail outright,
    // and a UI that fails closed on "unknown" would stop every candidate. The
    // real enforcement is the backend guard on /start; this screen only spares
    // the candidate from beginning something that would be refused.
    return { blocked: false, note: '', retry: false };
}
