import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserStorageKeySuffix, userScopedStorageKey } from '../utils/userStorageKey';

const KEY_SAVED_BASE = 'evaalo-headhunter-saved-ids-v1';
const KEY_SHORTLIST_BASE = 'evaalo-headhunter-shortlist-ids-v1';
const KEY_REJECTED_BASE = 'evaalo-headhunter-rejected-ids-v1';

function readIdSet(baseKey) {
    try {
        const raw = localStorage.getItem(userScopedStorageKey(baseKey));
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.map((x) => String(x)));
    } catch (_) {
        return new Set();
    }
}

function writeIdSet(baseKey, set) {
    try {
        localStorage.setItem(userScopedStorageKey(baseKey), JSON.stringify([...set]));
    } catch (_) {
        /* ignore */
    }
}

/**
 * حالة محلية لـ Save / Shortlist / Reject — معزولة لكل مستخدم.
 */
export function useHeadHunterPersistence() {
    const { user } = useAuth();
    const userKey = user?.id || user?.email || getUserStorageKeySuffix();

    const [savedIds, setSavedIds] = useState(() =>
        typeof localStorage === 'undefined' ? new Set() : readIdSet(KEY_SAVED_BASE)
    );
    const [shortlistIds, setShortlistIds] = useState(() =>
        typeof localStorage === 'undefined' ? new Set() : readIdSet(KEY_SHORTLIST_BASE)
    );
    const [rejectedIds, setRejectedIds] = useState(() =>
        typeof localStorage === 'undefined' ? new Set() : readIdSet(KEY_REJECTED_BASE)
    );

    useEffect(() => {
        setSavedIds(readIdSet(KEY_SAVED_BASE));
        setShortlistIds(readIdSet(KEY_SHORTLIST_BASE));
        setRejectedIds(readIdSet(KEY_REJECTED_BASE));
    }, [userKey]);

    useEffect(() => {
        writeIdSet(KEY_SAVED_BASE, savedIds);
    }, [savedIds, userKey]);

    useEffect(() => {
        writeIdSet(KEY_SHORTLIST_BASE, shortlistIds);
    }, [shortlistIds, userKey]);

    useEffect(() => {
        writeIdSet(KEY_REJECTED_BASE, rejectedIds);
    }, [rejectedIds, userKey]);

    const toggleSaved = useCallback((id) => {
        const k = String(id);
        setSavedIds((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    }, []);

    const toggleShortlist = useCallback((id) => {
        const k = String(id);
        setShortlistIds((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    }, []);

    const reject = useCallback((id) => {
        const k = String(id);
        setRejectedIds((prev) => new Set(prev).add(k));
    }, []);

    const unreject = useCallback((id) => {
        const k = String(id);
        setRejectedIds((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
        });
    }, []);

    const isSaved = useCallback((id) => savedIds.has(String(id)), [savedIds]);
    const isShortlisted = useCallback((id) => shortlistIds.has(String(id)), [shortlistIds]);
    const isRejected = useCallback((id) => rejectedIds.has(String(id)), [rejectedIds]);

    return useMemo(
        () => ({
            savedIds,
            shortlistIds,
            rejectedIds,
            toggleSaved,
            toggleShortlist,
            reject,
            unreject,
            isSaved,
            isShortlisted,
            isRejected,
        }),
        [
            savedIds,
            shortlistIds,
            rejectedIds,
            toggleSaved,
            toggleShortlist,
            reject,
            unreject,
            isSaved,
            isShortlisted,
            isRejected,
        ]
    );
}
