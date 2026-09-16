/**
 * Head-hunter search history.
 *
 * The server is the record of truth since 2026-09-16; localStorage stays as a
 * per-browser CACHE so every existing synchronous reader keeps working and the
 * list is on screen before the network answers.
 *
 * It used to be localStorage ALONE, keyed by user id — the only paid artefact in
 * the product with no database row. Clearing site data, opening from a second
 * device, or signing in with a second account each erased the lot; that is how
 * three searches disappeared for the owner. Now the cache can be wiped freely
 * and the next sync restores it from the organization's rows.
 *
 * Reads stay synchronous against the cache. Writes go to the cache immediately
 * (so the UI never waits) and to the server best-effort. A failed call is never
 * fatal: the row survives locally and the next sync pushes it up.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserStorageKeySuffix, userScopedStorageKey } from '../utils/userStorageKey';
import { apiClient } from '../services/apiClient';

const STORAGE_KEY_BASE = 'evaalo-headhunter-campaign-history-v1';
const MAX_CAMPAIGNS = 25;
const HISTORY_ENDPOINT = '/api/head-hunter/history';

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

function isHistoryRow(row) {
    return (
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        typeof row.receivedAt === 'string' &&
        typeof row.position === 'string'
    );
}

/** @returns {HeadHunterCampaignRecord[]} */
export function readHeadHunterCampaignHistory() {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(storageKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isHistoryRow);
    } catch (_) {
        return [];
    }
}

/**
 * Every history this browser holds, under ANY identity suffix.
 *
 * The cache key ends in a user id, and `getUserStorageKeySuffix` falls back to
 * 'anonymous' when it is read before the session hydrates — so a search can be
 * WRITTEN under one suffix and looked for under another and simply vanish. The
 * same happens to anyone who signs in with a second account: their earlier
 * searches are still in this browser, under the first account's key, unreachable.
 *
 * So the lift scans every suffix rather than only the current one. That is safe
 * because it decides nothing: the SERVER refuses any row whose searchId its own
 * audit log does not show this organization running, so sweeping broadly here
 * cannot move one tenant's results into another's account.
 */
function readStrandedHistories() {
    if (typeof localStorage === 'undefined') return [];
    const prefix = `${STORAGE_KEY_BASE}:`;
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(parsed)) out.push(...parsed.filter(isHistoryRow));
        }
    } catch (_) {
        /* a blocked or corrupt store simply yields nothing to lift */
    }
    return out;
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

/** Write the merged list straight to the cache, bypassing the per-row helpers. */
function writeCache(rows) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(storageKey(), JSON.stringify(rows.slice(0, MAX_CAMPAIGNS)));
    } catch (_) {
        /* a full or blocked store is not worth breaking the page over */
    }
}

/** Send one row up. Best effort — the cache already has it. */
export async function pushHeadHunterCampaignToServer(row) {
    if (!row?.id || !row?.position || !row?.receivedAt) return false;
    try {
        await apiClient.put(HISTORY_ENDPOINT, row);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Reconcile cache and server, in that order of safety.
 *
 * The server list wins on rows both sides know, because it is the one that
 * survives this browser. Rows only this browser has are KEPT and pushed up —
 * overwriting the cache with the server's answer would throw away a search
 * written while the network was down, which is the very loss this move fixes.
 * The import endpoint skips anything already stored, so running this on a second
 * device cannot roll results backwards.
 */
export async function syncHeadHunterHistoryWithServer() {
    let serverRows = [];
    try {
        const res = await apiClient.get(HISTORY_ENDPOINT);
        serverRows = Array.isArray(res?.history) ? res.history : [];
    } catch (_) {
        return false; // offline or unauthorised: the cache stands on its own
    }

    const serverIds = new Set(serverRows.map((r) => r.id));

    // The cache under THIS identity is what the page shows; every other suffix in
    // this browser is swept too, because a search written under a stale or
    // 'anonymous' key is invisible yet recoverable. Deduplicated by row id.
    const byId = new Map();
    for (const r of [...readHeadHunterCampaignHistory(), ...readStrandedHistories()]) {
        if (!serverIds.has(r.id) && !byId.has(r.id)) byId.set(r.id, r);
    }
    const localOnly = [...byId.values()];

    if (localOnly.length > 0) {
        try {
            // The server attributes each row by its own audit log and refuses the
            // ones this organization never searched, so the answer tells us which
            // of the swept rows actually belong here.
            await apiClient.post(`${HISTORY_ENDPOINT}/import`, { entries: localOnly });
            const after = await apiClient.get(HISTORY_ENDPOINT);
            if (Array.isArray(after?.history)) serverRows = after.history;
        } catch (_) {
            /* they stay in the cache and go up on the next sync */
        }
    }

    // Only rows the CURRENT identity already had are kept alongside the server's;
    // a swept row from another account is not shown until the server accepts it.
    const acceptedIds = new Set(serverRows.map((r) => r.id));
    const ownCacheOnly = readHeadHunterCampaignHistory().filter((r) => !acceptedIds.has(r.id));
    const merged = [...serverRows, ...ownCacheOnly].sort((a, b) =>
        String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''))
    );
    writeCache(merged);
    return true;
}

/** @returns {{ list: HeadHunterCampaignRecord[], prepend: (e: Omit<HeadHunterCampaignRecord, 'id'> & { id?: string }) => HeadHunterCampaignRecord | null, remove: (id: string) => boolean, getById: (id: string) => HeadHunterCampaignRecord | null, refresh: () => void }} */
export function useHeadHunterSearchHistory() {
    const { user } = useAuth();
    const userKey = user?.id || user?.email || getUserStorageKeySuffix();
    const [version, setVersion] = useState(0);
    const refresh = useCallback(() => setVersion((v) => v + 1), []);

    // One reconciliation per mount, per identity. Three pages use this hook; each
    // gets its own sync, which is cheap (one GET) and idempotent by construction.
    useEffect(() => {
        let alive = true;
        syncHeadHunterHistoryWithServer().then((changed) => {
            if (alive && changed) refresh();
        });
        return () => {
            alive = false;
        };
    }, [userKey, refresh]);

    const list = useMemo(() => {
        void userKey;
        return readHeadHunterCampaignHistory();
    }, [version, userKey]);

    // Cache first so the list paints at once, then the server. A failed push is
    // not an error the recruiter should see: the row is already on screen and in
    // the cache, and the next sync carries it up.
    const prepend = useCallback(
        (entry) => {
            const row = prependHeadHunterCampaign(entry);
            if (row) {
                refresh();
                void pushHeadHunterCampaignToServer(row);
            }
            return row;
        },
        [refresh],
    );

    const upsertBySearchId = useCallback(
        (entry) => {
            const row = upsertHeadHunterCampaignBySearchId(entry);
            if (row) {
                refresh();
                void pushHeadHunterCampaignToServer(row);
            }
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

    // Deleting only the cache would bring the row back on the next sync, so the
    // server is told too. Scoped to the org there, never by raw id alone.
    const remove = useCallback(
        (id) => {
            const ok = removeHeadHunterCampaign(id);
            if (ok) refresh();
            if (id) {
                apiClient
                    .delete(`${HISTORY_ENDPOINT}/${encodeURIComponent(id)}`)
                    .catch(() => {});
            }
            return ok;
        },
        [refresh],
    );

    return useMemo(
        () => ({ list, prepend, upsertBySearchId, remove, getById, refresh }),
        [list, prepend, upsertBySearchId, remove, getById, refresh],
    );
}
