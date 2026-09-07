/**
 * Optional email dispatch after Campaign Compare v2 completes.
 * Uses legacy stage webhooks with mode=email_dispatch_only so n8n can branch to email-only.
 */

import type { ICampaignCompareRequest } from '../models/CampaignCompareRequest.js';
import type { CompareUiStage } from '../models/CampaignCompareRequest.js';
import type { IAiCompareTopResult } from '../models/RecruitmentCampaign.js';
import { mapV2RecordToUiResult } from './compareTopV2Adapter.js';
import {
    getCampaignCompareStageWebhookUrl,
    type CampaignCompareStage,
} from './campaignCompareCallbackAuth.js';
import { renderCompareReportPdf } from './compareReportPdf.js';
import { loadCandidatePhotoDataUris } from './compareReportPhotos.js';

const EMAIL_DISPATCH_TIMEOUT_MS = 15_000;

const LEGACY_EMAIL_WEBHOOK_ENV: Record<CompareUiStage, string> = {
    screening: 'N8N_SCREENING_AI_COMPARE_WEBHOOK_URL',
    voice: 'N8N_VOICE_AI_COMPARE_WEBHOOK_URL',
    video: 'N8N_VIDEO_AI_COMPARE_WEBHOOK_URL',
};

const UI_TO_COMPARE_STAGE: Record<CompareUiStage, CampaignCompareStage> = {
    screening: 'stage1',
    voice: 'stage2',
    video: 'stage3',
};

function legacyWebhookUrl(uiStage: CompareUiStage): string {
    const envKey = LEGACY_EMAIL_WEBHOOK_ENV[uiStage];
    const fromEnv = (process.env[envKey] || '').trim();
    if (fromEnv) return fromEnv;
    const defaults: Record<CompareUiStage, string> = {
        screening: 'https://n8n.evaalo.com/webhook/9391209e-26c0-48f9-858e-8136e62ab787',
        voice: 'https://n8n.evaalo.com/webhook/cceec6bc-9ffc-42ee-bd57-845c7ee04eb0',
        video: 'https://n8n.evaalo.com/webhook/b1a5a3ea-b9be-4d81-b613-48212d0b0be7',
    };
    return defaults[uiStage];
}

function compareEmailWebhookUrl(uiStage: CompareUiStage): string {
    if ((process.env.CAMPAIGN_COMPARE_V2_ENABLED || '').trim().toLowerCase() === 'true') {
        const v2 = getCampaignCompareStageWebhookUrl(UI_TO_COMPARE_STAGE[uiStage]);
        if (v2) return v2;
    }
    return legacyWebhookUrl(uiStage);
}

/**
 * ملخص تنفيذي مُشتق لقالب الإيميل: يبدأ الإيميل بهذه القيم ثم بطاقات المرشحين.
 * (تكوين قالب الـ HTML يتم في n8n؛ نحن نمرّر البيانات جاهزة.)
 */
export function buildExecutiveStats(uiResult: IAiCompareTopResult): {
    candidateCount: number;
    topCandidate?: string;
    topRisk?: string;
} {
    const ranking = uiResult.ranking ?? [];
    const top = ranking.find((r) => (r.rank ?? 0) === 1) ?? ranking[0];
    const topRisk = Array.isArray(top?.risks) ? top?.risks.find((r) => String(r).trim()) : undefined;
    return {
        candidateCount: ranking.length,
        topCandidate: top?.candidateName || undefined,
        topRisk: topRisk || undefined,
    };
}

/** حمولة الإيميل المشتركة (تُستخدم في المسار الحيّ واختبار الوحدة معاً). */
function composeEmailPayload(
    record: ICampaignCompareRequest,
    uiResult: IAiCompareTopResult,
    pdf?: { pdfBase64: string; pdfFilename: string }
): Record<string, unknown> {
    return {
        mode: 'email_dispatch_only',
        // Card-based PDF report attached by n8n's Gmail node (falls back to text-only when absent).
        ...(pdf ? { pdfBase64: pdf.pdfBase64, pdfFilename: pdf.pdfFilename } : {}),
        source: 'campaign-compare-v2-email',
        stage: record.uiStage,
        compareStage: record.compareStage,
        campaignId: record.campaignId,
        organizationId: record.organizationId,
        requestId: record.requestId,
        emails: record.emails ?? [],
        // Executive Summary (Phase 1 / 1.5) — يبدأ الإيميل بهذه ثم البطاقات.
        decisionSummary: uiResult.decisionSummary,
        contextualIntroduction: uiResult.contextualIntroduction,
        comparativeInsights: uiResult.comparativeInsights,
        whyTopCandidateWins: uiResult.whyTopCandidateWins,
        finalRecommendation: uiResult.finalRecommendation,
        interviewFocus: record.result?.interviewFocus,
        executiveStats: buildExecutiveStats(uiResult),
        summary: uiResult.summary,
        ranking: uiResult.ranking,
    };
}

export async function dispatchCompareTopV2Emails(record: ICampaignCompareRequest): Promise<void> {
    const emails = record.emails ?? [];
    if (emails.length === 0 || record.emailDispatchedAt) return;

    const uiResult = mapV2RecordToUiResult(record);
    if (uiResult.status !== 'completed') return;

    // Render the report to a card-based PDF for the email attachment. Non-fatal:
    // any failure falls back to the plain-text email so dispatch is never blocked.
    let pdf: { pdfBase64: string; pdfFilename: string } | undefined;
    try {
        // Photos are read from disk and inlined: the PDF is rendered by headless
        // Chromium with no session, so an /uploads URL would come back blank.
        // Best-effort — a candidate with no readable photo gets their initials.
        const photos = await loadCandidatePhotoDataUris(
            (uiResult.ranking ?? []).map((row) => row.candidateId)
        );
        const buffer = await renderCompareReportPdf(uiResult, {
            stage: record.uiStage,
            photos,
        });
        const base64 = buffer.toString('base64');
        if (base64.length <= 6 * 1024 * 1024) {
            pdf = { pdfBase64: base64, pdfFilename: `تقرير-مقارنة-المرشحين-${record.uiStage}.pdf` };
        } else {
            console.warn(
                `[campaign-compare-v2] report PDF too large (${base64.length}b) — text-only request=${record.requestId}`
            );
        }
    } catch (err) {
        console.warn(
            `[campaign-compare-v2] report PDF generation failed — text-only request=${record.requestId}:`,
            err instanceof Error ? err.message : err
        );
    }

    const payload = {
        ...composeEmailPayload(record, uiResult, pdf),
        submittedAt: new Date().toISOString(),
    };

    const url = compareEmailWebhookUrl(record.uiStage);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMAIL_DISPATCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) {
            console.warn(
                `[campaign-compare-v2] email dispatch non-OK stage=${record.uiStage} status=${res.status} body=${text.slice(0, 200)}`
            );
            return;
        }

        let parsed: unknown;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = null;
        }
        const emailSent =
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            (parsed as Record<string, unknown>).emailSent === true;
        if (!emailSent) {
            console.warn(
                `[campaign-compare-v2] email dispatch no confirmation stage=${record.uiStage} request=${record.requestId} body=${text.slice(0, 200)}`
            );
            return;
        }

        record.emailDispatchedAt = new Date();
        await record.save();
    } catch (err) {
        console.warn(
            `[campaign-compare-v2] email dispatch failed request=${record.requestId}:`,
            err instanceof Error ? err.message : err
        );
    } finally {
        clearTimeout(timer);
    }
}

/** @internal test helper */
export function buildCompareTopV2EmailPayload(
    record: ICampaignCompareRequest,
    uiResult: IAiCompareTopResult
): Record<string, unknown> {
    return composeEmailPayload(record, uiResult);
}
