/**
 * Head Hunter sourcing context — internal (org-scoped) lookups only.
 * Public interview flow resolves context server-side via Candidate.headHunterContextId
 * (see videoInterview.ts loadHeadHunterContextForCandidate). No public HTTP lookup by contextId.
 */

import HeadHunterSourcingContext from '../models/HeadHunterSourcingContext.js';

const CONTEXT_ID_RE = /^[a-f0-9]{8,64}$/i;

export function isValidHeadHunterContextId(id: string): boolean {
    return Boolean(id && CONTEXT_ID_RE.test(id));
}

export type HeadHunterSourcingContextDoc = {
    contextId: string;
    organizationId?: string;
    campaignId?: string;
    position?: string;
    candidateProfile?: Record<string, unknown>;
    searchCriteria?: Record<string, unknown>;
    createdByClerkUserId?: string;
};

export async function findHeadHunterSourcingContextById(
    contextId: string
): Promise<HeadHunterSourcingContextDoc | null> {
    if (!isValidHeadHunterContextId(contextId)) return null;
    const ctx = await HeadHunterSourcingContext.findOne({ contextId }).lean();
    if (!ctx) return null;
    return {
        contextId: String(ctx.contextId),
        organizationId: ctx.organizationId ? String(ctx.organizationId) : undefined,
        campaignId: ctx.campaignId ? String(ctx.campaignId) : undefined,
        position: ctx.position ? String(ctx.position) : undefined,
        candidateProfile: (ctx.candidateProfile as Record<string, unknown> | undefined) || undefined,
        searchCriteria: (ctx.searchCriteria as Record<string, unknown> | undefined) || undefined,
        createdByClerkUserId: ctx.createdByClerkUserId
            ? String(ctx.createdByClerkUserId)
            : undefined,
    };
}

export function isHeadHunterContextOwnedByOrganization(
    ctx: { organizationId?: string },
    organizationId: string
): boolean {
    const ctxOrg = (ctx.organizationId || '').trim();
    const reqOrg = (organizationId || '').trim();
    return Boolean(ctxOrg && reqOrg && ctxOrg === reqOrg);
}

/** Internal recruiter view — requires matching organizationId. */
export async function getInternalHeadHunterSourcingContext(
    contextId: string,
    organizationId: string
): Promise<HeadHunterSourcingContextDoc | null> {
    const ctx = await findHeadHunterSourcingContextById(contextId);
    if (!ctx) return null;
    if (!isHeadHunterContextOwnedByOrganization(ctx, organizationId)) return null;
    return ctx;
}
