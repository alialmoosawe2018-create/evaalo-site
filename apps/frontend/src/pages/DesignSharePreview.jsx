import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getTypeLabel } from '../utils/designUtils';
import '../design-styles.css';

/**
 * Read-only preview for a shared designer interview (localStorage snapshot).
 * URL: /form-preview?id=<shareId>
 */
export default function DesignSharePreview() {
    const [searchParams] = useSearchParams();
    const id = searchParams.get('id') || '';

    const data = useMemo(() => {
        if (!id) return null;
        try {
            const raw = localStorage.getItem(`designShare_${id}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed;
        } catch {
            return null;
        }
    }, [id]);

    return (
        <div className="design-page" style={{ minHeight: '100vh', padding: '24px' }}>
            <div className="design-background" aria-hidden>
                <div className="gradient-orb design-orb-1" />
                <div className="gradient-orb design-orb-2" />
                <div className="gradient-orb design-orb-3" />
            </div>
            <div className="design-container" style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto' }}>
                <div style={{ marginBottom: 24 }}>
                    <Link
                        to="/design"
                        style={{
                            color: '#67e8f9',
                            textDecoration: 'none',
                            fontWeight: 600,
                            fontSize: '14px',
                        }}
                    >
                        ← Back to Form Designer
                    </Link>
                </div>
                {!id ? (
                    <p style={{ color: '#94a3b8' }}>Missing preview id.</p>
                ) : !data ? (
                    <div
                        style={{
                            padding: 24,
                            borderRadius: 16,
                            background: 'rgba(15, 23, 42, 0.85)',
                            border: '1px solid rgba(34, 211, 238, 0.25)',
                            color: '#e2e8f0',
                        }}
                    >
                        <h1 style={{ marginTop: 0, color: '#fff' }}>Preview not found</h1>
                        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
                            This link may be expired, or the interview was never shared from this browser. Open Share again
                            from Form Designer to generate a new link.
                        </p>
                    </div>
                ) : (
                    <>
                        <h1 className="design-title" style={{ marginBottom: 8 }}>
                            {data.title || 'Untitled Interview'}
                        </h1>
                        <p style={{ color: '#94a3b8', marginBottom: 28 }}>
                            Shared preview · {Array.isArray(data.questions) ? data.questions.length : 0} question(s)
                        </p>
                        {(data.questions || []).map((q, index) => (
                            <div
                                key={q.id || index}
                                style={{
                                    marginBottom: 24,
                                    padding: 22,
                                    background: 'rgba(30, 41, 59, 0.75)',
                                    border: '1px solid rgba(34, 211, 238, 0.2)',
                                    borderRadius: 14,
                                }}
                            >
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                                    <span
                                        style={{
                                            padding: '4px 10px',
                                            background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                                            borderRadius: 8,
                                            color: '#fff',
                                            fontWeight: 700,
                                            fontSize: 12,
                                        }}
                                    >
                                        Q{index + 1}
                                    </span>
                                    <span
                                        style={{
                                            padding: '4px 10px',
                                            background: 'rgba(59,130,246,0.2)',
                                            border: '1px solid rgba(59,130,246,0.35)',
                                            borderRadius: 8,
                                            color: '#60A5FA',
                                            fontWeight: 600,
                                            fontSize: 12,
                                        }}
                                    >
                                        {getTypeLabel(q.type)}
                                    </span>
                                </div>
                                <p style={{ color: '#f8fafc', fontSize: 16, fontWeight: 600, margin: '0 0 12px', lineHeight: 1.5 }}>
                                    {q.text || '(No text)'}
                                </p>
                                {Array.isArray(q.options) && q.options.length > 0 && (
                                    <ul style={{ margin: 0, paddingLeft: 20, color: '#cbd5e1', fontSize: 14 }}>
                                        {q.options.map((opt, i) => (
                                            <li key={i} style={{ marginBottom: 6 }}>
                                                {typeof opt === 'string' ? opt : opt.text}
                                                {opt && opt.correct ? ' ✓' : ''}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {(q.timeLimit || q.points) ? (
                                    <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12, marginBottom: 0 }}>
                                        {q.timeLimit ? `Time: ${q.timeLimit}s` : ''}
                                        {q.timeLimit && q.points ? ' · ' : ''}
                                        {q.points ? `Points: ${q.points}` : ''}
                                    </p>
                                ) : null}
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
