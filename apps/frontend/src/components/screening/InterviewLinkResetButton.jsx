import React, { useState } from 'react';
import { apiClient } from '../../services/apiClient.js';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';

/**
 * HR action: clears voice/video interview link consumption so the candidate can retry.
 *
 * The link state is always stated, and the action is offered only while the link
 * is actually consumed — an always-visible button that reopens an already-open
 * link gives HR no feedback, so a reset aimed at the wrong flag reads as success.
 */
export default function InterviewLinkResetButton({
    candidate,
    stage,
    t,
    onReset,
    consumedAt,
    variant = 'standalone',
}) {
    const [loading, setLoading] = useState(false);

    const candidateId = candidate?._id || candidate?.id;
    if (!candidateId) return null;

    const handleReset = async (e) => {
        e?.stopPropagation?.();
        if (loading) return;
        if (!window.confirm(t('interviewLinkReset_confirm'))) return;
        setLoading(true);
        // Safari can stall a POST (aggressive keep-alive / caching) so the promise
        // never settles and the button sticks on '…' until a manual page refresh.
        // A hard timeout guarantees the request always resolves and loading resets.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const data = await apiClient.post(
                `/api/candidates/${encodeURIComponent(String(candidateId))}/interview-link-reset`,
                {
                    stage,
                    applicationId: candidate?.applicationId || undefined,
                    campaignId: candidate?.campaignId || undefined,
                },
                { signal: controller.signal },
            );
            if (!data?.success) {
                window.alert(data?.message || data?.error || t('interviewLinkReset_fail'));
                return;
            }
            window.alert(t('interviewLinkReset_ok'));
            onReset?.();
        } catch (err) {
            window.alert(err?.message || t('interviewLinkReset_fail'));
        } finally {
            clearTimeout(timeoutId);
            setLoading(false);
        }
    };

    const stateLabel = (() => {
        if (!consumedAt) return t('interviewLinkReset_stateOpen');
        const when = new Date(consumedAt);
        if (Number.isNaN(when.getTime())) return t('interviewLinkReset_stateConsumed');
        return fillI18nTemplate(t('interviewLinkReset_stateConsumedAt'), {
            date: when.toLocaleString(),
        });
    })();

    const isConsumed = Boolean(consumedAt);

    if (variant === 'menu') {
        return (
            <>
                <p className="headhunter-card__video-popover-linkstate">{stateLabel}</p>
                {isConsumed ? (
                    <button
                        type="button"
                        className="headhunter-card__video-popover-copy headhunter-card__video-popover-reset"
                        onClick={handleReset}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={loading}
                        title={t('interviewLinkReset_btn')}
                    >
                        {loading ? '…' : t('interviewLinkReset_btn')}
                    </button>
                ) : null}
            </>
        );
    }

    return (
        <>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'rgba(148, 163, 184, 0.95)' }}>
                {stateLabel}
            </p>
            {isConsumed ? (
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleReset}
                    disabled={loading}
                    style={{ fontSize: '12px', padding: '6px 10px', marginTop: '6px' }}
                    title={t('interviewLinkReset_btn')}
                >
                    {loading ? '…' : t('interviewLinkReset_btn')}
                </button>
            ) : null}
        </>
    );
}
