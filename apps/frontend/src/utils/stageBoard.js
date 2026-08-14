/**
 * Loading plumbing shared by the three stage boards (screening / voice / video).
 *
 * All three read the same candidate list and the same campaign metadata, and only
 * the split differs, so the fetches and the snapshot live here: a change to how a
 * board loads happens once instead of three times.
 */

import apiClient from '../services/apiClient';
import { getUserStorageKeySuffix, userScopedStorageKey } from './userStorageKey';

/**
 * The payload the boards last saw.
 *
 * A board used to open on a "loading…" line until two round trips had finished,
 * which is seconds on every visit. The rows are a view of server data with no
 * authority of their own, so painting the previous copy for a moment costs
 * nothing — the fetch that follows replaces it. One key serves all three boards
 * because `/api/candidates` answers them all.
 */
const SNAPSHOT_KEY_BASE = 'evaalo-stage-board-v1';

/** Beyond this a snapshot would crowd the origin's quota; a board works without one. */
const SNAPSHOT_MAX_CHARS = 1_500_000;

/** Old enough that restoring it would show a board the user no longer recognises. */
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hasResolvedUser() {
    return getUserStorageKeySuffix() !== 'anonymous';
}

/**
 * @returns {{ candidates: object[], meta: Record<string, object>, metaComplete: boolean } | null}
 */
export function readStageBoardSnapshot() {
    try {
        if (typeof localStorage === 'undefined' || !hasResolvedUser()) return null;
        const raw = localStorage.getItem(userScopedStorageKey(SNAPSHOT_KEY_BASE));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.candidates) || parsed.candidates.length === 0) return null;
        if (!Number.isFinite(parsed.savedAt)) return null;
        if (Date.now() - parsed.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
        return {
            candidates: parsed.candidates,
            meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {},
            metaComplete: parsed.metaComplete === true,
        };
    } catch {
        return null;
    }
}

export function writeStageBoardSnapshot({ candidates, meta, metaComplete }) {
    if (typeof localStorage === 'undefined' || !hasResolvedUser()) return;

    const persist = () => {
        try {
            const key = userScopedStorageKey(SNAPSHOT_KEY_BASE);
            if (!Array.isArray(candidates) || candidates.length === 0) {
                localStorage.removeItem(key);
                return;
            }
            const payload = JSON.stringify({
                savedAt: Date.now(),
                candidates,
                meta: meta ?? {},
                metaComplete: metaComplete === true,
            });
            if (payload.length > SNAPSHOT_MAX_CHARS) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, payload);
        } catch {
            /* quota or private mode — the board just loses its instant paint */
        }
    };

    // Serializing the whole list blocks the main thread and nothing on screen waits
    // for it, so let it happen once the board has settled.
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(persist, { timeout: 2000 });
    } else {
        setTimeout(persist, 0);
    }
}

/** The candidate ids a campaign card stands for, hidden and pending alike. */
export function collectRowCandidateIds(row) {
    return [...(row?.evaluated || []), ...(row?.pending || [])]
        .map((c) => c._id || c.id)
        .filter(Boolean);
}

/**
 * The same payload with `ids` marked hidden from (or restored to) one stage.
 *
 * This is the local half of the hide button: applying the change the server is
 * about to make lets the card go the moment it is confirmed, and keeping the
 * original array untouched is what makes putting it back — on undo, or when the
 * request fails — a matter of repainting from the copy we still hold.
 */
export function withStageHidden(candidates, ids, stage, hidden) {
    const target = new Set(ids);
    return candidates.map((candidate) => {
        const id = candidate?._id || candidate?.id;
        if (!id || !target.has(id)) return candidate;
        const current = Array.isArray(candidate.hiddenFromStages) ? candidate.hiddenFromStages : [];
        if (hidden) {
            if (current.includes(stage)) return candidate;
            return { ...candidate, hiddenFromStages: [...current, stage] };
        }
        if (!current.includes(stage)) return candidate;
        return { ...candidate, hiddenFromStages: current.filter((s) => s !== stage) };
    });
}

/** The candidate list every board starts from, or null when the API returned none. */
export async function fetchStageBoardCandidates() {
    const result = await apiClient.get('/api/candidates');
    return result?.success && Array.isArray(result.data) ? result.data : null;
}

/**
 * Campaign titles and status by id.
 *
 * `complete` says whether the answer can be trusted to be exhaustive. It matters
 * because a campaign missing from a complete answer was deleted, while the same
 * absence in a failed one means only that we never got to ask — and labelling
 * every live campaign "deleted" over a dropped request is worse than showing the
 * position title the candidates carry.
 *
 * @param {string[]} campaignIds
 * @returns {Promise<{ meta: Record<string, object>, complete: boolean }>}
 */
export async function fetchCampaignMetaByIds(campaignIds) {
    if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
        return { meta: {}, complete: true };
    }
    try {
        const json = await apiClient.get(
            `/api/recruitment-campaigns?ids=${encodeURIComponent(campaignIds.join(','))}`
        );
        if (!json?.success || !Array.isArray(json.data)) return { meta: {}, complete: false };
        const meta = {};
        for (const row of json.data) {
            if (row?.campaignId) meta[row.campaignId] = row;
        }
        return { meta, complete: true };
    } catch (err) {
        console.warn('⚠️ Campaign metadata batch fetch failed:', err);
        return { meta: {}, complete: false };
    }
}
