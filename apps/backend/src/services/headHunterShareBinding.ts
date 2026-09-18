/**
 * The rule binding a Head Hunter share link to the campaign it was created for.
 *
 * 🔴 WHY THIS EXISTS. Copying a share link from the Head Hunter results and
 * opening it used to fail the candidate's submission with
 * `Validation error: Path 'organizationId' is required`. The link carried no
 * `campaignId` at all — a forgotten optional prop on both pages meant
 * `buildPublicVideoScreeningUrl` silently omitted it — and `POST /api/candidates`
 * derives the organization ONLY from a campaign. With none it deleted the field
 * and fell through, unattributed, to the model layer.
 *
 * The fix binds the share to a real `RecruitmentCampaign`, so a head-hunted
 * candidate travels the same chain as everyone else:
 *   campaign → blueprint → readiness gate → pinned competencies → Stage 3.
 *
 * ⚠️ `HeadHunterSourcingContext.organizationId` is a CROSS-CHECK, never a
 * substitute. The organization is derived from the campaign, server-side. The
 * context's org exists to prove the link was created by someone in that same
 * organization — so a context minted in org A can never be spent against a
 * campaign in org B.
 *
 * ⚠️ And it is deliberately NOT a session check. The submitter is anonymous, and
 * their browser may be signed into a different Evaalo account; scoping this to
 * the session org is the exact cross-tenant trap documented in
 * `middleware/orgScope.ts`. Both sides of every comparison here come from the
 * server's own records.
 *
 * Lives in its own module so `/sourcing-context` (where the link is minted) and
 * `/api/candidates` (where it is spent) share ONE rule that a test can reach —
 * the lesson from `pinnedBlueprintForScoring`, whose first test reimplemented
 * the rule locally and left every route mutation green.
 */

export type ShareBindingCode =
    | 'HEADHUNTER_CONTEXT_ORG_MISMATCH'
    | 'HEADHUNTER_CONTEXT_CAMPAIGN_MISMATCH';

export interface ShareBindingVerdict {
    ok: boolean;
    code?: ShareBindingCode;
    message?: string;
}

const OK: ShareBindingVerdict = { ok: true };

/** Trimmed, or '' — `undefined` and `null` collapse to the same unusable value. */
function norm(v: string | undefined | null): string {
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * May this sourcing context be spent against this campaign?
 *
 * @param contextOrgId      the org stored on the context when the link was minted
 * @param contextCampaignId the campaign stored on the context, if any
 * @param campaignOrgId     the org of the campaign named by the link
 * @param campaignId        the campaign named by the link
 */
export function assertSourcingContextMatchesCampaign(input: {
    contextOrgId?: string | null;
    contextCampaignId?: string | null;
    campaignOrgId?: string | null;
    campaignId?: string | null;
}): ShareBindingVerdict {
    const ctxOrg = norm(input.contextOrgId);
    const ctxCampaign = norm(input.contextCampaignId);
    const campOrg = norm(input.campaignOrgId);
    const campId = norm(input.campaignId);

    /*
     * ⚠️ FAIL CLOSED on a context with no organization.
     *
     * An absent org is not "nothing to check" — it is a context we cannot prove
     * belongs to this tenant, which is precisely the property this function was
     * written to establish. Treating it as a pass would reintroduce the
     * unattributed submission through the one door left open.
     *
     * Blast radius is bounded and measured: 3 contexts existed in production
     * when this shipped, 3 of 3 carried an org, the collection has a 90-day TTL,
     * and the model now requires the field (with NO default — a default is
     * exactly how `Candidate.organizationId` acquired a silent shared fallback).
     */
    if (!ctxOrg || !campOrg || ctxOrg !== campOrg) {
        return {
            ok: false,
            code: 'HEADHUNTER_CONTEXT_ORG_MISMATCH',
            message:
                'This invitation was created for a different organization and cannot be used here.',
        };
    }

    /*
     * A context minted before share links carried a campaign has none. It is
     * still org-proven by the check above, so it is allowed through rather than
     * stranding a link a recruiter already sent. Every context minted after this
     * change carries one, because `/sourcing-context` now requires it.
     */
    if (ctxCampaign && campId && ctxCampaign !== campId) {
        return {
            ok: false,
            code: 'HEADHUNTER_CONTEXT_CAMPAIGN_MISMATCH',
            message:
                'This invitation was created for a different job and cannot be used here.',
        };
    }

    return OK;
}
