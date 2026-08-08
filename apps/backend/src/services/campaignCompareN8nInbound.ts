import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import CampaignCompareRequest, {
    type CandidateRankingItem,
    type CampaignCompareResult,
} from '../models/CampaignCompareRequest.js';
import {
    assertCampaignCompareSecureConfiguration,
    getCampaignCompareSigningSecret,
    parseCampaignCompareQueryClaims,
    validateCampaignCompareTimestamps,
    verifyCampaignCompareHmacToken,
    verifyInboundCampaignCompareSecret,
    type CampaignCompareStage,
} from './campaignCompareCallbackAuth.js';
import {
    buildCampaignCompareIdempotencyKey,
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from './webhookIdempotency.js';
import { dispatchCompareTopV2Emails } from './compareTopV2EmailDispatch.js';
import { mirrorCompareTopV2ToCampaign } from './compareTopV2Adapter.js';
import { refundCampaignCompareEmail } from './compareEmailBilling.js';
import { emitDomainEventBestEffort } from './domainEventService.js';

const MAX_SUMMARY = 8000;
const MAX_FOCUS = 4000;
const MAX_ADVANTAGE = 2000;
const MAX_NAME = 300;
const MAX_LIST_ITEMS = 6;

function truncate(value: unknown, max: number): string {
    const s = value == null ? '' : String(value).trim();
    if (!s) return '';
    return s.length > max ? s.slice(0, max) : s;
}

/** يطبّع قائمة نصية من n8n: يقصّ عدد العناصر وطول كل عنصر؛ يُرجع undefined إذا فارغة. */
function truncateList(value: unknown, maxItems: number, maxLen: number): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out = value
        .map((x) => truncate(x, maxLen))
        .filter((s) => s !== '')
        .slice(0, maxItems);
    return out.length > 0 ? out : undefined;
}

/** أقصى عدد أبعاد في comparativeInsights (مدخل n8n — يُقصّ الزائد). */
const MAX_INSIGHT_DIMENSIONS = 8;
const MAX_INSIGHT_KEY = 100;

/**
 * يطبّع comparativeInsights القادم من n8n إلى Record<string,string> نظيف:
 * كائن عادي فقط، مفاتيح/قيم نصية مقصوصة، بحد MAX_INSIGHT_DIMENSIONS بُعداً.
 */
function normalizeComparativeInsights(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const out: Record<string, string> = {};
    let count = 0;
    for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
        if (count >= MAX_INSIGHT_DIMENSIONS) break;
        const key = truncate(rawKey, MAX_INSIGHT_KEY);
        const val =
            typeof rawVal === 'string' || typeof rawVal === 'number'
                ? truncate(rawVal, MAX_ADVANTAGE)
                : '';
        if (!key || !val) continue;
        out[key] = val;
        count += 1;
    }
    return count > 0 ? out : undefined;
}

/** يقيّد الثقة إلى عدد صحيح ضمن [0,100]؛ undefined إذا غير رقمية. */
function clampConfidence(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(100, Math.max(0, Math.round(n)));
}

function isValidObjectId(id: string): boolean {
    return mongoose.Types.ObjectId.isValid(id) && /^[a-fA-F0-9]{24}$/.test(id);
}

function normalizeRecommendation(
    raw: unknown
): 'Hire' | 'Consider' | 'Reject' | undefined {
    if (raw === undefined || raw === null) return undefined;
    const s = String(raw).trim();
    if (s === 'Hire' || s === 'Consider' || s === 'Reject') return s;
    return undefined;
}

function coerceStageScore(raw: unknown): string | number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') return raw;
    return '';
}

function parseRanking(
    raw: unknown,
    allowedIds: Set<string>
): { ok: true; ranking: CandidateRankingItem[] } | { ok: false; message: string } {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, message: 'candidateRanking must be a non-empty array' };
    }

    const seen = new Set<string>();
    const seenRanks = new Set<number>();
    const ranking: CandidateRankingItem[] = [];

    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return { ok: false, message: 'Invalid candidateRanking item' };
        }
        const row = item as Record<string, unknown>;
        const candidateId = String(row.candidateId ?? row.CandidateID ?? '').trim();
        const rank = Number(row.rank);
        if (!isValidObjectId(candidateId)) {
            return { ok: false, message: 'Invalid candidateId in ranking' };
        }
        if (!Number.isInteger(rank) || rank < 1) {
            return { ok: false, message: 'rank must be a positive integer' };
        }
        if (seenRanks.has(rank)) {
            return { ok: false, message: 'duplicate rank in ranking' };
        }
        seenRanks.add(rank);
        if (!allowedIds.has(candidateId)) {
            return { ok: false, message: 'candidateRanking contains ID outside request pool' };
        }
        if (seen.has(candidateId)) {
            return { ok: false, message: 'duplicate candidateId in ranking' };
        }
        seen.add(candidateId);

        ranking.push({
            rank,
            candidateId,
            candidateName: truncate(row.candidateName ?? row.ApplicantName, MAX_NAME),
            stageScore: coerceStageScore(
                row.stageScore ?? row.initial_screening_score ?? row.OverallScore
            ),
            competitiveAdvantage: truncate(row.competitiveAdvantage, MAX_ADVANTAGE),
            recommendation: normalizeRecommendation(row.recommendation ?? row.Recommendation),
            // Decision-support enrichment (Phase 1) — اختيارية، تقبل snake_case البديلة.
            overallRecommendation:
                truncate(row.overallRecommendation ?? row.overall_recommendation, MAX_NAME) ||
                undefined,
            executiveComment:
                truncate(row.executiveComment ?? row.executive_comment, MAX_ADVANTAGE) || undefined,
            confidence: clampConfidence(row.confidence),
            confidence_rationale:
                truncate(row.confidence_rationale ?? row.confidenceRationale, MAX_ADVANTAGE) ||
                undefined,
            reasons: truncateList(row.reasons, MAX_LIST_ITEMS, MAX_ADVANTAGE),
            strengths: truncateList(row.strengths, MAX_LIST_ITEMS, MAX_ADVANTAGE),
            risks: truncateList(row.risks, MAX_LIST_ITEMS, MAX_ADVANTAGE),
            watchOut: truncate(row.watchOut ?? row.watch_out, MAX_ADVANTAGE) || undefined,
            differenceFromNext:
                truncate(row.differenceFromNext ?? row.difference_from_next, MAX_ADVANTAGE) ||
                undefined,
        });
    }

    return { ok: true, ranking };
}

function parseWildcard(raw: unknown): CampaignCompareResult['wildcard'] {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const candidateId = String(o.candidateId ?? '').trim();
    if (!candidateId) return null;
    return {
        candidateId,
        candidateName: truncate(o.candidateName, MAX_NAME),
        reason: truncate(o.reason, MAX_ADVANTAGE),
    };
}

function normalizeResultBody(body: Record<string, unknown>): CampaignCompareResult {
    return {
        comparativeSummary: truncate(body.comparativeSummary, MAX_SUMMARY),
        candidateRanking: [],
        topRecommendation: truncate(body.topRecommendation, MAX_NAME),
        interviewFocus: truncate(
            body.interviewFocus ?? body.voice_interview_focus ?? body.video_interview_focus,
            MAX_FOCUS
        ),
        decisionSummary:
            truncate(body.decisionSummary ?? body.decision_summary, MAX_SUMMARY) || undefined,
        // Phase 1.5: حقول تحليلية
        contextualIntroduction:
            truncate(body.contextualIntroduction ?? body.contextual_introduction, MAX_SUMMARY) ||
            undefined,
        comparativeInsights: normalizeComparativeInsights(
            body.comparativeInsights ?? body.comparative_insights
        ),
        whyTopCandidateWins:
            truncate(body.whyTopCandidateWins ?? body.why_top_candidate_wins, MAX_SUMMARY) ||
            undefined,
        finalRecommendation:
            truncate(body.finalRecommendation ?? body.final_recommendation, MAX_SUMMARY) ||
            undefined,
        wildcard: parseWildcard(body.wildcard),
    };
}

/** Ensures callback body snapshot matches the dispatched pool on the request record. */
export function validateCampaignCompareBodySnapshotHash(
    body: Record<string, unknown>,
    recordSnapshotHash: string
): { ok: true } | { ok: false; error: 'snapshot_hash_required' | 'snapshot_hash_mismatch' } {
    const bodyHash = String(body.candidateSnapshotHash ?? '').trim();
    const expected = String(recordSnapshotHash ?? '').trim();
    if (!bodyHash) {
        return { ok: false, error: 'snapshot_hash_required' };
    }
    if (!expected || bodyHash !== expected) {
        return { ok: false, error: 'snapshot_hash_mismatch' };
    }
    return { ok: true };
}

export async function postCampaignCompareN8nInbound(
    req: Request,
    res: Response,
    expectedStage: CampaignCompareStage
): Promise<void> {
    try {
        assertCampaignCompareSecureConfiguration();
    } catch {
        res.status(503).json({ ok: false, error: 'campaign_compare_security_unconfigured' });
        return;
    }

    const claims = parseCampaignCompareQueryClaims(req);
    if (!claims) {
        res.status(401).json({ ok: false, error: 'invalid_callback_claims' });
        return;
    }

    if (claims.compareStage !== expectedStage) {
        res.status(403).json({ ok: false, error: 'stage_mismatch' });
        return;
    }

    const signingSecret = getCampaignCompareSigningSecret();
    if (!signingSecret) {
        res.status(503).json({ ok: false, error: 'campaign_compare_security_unconfigured' });
        return;
    }

    const hmac = verifyCampaignCompareHmacToken(claims, signingSecret);
    if (!hmac.ok) {
        res.status(401).json({ ok: false, error: 'invalid_callback_signature' });
        return;
    }

    const ts = validateCampaignCompareTimestamps(claims.issuedAt, claims.expiresAt);
    if (!ts.ok) {
        res.status(401).json({ ok: false, error: 'invalid_callback_timestamp' });
        return;
    }

    const record = await CampaignCompareRequest.findOne({ requestId: claims.requestId });
    if (!record) {
        res.status(404).json({ ok: false, error: 'unknown_request' });
        return;
    }

    if (
        record.compareStage !== claims.compareStage ||
        record.campaignId !== claims.campaignId ||
        record.organizationId !== claims.organizationId
    ) {
        res.status(403).json({ ok: false, error: 'callback_binding_mismatch' });
        return;
    }

    const secretCheck = verifyInboundCampaignCompareSecret(req);
    if (!secretCheck.ok) {
        res.status(401).json({ ok: false, error: 'invalid_inbound_secret' });
        return;
    }

    const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>)
            : {};

    const bodyRequestId = String(body.requestId ?? '').trim();
    const bodyStage = String(body.compareStage ?? '').trim();
    if (bodyRequestId !== claims.requestId || bodyStage !== claims.compareStage) {
        res.status(400).json({ ok: false, error: 'body_claim_mismatch' });
        return;
    }

    const snapshotCheck = validateCampaignCompareBodySnapshotHash(body, record.candidateSnapshotHash);
    if (!snapshotCheck.ok) {
        res.status(400).json({ ok: false, error: snapshotCheck.error });
        return;
    }

    const allowedIds = new Set(record.candidateIds.map(String));
    const rankingParsed = parseRanking(body.candidateRanking, allowedIds);
    if (!rankingParsed.ok) {
        res.status(400).json({ ok: false, error: rankingParsed.message });
        return;
    }

    const idempotencyKey = buildCampaignCompareIdempotencyKey(
        req,
        claims.requestId,
        claims.compareStage,
        body
    );

    let claimed = false;
    try {
        const claim = await claimWebhook('n8n-campaign-compare', idempotencyKey, {
            route: `/webhook/n8n/campaign-compare/${expectedStage}`,
            requestId: claims.requestId,
            compareStage: claims.compareStage,
        });

        if (claim.duplicate) {
            res.status(200).json({
                ok: true,
                duplicate: true,
                requestId: claims.requestId,
            });
            return;
        }
        claimed = true;

        const normalized = normalizeResultBody(body);
        normalized.candidateRanking = rankingParsed.ranking;

        const finalized = await CampaignCompareRequest.findOneAndUpdate(
            buildCampaignCompareCompletionFilter(record._id),
            {
                $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    result: normalized,
                },
                $unset: {
                    failureCode: '',
                    failureMessage: '',
                },
            },
            { new: true }
        );

        if (!finalized) {
            await completeWebhook('n8n-campaign-compare', idempotencyKey);
            res.status(200).json({
                ok: true,
                duplicate: true,
                requestId: claims.requestId,
            });
            return;
        }

        await completeWebhook('n8n-campaign-compare', idempotencyKey);

        await mirrorCompareTopV2ToCampaign(finalized).catch((err) => {
            console.warn('[campaign-compare] mirror cache failed:', err instanceof Error ? err.message : err);
        });

        dispatchCompareTopV2Emails(finalized).catch((err) => {
            console.warn('[campaign-compare] email dispatch failed:', err instanceof Error ? err.message : err);
        });

        // Domain event (Phase 2) — lets the client drop the compare-result poll.
        void emitDomainEventBestEffort({
            organizationId: claims.organizationId,
            type: 'CompareCompleted',
            payload: {
                requestId: claims.requestId,
                campaignId: claims.campaignId,
                stage: claims.compareStage,
                rankedCount: Array.isArray(rankingParsed.ranking)
                    ? rankingParsed.ranking.length
                    : undefined,
            },
            idempotencyKey: `compare:${claims.requestId}:completed`,
        });

        res.status(200).json({
            ok: true,
            requestId: claims.requestId,
            status: 'completed',
        });
    } catch (err) {
        if (claimed) {
            await failWebhook('n8n-campaign-compare', idempotencyKey, wbErrorMessage(err)).catch(
                () => undefined
            );
        }
        await CampaignCompareRequest.updateOne(buildCampaignCompareFailureFilter(claims.requestId), {
            $set: {
                status: 'failed',
                failureCode: 'CALLBACK_PROCESSING_FAILED',
                failureMessage: 'Failed to persist compare result',
            },
        }).catch(() => undefined);
        // الطلب فشل نهائياً — استرداد الرصيد فوراً (idempotent؛ الـ sweep لا يلتقط failed).
        await refundCampaignCompareEmail({ requestId: claims.requestId, reason: 'failed' }).catch(
            (refundErr) => {
                console.warn(
                    '[campaign-compare] refund after callback failure did not complete:',
                    refundErr instanceof Error ? refundErr.message : refundErr
                );
            }
        );
        void emitDomainEventBestEffort({
            organizationId: claims.organizationId,
            type: 'CompareFailed',
            payload: {
                requestId: claims.requestId,
                campaignId: claims.campaignId,
                stage: claims.compareStage,
                error: 'CALLBACK_PROCESSING_FAILED',
                refunded: true,
            },
            idempotencyKey: `compare:${claims.requestId}:failed`,
        });
        console.error('[campaign-compare] inbound processing error');
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
}

/** @internal test helper */
export function buildCampaignCompareCompletionFilter(recordId: mongoose.Types.ObjectId) {
    // الحالات النهائية (completed/failed/refunded) لا تُقلب أبداً إلى completed —
    // callback متأخر بعد استرداد الرصيد كان يمنح العميل التقرير والاسترداد معاً.
    return {
        _id: recordId,
        status: { $in: ['pending', 'dispatched', 'processing'] as const },
    };
}

/** @internal test helper */
export function buildCampaignCompareFailureFilter(requestId: string) {
    // لا نرجع طلباً مسترداً (refunded) إلى failed — الاسترداد حالة نهائية.
    return {
        requestId,
        status: { $nin: ['completed', 'refunded'] as const },
    };
}

/** @internal test helper */
export function campaignCompareWebhookActionsAfterFinalize(
    finalized: unknown
): { completeWebhook: boolean; failWebhook: boolean; duplicate: boolean } {
    if (!finalized) {
        return { completeWebhook: true, failWebhook: false, duplicate: true };
    }
    return { completeWebhook: true, failWebhook: false, duplicate: false };
}

/** @internal test helper */
export function validateCampaignCompareRankingForTest(
    raw: unknown,
    allowedIds: Set<string>
): ReturnType<typeof parseRanking> {
    return parseRanking(raw, allowedIds);
}

/** @internal test helper */
export function isStage3CompareStage(stage: string): boolean {
    return stage === 'stage3';
}
