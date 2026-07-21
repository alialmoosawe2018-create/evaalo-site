import React from 'react';
import '../design-styles.css';

/**
 * Shown when a candidate interview link was already used (single-use after a meaningful session).
 * Light shell aligned with form intake.
 */
export default function InterviewLinkBlocked({ title, message, dir = 'ltr' }) {
    return (
        <div
            className="form-page"
            dir={dir}
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
            }}
        >
            <div
                style={{
                    maxWidth: '480px',
                    width: '100%',
                    padding: '32px 28px',
                    borderRadius: '16px',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    background: '#ffffff',
                    boxShadow: '0 8px 28px rgba(99, 102, 241, 0.12)',
                    textAlign: 'center',
                    color: '#334155',
                }}
            >
                <div style={{ fontSize: '2.5rem', marginBottom: '16px', color: '#10b981' }} aria-hidden="true">
                    ✓
                </div>
                <h1 style={{ fontSize: '1.35rem', margin: '0 0 12px', color: '#0f172a' }}>{title}</h1>
                <p style={{ margin: 0, lineHeight: 1.6, color: '#64748b', fontSize: '0.95rem' }}>{message}</p>
            </div>
        </div>
    );
}
