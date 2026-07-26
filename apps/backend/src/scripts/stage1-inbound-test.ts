/**
 * Stage 1 inbound security + evaluation gate (offline, no DB/network/n8n).
 * Run: npm run test:stage1-inbound
 */
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
    buildCanonicalSigningPayload,
    computeStageHmacToken,
    mintStageCallbackUrl,
    STAGE_CALLBACK_TOKEN_TTL_SEC,
} from '../services/stageCallbackAuth.js';
import {
    STAGE1_INCOMPLETE_EVALUATION_ERROR,
    validateStage1WrittenEvaluationPersistence,
} from '../services/stage1WrittenEvaluationGate.js';
import {
    evaluateStage1InboundSecurityPrecheck,
    postStageN8nInbound,
    setStageN8nInboundTestOverrides,
    type StageN8nIngressRequest,
} from '../services/stageN8nInbound.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const OTHER_CANDIDATE_ID = '507f1f77bcf86cd799439012';
const INBOUND_SECRET = 'test-inbound-secret-32-bytes-min!!!';
const SIGNING_SECRET = 'test-signing-secret-32-bytes-min!!';

function currentNowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        const val = overrides[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    return Promise.resolve(fn()).finally(() => {
        for (const key of Object.keys(overrides)) {
            const val = prev[key];
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });
}

function mockReq(
    query: Record<string, string | undefined>,
    headers: Record<string, string | undefined>,
    body: Record<string, unknown>
): StageN8nIngressRequest {
    const q: Record<string, string> = {};
    for (const [key, val] of Object.entries(query)) {
        if (val !== undefined) q[key] = val;
    }
    return {
        query: q,
        headers,
        body,
        files: [],
    } as unknown as StageN8nIngressRequest;
}

function buildSecureQuery(candidateId: string, tokenOverride?: string, nowSec = currentNowSec()) {
    const payload = buildCanonicalSigningPayload({
        mode: 'stage1',
        candidateId,
        sessionId: '',
        campaignId: '',
        issuedAt: nowSec,
        expiresAt: nowSec + STAGE_CALLBACK_TOKEN_TTL_SEC,
    });
    const token = tokenOverride ?? computeStageHmacToken(payload, SIGNING_SECRET);
    return {
        candidateId,
        mode: 'stage1',
        sessionId: '',
        campaignId: '',
        issuedAt: String(nowSec),
        expiresAt: String(nowSec + STAGE_CALLBACK_TOKEN_TTL_SEC),
        token,
    };
}

function mockRes(): Response & { statusCode: number; body: unknown } {
    const state = { statusCode: 200, body: undefined as unknown, sent: false };
    return {
        get statusCode() {
            return state.statusCode;
        },
        set statusCode(code: number) {
            state.statusCode = code;
        },
        get headersSent() {
            return state.sent;
        },
        get body() {
            return state.body;
        },
        status(code: number) {
            state.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            state.body = payload;
            state.sent = true;
            return this;
        },
    } as unknown as Response & { statusCode: number; body: unknown };
}

const REQUIRED_ENV = {
    STAGE_CALLBACK_SECURITY_MODE: 'required',
    N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
    STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
    STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
    PUBLIC_API_URL: 'http://localhost:5000',
} as const;

const OPTIONAL_ENV = {
    STAGE_CALLBACK_SECURITY_MODE: 'optional',
    N8N_STAGE_INBOUND_SECRET: undefined,
    STAGE_CALLBACK_SIGNING_SECRET: undefined,
    STAGE_CALLBACK_ALLOWLIST: undefined,
    PUBLIC_API_URL: 'http://localhost:5000',
} as const;

function installInboundMocks() {
    setStageN8nInboundTestOverrides({
        findCandidateById: async () => ({ _id: CANDIDATE_ID, campaignId: '' }),
        claimWebhookFn: async () => ({ duplicate: false, record: null }),
        completeWebhookFn: async () => undefined,
        failWebhookFn: async () => undefined,
    });
}

/** Mirrors server.ts Stage 1 persistence gate before the persistence stub runs. */
async function stage1ProcessWithEvalGate(
    req: StageN8nIngressRequest,
    res: Response,
    persistenceFlag: { reached: boolean }
): Promise<void> {
    const dataRec = (req.body || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (dataRec.strengths !== undefined) patch.strengths = dataRec.strengths;
    if (dataRec.weaknesses !== undefined) patch.weaknesses = dataRec.weaknesses;
    if (dataRec.overall_score !== undefined) patch.overall_score = dataRec.overall_score;
    if (dataRec.recommendation !== undefined) patch.recommendation = dataRec.recommendation;
    if (dataRec.summary !== undefined) patch.summary = dataRec.summary;
    const fitForRole =
        dataRec.fit_for_role ??
        dataRec.fitForRole ??
        dataRec['Fit for the role'] ??
        dataRec['Fit for Role'];
    if (fitForRole !== undefined) patch.fit_for_role = fitForRole;
    const finalHr =
        dataRec.final_hr_evaluation ??
        dataRec.finalHrEvaluation ??
        dataRec['Final HR Evaluation'];
    if (finalHr !== undefined) patch.final_hr_evaluation = finalHr;

    const gate = validateStage1WrittenEvaluationPersistence(dataRec, patch);
    if (!gate.ok) {
        res.status(400).json({
            success: false,
            error: gate.error,
            message: gate.message,
        });
        return;
    }
    persistenceFlag.reached = true;
    res.status(200).json({ success: true });
}

async function testRequiredValidSecureAccepted(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const body = {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
            overall_score: 72,
            recommendation: 'Consider',
            final_hr_evaluation:
                'Recommend proceeding to voice screening; confirm HR certification and stakeholder management examples.',
            summary: 'Experienced candidate with relevant background for the role.',
            fit_for_role: 'Good fit for the target position based on experience and skills.',
            strengths: ['Clear communication'],
            weaknesses: ['Limited depth'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
}

async function testRequiredWrongInboundSecretRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': 'wrong-secret' },
            { id: CANDIDATE_ID, evaluationSource: 'written' }
        );
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredInvalidHmacRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, 'not-a-valid-hmac-token');
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: CANDIDATE_ID, evaluationSource: 'written' }
        );
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredExpiredHmacRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const nowSec = currentNowSec();
        const expiredIssued = nowSec - 200_000;
        const expiredAt = nowSec - 100_000;
        const payload = buildCanonicalSigningPayload({
            mode: 'stage1',
            candidateId: CANDIDATE_ID,
            sessionId: '',
            campaignId: '',
            issuedAt: expiredIssued,
            expiresAt: expiredAt,
        });
        const token = computeStageHmacToken(payload, SIGNING_SECRET);
        const query = {
            candidateId: CANDIDATE_ID,
            mode: 'stage1',
            sessionId: '',
            campaignId: '',
            issuedAt: String(expiredIssued),
            expiresAt: String(expiredAt),
            token,
        };
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: CANDIDATE_ID, evaluationSource: 'written' }
        );
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredCandidateMismatchRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: OTHER_CANDIDATE_ID, evaluationSource: 'written' }
        );
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testIncompleteEvaluationBlocked(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const body = {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
            ingress: 'stage1',
            strengths: ['A'],
            weaknesses: ['B'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 400);
        const payload = res.body as { error?: string; message?: string };
        assert.equal(payload.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(persistence.reached, false);
    });
}

async function testCompleteEvaluationAccepted(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const body = {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
            ingress: 'stage1',
            overall_score: 78,
            recommendation: 'Consider',
            final_hr_evaluation:
                'Move to Stage 2; validate HR BP depth and English fluency during voice interview.',
            fit_for_role: 'Strong alignment with the campaign role requirements.',
            strengths: ['Strong fit'],
            weaknesses: ['Needs mentoring'],
            summary: 'Solid overall.',
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
}

async function testRejectSpamPathAllowed(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID);
        const body = {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
            ingress: 'stage1-reject',
            rejectCode: 'duplicate',
            strengths: ['N/A'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
}

async function testOptionalLegacyBehavior(): Promise<void> {
    await withEnv({ ...OPTIONAL_ENV }, async () => {
        installInboundMocks();
        const body = {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
            overall_score: 65,
            recommendation: 'Hire',
            final_hr_evaluation: 'Strong written-screen fit; proceed to scheduling.',
            summary: 'Solid written application with relevant experience.',
            fit_for_role: 'Meets core role requirements.',
            strengths: ['A'],
            weaknesses: ['B'],
        };
        const req = mockReq({}, {}, body);
        const precheck = evaluateStage1InboundSecurityPrecheck(req);
        assert.equal(precheck.ok, true);
        if (precheck.ok) assert.equal(precheck.callbackClass, 'legacy');

        const res = mockRes();
        const persistence = { reached: false };

        await postStageN8nInbound(req, res, 'stage1', async (r, response) => {
            await stage1ProcessWithEvalGate(r, response, persistence);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
}

async function testOptionalRequiredUnsignedRejected(): Promise<void> {
    await withEnv(
        {
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
        },
        () => {
            const req = mockReq({}, {}, { id: CANDIDATE_ID, evaluationSource: 'written' });
            const precheck = evaluateStage1InboundSecurityPrecheck(req);
            assert.equal(precheck.ok, false);
            if (!precheck.ok) {
                assert.equal(precheck.status, 401);
                assert.equal(precheck.errorCategory, 'unsigned_required_mode');
            }
        }
    );
}

async function testMintedUrlMatchesSecureIngress(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV }, () => {
        const nowSec = currentNowSec();
        const minted = mintStageCallbackUrl({
            mode: 'stage1',
            candidateId: CANDIDATE_ID,
            nowSec,
        });
        const url = new URL(minted.callbackUrl);
        const query = Object.fromEntries(url.searchParams.entries());
        const req = mockReq(query, { 'x-n8n-stage-secret': minted.inboundSecret }, {
            id: CANDIDATE_ID,
            evaluationSource: 'written',
        });
        const precheck = evaluateStage1InboundSecurityPrecheck(req);
        assert.equal(precheck.ok, true);
        if (precheck.ok) assert.equal(precheck.callbackClass, 'secure_complete');
    });
}

async function main(): Promise<void> {
    try {
        await testRequiredValidSecureAccepted();
        console.log('✓ required + valid signed callback → accepted, persistence stub reached');

        await testRequiredWrongInboundSecretRejected();
        console.log('✓ required + wrong inbound secret → rejected');

        await testRequiredInvalidHmacRejected();
        console.log('✓ required + invalid HMAC → rejected');

        await testRequiredExpiredHmacRejected();
        console.log('✓ required + expired HMAC → rejected');

        await testRequiredCandidateMismatchRejected();
        console.log('✓ required + candidate mismatch → rejected');

        await testIncompleteEvaluationBlocked();
        console.log('✓ incomplete normal evaluation → 400 STAGE1_INCOMPLETE_EVALUATION');

        await testCompleteEvaluationAccepted();
        console.log('✓ complete evaluation → accepted');

        await testRejectSpamPathAllowed();
        console.log('✓ reject/spam path → allowed without full score');

        await testOptionalLegacyBehavior();
        console.log('✓ optional mode → legacy unsigned callback accepted');

        await testOptionalRequiredUnsignedRejected();
        console.log('✓ required mode rejects unsigned legacy precheck');

        await testMintedUrlMatchesSecureIngress();
        console.log('✓ minted callbackUrl classifies as secure_complete');

        console.log('\nstage1-inbound-test: all passed');
    } finally {
        setStageN8nInboundTestOverrides(null);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
