/**
 * HR account profile — GET/PATCH /api/users/me with mock fallback.
 */

import { apiClient, ApiError } from './apiClient';
import authService, { applyProfileToSession, computeProfileComplete } from './authService';
import { authStorage } from './authStorage';

function isMockMode() {
    if (typeof window === 'undefined') return false;
    const clerk = window.Clerk;
    return !clerk?.session;
}

function profileFromSessionUser(user) {
    if (!user) return null;
    const fullName = String(user.name ?? '').trim();
    const companyName = String(user.companyName ?? '').trim();
    const companyDescription = String(user.companyDescription ?? '').trim();
    const email = String(user.email ?? '').trim();
    const profileComplete =
        user.profileComplete === true ||
        computeProfileComplete({ fullName, companyName, email });
    const imageUrl = String(user.imageUrl ?? '').trim();
    return { fullName, companyName, companyDescription, email, profileComplete, imageUrl: imageUrl || undefined };
}

function mockUpdateProfile({ fullName, companyName, companyDescription }) {
    const session = authStorage.getSession();
    if (!session?.user) throw new Error('not_authenticated');
    const merged = {
        fullName: fullName !== undefined ? String(fullName).trim() : String(session.user.name ?? '').trim(),
        companyName:
            companyName !== undefined
                ? String(companyName).trim()
                : String(session.user.companyName ?? '').trim(),
        companyDescription:
            companyDescription !== undefined
                ? String(companyDescription).trim()
                : String(session.user.companyDescription ?? '').trim(),
        email: session.user.email,
    };
    const profile = {
        ...merged,
        profileComplete: computeProfileComplete(merged),
    };
    applyProfileToSession(profile);
    return profile;
}

export async function getMyProfile() {
    if (isMockMode()) {
        const profile = profileFromSessionUser(authStorage.getSession()?.user);
        if (!profile) throw new Error('not_authenticated');
        return profile;
    }

    try {
        const data = await apiClient.get('/api/users/me');
        const profile = data?.profile;
        if (!profile) throw new Error('profile_missing');
        applyProfileToSession(profile);
        return profile;
    } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 503)) {
            const fallback = profileFromSessionUser(authStorage.getSession()?.user);
            if (fallback) return fallback;
        }
        throw err;
    }
}

async function clerkBrowserUpdateProfile({ fullName, companyName, companyDescription }) {
    const clerk = typeof window !== 'undefined' ? window.Clerk : undefined;
    const user = clerk?.user;
    if (!user || typeof user.update !== 'function') {
        throw new Error('clerk_user_unavailable');
    }

    const nameTrimmed = fullName !== undefined ? String(fullName).trim() : String(user.firstName || '').trim();
    const companyTrimmed =
        companyName !== undefined
            ? String(companyName).trim()
            : String(user.unsafeMetadata?.companyName ?? '').trim();
    const descriptionTrimmed =
        companyDescription !== undefined
            ? String(companyDescription).trim()
            : String(user.unsafeMetadata?.companyDescription ?? '').trim();

    const [firstName, ...rest] = (nameTrimmed || user.fullName || 'User').split(/\s+/);
    const lastName = rest.join(' ') || '';

    const email =
        user.primaryEmailAddress?.emailAddress ||
        user.emailAddresses?.[0]?.emailAddress ||
        '';
    const profileComplete = computeProfileComplete({
        fullName: nameTrimmed || [user.firstName, user.lastName].filter(Boolean).join(' '),
        companyName: companyTrimmed,
        email,
    });

    await user.update({
        firstName,
        lastName,
        unsafeMetadata: {
            ...(user.unsafeMetadata || {}),
            companyName: companyTrimmed,
            companyDescription: descriptionTrimmed,
        },
        publicMetadata: {
            ...(user.publicMetadata || {}),
            profileComplete,
        },
    });

    await authService.refreshCurrentUser();
    const session = authStorage.getSession();
    const profile = profileFromSessionUser(session?.user);
    if (!profile) throw new Error('profile_missing');
    applyProfileToSession(profile);
    return profile;
}

export async function updateMyProfile({ fullName, companyName, companyDescription }) {
    if (isMockMode()) {
        return mockUpdateProfile({ fullName, companyName, companyDescription });
    }

    try {
        const data = await apiClient.patch('/api/users/me', { fullName, companyName, companyDescription });
        const profile = data?.profile;
        if (!profile) throw new Error('profile_missing');
        await authService.refreshCurrentUser();
        applyProfileToSession(profile);
        return profile;
    } catch (err) {
        const canUseClerk =
            typeof window !== 'undefined' &&
            window.Clerk?.user &&
            typeof window.Clerk.user.update === 'function';
        const retryable =
            err instanceof ApiError &&
            (err.status === 0 ||
                err.status === 404 ||
                err.status === 500 ||
                err.status === 503 ||
                err.message === 'profile_update_failed' ||
                err.message === 'PROFILE_NOT_FOUND');

        if (canUseClerk && (retryable || err.message === 'profile_missing')) {
            try {
                return await clerkBrowserUpdateProfile({ fullName, companyName, companyDescription });
            } catch (clerkErr) {
                console.warn('[profileService] Clerk browser fallback failed:', clerkErr);
            }
        }
        throw err;
    }
}

/**
 * Permanently delete the current account (Clerk identity + org-scoped data).
 * Throws ApiError on failure (caller decides whether to logout). A 409 with
 * data.code === 'ACTIVE_SUBSCRIPTION' means billing must be cancelled first.
 */
export async function deleteMyAccount() {
    await apiClient.delete('/api/users/me');
}

/**
 * Hide recent interviews from dashboard widget (persistent per-user preference).
 * Does not delete candidates. Returns updated preferences.
 */
export async function clearDashboardRecentInterviews() {
    const data = await apiClient.post('/api/users/me/preferences/clear-recent-interviews', {});
    return data?.preferences ?? { dashboardRecentInterviewsClearedAt: null };
}

/** After email signup / verify — persist name + company to Clerk/Mongo. */
export async function syncProfileAfterSignup({ fullName, companyName }) {
    if (!fullName?.trim() || !companyName?.trim()) return null;
    try {
        return await updateMyProfile({
            fullName: fullName.trim(),
            companyName: companyName.trim(),
        });
    } catch (err) {
        if (isMockMode()) {
            return mockUpdateProfile({
                fullName: fullName.trim(),
                companyName: companyName.trim(),
            });
        }
        console.warn('[profileService] syncProfileAfterSignup failed:', err);
        return null;
    }
}

export const PENDING_SIGNUP_NAME_KEY = 'evaalo:pendingSignupName';
export const PENDING_SIGNUP_COMPANY_KEY = 'evaalo:pendingSignupCompany';

export function storePendingSignupProfile({ name, company }) {
    try {
        if (name?.trim()) window.sessionStorage.setItem(PENDING_SIGNUP_NAME_KEY, name.trim());
        if (company?.trim()) window.sessionStorage.setItem(PENDING_SIGNUP_COMPANY_KEY, company.trim());
    } catch {
        /* ignore */
    }
}

export function consumePendingSignupProfile() {
    try {
        const fullName = window.sessionStorage.getItem(PENDING_SIGNUP_NAME_KEY) || '';
        const companyName = window.sessionStorage.getItem(PENDING_SIGNUP_COMPANY_KEY) || '';
        window.sessionStorage.removeItem(PENDING_SIGNUP_NAME_KEY);
        window.sessionStorage.removeItem(PENDING_SIGNUP_COMPANY_KEY);
        return { fullName, companyName };
    } catch {
        return { fullName: '', companyName: '' };
    }
}

export default {
    getMyProfile,
    updateMyProfile,
    deleteMyAccount,
    clearDashboardRecentInterviews,
    syncProfileAfterSignup,
    storePendingSignupProfile,
    consumePendingSignupProfile,
};
