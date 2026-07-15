// ============================================
// ملف: types/clerkWebhookEvents.ts
// الوظيفة: أنواع payload لـ Clerk webhooks + نوع داخلي خفيف للـ dispatch.
// ============================================

export interface ClerkEmailAddress {
    id?: string;
    email_address?: string;
}

export interface ClerkUserPayload {
    id?: string;
    primary_email_address_id?: string;
    email_addresses?: ClerkEmailAddress[];
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string;
    unsafe_metadata?: {
        companyName?: string;
    };
    public_metadata?: {
        role?: string;
        permissions?: string[];
        profileComplete?: boolean;
    };
    deleted?: boolean;
}

export interface ClerkOrgMembershipPayload {
    id?: string;
    role?: string;
    public_user_data?: { user_id?: string };
    organization?: { id?: string; slug?: string };
}

export type ClerkUserEventType = 'user.created' | 'user.updated' | 'user.deleted';
export type ClerkMembershipEventType =
    | 'organizationMembership.created'
    | 'organizationMembership.updated'
    | 'organizationMembership.deleted';
export type ClerkOrgEventType =
    | 'organization.created'
    | 'organization.updated'
    | 'organization.deleted';

export type ClerkWebhookEvent =
    | { type: ClerkUserEventType; data: ClerkUserPayload }
    | {
          type: ClerkMembershipEventType | ClerkOrgEventType;
          data: ClerkOrgMembershipPayload & ClerkUserPayload & { name?: string; slug?: string };
      };

/**
 * عقد داخلي خفيف للـ dispatch — يفصل Clerk shape عن منطق المعالجة.
 * أي تغيير في Clerk payload لاحقاً يُمتص هنا فقط.
 */
export type InternalClerkEvent =
    | { kind: 'USER_UPSERT'; user: ClerkUserPayload; clerkEventType: ClerkUserEventType }
    | { kind: 'USER_DELETE'; userId: string; clerkEventType: ClerkUserEventType }
    | {
          kind: 'MEMBERSHIP';
          op: 'created' | 'updated' | 'deleted';
          payload: ClerkOrgMembershipPayload;
          clerkEventType: ClerkMembershipEventType;
      }
    | { kind: 'NOOP'; clerkEventType: string };

/**
 * تحويل Clerk event → internal event بدون أي IO.
 */
export function normalizeClerkEvent(event: ClerkWebhookEvent): InternalClerkEvent {
    switch (event.type) {
        case 'user.created':
        case 'user.updated':
            return { kind: 'USER_UPSERT', user: event.data, clerkEventType: event.type };
        case 'user.deleted': {
            const id = (event.data as ClerkUserPayload).id;
            if (!id) return { kind: 'NOOP', clerkEventType: event.type };
            return { kind: 'USER_DELETE', userId: id, clerkEventType: event.type };
        }
        case 'organizationMembership.created':
            return {
                kind: 'MEMBERSHIP',
                op: 'created',
                payload: event.data as ClerkOrgMembershipPayload,
                clerkEventType: event.type,
            };
        case 'organizationMembership.updated':
            return {
                kind: 'MEMBERSHIP',
                op: 'updated',
                payload: event.data as ClerkOrgMembershipPayload,
                clerkEventType: event.type,
            };
        case 'organizationMembership.deleted':
            return {
                kind: 'MEMBERSHIP',
                op: 'deleted',
                payload: event.data as ClerkOrgMembershipPayload,
                clerkEventType: event.type,
            };
        case 'organization.created':
        case 'organization.updated':
        case 'organization.deleted':
            // المنظمات نفسها لا تُخزَّن في Mongo حالياً — Clerk = source of truth.
            return { kind: 'NOOP', clerkEventType: event.type };
        default:
            return { kind: 'NOOP', clerkEventType: (event as { type?: string }).type || 'unknown' };
    }
}
