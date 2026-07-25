import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import '@fontsource/noto-naskh-arabic';
import '@fontsource/noto-naskh-arabic/700.css';
import notoNaskhCssUrl from '@fontsource/noto-naskh-arabic/index.css?url';
import notoNaskh700CssUrl from '@fontsource/noto-naskh-arabic/700.css?url';
import apReshaperRoot from 'arabic-persian-reshaper';
import '../design-styles.css';
import {
    loadPool,
    mergeDisplayWithPool,
    removeIdsFromPoolAndSave,
    CHART_CANDIDATE_POOL_KEY,
    CHART_CANDIDATE_POOL_UPDATED,
} from '../utils/chartCandidatePool.js';
import { candidatePhotoUrl } from '../utils/candidateAssets.jsx';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../services/apiClient';
import OrgChartImportModal from '../components/OrgChartImportModal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ORG_CHART_KEY = 'evaalo-org-chart';

const defaultOrgStructure = () => ({ departments: [] });

const loadOrgChart = () => {
    try {
        const saved = localStorage.getItem(ORG_CHART_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return parsed.departments?.length ? parsed : defaultOrgStructure();
        }
    } catch (_) {}
    return defaultOrgStructure();
};

const saveOrgChart = (structure) => {
    try {
        localStorage.setItem(ORG_CHART_KEY, JSON.stringify(structure));
    } catch (_) {}
};

/** Styles bundled into server PDF + html2canvas clone (scoped to #evaalo-org-chart-export, theme-aware). */
const ORG_CHART_PDF_EXPORT_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{padding:28px 20px;margin:0 auto;display:block;width:max-content;min-width:100%;max-width:none;}
#evaalo-org-chart-export{display:inline-flex;flex-direction:column;align-items:center;width:max-content;max-width:none;transform:none!important;transition:none!important;overflow:visible!important;}
#evaalo-org-chart-export [data-org-pdf-hide]{display:none!important;}
#evaalo-org-chart-export .org-chart-pdf-ar,
#evaalo-org-chart-export .org-chart-pdf-ar-rtl{font-family:'Cairo','Noto Sans Arabic',system-ui,sans-serif;direction:rtl;unicode-bidi:isolate;}
#evaalo-org-chart-export .org-chart-pdf-ar-ltr{font-family:system-ui,'Segoe UI',sans-serif;direction:ltr!important;unicode-bidi:isolate!important;}
`;

const ORG_CHART_PDF_EXPORT_THEME_CSS = {
    dark: `
html,body{background:#0f172a;color:#e2e8f0;}
#evaalo-org-chart-export .org-chart-org-badge{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#67e8f9;background:rgba(6,182,212,.12);border:1px solid rgba(103,232,249,.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}
#evaalo-org-chart-export .org-chart-dept-bar{background:linear-gradient(145deg,rgba(8,47,73,.65) 0%,rgba(6,78,106,.35) 45%,rgba(15,23,42,.9) 100%);border:1px solid rgba(34,211,238,.4);box-shadow:0 8px 32px -8px rgba(6,182,212,.2),0 4px 16px -4px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);}
#evaalo-org-chart-export .org-chart-dept-name,
#evaalo-org-chart-export .org-chart-pos-name{color:#f8fafc;}
#evaalo-org-chart-export .org-chart-pos-role{color:#a5f3fc;background:linear-gradient(180deg,rgba(6,182,212,.2) 0%,rgba(8,145,178,.12) 100%);border:1px solid rgba(103,232,249,.28);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}
#evaalo-org-chart-export .org-chart-employee-node{background:linear-gradient(155deg,rgba(51,65,85,.55) 0%,rgba(30,41,59,.92) 38%,rgba(15,23,42,.96) 100%);border:1px solid rgba(6,182,212,.45);box-shadow:0 12px 28px -8px rgba(0,0,0,.45),0 4px 12px -4px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.08);}
#evaalo-org-chart-export .org-chart-connector-line{background:rgba(6,182,212,.9)!important;box-shadow:0 0 6px rgba(6,182,212,.4)!important;border-radius:2px;}
#evaalo-org-chart-export .org-chart-edit-input{color:#f8fafc;background:rgba(15,23,42,.85);border:1px solid rgba(34,211,238,.55);}
`,
    light: `
html,body{background:#f8fafc;color:#0f172a;}
#evaalo-org-chart-export .org-chart-org-badge{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#0369a1;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);}
#evaalo-org-chart-export .org-chart-dept-bar{background:linear-gradient(148deg,rgba(186,230,253,.55) 0%,rgba(255,255,255,.98) 50%,rgba(238,242,255,.94) 100%);border:1px solid rgba(56,189,248,.4);box-shadow:0 4px 16px rgba(15,23,42,.08);}
#evaalo-org-chart-export .org-chart-dept-name,
#evaalo-org-chart-export .org-chart-pos-name{color:#0f172a;}
#evaalo-org-chart-export .org-chart-pos-role{color:#0369a1;background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.3);}
#evaalo-org-chart-export .org-chart-employee-node{background:linear-gradient(155deg,rgba(255,255,255,.98) 0%,rgba(240,249,255,.95) 45%,rgba(238,242,255,.92) 100%);border:1px solid rgba(56,189,248,.38);box-shadow:0 4px 16px rgba(15,23,42,.08);}
#evaalo-org-chart-export .org-chart-connector-line{background:rgba(99,102,241,.52)!important;box-shadow:0 0 6px rgba(99,102,241,.22)!important;border-radius:2px;}
#evaalo-org-chart-export .org-chart-edit-input{color:#0f172a;background:rgba(255,255,255,.95);border:1px solid rgba(56,189,248,.45);}
`,
};

const ORG_CHART_CONNECTOR_BY_THEME = {
    dark: { background: 'rgba(6, 182, 212, 0.9)', boxShadow: '0 0 6px rgba(6, 182, 212, 0.4)' },
    light: { background: 'rgba(99, 102, 241, 0.52)', boxShadow: '0 0 6px rgba(99, 102, 241, 0.22)' },
};

function getOrgChartExportTheme() {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-app-theme') === 'light' ? 'light' : 'dark';
}

function buildOrgChartPdfExportCss(theme = getOrgChartExportTheme()) {
    const key = theme === 'light' ? 'light' : 'dark';
    return ORG_CHART_PDF_EXPORT_BASE_CSS + ORG_CHART_PDF_EXPORT_THEME_CSS[key];
}

function getOrgChartExportChartThemeCss(theme = getOrgChartExportTheme()) {
    const key = theme === 'light' ? 'light' : 'dark';
    return ORG_CHART_PDF_EXPORT_THEME_CSS[key].replace(/^html,body\{[^}]+\}\s*/m, '');
}

function buildOrgChartPrintMediaCss(theme = getOrgChartExportTheme()) {
    const bg = getOrgChartExportBackground(theme);
    const textColor = theme === 'light' ? '#0f172a' : '#e2e8f0';
    const chartThemeCss = getOrgChartExportChartThemeCss(theme);
    return `
@media print {
    @page {
        margin: 8mm;
        size: landscape;
    }
    html, body {
        height: auto !important;
        overflow: visible !important;
        background: ${bg} !important;
        color: ${textColor} !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
    #root,
    .dashboard-page,
    .dashboard-page > div,
    .employees-org-chart-wrap,
    .employees-org-chart-card,
    .dashboard-card {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
        min-height: 0 !important;
    }
    body {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-start !important;
        padding: 0 !important;
        margin: 0 !important;
    }
    body * { visibility: hidden !important; }
    #evaalo-org-chart-export,
    #evaalo-org-chart-export * {
        visibility: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
    .employees-org-chart-wrap,
    .employees-org-chart-card,
    .org-chart-viewport {
        overflow: visible !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-start !important;
        width: 100% !important;
        padding: 0 !important;
        cursor: auto !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: ${bg} !important;
    }
    #evaalo-org-chart-export {
        position: static !important;
        left: auto !important;
        top: auto !important;
        width: max-content !important;
        max-width: none !important;
        height: auto !important;
        min-height: auto !important;
        transform: scale(var(--org-chart-print-scale, 1)) !important;
        transform-origin: top center !important;
        margin: 0 auto !important;
        padding: 16px !important;
        background: ${bg} !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
    #evaalo-org-chart-export [data-org-pdf-hide] { display: none !important; }
    ${chartThemeCss}
}`;
}

function getOrgChartConnectorStyle(theme = getOrgChartExportTheme()) {
    const key = theme === 'light' ? 'light' : 'dark';
    const connector = ORG_CHART_CONNECTOR_BY_THEME[key];
    return {
        borderRadius: '2px',
        background: connector.background,
        boxShadow: connector.boxShadow,
    };
}

function getOrgChartExportBackground(theme = getOrgChartExportTheme()) {
    return theme === 'light' ? '#f8fafc' : '#0f172a';
}

function getOrgChartExportBackgroundRgb(theme = getOrgChartExportTheme()) {
    return theme === 'light' ? { r: 248, g: 250, b: 252 } : { r: 15, g: 23, b: 42 };
}

const MIN_ORG_CHART_PDF_BYTES = 1800;

function normalizeOrgChartExportRoot(el) {
    if (!el) return null;
    const saved = {
        transform: el.style.transform,
        transition: el.style.transition,
    };
    el.style.transform = 'none';
    el.style.transition = 'none';
    return saved;
}

function restoreOrgChartExportRoot(el, saved) {
    if (!el || !saved) return;
    el.style.transform = saved.transform;
    el.style.transition = saved.transition;
}

function saveAndResetOrgChartViewport(container) {
    if (!container) return null;
    const saved = {
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
    };
    container.scrollLeft = 0;
    container.scrollTop = 0;
    return saved;
}

function restoreOrgChartViewport(container, saved) {
    if (!container || !saved) return;
    container.scrollLeft = saved.scrollLeft;
    container.scrollTop = saved.scrollTop;
}

function getOrgChartFullCaptureSize(root) {
    if (!root) return { width: 320, height: 240 };
    return {
        width: Math.max(root.scrollWidth, root.offsetWidth, 320),
        height: Math.max(root.scrollHeight, root.offsetHeight, 240),
    };
}

const ORG_CHART_PRINT_SCALE_STYLE_ID = 'evaalo-org-chart-print-scale';

/** Scale wide charts to fit printable page width (landscape). */
function applyOrgChartPrintScale(exportEl) {
    if (!exportEl) return;
    const { width: chartW } = getOrgChartFullCaptureSize(exportEl);
    const margin = 72;
    const pageW = Math.max(window.innerWidth - margin, 960);
    const pageH = Math.max(window.innerHeight - margin, 640);
    const scale = Math.min(1, pageW / chartW, pageH / Math.max(exportEl.scrollHeight, 240));
    let styleEl = document.getElementById(ORG_CHART_PRINT_SCALE_STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = ORG_CHART_PRINT_SCALE_STYLE_ID;
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media print {
  #evaalo-org-chart-export {
    transform: scale(${scale}) !important;
    transform-origin: top center !important;
  }
}`;
    exportEl.style.setProperty('--org-chart-print-scale', String(scale));
}

function clearOrgChartPrintScale(exportEl) {
    document.getElementById(ORG_CHART_PRINT_SCALE_STYLE_ID)?.remove();
    exportEl?.style.removeProperty('--org-chart-print-scale');
}

function isCanvasMostlyBlank(canvas, backgroundRgb = { r: 15, g: 23, b: 42 }) {
    if (!canvas?.width || !canvas?.height) return true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const w = Math.min(canvas.width, 96);
    const h = Math.min(canvas.height, 96);
    const { data } = ctx.getImageData(0, 0, w, h);
    let nonBg = 0;
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i] - backgroundRgb.r);
        const dg = Math.abs(data[i + 1] - backgroundRgb.g);
        const db = Math.abs(data[i + 2] - backgroundRgb.b);
        const da = data[i + 3];
        if (da > 16 && (dr > 18 || dg > 18 || db > 18)) nonBg += 1;
    }
    return nonBg / total < 0.008;
}

/** مستند HTML كامل لتوليد PDF على السيرفر (Chromium) — CSS مضمّن + خطوط عربية + ثيم حالي */
function buildOrgChartServerPdfHtml(exportRootEl, theme = getOrgChartExportTheme()) {
    if (!exportRootEl) return '';
    const bodyInner = exportRootEl.outerHTML;
    return `<!DOCTYPE html>
<html lang="ar" dir="ltr" data-app-theme="${theme}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;700&display=swap" rel="stylesheet"/>
<style>${buildOrgChartPdfExportCss(theme)}</style>
</head>
<body>${bodyInner}</body>
</html>`;
}

const PlusBtn = ({ onClick, isActive, size = 40, variant = 'cyan', title: titleProp }) => {
    const { t } = useLanguage();
    const variantClass = variant === 'rose' ? 'org-chart-action-btn--subordinate' : 'org-chart-action-btn--add';
    return (
    <div
        data-org-pdf-hide
        data-no-pan
        data-no-layout-drag
        className={`org-chart-action-btn ${variantClass}`}
        data-active={isActive ? 'true' : undefined}
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        style={{
            width: size,
            height: size,
        }}
            title={titleProp ?? (variant === 'rose' ? t('employeesAddSubordinate') : undefined)}
    >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
    </div>
);
};

const LEVEL_GAPS = [56, 40, 28, 20, 16];
const getLevelGap = (depth) => LEVEL_GAPS[Math.min(depth, LEVEL_GAPS.length - 1)] ?? 16;

/** Org chart — shared surfaces (export-friendly, no backdrop-filter) */
const ORG_NODE_SHADOW =
    '0 12px 28px -8px rgba(0, 0, 0, 0.45), 0 4px 12px -4px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08)';
const ORG_NODE_SHADOW_DRAG =
    '0 0 0 2px rgba(6, 182, 212, 0.55), 0 10px 28px rgba(6, 182, 212, 0.22)';
const ORG_DEPT_BAR_SHADOW =
    '0 8px 32px -8px rgba(6, 182, 212, 0.2), 0 4px 16px -4px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)';

const ORG_EDIT_INPUT_STYLE = {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    font: 'inherit',
    textAlign: 'center',
    color: '#f8fafc',
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(34, 211, 238, 0.55)',
    borderRadius: '8px',
    outline: 'none',
    padding: '4px 8px',
};

/** Google Fonts often fail to bind inside html2canvas/svg; use fontsource + reshape (APFB) for reliable joining. */
function getArabicPresentationConverter() {
    const root = apReshaperRoot?.default ?? apReshaperRoot;
    const arabic = root?.ArabicShaper;
    return typeof arabic?.convertArabic === 'function' ? arabic.convertArabic.bind(arabic) : null;
}

const convertArabicToPresentationForms = getArabicPresentationConverter();

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

function reshapeArabicTextInCloneSubtree(root) {
    if (!root || !convertArabicToPresentationForms) return;

    const reshapeText = (raw) => {
        if (!raw || !ARABIC_SCRIPT_RE.test(raw)) return raw;
        try {
            return convertArabicToPresentationForms(raw);
        } catch (_) {
            return raw;
        }
    };

    const doc = root.ownerDocument;
    const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let tn;
    while ((tn = tw.nextNode())) textNodes.push(tn);
    for (const node of textNodes) {
        const parentEl = node.parentElement;
        if (parentEl?.closest?.('.org-chart-pdf-ar-ltr')) continue;
        const next = reshapeText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
    }

    root.querySelectorAll('input, textarea').forEach((el) => {
        const v = el.value;
        if (!v || !ARABIC_SCRIPT_RE.test(v)) return;
        const next = reshapeText(v);
        if (next !== v) el.value = next;
    });
}

function appendStylesheetLink(clonedDoc, href) {
    if (!clonedDoc?.head || !href) return;
    const absolute = new URL(href, window.location.href).href;
    if (clonedDoc.querySelector(`link[rel="stylesheet"][href="${absolute}"]`)) return;
    const link = clonedDoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = absolute;
    clonedDoc.head.appendChild(link);
}

function ensureOrgChartPdfFont() {
    if (typeof document === 'undefined') return;

    const styleId = 'evaalo-org-chart-pdf-live-style';
    if (!document.getElementById(styleId)) {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `
#evaalo-org-chart-export .org-chart-pdf-ar { font-family: "Noto Naskh Arabic", system-ui, serif; unicode-bidi: plaintext; }
#evaalo-org-chart-export .org-chart-pdf-ar-rtl { font-family: "Noto Naskh Arabic", system-ui, serif; direction: rtl; unicode-bidi: isolate; }
#evaalo-org-chart-export .org-chart-pdf-ar-ltr { direction: ltr; unicode-bidi: isolate; }
`;
        document.head.appendChild(s);
    }
}

/** html2canvas: cloned document + Arabic presentation forms + bundled Noto + hide PDF chrome */
function applyOrgChartPdfClone(clonedDoc) {
    if (!clonedDoc?.head) return;

    appendStylesheetLink(clonedDoc, notoNaskhCssUrl);
    appendStylesheetLink(clonedDoc, notoNaskh700CssUrl);

    const css = clonedDoc.createElement('style');
    css.setAttribute('data-evaalo-org-pdf', '1');
    const exportTheme = getOrgChartExportTheme();
    css.textContent = `${buildOrgChartPdfExportCss(exportTheme)}
#evaalo-org-chart-export .org-chart-pdf-ar,
#evaalo-org-chart-export .org-chart-pdf-ar-rtl {
  font-family: "Noto Naskh Arabic", serif !important;
  direction: rtl !important;
  unicode-bidi: embed !important;
}
#evaalo-org-chart-export .org-chart-pdf-ar-ltr {
  font-family: system-ui, Segoe UI, sans-serif !important;
  direction: ltr !important;
  unicode-bidi: isolate !important;
}`;
    clonedDoc.head.appendChild(css);

    const exportRoot = clonedDoc.getElementById('evaalo-org-chart-export');
    if (exportRoot) {
        exportRoot.style.setProperty('transform', 'none', 'important');
        exportRoot.style.setProperty('transition', 'none', 'important');
        reshapeArabicTextInCloneSubtree(exportRoot);
    }

    clonedDoc.querySelectorAll('.org-chart-viewport').forEach((vp) => {
        vp.style.setProperty('backdrop-filter', 'none', 'important');
        vp.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        vp.style.setProperty(
            'background',
            'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
            'important'
        );
    });
}

const PositionNode = ({
    pos,
    deptId,
    parentPositionId,
    addCandidateTarget,
    setAddCandidateTarget,
    onDeleteEmployee,
    onReorder,
    onUpdatePosition,
    isFirstSibling = true,
    isLastSibling = true,
    depth = 0,
    suppressExportChrome = false,
}) => {
    const { t } = useLanguage();
    const { theme } = useTheme();
    const [editingField, setEditingField] = useState(null);
    const [draft, setDraft] = useState('');
    const [layoutDragging, setLayoutDragging] = useState(false);
    const holdTimerRef = useRef(null);
    const holdDragStateRef = useRef(null);
    const editInputRef = useRef(null);
    const subs = pos.subordinates || [];
    const layout = (pos.layout && typeof pos.layout === 'object' && !Array.isArray(pos.layout)) ? pos.layout : {};
    const offsetX = Number.isFinite(layout.offsetX) ? layout.offsetX : 0;
    const lineLength = Number.isFinite(layout.lineLength) ? layout.lineLength : 22;
    const isAddingChild = addCandidateTarget?.deptId === deptId && addCandidateTarget?.underPositionId === pos.id;
    const isAddingSiblingBefore =
        addCandidateTarget?.deptId === deptId &&
        addCandidateTarget?.underPositionId === parentPositionId &&
        addCandidateTarget?.insertBefore === pos.id;
    const isAddingSiblingAfter =
        addCandidateTarget?.deptId === deptId &&
        addCandidateTarget?.underPositionId === parentPositionId &&
        addCandidateTarget?.insertAfter === pos.id;
    const lineStyle = getOrgChartConnectorStyle(theme);
    useEffect(() => {
        if (editingField && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingField]);

    const commitFieldEdit = () => {
        if (!editingField || !onUpdatePosition) {
            setEditingField(null);
            return;
        }
        const key = editingField === 'name' ? 'name' : 'position';
        const next = draft.trim();
        if (next && next !== pos[key]) {
            onUpdatePosition(pos.id, { [key]: next });
        }
        setEditingField(null);
    };

    const cancelFieldEdit = () => setEditingField(null);
    const updateLayout = (partial) => {
        if (!onUpdatePosition) return;
        onUpdatePosition(pos.id, {
            layout: {
                ...layout,
                ...partial,
            },
        });
    };

    const orgNodePadInline = 16;
    const showNodeChrome = !suppressExportChrome;
    const orgNodePadInlineEnd = onDeleteEmployee && showNodeChrome ? 40 : orgNodePadInline;
    const orgNodePadTop = onDeleteEmployee && showNodeChrome ? 10 : 14;
    const orgNodeSideSlot = 30;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 0, flexShrink: 0 }}>
                {/* Employee container with delete inside - draggable */}
                <div
                    data-no-pan
                    data-position-id={pos.id}
                    draggable={false}
                    onPointerDown={(e) => {
                        if (e.button !== 0 || editingField || !onUpdatePosition || e.shiftKey) return;
                        if (e.target.closest('[data-no-layout-drag], input, textarea, select')) return;
                        const startClientX = e.clientX;
                        const startClientY = e.clientY;
                        const startOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
                        const startLineLength = Number.isFinite(lineLength) ? lineLength : 22;

                        const cleanup = () => {
                            if (holdTimerRef.current) {
                                clearTimeout(holdTimerRef.current);
                                holdTimerRef.current = null;
                            }
                            holdDragStateRef.current = null;
                            setLayoutDragging(false);
                            window.removeEventListener('pointermove', onPointerMove);
                            window.removeEventListener('pointerup', onPointerUp);
                            window.removeEventListener('pointercancel', onPointerUp);
                        };

                        const onPointerMove = (moveEvent) => {
                            if (!holdDragStateRef.current?.active) return;
                            const dx = moveEvent.clientX - holdDragStateRef.current.startClientX;
                            const dy = moveEvent.clientY - holdDragStateRef.current.startClientY;
                            const nextOffsetX = Math.max(-260, Math.min(260, holdDragStateRef.current.startOffsetX + dx));
                            const nextLineLength = Math.max(8, Math.min(240, holdDragStateRef.current.startLineLength + dy));
                            updateLayout({
                                offsetX: Math.round(nextOffsetX),
                                lineLength: Math.round(nextLineLength),
                            });
                        };

                        const onPointerUp = () => cleanup();

                        holdDragStateRef.current = {
                            active: false,
                            startClientX,
                            startClientY,
                            startOffsetX,
                            startLineLength,
                        };

                        // Press-and-hold to start moving card layout.
                        holdTimerRef.current = setTimeout(() => {
                            if (!holdDragStateRef.current) return;
                            holdDragStateRef.current.active = true;
                            setLayoutDragging(true);
                        }, 90);

                        window.addEventListener('pointermove', onPointerMove);
                        window.addEventListener('pointerup', onPointerUp, { once: true });
                        window.addEventListener('pointercancel', onPointerUp, { once: true });
                    }}
                    onDragStart={(e) => {
                        if (!onReorder) return;
                        if (!e.shiftKey) {
                            e.preventDefault();
                            return;
                        }
                        if (e.target.closest('[data-no-drag]')) {
                            e.preventDefault();
                            return;
                        }
                        e.dataTransfer.setData('positionId', pos.id);
                        e.dataTransfer.setData('parentId', parentPositionId || '');
                        e.dataTransfer.effectAllowed = 'move';
                        e.currentTarget.setAttribute('data-dragging', 'true');
                        e.currentTarget.style.opacity = '0.72';
                        e.currentTarget.style.transform = 'scale(0.98)';
                    }}
                    onDragEnd={(e) => {
                        e.currentTarget.removeAttribute('data-dragging');
                        e.currentTarget.style.opacity = '1';
                        e.currentTarget.style.transform = '';
                        e.currentTarget.style.boxShadow = ORG_NODE_SHADOW;
                        e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.45)';
                    }}
                    onDragOver={(e) => {
                        if (!onReorder) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.85)';
                        e.currentTarget.style.boxShadow = ORG_NODE_SHADOW_DRAG;
                    }}
                    onDragLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.45)';
                        e.currentTarget.style.boxShadow = ORG_NODE_SHADOW;
                    }}
                    onDrop={(e) => {
                        if (!onReorder) return;
                        e.preventDefault();
                        e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.45)';
                        e.currentTarget.style.boxShadow = ORG_NODE_SHADOW;
                        const draggedId = e.dataTransfer.getData('positionId');
                        const draggedParentId = e.dataTransfer.getData('parentId') || null;
                        if (!draggedId || draggedId === pos.id) return;
                        if ((draggedParentId ?? '') !== (parentPositionId ?? '')) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const insertBefore = e.clientX < rect.left + rect.width / 2;
                        onReorder(draggedId, pos.id, insertBefore, parentPositionId);
                    }}
                    className="org-chart-employee-node"
                    style={{
                        padding: 0,
                        borderRadius: '14px',
                        minWidth: '198px',
                        maxWidth: '260px',
                        boxShadow: ORG_NODE_SHADOW,
                        position: 'relative',
                        cursor: editingField ? 'text' : layoutDragging ? 'grabbing' : 'grab',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                    onMouseEnter={(e) => {
                        if (!onReorder) return;
                        if (e.currentTarget.getAttribute('data-dragging') === 'true') return;
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow =
                            '0 16px 36px -10px rgba(6, 182, 212, 0.25), 0 8px 20px -6px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                        if (!onReorder) return;
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = ORG_NODE_SHADOW;
                    }}
                    title={
                        onReorder ? t('employeesLayoutDragHintReorder') : t('employeesLayoutDragHint')
                    }
                >
                    <div
                        style={{
                            padding: `${orgNodePadTop}px ${orgNodePadInline}px 0`,
                            paddingInlineEnd: orgNodePadInlineEnd,
                        }}
                    >
                    {editingField === 'name' ? (
                        <input
                            ref={editInputRef}
                            data-no-pan
                            data-no-drag
                            aria-label={t('employeesEditNameAria')}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitFieldEdit}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitFieldEdit();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelFieldEdit();
                                }
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="org-chart-edit-input org-chart-pdf-ar"
                            lang="ar"
                            dir="auto"
                            style={{
                                ...ORG_EDIT_INPUT_STYLE,
                                fontSize: '15px',
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                lineHeight: 1.35,
                                width: '100%',
                                textAlign: 'center',
                            }}
                        />
                    ) : (
                        <div
                            className="org-chart-pos-name org-chart-pdf-ar"
                            lang="ar"
                            dir="auto"
                            data-no-drag
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (!onUpdatePosition) return;
                                setDraft(pos.name);
                                setEditingField('name');
                            }}
                            style={{
                                fontSize: '15px',
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                lineHeight: 1.4,
                                paddingInline: '6px',
                                textAlign: 'center',
                                wordBreak: 'break-word',
                                cursor: onUpdatePosition ? 'text' : 'default',
                            }}
                            title={onUpdatePosition ? t('employeesDoubleClickEditName') : undefined}
                        >
                            {pos.name}
                        </div>
                    )}
                    </div>
                    {/* سطر المسمى: زرّا الشريك في أقصى طرفي الكونتنر، الشارة في الوسط */}
                    <div
                        data-no-drag
                        style={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                            paddingInline: '4px',
                            marginTop: '10px',
                            minHeight: 34,
                            flexShrink: 0,
                        }}
                    >
                        <div
                            style={{
                                width: orgNodeSideSlot,
                                minWidth: orgNodeSideSlot,
                                flexShrink: 0,
                                display: 'flex',
                                justifyContent: 'flex-start',
                                alignItems: 'center',
                            }}
                        >
                            {showNodeChrome && isFirstSibling && (
                                <PlusBtn
                                    variant="rose"
                                    title={t('employeesAddPeerBefore')}
                                    onClick={() =>
                                        setAddCandidateTarget(
                                            isAddingSiblingBefore
                                                ? null
                                                : { deptId, underPositionId: parentPositionId, insertBefore: pos.id }
                                        )
                                    }
                                    isActive={isAddingSiblingBefore}
                                    size={28}
                                />
                            )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', paddingInline: '4px' }}>
                            {editingField === 'position' ? (
                                <input
                                    ref={editInputRef}
                                    className="org-chart-pdf-ar-ltr"
                                    lang="en"
                                    data-no-pan
                                    data-no-drag
                                    aria-label={t('employeesEditPositionAria')}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onBlur={commitFieldEdit}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitFieldEdit();
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            cancelFieldEdit();
                                        }
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    style={{
                                        ...ORG_EDIT_INPUT_STYLE,
                                        display: 'block',
                                        width: '100%',
                                        maxWidth: '100%',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        letterSpacing: '0.02em',
                                        color: '#a5f3fc',
                                        borderRadius: '999px',
                                    }}
                                />
                            ) : (
                                <div
                                    className="org-chart-pos-role org-chart-pdf-ar-ltr"
                                    lang="en"
                                    data-no-drag
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (!onUpdatePosition) return;
                                        setDraft(pos.position);
                                        setEditingField('position');
                                    }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '5px 12px',
                                        borderRadius: '999px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        letterSpacing: '0.02em',
                                        maxWidth: '100%',
                                        wordBreak: 'break-word',
                                        cursor: onUpdatePosition ? 'text' : 'default',
                                    }}
                                    title={onUpdatePosition ? t('employeesDoubleClickEditPosition') : undefined}
                                >
                                    {pos.position}
                                </div>
                            )}
                        </div>
                        <div
                            style={{
                                width: orgNodeSideSlot,
                                minWidth: orgNodeSideSlot,
                                flexShrink: 0,
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                            }}
                        >
                            {showNodeChrome && isLastSibling && (
                                <PlusBtn
                                    variant="rose"
                                    title={t('employeesAddPeerAfter')}
                                    onClick={() =>
                                        setAddCandidateTarget(
                                            isAddingSiblingAfter
                                                ? null
                                                : { deptId, underPositionId: parentPositionId, insertAfter: pos.id }
                                        )
                                    }
                                    isActive={isAddingSiblingAfter}
                                    size={28}
                                />
                            )}
                        </div>
                    </div>
                    {showNodeChrome && (
                    <div
                        data-org-pdf-hide
                        data-no-drag
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: '100%',
                            padding: `10px ${orgNodePadInline}px 14px`,
                            paddingInlineEnd: orgNodePadInlineEnd,
                            boxSizing: 'border-box',
                        }}
                    >
                        <PlusBtn
                            variant="rose"
                            onClick={() => setAddCandidateTarget(isAddingChild ? null : { deptId, underPositionId: pos.id })}
                            isActive={isAddingChild}
                            size={32}
                        />
                    </div>
                    )}
                    {/* Delete inside container - for replacement */}
                    {onDeleteEmployee && showNodeChrome && (
                        <div
                            data-org-pdf-hide
                            data-no-drag
                            data-no-layout-drag
                            className="org-chart-action-btn org-chart-action-btn--delete org-chart-action-btn--delete-sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(t('employeesConfirmReplaceCandidate'))) onDeleteEmployee(pos.id);
                            }}
                            style={{
                                position: 'absolute',
                                top: '3px',
                                insetInlineEnd: '3px',
                                zIndex: 3,
                            }}
                            title={t('employeesDeleteReplaceCandidateTitle')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                <line x1="10" y1="11" x2="10" y2="17"/>
                                <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                        </div>
                    )}
            </div>
            {/* Subordinates - connected tree structure */}
            {subs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '10px', flexShrink: 0 }}>
                    {/* Vertical connector from parent to horizontal line */}
                    <div className="org-chart-connector-line" style={{
                        width: '2px',
                        height: '16px',
                        flexShrink: 0,
                        ...lineStyle,
                    }} />
                    {/* Horizontal line connecting all children */}
                    <div className="org-chart-connector-line" style={{
                        alignSelf: 'stretch',
                        height: '2px',
                        minHeight: '2px',
                        flexShrink: 0,
                        ...lineStyle,
                    }} />
                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: getLevelGap(depth + 1), justifyContent: 'center', alignItems: 'flex-start', flexShrink: 0 }}>
                        {subs.map((sub, idx) => (
                            <div
                                key={sub.id}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    flexShrink: 0,
                                    marginLeft: Number.isFinite(sub?.layout?.offsetX) ? sub.layout.offsetX : 0,
                                }}
                            >
                                <div className="org-chart-connector-line" style={{
                                    width: '2px',
                                    height: Number.isFinite(sub?.layout?.lineLength) ? sub.layout.lineLength : 22,
                                    marginBottom: '-1px',
                                    ...lineStyle,
                                }} />
                                <PositionNode
                                    pos={sub}
                                    deptId={deptId}
                                    parentPositionId={pos.id}
                                    addCandidateTarget={addCandidateTarget}
                                    setAddCandidateTarget={setAddCandidateTarget}
                                    onDeleteEmployee={onDeleteEmployee}
                                    onReorder={onReorder}
                                    onUpdatePosition={onUpdatePosition}
                                    isFirstSibling={idx === 0}
                                    isLastSibling={idx === subs.length - 1}
                                    depth={depth + 1}
                                    suppressExportChrome={suppressExportChrome}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const Employees = () => {
    const { t } = useLanguage();
    const { theme } = useTheme();
    const orgChartConnectorStyle = useMemo(() => getOrgChartConnectorStyle(theme), [theme]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [orgStructure, setOrgStructure] = useState(loadOrgChart);
    const [showAddDept, setShowAddDept] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [newDeptName, setNewDeptName] = useState('');
    const [addCandidateTarget, setAddCandidateTarget] = useState(null); // { deptId, underPositionId: null | string }
    const [selectedDeptId, setSelectedDeptId] = useState(null); // which department tab is active
    const [chartPan, setChartPan] = useState({ x: 0, y: 0 });
    const [chartZoom, setChartZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const [lastAddedPositionId, setLastAddedPositionId] = useState(null);
    const chartContainerRef = useRef(null);
    const chartContentRef = useRef(null);
    const [chartExporting, setChartExporting] = useState(false);
    const [chartCandidatePoolTick, setChartCandidatePoolTick] = useState(0);
    const [deptNameEditing, setDeptNameEditing] = useState(false);
    const [deptNameDraft, setDeptNameDraft] = useState('');
    const deptNameInputRef = useRef(null);
    /** true once the org chart has been hydrated from the backend (gates persistence). */
    const chartHydratedRef = useRef(false);

    // Hydrate the org chart from the backend (source of truth). One-time migration:
    // if the org has no server chart yet but a local one exists, push it up.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiClient.get('/api/org-chart');
                const serverDepts = Array.isArray(res?.departments) ? res.departments : [];
                if (cancelled) return;
                if (serverDepts.length) {
                    const next = { departments: serverDepts };
                    setOrgStructure(next);
                    saveOrgChart(next);
                } else {
                    const local = loadOrgChart();
                    if (local.departments?.length) {
                        await apiClient.put('/api/org-chart', { departments: local.departments });
                    }
                }
            } catch (_) {
                /* offline / unauthenticated — keep the localStorage cache */
            } finally {
                if (!cancelled) chartHydratedRef.current = true;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Persist chart changes to the backend (debounced), after hydration.
    useEffect(() => {
        if (!chartHydratedRef.current) return undefined;
        const id = setTimeout(() => {
            apiClient
                .put('/api/org-chart', { departments: orgStructure.departments || [] })
                .catch(() => {});
        }, 800);
        return () => clearTimeout(id);
    }, [orgStructure]);

    /** عرض الصورة في قائمة «اختر مرشحاً» (بكسل CSS) — أبعاد width/height على <img> وفق DPR لتحسين الوضوح على الشاشات عالية الكثافة */
    const EMPLOYEE_SIDEBAR_AVATAR_CSS_PX = 52;
    const [employeeSidebarAvatarIntrinsic, setEmployeeSidebarAvatarIntrinsic] = useState(104);
    useEffect(() => {
        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
        setEmployeeSidebarAvatarIntrinsic(Math.round(EMPLOYEE_SIDEBAR_AVATAR_CSS_PX * dpr));
    }, []);

    const handleChartMouseDown = useCallback((e) => {
        if (e.target.closest('button, [role="button"]') || e.target.closest('[data-no-pan]')) return;
        setIsPanning(true);
        panStartRef.current = { x: e.clientX - chartPan.x, y: e.clientY - chartPan.y };
    }, [chartPan]);

    const handleChartMouseMove = useCallback((e) => {
        if (!isPanning) return;
        setChartPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    }, [isPanning]);

    const handleChartMouseUp = useCallback(() => setIsPanning(false), []);
    useEffect(() => {
        if (isPanning) {
            window.addEventListener('mousemove', handleChartMouseMove);
            window.addEventListener('mouseup', handleChartMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleChartMouseMove);
            window.removeEventListener('mouseup', handleChartMouseUp);
        };
    }, [isPanning, handleChartMouseMove, handleChartMouseUp]);

    useEffect(() => {
        const bump = () => setChartCandidatePoolTick((t) => t + 1);
        window.addEventListener(CHART_CANDIDATE_POOL_UPDATED, bump);
        window.addEventListener('focus', bump);
        const onStorage = (e) => {
            if (e.key === CHART_CANDIDATE_POOL_KEY) bump();
        };
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(CHART_CANDIDATE_POOL_UPDATED, bump);
            window.removeEventListener('focus', bump);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const displayList = useMemo(() => {
        return mergeDisplayWithPool(employees, loadPool());
    }, [employees, chartCandidatePoolTick]);
    const addCandidateForDeptId = addCandidateTarget?.deptId ?? null;
    const departments = orgStructure.departments || [];
    const selectedDept = departments.find((d) => d.id === selectedDeptId) || departments[0];

    useEffect(() => {
        const depts = orgStructure.departments || [];
        if (depts.length > 0 && (!selectedDeptId || !depts.some((d) => d.id === selectedDeptId))) {
            setSelectedDeptId(depts[0].id);
        }
    }, [orgStructure.departments?.length, selectedDeptId]);

    useEffect(() => {
        setChartPan({ x: 0, y: 0 });
        setChartZoom(1);
    }, [selectedDeptId]);

    useEffect(() => {
        setDeptNameEditing(false);
    }, [selectedDeptId]);

    useEffect(() => {
        if (deptNameEditing && deptNameInputRef.current) {
            deptNameInputRef.current.focus();
            deptNameInputRef.current.select();
        }
    }, [deptNameEditing]);

    useEffect(() => {
        ensureOrgChartPdfFont();
    }, []);

    const handleChartWheel = useCallback((e) => {
        if (e.target.closest('[data-no-pan]')) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setChartZoom((z) => Math.min(2.5, Math.max(0.4, z + delta)));
    }, []);

    useEffect(() => {
        const el = chartContainerRef.current;
        if (!el) return;
        el.addEventListener('wheel', handleChartWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleChartWheel);
    }, [handleChartWheel, selectedDeptId]);

    const waitForChartPaint = () =>
        new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)));
        });

    /** Export needs committed React paint after hiding toolbar chrome */
    const waitForOrgChartExportPaint = () =>
        new Promise((resolve) => {
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    setTimeout(resolve, 240);
                })
            );
        });

    const exportOrgChartPdf = useCallback(async () => {
        const el = chartContentRef.current;
        if (!el || chartExporting) return;
        const prevPan = { ...chartPan };
        const prevZoom = chartZoom;
        flushSync(() => {
            setChartExporting(true);
            setChartPan({ x: 0, y: 0 });
            setChartZoom(1);
        });
        await waitForOrgChartExportPaint();
        ensureOrgChartPdfFont();
        try {
            if (document.fonts?.ready) await document.fonts.ready;
        } catch (_) {
            /* ignore */
        }

        const viewportSaved = saveAndResetOrgChartViewport(chartContainerRef.current);
        const exportStyleSaved = normalizeOrgChartExportRoot(el);
        await waitForChartPaint();
        const exportTheme = theme;
        const exportBackground = getOrgChartExportBackground(exportTheme);

        try {
            const safeName = (selectedDept?.name || 'org-chart').replace(/[/\\?%*:|"<>]/g, '-');
            let usedServerPdf = false;
            try {
                const htmlDoc = buildOrgChartServerPdfHtml(el, exportTheme);
                const res = await fetch(`${API_BASE}/api/org-chart/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
                    body: JSON.stringify({ html: htmlDoc, filename: `${safeName}-org-chart` }),
                });
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('application/pdf')) {
                    const blob = await res.blob();
                    if (blob.size >= MIN_ORG_CHART_PDF_BYTES) {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${safeName}-org-chart.pdf`;
                        a.rel = 'noopener';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        usedServerPdf = true;
                    } else {
                        console.warn('Server PDF too small (likely blank), using client fallback', blob.size);
                    }
                }
            } catch (srvErr) {
                console.warn('Server Puppeteer PDF unavailable, using client fallback', srvErr);
            }

            if (usedServerPdf) return;

            const { width: captureW, height: captureH } = getOrgChartFullCaptureSize(el);

            let imgData;
            let imgW;
            let imgH;
            /** Prefer html2canvas + onclone once chrome is stripped from DOM (better Arabic shaping). */
            try {
                const canvas = await html2canvas(el, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: exportBackground,
                    logging: false,
                    width: captureW,
                    height: captureH,
                    foreignObjectRendering: false,
                    onclone: applyOrgChartPdfClone,
                });
                if (isCanvasMostlyBlank(canvas, getOrgChartExportBackgroundRgb(exportTheme))) {
                    throw new Error('html2canvas produced blank capture');
                }
                imgData = canvas.toDataURL('image/png');
                imgW = canvas.width;
                imgH = canvas.height;
            } catch (h2cErr) {
                console.warn('html2canvas failed, falling back to html-to-image', h2cErr);
                const { toPng } = await import('html-to-image');
                imgData = await toPng(el, {
                    pixelRatio: 2,
                    backgroundColor: exportBackground,
                    cacheBust: true,
                    width: captureW,
                    height: captureH,
                    style: { transform: 'none', transition: 'none' },
                    filter: (node) => !(node instanceof Element && node.hasAttribute?.('data-org-pdf-hide')),
                });
                const dims = await new Promise((resolveDimensions, rejectDimensions) => {
                    const i = new Image();
                    i.onload = () => resolveDimensions({ w: i.naturalWidth, h: i.naturalHeight });
                    i.onerror = rejectDimensions;
                    i.src = imgData;
                });
                imgW = dims.w;
                imgH = dims.h;
            }

            if (!imgW || !imgH) {
                throw new Error('PDF export capture has zero dimensions');
            }

            const pdf = new jsPDF({
                orientation: imgW > imgH ? 'landscape' : 'portrait',
                unit: 'pt',
                format: 'a4',
            });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 24;
            const maxW = pageW - margin * 2;
            const maxH = pageH - margin * 2;
            const ratio = Math.min(maxW / imgW, maxH / imgH);
            const w = imgW * ratio;
            const h = imgH * ratio;
            pdf.addImage(imgData, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
            pdf.save(`${safeName}-org-chart.pdf`);
        } catch (e) {
            console.error('PDF export failed', e);
        } finally {
            restoreOrgChartExportRoot(el, exportStyleSaved);
            restoreOrgChartViewport(chartContainerRef.current, viewportSaved);
            setChartPan(prevPan);
            setChartZoom(prevZoom);
            setChartExporting(false);
        }
    }, [chartPan, chartZoom, chartExporting, selectedDept?.name, theme]);

    const printOrgChart = useCallback(async () => {
        const el = chartContentRef.current;
        if (!el || chartExporting) return;
        const prevPan = { ...chartPan };
        const prevZoom = chartZoom;
        flushSync(() => {
            setChartExporting(true);
            setChartPan({ x: 0, y: 0 });
            setChartZoom(1);
        });
        await waitForOrgChartExportPaint();
        const viewportSaved = saveAndResetOrgChartViewport(chartContainerRef.current);
        const exportStyleSaved = normalizeOrgChartExportRoot(el);
        await waitForChartPaint();
        applyOrgChartPrintScale(el);
        const onAfterPrint = () => {
            clearOrgChartPrintScale(el);
            restoreOrgChartExportRoot(el, exportStyleSaved);
            restoreOrgChartViewport(chartContainerRef.current, viewportSaved);
            setChartPan(prevPan);
            setChartZoom(prevZoom);
            setChartExporting(false);
            window.removeEventListener('afterprint', onAfterPrint);
        };
        window.addEventListener('afterprint', onAfterPrint);
        window.print();
    }, [chartPan, chartZoom, chartExporting]);

    useEffect(() => {
        if (!lastAddedPositionId || !chartContainerRef.current) return;
        const id = lastAddedPositionId;
        const scrollToNew = () => {
            const el = chartContainerRef.current?.querySelector(`[data-position-id="${id}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
            setLastAddedPositionId(null);
        };
        const t = setTimeout(scrollToNew, 100);
        return () => clearTimeout(t);
    }, [lastAddedPositionId]);

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE}/api/candidates`);
                const result = await response.json();
                if (result.success && result.data) {
                    const MIN_SCORE = 70;
                    const completed = result.data.filter((c) => {
                        const w = c.writtenInterviewEvaluation;
                        const v = c.voiceInterviewEvaluation;
                        const vid = c.videoInterviewEvaluation;
                        if (!w || !v || !vid) return false;
                        const scoreOk = (s) => (s?.overall_score ?? 0) >= MIN_SCORE;
                        const hireOk = (s) => s?.recommendation === 'Hire';
                        return scoreOk(w) && scoreOk(v) && scoreOk(vid) && hireOk(vid);
                    });
                    setEmployees(
                        completed.map((c) => ({
                            id: c._id || c.id,
                            name: ((c.full_name || c.fullName) || '').trim() || c.email?.split('@')[0] || 'Unknown',
                            position: c.position_applied_for || c.positionAppliedFor || 'N/A',
                            email: c.email,
                            photo: candidatePhotoUrl(c),
                        }))
                    );
                } else {
                    setEmployees([]);
                }
            } catch (err) {
                console.error('Error fetching employees:', err);
                setEmployees([]);
            } finally {
                setLoading(false);
            }
        };
        fetchEmployees();
    }, []);

    const persistOrg = useCallback((next) => {
        setOrgStructure((prev) => {
            const updated = typeof next === 'function' ? next(prev) : next;
            saveOrgChart(updated);
            return updated;
        });
    }, []);

    const addDepartment = () => {
        if (!newDeptName.trim()) return;
        const id = `dept-${Date.now()}`;
        persistOrg((prev) => ({
            ...prev,
            departments: [...prev.departments, { id, name: newDeptName.trim(), positions: [] }],
        }));
        setNewDeptName('');
        setShowAddDept(false);
        setSelectedDeptId(id); // switch to new department tab
    };

    /** Apply an imported department tree (from OrgChartImportModal) to the chart. */
    const applyImportedDepartments = useCallback((importedDepts, mode) => {
        if (!Array.isArray(importedDepts) || importedDepts.length === 0) return;
        persistOrg((prev) => {
            if (mode === 'replace') {
                return { ...prev, departments: importedDepts };
            }
            // merge: keep existing; append positions for same-named departments.
            const map = new Map();
            const order = [];
            for (const d of prev.departments || []) {
                const k = (d.name || '').trim().toLowerCase();
                map.set(k, { ...d, positions: [...(d.positions || [])] });
                order.push(k);
            }
            for (const imp of importedDepts) {
                const k = (imp.name || '').trim().toLowerCase();
                if (map.has(k)) {
                    const e = map.get(k);
                    e.positions = [...e.positions, ...(imp.positions || [])];
                } else {
                    map.set(k, { ...imp, positions: [...(imp.positions || [])] });
                    order.push(k);
                }
            }
            return { ...prev, departments: order.map((k) => map.get(k)) };
        });
        const firstId = importedDepts[0]?.id;
        if (firstId) setSelectedDeptId(firstId);
    }, [persistOrg]);

    const deleteDepartment = (deptId) => {
        if (!confirm(t('employeesConfirmDeleteDept'))) return;
        persistOrg((prev) => ({
            ...prev,
            departments: prev.departments.filter((d) => d.id !== deptId),
        }));
        const remaining = orgStructure.departments.filter((d) => d.id !== deptId);
        setSelectedDeptId(remaining.length > 0 ? remaining[0].id : null);
    };

    const addToTree = (positions, underId, newNode, insertBeforeId, insertAfterId) => {
        const insertIntoArray = (arr) => {
            const list = [...(arr || [])];
            if (insertBeforeId) {
                const idx = list.findIndex((p) => p.id === insertBeforeId);
                if (idx >= 0) {
                    list.splice(idx, 0, newNode);
                    return list;
                }
            }
            if (insertAfterId) {
                const idx = list.findIndex((p) => p.id === insertAfterId);
                if (idx >= 0) {
                    list.splice(idx + 1, 0, newNode);
                    return list;
                }
            }
            return [...list, newNode];
        };
        if (!underId) return insertIntoArray(positions);
        return (positions || []).map((p) => {
            if (p.id === underId) {
                return { ...p, subordinates: insertIntoArray(p.subordinates) };
            }
            if (p.subordinates?.length) {
                return { ...p, subordinates: addToTree(p.subordinates, underId, newNode, insertBeforeId, insertAfterId) };
            }
            return p;
        });
    };

    const removeFromTree = (positions, positionId) => {
        return (positions || []).filter((p) => p.id !== positionId).map((p) => {
            if (p.subordinates?.length) {
                return { ...p, subordinates: removeFromTree(p.subordinates, positionId) };
            }
            return p;
        });
    };

    const findInTree = (positions, positionId) => {
        for (const p of positions || []) {
            if (p.id === positionId) return p;
            if (p.subordinates?.length) {
                const found = findInTree(p.subordinates, positionId);
                if (found) return found;
            }
        }
        return null;
    };

    const reorderPosition = (deptId, draggedId, dropTargetId, parentPositionId, insertBefore = true) => {
        if (draggedId === dropTargetId) return;
        persistOrg((prev) => {
            const reorderArray = (arr) => {
                const list = [...(arr || [])];
                const draggedIdx = list.findIndex((p) => p.id === draggedId);
                const targetIdx = list.findIndex((p) => p.id === dropTargetId);
                if (draggedIdx < 0 || targetIdx < 0) return list;
                const [item] = list.splice(draggedIdx, 1);
                const newTargetIdx = list.findIndex((p) => p.id === dropTargetId);
                list.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, item);
                return list;
            };
            const reorderInPositions = (positions, parentId) => {
                if (parentId === null || parentId === undefined || parentId === '') {
                    return reorderArray(positions);
                }
                return (positions || []).map((p) => {
                    if (p.id === parentId) {
                        return { ...p, subordinates: reorderArray(p.subordinates || []) };
                    }
                    if (p.subordinates?.length) {
                        return { ...p, subordinates: reorderInPositions(p.subordinates, parentId) };
                    }
                    return p;
                });
            };
            return {
                ...prev,
                departments: prev.departments.map((d) => {
                    if (d.id !== deptId) return d;
                    const migrated = (d.positions || []).map((p) =>
                        p.subordinates !== undefined ? p : { ...p, id: p.id || `pos-${p.empId ?? p.name ?? Date.now()}`, subordinates: [] }
                    );
                    return { ...d, positions: reorderInPositions(migrated, parentPositionId) };
                }),
            };
        });
    };

    const removeEmployeeFromDept = (deptId, positionId) => {
        persistOrg((prev) => ({
            ...prev,
            departments: prev.departments.map((d) => {
                if (d.id !== deptId) return d;
                const migrated = (d.positions || []).map((p) =>
                    p.subordinates !== undefined ? p : { ...p, id: p.id || `pos-${p.empId ?? p.name ?? Date.now()}`, subordinates: [] }
                );
                return { ...d, positions: removeFromTree(migrated, positionId) };
            }),
        }));
    };

    const assignEmployeeToDept = (deptId, emp, underPositionId = null, insertBeforeId = null, insertAfterId = null) => {
        const newId = `pos-${Date.now()}-${emp.id}`;
        const newNode = { id: newId, empId: emp.id, name: emp.name, position: emp.position, subordinates: [] };
        setLastAddedPositionId(newId);
        persistOrg((prev) => ({
            ...prev,
            departments: prev.departments.map((d) => {
                if (d.id !== deptId) return d;
                const migrated = (d.positions || []).map((p) =>
                    p.subordinates !== undefined ? p : { ...p, id: p.id || `pos-${p.empId ?? p.name ?? Date.now()}`, subordinates: [] }
                );
                return { ...d, positions: addToTree(migrated, underPositionId, newNode, insertBeforeId, insertAfterId) };
            }),
        }));
        removeIdsFromPoolAndSave([emp.id]);
        setAddCandidateTarget(null);
    };

    const updatePositionInTree = (positions, positionId, updates) =>
        (positions || []).map((p) => {
            if (p.id === positionId) {
                return { ...p, ...updates };
            }
            if (p.subordinates?.length) {
                return { ...p, subordinates: updatePositionInTree(p.subordinates, positionId, updates) };
            }
            return p;
        });

    const updateEmployeePositionFields = (deptId, positionId, updates) => {
        persistOrg((prev) => ({
            ...prev,
            departments: prev.departments.map((d) => {
                if (d.id !== deptId) return d;
                const migrated = (d.positions || []).map((p) =>
                    p.subordinates !== undefined ? p : { ...p, id: p.id || `pos-${p.empId ?? p.name ?? Date.now()}`, subordinates: [] }
                );
                return { ...d, positions: updatePositionInTree(migrated, positionId, updates) };
            }),
        }));
    };

    const renameDepartment = (deptId, newName) => {
        const trimmed = (newName || '').trim();
        if (!trimmed) return;
        persistOrg((prev) => ({
            ...prev,
            departments: prev.departments.map((d) => (d.id === deptId ? { ...d, name: trimmed } : d)),
        }));
    };

    return (
        <>
            <div className="dashboard-page dashboard-page--evaalo-visual employees-page dashboard-page--full-viewport-shell">
                <div className="design-background design-background--evaalo-visual">
                    <div className="design-orb-1"></div>
                    <div className="design-orb-2"></div>
                    <div className="design-orb-3"></div>
                </div>
                <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
                <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

                <div className="container dashboard-visual-container">
                    <div className="dashboard-grid">
                        <div className="dashboard-card dashboard-card--page-active platform-features-card employees-shell-card">
                            <div className="dashboard-card-header employees-page-card-header">
                                <div className="employees-page-header-inner">
                                    <h2 className="dashboard-card-title">{t('employeesPageTitle')}</h2>
                                    <div className="employees-page-dept-toolbar">
                        {departments.map((dept) => (
                            <button
                                key={dept.id}
                                type="button"
                                onClick={() => setSelectedDeptId(dept.id)}
                                className={`evaalo-glass-dept-tab${selectedDeptId === dept.id ? ' evaalo-glass-dept-tab--active' : ''}`}
                            >
                                {dept.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setShowAddDept(true)}
                            className="evaalo-glass-dept-add"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                <line x1="12" y1="11" x2="12" y2="17"/>
                                <line x1="9" y1="14" x2="15" y2="14"/>
                            </svg>
                                            <span>{t('employeesNewDept')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowImport(true)}
                            className="evaalo-glass-dept-add"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span>{t('orgImport_button')}</span>
                        </button>
                        <OrgChartImportModal
                            open={showImport}
                            onClose={() => setShowImport(false)}
                            onApply={applyImportedDepartments}
                            t={t}
                        />
                    </div>
                                </div>
                            </div>
                            <div className="dashboard-card-body employees-page-card-body">
                    {/* Main: Employees picker panel + Org chart — محاذاة مع بطاقة الصفحة */}
                    <div className="employees-page-main-row">
                    <style>{`
                        .employees-panel-header {
                            position: relative;
                            overflow: hidden;
                            backdrop-filter: blur(14px);
                            -webkit-backdrop-filter: blur(14px);
                            box-shadow:
                                inset 0 1px 0 rgba(255, 255, 255, 0.06),
                                0 4px 24px rgba(0, 0, 0, 0.2);
                        }
                        .employees-panel-header::after {
                            content: '';
                            position: absolute;
                            inset: 0;
                            background: radial-gradient(120% 80% at 0% 0%, rgba(34, 197, 94, 0.12) 0%, transparent 55%);
                            pointer-events: none;
                        }
                        .employees-panel-header-inner {
                            position: relative;
                            z-index: 1;
                            display: flex;
                            align-items: center;
                            gap: 14px;
                            width: 100%;
                        }
                        .employees-panel-icon-wrap {
                            width: 48px;
                            height: 48px;
                            border-radius: 14px;
                            background: linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: #fff;
                            box-shadow: 0 4px 18px rgba(6, 182, 212, 0.38);
                            flex-shrink: 0;
                        }
                        .employees-panel-count {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            min-width: 26px;
                            height: 24px;
                            padding: 0 9px;
                            margin-top: 4px;
                            border-radius: 999px;
                            font-size: 12px;
                            font-weight: 600;
                            color: #bbf7d0;
                            background: rgba(34, 197, 94, 0.2);
                            border: 1px solid rgba(34, 197, 94, 0.35);
                        }
                        .employees-panel-close {
                            margin-inline-start: auto;
                            width: 38px;
                            height: 38px;
                            border-radius: 12px;
                            border: 1px solid rgba(255, 255, 255, 0.12);
                            background: rgba(255, 255, 255, 0.06);
                            color: rgba(248, 250, 252, 0.9);
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease;
                            flex-shrink: 0;
                        }
                        .employees-panel-close:hover {
                            background: rgba(248, 113, 113, 0.15);
                            border-color: rgba(248, 113, 113, 0.45);
                            color: #fecaca;
                        }
                        .employees-panel-close:focus-visible {
                            outline: 2px solid rgba(6, 182, 212, 0.75);
                            outline-offset: 2px;
                        }
                        .employees-list-scroll {
                            background: linear-gradient(180deg, rgba(7, 12, 22, 0.55) 0%, rgba(10, 16, 28, 0.92) 100%);
                            scrollbar-width: thin;
                            scrollbar-color: rgba(6, 182, 212, 0.45) rgba(15, 23, 42, 0.4);
                        }
                        .employees-list-scroll::-webkit-scrollbar {
                            width: 7px;
                        }
                        .employees-list-scroll::-webkit-scrollbar-track {
                            background: rgba(15, 23, 42, 0.35);
                            border-radius: 4px;
                            margin: 6px 0;
                        }
                        .employees-list-scroll::-webkit-scrollbar-thumb {
                            background: linear-gradient(180deg, rgba(6, 182, 212, 0.55), rgba(34, 197, 94, 0.35));
                            border-radius: 4px;
                        }
                        .employees-sidebar-row {
                            display: flex;
                            align-items: center;
                            gap: 14px;
                            padding: 14px 16px;
                            border-radius: 16px;
                            cursor: pointer;
                            transition:
                                background 0.22s ease,
                                border-color 0.22s ease,
                                box-shadow 0.22s ease,
                                transform 0.2s ease;
                            background: rgba(15, 23, 42, 0.75);
                            border: 1px solid rgba(34, 197, 94, 0.2);
                            box-shadow:
                                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                                0 2px 12px rgba(0, 0, 0, 0.15);
                        }
                        .employees-sidebar-row:hover {
                            background: rgba(34, 197, 94, 0.12);
                            border-color: rgba(34, 197, 94, 0.48);
                            box-shadow:
                                0 6px 22px rgba(34, 197, 94, 0.14),
                                inset 0 1px 0 rgba(255, 255, 255, 0.07);
                            transform: translateY(-1px);
                        }
                        .employees-sidebar-row:active {
                            transform: translateY(0);
                        }
                        .employees-sidebar-meta {
                            flex: 1;
                            min-width: 0;
                        }
                        .employees-sidebar-name {
                            font-weight: 600;
                            color: #f1f5f9;
                            font-size: 15px;
                            line-height: 1.35;
                            letter-spacing: 0.01em;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        .employees-sidebar-role {
                            font-size: 13px;
                            color: #94a3b8;
                            margin-top: 3px;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                    `}</style>
                    {/* Employees panel - only visible when adding a candidate */}
                    {addCandidateForDeptId && (
                    <div className="employees-picker-panel employees-panel-sidebar">
                    <div
                            className="employees-panel-header"
                        style={{
                                padding: '18px 18px 18px 20px',
                                borderBottom: '1px solid rgba(6, 182, 212, 0.2)',
                            flexShrink: 0,
                                borderInlineStart: '3px solid rgba(34, 197, 94, 0.85)',
                            }}
                        >
                            <div className="employees-panel-header-inner">
                                <div className="employees-panel-icon-wrap">
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                        <circle cx="9" cy="7" r="4"/>
                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                    </svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                                            {t('employeesPanelTitle')}
                                        </h3>
                                        {displayList.length > 0 && (
                                            <span className="employees-panel-count" aria-label={String(displayList.length)}>
                                                {displayList.length}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="employees-panel-close"
                                    onClick={() => setAddCandidateTarget(null)}
                                    title={t('employeesCloseAria')}
                                    aria-label={t('employeesCloseAria')}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div
                            className="employees-list-scroll"
                            style={{
                                flex: '1 1 0%',
                                overflowY: 'auto',
                                overflowX: 'hidden',
                                padding: '14px 14px 18px',
                                minHeight: 0,
                            }}
                        >
                            {loading && displayList.length === 0 ? (
                                <div style={{
                                    color: '#94a3b8',
                                    textAlign: 'center',
                                    padding: '40px 20px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '12px',
                                }}>
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        border: '3px solid rgba(6, 182, 212, 0.3)',
                                        borderTopColor: '#06B6D4',
                                        borderRadius: '50%',
                                        animation: 'spin 0.8s linear infinite',
                                    }} />
                                    <span>{t('employeesLoading')}</span>
                                </div>
                            ) : displayList.length === 0 ? (
                                <div
                                    style={{
                                    color: '#64748b',
                                        textAlign: 'center',
                                        padding: '40px 20px',
                                        fontSize: '14px',
                                    }}
                                />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                                    {displayList.map((emp) => (
                                        <div
                                            key={emp.id}
                                            className="employees-sidebar-row"
                                            onClick={
                                                addCandidateTarget
                                                    ? () =>
                                                          assignEmployeeToDept(
                                                              addCandidateTarget.deptId,
                                                              emp,
                                                              addCandidateTarget.underPositionId,
                                                              addCandidateTarget.insertBefore,
                                                              addCandidateTarget.insertAfter
                                                          )
                                                    : undefined
                                            }
                                        >
                                            <div
                                                className="employees-sidebar-avatar-ring"
                                                style={{
                                                    width: `${EMPLOYEE_SIDEBAR_AVATAR_CSS_PX}px`,
                                                    height: `${EMPLOYEE_SIDEBAR_AVATAR_CSS_PX}px`,
                                                borderRadius: '50%',
                                                overflow: 'hidden',
                                                flexShrink: 0,
                                                background: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#fff',
                                                fontWeight: 700,
                                                fontSize: '18px',
                                                border: '2px solid rgba(6, 182, 212, 0.4)',
                                                    transform: 'translateZ(0)',
                                                    isolation: 'isolate',
                                                }}
                                            >
                                                {emp.photo ? (
                                                    <img
                                                        src={emp.photo}
                                                        alt=""
                                                        width={employeeSidebarAvatarIntrinsic}
                                                        height={employeeSidebarAvatarIntrinsic}
                                                        draggable={false}
                                                        decoding="async"
                                                        sizes={`${EMPLOYEE_SIDEBAR_AVATAR_CSS_PX}px`}
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'cover',
                                                            objectPosition: 'center center',
                                                            transform: 'translateZ(0)',
                                                            backfaceVisibility: 'hidden',
                                                            WebkitBackfaceVisibility: 'hidden',
                                                        }}
                                                    />
                                                ) : (
                                                    (emp.name || '?').charAt(0).toUpperCase()
                                                )}
                                            </div>
                                            <div className="employees-sidebar-meta">
                                                <div className="employees-sidebar-name">{emp.name}</div>
                                                <div className="employees-sidebar-role">{emp.position}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    )}

                    {/* Org Chart Card */}
                    <div className="employees-org-chart-wrap">
                        <div
                            className="dashboard-card dashboard-card--page-active employees-org-chart-card"
                            style={{
                                transition: 'all 0.3s ease',
                                border: 'none',
                                borderRadius: '16px',
                                padding: '0',
                                minHeight: '500px',
                                overflow: 'hidden',
                                position: 'relative',
                                background: 'transparent',
                                boxShadow: 'none',
                            }}
                        >
                            {showAddDept ? (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    minHeight: '500px',
                                    width: '100%',
                                    padding: '40px',
                                }}>
                                <div className="employees-add-dept-panel" style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '20px',
                                    padding: '60px 40px',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(6, 182, 212, 0.3)',
                                    maxWidth: '360px',
                                    width: '100%',
                                    animation: 'slideDown 0.3s ease-out',
                                }}>
                                    <style>{`@keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                                    <h3 className="employees-add-dept-panel__title" style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{t('employeesAddNewDepartmentTitle')}</h3>
                                    <input data-no-pan
                                        type="text"
                                        className="employees-add-dept-input"
                                        value={newDeptName}
                                        onChange={(e) => setNewDeptName(e.target.value)}
                                        placeholder={t('employeesDeptNamePlaceholder')}
                                        onKeyDown={(e) => e.key === 'Enter' && addDepartment()}
                                        style={{
                                            padding: '14px 20px',
                                            width: '100%',
                                            borderRadius: '12px',
                                            fontSize: '15px',
                                        }}
                                    />
                                    <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                                        <button
                                            onClick={addDepartment}
                                            style={{
                                                flex: 1,
                                                padding: '12px 24px',
                                                background: 'linear-gradient(135deg, #10B981, #059669)',
                                                border: 'none',
                                                borderRadius: '12px',
                                                color: '#fff',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {t('employeesSave')}
                                        </button>
                                        <button
                                            onClick={() => { setShowAddDept(false); setNewDeptName(''); }}
                                            style={{
                                                flex: 1,
                                                padding: '12px 24px',
                                                background: 'rgba(100, 116, 139, 0.5)',
                                                border: '1px solid rgba(100, 116, 139, 0.5)',
                                                borderRadius: '12px',
                                                color: '#94a3b8',
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {t('employeesCancel')}
                                        </button>
                                    </div>
                                </div>
                                </div>
                            ) : departments.length === 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', padding: '60px 40px' }} data-no-pan>
                                    <p style={{ fontSize: '18px', color: '#94A3B8' }}>{t('employeesNoDepartmentsYet')}</p>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddDept(true)}
                                        className="workflow-btn-primary ni-continue-btn"
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '10px',
                                            padding: '14px 28px',
                                            fontSize: '1.05rem',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <span style={{ fontSize: '1.25rem' }} aria-hidden="true">
                                            ▶
                                        </span>
                                        <span>{t('employeesAddNewDepartmentTitle')}</span>
                                    </button>
                                </div>
                            ) : selectedDept ? (
                                <>
                                <style>{buildOrgChartPrintMediaCss(theme)}</style>
                                <div
                                    data-no-pan
                                    className="header-actions org-chart-toolbar"
                                    style={{
                                        position: 'absolute',
                                        top: '12px',
                                        insetInlineEnd: '12px',
                                        zIndex: 20,
                                        flexWrap: 'wrap',
                                        justifyContent: 'flex-end',
                                    }}
                                >
                                    <button
                                        type="button"
                                        data-no-pan
                                        className="evaalo-glass-icon-btn"
                                        disabled={chartExporting}
                                        onClick={() => exportOrgChartPdf()}
                                        title={chartExporting ? t('employeesExportingPdf') : t('employeesExportPdf')}
                                        aria-label={chartExporting ? t('employeesExportingPdf') : t('employeesExportPdf')}
                                    >
                                        {chartExporting ? (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="org-chart-export-spinner">
                                                <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                                                <path d="M21 12a9 9 0 0 0-9-9" strokeOpacity="1" />
                                            </svg>
                                        ) : (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                                <line x1="12" y1="18" x2="12" y2="12"/>
                                                <line x1="9" y1="15" x2="15" y2="15"/>
                                            </svg>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        data-no-pan
                                        className="evaalo-glass-icon-btn"
                                        onClick={() => printOrgChart()}
                                        title={t('employeesPrintChart')}
                                        aria-label={t('employeesPrintChart')}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <polyline points="6 9 6 2 18 2 18 9"/>
                                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                                            <rect x="6" y="14" width="12" height="8"/>
                                        </svg>
                                    </button>
                                </div>
                                <div
                                    ref={chartContainerRef}
                                    className="org-chart-viewport"
                                    style={{
                                        minHeight: '500px',
                                        overflow: 'auto',
                                        cursor: isPanning ? 'grabbing' : 'grab',
                                        position: 'relative',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'flex-start',
                                        padding: '20px 24px',
                                        boxSizing: 'border-box',
                                    }}
                                    onMouseDown={handleChartMouseDown}
                                >
                                    <div
                                        ref={chartContentRef}
                                        id="evaalo-org-chart-export"
                                        style={{
                                            display: 'inline-flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '24px',
                                            padding: '40px',
                                            transform: `translate(${chartPan.x}px, ${chartPan.y}px) scale(${chartZoom})`,
                                            transformOrigin: 'center top',
                                            transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                                            minWidth: 'min-content',
                                        }}
                                    >
                                    <div
                                        data-no-pan
                                        className="org-chart-org-badge org-chart-pdf-ar-rtl"
                                    >
                                        {t('employeesOrgChartBadge')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        {/* Department container: icon + name + actions */}
                                        <div data-no-pan className="org-chart-dept-bar" style={{
                                            display: 'flex',
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: chartExporting ? 0 : '14px',
                                            justifyContent: chartExporting ? 'center' : 'flex-start',
                                            padding: '14px 18px',
                                            borderRadius: '16px',
                                            minWidth: '300px',
                                        }}>
                                            {!chartExporting && (
                                            <div
                                                aria-hidden
                                                data-org-pdf-hide
                                                className="org-chart-dept-icon"
                                                style={{
                                                    width: '44px',
                                                    height: '44px',
                                                    borderRadius: '12px',
                                                    flexShrink: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                                    <polyline points="9 22 9 12 15 12 15 22" />
                                                </svg>
                                            </div>
                                            )}
                                            {deptNameEditing ? (
                                                <input
                                                    ref={deptNameInputRef}
                                                    data-no-pan
                                                    className="org-chart-edit-input org-chart-pdf-ar"
                                                    lang="ar"
                                                    dir="auto"
                                                    aria-label={t('employeesEditDeptNameAria')}
                                                    value={deptNameDraft}
                                                    onChange={(e) => setDeptNameDraft(e.target.value)}
                                                    onBlur={() => {
                                                        const t = deptNameDraft.trim();
                                                        if (t) renameDepartment(selectedDept.id, t);
                                                        setDeptNameEditing(false);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            const t = deptNameDraft.trim();
                                                            if (t) renameDepartment(selectedDept.id, t);
                                                            setDeptNameEditing(false);
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            setDeptNameEditing(false);
                                                        }
                                                    }}
                                                    onMouseDown={(ev) => ev.stopPropagation()}
                                                    style={{
                                                        ...ORG_EDIT_INPUT_STYLE,
                                                        flex: 1,
                                                        minWidth: 0,
                                                        fontSize: '17px',
                                                        fontWeight: 700,
                                                        letterSpacing: '-0.02em',
                                                        lineHeight: 1.3,
                                                    }}
                                                />
                                            ) : (
                                                <span
                                                    data-no-pan
                                                    className="org-chart-dept-name org-chart-pdf-ar"
                                                    lang="ar"
                                                    dir="auto"
                                                    onDoubleClick={(ev) => {
                                                        ev.stopPropagation();
                                                        setDeptNameDraft(selectedDept.name);
                                                        setDeptNameEditing(true);
                                                    }}
                                                    style={{
                                                        fontSize: '17px',
                                                        fontWeight: 700,
                                                        flex: 1,
                                                        textAlign: 'center',
                                                        letterSpacing: '-0.02em',
                                                        lineHeight: 1.3,
                                                        cursor: 'text',
                                                    }}
                                                    title={t('employeesDoubleClickEditDeptName')}
                                                >
                                                    {selectedDept.name}
                                                </span>
                                            )}
                                            {!chartExporting && (
                                            <div data-org-pdf-hide style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                                            {/* Plus - add employee */}
                                            <div
                                                className="org-chart-action-btn org-chart-action-btn--add"
                                                data-active={
                                                    addCandidateTarget?.deptId === selectedDept.id &&
                                                    addCandidateTarget?.underPositionId === null
                                                        ? 'true'
                                                        : undefined
                                                }
                                                onClick={() => setAddCandidateTarget(addCandidateTarget?.deptId === selectedDept.id && addCandidateTarget?.underPositionId === null ? null : { deptId: selectedDept.id, underPositionId: null })}
                                                style={{ width: '38px', height: '38px' }}
                                                title={t('employeesAddEmployeeToDept')}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                                </svg>
                                            </div>
                                            {/* Delete department */}
                                            <div
                                                className="org-chart-action-btn org-chart-action-btn--delete"
                                                onClick={() => deleteDepartment(selectedDept.id)}
                                                style={{ width: '38px', height: '38px' }}
                                                title={t('employeesDeleteDeptTitle')}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="3 6 5 6 21 6"/>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                    <line x1="10" y1="11" x2="10" y2="17"/>
                                                    <line x1="14" y1="11" x2="14" y2="17"/>
                                                </svg>
                                            </div>
                                            </div>
                                            )}
                                        </div>
                                        {/* Vertical line - department to employees */}
                                        <div className="org-chart-connector-line" style={{
                                            width: '2px',
                                            height: '24px',
                                            margin: '4px 0 0 0',
                                            ...orgChartConnectorStyle,
                                        }} />
                                        {/* Horizontal connector for root level - connects directly to vertical drops */}
                                        {(selectedDept.positions || []).length > 0 && (
                                            <div className="org-chart-connector-line" style={{
                                                alignSelf: 'stretch',
                                                height: '2px',
                                                marginBottom: 0,
                                                ...orgChartConnectorStyle,
                                            }} />
                                        )}
                                        {/* Root level: رؤساء القسم - with vertical connectors from horizontal line (pyramid spacing) */}
                                        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: getLevelGap(0), justifyContent: 'center', alignItems: 'flex-start' }}>
                                            {(selectedDept.positions || []).map((pos, idx, arr) => (
                                                <div
                                                    key={pos.id || pos.name}
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        marginLeft: Number.isFinite(pos?.layout?.offsetX) ? pos.layout.offsetX : 0,
                                                    }}
                                                >
                                                    <div className="org-chart-connector-line" style={{
                                                        width: '2px',
                                                        height: Number.isFinite(pos?.layout?.lineLength) ? pos.layout.lineLength : 22,
                                                        marginBottom: '-1px',
                                                        ...orgChartConnectorStyle,
                                                    }} />
                                                    <PositionNode
                                                        pos={{ ...pos, subordinates: pos.subordinates || [] }}
                                                        deptId={selectedDept.id}
                                                        parentPositionId={null}
                                                        addCandidateTarget={addCandidateTarget}
                                                        setAddCandidateTarget={setAddCandidateTarget}
                                                        onDeleteEmployee={(positionId) => removeEmployeeFromDept(selectedDept.id, positionId)}
                                                        onReorder={(draggedId, dropTargetId, insertBefore, parentId) => reorderPosition(selectedDept.id, draggedId, dropTargetId, parentId, insertBefore)}
                                                        onUpdatePosition={(positionId, updates) => updateEmployeePositionFields(selectedDept.id, positionId, updates)}
                                                        isFirstSibling={idx === 0}
                                                        isLastSibling={idx === arr.length - 1}
                                                        depth={0}
                                                        suppressExportChrome={chartExporting}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    </div>
                                </div>
                                </>
                            ) : null}
                        </div>
                        </div>
                    </div>
                        </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Employees;
