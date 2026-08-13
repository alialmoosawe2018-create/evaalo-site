/**
 * AI compare-report email billing (V2) — charge on request, refund on failure/timeout.
 *
 * Model: the upfront charge is taken when the request is made (so a zero-balance
 * org can't get the report for free). If n8n fails, or the request is still
 * unfinished past its deadline, the EXACT charged amount stored on the request is
 * refunded — never recomputed from the current email count / plan (which may drift).
 *
 * Idempotency:
 *   - charge: `compare-email:<requestId>`
 *   - refund: `compare-email-refund:<requestId>`
 * The refund is single-flight via an atomic status flip; `refunded` is terminal.
 */

import CampaignCompareRequest from '../models/CampaignCompareRequest.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { adjustCredits, consumeCredits } from './billingRuntimeService.js';
import { creditCostMicro } from './billingEngine.js';
import type { ConsumeCreditsResult } from '../types/billing.js';

export type CompareField =
    | 'aiCompareTopResult'
    | 'voiceAiCompareTopResult'
    | 'videoAiCompareTopResult';

const COMPARE_FIELDS: CompareField[] = [
    'aiCompareTopResult',
    'voiceAiCompareTopResult',
    'videoAiCompareTopResult',
];

/** How long a request may stay unfinished before the sweep refunds it. */
export const COMPARE_EMAIL_DEADLINE_MS = 15 * 60 * 1000;

/** Compare Top billing: 1 credit per report email + 2 credits (SCREENING) per pool candidate. */
export function computeCompareTopChargeMicro(emailCount: number, candidateCount: number): {
    emailMicro: number;
    candidateMicro: number;
    totalMicro: number;
} {
    const emailMicro = creditCostMicro('COMPARE_EMAIL', emailCount);
    const candidateMicro = creditCostMicro('SCREENING', candidateCount);
    return { emailMicro, candidateMicro, totalMicro: emailMicro + candidateMicro };
}

export async function chargeCompareTopCredits(input: {
    organizationId: string;
    campaignId: string;
    requestId: string;
    stage: string;
    emailCount: number;
    candidateCount: number;
    engine?: string;
}): Promise<ConsumeCreditsResult & { chargedMicroCredits?: number }> {
    const { organizationId, campaignId, requestId, stage, emailCount, candidateCount, engine } = input;
    const { emailMicro, candidateMicro, totalMicro } = computeCompareTopChargeMicro(
        emailCount,
        candidateCount,
    );

    const baseMeta = {
        stage,
        emailCount,
        candidateCount,
        ...(engine ? { engine } : {}),
    };

    const emailBilling = await consumeCredits({
        organizationId,
        usageType: 'COMPARE_EMAIL',
        units: emailCount,
        idempotencyKey: `compare-email:${requestId}`,
        source: 'ai_compare_email',
        sourceId: campaignId,
        metadata: { ...baseMeta, compareChargePart: 'email' },
    });
    if (!emailBilling.ok) return emailBilling;

    if (candidateCount > 0) {
        const candidateBilling = await consumeCredits({
            organizationId,
            usageType: 'SCREENING',
            units: candidateCount,
            idempotencyKey: `compare-candidates:${requestId}`,
            source: 'ai_compare_email',
            sourceId: campaignId,
            metadata: { ...baseMeta, compareChargePart: 'candidates' },
        });
        if (!candidateBilling.ok) {
            if (emailMicro > 0 && !emailBilling.duplicate) {
                await adjustCredits({
                    organizationId,
                    amountMicro: emailMicro,
                    idempotencyKey: `compare-email-rollback:${requestId}`,
                    metadata: {
                        kind: 'compare_top_rollback',
                        reason: 'candidate_charge_failed',
                        requestId,
                    },
                }).catch((e) =>
                    console.warn(
                        `[compare-top] email rollback failed request=${requestId}: ${e?.message || e}`,
                    ),
                );
            }
            return candidateBilling;
        }
    }

    return { ...emailBilling, chargedMicroCredits: totalMicro };
}

interface RefundInput {
    campaignId: string;
    organizationId: string;
    field: CompareField;
    requestId: string;
    reason: 'failed' | 'expired';
}

/**
 * Refund a compare-email charge exactly once.
 *
 * Atomic single-flight: flips status to `refunded` only if it is still in a
 * non-terminal, non-refunded state AND matches the requestId. The credit refund
 * itself is also idempotent (keyed by refundIdempotencyKey), so a racing
 * failure-callback + timeout-sweep can never double-refund.
 */
/**
 * Refund a Campaign Compare v2 request charge exactly once (adapter billing path).
 */
export async function refundCampaignCompareEmail(input: {
    requestId: string;
    reason: 'failed' | 'expired';
}): Promise<{ refunded: boolean }> {
    const now = new Date();
    const claimed = await CampaignCompareRequest.findOneAndUpdate(
        {
            requestId: input.requestId,
            status: { $in: ['pending', 'dispatched', 'processing', 'failed'] },
            refundedAt: { $exists: false },
        },
        {
            $set: {
                status: 'refunded',
                refundedAt: now,
            },
        },
        { new: true }
    ).exec();

    if (!claimed) return { refunded: false };

    const amountMicro = claimed.chargedMicroCredits ?? 0;
    const key = claimed.refundIdempotencyKey || `compare-email-refund:${input.requestId}`;

    if (amountMicro > 0) {
        await adjustCredits({
            organizationId: claimed.organizationId,
            amountMicro,
            idempotencyKey: key,
            metadata: { kind: 'compare_top_refund', reason: input.reason, requestId: input.requestId, engine: 'campaign-compare-v2' },
        });
    }

    console.warn(
        `[compare-email] v2 refunded org=${claimed.organizationId} campaign=${claimed.campaignId} request=${input.requestId} reason=${input.reason} amountMicro=${amountMicro}`,
    );
    return { refunded: true };
}

/**
 * استرداد شحنة Compare Top عندما فشل إنشاء سجل الطلب نفسه (شحنة يتيمة):
 * refundCampaignCompareEmail يطالب السجل أولاً فلا يعمل بدونه، بينما هنا نعوّض
 * عبر adjustCredits مباشرة. المفتاح `compare-top-refund:<requestId>` هو نفسه
 * refundIdempotencyKey الذي كان سيُخزّن على السجل — فيبقى الاسترداد idempotent
 * عالمياً حتى لو تسابق مع مسار استرداد آخر.
 */
export async function rollbackCompareTopChargeWithoutRecord(input: {
    organizationId: string;
    requestId: string;
    amountMicro: number;
    reason: string;
}): Promise<void> {
    if (input.amountMicro <= 0) return;
    await adjustCredits({
        organizationId: input.organizationId,
        amountMicro: input.amountMicro,
        idempotencyKey: `compare-top-refund:${input.requestId}`,
        metadata: {
            kind: 'compare_top_refund',
            reason: input.reason,
            requestId: input.requestId,
            engine: 'campaign-compare-v2',
        },
    });
    console.warn(
        `[compare-email] orphan charge rolled back org=${input.organizationId} request=${input.requestId} reason=${input.reason} amountMicro=${input.amountMicro}`,
    );
}

export async function refundCompareEmail(input: RefundInput): Promise<{ refunded: boolean }> {
    const { campaignId, organizationId, field, requestId, reason } = input;
    const now = new Date();

    const claimed = await RecruitmentCampaign.findOneAndUpdate(
        {
            campaignId,
            organizationId,
            [`${field}.requestId`]: requestId,
            [`${field}.status`]: { $in: ['pending', 'processing', 'failed', 'expired'] },
            [`${field}.refundedAt`]: { $exists: false },
        },
        {
            $set: {
                [`${field}.status`]: 'refunded',
                [`${field}.refundedAt`]: now,
            },
        },
        { new: true },
    ).exec();

    if (!claimed) return { refunded: false };

    const result = claimed[field];
    const amountMicro = result?.chargedMicroCredits ?? 0;
    const key = result?.refundIdempotencyKey || `compare-email-refund:${requestId}`;

    if (amountMicro > 0) {
        await adjustCredits({
            organizationId,
            amountMicro,
            idempotencyKey: key,
            metadata: { kind: 'compare_top_refund', reason, requestId, field },
        });
    }

    console.warn(
        `[compare-email] refunded org=${organizationId} campaign=${campaignId} request=${requestId} reason=${reason} amountMicro=${amountMicro}`,
    );
    return { refunded: true };
}

/**
 * Periodic safety net: refund any compare request stuck past its deadline.
 * Runs independently of the user's browser (the GET poll is only a best-effort
 * extra), so a closed tab + n8n failure can never leave credits stranded.
 */
async function sweepStaleCampaignCompareV2(): Promise<void> {
    const now = new Date();
    // failed مشمولة كحزام أمان: لو فشل الاسترداد الفوري في مسار الـ callback،
    // يلتقطها الـ sweep هنا (refundCampaignCompareEmail idempotent ويطالب failed أصلاً).
    const stale = await CampaignCompareRequest.find({
        status: { $in: ['pending', 'dispatched', 'processing', 'failed'] },
        deadlineAt: { $lt: now },
    })
        .select('requestId')
        .lean()
        .exec();

    for (const row of stale) {
        if (!row.requestId) continue;
        try {
            await refundCampaignCompareEmail({ requestId: row.requestId, reason: 'expired' });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[compare-email] v2 sweep refund failed request=${row.requestId}: ${msg}`);
        }
    }
}

export async function sweepStaleCompareEmails(): Promise<void> {
    const now = new Date();

    await sweepStaleCampaignCompareV2();

    for (const field of COMPARE_FIELDS) {
        const stale = await RecruitmentCampaign.find({
            [`${field}.status`]: { $in: ['pending', 'processing'] },
            [`${field}.deadlineAt`]: { $lt: now },
        })
            // System billing sweep: intentionally cross-org (scans every org for
            // stale compare requests to refund). Bypass the tenant guard.
            .setOptions({ skipTenantGuard: true })
            .select(`campaignId organizationId ${field}`)
            .lean()
            .exec();

        for (const c of stale) {
            const r = (c as Record<string, any>)[field];
            if (!r?.requestId) continue;
            try {
                await refundCompareEmail({
                    campaignId: c.campaignId as string,
                    organizationId: (c.organizationId as string) || '',
                    field,
                    requestId: r.requestId,
                    reason: 'expired',
                });
            } catch (e: any) {
                console.warn(
                    `[compare-email] sweep refund failed campaign=${c.campaignId} request=${r.requestId}: ${e?.message || e}`,
                );
            }
        }
    }
}
