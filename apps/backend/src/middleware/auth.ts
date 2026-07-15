// ============================================
// ملف: middleware/auth.ts
// الوظيفة: Helpers لقراءة الـ Clerk session claims من الطلب.
// ============================================
//
// ملاحظة: المشروع لم يُفعّل بعد @clerk/express في المرحلة 1. هذا الـ helper
// مبني ليعمل بسلاسة سواء كان clerkMiddleware مفعّلًا (req.auth موجود) أو
// مؤجَّل (نعتمد على ENV/default org). عند تفعيل المرحلة 1:
//   app.use(clerkMiddleware());
//   app.use('/api/candidates', requireAuth(), candidatesRouter);
// — لا تحتاج تعديل هذه الـ helpers.

import type { Request } from 'express';
import {
    DEFAULT_ORG_ID,
    SYSTEM_ACTOR_ID,
    devOrgIdForUser,
    isDevOrgIsolationEnabled,
} from '../config/multiTenant.js';
import { normalizeClerkRole, permissionsForRole } from '../config/rbacRoles.js';

export interface ClerkAuthContext {
    userId: string;
    email?: string;
    orgId: string;
    orgSlug?: string;
    role?: string;
    permissions: string[];
}

function headerString(req: Request, name: string): string | undefined {
    const headers = req.headers;
    if (!headers) return undefined;
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
    return undefined;
}

/**
 * Dev-only fallback: apiClient sends X-Clerk-User-Id when JWT verification is skipped.
 * Maps to dev_org_<userId> instead of shared org_default. Never used in production.
 */
function resolveDevClerkUserIdFromHeader(req: Request): string | undefined {
    if (process.env.NODE_ENV === 'production') return undefined;
    if (!isDevOrgIsolationEnabled()) return undefined;
    const headerId = headerString(req, 'x-clerk-user-id');
    if (headerId?.startsWith('user_')) return headerId;
    return undefined;
}

function resolveDevEmailFromHeader(req: Request): string | undefined {
    if (process.env.NODE_ENV === 'production') return undefined;
    const email = headerString(req, 'x-user-email');
    return email?.trim().toLowerCase() || undefined;
}

/**
 * يقرأ req.auth الذي يحقنه @clerk/express. عند غياب الـ middleware (مرحلة dev)
 * يُعيد سياقًا افتراضيًا يستخدم DEFAULT_ORG_ID و SYSTEM_ACTOR_ID لتجنب كسر التدفقات
 * التي لم تُحمى بعد بـ requireAuth().
 */
export function getAuthContext(req: Request): ClerkAuthContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (req as any).auth as
        | {
              userId?: string;
              sessionClaims?: {
                  email?: string;
                  orgId?: string;
                  orgSlug?: string;
                  role?: string;
                  permissions?: string[] | string;
              };
              orgId?: string;
              orgSlug?: string;
              orgRole?: string;
          }
        | undefined;

    const claims = auth?.sessionClaims;
    const rawPerms = claims?.permissions;
    let permissions = Array.isArray(rawPerms)
        ? rawPerms.filter((p): p is string => typeof p === 'string')
        : typeof rawPerms === 'string' && rawPerms.trim()
          ? rawPerms.split(',').map((p) => p.trim()).filter(Boolean)
          : [];

    const normalizedRole = normalizeClerkRole(claims?.role || auth?.orgRole);
    if (permissions.length === 0) {
        permissions = [...permissionsForRole(normalizedRole)];
    }

    const devHeaderUserId = resolveDevClerkUserIdFromHeader(req);
    const userId = auth?.userId || devHeaderUserId || SYSTEM_ACTOR_ID;
    const clerkOrgId = claims?.orgId || auth?.orgId;

    let orgId: string;
    if (clerkOrgId) {
        orgId = clerkOrgId;
    } else if (process.env.NODE_ENV !== 'production') {
        if (isDevOrgIsolationEnabled() && userId !== SYSTEM_ACTOR_ID) {
            orgId = devOrgIdForUser(userId);
        } else {
            orgId = DEFAULT_ORG_ID;
        }
    } else {
        // Production fail-closed: never fall back to shared org_default.
        orgId = '';
    }

    let role = normalizedRole;
    let effectivePermissions = permissions;
    // Local dev: each dev_org_<userId> tenant acts as sole OWNER for billing tests.
    if (
        process.env.NODE_ENV !== 'production' &&
        isDevOrgIsolationEnabled() &&
        userId !== SYSTEM_ACTOR_ID &&
        !clerkOrgId
    ) {
        role = 'OWNER';
        effectivePermissions = [...permissionsForRole('OWNER')];
    }

    return {
        userId,
        email: claims?.email || resolveDevEmailFromHeader(req),
        orgId,
        orgSlug: claims?.orgSlug || auth?.orgSlug,
        role,
        permissions: effectivePermissions,
    };
}

export function getClerkUserId(req: Request): string {
    return getAuthContext(req).userId;
}

export function getOrgId(req: Request): string {
    return getAuthContext(req).orgId;
}

/** True when production has no verified Clerk org (billing must fail-closed). */
export function isMissingProductionOrg(orgId: string): boolean {
    return (
        process.env.NODE_ENV === 'production' &&
        (!orgId || orgId === DEFAULT_ORG_ID)
    );
}

export function hasPermission(req: Request, permission: string): boolean {
    const { permissions } = getAuthContext(req);
    return permissions.includes(permission);
}
