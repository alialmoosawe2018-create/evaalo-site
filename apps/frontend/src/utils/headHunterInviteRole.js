/**
 * The role a Head Hunter interview invite is FOR: the search campaign's target
 * role, and only that.
 *
 * ⚠️ The invite used to read `headHunterCandidatePosition(candidate) || campaignPosition`
 * — i.e. the job the candidate holds RIGHT NOW outranked the job the employer is
 * hiring for. An employer searching for "HR Generalist" who shared with a
 * candidate titled "Sales Manager" produced `position=Sales Manager`: what the
 * candidate then saw on the intake form, and what was recorded as the position
 * they "declared" when they had declared nothing.
 *
 * No interview was actually run on the wrong role — the server repairs the
 * interview's own identity in two existing layers (`reconcileIntakePosition` at
 * intake, `applyApplicationJobContext` on read), and production logs show
 * `[AGENT JOB] … → match` throughout. But BOTH layers need a campaign role to
 * repair towards: a campaign that names no role has no reference, and the
 * candidate's own title passes straight through. The link must not be the source
 * of that truth in the first place.
 *
 * No campaign role ⇒ "" ⇒ no `position` in the link at all. Never a guess.
 *
 * Lives in utils/ rather than beside its callers on purpose: the hook module
 * pulls in the API client, so a rule that belongs in a test cannot live there.
 *
 * @param {string} [campaignPosition] the campaign's own target role
 * @returns {string}
 */
export function headHunterInviteRole(campaignPosition) {
    return typeof campaignPosition === 'string' ? campaignPosition.trim() : '';
}
