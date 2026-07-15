/**
 * RBAC roles & permissions — frontend mirror.
 * Must stay in sync with apps/backend/src/config/rbacRoles.ts.
 */

export const ROLES = Object.freeze({
    OWNER: 'OWNER',
    HR_MANAGER: 'HR_MANAGER',
    RECRUITER: 'RECRUITER',
    VIEWER: 'VIEWER',
});

export const PERMISSIONS = Object.freeze({
    CANDIDATE_READ: 'candidate.read',
    CANDIDATE_WRITE: 'candidate.write',
    CANDIDATE_DELETE: 'candidate.delete',
    INTERVIEW_READ: 'interview.read',
    INTERVIEW_CREATE: 'interview.create',
    INTERVIEW_DELETE: 'interview.delete',
    CAMPAIGN_READ: 'campaign.read',
    CAMPAIGN_WRITE: 'campaign.write',
    CAMPAIGN_DELETE: 'campaign.delete',
    HEADHUNTER_SEARCH: 'headhunter.search',
    HEADHUNTER_EXPORT: 'headhunter.export',
    HEADHUNTER_CONTACT: 'headhunter.contact',
    CV_COMPARISON_COMPARE: 'cvComparison.compare',
    CAMPAIGN_COMPARE_RUN: 'campaignCompare.run',
    INTEGRATIONS_MANAGE: 'integrations.manage',
    MEMBERS_READ: 'members.read',
    MEMBERS_WRITE: 'members.write',
    BILLING_READ: 'billing.read',
    BILLING_WRITE: 'billing.write',
    SETTINGS_WRITE: 'settings.write',
    AUDIT_READ: 'audit.read',
});

export const ROLE_PERMISSIONS = Object.freeze({
    OWNER: Object.values(PERMISSIONS),
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
    VIEWER: ['candidate.read', 'interview.read', 'campaign.read', 'members.read'],
});

export const DEFAULT_ROLE = ROLES.HR_MANAGER;

export function permissionsForRole(role) {
    const normalized = normalizeClerkRole(role);
    return ROLE_PERMISSIONS[normalized] || ROLE_PERMISSIONS[DEFAULT_ROLE];
}

export function isValidRole(role) {
    return typeof role === 'string' && role in ROLE_PERMISSIONS;
}

/** Maps Clerk org roles (org:admin) and publicMetadata roles to internal ROLES. */
export function normalizeClerkRole(role) {
    if (typeof role !== 'string' || !role.trim()) {
        return DEFAULT_ROLE;
    }
    const trimmed = role.trim();
    if (isValidRole(trimmed)) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower === 'org:admin' || lower === 'org:owner' || lower === 'admin') {
        return ROLES.OWNER;
    }
    if (lower === 'org:member' || lower === 'member') {
        return ROLES.RECRUITER;
    }
    return DEFAULT_ROLE;
}
