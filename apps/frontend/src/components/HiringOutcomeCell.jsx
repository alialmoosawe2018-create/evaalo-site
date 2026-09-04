import React, { useState } from 'react';
import { apiClient } from '../services/apiClient';

/**
 * Records what the employer actually did with a candidate.
 *
 * This is the only place in the product where a HUMAN verdict is captured. Every
 * other number on this board is the AI grading its own work, so without this there
 * is no way to ask whether an evaluation was right — and no data behind any claim
 * that the interview agent is improving.
 *
 * Deliberately three states, not a checkbox: "withdrawn" is neither a hire nor a
 * rejection, and folding it into "not hired" would teach the model that a candidate
 * who took another offer was a bad candidate.
 */
const OPTIONS = [
    { value: 'hired', labelKey: 'candidates_outcomeHired', color: '#059669', bg: 'rgba(16, 185, 129, 0.12)' },
    { value: 'not_hired', labelKey: 'candidates_outcomeNotHired', color: '#DC2626', bg: 'rgba(239, 68, 68, 0.12)' },
    { value: 'withdrawn', labelKey: 'candidates_outcomeWithdrawn', color: '#64748B', bg: 'rgba(100, 116, 139, 0.12)' },
];

export default function HiringOutcomeCell({ applicationId, outcome, onRecorded, t }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);

    const record = async (decision) => {
        if (!applicationId || saving) return;
        setSaving(true);
        setError(false);
        try {
            const res = await apiClient.post(
                `/api/candidates/${encodeURIComponent(applicationId)}/hiring-outcome`,
                { decision }
            );
            if (res?.success && res.hiringOutcome) onRecorded?.(res.hiringOutcome);
            else setError(true);
        } catch {
            // Never surface a stack to a recruiter mid-review; the row stays usable
            // and they can try again.
            setError(true);
        } finally {
            setSaving(false);
        }
    };

    const current = OPTIONS.find((o) => o.value === outcome?.decision);
    if (current) {
        return (
            <span
                title={outcome?.decidedAt ? new Date(outcome.decidedAt).toLocaleString() : undefined}
                style={{
                    display: 'inline-block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: current.color,
                    background: current.bg,
                    border: `1px solid ${current.color}33`,
                    borderRadius: '6px',
                    padding: '3px 10px',
                    whiteSpace: 'nowrap',
                }}
            >
                {t(current.labelKey)}
            </span>
        );
    }

    return (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {OPTIONS.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    disabled={saving}
                    onClick={(e) => {
                        // The row itself expands on click; recording an outcome should not.
                        e.stopPropagation();
                        record(o.value);
                    }}
                    style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: o.color,
                        background: o.bg,
                        border: `1px solid ${o.color}33`,
                        borderRadius: '6px',
                        padding: '3px 8px',
                        cursor: saving ? 'default' : 'pointer',
                        opacity: saving ? 0.5 : 1,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {t(o.labelKey)}
                </button>
            ))}
            {error ? (
                <span style={{ fontSize: '11px', color: '#DC2626' }}>{t('candidates_outcomeFailed')}</span>
            ) : null}
        </div>
    );
}
