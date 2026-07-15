// ============================================
// ملف: services/userProfileService.ts
// الوظيفة: قراءة/تحديث ملف المستخدم HR (Clerk + Mongo mirror).
// ============================================

import User from '../models/User.js';
import {
    computeProfileComplete,
    getPrimaryEmail,
    upsertUserFromClerk,
} from './clerkWebhookHandlers.js';
import type { ClerkUserPayload } from '../types/clerkWebhookEvents.js';

export interface UserPreferencesDto {
    dashboardRecentInterviewsClearedAt?: string | null;
}

export interface UserProfileDto {
    fullName: string;
    companyName: string;
    email: string;
    profileComplete: boolean;
    imageUrl?: string;
    preferences?: UserPreferencesDto;
}

function splitFullName(fullName: string): { firstName: string; lastName?: string } {
    const trimmed = fullName.trim();
    const [firstName, ...rest] = trimmed.split(/\s+/);
    return { firstName, lastName: rest.join(' ') || undefined };
}

function clerkUserToPayload(data: Record<string, unknown>): ClerkUserPayload {
    return data as unknown as ClerkUserPayload;
}

async function clerkApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
        throw new Error('CLERK_NOT_CONFIGURED');
    }
    const res = await fetch(`https://api.clerk.com/v1${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`clerk_api_${res.status}`);
        (err as Error & { status: number; body: string }).status = res.status;
        (err as Error & { body: string }).body = text;
        throw err;
    }
    return res.json() as Promise<T>;
}

async function fetchClerkUser(clerkUserId: string): Promise<ClerkUserPayload | null> {
    try {
        const data = await clerkApi<Record<string, unknown>>(`/users/${encodeURIComponent(clerkUserId)}`);
        return clerkUserToPayload(data);
    } catch (err) {
        const status = (err as Error & { status?: number }).status;
        if (status === 404) return null;
        throw err;
    }
}

function docToDto(doc: {
    fullName?: string;
    companyName?: string;
    email: string;
    profileComplete?: boolean;
    imageUrl?: string;
    preferences?: {
        dashboardRecentInterviewsClearedAt?: Date;
    };
}): UserProfileDto {
    const fullName = doc.fullName?.trim() || '';
    const companyName = doc.companyName?.trim() || '';
    const email = doc.email?.trim() || '';
    const profileComplete =
        doc.profileComplete === true || computeProfileComplete(fullName, companyName, email);
    const clearedAt = doc.preferences?.dashboardRecentInterviewsClearedAt;
    return {
        fullName,
        companyName,
        email,
        profileComplete,
        imageUrl: doc.imageUrl,
        preferences: {
            dashboardRecentInterviewsClearedAt: clearedAt ? clearedAt.toISOString() : null,
        },
    };
}

async function ensureMongoMirror(clerkUserId: string, clerkUser?: ClerkUserPayload | null): Promise<void> {
    const existing = await User.findOne({ clerkUserId, deletedAt: { $exists: false } }).lean();
    if (existing) return;

    let payload = clerkUser;
    if (!payload?.id && process.env.CLERK_SECRET_KEY) {
        payload = (await fetchClerkUser(clerkUserId)) ?? undefined;
    }
    if (payload?.id) {
        await upsertUserFromClerk(payload, 'user.updated', { svixId: 'jit-profile-ensure' });
    }
}

async function upsertMongoProfile(
    clerkUserId: string,
    fields: {
        email: string;
        fullName: string;
        companyName: string;
        profileComplete: boolean;
        imageUrl?: string;
    }
): Promise<UserProfileDto> {
    const doc = await User.findOneAndUpdate(
        { clerkUserId },
        {
            $set: {
                clerkUserId,
                email: fields.email.trim().toLowerCase(),
                fullName: fields.fullName || undefined,
                companyName: fields.companyName || undefined,
                profileComplete: fields.profileComplete,
                imageUrl: fields.imageUrl,
                permissions: [],
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return docToDto(doc);
}

export async function getProfileForClerkUser(clerkUserId: string): Promise<UserProfileDto> {
    await ensureMongoMirror(clerkUserId);

    const doc = await User.findOne({ clerkUserId, deletedAt: { $exists: false } }).lean();
    if (doc) {
        return docToDto(doc);
    }

    if (process.env.CLERK_SECRET_KEY) {
        const clerkUser = await fetchClerkUser(clerkUserId);
        if (clerkUser?.id) {
            await upsertUserFromClerk(clerkUser, 'user.updated', { svixId: 'jit-profile-get' });
            const after = await User.findOne({ clerkUserId, deletedAt: { $exists: false } }).lean();
            if (after) return docToDto(after);
        }
    }

    throw new Error('PROFILE_NOT_FOUND');
}

export async function updateProfileForClerkUser(
    clerkUserId: string,
    input: { fullName?: string; companyName?: string }
): Promise<UserProfileDto> {
    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    const companyName = typeof input.companyName === 'string' ? input.companyName.trim() : '';

    if (fullName.length > 0 && fullName.length < 2) {
        throw new Error('INVALID_FULL_NAME');
    }
    if (companyName.length > 0 && companyName.length < 2) {
        throw new Error('INVALID_COMPANY');
    }

    const clerkUser = process.env.CLERK_SECRET_KEY ? await fetchClerkUser(clerkUserId) : null;
    if (!clerkUser?.id && process.env.CLERK_SECRET_KEY) {
        throw new Error('PROFILE_NOT_FOUND');
    }

    await ensureMongoMirror(clerkUserId, clerkUser);

    const existing = await User.findOne({ clerkUserId, deletedAt: { $exists: false } }).lean();
    const email =
        existing?.email ||
        (clerkUser ? getPrimaryEmail(clerkUser) : undefined) ||
        '';

    const mergedFullName = fullName || existing?.fullName?.trim() || getFullNameFromClerk(clerkUser) || '';
    const mergedCompany = companyName || existing?.companyName?.trim() || '';
    const profileComplete = computeProfileComplete(mergedFullName, mergedCompany, email);

    if (!process.env.CLERK_SECRET_KEY) {
        if (!email) throw new Error('PROFILE_NOT_FOUND');
        return upsertMongoProfile(clerkUserId, {
            email,
            fullName: mergedFullName,
            companyName: mergedCompany,
            profileComplete,
            imageUrl: existing?.imageUrl,
        });
    }

    const { firstName, lastName } = splitFullName(mergedFullName || 'User');
    const clerkPayload: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName ?? '',
        unsafe_metadata: {
            ...(clerkUser?.unsafe_metadata || {}),
            companyName: mergedCompany,
        },
        public_metadata: {
            ...(clerkUser?.public_metadata || {}),
            profileComplete,
        },
    };

    try {
        await clerkApi(`/users/${encodeURIComponent(clerkUserId)}`, {
            method: 'PATCH',
            body: JSON.stringify(clerkPayload),
        });
    } catch (clerkErr) {
        console.warn('[userProfile] Clerk PATCH failed — saving to Mongo only:', clerkErr);
        if (!email) throw clerkErr;
        return upsertMongoProfile(clerkUserId, {
            email,
            fullName: mergedFullName,
            companyName: mergedCompany,
            profileComplete,
            imageUrl: clerkUser?.image_url || existing?.imageUrl,
        });
    }

    const refreshed = await fetchClerkUser(clerkUserId);
    if (refreshed?.id) {
        await upsertUserFromClerk(refreshed, 'user.updated', { svixId: 'jit-profile-patch' });
    }

    return getProfileForClerkUser(clerkUserId);
}

function getFullNameFromClerk(user: ClerkUserPayload | null | undefined): string {
    if (!user) return '';
    const parts = [user.first_name, user.last_name].filter(Boolean).map((s) => String(s).trim());
    return parts.join(' ').trim();
}

/** Dev/mock: upsert profile when Clerk is unavailable (ENFORCE_AUTH off). */
export async function upsertDevProfile(
    clerkUserId: string,
    input: { email: string; fullName?: string; companyName?: string }
): Promise<UserProfileDto> {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName?.trim() || '';
    const companyName = input.companyName?.trim() || '';
    const profileComplete = computeProfileComplete(fullName, companyName, email);

    return upsertMongoProfile(clerkUserId, {
        email,
        fullName,
        companyName,
        profileComplete,
    });
}

/** إخفاء أحدث المقابلات من لوحة التحكم — لا يحذف المرشحين. */
export async function clearDashboardRecentInterviews(clerkUserId: string): Promise<UserProfileDto> {
    if (clerkUserId.startsWith('user_')) {
        await ensureMongoMirror(clerkUserId);
    }

    const doc = await User.findOneAndUpdate(
        { clerkUserId, deletedAt: { $exists: false } },
        { $set: { 'preferences.dashboardRecentInterviewsClearedAt': new Date() } },
        { new: true }
    ).lean();

    if (!doc) {
        throw new Error('PROFILE_NOT_FOUND');
    }

    return docToDto(doc);
}
