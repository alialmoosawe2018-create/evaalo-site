// ============================================
// File: middleware/resolveOrg.ts
// Purpose: Fallback organization resolver.
//
// A Clerk session can be authenticated while its token carries no active
// organization (the frontend never called setActive, or the token predates
// the membership). In production getAuthContext then fail-closes to an empty
// org, so org-scoped reads/writes break (billing.read 403, organizationId
// required 500) even though the user *is* a member of exactly one org.
//
// This middleware runs after clerkMiddleware: when an authenticated request
// has no org in its token, it looks up the user's Clerk organization
// memberships and — if there is exactly one — stashes it on the request so
// getAuthContext can honor it. Results are cached per user to avoid a Clerk
// API round-trip on every request. Never guesses when the user belongs to
// multiple orgs (an explicit active org / switcher must decide).
// ============================================

import type { Request, Response, NextFunction } from 'express';
import { getAuth, clerkClient } from '@clerk/express';

export interface ResolvedOrg {
    id: string;
    rol?: string;
}

const CACHE_TTL_MS = Number(process.env.ORG_RESOLVE_CACHE_TTL_MS) || 5 * 60 * 1000;
const cache = new Map<string, { org: ResolvedOrg | null; expiresAt: number }>();

async function lookupSingleOrg(userId: string): Promise<ResolvedOrg | null> {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.org;

    let org: ResolvedOrg | null = null;
    try {
        const memberships = await clerkClient.users.getOrganizationMembershipList({
            userId,
            limit: 10,
        });
        const list = memberships?.data ?? [];
        // Only auto-resolve an unambiguous single-org membership.
        if (list.length === 1 && list[0]?.organization?.id) {
            org = { id: list[0].organization.id, rol: list[0].role };
        }
    } catch {
        org = null;
    }

    cache.set(userId, { org, expiresAt: Date.now() + CACHE_TTL_MS });
    return org;
}

export async function resolveOrgFallback(
    req: Request,
    _res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = getAuth(req);
        const userId = auth?.userId;
        if (!userId) return next();

        // Already have an org in the token → nothing to do.
        const claims = auth.sessionClaims as { orgId?: string; o?: { id?: string } } | undefined;
        if (auth.orgId || claims?.orgId || claims?.o?.id) return next();

        const org = await lookupSingleOrg(userId);
        if (org) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (req as any).__resolvedOrg = org;
        }
    } catch {
        /* stay anonymous on any failure — never block the request */
    }
    next();
}

/** Test/maintenance hook: clear the per-user org cache. */
export function clearResolvedOrgCache(): void {
    cache.clear();
}
