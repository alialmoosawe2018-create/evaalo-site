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
import { validateCampaignCompareRankingForTest } from '../services/campaignCompareN8nInbound.js';
import type { ICampaignCompareRequest } from '../models/CampaignCompareRequest.js';

const ALLOWED_ID = '507f1f77bcf86cd799439011';

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
            decisionSummary: 'Overall, Alice is the leading choice; move to offer.',
            contextualIntroduction: 'Three qualified candidates were evaluated.',
            comparativeInsights: {
                Leadership: 'Alice > Bob > Carol',
                Alignment: 'Alice > Bob >> Carol',
            },
            whyTopCandidateWins: 'Despite Bob\'s strong negotiation, Alice offers deeper strategic alignment.',
            finalRecommendation: 'Move forward with Alice as first choice.',
            candidateRanking: [
                {
                    rank: 1,
                    candidateId: ALLOWED_ID,
                    candidateName: 'Alice',
                    stageScore: 92,
                    competitiveAdvantage: 'Strong fit',
                    recommendation: 'Hire',
                    overallRecommendation: 'Strong Hire',
                    executiveComment: 'Recommended as the leading candidate.',
                    confidence: 96,
                    confidence_rationale: 'High Confidence — clear separation from peers.',
                    reasons: ['Excellent alignment', 'Strong leadership'],
                    strengths: ['Leadership', 'Strategy'],
                    risks: ['Limited FMCG experience'],
                    watchOut: 'May need onboarding in enterprise sales.',
                    differenceFromNext: 'Stronger leadership depth.',
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
    assert.equal(ui.decisionSummary, 'Overall, Alice is the leading choice; move to offer.');
    assert.equal(ui.contextualIntroduction, 'Three qualified candidates were evaluated.');
    assert.deepEqual(ui.comparativeInsights, {
        Leadership: 'Alice > Bob > Carol',
        Alignment: 'Alice > Bob >> Carol',
    });
    assert.equal(ui.whyTopCandidateWins, 'Despite Bob\'s strong negotiation, Alice offers deeper strategic alignment.');
    assert.equal(ui.finalRecommendation, 'Move forward with Alice as first choice.');
    assert.deepEqual(ui.ranking, [
        {
            rank: 1,
            candidateName: 'Alice',
            score: 92,
            reason: 'Strong fit',
            recommendation: 'Hire',
            overallRecommendation: 'Strong Hire',
            executiveComment: 'Recommended as the leading candidate.',
            confidence: 96,
            confidence_rationale: 'High Confidence — clear separation from peers.',
            reasons: ['Excellent alignment', 'Strong leadership'],
            strengthsList: ['Leadership', 'Strategy'],
            risks: ['Limited FMCG experience'],
            watchOut: 'May need onboarding in enterprise sales.',
            differenceFromNext: 'Stronger leadership depth.',
        },
    ]);
}

/** توافق رجعي: نتيجة قديمة بلا الحقول الغنية → تُعرض دون كسر، والحقول الجديدة undefined. */
function testBackwardCompatMapping(): void {
    const record = mockRecord({
        status: 'completed',
        result: {
            comparativeSummary: 'Legacy summary',
            candidateRanking: [
                {
                    rank: 1,
                    candidateId: ALLOWED_ID,
                    candidateName: 'Old',
                    stageScore: 80,
                    competitiveAdvantage: 'Legacy note',
                },
            ],
            topRecommendation: 'Old',
            interviewFocus: 'Focus',
            wildcard: null,
        },
    });
    const ui = mapV2RecordToUiResult(record);
    assert.equal(ui.decisionSummary, undefined);
    const row = ui.ranking![0];
    assert.equal(row.candidateName, 'Old');
    assert.equal(row.reason, 'Legacy note');
    assert.equal(row.recommendation, undefined);
    assert.equal(row.overallRecommendation, undefined);
    assert.equal(row.confidence, undefined);
    assert.equal(row.reasons, undefined);
    assert.equal(row.strengthsList, undefined);
    assert.equal(row.risks, undefined);
    assert.equal(row.watchOut, undefined);
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
            decisionSummary: 'Move forward with Alice.',
            candidateRanking: [
                {
                    rank: 1,
                    candidateId: ALLOWED_ID,
                    candidateName: 'Alice',
                    stageScore: 92,
                    competitiveAdvantage: 'Strong fit',
                    risks: ['Limited FMCG experience'],
                },
            ],
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
    // Executive Summary (Phase 1) — يبدأ الإيميل بهذه القيم.
    assert.equal(payload.decisionSummary, 'Move forward with Alice.');
    assert.deepEqual(payload.executiveStats, {
        candidateCount: 1,
        topCandidate: 'Alice',
        topRisk: 'Limited FMCG experience',
    });
}

function testRankingHelper(): void {
    const mapped = mapV2RankingForUiTest([
        {
            rank: 1,
            candidateName: 'Bob',
            stageScore: '88',
            competitiveAdvantage: 'Fast learner',
            recommendation: 'Consider',
            overallRecommendation: 'Hire',
            confidence: 90,
            reasons: ['Adapts quickly'],
            strengths: ['Coachable'],
            risks: ['Junior'],
            watchOut: 'Needs mentoring.',
            differenceFromNext: 'More upside.',
        },
    ]);
    assert.deepEqual(mapped[0], {
        rank: 1,
        candidateName: 'Bob',
        score: 88,
        reason: 'Fast learner',
        recommendation: 'Consider',
        overallRecommendation: 'Hire',
        executiveComment: undefined,
        confidence: 90,
        confidence_rationale: undefined,
        reasons: ['Adapts quickly'],
        strengthsList: ['Coachable'],
        risks: ['Junior'],
        watchOut: 'Needs mentoring.',
        differenceFromNext: 'More upside.',
    });
}

/** تطبيع parseRanking للحقول الجديدة + clamp الثقة + تجاهل القيم المشوّهة. */
function testParseRankingEnrichment(): void {
    const allowed = new Set([ALLOWED_ID]);
    const res = validateCampaignCompareRankingForTest(
        [
            {
                rank: 1,
                candidateId: ALLOWED_ID,
                candidateName: 'Alice',
                stageScore: 92,
                competitiveAdvantage: 'Strong fit',
                overall_recommendation: 'Strong Hire',
                executive_comment: 'Leading candidate.',
                confidence: 150, // يُقصّ إلى 100
                reasons: ['a', '  ', 'b'], // العنصر الفارغ يُحذف
                strengths: ['Leadership'],
                risks: ['Junior in FMCG'],
                watch_out: 'Needs enterprise onboarding.',
                difference_from_next: 'Stronger overall.',
            },
        ],
        allowed
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const row = res.ranking[0];
    assert.equal(row.overallRecommendation, 'Strong Hire');
    assert.equal(row.executiveComment, 'Leading candidate.');
    assert.equal(row.confidence, 100);
    assert.deepEqual(row.reasons, ['a', 'b']);
    assert.deepEqual(row.strengths, ['Leadership']);
    assert.deepEqual(row.risks, ['Junior in FMCG']);
    assert.equal(row.watchOut, 'Needs enterprise onboarding.');
    assert.equal(row.differenceFromNext, 'Stronger overall.');
}

/** parseRanking بلا الحقول الجديدة → تبقى undefined (توافق رجعي). */
function testParseRankingLegacy(): void {
    const allowed = new Set([ALLOWED_ID]);
    const res = validateCampaignCompareRankingForTest(
        [
            {
                rank: 1,
                candidateId: ALLOWED_ID,
                candidateName: 'Old',
                stageScore: 80,
                competitiveAdvantage: 'Legacy',
            },
        ],
        allowed
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const row = res.ranking[0];
    assert.equal(row.overallRecommendation, undefined);
    assert.equal(row.confidence, undefined);
    assert.equal(row.reasons, undefined);
    assert.equal(row.strengths, undefined);
    assert.equal(row.risks, undefined);
    assert.equal(row.watchOut, undefined);
    assert.equal(row.differenceFromNext, undefined);
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
    testBackwardCompatMapping();
    testProcessingStatusMapping();
    testFlagRouting();
    testEmailPayload();
    testRankingHelper();
    testParseRankingEnrichment();
    testParseRankingLegacy();
    testStage3WebhookEnvKey();
    console.log('compare-top-v2-adapter-test: all passed');
}

main();
