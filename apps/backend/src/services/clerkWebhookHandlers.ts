// ============================================
// ملف: services/clerkWebhookHandlers.ts
// الوظيفة: business logic لمعالجة أحداث Clerk بعد التحقق من svix.
// الفصل عن الـ route يُبقي clerkWebhooks.ts رفيع: verify → claim → dispatch.
// ============================================

import User from '../models/User.js';
import { permissionsForRole } from '../config/rbacRoles.js';
import { sanitizeRole } from '../middleware/rbac.js';
import { logClerkWebhookAudit } from './auditService.js';
import type {
    ClerkUserPayload,
    ClerkOrgMembershipPayload,
    ClerkUserEventType,
    ClerkMembershipEventType,
} from '../types/clerkWebhookEvents.js';

export function getPrimaryEmail(user: ClerkUserPayload): string | undefined {
    const primaryId = user.primary_email_address_id;
    const list = user.email_addresses || [];
    const primary = list.find((e) => e.id === primaryId) || list[0];
    return primary?.email_address?.toLowerCase().trim();
}

function getFullName(user: ClerkUserPayload): string | undefined {
    const parts = [user.first_name, user.last_name].filter(Boolean).map((s) => String(s).trim());
    const joined = parts.join(' ').trim();
    return joined || undefined;
}

function getCompanyName(user: ClerkUserPayload): string | undefined {
    const raw = user.unsafe_metadata?.companyName;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed || undefined;
}

function getCompanyDescription(user: ClerkUserPayload): string | undefined {
    const raw = (user.unsafe_metadata as Record<string, unknown> | undefined)?.companyDescription;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().slice(0, 2000);
    return trimmed || undefined;
}

export function computeProfileComplete(
    fullName?: string,
    companyName?: string,
    email?: string
): boolean {
    return Boolean(
        email?.trim() &&
            (fullName?.trim().length ?? 0) >= 2 &&
            (companyName?.trim().length ?? 0) >= 2
    );
}

export interface AuditContext {
    svixId: string;
}

/**
 * نسخ/تحديث مستخدم Clerk في collection users.
 * منطقياً مطابق للنسخة السابقة في routes/clerkWebhooks.ts.
 */
export async function upsertUserFromClerk(
    payload: ClerkUserPayload,
    clerkEventType: ClerkUserEventType,
    ctx: AuditContext
): Promise<void> {
    if (!payload.id) return;
    const email = getPrimaryEmail(payload);
    if (!email) {
        console.warn('[clerkWebhooks] user upsert skipped — no primary email', payload.id);
        return;
    }
    const sanitizedRole = sanitizeRole(payload.public_metadata?.role);
    const permsOverride = payload.public_metadata?.permissions;
    const permissions =
        Array.isArray(permsOverride) && permsOverride.length > 0
            ? permsOverride.filter((p): p is string => typeof p === 'string')
            : sanitizedRole
              ? permissionsForRole(sanitizedRole)
              : [];

    const fullName = getFullName(payload);
    const companyName = getCompanyName(payload);
    const companyDescription = getCompanyDescription(payload);
    const profileComplete =
        payload.public_metadata?.profileComplete === true ||
        computeProfileComplete(fullName, companyName, email);

    const before = await User.findOne({ clerkUserId: payload.id }).lean();

    const updated = await User.findOneAndUpdate(
        { clerkUserId: payload.id },
        {
            $set: {
                clerkUserId: payload.id,
                email,
                fullName,
                companyName,
                companyDescription,
                profileComplete,
                imageUrl: payload.image_url,
                role: sanitizedRole || undefined,
                permissions,
                deletedAt: undefined,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    await logClerkWebhookAudit({
        organizationId: before?.primaryOrgId || updated?.primaryOrgId,
        action: clerkEventType, // 'user.created' | 'user.updated'
        targetType: 'user',
        targetId: payload.id,
        metadata: {
            clerkEventType,
            svixId: ctx.svixId,
            before: before
                ? { email: before.email, role: before.role, fullName: before.fullName }
                : null,
            after: updated
                ? { email: updated.email, role: updated.role, fullName: updated.fullName }
                : null,
        },
    });
}

export async function softDeleteUser(
    clerkUserId: string,
    clerkEventType: ClerkUserEventType,
    ctx: AuditContext
): Promise<void> {
    if (!clerkUserId) return;
    const before = await User.findOne({ clerkUserId }).lean();
    // Idempotent: لو سبق حذف السجل نهائياً (مثلاً عبر DELETE /api/users/me)
    // فإن webhook user.deleted المتأخر لا يجب أن يفشل — no-op.
    if (!before) return;
    await User.updateOne({ clerkUserId }, { $set: { deletedAt: new Date() } });
    await logClerkWebhookAudit({
        organizationId: before?.primaryOrgId,
        action: clerkEventType, // 'user.deleted'
        targetType: 'user',
        targetId: clerkUserId,
        metadata: {
            clerkEventType,
            svixId: ctx.svixId,
            before: before ? { email: before.email, role: before.role } : null,
        },
    });
}

export async function applyMembership(
    payload: ClerkOrgMembershipPayload,
    op: 'created' | 'updated' | 'deleted',
    clerkEventType: ClerkMembershipEventType,
    ctx: AuditContext
): Promise<void> {
    const clerkUserId = payload.public_user_data?.user_id;
    const organizationId = payload.organization?.id;
    if (!clerkUserId || !organizationId) return;

    const user = await User.findOne({ clerkUserId });
    if (!user) {
        console.warn('[clerkWebhooks] membership for unknown user', { clerkUserId, organizationId });
        return;
    }

    user.memberships = user.memberships || [];
    const existingIdx = user.memberships.findIndex((m) => m.organizationId === organizationId);
    const beforeMembership = existingIdx >= 0 ? { ...user.memberships[existingIdx] } : null;

    let afterMembership: typeof beforeMembership = null;

    if (op === 'deleted') {
        if (existingIdx >= 0) {
            user.memberships.splice(existingIdx, 1);
        }
        if (user.primaryOrgId === organizationId) {
            user.primaryOrgId = user.memberships[0]?.organizationId;
        }
    } else {
        const role = sanitizeRole(payload.role) || payload.role || '';
        const permissions = role ? permissionsForRole(role) : [];
        const membershipRecord = {
            organizationId,
            role,
            permissions,
            joinedAt: existingIdx >= 0 ? user.memberships[existingIdx].joinedAt : new Date(),
        };
        if (existingIdx >= 0) {
            user.memberships[existingIdx] = membershipRecord;
        } else {
            user.memberships.push(membershipRecord);
        }
        if (!user.primaryOrgId) user.primaryOrgId = organizationId;
        afterMembership = membershipRecord;
    }

    await user.save();

    await logClerkWebhookAudit({
        organizationId,
        action: clerkEventType, // 'organizationMembership.created' | ...
        targetType: 'user',
        targetId: clerkUserId,
        metadata: {
            clerkEventType,
            svixId: ctx.svixId,
            before: beforeMembership,
            after: afterMembership,
        },
    });
}
