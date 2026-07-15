// ============================================
// ملف: middleware/rbac.ts
// الوظيفة: Middleware لفحص الأدوار والصلاحيات من Clerk session claims.
// ============================================
//
// مثال استخدام في route:
//   router.delete('/:id', requirePermission('candidate.delete'), handler);
//   router.post('/admin', requireRole('OWNER', 'HR_MANAGER'), handler);
//
// خلال مرحلة dev (قبل تفعيل @clerk/express)، يمكن ضبط ENV التالية لإطفاء
// الفحص مؤقتًا حتى لا تُكسر التدفقات الموجودة:
//   RBAC_ENFORCEMENT=off    (افتراضي: on)

import type { Request, Response, NextFunction } from 'express';
import { getAuthContext } from './auth.js';
import { isValidRole, normalizeClerkRole } from '../config/rbacRoles.js';

const ENFORCEMENT_ENABLED = (process.env.RBAC_ENFORCEMENT || 'on').toLowerCase() !== 'off';

export function requireRole(...allowed: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!ENFORCEMENT_ENABLED) return next();

        const { role } = getAuthContext(req);
        if (!role || !allowed.includes(role)) {
            return res.status(403).json({
                error: 'forbidden_role',
                requiredAnyOf: allowed,
                currentRole: role || null,
            });
        }
        next();
    };
}

export function requirePermission(...required: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!ENFORCEMENT_ENABLED) return next();

        const { permissions } = getAuthContext(req);
        const missing = required.filter((p) => !permissions.includes(p));
        if (missing.length > 0) {
            return res.status(403).json({
                error: 'forbidden_permission',
                missing,
            });
        }
        next();
    };
}

/**
 * Billing mutations (checkout, cancel, portal plan changes) — Owner only per product policy.
 * Requires billing.write permission AND normalized role OWNER.
 */
export function requireBillingWrite(req: Request, res: Response, next: NextFunction) {
    if (!ENFORCEMENT_ENABLED) return next();

    const { permissions, role } = getAuthContext(req);
    if (!permissions.includes('billing.write')) {
        return res.status(403).json({
            error: 'forbidden_permission',
            missing: ['billing.write'],
        });
    }
    if (normalizeClerkRole(role) !== 'OWNER') {
        return res.status(403).json({
            error: 'forbidden_billing_owner',
            message: 'Only organization owners can manage billing.',
            currentRole: role || null,
        });
    }
    next();
}

/** Helper: فلتر يقبل الأدوار المعرّفة فقط، يُستخدم لتنظيف مدخلات publicMetadata. */
export function sanitizeRole(role: unknown): string | null {
    return isValidRole(role) ? role : null;
}
