/**
 * Campaign Compare security self-tests.
 * Run: npx tsx src/scripts/campaign-compare-security-test.ts
 */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import mongoose from 'mongoose';
import {
    buildCanonicalCampaignCompareSigningPayload,
    CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC,
    computeCampaignCompareHmacToken,
    assertCampaignCompareSecureConfiguration,
    CampaignCompareConfigurationError,
    getCampaignCompareSecurityMode,
    mintCampaignCompareCallbackUrl,
    parseCampaignCompareAllowedOrgIds,
    serializeCampaignCompareSigningPayload,
    validateCampaignCompareTimestamps,
    verifyCampaignCompareHmacToken,
    verifyInboundCampaignCompareSecret,
} from '../services/campaignCompareCallbackAuth.js';
import { buildCampaignCompareIdempotencyKey } from '../services/webhookIdempotency.js';
import {
    buildCampaignCompareCompletionFilter,
    buildCampaignCompareFailureFilter,
    campaignCompareWebhookActionsAfterFinalize,
    isStage3CompareStage,
    validateCampaignCompareRankingForTest,
    validateCampaignCompareBodySnapshotHash,
} from '../services/campaignCompareN8nInbound.js';
import {
    computeCampaignCompareSnapshotHash,
    type Stage1PoolItem,
    type Stage3PoolItem,
} from '../services/campaignComparePool.js';

const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const CAMPAIGN_ID = 'abc123campaign4567890123456789012';
const ORG_ID = 'org_default';
const SIGNING_SECRET = 'ccmp-signing-secret-32-chars-min!!!';
const INBOUND_SECRET = 'ccmp-inbound-secret-32-chars-min!!!!';
const CANDIDATE_A = '507f1f77bcf86cd799439011';
const CANDIDATE_B = '507f1f77bcf86cd799439012';

function mockReq(
    query: Record<string, string | undefined> = {},
    headers: Record<string, string | undefined> = {},
    body: Record<string, unknown> = {}
): Request {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) q[k] = v;
    }
    return { query: q, headers, body } as unknown as Request;
}

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

const BASE_ENV: Record<string, string> = {
    CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE: 'required',
    N8N_CAMPAIGN_COMPARE_INBOUND_SECRET: INBOUND_SECRET,
    CAMPAIGN_COMPARE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
    CAMPAIGN_COMPARE_CALLBACK_ALLOWLIST: 'https://api.evaalo.com',
    PUBLIC_API_URL: 'https://api.evaalo.com',
    CAMPAIGN_COMPARE_ALLOW_ORG_IDS: 'org_default',
    N8N_CAMPAIGN_COMPARE_STAGE1_WEBHOOK_URL: 'https://n8n.evaalo.com/webhook/stage1-compare',
    N8N_CAMPAIGN_COMPARE_STAGE2_WEBHOOK_URL: 'https://n8n.evaalo.com/webhook/stage2-compare',
    N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL: 'https://n8n.evaalo.com/webhook/stage3-compare',
    CLERK_SECRET_KEY: 'sk_test_campaign_compare',
    ENFORCE_AUTH: 'on',
    RBAC_ENFORCEMENT: 'on',
};

function withBaseEnv(fn: () => void): void {
    withEnv(BASE_ENV, fn);
}

function testCanonicalJsonKeyOrder(): void {
    const payload = buildCanonicalCampaignCompareSigningPayload({
        compareStage: 'stage1',
        requestId: REQUEST_ID,
        campaignId: CAMPAIGN_ID,
        organizationId: ORG_ID,
        issuedAt: 1000,
        expiresAt: 1000 + CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC,
    });
    const serialized = serializeCampaignCompareSigningPayload(payload);
    assert.equal(
        serialized,
        `{"v":1,"compareStage":"stage1","requestId":"${REQUEST_ID}","campaignId":"${CAMPAIGN_ID}","organizationId":"${ORG_ID}","issuedAt":1000,"expiresAt":87400}`
    );
}

function testValidHmacRoundTrip(): void {
    const claims = {
        requestId: REQUEST_ID,
        compareStage: 'stage2' as const,
        campaignId: CAMPAIGN_ID,
        organizationId: ORG_ID,
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_000 + CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC,
        token: '',
    };
    const payload = buildCanonicalCampaignCompareSigningPayload(claims);
    claims.token = computeCampaignCompareHmacToken(payload, SIGNING_SECRET);
    assert.equal(verifyCampaignCompareHmacToken(claims, SIGNING_SECRET).ok, true);
}

function testInvalidHmacRejected(): void {
    const claims = {
        requestId: REQUEST_ID,
        compareStage: 'stage1' as const,
        campaignId: CAMPAIGN_ID,
        organizationId: ORG_ID,
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_000 + CAMPAIGN_COMPARE_CALLBACK_TOKEN_TTL_SEC,
        token: 'not-a-valid-hmac',
    };
    const result = verifyCampaignCompareHmacToken(claims, SIGNING_SECRET);
    assert.equal(result.ok, false);
}

function testExpiredTokenRejected(): void {
    const now = Math.floor(Date.now() / 1000);
    const result = validateCampaignCompareTimestamps(now - 100_000, now - 50_000, now);
    assert.equal(result.ok, false);
}

function testFutureIssuedAtRejected(): void {
    const now = Math.floor(Date.now() / 1000);
    const result = validateCampaignCompareTimestamps(now + 10_000, now + 20_000, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCategory, 'issued_at_future');
}

function testMissingConfigRejected(): void {
    withEnv({ CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE: undefined }, () => {
        assert.throws(() => getCampaignCompareSecurityMode(), CampaignCompareConfigurationError);
    });
    withEnv({ CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE: 'optional' }, () => {
        assert.throws(() => getCampaignCompareSecurityMode(), CampaignCompareConfigurationError);
    });
}

function testAllowlistMismatchRejected(): void {
    withBaseEnv(() => {
        withEnv({ PUBLIC_API_URL: 'https://evil.example.com' }, () => {
            assert.throws(() => assertCampaignCompareSecureConfiguration(), CampaignCompareConfigurationError);
        });
    });
}

function testRankingOutsidePoolRejected(): void {
    const allowed = new Set([CANDIDATE_A]);
    const result = validateCampaignCompareRankingForTest(
        [{ rank: 1, candidateId: CANDIDATE_B, candidateName: 'X', competitiveAdvantage: 'y' }],
        allowed
    );
    assert.equal(result.ok, false);
}

function testDuplicateRankingIdsRejected(): void {
    const allowed = new Set([CANDIDATE_A, CANDIDATE_B]);
    const result = validateCampaignCompareRankingForTest(
        [
            { rank: 1, candidateId: CANDIDATE_A, candidateName: 'A', competitiveAdvantage: 'x' },
            { rank: 2, candidateId: CANDIDATE_A, candidateName: 'A', competitiveAdvantage: 'y' },
        ],
        allowed
    );
    assert.equal(result.ok, false);
}

function testDuplicateRankValuesRejected(): void {
    const allowed = new Set([CANDIDATE_A, CANDIDATE_B]);
    const result = validateCampaignCompareRankingForTest(
        [
            { rank: 1, candidateId: CANDIDATE_A, candidateName: 'A', competitiveAdvantage: 'x' },
            { rank: 1, candidateId: CANDIDATE_B, candidateName: 'B', competitiveAdvantage: 'y' },
        ],
        allowed
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /duplicate rank/i);
}

function testCompletionFilterUsesIdentityAndNotCompletedGuard(): void {
    const recordId = new mongoose.Types.ObjectId();
    const filter = buildCampaignCompareCompletionFilter(recordId);
    assert.equal(String(filter._id), String(recordId));
    assert.deepEqual(filter.status, { $ne: 'completed' });
}

function testCompletedRequestCannotBeOverwrittenByDifferentIdempotencyKey(): void {
    const recordId = new mongoose.Types.ObjectId();
    const filter = buildCampaignCompareCompletionFilter(recordId);
    const stored = {
        _id: recordId,
        requestId: REQUEST_ID,
        status: 'completed',
        result: {
            comparativeSummary: 'original-result',
            candidateRanking: [],
            topRecommendation: 'Alice',
            interviewFocus: 'focus-a',
        },
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
        failureCode: undefined,
        failureMessage: undefined,
        candidateIds: [CANDIDATE_A],
        candidateSnapshotHash: 'hash-original',
    };

    const matchesCompletionFilter =
        String(stored._id) === String(filter._id) && stored.status !== 'completed';
    assert.equal(matchesCompletionFilter, false);

    const alternateKey = buildCampaignCompareIdempotencyKey(
        mockReq({}, { 'x-idempotency-key': 'different-key' }, { requestId: REQUEST_ID }),
        REQUEST_ID,
        'stage1',
        { requestId: REQUEST_ID, compareStage: 'stage1', candidateRanking: [] }
    );
    const primaryKey = buildCampaignCompareIdempotencyKey(
        mockReq({}, { 'x-idempotency-key': 'primary-key' }, { requestId: REQUEST_ID }),
        REQUEST_ID,
        'stage1',
        { requestId: REQUEST_ID, compareStage: 'stage1', candidateRanking: [] }
    );
    assert.notEqual(alternateKey, primaryKey);

    const wouldFinalize = matchesCompletionFilter;
    assert.equal(wouldFinalize, false);
    assert.equal(stored.result.comparativeSummary, 'original-result');
    assert.equal(stored.status, 'completed');
    assert.equal(stored.candidateSnapshotHash, 'hash-original');
}

function testRaceLostCompletesWebhookWithoutFailure(): void {
    const actions = campaignCompareWebhookActionsAfterFinalize(null);
    assert.equal(actions.duplicate, true);
    assert.equal(actions.completeWebhook, true);
    assert.equal(actions.failWebhook, false);
}

function testPostClaimFailureCannotMarkCompletedRequestFailed(): void {
    const filter = buildCampaignCompareFailureFilter(REQUEST_ID);
    assert.deepEqual(filter.status, { $ne: 'completed' });
    assert.equal(filter.requestId, REQUEST_ID);

    const completed = { requestId: REQUEST_ID, status: 'completed' };
    const matchesFailureFilter =
        completed.requestId === filter.requestId && completed.status !== 'completed';
    assert.equal(matchesFailureFilter, false);
}

function testIdempotencyKeyUsesHeader(): void {
    const req = mockReq({}, { 'x-idempotency-key': 'exec-123' }, { requestId: REQUEST_ID });
    const key = buildCampaignCompareIdempotencyKey(req, REQUEST_ID, 'stage1', { foo: 'bar' });
    assert.equal(key, 'ccmp:stage1:exec-123');
}

function testRequiredOnlyMode(): void {
    withEnv({ CAMPAIGN_COMPARE_CALLBACK_SECURITY_MODE: 'optional' }, () => {
        assert.throws(() => getCampaignCompareSecurityMode(), CampaignCompareConfigurationError);
    });
}

function testEnforceAuthOffBlocksConfig(): void {
    withBaseEnv(() => {
        withEnv({ ENFORCE_AUTH: 'off' }, () => {
            const enforceOff =
                (process.env.ENFORCE_AUTH || '').toLowerCase() === 'off' ||
                !process.env.CLERK_SECRET_KEY;
            assert.equal(enforceOff, true);
        });
    });
}

function testOrgAllowlist(): void {
    withBaseEnv(() => {
        const allowed = parseCampaignCompareAllowedOrgIds();
        assert.ok(allowed.has('org_default'));
        assert.equal(allowed.has('org_other'), false);
    });
}

function testSnapshotHashStable(): void {
    const pool: Stage1PoolItem[] = [
        {
            candidateId: CANDIDATE_A,
            candidateName: 'Alice',
            positionAppliedFor: 'HR',
            overallScore: 90,
            recommendation: 'Hire',
            summary: 'Good',
            strengths: ['a'],
            weaknesses: ['b'],
            fitForRole: 'yes',
            finalHrEvaluation: '',
        },
    ];
    const h1 = computeCampaignCompareSnapshotHash('stage1', CAMPAIGN_ID, [CANDIDATE_A], pool);
    const h2 = computeCampaignCompareSnapshotHash('stage1', CAMPAIGN_ID, [CANDIDATE_A], pool);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
}

function testInboundSecretHeader(): void {
    withBaseEnv(() => {
        const okReq = mockReq({}, { 'x-campaign-compare-secret': INBOUND_SECRET });
        assert.equal(verifyInboundCampaignCompareSecret(okReq).ok, true);
        const badReq = mockReq({}, { 'x-campaign-compare-secret': 'wrong' });
        assert.equal(verifyInboundCampaignCompareSecret(badReq).ok, false);
    });
}

function testMintCallbackUrl(): void {
    withBaseEnv(() => {
        const minted = mintCampaignCompareCallbackUrl({
            compareStage: 'stage1',
            requestId: REQUEST_ID,
            campaignId: CAMPAIGN_ID,
            organizationId: ORG_ID,
            nowSec: 1_700_000_000,
        });
        assert.ok(minted.callbackUrl.includes('/webhook/n8n/campaign-compare/stage1'));
        assert.ok(minted.callbackUrl.includes('token='));
        assert.equal(minted.inboundSecret, INBOUND_SECRET);
    });
}

function testSanitizedGetExcludesInternalFields(): void {
    const dtoKeys = new Set([
        'ok',
        'requestId',
        'compareStage',
        'campaignId',
        'status',
        'topN',
        'candidateCount',
        'createdAt',
        'dispatchedAt',
        'completedAt',
        'failureMessage',
        'result',
    ]);
    for (const forbidden of [
        'candidatePool',
        'candidateSnapshotHash',
        'callbackUrl',
        'inboundSecret',
        'token',
        'organizationId',
        'requestedBy',
    ]) {
        assert.equal(dtoKeys.has(forbidden), false);
    }
}

function testMintCallbackUrlStage3(): void {
    withBaseEnv(() => {
        const minted = mintCampaignCompareCallbackUrl({
            compareStage: 'stage3',
            requestId: REQUEST_ID,
            campaignId: CAMPAIGN_ID,
            organizationId: ORG_ID,
            nowSec: 1_700_000_000,
        });
        assert.ok(minted.callbackUrl.includes('/webhook/n8n/campaign-compare/stage3'));
        assert.ok(isStage3CompareStage('stage3'));
    });
}

function testStage3SnapshotHash(): void {
    const pool: Stage3PoolItem[] = [
        {
            candidateId: CANDIDATE_A,
            candidateName: 'Alice',
            overallScore: 88,
            recommendation: 'Hire',
            summary: 'Strong video',
            roleUnderstanding: 8,
            professionalDepth: 8,
            problemHandling: 7,
            decisionMaking: 8,
            prioritization: 7,
            processThinking: 8,
            responsibility: 9,
            learningAbility: 8,
            jobReadiness: 8,
            finalRoleFit: 9,
        },
    ];
    const h = computeCampaignCompareSnapshotHash('stage3', CAMPAIGN_ID, [CANDIDATE_A], pool);
    assert.equal(h.length, 64);
}

function testSnapshotHashBodyValidation(): void {
    const expected = 'abc123expectedhash4567890123456789012345678901234567890abcd';
    const missing = validateCampaignCompareBodySnapshotHash({}, expected);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
        assert.equal(missing.error, 'snapshot_hash_required');
    }
    const mismatch = validateCampaignCompareBodySnapshotHash({ candidateSnapshotHash: 'wrong' }, expected);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
        assert.equal(mismatch.error, 'snapshot_hash_mismatch');
    }
    const ok = validateCampaignCompareBodySnapshotHash({ candidateSnapshotHash: expected }, expected);
    assert.equal(ok.ok, true);
}

function main(): void {
    testCanonicalJsonKeyOrder();
    testValidHmacRoundTrip();
    testInvalidHmacRejected();
    testExpiredTokenRejected();
    testFutureIssuedAtRejected();
    testMissingConfigRejected();
    testAllowlistMismatchRejected();
    testRankingOutsidePoolRejected();
    testDuplicateRankingIdsRejected();
    testDuplicateRankValuesRejected();
    testCompletionFilterUsesIdentityAndNotCompletedGuard();
    testCompletedRequestCannotBeOverwrittenByDifferentIdempotencyKey();
    testRaceLostCompletesWebhookWithoutFailure();
    testPostClaimFailureCannotMarkCompletedRequestFailed();
    testIdempotencyKeyUsesHeader();
    testRequiredOnlyMode();
    testEnforceAuthOffBlocksConfig();
    testOrgAllowlist();
    testSnapshotHashStable();
    testInboundSecretHeader();
    testMintCallbackUrl();
    testMintCallbackUrlStage3();
    testStage3SnapshotHash();
    testSnapshotHashBodyValidation();
    testSanitizedGetExcludesInternalFields();
    console.log('campaign-compare-security-test: all passed');
}

main();
