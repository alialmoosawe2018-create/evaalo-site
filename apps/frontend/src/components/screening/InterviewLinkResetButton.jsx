import React, { useState } from 'react';
import { apiClient } from '../../services/apiClient.js';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';

/**
 * HR action: clears voice/video interview link consumption so the candidate can retry.
 *
 * The action is always offered and the current link state is stated next to it.
 * Hiding the button whenever `consumedAt` is empty made it a state indicator
 * disguised as an action: any lag in the board's data looked like a dead control,
 * and HR had no way to see whether a link was open. The endpoint is idempotent,
 * so reopening an already-open link is harmless.
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
        try {
            const data = await apiClient.post(
                `/api/candidates/${encodeURIComponent(String(candidateId))}/interview-link-reset`,
                {
                    stage,
                    applicationId: candidate?.applicationId || undefined,
                    campaignId: candidate?.campaignId || undefined,
                },
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

    if (variant === 'menu') {
        return (
            <>
                <p className="headhunter-card__video-popover-linkstate">{stateLabel}</p>
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
            </>
        );
    }

    return (
        <>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'rgba(148, 163, 184, 0.95)' }}>
                {stateLabel}
            </p>
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
        </>
    );
}
