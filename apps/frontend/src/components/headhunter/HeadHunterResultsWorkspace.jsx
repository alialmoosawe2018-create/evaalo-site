import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeHeadHunterPayload } from '../../utils/headHunterNormalize.js';
import { candidateRevealKey, isContactFullyRevealed, mergeRevealRecord } from '../../utils/headHunterContactReveal.js';
import { useBilling } from '../../contexts/BillingContext';
import HeadHunterCandidateCard from './HeadHunterCandidateCard.jsx';
import HeadHunterCandidatePanel from './HeadHunterCandidatePanel.jsx';
import HeadHunterResultsSkeleton from './HeadHunterResultsSkeleton.jsx';
import AiWorkingIndicator from '../AiWorkingIndicator.jsx';
import { apiClient } from '../../services/apiClient';

/**
 * Cards are paint-heavy, so a batch of 30 mounted in one task and stalled the
 * page on every "show more". Smaller batches trade extra clicks for a click that
 * stays responsive.
 */
export const HEADHUNTER_RESULTS_PAGE_SIZE = 12;

/**
 * عمود النتائج + اللوحة المنزلقة — مستخدَم في الصفحة الرئيسية وصفحة حملة محفوظة.
 *
 * @param {object} props
 * @param {ReturnType<import('../../hooks/useHeadHunterPersistence.js').useHeadHunterPersistence>} props.hh
 * @param {{ loading: boolean; error?: string; hasData: boolean; receivedAt: string | null; payload: unknown }} props.n8nInbound
 * @param {string} [props.campaignId]
 * @param {string} [props.campaignPosition]
 * @param {{ position?: string; location?: string; yearsExperience?: string; ageRange?: string; query?: string }} [props.searchContext]
 * @param {(key: string) => string} props.t
 */
export default function HeadHunterResultsWorkspace({ hh, n8nInbound, t, campaignId, campaignPosition, searchContext }) {
    const [selectedId, setSelectedId] = useState(null);
    const [visibleCount, setVisibleCount] = useState(HEADHUNTER_RESULTS_PAGE_SIZE);
    const [contactStatus, setContactStatus] = useState(null);
    const { refetch: refetchBilling, applyLocalBalance } = useBilling();

    // Field-level reveal state: candidateKey → { legacyFull, fields:Set }
    const [revealedFieldState, setRevealedFieldState] = useState(() => new Map());
    const [revealPendingKey, setRevealPendingKey] = useState(null);
    const [revealErrorKey, setRevealErrorKey] = useState(null);

    useEffect(() => {
        let alive = true;
        apiClient
            .get('/api/integrations')
            .then((data) => {
                if (alive && data?.ok) setContactStatus(data);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    const normalized = useMemo(() => normalizeHeadHunterPayload(n8nInbound.payload), [n8nInbound.payload]);

    const sortedFiltered = useMemo(() => {
        const rej = hh.rejectedIds;
        return normalized.candidates
            .filter((c) => !rej.has(String(c.id)))
            .sort((a, b) => {
                const ar = a.sort_rank;
                const br = b.sort_rank;
                const arOk = ar != null && Number.isFinite(ar);
                const brOk = br != null && Number.isFinite(br);
                if (arOk && brOk && ar !== br) return ar - br;
                if (arOk && !brOk) return -1;
                if (!arOk && brOk) return 1;
                const ma = a.match_score;
                const mb = b.match_score;
                if (ma != null && mb != null && ma !== mb) return mb - ma;
                if (ma != null && mb == null) return -1;
                if (ma == null && mb != null) return 1;
                const pa = a.payload_index ?? 0;
                const pb = b.payload_index ?? 0;
                if (pa !== pb) return pa - pb;
                return (a.full_name || '').localeCompare(b.full_name || '');
            });
    }, [normalized.candidates, hh.rejectedIds]);

    useEffect(() => {
        setVisibleCount(HEADHUNTER_RESULTS_PAGE_SIZE);
    }, [n8nInbound.receivedAt, sortedFiltered.length]);

    useEffect(() => {
        if (!selectedId) return;
        const onKey = (e) => {
            if (e.key === 'Escape') setSelectedId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedId]);

    useEffect(() => {
        if (!selectedId) return;
        const html = document.documentElement;
        const prevHtml = html.style.overflow;
        const prevBody = document.body.style.overflow;
        html.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        return () => {
            html.style.overflow = prevHtml;
            document.body.style.overflow = prevBody;
        };
    }, [selectedId]);

    const visibleList = useMemo(
        () => sortedFiltered.slice(0, visibleCount),
        [sortedFiltered, visibleCount],
    );
    const selectedCandidate =
        sortedFiltered.find((c) => c.id === selectedId) ??
        normalized.candidates.find((c) => c.id === selectedId) ??
        null;

    const selectCandidate = useCallback((c) => {
        setSelectedId(c.id);
    }, []);

    // ترطيب المرشحين المكشوفين سابقاً (لكي تبقى البيانات مفتوحة بعد إعادة التحميل).
    const visibleKeysSig = useMemo(
        () => visibleList.map((c) => candidateRevealKey(c)).filter(Boolean).join('|'),
        [visibleList],
    );
    useEffect(() => {
        const keys = visibleKeysSig ? visibleKeysSig.split('|') : [];
        const missing = keys.filter((k) => !revealedFieldState.has(k));
        if (missing.length === 0) return;
        let alive = true;
        apiClient
            .post('/api/head-hunter/revealed-contacts', { keys: missing })
            .then((data) => {
                if (!alive || !data?.ok) return;
                const records = Array.isArray(data.records) ? data.records : [];
                if (records.length === 0 && Array.isArray(data.revealed)) {
                    setRevealedFieldState((prev) => {
                        let next = prev;
                        data.revealed.forEach((k) => {
                            next = mergeRevealRecord(next, k, { legacyFullReveal: true, revealedFields: [] });
                        });
                        return next;
                    });
                    return;
                }
                setRevealedFieldState((prev) => {
                    let next = prev;
                    records.forEach((row) => {
                        if (row?.candidateKey) {
                            next = mergeRevealRecord(next, row.candidateKey, row);
                        }
                    });
                    return next;
                });
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [visibleKeysSig]); // eslint-disable-line react-hooks/exhaustive-deps

    // Read through refs so the handler identity survives reveal-state updates —
    // otherwise every revealed contact re-renders the whole card list.
    const revealedFieldStateRef = useRef(revealedFieldState);
    revealedFieldStateRef.current = revealedFieldState;
    const revealPendingKeyRef = useRef(revealPendingKey);
    revealPendingKeyRef.current = revealPendingKey;

    const handleRevealContact = useCallback(
        async (candidate) => {
            const key = candidateRevealKey(candidate);
            if (
                !key ||
                isContactFullyRevealed(candidate, revealedFieldStateRef.current) ||
                revealPendingKeyRef.current
            ) {
                return;
            }
            setRevealPendingKey(key);
            setRevealErrorKey(null);
            try {
                const res = await apiClient.post('/api/head-hunter/reveal-contact', {
                    candidateKey: key,
                    phone: candidate.phone,
                    email: candidate.email,
                    linkedin: candidate.linkedin_url,
                });
                if (res?.ok) {
                    const resolvedKey = res.candidateKey || key;
                    setRevealedFieldState((prev) =>
                        mergeRevealRecord(prev, resolvedKey, {
                            legacyFullReveal: false,
                            revealedFields: res.revealedFields,
                        }),
                    );
                    if (Number.isFinite(res.creditsRemaining) || Number.isFinite(res.balanceAfterMicro)) {
                        applyLocalBalance({
                            balanceMicro: res.balanceAfterMicro,
                            creditsRemaining: res.creditsRemaining,
                        });
                    }
                    if (!res.alreadyRevealed) {
                        void refetchBilling();
                    }
                }
            } catch (err) {
                const message =
                    err?.status === 402
                        ? t('aiHeadHunterRevealNoCredits')
                        : t('aiHeadHunterRevealError');
                setRevealErrorKey({ key, message });
            } finally {
                setRevealPendingKey(null);
            }
        },
        [applyLocalBalance, refetchBilling, t],
    );

    return (
        <>
            {n8nInbound.error ? (
                <p className="head-hunter-feedback head-hunter-feedback--err" role="status">
                    {n8nInbound.error}
                </p>
            ) : null}

            {n8nInbound.loading ? (
                <>
                    <AiWorkingIndicator kind="headHunter" />
                    <HeadHunterResultsSkeleton count={8} />
                </>
            ) : visibleList.length === 0 ? (
                n8nInbound.receivedAt && !n8nInbound.loading ? (
                    <p className="head-hunter-feedback head-hunter-feedback--warn" role="status">
                        {t('aiHeadHunterResultsEmpty')}
                    </p>
                ) : null
            ) : (
                <>
                    <div className="headhunter-results-grid">
                        {visibleList.map((c) => {
                            const revealKey = candidateRevealKey(c);
                            return (
                                <HeadHunterCandidateCard
                                    key={`${c.id}-${c.payload_index}`}
                                    candidate={c}
                                    selected={selectedId === c.id}
                                    onSelect={selectCandidate}
                                    contactStatus={contactStatus}
                                    campaignId={campaignId}
                                    campaignPosition={campaignPosition}
                                    searchContext={searchContext}
                                    contactRevealed={isContactFullyRevealed(c, revealedFieldState)}
                                    contactRevealPending={revealPendingKey === revealKey}
                                    contactRevealError={
                                        revealErrorKey?.key === revealKey ? revealErrorKey.message : ''
                                    }
                                    onRevealContact={handleRevealContact}
                                    t={t}
                                />
                            );
                        })}
                    </div>
                    {sortedFiltered.length > visibleCount ? (
                        <div className="headhunter-show-more">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setVisibleCount((n) => n + HEADHUNTER_RESULTS_PAGE_SIZE)}
                            >
                                {t('aiHeadHunterShowMore')}
                            </button>
                        </div>
                    ) : null}
                </>
            )}

            {selectedCandidate
                ? createPortal(
                      <div className="ai-head-hunter-page headhunter-panel-portal-mount">
                          <button
                              type="button"
                              className="headhunter-discovery__backdrop headhunter-discovery__backdrop--open"
                              aria-label={t('aiHeadHunterClosePanel')}
                              onClick={() => setSelectedId(null)}
                          />
                          <div className="headhunter-discovery__panel-slot headhunter-discovery__panel-slot--open">
                              <HeadHunterCandidatePanel
                                  candidate={selectedCandidate}
                                  onClose={() => setSelectedId(null)}
                                  showClose
                                  contactStatus={contactStatus}
                                  contactRevealed={isContactFullyRevealed(selectedCandidate, revealedFieldState)}
                                  contactRevealPending={
                                      revealPendingKey === candidateRevealKey(selectedCandidate)
                                  }
                                  contactRevealError={
                                      revealErrorKey?.key === candidateRevealKey(selectedCandidate)
                                          ? revealErrorKey.message
                                          : ''
                                  }
                                  onRevealContact={handleRevealContact}
                                  t={t}
                              />
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}
