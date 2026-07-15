import apiClient from '../services/apiClient';
import {
    hasLegacyOrgMigrationFlag,
    markLegacyOrgMigrationDone,
    migrateLegacyUserStorage,
} from './migrateLegacyUserStorage';

/**
 * Restore pre-isolation data for the signed-in user:
 * 1) browser localStorage (Head Hunter, Candidates panel, notifications)
 * 2) MongoDB org_default → dev_org_<userId> (dev only, once per user)
 */
export async function runUserDataMigration(user) {
    const userId = user?.id || user?.email;
    if (!userId) return { local: null, server: null };

    const local = migrateLegacyUserStorage(userId);

    if (hasLegacyOrgMigrationFlag(userId)) {
        return { local, server: { skipped: true, reason: 'already_migrated' } };
    }

    if (!import.meta.env.DEV) {
        return { local, server: { skipped: true, reason: 'production_build' } };
    }

    try {
        const server = await apiClient.post('/api/dev/migrate-legacy-org', {});
        markLegacyOrgMigrationDone(userId);
        return { local, server };
    } catch (err) {
        if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[runUserDataMigration] server migration skipped:', err?.message || err);
        }
        return { local, server: { skipped: true, error: err?.message } };
    }
}
