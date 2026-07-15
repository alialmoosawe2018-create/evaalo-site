import { getUserStorageKeySuffix, userScopedStorageKey } from './userStorageKey';

/** Keys that were unscoped before per-user isolation. */
const LEGACY_USER_STORAGE_BASE_KEYS = [
    'evaalo-headhunter-campaign-history-v1',
    'evaalo-headhunter-saved-ids-v1',
    'evaalo-headhunter-shortlist-ids-v1',
    'evaalo-headhunter-rejected-ids-v1',
    'candidates-employees-panel-v1',
    'candidates-roster-employees-v1',
    'candidates-panel-tab-v1',
];

const NOTIFICATIONS_LAST_VIEWED_PREFIX = 'evaalo:notificationsLastViewed:';
const NOTIFICATIONS_DISMISSED_PREFIX = 'evaalo:notificationsDismissed:';

function copyLegacyValue(baseKey, userSuffix) {
    if (typeof localStorage === 'undefined') return false;

    const targetKey = `${baseKey}:${userSuffix}`;
    if (localStorage.getItem(targetKey)) return false;

    const legacy =
        localStorage.getItem(baseKey) ||
        localStorage.getItem(`${baseKey}:anonymous`);

    if (!legacy) return false;

    localStorage.setItem(targetKey, legacy);
    return true;
}

function migrateNotificationPrefix(prefix, userSuffix) {
    if (typeof localStorage === 'undefined') return false;

    const targetKey = `${prefix}${userSuffix}`;
    if (localStorage.getItem(targetKey)) return false;

    const legacy =
        localStorage.getItem(`${prefix}anonymous`) ||
        localStorage.getItem(`${prefix}${userSuffix}`);

    if (!legacy) return false;

    localStorage.setItem(targetKey, legacy);
    return true;
}

/**
 * Copy pre-isolation localStorage into the current user's scoped keys.
 * Does not delete legacy keys (safe for multi-account on one browser).
 */
export function migrateLegacyUserStorage(userSuffix = getUserStorageKeySuffix()) {
    if (!userSuffix || userSuffix === 'anonymous') {
        return { migratedKeys: [] };
    }

    const migratedKeys = [];

    for (const baseKey of LEGACY_USER_STORAGE_BASE_KEYS) {
        if (copyLegacyValue(baseKey, userSuffix)) {
            migratedKeys.push(userScopedStorageKey(baseKey));
        }
    }

    if (migrateNotificationPrefix(NOTIFICATIONS_LAST_VIEWED_PREFIX, userSuffix)) {
        migratedKeys.push(`${NOTIFICATIONS_LAST_VIEWED_PREFIX}${userSuffix}`);
    }
    if (migrateNotificationPrefix(NOTIFICATIONS_DISMISSED_PREFIX, userSuffix)) {
        migratedKeys.push(`${NOTIFICATIONS_DISMISSED_PREFIX}${userSuffix}`);
    }

    return { migratedKeys };
}

export const LEGACY_ORG_MIGRATION_FLAG_PREFIX = 'evaalo:legacyOrgMigrated:v1:';

export function legacyOrgMigrationFlagKey(userId) {
    return `${LEGACY_ORG_MIGRATION_FLAG_PREFIX}${userId}`;
}

export function hasLegacyOrgMigrationFlag(userId) {
    if (!userId || typeof localStorage === 'undefined') return false;
    return Boolean(localStorage.getItem(legacyOrgMigrationFlagKey(userId)));
}

export function markLegacyOrgMigrationDone(userId) {
    if (!userId || typeof localStorage === 'undefined') return;
    localStorage.setItem(legacyOrgMigrationFlagKey(userId), new Date().toISOString());
}
