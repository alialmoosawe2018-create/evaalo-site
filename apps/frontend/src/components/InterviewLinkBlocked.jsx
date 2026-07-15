import React from 'react';
import '../design-styles.css';

/**
 * Shown when a candidate interview link was already used (single-use after a meaningful session).
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
                background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
            }}
        >
            <div
                style={{
                    maxWidth: '480px',
                    width: '100%',
                    padding: '32px 28px',
                    borderRadius: '16px',
                    border: '1px solid rgba(34, 211, 238, 0.25)',
                    background: 'rgba(15, 23, 42, 0.85)',
                    textAlign: 'center',
                    color: '#e2e8f0',
                }}
            >
                <div style={{ fontSize: '2.5rem', marginBottom: '16px' }} aria-hidden="true">
                    ✓
                </div>
                <h1 style={{ fontSize: '1.35rem', margin: '0 0 12px', color: '#f8fafc' }}>{title}</h1>
                <p style={{ margin: 0, lineHeight: 1.6, color: '#94a3b8', fontSize: '0.95rem' }}>{message}</p>
            </div>
        </div>
    );
}
