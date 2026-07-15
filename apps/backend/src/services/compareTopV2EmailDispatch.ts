/**
 * Optional email dispatch after Campaign Compare v2 completes.
 * Uses legacy stage webhooks with mode=email_dispatch_only so n8n can branch to email-only.
 */

import type { ICampaignCompareRequest } from '../models/CampaignCompareRequest.js';
import type { CompareUiStage } from '../models/CampaignCompareRequest.js';
import type { IAiCompareTopResult } from '../models/RecruitmentCampaign.js';
import { mapV2RecordToUiResult } from './compareTopV2Adapter.js';

const EMAIL_DISPATCH_TIMEOUT_MS = 15_000;

const LEGACY_EMAIL_WEBHOOK_ENV: Record<CompareUiStage, string> = {
    screening: 'N8N_SCREENING_AI_COMPARE_WEBHOOK_URL',
    voice: 'N8N_VOICE_AI_COMPARE_WEBHOOK_URL',
    video: 'N8N_VIDEO_AI_COMPARE_WEBHOOK_URL',
};

function legacyWebhookUrl(uiStage: CompareUiStage): string {
    const envKey = LEGACY_EMAIL_WEBHOOK_ENV[uiStage];
    const fromEnv = (process.env[envKey] || '').trim();
    if (fromEnv) return fromEnv;
    const defaults: Record<CompareUiStage, string> = {
        screening: 'https://n8n.evaalo.com/webhook/9391209e-26c0-48f9-858e-8136e62ab787',
        voice: 'https://n8n.evaalo.com/webhook/a7b9b932-43e6-4666-b107-9bc664542392',
        video: 'https://n8n.evaalo.com/webhook/c0de9126-4c40-484f-afa3-ba8708b67965',
    };
    return defaults[uiStage];
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
    uiResult: IAiCompareTopResult
): Record<string, unknown> {
    return {
        mode: 'email_dispatch_only',
        source: 'campaign-compare-v2-email',
        stage: record.uiStage,
        compareStage: record.compareStage,
        campaignId: record.campaignId,
        organizationId: record.organizationId,
        requestId: record.requestId,
        emails: record.emails ?? [],
        // Executive Summary (Phase 1) — يبدأ الإيميل بهذه ثم البطاقات.
        decisionSummary: uiResult.decisionSummary,
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

    const payload = {
        ...composeEmailPayload(record, uiResult),
        submittedAt: new Date().toISOString(),
    };

    const url = legacyWebhookUrl(record.uiStage);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMAIL_DISPATCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.warn(
                `[campaign-compare-v2] email dispatch non-OK stage=${record.uiStage} status=${res.status} body=${text.slice(0, 200)}`
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
