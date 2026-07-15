import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import CampaignCompareRequest from '../models/CampaignCompareRequest.js';
import {
    assertCampaignCompareApiInfrastructure,
    assertCampaignCompareOrgAllowlist,
    requireCampaignCompareStrictClerkAuth,
} from '../middleware/requireCampaignCompareApiAuth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getClerkUserId, getOrgId } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import {
    buildCampaignComparePool,
    CampaignComparePoolError,
} from '../services/campaignComparePool.js';
import {
    dispatchCampaignCompareToN8n,
    CampaignCompareDispatchError,
} from '../services/campaignCompareN8nOutbound.js';
import type { CampaignCompareStage } from '../services/campaignCompareCallbackAuth.js';
import type { CompareUiStage } from '../models/CampaignCompareRequest.js';

const router = Router();

const NOT_FOUND = { ok: false, error: 'compare_request_not_found' } as const;

const COMPARE_STAGE_TO_UI: Record<CampaignCompareStage, CompareUiStage> = {
    stage1: 'screening',
    stage2: 'voice',
    stage3: 'video',
};

function sanitizeGetDto(record: {
    requestId: string;
    compareStage: CampaignCompareStage;
    campaignId: string;
    status: string;
    topN: number;
    candidateIds: string[];
    failureMessage?: string;
    result?: unknown;
    createdAt: Date;
    dispatchedAt?: Date;
    completedAt?: Date;
}) {
    return {
        ok: true,
        requestId: record.requestId,
        compareStage: record.compareStage,
        campaignId: record.campaignId,
        status: record.status,
        topN: record.topN,
        candidateCount: record.candidateIds.length,
        createdAt: record.createdAt.toISOString(),
        dispatchedAt: record.dispatchedAt?.toISOString() ?? null,
        completedAt: record.completedAt?.toISOString() ?? null,
        failureMessage: record.failureMessage ?? null,
        result: record.status === 'completed' && record.result ? record.result : null,
    };
}

async function authorizeAndLoadRequest(req: Request, requestId: string) {
    const record = await CampaignCompareRequest.findOne({ requestId }).lean();
    if (!record) return null;
    const orgId = getOrgId(req);
    const userId = getClerkUserId(req);
    if (record.organizationId !== orgId || record.requestedBy !== userId) {
        return null;
    }
    return record;
}

async function handleCompareTrigger(req: Request, res: Response, compareStage: CampaignCompareStage) {
    const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId.trim() : '';
    if (!campaignId) {
        res.status(400).json({ ok: false, error: 'campaign_id_required' });
        return;
    }

    const organizationId = getOrgId(req);
    let pool;
    try {
        pool = await buildCampaignComparePool({
            compareStage,
            campaignId,
            organizationId,
            topN: req.body?.topN,
            candidateIds: req.body?.candidateIds,
            criteriaOverride: req.body?.criteriaOverride,
        });
    } catch (err) {
        if (err instanceof CampaignComparePoolError) {
            res.status(err.statusCode).json({ ok: false, error: err.code, message: err.message });
            return;
        }
        throw err;
    }

    const requestId = crypto.randomUUID();
    const requestedBy = getClerkUserId(req);

    await CampaignCompareRequest.create({
        requestId,
        compareStage,
        uiStage: COMPARE_STAGE_TO_UI[compareStage],
        campaignId,
        organizationId,
        requestedBy,
        candidateIds: pool.candidateIds,
        candidateSnapshotHash: pool.candidateSnapshotHash,
        criteria: pool.criteria,
        topN: pool.topN,
        status: 'pending',
    });

    try {
        await dispatchCampaignCompareToN8n({
            requestId,
            compareStage,
            campaignId,
            organizationId,
            pool,
        });
    } catch (err) {
        if (err instanceof CampaignCompareDispatchError) {
            res.status(502).json({
                ok: false,
                error: err.code,
                requestId,
                message: err.message,
            });
            return;
        }
        throw err;
    }

    logAudit(req, {
        action: 'campaignCompare.trigger',
        targetType: 'campaignCompare',
        targetId: requestId,
        metadata: { compareStage, campaignId, candidateCount: pool.candidateIds.length },
    });

    res.status(202).json({
        ok: true,
        requestId,
        compareStage,
        campaignId,
        status: 'dispatched',
        candidateCount: pool.candidateIds.length,
        pollUrl: `/api/campaign-compare/${requestId}`,
    });
}

const compareReadAuthStack = [
    assertCampaignCompareApiInfrastructure(),
    requireCampaignCompareStrictClerkAuth,
    requirePermission('campaignCompare.run'),
    assertCampaignCompareOrgAllowlist(),
] as const;

router.post(
    '/stage1',
    assertCampaignCompareApiInfrastructure({ requireDispatchWebhook: 'stage1' }),
    requireCampaignCompareStrictClerkAuth,
    requirePermission('campaignCompare.run'),
    assertCampaignCompareOrgAllowlist(),
    (req, res) => handleCompareTrigger(req, res, 'stage1')
);

router.post(
    '/stage2',
    assertCampaignCompareApiInfrastructure({ requireDispatchWebhook: 'stage2' }),
    requireCampaignCompareStrictClerkAuth,
    requirePermission('campaignCompare.run'),
    assertCampaignCompareOrgAllowlist(),
    (req, res) => handleCompareTrigger(req, res, 'stage2')
);

router.post(
    '/stage3',
    assertCampaignCompareApiInfrastructure({ requireDispatchWebhook: 'stage3' }),
    requireCampaignCompareStrictClerkAuth,
    requirePermission('campaignCompare.run'),
    assertCampaignCompareOrgAllowlist(),
    (req, res) => handleCompareTrigger(req, res, 'stage3')
);

router.get(
    '/campaign/:campaignId/latest',
    ...compareReadAuthStack,
    async (req: Request, res: Response) => {
        const campaignId = String(req.params.campaignId ?? '').trim();
        const compareStage = String(req.query.compareStage ?? '').trim() as CampaignCompareStage;
        if (!campaignId) {
            res.status(400).json({ ok: false, error: 'campaign_id_required' });
            return;
        }
        if (compareStage !== 'stage1' && compareStage !== 'stage2' && compareStage !== 'stage3') {
            res.status(400).json({ ok: false, error: 'invalid_compare_stage' });
            return;
        }

        const record = await CampaignCompareRequest.findOne({
            campaignId,
            compareStage,
            organizationId: getOrgId(req),
            requestedBy: getClerkUserId(req),
        })
            .sort({ createdAt: -1 })
            .lean();

        if (!record) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        res.json(sanitizeGetDto(record));
    }
);

router.get(
    '/:requestId',
    ...compareReadAuthStack,
    async (req: Request, res: Response) => {
        const requestId = String(req.params.requestId ?? '').trim();
        if (!requestId) {
            res.status(400).json({ ok: false, error: 'request_id_required' });
            return;
        }
        const record = await authorizeAndLoadRequest(req, requestId);
        if (!record) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        res.json(sanitizeGetDto(record));
    }
);

export default router;
