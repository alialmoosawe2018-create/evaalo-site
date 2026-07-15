/**
 * Narrow self-tests for stage callback HMAC + classification.
 * Run: npx tsx src/scripts/stage-callback-auth-test.ts
 */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import {
    appendStageOutboundFields,
    buildCanonicalSigningPayload,
    classifyStageCallback,
    computeStageHmacToken,
    getStageCallbackSecurityMode,
    hasCompleteSecureQueryBundle,
    hasQueryKey,
    hasStageSecurityMarkers,
    isEitherStageSecretConfigured,
    isRequiredModeUnsignedRejection,
    mintStageCallbackUrl,
    parseStageQueryClaims,
    secureSessionIdSatisfied,
    serializeSigningPayload,
    STAGE_CALLBACK_TOKEN_TTL_SEC,
    tryBuildStageOutboundBundle,
    validateStageTimestamps,
    verifyInboundStageSecret,
    verifyStageHmacToken,
    bodyIdentityConflictsWithClaims,
    StageCallbackConfigurationError,
    assertStageOutboundSecurityForTrigger,
    assertStageSecureMintConfiguration,
} from '../services/stageCallbackAuth.js';
import { buildN8nStageIdempotencyKey } from '../services/webhookIdempotency.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const SIGNING_SECRET = 'test-signing-secret-32-bytes-min!!';
const INBOUND_SECRET = 'test-inbound-secret-32-bytes-min!!!';

function mockReq(
    query: Record<string, string | undefined>,
    headers: Record<string, string | undefined> = {}
): Request {
    const q: Record<string, string> = {};
    for (const [key, val] of Object.entries(query)) {
        if (val !== undefined) q[key] = val;
    }
    return {
        query: q,
        headers,
        body: {},
    } as unknown as Request;
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

function testCanonicalJsonKeyOrder(): void {
    const payload = buildCanonicalSigningPayload({
        mode: 'stage1',
        candidateId: CANDIDATE_ID,
        sessionId: '',
        campaignId: 'camp-1',
        issuedAt: 1000,
        expiresAt: 1000 + STAGE_CALLBACK_TOKEN_TTL_SEC,
    });
    const serialized = serializeSigningPayload(payload);
    assert.equal(
        serialized,
        '{"v":1,"mode":"stage1","candidateId":"507f1f77bcf86cd799439011","sessionId":"","campaignId":"camp-1","issuedAt":1000,"expiresAt":87400}'
    );
}

function testValidHmacRoundTrip(): void {
    const claims = {
        candidateId: CANDIDATE_ID,
        mode: 'stage2' as const,
        sessionId: 'sess-abc',
        campaignId: 'camp-1',
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_000 + STAGE_CALLBACK_TOKEN_TTL_SEC,
        token: '',
    };
    const payload = buildCanonicalSigningPayload(claims);
    claims.token = computeStageHmacToken(payload, SIGNING_SECRET);
    const result = verifyStageHmacToken(claims, SIGNING_SECRET);
    assert.equal(result.ok, true);
}

function testInvalidHmacRejected(): void {
    const claims = {
        candidateId: CANDIDATE_ID,
        mode: 'stage1' as const,
        sessionId: '',
        campaignId: '',
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_000 + STAGE_CALLBACK_TOKEN_TTL_SEC,
        token: 'invalid-token',
    };
    const result = verifyStageHmacToken(claims, SIGNING_SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCategory, 'hmac_invalid');
}

function testExpiredTimestampRejected(): void {
    const now = Math.floor(Date.now() / 1000);
    const result = validateStageTimestamps(now - 100_000, now - 50_000, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCategory, 'expired');
}

function testLegacyClassification(): void {
    const req = mockReq({});
    assert.equal(classifyStageCallback(req), 'legacy');
    assert.equal(hasStageSecurityMarkers(req), false);
}

function testPartialSecureRejectedClassification(): void {
    const req = mockReq({ token: '' });
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testCandidateIdQueryKeyOnlyPartialSecure(): void {
    const req = mockReq({ candidateId: '' });
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testSessionIdQueryKeyOnlyPartialSecure(): void {
    const req = mockReq({ sessionId: '' });
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testCampaignIdQueryKeyOnlyPartialSecure(): void {
    const req = mockReq({ campaignId: '' });
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testPresentButEmptySessionIdVersusMissing(): void {
    const missing = mockReq({
        candidateId: CANDIDATE_ID,
        mode: 'stage1',
        campaignId: '',
        issuedAt: '1',
        expiresAt: '2',
        token: 'x',
    });
    assert.equal(hasQueryKey(missing, 'sessionId'), false);
    assert.equal(parseStageQueryClaims(missing), null);
    assert.equal(classifyStageCallback(missing), 'partial_secure');

    const emptyPresent = mockReq({
        candidateId: CANDIDATE_ID,
        mode: 'stage1',
        sessionId: '',
        campaignId: '',
        issuedAt: '1',
        expiresAt: '2',
        token: 'x',
    });
    assert.equal(hasQueryKey(emptyPresent, 'sessionId'), true);
    assert.ok(parseStageQueryClaims(emptyPresent));
}

function testPresentButEmptyCampaignIdVersusMissing(): void {
    const missing = mockReq({
        candidateId: CANDIDATE_ID,
        mode: 'stage1',
        sessionId: '',
        issuedAt: '1',
        expiresAt: '2',
        token: 'x',
    });
    assert.equal(hasQueryKey(missing, 'campaignId'), false);
    assert.equal(classifyStageCallback(missing), 'partial_secure');

    const emptyPresent = mockReq({
        candidateId: CANDIDATE_ID,
        mode: 'stage1',
        sessionId: '',
        campaignId: '',
        issuedAt: '1',
        expiresAt: '2',
        token: 'x',
    });
    assert.equal(hasQueryKey(emptyPresent, 'campaignId'), true);
}

function testEmptyTokenPartialSecure(): void {
    const req = mockReq({
        candidateId: CANDIDATE_ID,
        mode: 'stage1',
        sessionId: '',
        campaignId: '',
        issuedAt: '1',
        expiresAt: '2',
        token: '',
    });
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testSecureStage2EmptySessionIdRejected(): void {
    assert.equal(secureSessionIdSatisfied('stage2', ''), false);
}

function testSecureStage3EmptySessionIdRejected(): void {
    assert.equal(secureSessionIdSatisfied('stage3', ''), false);
}

function testRequiredUnsignedInboundRejected(): void {
    withEnv({ STAGE_CALLBACK_SECURITY_MODE: 'required' }, () => {
        const req = mockReq({});
        assert.equal(classifyStageCallback(req), 'legacy');
        assert.equal(isRequiredModeUnsignedRejection(classifyStageCallback(req)), true);
    });
}

function testBothSecretsEmptyAllowlistMintRejected(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: '',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        () => {
            assert.throws(
                () =>
                    tryBuildStageOutboundBundle('stage1', {
                        candidateId: CANDIDATE_ID,
                        sessionId: '',
                        campaignId: '',
                    }),
                StageCallbackConfigurationError
            );
        }
    );
}

function testOneSecretOnlyNoPartialBundle(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        () => {
            assert.equal(isEitherStageSecretConfigured(), true);
            assert.throws(
                () =>
                    tryBuildStageOutboundBundle('stage1', {
                        candidateId: CANDIDATE_ID,
                    }),
                StageCallbackConfigurationError
            );
        }
    );
}

function testEmptyInboundSecretHeaderIsMarker(): void {
    const req = mockReq({}, { 'x-n8n-stage-secret': '' });
    assert.equal(hasStageSecurityMarkers(req), true);
    assert.equal(classifyStageCallback(req), 'partial_secure');
}

function testRequiredUnsignedThrowsOnOutbound(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
        },
        () => {
            assert.throws(() => assertStageOutboundSecurityForTrigger(), StageCallbackConfigurationError);
        }
    );
}

function testOptionalLegacyOutboundNoBundle(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        () => {
            const bundle = tryBuildStageOutboundBundle('stage1', {
                candidateId: CANDIDATE_ID,
                sessionId: '',
                campaignId: '',
            });
            assert.equal(bundle, null);
        }
    );
}

function testOptionalSecureOutboundBundle(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        () => {
            const bundle = tryBuildStageOutboundBundle('stage3', {
                candidateId: CANDIDATE_ID,
                sessionId: 'video-sess',
                campaignId: 'camp-9',
            });
            assert.ok(bundle);
            assert.ok(bundle!.callbackUrl.includes('/webhook/n8n/stage3?'));
            assert.ok(bundle!.callbackUrl.includes('token='));
            assert.equal(bundle!.inboundSecret, INBOUND_SECRET);
        }
    );
}

function testAppendStageOutboundFields(): void {
    const payload: Record<string, unknown> = { id: CANDIDATE_ID };
    appendStageOutboundFields(payload, null);
    assert.equal(payload.callbackUrl, undefined);
    assert.equal(payload.inboundSecret, undefined);

    appendStageOutboundFields(payload, {
        callbackUrl: 'http://localhost:5000/webhook/n8n/stage1?token=abc',
        inboundSecret: INBOUND_SECRET,
    });
    assert.equal(payload.callbackUrl, 'http://localhost:5000/webhook/n8n/stage1?token=abc');
    assert.equal(payload.inboundSecret, INBOUND_SECRET);
}

function testVerifyInboundStageSecret(): void {
    withEnv({ N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET }, () => {
        const ok = mockReq({}, { 'x-n8n-stage-secret': INBOUND_SECRET });
        assert.equal(verifyInboundStageSecret(ok), true);

        const bad = mockReq({}, { 'x-n8n-stage-secret': 'wrong-secret' });
        assert.equal(verifyInboundStageSecret(bad), false);

        const missing = mockReq({});
        assert.equal(verifyInboundStageSecret(missing), false);
    });
}

function testBodyCandidateIdMismatch(): void {
    const claims = {
        candidateId: CANDIDATE_ID,
        mode: 'stage1' as const,
        sessionId: '',
        campaignId: '',
        issuedAt: 1,
        expiresAt: 2,
        token: 'x',
    };
    const body = { id: '507f1f77bcf86cd799439012' };
    const result = bodyIdentityConflictsWithClaims(body, claims);
    assert.equal(result.ok, false);
}

function testAliasCanonicalSameIdempotencyKey(): void {
    const body = { evaluationSource: 'voice', overall_score: 80 };
    const reqA = { headers: {}, body } as unknown as Request;
    const reqB = { headers: {}, body } as unknown as Request;
    const keyNoSession = buildN8nStageIdempotencyKey(reqA, 'stage2', CANDIDATE_ID);
    const keyWithSession = buildN8nStageIdempotencyKey(reqA, 'stage2', CANDIDATE_ID, 'sess-a');
    assert.notEqual(keyNoSession, keyWithSession, 'stage2 must include sessionId in hash fallback');
    const keyB = buildN8nStageIdempotencyKey(reqB, 'stage2', CANDIDATE_ID, 'sess-a');
    assert.equal(keyWithSession, keyB);

    const videoBody = { evaluationSource: 'video', overall_score: 70 };
    const reqVideo = { headers: {}, body: videoBody } as unknown as Request;
    const stage3NoSession = buildN8nStageIdempotencyKey(reqVideo, 'stage3', CANDIDATE_ID);
    const stage3WithSession = buildN8nStageIdempotencyKey(reqVideo, 'stage3', CANDIDATE_ID, 'vid-sess-1');
    assert.notEqual(stage3NoSession, stage3WithSession, 'stage3 must include sessionId in hash fallback');
}

function testMintExpiryIs24Hours(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        () => {
            const minted = mintStageCallbackUrl({
                mode: 'stage1',
                candidateId: CANDIDATE_ID,
                nowSec: 1_000_000,
            });
            assert.equal(minted.expiresAt - minted.issuedAt, STAGE_CALLBACK_TOKEN_TTL_SEC);
            assert.equal(STAGE_CALLBACK_TOKEN_TTL_SEC, 86400);
        }
    );
}

function testDefaultSecurityModeOptional(): void {
    withEnv({ STAGE_CALLBACK_SECURITY_MODE: undefined }, () => {
        assert.equal(getStageCallbackSecurityMode(), 'optional');
    });
}

function testAssertStageSecureMintConfigurationOptionalNoSecrets(): void {
    withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
        },
        () => {
            assert.doesNotThrow(() => assertStageSecureMintConfiguration());
        }
    );
}

const tests = [
    testCanonicalJsonKeyOrder,
    testValidHmacRoundTrip,
    testInvalidHmacRejected,
    testExpiredTimestampRejected,
    testLegacyClassification,
    testPartialSecureRejectedClassification,
    testCandidateIdQueryKeyOnlyPartialSecure,
    testSessionIdQueryKeyOnlyPartialSecure,
    testCampaignIdQueryKeyOnlyPartialSecure,
    testPresentButEmptySessionIdVersusMissing,
    testPresentButEmptyCampaignIdVersusMissing,
    testEmptyTokenPartialSecure,
    testSecureStage2EmptySessionIdRejected,
    testSecureStage3EmptySessionIdRejected,
    testRequiredUnsignedInboundRejected,
    testBothSecretsEmptyAllowlistMintRejected,
    testOneSecretOnlyNoPartialBundle,
    testEmptyInboundSecretHeaderIsMarker,
    testRequiredUnsignedThrowsOnOutbound,
    testOptionalLegacyOutboundNoBundle,
    testOptionalSecureOutboundBundle,
    testAppendStageOutboundFields,
    testVerifyInboundStageSecret,
    testBodyCandidateIdMismatch,
    testAliasCanonicalSameIdempotencyKey,
    testMintExpiryIs24Hours,
    testDefaultSecurityModeOptional,
    testAssertStageSecureMintConfigurationOptionalNoSecrets,
];

let failed = 0;
for (const t of tests) {
    try {
        t();
        console.log(`✓ ${t.name}`);
    } catch (err) {
        failed += 1;
        console.error(`✗ ${t.name}`, err);
    }
}

if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
}

console.log(`\nAll ${tests.length} stage callback auth tests passed.`);
