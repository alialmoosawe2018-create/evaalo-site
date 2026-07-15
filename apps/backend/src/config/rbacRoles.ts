/**
 * RBAC roles & permissions — single source of truth (backend).
 *
 * This file mirrors the contract that the Clerk Dashboard `publicMetadata`
 * follows for every user:
 *   {
 *     role: 'OWNER' | 'HR_MANAGER' | 'RECRUITER' | 'VIEWER',
 *     permissions: string[]
 *   }
 *
 * The JWT template `evaalo-backend` (configured in Clerk Dashboard) exposes
 * both fields as session claims, so the backend can authorize without an
 * additional Clerk API round-trip per request.
 *
 * Frontend mirror lives at:
 *   apps/frontend/src/contexts/rbacRoles.js
 */

export type Permission =
    | 'candidate.read'
    | 'candidate.write'
    | 'candidate.delete'
    | 'interview.read'
    | 'interview.create'
    | 'interview.delete'
    | 'campaign.read'
    | 'campaign.write'
    | 'campaign.delete'
    | 'headhunter.search'
    | 'headhunter.export'
    | 'headhunter.contact'
    | 'cvComparison.compare'
    | 'campaignCompare.run'
    | 'integrations.manage'
    | 'members.read'
    | 'members.write'
    | 'billing.read'
    | 'billing.write'
    | 'settings.write'
    | 'audit.read';

export type Role = 'OWNER' | 'HR_MANAGER' | 'RECRUITER' | 'VIEWER';

/** Default permission bundles per role (used for seeding new users). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    OWNER: [
        'candidate.read',
        'candidate.write',
        'candidate.delete',
        'interview.read',
        'interview.create',
        'interview.delete',
        'campaign.read',
        'campaign.write',
        'campaign.delete',
        'headhunter.search',
        'headhunter.export',
        'headhunter.contact',
        'cvComparison.compare',
        'campaignCompare.run',
        'integrations.manage',
        'members.read',
        'members.write',
        'billing.read',
        'billing.write',
        'settings.write',
        'audit.read',
    ],
    HR_MANAGER: [
        'candidate.read',
        'candidate.write',
        'candidate.delete',
        'interview.read',
        'interview.create',
        'interview.delete',
        'campaign.read',
        'campaign.write',
        'headhunter.search',
        'headhunter.export',
        'headhunter.contact',
        'cvComparison.compare',
        'campaignCompare.run',
        'integrations.manage',
        'members.read',
        'audit.read',
    ],
    RECRUITER: [
        'candidate.read',
        'candidate.write',
        'interview.read',
        'interview.create',
        'campaign.read',
        'headhunter.search',
        'headhunter.contact',
        'cvComparison.compare',
        'campaignCompare.run',
    ],
    VIEWER: [
        'candidate.read',
        'interview.read',
        'campaign.read',
        'members.read',
    ],
};

export const DEFAULT_ROLE: Role = 'HR_MANAGER';

export function isValidRole(role: unknown): role is Role {
    return typeof role === 'string' && role in ROLE_PERMISSIONS;
}

/** Maps Clerk org roles (org:admin) and publicMetadata roles to internal Role. */
export function normalizeClerkRole(role: unknown): Role {
    if (typeof role !== 'string' || !role.trim()) {
        return DEFAULT_ROLE;
    }
    const trimmed = role.trim();
    if (isValidRole(trimmed)) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower === 'org:admin' || lower === 'org:owner' || lower === 'admin') {
        return 'OWNER';
    }
    if (lower === 'org:member' || lower === 'member') {
        return 'RECRUITER';
    }
    return DEFAULT_ROLE;
}

export function permissionsForRole(role: string | undefined | null): Permission[] {
    return ROLE_PERMISSIONS[normalizeClerkRole(role)];
}
