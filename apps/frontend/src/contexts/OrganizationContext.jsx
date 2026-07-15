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

function readFromClerkGlobal() {
    if (typeof window === 'undefined') return null;
    const clerk = window.Clerk;
    if (!clerk || !clerk.session) return null;

    const orgMembership = clerk.session?.lastActiveOrganizationId
        ? clerk.user?.organizationMemberships?.find(
              (m) => m.organization?.id === clerk.session.lastActiveOrganizationId
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
            const next = readFromClerkGlobal();
            if (!cancelled) {
                setState(next || MOCK_FALLBACK);
            }
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
