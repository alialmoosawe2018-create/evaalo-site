/**
 * OrganizationContext — insulation layer above Clerk's organization model.
 *
 * UI components should call `useOrganization()` exported from this file (NOT
 * from `@clerk/clerk-react` directly). This keeps the surface stable:
 *   {
 *     org: { id, slug, name } | null,
 *     role: string | null,
 *     permissions: string[],
 *     hasPermission: (perm: string) => boolean,
 *     switchOrg: (orgId: string) => Promise<void>,
 *     loading: boolean,
 *   }
 *
 * Until Phase 1 (Clerk SDK install) is complete, this provider falls back to
 * permissive defaults so existing flows (mock auth) keep working. Once Clerk
 * is wired (window.Clerk available), the provider reads org/role/permissions
 * from the active session.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ROLE, normalizeClerkRole, permissionsForRole } from './rbacRoles';

const OrganizationContext = createContext(null);

const MOCK_FALLBACK = {
    org: { id: 'org_default', slug: 'default', name: 'Default Organization' },
    role: DEFAULT_ROLE,
    permissions: permissionsForRole(DEFAULT_ROLE),
};

// One-shot guard so we attempt organization *creation* at most once per page
// load (activation is idempotent and may repeat; creation must not).
let orgCreationAttempted = false;

/** Derives a sensible organization name from the Clerk user. */
function deriveOrgName(user) {
    const meta = user?.unsafeMetadata || {};
    const company =
        (typeof meta.company === 'string' && meta.company.trim()) ||
        (typeof meta.companyName === 'string' && meta.companyName.trim()) ||
        '';
    if (company) return company;
    const person =
        (user?.fullName && user.fullName.trim()) ||
        (user?.firstName && user.firstName.trim()) ||
        user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
        'My';
    return `${person}'s Organization`;
}

/**
 * Ensures the Clerk session has an *active* organization.
 *
 * Two org-less states both make the JWT carry no `org_id`, so the backend
 * fail-closes with ORG_REQUIRED (billing 403 / campaign create 500):
 *   1. The user is a member of an org but no org is active in the session
 *      (activeOrganizationId = null) → activate one.
 *   2. A brand-new user is a member of NO org (e.g. fresh signup) → create one,
 *      then activate it. Guarded to run at most once per load.
 *
 * Returns true if it changed the session (caller re-reads afterwards).
 */
async function ensureActiveOrg() {
    if (typeof window === 'undefined') return false;
    const clerk = window.Clerk;
    if (!clerk || !clerk.session || !clerk.user || typeof clerk.setActive !== 'function') {
        return false;
    }

    // Already have an active org in the session → nothing to do.
    if (clerk.organization?.id) return false;

    const memberships = clerk.user?.organizationMemberships;
    // Memberships not loaded yet → wait for a later sync (avoid creating a dup).
    if (!Array.isArray(memberships)) return false;

    // Case 1: has memberships → activate the right one.
    if (memberships.length > 0) {
        const preferred =
            (clerk.session?.lastActiveOrganizationId &&
                memberships.find(
                    (m) => m.organization?.id === clerk.session.lastActiveOrganizationId
                )) ||
            memberships[0];
        const orgId = preferred?.organization?.id;
        if (!orgId) return false;
        try {
            await clerk.setActive({ organization: orgId });
            return true;
        } catch (err) {
            console.warn('[OrganizationContext] activate org failed:', err?.message || err);
            return false;
        }
    }

    // Case 2: no memberships at all → provision one (once), then activate.
    if (orgCreationAttempted || typeof clerk.createOrganization !== 'function') return false;
    orgCreationAttempted = true;
    try {
        const org = await clerk.createOrganization({ name: deriveOrgName(clerk.user) });
        await clerk.setActive({ organization: org.id });
        return true;
    } catch (err) {
        // Most likely cause: Clerk instance disallows client-side org creation.
        console.warn('[OrganizationContext] create org failed:', err?.message || err);
        return false;
    }
}

function readFromClerkGlobal() {
    if (typeof window === 'undefined') return null;
    const clerk = window.Clerk;
    if (!clerk || !clerk.session) return null;

    const activeOrgId =
        clerk.organization?.id || clerk.session?.lastActiveOrganizationId || null;
    const orgMembership = activeOrgId
        ? clerk.user?.organizationMemberships?.find(
              (m) => m.organization?.id === activeOrgId
          )
        : clerk.user?.organizationMemberships?.[0];

    const org = orgMembership?.organization
        ? {
              id: orgMembership.organization.id,
              slug: orgMembership.organization.slug,
              name: orgMembership.organization.name,
          }
        : null;

    const rawRole = orgMembership?.role || clerk.user?.publicMetadata?.role || null;
    const role = normalizeClerkRole(rawRole);

    const explicitPerms = Array.isArray(clerk.user?.publicMetadata?.permissions)
        ? clerk.user.publicMetadata.permissions.filter((p) => typeof p === 'string')
        : [];
    const permissions =
        explicitPerms.length > 0 ? explicitPerms : permissionsForRole(role);

    return { org, role, permissions };
}

export const OrganizationProvider = ({ children }) => {
    const [state, setState] = useState(() => readFromClerkGlobal() || MOCK_FALLBACK);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let cancelled = false;

        const sync = () => {
            // Self-heal: activate an org if the session has none but the user is a
            // member of one. setActive() updates window.Clerk, then we re-read.
            ensureActiveOrg()
                .then((changed) => {
                    if (cancelled) return;
                    const next = readFromClerkGlobal();
                    setState(next || MOCK_FALLBACK);
                    // A freshly activated org means the token now carries org_id;
                    // read again on the next tick to reflect the settled session.
                    if (changed) {
                        setTimeout(() => {
                            if (!cancelled) setState(readFromClerkGlobal() || MOCK_FALLBACK);
                        }, 250);
                    }
                })
                .catch(() => {
                    if (!cancelled) setState(readFromClerkGlobal() || MOCK_FALLBACK);
                });
        };

        // Initial pickup once Clerk is ready.
        sync();
        const interval = setInterval(sync, 5000);

        // Clerk emits an 'addListener' API once loaded; we attach if present.
        const detach = window.Clerk?.addListener?.(sync);

        return () => {
            cancelled = true;
            clearInterval(interval);
            if (typeof detach === 'function') detach();
        };
    }, []);

    const switchOrg = useCallback(async (orgId) => {
        if (typeof window === 'undefined' || !window.Clerk?.setActive) {
            console.warn('[OrganizationContext] switchOrg called but Clerk is not loaded');
            return;
        }
        setLoading(true);
        try {
            await window.Clerk.setActive({ organization: orgId });
            const next = readFromClerkGlobal();
            setState(next || MOCK_FALLBACK);
        } finally {
            setLoading(false);
        }
    }, []);

    const hasPermission = useCallback(
        (perm) => {
            if (!perm) return true;
            return state.permissions?.includes(perm);
        },
        [state.permissions]
    );

    const value = useMemo(
        () => ({
            org: state.org,
            role: state.role,
            permissions: state.permissions,
            hasPermission,
            switchOrg,
            loading,
        }),
        [state, hasPermission, switchOrg, loading]
    );

    return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
};

export const useOrganization = () => {
    const ctx = useContext(OrganizationContext);
    if (!ctx) {
        throw new Error('useOrganization must be used inside <OrganizationProvider>');
    }
    return ctx;
};

export default OrganizationContext;
