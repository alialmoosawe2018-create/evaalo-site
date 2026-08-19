/**
 * Renders a Campaign Compare v2 result into a styled, card-based Arabic (RTL) PDF
 * so it can be emailed as an attachment instead of plain text.
 *
 * Reuses the same Puppeteer/Chromium approach as routes/orgChartPdf.ts (chromium
 * + noto fonts ship in the production runtime image). All candidate-provided text
 * is HTML-escaped — the report renders untrusted data, never executes it.
 */
import type { IAiCompareTopResult } from '../models/RecruitmentCampaign.js';
import type { CompareUiStage } from '../models/CampaignCompareRequest.js';

export interface CompareReportPdfMeta {
    stage: CompareUiStage;
    generatedAt?: Date;
}

const STAGE_LABEL_AR: Record<CompareUiStage, string> = {
    screening: 'المرحلة الأولى — الفرز',
    voice: 'المرحلة الثانية — المقابلة الصوتية',
    video: 'المرحلة الثالثة — المقابلة المرئية',
};

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasText(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

/** Render a labelled section only when it has content. */
function section(title: string, bodyHtml: string): string {
    if (!bodyHtml.trim()) return '';
    return `<section class="block"><h2>${esc(title)}</h2>${bodyHtml}</section>`;
}

/** Render a bullet list from a string[]; returns '' when empty. */
function bulletList(items: unknown, className = ''): string {
    const arr = Array.isArray(items) ? items.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    if (!arr.length) return '';
    return `<ul class="${esc(className)}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

function recClass(rec?: string): string {
    const r = String(rec || '').toLowerCase();
    if (r === 'hire') return 'rec rec-hire';
    if (r === 'consider') return 'rec rec-consider';
    if (r === 'reject') return 'rec rec-reject';
    return 'rec';
}

type RankingItem = NonNullable<IAiCompareTopResult['ranking']>[number];

function candidateCard(item: RankingItem, index: number): string {
    const rank = Number.isFinite(item.rank as number) ? (item.rank as number) : index + 1;
    const name = hasText(item.candidateName) ? item.candidateName : `مرشّح ${rank}`;
    const scoreHtml =
        item.score !== undefined && item.score !== null && Number.isFinite(Number(item.score))
            ? `<span class="score">${esc(Math.round(Number(item.score)))}</span>`
            : '';
    const recHtml = hasText(item.recommendation)
        ? `<span class="${recClass(item.recommendation)}">${esc(item.recommendation)}</span>`
        : '';
    const confHtml =
        item.confidence !== undefined && item.confidence !== null && Number.isFinite(Number(item.confidence))
            ? `<span class="conf">الثقة: ${esc(Math.round(Number(item.confidence)))}%</span>`
            : '';
    const comment = hasText(item.executiveComment)
        ? item.executiveComment
        : hasText(item.reason)
          ? item.reason
          : '';
    const decision = hasText(item.decisionAction)
        ? `<p class="decision"><strong>الإجراء المقترح:</strong> ${esc(item.decisionAction)}</p>`
        : '';
    const reasons = bulletList(item.reasons, 'reasons');
    const strengths = bulletList(item.strengthsList, 'strengths');
    const risksArr = [
        ...(Array.isArray(item.risks) ? item.risks : []),
        ...(Array.isArray(item.keyGaps) ? item.keyGaps : []),
    ];
    const risks = bulletList(risksArr, 'risks');

    return `
    <article class="card">
      <div class="card-head">
        <span class="rank">#${esc(rank)}</span>
        <span class="cand-name">${esc(name)}</span>
        <span class="spacer"></span>
        ${scoreHtml}
        ${recHtml}
        ${confHtml}
      </div>
      ${comment ? `<p class="comment">${esc(comment)}</p>` : ''}
      ${decision}
      ${reasons ? `<div class="col"><h4>الأسباب</h4>${reasons}</div>` : ''}
      ${strengths ? `<div class="col"><h4>نقاط القوة</h4>${strengths}</div>` : ''}
      ${risks ? `<div class="col"><h4>المخاطر والفجوات</h4>${risks}</div>` : ''}
    </article>`;
}

function insightsTable(insights?: Record<string, string>): string {
    if (!insights || typeof insights !== 'object') return '';
    const rows = Object.entries(insights)
        .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()])
        .filter(([k, v]) => k && v);
    if (!rows.length) return '';
    return `<table class="insights"><tbody>${rows
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
        .join('')}</tbody></table>`;
}

export function buildCompareReportHtml(
    uiResult: IAiCompareTopResult,
    meta: CompareReportPdfMeta
): string {
    const stageLabel = STAGE_LABEL_AR[meta.stage] || '';
    const generated = (meta.generatedAt || new Date()).toLocaleDateString('ar', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const ranking = Array.isArray(uiResult.ranking) ? uiResult.ranking : [];

    const cards = ranking.map((item, i) => candidateCard(item, i)).join('\n');

    const body = `
    <header class="report-head">
      <div class="brand">evaalo</div>
      <h1>تقرير مقارنة المرشّحين</h1>
      <div class="meta">${esc(stageLabel)}${stageLabel ? ' · ' : ''}${esc(generated)}</div>
    </header>
    ${hasText(uiResult.decisionSummary) ? `<div class="exec">${esc(uiResult.decisionSummary)}</div>` : ''}
    ${section('السياق', hasText(uiResult.contextualIntroduction) ? `<p>${esc(uiResult.contextualIntroduction)}</p>` : '')}
    ${section('ملخص المقارنة', hasText(uiResult.summary) ? `<p>${esc(uiResult.summary)}</p>` : '')}
    ${section('ترتيب المرشّحين', cards || '<p class="muted">لا يوجد مرشّحون في هذه المقارنة.</p>')}
    ${section('تحليل مقارن', insightsTable(uiResult.comparativeInsights))}
    ${section('لماذا يتصدّر المرشّح الأول', hasText(uiResult.whyTopCandidateWins) ? `<p>${esc(uiResult.whyTopCandidateWins)}</p>` : '')}
    ${section('التوصية النهائية', hasText(uiResult.finalRecommendation) ? `<div class="final">${esc(uiResult.finalRecommendation)}</div>` : '')}
    <footer class="report-foot">— evaalo · تقرير آلي للدعم القراري، لا يُعدّ قراراً نهائياً للتوظيف.</footer>`;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Amiri', 'Segoe UI', Tahoma, sans-serif;
    color: #1e293b; direction: rtl; line-height: 1.6; font-size: 13px;
    background: #ffffff;
  }
  .report-head { border-bottom: 3px solid #2563eb; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { color: #2563eb; font-weight: 800; letter-spacing: .5px; font-size: 14px; }
  h1 { font-size: 22px; margin: 4px 0 2px; color: #0f172a; }
  .report-head .meta { color: #64748b; font-size: 12px; }
  .exec {
    background: #eff6ff; border: 1px solid #bfdbfe; border-right: 5px solid #2563eb;
    border-radius: 8px; padding: 12px 14px; margin: 0 0 14px; font-weight: 600; color: #1e3a8a;
  }
  .block { margin: 0 0 16px; }
  .block > h2 {
    font-size: 15px; color: #1d4ed8; margin: 0 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
  }
  .block p { margin: 0 0 6px; }
  .muted { color: #94a3b8; }
  .card {
    border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin: 0 0 10px;
    background: #f8fafc; break-inside: avoid; page-break-inside: avoid;
  }
  .card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .rank {
    background: #1d4ed8; color: #fff; font-weight: 800; border-radius: 6px;
    padding: 2px 8px; font-size: 13px;
  }
  .cand-name { font-weight: 800; font-size: 15px; color: #0f172a; }
  .spacer { flex: 1; }
  .score {
    background: #0f172a; color: #fff; border-radius: 6px; padding: 2px 8px; font-weight: 700;
  }
  .conf { color: #475569; font-size: 12px; }
  .rec { border-radius: 999px; padding: 2px 10px; font-weight: 700; font-size: 12px; border: 1px solid; }
  .rec-hire { background: #dcfce7; color: #166534; border-color: #86efac; }
  .rec-consider { background: #fef9c3; color: #854d0e; border-color: #fde047; }
  .rec-reject { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .comment { margin: 4px 0 6px; color: #334155; }
  .decision { margin: 4px 0; color: #0f172a; }
  .col { margin-top: 6px; }
  .col h4 { margin: 0 0 3px; font-size: 12px; color: #475569; }
  .col ul { margin: 0; padding-inline-start: 18px; }
  .col li { margin: 1px 0; }
  ul.risks li { color: #b91c1c; }
  ul.strengths li { color: #15803d; }
  table.insights { width: 100%; border-collapse: collapse; }
  table.insights th, table.insights td {
    border: 1px solid #e2e8f0; padding: 6px 8px; text-align: right; vertical-align: top;
  }
  table.insights th { background: #f1f5f9; width: 32%; color: #334155; font-weight: 700; }
  .final {
    background: #f0fdf4; border: 1px solid #bbf7d0; border-right: 5px solid #16a34a;
    border-radius: 8px; padding: 12px 14px; font-weight: 600; color: #14532d;
  }
  .report-foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * Render the compare report to a PDF Buffer via Puppeteer/Chromium.
 * Mirrors routes/orgChartPdf.ts launch args; uses standard multi-page A4 output.
 */
export async function renderCompareReportPdf(
    uiResult: IAiCompareTopResult,
    meta: CompareReportPdfMeta
): Promise<Buffer> {
    const html = buildCompareReportHtml(uiResult, meta);
    const puppeteerMod = await import('puppeteer');
    const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
    const browser = await puppeteerMod.default.launch({
        headless: true,
        ...(exe ? { executablePath: exe } : {}),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--font-render-hinting=medium',
        ],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: 'load',
            timeout: Math.min(Number(process.env.COMPARE_PDF_TIMEOUT_MS) || 45000, 120000),
        });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
        return Buffer.from(pdf);
    } finally {
        await browser.close().catch(() => undefined);
    }
}
