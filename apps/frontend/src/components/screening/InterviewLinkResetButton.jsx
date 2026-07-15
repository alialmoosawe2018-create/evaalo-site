import React, { useState } from 'react';
import { apiClient } from '../../services/apiClient.js';

/**
 * HR action: clears voice/video interview link consumption so the candidate can retry.
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

    if (!consumedAt) return null;

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

    if (variant === 'menu') {
        return (
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
        );
    }

    return (
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
    );
}
