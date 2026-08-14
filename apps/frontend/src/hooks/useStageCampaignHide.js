import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import {
    buildScreeningCampaignGroups,
    collectCampaignIdsFromCandidates,
} from '../utils/screeningCampaigns.js';
import {
    collectRowCandidateIds,
    withStageHidden,
    writeStageBoardSnapshot,
} from '../utils/stageBoard.js';

const UNDO_MS = 8000;

/**
 * Instant hide/undo for a stage board.
 *
 * Confirming used to wait on hide + a full board reload. The card can leave the
 * list the moment it is confirmed because we already know which ids to mark;
 * the request runs afterwards, and a short undo window puts the card back.
 */
export function useStageCampaignHide({
    stage,
    split,
    getLabels,
    setCampaignGroups,
    setSelectedCampaignKey,
    initialSnapshot = null,
}) {
    const payloadRef = useRef({
        candidates: initialSnapshot?.candidates ?? [],
        meta: initialSnapshot?.meta ?? {},
        metaComplete: initialSnapshot?.metaComplete === true,
    });
    const [hideUndo, setHideUndo] = useState(null);
    const hideUndoRef = useRef(null);
    const undoTimerRef = useRef(null);
    const genRef = useRef(0);
    const queueRef = useRef(Promise.resolve());

    const paint = useCallback(
        (candidates, { metaPending = false } = {}) => {
            const { evaluated, pending } = split(candidates);
            const campaignIds = collectCampaignIdsFromCandidates(evaluated, pending);
            const meta = payloadRef.current.meta;
            const pendingMeta = metaPending || (!payloadRef.current.metaComplete && campaignIds.length > 0);
            setCampaignGroups(
                buildScreeningCampaignGroups(evaluated, pending, meta, getLabels(), {
                    metaPending: pendingMeta,
                })
            );
        },
        [getLabels, setCampaignGroups, split]
    );

    const rememberPayload = useCallback((next) => {
        payloadRef.current = {
            candidates: next.candidates ?? [],
            meta: next.meta ?? {},
            metaComplete: next.metaComplete === true,
        };
    }, []);

    const applyHidden = useCallback(
        (ids, hidden) => {
            const candidates = withStageHidden(payloadRef.current.candidates, ids, stage, hidden);
            payloadRef.current = { ...payloadRef.current, candidates };
            writeStageBoardSnapshot({
                candidates,
                meta: payloadRef.current.meta,
                metaComplete: payloadRef.current.metaComplete,
            });
            paint(candidates);
        },
        [paint, stage]
    );

    const enqueue = useCallback((task) => {
        queueRef.current = queueRef.current.catch(() => undefined).then(task);
        return queueRef.current;
    }, []);

    const hideCampaign = useCallback(
        (row) => {
            const ids = collectRowCandidateIds(row);
            if (ids.length === 0) return;

            const gen = ++genRef.current;
            const selectionKey = row.selectionKey;
            applyHidden(ids, true);
            setSelectedCampaignKey(null);
            setHideUndo({ row, ids, selectionKey });
            hideUndoRef.current = { row, ids, selectionKey };
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            undoTimerRef.current = setTimeout(() => {
                setHideUndo((current) => (current?.selectionKey === selectionKey ? null : current));
                if (hideUndoRef.current?.selectionKey === selectionKey) hideUndoRef.current = null;
            }, UNDO_MS);

            void enqueue(async () => {
                try {
                    await apiClient.post('/api/candidates/bulk-hide', { ids, stage });
                } catch (err) {
                    console.error('❌ Campaign hide failed:', err);
                    if (gen !== genRef.current) return;
                    applyHidden(ids, false);
                    setHideUndo(null);
                    hideUndoRef.current = null;
                }
            });
        },
        [applyHidden, enqueue, setSelectedCampaignKey, stage]
    );

    const undoHide = useCallback(() => {
        const current = hideUndo;
        if (!current) return;
        const gen = ++genRef.current;
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setHideUndo(null);
        hideUndoRef.current = null;
        applyHidden(current.ids, false);

        void enqueue(async () => {
            try {
                await apiClient.post('/api/candidates/bulk-hide', {
                    ids: current.ids,
                    stage,
                    hidden: false,
                });
            } catch (err) {
                console.error('❌ Campaign hide undo failed:', err);
                if (gen !== genRef.current) return;
                applyHidden(current.ids, true);
            }
        });
    }, [applyHidden, enqueue, hideUndo, stage]);

    useEffect(
        () => () => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        },
        []
    );

    const keepPendingHide = useCallback(
        (candidates) => {
            const pending = hideUndoRef.current;
            if (!pending) return candidates;
            return withStageHidden(candidates, pending.ids, stage, true);
        },
        [stage]
    );

    return { hideCampaign, undoHide, hideUndo, rememberPayload, payloadRef, keepPendingHide };
}
