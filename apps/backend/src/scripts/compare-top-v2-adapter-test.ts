/**
 * Compare Top v2 adapter offline tests (mapping + flag routing).
 * Run: npm run test:compare-top-v2-adapter
 */
import assert from 'node:assert/strict';
import {
    getCampaignCompareStageWebhookUrl,
    type CampaignCompareStage,
} from '../services/campaignCompareCallbackAuth.js';
import {
    isCampaignCompareV2Enabled,
    isCompareTopV2EnabledForStage,
    mapUiStageToCompareStage,
    mapUiStageToCampaignField,
    mapV2RankingForUiTest,
    mapV2RecordToUiResult,
} from '../services/compareTopV2Adapter.js';
import { buildCompareTopV2EmailPayload } from '../services/compareTopV2EmailDispatch.js';
import type { ICampaignCompareRequest } from '../models/CampaignCompareRequest.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        const val = overrides[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    try {
        fn();
    } finally {
        for (const key of Object.keys(overrides)) {
            const val = prev[key];
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    }
}

function mockRecord(
    partial: Partial<ICampaignCompareRequest> & Pick<ICampaignCompareRequest, 'status'>
): ICampaignCompareRequest {
    return {
        requestId: 'req-1',
        compareStage: 'stage1',
        uiStage: 'screening',
        campaignId: 'camp-1',
        organizationId: 'org-1',
        requestedBy: 'user-1',
        candidateIds: ['507f1f77bcf86cd799439011'],
        candidateSnapshotHash: 'hash',
        criteria: {},
        topN: 5,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        emails: ['hr@example.com'],
        ...partial,
    } as ICampaignCompareRequest;
}

function testStageMap(): void {
    assert.equal(mapUiStageToCompareStage('screening'), 'stage1');
    assert.equal(mapUiStageToCompareStage('voice'), 'stage2');
    assert.equal(mapUiStageToCompareStage('video'), 'stage3');
    assert.equal(mapUiStageToCampaignField('screening'), 'aiCompareTopResult');
    assert.equal(mapUiStageToCampaignField('voice'), 'voiceAiCompareTopResult');
    assert.equal(mapUiStageToCampaignField('video'), 'videoAiCompareTopResult');
}

function testResultMapping(): void {
    const record = mockRecord({
        status: 'completed',
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
        result: {
            comparativeSummary: 'Top picks summary',
            candidateRanking: [
                {
                    rank: 1,
                    candidateId: '507f1f77bcf86cd799439011',
                    candidateName: 'Alice',
                    stageScore: 92,
                    competitiveAdvantage: 'Strong fit',
                    recommendation: 'Hire',
                },
            ],
            topRecommendation: 'Alice',
            interviewFocus: 'Leadership',
            wildcard: null,
        },
    });

    const ui = mapV2RecordToUiResult(record);
    assert.equal(ui.status, 'completed');
    assert.equal(ui.summary, 'Top picks summary');
    assert.equal(ui.ranking?.[0]?.rank, 1);
    assert.equal(ui.ranking?.[0]?.candidateName, 'Alice');
    assert.equal(ui.ranking?.[0]?.score, 92);
    assert.equal(ui.ranking?.[0]?.reason, 'Strong fit');
    assert.equal(ui.ranking?.[0]?.recommendation, 'Hire');
}

function testProcessingStatusMapping(): void {
    assert.equal(mapV2RecordToUiResult(mockRecord({ status: 'dispatched' })).status, 'processing');
    assert.equal(mapV2RecordToUiResult(mockRecord({ status: 'processing' })).status, 'processing');
    assert.equal(mapV2RecordToUiResult(mockRecord({ status: 'failed' })).status, 'failed');
    assert.equal(mapV2RecordToUiResult(mockRecord({ status: 'refunded' })).status, 'refunded');
}

function testFlagRouting(): void {
    withEnv({ CAMPAIGN_COMPARE_V2_ENABLED: 'false' }, () => {
        assert.equal(isCampaignCompareV2Enabled(), false);
        assert.equal(isCompareTopV2EnabledForStage('screening'), false);
    });

    withEnv(
        {
            CAMPAIGN_COMPARE_V2_ENABLED: 'true',
            N8N_CAMPAIGN_COMPARE_STAGE1_WEBHOOK_URL: 'https://n8n.example/stage1',
            N8N_CAMPAIGN_COMPARE_STAGE2_WEBHOOK_URL: '',
            N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL: '',
        },
        () => {
            assert.equal(isCampaignCompareV2Enabled(), true);
            assert.equal(isCompareTopV2EnabledForStage('screening'), true);
            assert.equal(isCompareTopV2EnabledForStage('voice'), false);
            assert.equal(isCompareTopV2EnabledForStage('video'), false);
        }
    );
}

function testEmailPayload(): void {
    const record = mockRecord({
        status: 'completed',
        result: {
            comparativeSummary: 'Summary',
            candidateRanking: [],
            topRecommendation: 'Alice',
            interviewFocus: 'Focus',
            wildcard: null,
        },
    });
    const ui = mapV2RecordToUiResult(record);
    const payload = buildCompareTopV2EmailPayload(record, ui);
    assert.equal(payload.mode, 'email_dispatch_only');
    assert.equal(payload.source, 'campaign-compare-v2-email');
    assert.deepEqual(payload.emails, ['hr@example.com']);
}

function testRankingHelper(): void {
    const mapped = mapV2RankingForUiTest([
        {
            rank: 1,
            candidateName: 'Bob',
            stageScore: '88',
            competitiveAdvantage: 'Fast learner',
            decisionAction: 'Proceed to Voice Interview',
            decisionReason: 'Highest screening score with complete eligibility.',
        },
    ]);
    assert.equal(mapped[0].score, 88);
    assert.equal(mapped[0].decisionAction, 'Proceed to Voice Interview');
    assert.equal(mapped[0].executiveComment, 'Highest screening score with complete eligibility.');
}

function testStage3WebhookEnvKey(): void {
    withEnv({ N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL: 'https://n8n.example/stage3' }, () => {
        const url = getCampaignCompareStageWebhookUrl('stage3' as CampaignCompareStage);
        assert.equal(url, 'https://n8n.example/stage3');
    });
}

function main(): void {
    testStageMap();
    testResultMapping();
    testProcessingStatusMapping();
    testFlagRouting();
    testEmailPayload();
    testRankingHelper();
    testStage3WebhookEnvKey();
    console.log('compare-top-v2-adapter-test: all passed');
}

main();
