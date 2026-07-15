import { authStorage } from '../services/authStorage';

/**
 * Per-user suffix for browser localStorage keys (multi-account isolation on shared devices).
 */
export function getUserStorageKeySuffix() {
    const user = authStorage.getSession()?.user;
    if (user?.id) return String(user.id);
    if (user?.email) return String(user.email).trim().toLowerCase();

    try {
        const clerkUser = typeof window !== 'undefined' ? window.Clerk?.user : undefined;
        if (clerkUser?.id) return clerkUser.id;
        const email =
            clerkUser?.primaryEmailAddress?.emailAddress ||
            clerkUser?.emailAddresses?.[0]?.emailAddress;
        if (email) return email.trim().toLowerCase();
    } catch {
        /* ignore */
    }

    return 'anonymous';
}

/** @param {string} baseKey */
export function userScopedStorageKey(baseKey) {
    return `${baseKey}:${getUserStorageKeySuffix()}`;
}
