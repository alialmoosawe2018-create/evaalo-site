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
export function orgScopedQuery<T extends Record<string, unknown>>(
    req: Request,
    baseQuery: T = {} as T
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
