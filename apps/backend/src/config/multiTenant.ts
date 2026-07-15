/**
 * Multi-tenancy constants — single source of truth.
 *
 * Until Phase 1 (Clerk auth) is fully wired, requests reaching the backend
 * may not carry an organization context. We default new documents to
 * `org_default` so existing flows keep working during the transition. The
 * migration script (`scripts/migrateAddOrgId.ts`) backfills the same value
 * onto historical documents.
 *
 * Before production: run a script that creates a real Clerk org per tenant
 * and updates `organizationId` accordingly.
 */

export const DEFAULT_ORG_ID = 'org_default';
export const SYSTEM_ACTOR_ID = 'system';

/** Per-user dev org when ENFORCE_AUTH=off — prevents shared billing on org_default. */
export function devOrgIdForUser(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    return `dev_org_${safe}`;
}

export function isDevOrgIsolationEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const explicit = process.env.ENFORCE_AUTH;
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.toLowerCase() === 'off';
    }
    return !process.env.CLERK_SECRET_KEY;
}
