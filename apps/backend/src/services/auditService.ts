// ============================================
// ملف: services/auditService.ts
// الوظيفة: تسجيل أحداث المراجعة بشكل غير معطّل (fire-and-forget).
// ============================================

import type { Request } from 'express';
import AuditLog from '../models/AuditLog.js';
import { getAuthContext } from '../middleware/auth.js';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';

export interface AuditLogInput {
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    /**
     * المنظّمة حين لا تأتي من الجلسة.
     *
     * التقديم العام لا يحمل جلسة موقَّعة، فـ`ctx.orgId` يعود فارغاً و`organizationId`
     * حقلٌ مطلوب في النموذج — فكان كل سجلّ تدقيق لتقديمٍ عام يفشل بصمت
     * («AuditLog validation failed: Path organizationId is required»، 2026-09-10).
     * المنادي يعرف المنظّمة الصحيحة من الحملة، فليمرّرها.
     */
    organizationId?: string;
}

/**
 * يسجل حدث RBAC/ATS بدون أن يُعطّل الـ request في حال فشل المراجعة.
 * يُستدعى من الـ routes الحساسة (delete, role change, billing).
 */
export async function logAudit(req: Request, input: AuditLogInput): Promise<void> {
    try {
        const ctx = getAuthContext(req);
        await AuditLog.create({
            // الجلسة أوّلاً؛ ثم ما مرّره المنادي (المسار العام بلا جلسة)؛ ثم الافتراضي
            // كي لا يسقط السجلّ أبداً — فقدان أثر المراجعة أسوأ من نسبته للمنظّمة الافتراضية.
            organizationId: ctx.orgId || input.organizationId?.trim() || DEFAULT_ORG_ID,
            actorClerkUserId: ctx.userId,
            actorEmail: ctx.email,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            metadata: input.metadata,
            ip: (req.ip || req.headers['x-forwarded-for'] || '').toString().split(',')[0]?.trim(),
            userAgent: (req.headers['user-agent'] || '').toString(),
        });
    } catch (err) {
        console.error('[auditService] failed to write log:', err);
    }
}

export interface ClerkWebhookAuditInput {
    /** لو الحدث على مستوى مستخدم بدون org نشط، اتركه undefined → سيُحفظ DEFAULT_ORG_ID. */
    organizationId?: string;
    action: string; // مثلاً 'organizationMembership.updated'
    targetType: string; // 'user' عادةً
    targetId?: string; // clerkUserId
    metadata?: Record<string, unknown>; // {before, after, svixId, clerkEventType}
}

/**
 * تسجيل حدث Clerk webhook (system-initiated) بدون Request context.
 * `actorClerkUserId` = SYSTEM_ACTOR_ID لأن الحدث جاء من Clerk لا من مستخدم HR.
 * fire-and-forget — لا يُسقط معالجة الـ webhook عند فشل المراجعة.
 */
export async function logClerkWebhookAudit(input: ClerkWebhookAuditInput): Promise<void> {
    try {
        await AuditLog.create({
            organizationId: input.organizationId || DEFAULT_ORG_ID,
            actorClerkUserId: SYSTEM_ACTOR_ID,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            metadata: input.metadata,
        });
    } catch (err) {
        console.error('[auditService] failed to write clerk webhook audit:', err);
    }
}
