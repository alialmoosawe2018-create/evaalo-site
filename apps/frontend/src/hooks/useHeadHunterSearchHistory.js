import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserStorageKeySuffix, userScopedStorageKey } from '../utils/userStorageKey';

const STORAGE_KEY_BASE = 'evaalo-headhunter-campaign-history-v1';
const MAX_CAMPAIGNS = 25;

function storageKey() {
    return userScopedStorageKey(STORAGE_KEY_BASE);
}

/** @returns {string} */
export function newHeadHunterCampaignId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * @typedef {Object} HeadHunterCampaignRecord
 * @property {string} id
 * @property {string} position
 * @property {string} location
 * @property {string} [yearsExperience]
 * @property {string} [ageRange]
 * @property {boolean} [aiCompareTop]
 * @property {boolean} [availableEmployeesOnly]
 * @property {number} [minCandidateCount]
 * @property {boolean} [arabicTranslation]
 * @property {string} [query]
 * @property {string} [searchId]
 * @property {string} receivedAt
 * @property {unknown} payload
 */

/** @returns {HeadHunterCampaignRecord[]} */
export function readHeadHunterCampaignHistory() {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(storageKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (row) =>
                row &&
                typeof row === 'object' &&
                typeof row.id === 'string' &&
                typeof row.receivedAt === 'string' &&
                typeof row.position === 'string',
        );
    } catch (_) {
        return [];
    }
}

/** @param {string} receivedAt */
export function headHunterCampaignHistoryHasReceivedAt(receivedAt) {
    if (!receivedAt) return false;
    return readHeadHunterCampaignHistory().some((r) => r.receivedAt === receivedAt);
}

/**
 * @param {Omit<HeadHunterCampaignRecord, 'id'> & { id?: string }} entry
 * @returns {HeadHunterCampaignRecord | null}
 */
export function prependHeadHunterCampaign(entry) {
    if (typeof localStorage === 'undefined') return null;
    if (!entry?.receivedAt || !entry?.position) return null;
    try {
        /** @type {HeadHunterCampaignRecord} */
        const row = {
            id: entry.id || newHeadHunterCampaignId(),
            position: entry.position,
            location: entry.location ?? '',
            ...(entry.yearsExperience ? { yearsExperience: entry.yearsExperience } : {}),
            ...(entry.ageRange ? { ageRange: entry.ageRange } : {}),
            ...(entry.aiCompareTop ? { aiCompareTop: true } : {}),
            ...(entry.availableEmployeesOnly ? { availableEmployeesOnly: true } : {}),
            ...(entry.minCandidateCount ? { minCandidateCount: entry.minCandidateCount } : {}),
            ...(entry.arabicTranslation ? { arabicTranslation: true } : {}),
            ...(entry.query ? { query: entry.query } : {}),
            ...(entry.searchId ? { searchId: entry.searchId } : {}),
            receivedAt: entry.receivedAt,
            payload: entry.payload,
        };
        const prev = readHeadHunterCampaignHistory();
        const next = [row, ...prev.filter((r) => r.id !== row.id)].slice(0, MAX_CAMPAIGNS);
        localStorage.setItem(storageKey(), JSON.stringify(next));
        return row;
    } catch (_) {
        return null;
    }
}

/**
 * يحدّث حملة موجودة بنفس searchId أو يضيف واحدة جديدة (للنتائج المتدفقة من n8n).
 * @param {Omit<HeadHunterCampaignRecord, 'id'> & { id?: string }} entry
 * @returns {HeadHunterCampaignRecord | null}
 */
export function upsertHeadHunterCampaignBySearchId(entry) {
    if (typeof localStorage === 'undefined') return null;
    if (!entry?.searchId || !entry?.position) return null;
    try {
        const prev = readHeadHunterCampaignHistory();
        const idx = prev.findIndex((r) => r.searchId === entry.searchId);
        if (idx < 0) {
            return prependHeadHunterCampaign(entry);
        }
        const existing = prev[idx];
        /** @type {HeadHunterCampaignRecord} */
        const updated = {
            ...existing,
            position: entry.position,
            location: entry.location ?? existing.location ?? '',
            ...(entry.yearsExperience ? { yearsExperience: entry.yearsExperience } : {}),
            ...(entry.ageRange ? { ageRange: entry.ageRange } : {}),
            ...(entry.aiCompareTop ? { aiCompareTop: true } : {}),
            ...(entry.availableEmployeesOnly ? { availableEmployeesOnly: true } : {}),
            ...(entry.minCandidateCount ? { minCandidateCount: entry.minCandidateCount } : {}),
            ...(entry.arabicTranslation ? { arabicTranslation: true } : {}),
            ...(entry.query ? { query: entry.query } : {}),
            receivedAt: entry.receivedAt || existing.receivedAt,
            payload: entry.payload ?? existing.payload,
        };
        const next = [updated, ...prev.filter((_, i) => i !== idx)].slice(0, MAX_CAMPAIGNS);
        localStorage.setItem(storageKey(), JSON.stringify(next));
        return updated;
    } catch (_) {
        return null;
    }
}

/** @param {string} id */
export function getHeadHunterCampaignById(id) {
    if (!id) return null;
    const list = readHeadHunterCampaignHistory();
    return list.find((r) => r.id === id) ?? null;
}

/** @param {string} id @returns {boolean} */
export function removeHeadHunterCampaign(id) {
    if (!id || typeof localStorage === 'undefined') return false;
    try {
        const prev = readHeadHunterCampaignHistory();
        const next = prev.filter((r) => r.id !== id);
        if (next.length === prev.length) return false;
        localStorage.setItem(storageKey(), JSON.stringify(next));
        return true;
    } catch (_) {
        return false;
    }
}

/** @returns {{ list: HeadHunterCampaignRecord[], prepend: (e: Omit<HeadHunterCampaignRecord, 'id'> & { id?: string }) => HeadHunterCampaignRecord | null, remove: (id: string) => boolean, getById: (id: string) => HeadHunterCampaignRecord | null, refresh: () => void }} */
export function useHeadHunterSearchHistory() {
    const { user } = useAuth();
    const userKey = user?.id || user?.email || getUserStorageKeySuffix();
    const [version, setVersion] = useState(0);
    const refresh = useCallback(() => setVersion((v) => v + 1), []);

    const list = useMemo(() => {
        void userKey;
        return readHeadHunterCampaignHistory();
    }, [version, userKey]);

    const prepend = useCallback(
        (entry) => {
            const row = prependHeadHunterCampaign(entry);
            if (row) refresh();
            return row;
        },
        [refresh],
    );

    const upsertBySearchId = useCallback(
        (entry) => {
            const row = upsertHeadHunterCampaignBySearchId(entry);
            if (row) refresh();
            return row;
        },
        [refresh],
    );

    const getById = useCallback(
        (campaignId) => {
            void version;
            return getHeadHunterCampaignById(campaignId);
        },
        [version],
    );

    const remove = useCallback(
        (id) => {
            const ok = removeHeadHunterCampaign(id);
            if (ok) refresh();
            return ok;
        },
        [refresh],
    );

    return useMemo(
        () => ({ list, prepend, upsertBySearchId, remove, getById, refresh }),
        [list, prepend, upsertBySearchId, remove, getById, refresh],
    );
}
