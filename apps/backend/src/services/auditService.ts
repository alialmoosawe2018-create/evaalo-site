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
}

/**
 * يسجل حدث RBAC/ATS بدون أن يُعطّل الـ request في حال فشل المراجعة.
 * يُستدعى من الـ routes الحساسة (delete, role change, billing).
 */
export async function logAudit(req: Request, input: AuditLogInput): Promise<void> {
    try {
        const ctx = getAuthContext(req);
        await AuditLog.create({
            organizationId: ctx.orgId,
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
