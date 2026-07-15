import CampaignCompareRequest from '../models/CampaignCompareRequest.js';
import {
    getCampaignCompareStageWebhookUrl,
    mintCampaignCompareCallbackUrl,
    type CampaignCompareStage,
} from './campaignCompareCallbackAuth.js';
import type { BuiltCampaignComparePool } from './campaignComparePool.js';

export class CampaignCompareDispatchError extends Error {
    readonly statusCode = 502;
    readonly code = 'N8N_DISPATCH_FAILED';

    constructor(message = 'Failed to dispatch Campaign Compare to n8n') {
        super(message);
        this.name = 'CampaignCompareDispatchError';
    }
}

export async function dispatchCampaignCompareToN8n(input: {
    requestId: string;
    compareStage: CampaignCompareStage;
    campaignId: string;
    organizationId: string;
    pool: BuiltCampaignComparePool;
}): Promise<void> {
    const webhookUrl = getCampaignCompareStageWebhookUrl(input.compareStage);
    if (!webhookUrl) {
        throw new CampaignCompareDispatchError('Campaign Compare n8n webhook URL is not configured');
    }

    const minted = mintCampaignCompareCallbackUrl({
        compareStage: input.compareStage,
        requestId: input.requestId,
        campaignId: input.campaignId,
        organizationId: input.organizationId,
    });

    const body = {
        requestId: input.requestId,
        campaignId: input.campaignId,
        organizationId: input.organizationId,
        compareStage: input.compareStage,
        topN: input.pool.topN,
        criteria: input.pool.criteria,
        candidatePool: input.pool.candidatePool,
        candidateSnapshotHash: input.pool.candidateSnapshotHash,
        callbackUrl: minted.callbackUrl,
        inboundSecret: minted.inboundSecret,
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    let response: Response;
    try {
        response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    } catch {
        clearTimeout(t);
        await CampaignCompareRequest.updateOne(
            { requestId: input.requestId },
            {
                $set: {
                    status: 'failed',
                    failureCode: 'N8N_DISPATCH_FAILED',
                    failureMessage: 'Failed to reach n8n compare webhook',
                },
            }
        );
        throw new CampaignCompareDispatchError();
    }
    clearTimeout(t);

    if (!response.ok) {
        await CampaignCompareRequest.updateOne(
            { requestId: input.requestId },
            {
                $set: {
                    status: 'failed',
                    failureCode: 'N8N_DISPATCH_FAILED',
                    failureMessage: `n8n returned HTTP ${response.status}`,
                },
            }
        );
        throw new CampaignCompareDispatchError(`n8n returned HTTP ${response.status}`);
    }

    await CampaignCompareRequest.updateOne(
        { requestId: input.requestId },
        {
            $set: {
                status: 'processing',
                dispatchedAt: new Date(),
            },
        }
    );
}
