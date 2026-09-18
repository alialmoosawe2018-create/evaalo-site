/**
 * The query string of a public video-screening link.
 *
 * 🔴 WHY IT THROWS. The earlier builder wrote
 *
 *     if (campaignId) params.set('campaignId', campaignId);
 *
 * and both Head Hunter pages forgot to pass the prop, so every share link went
 * out without a campaign. Nothing complained. The candidate found out: they
 * filled in the whole form and were refused with
 * `Validation error: Path 'organizationId' is required`, because the server
 * derives the organization from the campaign and from nothing else.
 *
 * A missing campaign is not a link with one fewer parameter — it is a link that
 * cannot work. So this refuses to build one, loudly, at the place the mistake is
 * made rather than three systems away in front of a candidate.
 *
 * ⚠️ Lives in `utils/` rather than beside its caller for the same reason as
 * `headHunterInviteRole`: the hook module imports the API client and touches
 * `window`, so a rule that belongs in a test cannot live there.
 *
 * ⚠️ The role carried here is the RecruitmentCampaign's, raw and unlocalized.
 * The picker localizes for display; the URL must not. `reconcileIntakePosition`
 * compares this value against the stored campaign role, and a translated title
 * would never match — manufacturing a "the candidate declared something else"
 * correction on every single Head Hunter application.
 */

/**
 * @param {object} opts
 * @param {string} opts.campaignId  REQUIRED — the RecruitmentCampaign being interviewed for
 * @param {string} [opts.position]  the campaign's role; omitted entirely when empty
 * @param {string} [opts.headHunterContextId]
 * @param {string} [opts.language]
 * @param {(params: URLSearchParams, language: string | undefined) => void} [appendLanguage]
 * @returns {string} the query string, without a leading `?`
 */
export function buildPublicVideoScreeningQuery(opts = {}, appendLanguage) {
    const campaignId = (opts.campaignId || '').trim();
    if (!campaignId) {
        throw new Error(
            'buildPublicVideoScreeningQuery: campaignId is required — a video screening ' +
                'link must name the RecruitmentCampaign it interviews for, or the candidate ' +
                'cannot be attributed to an organization'
        );
    }

    const params = new URLSearchParams();
    // Unconditional. This is the whole point of the module.
    params.set('campaignId', campaignId);

    const position = (opts.position || '').trim();
    if (position) params.set('position', position);

    const hh = (opts.headHunterContextId || '').trim();
    if (hh) params.set('hh', hh);

    if (typeof appendLanguage === 'function') appendLanguage(params, opts.language);

    return params.toString();
}
