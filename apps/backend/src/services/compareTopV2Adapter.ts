/**
 * Adapter: Campaign Compare v2 (secure backend) ↔ legacy AI Compare Top UI contract.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import CampaignCompareRequest, {
    type CompareUiStage,
    type ICampaignCompareRequest,
} from '../models/CampaignCompareRequest.js';
import RecruitmentCampaign, {
    type IAiCompareTopResult,
    type IRecruitmentCampaign,
} from '../models/RecruitmentCampaign.js';
import { getClerkUserId, getOrgId } from '../middleware/auth.js';
import { orgScopedQuery } from '../middleware/orgScope.js';
import { logAudit } from './auditService.js';
import {
    buildCampaignComparePool,
    CampaignComparePoolError,
} from './campaignComparePool.js';
import {
    dispatchCampaignCompareToN8n,
    CampaignCompareDispatchError,
} from './campaignCompareN8nOutbound.js';
import {
    CampaignCompareConfigurationError,
    getCampaignCompareStageWebhookUrl,
    type CampaignCompareStage,
} from './campaignCompareCallbackAuth.js';
import {
    chargeCompareTopCredits,
    COMPARE_EMAIL_DEADLINE_MS,
    refundCampaignCompareEmail,
    rollbackCompareTopChargeWithoutRecord,
} from './compareEmailBilling.js';

type CompareField =
    | 'aiCompareTopResult'
    | 'voiceAiCompareTopResult'
    | 'videoAiCompareTopResult';

const UI_STAGE_TO_COMPARE: Record<CompareUiStage, CampaignCompareStage> = {
    screening: 'stage1',
    voice: 'stage2',
    video: 'stage3',
};

const UI_STAGE_TO_FIELD: Record<CompareUiStage, CompareField> = {
    screening: 'aiCompareTopResult',
    voice: 'voiceAiCompareTopResult',
    video: 'videoAiCompareTopResult',
};

export function isCampaignCompareV2Enabled(): boolean {
    return (process.env.CAMPAIGN_COMPARE_V2_ENABLED || '').trim().toLowerCase() === 'true';
}

export function isCompareTopV2EnabledForStage(uiStage: CompareUiStage): boolean {
    if (!isCampaignCompareV2Enabled()) return false;
    const compareStage = UI_STAGE_TO_COMPARE[uiStage];
    return Boolean(getCampaignCompareStageWebhookUrl(compareStage));
}

export function mapUiStageToCompareStage(uiStage: CompareUiStage): CampaignCompareStage {
    return UI_STAGE_TO_COMPARE[uiStage];
}

export function mapUiStageToCampaignField(uiStage: CompareUiStage): CompareField {
    return UI_STAGE_TO_FIELD[uiStage];
}

function coerceScore(raw: string | number | undefined): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        return Number(raw);
    }
    return undefined;
}

export function mapV2RecordToUiResult(record: ICampaignCompareRequest): IAiCompareTopResult {
    let uiStatus: IAiCompareTopResult['status'];
    if (record.status === 'completed') uiStatus = 'completed';
    else if (record.status === 'failed') uiStatus = 'failed';
    else if (record.status === 'refunded') uiStatus = 'refunded';
    else if (record.status === 'dispatched' || record.status === 'processing') uiStatus = 'processing';
    else uiStatus = 'pending';

    const ranking =
        record.result?.candidateRanking?.map((row) => ({
            rank: row.rank,
            candidateName: row.candidateName,
            score: coerceScore(row.stageScore),
            reason: row.competitiveAdvantage,
            // Decision-support enrichment (Phase 1).
            recommendation: row.recommendation, // enum ثابت — نبرة الشارة في الواجهة تُشتقّ منه.
            overallRecommendation: row.overallRecommendation,
            executiveComment: row.executiveComment,
            confidence: row.confidence,
            confidence_rationale: row.confidence_rationale,
            reasons: row.reasons,
            strengthsList: row.strengths,
            risks: row.risks,
            watchOut: row.watchOut,
            differenceFromNext: row.differenceFromNext,
        })) ?? undefined;

    return {
        requestId: record.requestId,
        status: uiStatus,
        emails: record.emails ?? [],
        requestedByClerkUserId: record.requestedBy,
        requestedAt: record.createdAt,
        completedAt: record.completedAt,
        error: record.failureMessage ?? record.failureCode,
        chargedMicroCredits: record.chargedMicroCredits,
        chargeIdempotencyKey: record.chargeIdempotencyKey,
        refundIdempotencyKey: record.refundIdempotencyKey,
        deadlineAt: record.deadlineAt,
        refundedAt: record.refundedAt,
        summary: record.result?.comparativeSummary,
        decisionSummary: record.result?.decisionSummary,
        // Phase 1.5: حقول تحليلية
        contextualIntroduction: record.result?.contextualIntroduction,
        comparativeInsights: record.result?.comparativeInsights,
        whyTopCandidateWins: record.result?.whyTopCandidateWins,
        finalRecommendation: record.result?.finalRecommendation,
        ranking,
    };
}

export async function mirrorCompareTopV2ToCampaign(record: ICampaignCompareRequest): Promise<void> {
    const field = mapUiStageToCampaignField(record.uiStage);
    const uiResult = mapV2RecordToUiResult(record);
    await RecruitmentCampaign.updateOne(
        { campaignId: record.campaignId, organizationId: record.organizationId },
        { $set: { [field]: uiResult } }
    );
}

async function loadLatestRequest(
    campaignId: string,
    compareStage: CampaignCompareStage,
    organizationId: string
): Promise<ICampaignCompareRequest | null> {
    return CampaignCompareRequest.findOne({
        campaignId,
        compareStage,
        organizationId,
    })
        .sort({ createdAt: -1 })
        .exec();
}

export async function triggerCompareTopV2(
    req: Request,
    res: Response,
    uiStage: CompareUiStage,
    campaignId: string,
    emails: string[]
): Promise<void> {
    const compareStage = mapUiStageToCompareStage(uiStage);
    const organizationId = getOrgId(req);
    const requestedBy = getClerkUserId(req);

    const campaign = await RecruitmentCampaign.findOne(orgScopedQuery(req, { campaignId }));
    if (!campaign) {
        res.status(404).json({ success: false, error: 'Campaign not found' });
        return;
    }

    let pool;
    try {
        pool = await buildCampaignComparePool({
            compareStage,
            campaignId,
            organizationId,
        });
    } catch (err) {
        if (err instanceof CampaignComparePoolError) {
            res.status(err.statusCode).json({
                success: false,
                error: err.code,
                message: err.message,
            });
            return;
        }
        throw err;
    }

    const requestId = crypto.randomUUID();
    const candidateCount = pool.candidatePool.length;
    const billing = await chargeCompareTopCredits({
        organizationId,
        campaignId,
        requestId,
        stage: uiStage,
        emailCount: emails.length,
        candidateCount,
        engine: 'campaign-compare-v2',
    });
    if (!billing.ok) {
        const httpStatus = billing.code === 'INSUFFICIENT_CREDITS' ? 402 : 409;
        res.status(httpStatus).json({
            success: false,
            error: billing.code,
            message: billing.message,
        });
        return;
    }

    const chargedMicroCredits = billing.chargedMicroCredits ?? 0;
    try {
        await CampaignCompareRequest.create({
            requestId,
            compareStage,
            uiStage,
            campaignId,
            organizationId,
            requestedBy,
            candidateIds: pool.candidateIds,
            candidateSnapshotHash: pool.candidateSnapshotHash,
            criteria: pool.criteria,
            topN: pool.topN,
            status: 'pending',
            emails,
            chargedMicroCredits,
            chargeIdempotencyKey: `compare-top:${requestId}`,
            refundIdempotencyKey: `compare-top-refund:${requestId}`,
            deadlineAt: new Date(Date.now() + COMPARE_EMAIL_DEADLINE_MS),
        });
    } catch (createErr) {
        // بلا سجل لا يمكن لأي sweep/poll استرداد الشحنة — نعوّضها مباشرة هنا.
        await rollbackCompareTopChargeWithoutRecord({
            organizationId,
            requestId,
            amountMicro: chargedMicroCredits,
            reason: 'request_create_failed',
        }).catch((e) => {
            console.warn(`[compare-top-v2] orphan rollback failed request=${requestId}: ${e?.message || e}`);
        });
        throw createErr;
    }

    try {
        await dispatchCampaignCompareToN8n({
            requestId,
            compareStage,
            campaignId,
            organizationId,
            pool,
        });
    } catch (err) {
        await refundCampaignCompareEmail({ requestId, reason: 'failed' }).catch((e) => {
            console.warn(`[compare-top-v2] refund failed: ${e?.message || e}`);
        });
        if (err instanceof CampaignCompareDispatchError) {
            res.status(502).json({
                success: false,
                error: err.code,
                requestId,
                message: err.message,
            });
            return;
        }
        if (err instanceof CampaignCompareConfigurationError) {
            res.status(503).json({
                success: false,
                error: 'COMPARE_NOT_CONFIGURED',
                requestId,
                message: err.message,
            });
            return;
        }
        throw err;
    }

    const record = await CampaignCompareRequest.findOne({ requestId });
    if (record) {
        await mirrorCompareTopV2ToCampaign(record).catch(() => undefined);
    }

    logAudit(req, {
        action: 'campaign.ai_compare_top.requested',
        targetType: 'campaign',
        targetId: campaignId,
        metadata: {
            stage: uiStage,
            requestId,
            emailCount: emails.length,
            candidateCount,
            engine: 'campaign-compare-v2',
        },
    });

    res.status(202).json({
        success: true,
        requestId,
        status: 'pending',
        message: 'Comparison requested; poll for results',
    });
}

export async function getCompareTopV2Result(
    req: Request,
    res: Response,
    uiStage: CompareUiStage,
    campaignId: string
): Promise<void> {
    const compareStage = mapUiStageToCompareStage(uiStage);
    const organizationId = getOrgId(req);

    const campaign = await RecruitmentCampaign.findOne(
        orgScopedQuery(req, { campaignId })
    ).select('campaignId aiCompareTopResult voiceAiCompareTopResult videoAiCompareTopResult');

    if (!campaign) {
        res.status(404).json({ success: false, error: 'Campaign not found' });
        return;
    }

    const record = await loadLatestRequest(campaignId, compareStage, organizationId);
    if (!record) {
        const field = mapUiStageToCampaignField(uiStage);
        res.json({
            success: true,
            campaignId,
            stage: uiStage,
            result: (campaign as IRecruitmentCampaign)[field] || null,
        });
        return;
    }

    if (
        record.deadlineAt &&
        record.deadlineAt < new Date() &&
        ['pending', 'dispatched', 'processing'].includes(record.status)
    ) {
        await refundCampaignCompareEmail({ requestId: record.requestId, reason: 'expired' }).catch(
            () => undefined
        );
        const refreshed = await CampaignCompareRequest.findOne({ requestId: record.requestId });
        if (refreshed) {
            res.json({
                success: true,
                campaignId,
                stage: uiStage,
                result: mapV2RecordToUiResult(refreshed),
            });
            return;
        }
    }

    res.json({
        success: true,
        campaignId,
        stage: uiStage,
        result: mapV2RecordToUiResult(record),
    });
}

/** @internal test helper */
export function mapV2RankingForUiTest(
    ranking: Array<{
        rank: number;
        candidateName: string;
        stageScore: string | number;
        competitiveAdvantage: string;
        recommendation?: 'Hire' | 'Consider' | 'Reject';
        overallRecommendation?: string;
        executiveComment?: string;
        confidence?: number;
        confidence_rationale?: string;
        reasons?: string[];
        strengths?: string[];
        risks?: string[];
        watchOut?: string;
        differenceFromNext?: string;
    }>
) {
    return ranking.map((row) => ({
        rank: row.rank,
        candidateName: row.candidateName,
        score: coerceScore(row.stageScore),
        reason: row.competitiveAdvantage,
        recommendation: row.recommendation,
        overallRecommendation: row.overallRecommendation,
        executiveComment: row.executiveComment,
        confidence: row.confidence,
        confidence_rationale: row.confidence_rationale,
        reasons: row.reasons,
        strengthsList: row.strengths,
        risks: row.risks,
        watchOut: row.watchOut,
        differenceFromNext: row.differenceFromNext,
    }));
}
