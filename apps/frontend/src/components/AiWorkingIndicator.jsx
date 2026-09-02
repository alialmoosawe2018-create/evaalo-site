import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getAiWorkingSteps } from '../constants/aiWorkingSteps.js';

/**
 * Claude-style "AI is working" indicator: a checklist of steps that progressively
 * complete while an async job (CV comparison / head-hunter search) runs, to reduce
 * the perceived wait. Purely visual — it advances on a timer and holds on the last
 * step; the real completion is signalled by the parent unmounting this component.
 */

const CSS = `
@keyframes aiw-orb { 0%,100%{transform:scale(1);opacity:.85} 50%{transform:scale(1.28);opacity:1} }
@keyframes aiw-spin { to { transform: rotate(360deg); } }
@keyframes aiw-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.aiw{border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;background:#f8fafc;max-width:540px;margin:10px auto}
.aiw__head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.aiw__orb{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#60a5fa,#2563eb);animation:aiw-orb 1.4s ease-in-out infinite;flex:0 0 auto}
.aiw__title{font-weight:800;color:#0f172a;font-size:15px;flex:1;min-width:0}
.aiw__timer{color:#94a3b8;font-size:12px;font-variant-numeric:tabular-nums;flex:0 0 auto}
.aiw__steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.aiw__step{display:flex;align-items:center;gap:10px;font-size:14px;transition:color .3s,opacity .3s}
.aiw__mark{width:18px;height:18px;border-radius:50%;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:2px solid #cbd5e1;color:#94a3b8;box-sizing:border-box}
.aiw__step--done .aiw__mark{background:#16a34a;border-color:#16a34a;color:#fff}
.aiw__step--done .aiw__label{color:#475569}
.aiw__step--active .aiw__mark{border-color:#2563eb;border-top-color:transparent;color:transparent;animation:aiw-spin .8s linear infinite}
.aiw__step--active .aiw__label{font-weight:700;background:linear-gradient(90deg,#1d4ed8 25%,#93c5fd 50%,#1d4ed8 75%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:aiw-shimmer 2s linear infinite}
.aiw__step--todo{opacity:.5}
.aiw__label{color:#334155}
`;

function injectCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ai-working-css')) return;
    const style = document.createElement('style');
    style.id = 'ai-working-css';
    style.textContent = CSS;
    document.head.appendChild(style);
}

// Inject at module load so the stylesheet is in <head> before the component ever
// paints — avoids a one-frame flash of the raw, unstyled checklist (looked like
// overlapping/broken data when the search steps first appeared).
injectCss();

export default function AiWorkingIndicator({ kind, stepMs = 2600 }) {
    const { currentLang } = useLanguage();
    const steps = getAiWorkingSteps(kind, currentLang);
    const [current, setCurrent] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef(Date.now());

    // Belt-and-suspenders: also ensure the CSS is present before this render paints
    // (module-load injection already covers the common case).
    injectCss();

    // Advance through the steps, holding on the last one until the parent unmounts us.
    useEffect(() => {
        setCurrent(0);
        startRef.current = Date.now();
        if (steps.length <= 1) return undefined;
        const id = setInterval(() => {
            setCurrent((c) => Math.min(c + 1, steps.length - 1));
        }, stepMs);
        return () => clearInterval(id);
    }, [steps.length, stepMs]);

    useEffect(() => {
        const id = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    if (!steps.length) return null;

    return (
        <div className="aiw" role="status" aria-live="polite">
            <div className="aiw__head">
                <span className="aiw__orb" aria-hidden="true" />
                <span className="aiw__title">{steps[current]}…</span>
                <span className="aiw__timer">{elapsed}s</span>
            </div>
            <ol className="aiw__steps">
                {steps.map((label, i) => {
                    const state = i < current ? 'done' : i === current ? 'active' : 'todo';
                    return (
                        <li key={i} className={`aiw__step aiw__step--${state}`}>
                            <span className="aiw__mark" aria-hidden="true">
                                {state === 'done' ? '✓' : ''}
                            </span>
                            <span className="aiw__label">{label}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
