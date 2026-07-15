import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTypeLabel } from '../utils/designUtils';
import '../design-styles.css';

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function questionKey(q, index) {
    return q?.id != null ? String(q.id) : `idx-${index}`;
}

/** @param {Record<string, string>} answers */
function formatAnswerForDisplay(type, raw) {
    if (raw == null || raw === '') return '—';
    if (type === 'checkbox') {
        try {
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr) || arr.length === 0) return '—';
            return arr.join(', ');
        } catch {
            return raw;
        }
    }
    return raw;
}

export default function DesignedInterviewRun() {
    const [payload, setPayload] = useState(() => {
        try {
            const qRaw = localStorage.getItem('designerQuestions');
            const sRaw = localStorage.getItem('designerSettings');
            const questions = qRaw ? JSON.parse(qRaw) : [];
            const settings = sRaw ? JSON.parse(sRaw) : {};
            return {
                questions: Array.isArray(questions) ? questions : [],
                settings: settings && typeof settings === 'object' ? settings : {},
            };
        } catch {
            return { questions: [], settings: {} };
        }
    });

    const [answers, setAnswers] = useState({});
    const [submitted, setSubmitted] = useState(false);

    const { orderedQuestions, randomized } = useMemo(() => {
        const list = payload.questions;
        const randomize = Boolean(payload.settings?.randomizeQuestions);
        if (!list.length) return { orderedQuestions: [], randomized: false };
        return {
            orderedQuestions: randomize ? shuffleArray(list) : list,
            randomized: randomize,
        };
    }, [payload.questions, payload.settings?.randomizeQuestions]);

    useEffect(() => {
        const onStorage = (e) => {
            if (e.key !== 'designerQuestions' && e.key !== 'designerSettings') return;
            try {
                const qRaw = localStorage.getItem('designerQuestions');
                const sRaw = localStorage.getItem('designerSettings');
                const questions = qRaw ? JSON.parse(qRaw) : [];
                const settings = sRaw ? JSON.parse(sRaw) : {};
                setPayload({
                    questions: Array.isArray(questions) ? questions : [],
                    settings: settings && typeof settings === 'object' ? settings : {},
                });
                setAnswers({});
                setSubmitted(false);
            } catch {
                /* ignore */
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const setAnswer = useCallback((key, value) => {
        setAnswers((prev) => ({ ...prev, [key]: value }));
    }, []);

    const handleSubmit = useCallback(
        (e) => {
            e.preventDefault();
            setSubmitted(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        []
    );

    const title = payload.settings?.title?.trim() || 'Designed interview';
    const showResults = Boolean(payload.settings?.showResults);
    const enableAI = Boolean(payload.settings?.enableAIAnalysis);

    const inputStyle = {
        width: '100%',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid rgba(56, 189, 248, 0.35)',
        background: 'rgba(15, 23, 42, 0.85)',
        color: '#e2e8f0',
        fontSize: 15,
        boxSizing: 'border-box',
    };

    const labelStyle = { display: 'block', fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 };

    const renderField = (q, index) => {
        const key = questionKey(q, index);
        const t = q.type;
        const opts = Array.isArray(q.options) ? q.options : [];

        if (t === 'short-text' || t === 'email' || t === 'phone' || t === 'number' || t === 'url') {
            const inputType =
                t === 'email' ? 'email' : t === 'phone' ? 'tel' : t === 'number' ? 'number' : t === 'url' ? 'url' : 'text';
            return (
                <input
                    type={inputType}
                    style={inputStyle}
                    value={answers[key] || ''}
                    onChange={(e) => setAnswer(key, e.target.value)}
                    disabled={submitted}
                />
            );
        }

        if (t === 'long-text') {
            return (
                <textarea
                    style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
                    value={answers[key] || ''}
                    onChange={(e) => setAnswer(key, e.target.value)}
                    disabled={submitted}
                />
            );
        }

        if (t === 'multiple') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {opts.map((opt, i) => {
                        const text = typeof opt === 'string' ? opt : opt.text;
                        const id = `${key}-opt-${i}`;
                        return (
                            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: submitted ? 'default' : 'pointer', color: '#cbd5e1' }}>
                                <input
                                    type="radio"
                                    name={key}
                                    checked={answers[key] === text}
                                    onChange={() => setAnswer(key, text)}
                                    disabled={submitted}
                                />
                                <span>{text}</span>
                            </label>
                        );
                    })}
                </div>
            );
        }

        if (t === 'checkbox') {
            const selected = (() => {
                try {
                    const p = JSON.parse(answers[key] || '[]');
                    return Array.isArray(p) ? p : [];
                } catch {
                    return [];
                }
            })();
            const toggle = (text) => {
                const next = selected.includes(text) ? selected.filter((x) => x !== text) : [...selected, text];
                setAnswer(key, JSON.stringify(next));
            };
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {opts.map((opt, i) => {
                        const text = typeof opt === 'string' ? opt : opt.text;
                        const id = `${key}-cb-${i}`;
                        return (
                            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: submitted ? 'default' : 'pointer', color: '#cbd5e1' }}>
                                <input type="checkbox" checked={selected.includes(text)} onChange={() => toggle(text)} disabled={submitted} />
                                <span>{text}</span>
                            </label>
                        );
                    })}
                </div>
            );
        }

        if (t === 'dropdown') {
            return (
                <select style={{ ...inputStyle, cursor: submitted ? 'default' : 'pointer' }} value={answers[key] || ''} onChange={(e) => setAnswer(key, e.target.value)} disabled={submitted}>
                    <option value="">Select…</option>
                    {opts.map((opt, i) => {
                        const text = typeof opt === 'string' ? opt : opt.text;
                        return (
                            <option key={i} value={text}>
                                {text}
                            </option>
                        );
                    })}
                </select>
            );
        }

        if (t === 'yes-no') {
            return (
                <div style={{ display: 'flex', gap: 16 }}>
                    {['Yes', 'No'].map((opt) => (
                        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', cursor: submitted ? 'default' : 'pointer' }}>
                            <input type="radio" name={key} checked={answers[key] === opt} onChange={() => setAnswer(key, opt)} disabled={submitted} />
                            {opt}
                        </label>
                    ))}
                </div>
            );
        }

        if (t === 'rating') {
            return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => !submitted && setAnswer(key, String(n))}
                            disabled={submitted}
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 10,
                                border: answers[key] === String(n) ? '2px solid #22d3ee' : '1px solid rgba(148, 163, 184, 0.4)',
                                background: answers[key] === String(n) ? 'rgba(34, 211, 238, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                                color: '#fff',
                                fontWeight: 700,
                                cursor: submitted ? 'default' : 'pointer',
                            }}
                        >
                            {n}
                        </button>
                    ))}
                </div>
            );
        }

        if (t === 'linear-scale') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>1</span>
                    <input
                        type="range"
                        min={1}
                        max={10}
                        value={answers[key] ? Number(answers[key]) : 5}
                        onChange={(e) => setAnswer(key, e.target.value)}
                        disabled={submitted}
                        style={{ flex: 1, minWidth: 120 }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>10</span>
                    <span style={{ color: '#22d3ee', fontWeight: 600 }}>{answers[key] || '5'}</span>
                </div>
            );
        }

        if (t === 'date') {
            return <input type="date" style={inputStyle} value={answers[key] || ''} onChange={(e) => setAnswer(key, e.target.value)} disabled={submitted} />;
        }

        if (t === 'time') {
            return <input type="time" style={inputStyle} value={answers[key] || ''} onChange={(e) => setAnswer(key, e.target.value)} disabled={submitted} />;
        }

        if (t === 'file' || t === 'voice') {
            return (
                <input
                    type="file"
                    style={{ color: '#cbd5e1' }}
                    accept={t === 'voice' ? 'audio/*' : undefined}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        setAnswer(key, f ? f.name : '');
                    }}
                    disabled={submitted}
                />
            );
        }

        if (t === 'video') {
            return <p style={{ color: '#94a3b8', margin: 0 }}>Video question type is not enabled in the designer yet.</p>;
        }

        return (
            <input type="text" style={inputStyle} value={answers[key] || ''} onChange={(e) => setAnswer(key, e.target.value)} disabled={submitted} placeholder="Your answer" />
        );
    };

    if (!orderedQuestions.length) {
        return (
            <div className="design-page" style={{ minHeight: '100vh', padding: 32 }}>
                <div className="design-background" aria-hidden>
                    <div className="gradient-orb design-orb-1" />
                    <div className="gradient-orb design-orb-2" />
                </div>
                <div style={{ position: 'relative', zIndex: 1, maxWidth: 560, margin: '0 auto' }}>
                    <h1 className="design-title" style={{ fontSize: 26 }}>No questions to run</h1>
                    <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>Add questions in Form Designer, then open this page again.</p>
                    <Link to="/design" className="btn btn-primary" style={{ display: 'inline-flex', marginTop: 16 }}>
                        Go to Designer
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="design-page" style={{ minHeight: '100vh', padding: '24px 20px 48px' }}>
            <div className="design-background" aria-hidden>
                <div className="gradient-orb design-orb-1" />
                <div className="gradient-orb design-orb-2" />
                <div className="gradient-orb design-orb-3" />
            </div>
            <div className="design-container" style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto' }}>
                <div style={{ marginBottom: 20 }}>
                    <Link to="/design" style={{ color: '#67e8f9', fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
                        ← Back to Designer
                    </Link>
                </div>

                <h1 className="design-title" style={{ fontSize: 28, marginBottom: 8 }}>
                    {title}
                </h1>
                <p style={{ color: '#94a3b8', marginBottom: 8 }}>
                    Candidate run · {orderedQuestions.length} question{orderedQuestions.length === 1 ? '' : 's'}
                    {randomized ? ' · order randomized' : ''}
                </p>

                {submitted && enableAI && (
                    <div
                        style={{
                            marginBottom: 20,
                            padding: 14,
                            borderRadius: 12,
                            background: 'rgba(59, 130, 246, 0.12)',
                            border: '1px solid rgba(96, 165, 250, 0.35)',
                            color: '#bfdbfe',
                            fontSize: 14,
                            lineHeight: 1.5,
                        }}
                    >
                        <strong style={{ color: '#e0f2fe' }}>AI analysis</strong> is enabled in your design settings. A real scoring or LLM summary would run on the server after you connect an API; this preview only collects answers in the browser.
                    </div>
                )}

                {submitted && showResults && (
                    <div
                        style={{
                            marginBottom: 28,
                            padding: 20,
                            borderRadius: 14,
                            background: 'rgba(15, 23, 42, 0.9)',
                            border: '1px solid rgba(34, 211, 238, 0.25)',
                        }}
                    >
                        <h2 style={{ margin: '0 0 16px', color: '#fff', fontSize: 18 }}>Your responses</h2>
                        <ol style={{ margin: 0, paddingLeft: 20, color: '#e2e8f0', lineHeight: 1.6 }}>
                            {orderedQuestions.map((q, i) => {
                                const k = questionKey(q, i);
                                return (
                                    <li key={k} style={{ marginBottom: 14 }}>
                                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>{q.text}</div>
                                        <div style={{ color: '#94a3b8', marginTop: 4 }}>{formatAnswerForDisplay(q.type, answers[k])}</div>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                )}

                {submitted && !showResults && (
                    <p style={{ color: '#86efac', marginBottom: 24, fontWeight: 600 }}>Submitted. Results are hidden by designer settings (Show Results to Candidate is off).</p>
                )}

                <form onSubmit={handleSubmit}>
                    {orderedQuestions.map((q, index) => {
                        const k = questionKey(q, index);
                        return (
                            <div
                                key={k}
                                style={{
                                    marginBottom: 28,
                                    padding: 22,
                                    borderRadius: 14,
                                    background: 'rgba(30, 41, 59, 0.75)',
                                    border: '1px solid rgba(34, 211, 238, 0.2)',
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
                                <label style={labelStyle}>{q.text}</label>
                                {renderField(q, index)}
                            </div>
                        );
                    })}

                    {!submitted && (
                        <button type="submit" className="btn btn-primary" style={{ padding: '14px 28px', fontSize: 16, fontWeight: 600 }}>
                            Submit interview
                        </button>
                    )}
                    {submitted && (
                        <button type="button" className="btn btn-secondary" onClick={() => { setSubmitted(false); setAnswers({}); }}>
                            Edit answers
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
