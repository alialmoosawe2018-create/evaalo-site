// ============================================
// Stage 1 n8n inbound security wrapper + idempotency
// ============================================

import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import {
    bodyIdentityConflictsWithClaims,
    candidateCorrelationRef,
    classifyStageCallback,
    getStageCallbackSecurityMode,
    getStageSigningSecret,
    parseStageQueryClaims,
    secureSessionIdSatisfied,
    STAGE_EVALUATION_SOURCE,
    type StageCallbackClass,
    type StageCallbackMode,
    validateStageTimestamps,
    verifyInboundStageSecret,
    verifyStageHmacToken,
} from './stageCallbackAuth.js';
import {
    buildN8nStageIdempotencyKey,
    claimWebhook,
    completeWebhook,
    errorMessage,
    failWebhook,
} from './webhookIdempotency.js';

export interface StageN8nIngressContext {
    candidateId: string;
    sessionId: string;
    /** campaignId من الـ claims الموقّعة (secure) أو جسم الطلب (legacy) — لإعادة ربط الحملة عند الحاجة. */
    campaignId?: string;
    callbackClass: 'legacy_accept' | 'secure_accept';
    securityMode: 'optional' | 'required';
    idempotencyKey: string;
}

export type StageN8nIngressRequest = Request & { stageN8nIngress?: StageN8nIngressContext };

export type StageN8nInboundTestOverrides = {
    findCandidateById?: (id: string) => Promise<{ _id: string; campaignId?: string } | null>;
    claimWebhookFn?: typeof claimWebhook;
    completeWebhookFn?: typeof completeWebhook;
    failWebhookFn?: typeof failWebhook;
};

let stageN8nInboundTestOverrides: StageN8nInboundTestOverrides | null = null;

/** Offline tests only — restores via `setStageN8nInboundTestOverrides(null)`. */
export function setStageN8nInboundTestOverrides(overrides: StageN8nInboundTestOverrides | null): void {
    stageN8nInboundTestOverrides = overrides;
}

const INVALID_WEBHOOK_ID_TOKENS = new Set(['', 'undefined', 'null', 'nan']);

function normalizeWebhookIdString(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!s || INVALID_WEBHOOK_ID_TOKENS.has(s.toLowerCase())) return null;
    return s;
}

function parseLegacyCandidateIdFromBody(data: Record<string, unknown>): string | null {
    const candidates = [
        data.candidateId,
        data.id,
        (data.candidate as Record<string, unknown> | undefined)?.id,
        data._id,
        (data.candidate as Record<string, unknown> | undefined)?._id,
    ];
    for (const raw of candidates) {
        const s = normalizeWebhookIdString(raw);
        if (!s) continue;
        if (!mongoose.Types.ObjectId.isValid(s)) continue;
        if (!/^[a-fA-F0-9]{24}$/.test(s)) continue;
        try {
            return new mongoose.Types.ObjectId(s).toString();
        } catch {
            continue;
        }
    }
    return null;
}

function normalizeEvaluationSourceToken(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim().toLowerCase();
}

function pickEvaluationSource(body: Record<string, unknown>): string {
    const raw = body.evaluationSource ?? body.evaluation_source;
    return normalizeEvaluationSourceToken(raw);
}

type IngressLog = {
    ingress: StageCallbackMode;
    securityMode: 'optional' | 'required';
    callbackClass: StageCallbackClass | 'legacy_accept' | 'secure_accept';
    outcome: 'accepted' | 'rejected' | 'duplicate';
    errorCategory?: string;
    candidateRef?: string;
};

function logStageIngress(entry: IngressLog): void {
    console.log(
        `[stage_ingress] ingress=${entry.ingress} securityMode=${entry.securityMode} callbackClass=${entry.callbackClass} outcome=${entry.outcome}` +
            (entry.errorCategory ? ` errorCategory=${entry.errorCategory}` : '') +
            (entry.candidateRef ? ` candidateRef=${entry.candidateRef}` : '')
    );
}

function rejectIngress(
    res: Response,
    status: number,
    ingress: StageCallbackMode,
    callbackClass: StageCallbackClass | 'legacy_accept' | 'secure_accept',
    errorCategory: string,
    candidateRef?: string
): void {
    logStageIngress({
        ingress,
        securityMode: getStageCallbackSecurityMode(),
        callbackClass,
        outcome: 'rejected',
        errorCategory,
        candidateRef,
    });
    res.status(status).json({ success: false, error: 'Unauthorized' });
}

export type StageN8nProcessFn = (
    req: StageN8nIngressRequest,
    res: Response,
    mode: StageCallbackMode
) => Promise<unknown>;

export type Stage1InboundSecurityPrecheckResult =
    | { ok: true; callbackClass: StageCallbackClass }
    | { ok: false; status: number; errorCategory: string };

/** Classify callback + reject partial/unsigned required before any persistence. */
export function evaluateStage1InboundSecurityPrecheck(req: Request): Stage1InboundSecurityPrecheckResult {
    const securityMode = getStageCallbackSecurityMode();
    const callbackClass = classifyStageCallback(req);

    if (callbackClass === 'partial_secure') {
        return { ok: false, status: 401, errorCategory: 'partial_secure_bundle' };
    }
    if (securityMode === 'required' && callbackClass === 'legacy') {
        return { ok: false, status: 401, errorCategory: 'unsigned_required_mode' };
    }
    return { ok: true, callbackClass };
}

async function findCandidateById(id: string) {
    if (stageN8nInboundTestOverrides?.findCandidateById) {
        return stageN8nInboundTestOverrides.findCandidateById(id);
    }
    return Candidate.findById(id);
}

async function claimWebhookIngress(
    ...args: Parameters<typeof claimWebhook>
): ReturnType<typeof claimWebhook> {
    if (stageN8nInboundTestOverrides?.claimWebhookFn) {
        return stageN8nInboundTestOverrides.claimWebhookFn(...args);
    }
    return claimWebhook(...args);
}

async function completeWebhookIngress(
    ...args: Parameters<typeof completeWebhook>
): ReturnType<typeof completeWebhook> {
    if (stageN8nInboundTestOverrides?.completeWebhookFn) {
        return stageN8nInboundTestOverrides.completeWebhookFn(...args);
    }
    return completeWebhook(...args);
}

async function failWebhookIngress(
    ...args: Parameters<typeof failWebhook>
): ReturnType<typeof failWebhook> {
    if (stageN8nInboundTestOverrides?.failWebhookFn) {
        return stageN8nInboundTestOverrides.failWebhookFn(...args);
    }
    return failWebhook(...args);
}

export async function postStageN8nInbound(
    req: StageN8nIngressRequest,
    res: Response,
    routeMode: StageCallbackMode,
    processEvaluation: StageN8nProcessFn
): Promise<void> {
    const securityMode = getStageCallbackSecurityMode();
    const files = req.files as Express.Multer.File[] | undefined;
    const body = (req.body || {}) as Record<string, unknown>;
    const callbackClass = classifyStageCallback(req);

    console.log(
        `[stage_ingress] ingress=${routeMode} securityMode=${securityMode} callbackClass=${callbackClass} files=${files?.length ?? 0}`
    );

    if (callbackClass === 'partial_secure') {
        return rejectIngress(res, 401, routeMode, 'partial_secure', 'partial_secure_bundle');
    }

    if (securityMode === 'required' && callbackClass === 'legacy') {
        return rejectIngress(res, 401, routeMode, 'legacy', 'unsigned_required_mode');
    }

    let candidateId: string;
    let sessionId = '';
    let ingressCallbackClass: 'legacy_accept' | 'secure_accept';

    if (callbackClass === 'secure_complete') {
        const claims = parseStageQueryClaims(req)!;
        const signingSecret = getStageSigningSecret();
        if (!signingSecret) {
            return rejectIngress(res, 401, routeMode, 'secure_complete', 'signing_secret_missing');
        }

        const hmac = verifyStageHmacToken(claims, signingSecret);
        if (!hmac.ok) {
            return rejectIngress(
                res,
                401,
                routeMode,
                'secure_complete',
                hmac.errorCategory,
                candidateCorrelationRef(claims.candidateId)
            );
        }

        const ts = validateStageTimestamps(claims.issuedAt, claims.expiresAt);
        if (!ts.ok) {
            return rejectIngress(
                res,
                401,
                routeMode,
                'secure_complete',
                ts.errorCategory,
                candidateCorrelationRef(claims.candidateId)
            );
        }

        const bodyCheck = bodyIdentityConflictsWithClaims(body, claims);
        if (!bodyCheck.ok) {
            return rejectIngress(
                res,
                bodyCheck.status,
                routeMode,
                'secure_complete',
                bodyCheck.errorCategory,
                candidateCorrelationRef(claims.candidateId)
            );
        }

        candidateId = claims.candidateId;
        sessionId = claims.sessionId;
        ingressCallbackClass = 'secure_accept';

        if (routeMode !== claims.mode) {
            return rejectIngress(
                res,
                403,
                routeMode,
                'secure_complete',
                'route_mode_mismatch',
                candidateCorrelationRef(candidateId)
            );
        }

        const expectedSource = STAGE_EVALUATION_SOURCE[routeMode];
        const bodySource = pickEvaluationSource(body);
        if (!bodySource || bodySource !== expectedSource) {
            return rejectIngress(
                res,
                403,
                routeMode,
                'secure_complete',
                'evaluation_source_mismatch',
                candidateCorrelationRef(candidateId)
            );
        }

        if (!secureSessionIdSatisfied(routeMode, sessionId)) {
            return rejectIngress(
                res,
                400,
                routeMode,
                'secure_complete',
                'session_id_required',
                candidateCorrelationRef(candidateId)
            );
        }

        const candidate = await findCandidateById(candidateId);
        if (!candidate) {
            logStageIngress({
                ingress: routeMode,
                securityMode,
                callbackClass: 'secure_complete',
                outcome: 'rejected',
                errorCategory: 'candidate_not_found',
                candidateRef: candidateCorrelationRef(candidateId),
            });
            res.status(404).json({ success: false, error: 'Candidate not found' });
            return;
        }

        if (claims.campaignId && candidate.campaignId && claims.campaignId !== candidate.campaignId) {
            return rejectIngress(
                res,
                403,
                routeMode,
                'secure_complete',
                'campaign_id_mismatch',
                candidateCorrelationRef(candidateId)
            );
        }

        if (!verifyInboundStageSecret(req)) {
            return rejectIngress(
                res,
                401,
                routeMode,
                'secure_complete',
                'inbound_secret_invalid',
                candidateCorrelationRef(candidateId)
            );
        }

        const idempotencySessionId =
            routeMode === 'stage1' || routeMode === 'stage2' || routeMode === 'stage3' ? sessionId : '';
        const idempotencyKey = buildN8nStageIdempotencyKey(
            req,
            routeMode,
            candidateId,
            idempotencySessionId
        );
        const claim = await claimWebhookIngress('n8n', idempotencyKey, {
            mode: routeMode,
            candidateId,
            sessionId,
            callbackClass: ingressCallbackClass,
        });
        if (claim.duplicate) {
            logStageIngress({
                ingress: routeMode,
                securityMode,
                callbackClass: ingressCallbackClass,
                outcome: 'duplicate',
                candidateRef: candidateCorrelationRef(candidateId),
            });
            res.status(200).json({
                success: true,
                duplicate: true,
                ingress: routeMode,
            });
            return;
        }

        req.stageN8nIngress = {
            candidateId,
            sessionId,
            campaignId: claims.campaignId || undefined,
            callbackClass: ingressCallbackClass,
            securityMode,
            idempotencyKey,
        };

        try {
            await processEvaluation(req, res, routeMode);
            if (res.headersSent && res.statusCode >= 200 && res.statusCode < 300) {
                await completeWebhookIngress('n8n', idempotencyKey);
                logStageIngress({
                    ingress: routeMode,
                    securityMode,
                    callbackClass: ingressCallbackClass,
                    outcome: 'accepted',
                    candidateRef: candidateCorrelationRef(candidateId),
                });
            } else if (res.headersSent && res.statusCode >= 400) {
                await failWebhookIngress('n8n', idempotencyKey, `http_${res.statusCode}`);
            }
        } catch (err) {
            await failWebhookIngress('n8n', idempotencyKey, errorMessage(err));
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Internal server error' });
            }
        }
        return;
    }

    // Legacy optional path
    ingressCallbackClass = 'legacy_accept';

    const legacyCandidateId = parseLegacyCandidateIdFromBody(body);
    if (!legacyCandidateId) {
        res.status(400).json({
            success: false,
            error: 'Valid candidate ID is required',
            hint: 'Send a 24-character MongoDB ObjectId in candidateId, id, or candidate.id.',
        });
        return;
    }

    candidateId = legacyCandidateId;
    sessionId =
        typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : '';

    const candidate = await findCandidateById(candidateId);
    if (!candidate) {
        logStageIngress({
            ingress: routeMode,
            securityMode,
            callbackClass: 'legacy_accept',
            outcome: 'rejected',
            errorCategory: 'candidate_not_found',
            candidateRef: candidateCorrelationRef(candidateId),
        });
        res.status(404).json({ success: false, error: 'Candidate not found' });
        return;
    }

    const idempotencySessionId =
        routeMode === 'stage1' || routeMode === 'stage2' || routeMode === 'stage3' ? sessionId : '';
    const idempotencyKey = buildN8nStageIdempotencyKey(
        req,
        routeMode,
        candidateId,
        idempotencySessionId
    );
    const claim = await claimWebhookIngress('n8n', idempotencyKey, {
        mode: routeMode,
        candidateId,
        sessionId,
        callbackClass: ingressCallbackClass,
    });
    if (claim.duplicate) {
        logStageIngress({
            ingress: routeMode,
            securityMode,
            callbackClass: 'legacy_accept',
            outcome: 'duplicate',
            candidateRef: candidateCorrelationRef(candidateId),
        });
        res.status(200).json({
            success: true,
            duplicate: true,
            ingress: routeMode,
        });
        return;
    }

    const legacyCampaignId = (() => {
        for (const key of ['campaignId', 'campaignID', 'CampaignID']) {
            const v = (body as Record<string, unknown>)[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
        const q = req.query.campaignId;
        const qStr = Array.isArray(q) ? q[0] : q;
        return typeof qStr === 'string' && qStr.trim() ? qStr.trim() : undefined;
    })();

    req.stageN8nIngress = {
        candidateId,
        sessionId,
        campaignId: legacyCampaignId,
        callbackClass: ingressCallbackClass,
        securityMode,
        idempotencyKey,
    };

    try {
        await processEvaluation(req, res, routeMode);
        if (res.headersSent && res.statusCode >= 200 && res.statusCode < 300) {
            await completeWebhookIngress('n8n', idempotencyKey);
            logStageIngress({
                ingress: routeMode,
                securityMode,
                callbackClass: ingressCallbackClass,
                outcome: 'accepted',
                candidateRef: candidateCorrelationRef(candidateId),
            });
        } else if (res.headersSent && res.statusCode >= 400) {
            await failWebhookIngress('n8n', idempotencyKey, `http_${res.statusCode}`);
        }
    } catch (err) {
        await failWebhookIngress('n8n', idempotencyKey, errorMessage(err));
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}
