// ============================================
// ملف: middleware/orgScope.ts
// الوظيفة: helpers لتصفية استعلامات Mongo بالـ organizationId الحالي.
// ============================================

import type { Request } from 'express';
import { getOrgId, getClerkUserId } from './auth.js';

/**
 * يدمج organizationId الحالي في filter الـ Mongoose، لضمان عزل multi-tenant.
 *
 * مثال:
 *   const candidates = await Candidate.find(orgScopedQuery(req, { status: 'pending' }));
 */
/**
 * ⚠️ `organizationId` is FORBIDDEN in `baseQuery` — the type makes it a compile error.
 *
 * The session org is spread LAST, so anything passed in was silently overwritten.
 * A caller in `routes/candidates.ts` did pass the CAMPAIGN's org here, believing it
 * would scope the lookup; it was discarded, the search ran in the submitter's own
 * org, and on 2026-09-16 an application plus its evaluation were filed under the
 * wrong tenant because the applicant happened to be signed into another account.
 * This function scopes to the SESSION and only the session. When some other org is
 * authoritative — a campaign's, say — query it directly instead of calling this.
 */
export function orgScopedQuery<T extends Record<string, unknown>>(
    req: Request,
    baseQuery: T & { organizationId?: never } = {} as T
): T & { organizationId: string } {
    return { ...baseQuery, organizationId: getOrgId(req) };
}

/**
 * يعيد الحقول التي تُضاف لكل مستند جديد تُنشئه الـ routes تلقائيًا.
 */
export function orgScopedDefaults(req: Request) {
    return {
        organizationId: getOrgId(req),
        createdByClerkUserId: getClerkUserId(req),
    };
}
