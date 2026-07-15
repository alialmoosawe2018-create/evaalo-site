import { authStorage } from '../services/authStorage';

const STORAGE_PREFIX = 'evaalo:notificationsLastViewed:';
const DISMISSED_PREFIX = 'evaalo:notificationsDismissed:';

export function toNotificationActivityTime(value) {
    if (!value) return 0;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
}

export function getCandidateActivityTime(candidate) {
    return Math.max(
        toNotificationActivityTime(candidate.createdAt),
        toNotificationActivityTime(candidate.updatedAt),
        toNotificationActivityTime(candidate.interviewDate)
    );
}

function getNotificationsUserKey() {
    const user = authStorage.getSession()?.user;
    return user?.id || user?.email || 'anonymous';
}

export function getNotificationsLastViewedAt() {
    try {
        return localStorage.getItem(`${STORAGE_PREFIX}${getNotificationsUserKey()}`);
    } catch {
        return null;
    }
}

export function markNotificationsViewedAt(iso = new Date().toISOString()) {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${getNotificationsUserKey()}`, iso);
    } catch {
        /* ignore quota / private mode */
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('evaalo:notifications-viewed'));
    }
}

export function getNotificationDismissKey(candidateOrInterview) {
    const id = candidateOrInterview?._id || candidateOrInterview?.id;
    if (!id || String(id).startsWith('mock-')) return null;
    const activity =
        candidateOrInterview?.activityTime ??
        getCandidateActivityTime(candidateOrInterview);
    if (!activity) return null;
    return `${id}:${activity}`;
}

export function getDismissedNotificationKeys() {
    try {
        const raw = localStorage.getItem(`${DISMISSED_PREFIX}${getNotificationsUserKey()}`);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
        return new Set();
    }
}

export function dismissNotification(candidateOrInterview) {
    const key = getNotificationDismissKey(candidateOrInterview);
    if (!key) return;
    const keys = getDismissedNotificationKeys();
    if (keys.has(key)) return;
    keys.add(key);
    try {
        localStorage.setItem(
            `${DISMISSED_PREFIX}${getNotificationsUserKey()}`,
            JSON.stringify([...keys]),
        );
    } catch {
        /* ignore quota / private mode */
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('evaalo:notification-dismissed'));
    }
}

export function isNotificationDismissed(candidateOrInterview, dismissedKeys = null) {
    const key = getNotificationDismissKey(candidateOrInterview);
    if (!key) return false;
    const keys = dismissedKeys ?? getDismissedNotificationKeys();
    return keys.has(key);
}

export function filterDismissedNotifications(candidates, dismissedKeys = null) {
    const keys = dismissedKeys ?? getDismissedNotificationKeys();
    return candidates.filter((candidate) => !isNotificationDismissed(candidate, keys));
}

export function countUnreadNotifications(candidates, clearedAtIso, lastViewedIso) {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;

    const threshold = Math.max(
        toNotificationActivityTime(clearedAtIso),
        toNotificationActivityTime(lastViewedIso)
    );
    const dismissed = getDismissedNotificationKeys();

    return candidates.filter((candidate) => {
        if (getCandidateActivityTime(candidate) <= threshold) return false;
        if (isNotificationDismissed(candidate, dismissed)) return false;
        return true;
    }).length;
}
