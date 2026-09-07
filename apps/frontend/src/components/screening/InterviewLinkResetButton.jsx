import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '../../services/apiClient.js';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';

/**
 * HR action: clears voice/video interview link consumption so the candidate can retry.
 *
 * The link state is always stated, and the action is offered only while the link
 * is actually consumed — an always-visible button that reopens an already-open
 * link gives HR no feedback, so a reset aimed at the wrong flag reads as success.
 *
 * ⚠️ No `window.confirm` / `window.alert` here, deliberately. Both are synchronous:
 * they block the main thread and stop painting entirely, and iOS Safari is heavy
 * with them. Worse, the two alerts fired AFTER an `await`, i.e. outside the click's
 * user-gesture stack, which iOS defers — that is what made the page look frozen for
 * seconds after pressing this button. An earlier fix added an AbortController for a
 * stalled POST, which treated a different symptom and left the dialogs in place.
 * Confirmation and result are both inline now, so nothing ever blocks the page.
 */
const STATUS_CLEAR_MS = 5000;

export default function InterviewLinkResetButton({
    candidate,
    stage,
    t,
    onReset,
    consumedAt,
    variant = 'standalone',
}) {
    const [loading, setLoading] = useState(false);
    const [confirming, setConfirming] = useState(false);
    /** { kind: 'ok' | 'error', text } — النتيجة تُعرض مكان النافذة الحاجبة. */
    const [status, setStatus] = useState(null);
    const statusTimerRef = useRef(null);

    useEffect(() => () => clearTimeout(statusTimerRef.current), []);

    const showStatus = (kind, text) => {
        setStatus({ kind, text });
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
    };

    const candidateId = candidate?._id || candidate?.id;
    if (!candidateId) return null;

    /** النقرة الأولى تطلب التأكيد فقط — لا شبكة ولا نافذة. */
    const askConfirm = (e) => {
        e?.stopPropagation?.();
        if (loading) return;
        setStatus(null);
        setConfirming(true);
    };

    const cancelConfirm = (e) => {
        e?.stopPropagation?.();
        setConfirming(false);
    };

    const handleReset = async (e) => {
        e?.stopPropagation?.();
        if (loading) return;
        setConfirming(false);
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
                showStatus('error', data?.message || data?.error || t('interviewLinkReset_fail'));
                return;
            }
            showStatus('ok', t('interviewLinkReset_ok'));
            onReset?.();
        } catch (err) {
            showStatus('error', err?.message || t('interviewLinkReset_fail'));
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

    /** رسالة النتيجة — تحلّ محلّ window.alert، وتختفي وحدها. */
    const statusNote = status ? (
        <p
            role="status"
            style={{
                margin: '6px 0 0',
                fontSize: '11px',
                lineHeight: 1.5,
                color: status.kind === 'ok' ? '#34d399' : '#f87171',
            }}
        >
            {status.text}
        </p>
    ) : null;

    if (variant === 'menu') {
        return (
            <>
                <p className="headhunter-card__video-popover-linkstate">{stateLabel}</p>
                {isConsumed && !confirming ? (
                    <button
                        type="button"
                        className="headhunter-card__video-popover-copy headhunter-card__video-popover-reset"
                        onClick={askConfirm}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={loading}
                        title={t('interviewLinkReset_btn')}
                    >
                        {loading ? '…' : t('interviewLinkReset_btn')}
                    </button>
                ) : null}
                {isConsumed && confirming ? (
                    <>
                        <p className="headhunter-card__video-popover-linkstate">
                            {t('interviewLinkReset_confirm')}
                        </p>
                        <button
                            type="button"
                            className="headhunter-card__video-popover-copy headhunter-card__video-popover-reset"
                            onClick={handleReset}
                            onMouseDown={(e) => e.stopPropagation()}
                            disabled={loading}
                        >
                            {t('interviewLinkReset_confirmYes')}
                        </button>
                        <button
                            type="button"
                            className="headhunter-card__video-popover-copy"
                            onClick={cancelConfirm}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            {t('interviewLinkReset_confirmNo')}
                        </button>
                    </>
                ) : null}
                {statusNote}
            </>
        );
    }

    const smallBtn = { fontSize: '12px', padding: '6px 10px', marginTop: '6px' };

    return (
        <>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'rgba(148, 163, 184, 0.95)' }}>
                {stateLabel}
            </p>
            {isConsumed && !confirming ? (
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={askConfirm}
                    disabled={loading}
                    style={smallBtn}
                    title={t('interviewLinkReset_btn')}
                >
                    {loading ? '…' : t('interviewLinkReset_btn')}
                </button>
            ) : null}
            {isConsumed && confirming ? (
                <>
                    <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'rgba(226, 232, 240, 0.95)' }}>
                        {t('interviewLinkReset_confirm')}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleReset}
                            disabled={loading}
                            style={smallBtn}
                        >
                            {t('interviewLinkReset_confirmYes')}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={cancelConfirm}
                            style={smallBtn}
                        >
                            {t('interviewLinkReset_confirmNo')}
                        </button>
                    </div>
                </>
            ) : null}
            {statusNote}
        </>
    );
}
