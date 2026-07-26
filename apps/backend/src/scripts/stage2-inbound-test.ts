/**
 * Stage 2 inbound security + evaluation gate (offline, no DB/network/n8n).
 * Run: npm run test:stage2-inbound
 */
import assert from 'node:assert/strict';
import type { Response } from 'express';
import {
    buildCanonicalSigningPayload,
    computeStageHmacToken,
    STAGE_CALLBACK_TOKEN_TTL_SEC,
} from '../services/stageCallbackAuth.js';
import {
    formatStage2EvaluationGateDiagnostic,
    getStage2EvaluationGateMode,
    shouldBlockStage2IncompleteEvaluation,
    STAGE2_INCOMPLETE_EVALUATION_ERROR,
    validateStage2VoiceEvaluationPersistence,
} from '../services/stage2VoiceEvaluationGate.js';
import {
    postStageN8nInbound,
    setStageN8nInboundTestOverrides,
    type StageN8nIngressRequest,
} from '../services/stageN8nInbound.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const OTHER_CANDIDATE_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = 'voice-sess-inbound-test-001';
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

function buildSecureQuery(
    candidateId: string,
    sessionId: string,
    tokenOverride?: string,
    nowSec = currentNowSec()
) {
    const payload = buildCanonicalSigningPayload({
        mode: 'stage2',
        candidateId,
        sessionId,
        campaignId: '',
        issuedAt: nowSec,
        expiresAt: nowSec + STAGE_CALLBACK_TOKEN_TTL_SEC,
    });
    const token = tokenOverride ?? computeStageHmacToken(payload, SIGNING_SECRET);
    return {
        candidateId,
        mode: 'stage2',
        sessionId,
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

function buildStage2PatchFromBody(data: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const keys = [
        'communication',
        'language_fluency',
        'confidence',
        'problem_solving',
        'digital_skills',
        'professional_attitude',
        'summary',
        'strengths',
        'weaknesses',
        'final_hr_evaluation',
        'overall_score',
        'recommendation',
    ] as const;
    for (const k of keys) {
        if (data[k] !== undefined) patch[k] = data[k];
    }
    return patch;
}

function completeStage2VoiceBody(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        id: CANDIDATE_ID,
        sessionId: SESSION_ID,
        evaluationSource: 'voice',
        ingress: 'stage2',
        communication: 'Good',
        language_fluency: 'Intermediate',
        confidence: 'Good',
        problem_solving: 'Good',
        digital_skills: 'Excellent',
        professional_attitude:
            'The candidate remained polite, engaged, and professional throughout the interview.',
        summary: 'Strong communicator with relevant experience.',
        strengths: ['Clear communication'],
        weaknesses: ['Limited technical depth'],
        final_hr_evaluation: 'Recommend proceeding to video interview.',
        overall_score: 74,
        recommendation: 'Consider',
        ...extra,
    };
}

/** Mirrors server.ts Stage 2 persistence gate before the persistence stub runs. */
async function stage2ProcessWithEvalGate(
    req: StageN8nIngressRequest,
    res: Response,
    persistenceFlag: { reached: boolean },
    diagnostics: string[]
): Promise<void> {
    const dataRec = (req.body || {}) as Record<string, unknown>;
    const patch = buildStage2PatchFromBody(dataRec);
    const gateMode = getStage2EvaluationGateMode();
    const gate = validateStage2VoiceEvaluationPersistence(dataRec, patch);
    if (!gate.ok) {
        diagnostics.push(
            formatStage2EvaluationGateDiagnostic({
                mode: gateMode,
                gateResult: 'incomplete',
                issues: gate.issues,
                candidateRef: CANDIDATE_ID.slice(0, 4) + '****' + CANDIDATE_ID.slice(-4),
            })
        );
        if (shouldBlockStage2IncompleteEvaluation(gateMode, gate)) {
            res.status(400).json({
                success: false,
                error: gate.error,
                message: gate.message,
                issues: gate.issues,
            });
            return;
        }
    }
    persistenceFlag.reached = true;
    res.status(200).json({ success: true, ingress: 'stage2' });
}

async function testRequiredValidSecureAccepted(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = completeStage2VoiceBody();
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
        assert.equal((res.body as { ingress?: string }).ingress, 'stage2');
        assert.equal(diagnostics.length, 0);
    });
}

async function testRequiredEmptySessionIdRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, '');
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: CANDIDATE_ID, sessionId: '', evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 400);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredSessionMismatchRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: CANDIDATE_ID, sessionId: 'other-session', evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredWrongInboundSecretRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': 'wrong-secret' },
            { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredInvalidHmacRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID, 'not-a-valid-hmac-token');
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testRequiredCandidateMismatchRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const req = mockReq(
            query,
            { 'x-n8n-stage-secret': INBOUND_SECRET },
            { id: OTHER_CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function testOptionalLegacyAccepted(): Promise<void> {
    await withEnv({ ...OPTIONAL_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const req = mockReq({}, {}, completeStage2VoiceBody());
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
}

async function testUnsetGateModeEnforceIncompleteBlocked(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: undefined }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = {
            id: CANDIDATE_ID,
            sessionId: SESSION_ID,
            evaluationSource: 'voice',
            ingress: 'stage2',
            strengths: ['A'],
            weaknesses: ['B'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(getStage2EvaluationGateMode(), 'enforce');
        assert.equal(res.statusCode, 400);
        assert.equal(persistence.reached, false);
        assert.equal(diagnostics.length, 1);
        assert.match(diagnostics[0], /mode=enforce/);
        assert.match(diagnostics[0], /issues=/);
    });
}

async function testObserveModeIncompletePersistedWithDiagnostic(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = {
            id: CANDIDATE_ID,
            sessionId: SESSION_ID,
            evaluationSource: 'voice',
            ingress: 'stage2',
            strengths: ['A'],
            weaknesses: ['B'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
        assert.equal(diagnostics.length, 1);
        assert.match(diagnostics[0], /mode=observe/);
        assert.match(diagnostics[0], /result=incomplete/);
        assert.match(diagnostics[0], /issues=communication/);
    });
}

async function testEnforceModeIncompleteBlocked(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'enforce' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = {
            id: CANDIDATE_ID,
            sessionId: SESSION_ID,
            evaluationSource: 'voice',
            ingress: 'stage2',
            strengths: ['A'],
            weaknesses: ['B'],
        };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 400);
        const payload = res.body as { error?: string };
        assert.equal(payload.error, STAGE2_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(persistence.reached, false);
        assert.equal(diagnostics.length, 1);
        assert.match(diagnostics[0], /mode=enforce/);
    });
}

async function testCompleteEvaluationAcceptedInBothModes(): Promise<void> {
    for (const mode of ['observe', 'enforce'] as const) {
        await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: mode }, async () => {
            installInboundMocks();
            const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
            const req = mockReq(
                query,
                { 'x-n8n-stage-secret': INBOUND_SECRET },
                completeStage2VoiceBody({ recommendation: 'Hire', overall_score: 82 })
            );
            const res = mockRes();
            const persistence = { reached: false };
            const diagnostics: string[] = [];

            await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
                await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
            });

            assert.equal(res.statusCode, 200, `mode=${mode}`);
            assert.equal(persistence.reached, true, `mode=${mode}`);
            assert.equal(diagnostics.length, 0, `mode=${mode}`);
        });
    }
}

async function testRejectSpamPathAllowedInBothModes(): Promise<void> {
    for (const mode of ['observe', 'enforce'] as const) {
        await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: mode }, async () => {
            installInboundMocks();
            const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
            const body = {
                id: CANDIDATE_ID,
                sessionId: SESSION_ID,
                evaluationSource: 'voice',
                ingress: 'stage2-reject',
                rejectCode: 'duplicate',
                strengths: ['N/A'],
            };
            const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
            const res = mockRes();
            const persistence = { reached: false };
            const diagnostics: string[] = [];

            await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
                await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
            });

            assert.equal(res.statusCode, 200, `mode=${mode}`);
            assert.equal(persistence.reached, true, `mode=${mode}`);
            assert.equal(diagnostics.length, 0, `mode=${mode}`);
        });
    }
}

async function testRequiredUnsignedLegacyRejected(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE2_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const req = mockReq(
            {},
            {},
            { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'voice' }
        );
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];

        await postStageN8nInbound(req, res, 'stage2', async (r, response) => {
            await stage2ProcessWithEvalGate(r, response, persistence, diagnostics);
        });

        assert.equal(res.statusCode, 401);
        assert.equal(persistence.reached, false);
    });
}

async function main(): Promise<void> {
    await testRequiredValidSecureAccepted();
    console.log('✓ required secure Stage 2 callback accepted');

    await testRequiredEmptySessionIdRejected();
    console.log('✓ empty sessionId rejected for Stage 2 secure callback');

    await testRequiredSessionMismatchRejected();
    console.log('✓ sessionId body/query mismatch rejected');

    await testRequiredWrongInboundSecretRejected();
    console.log('✓ wrong inbound secret rejected');

    await testRequiredInvalidHmacRejected();
    console.log('✓ invalid HMAC rejected');

    await testRequiredCandidateMismatchRejected();
    console.log('✓ candidate mismatch rejected');

    await testUnsetGateModeEnforceIncompleteBlocked();
    console.log('✓ unset gate mode → enforce; incomplete callback blocked');

    await testObserveModeIncompletePersistedWithDiagnostic();
    console.log('✓ observe mode → incomplete persisted with safe diagnostic');

    await testEnforceModeIncompleteBlocked();
    console.log('✓ enforce mode → incomplete returns STAGE2_INCOMPLETE_EVALUATION');

    await testCompleteEvaluationAcceptedInBothModes();
    console.log('✓ complete evaluation accepted in observe and enforce modes');

    await testRejectSpamPathAllowedInBothModes();
    console.log('✓ reject/spam path allowed in observe and enforce modes');

    await testOptionalLegacyAccepted();
    console.log('✓ optional mode legacy callback accepted');

    await testRequiredUnsignedLegacyRejected();
    console.log('✓ required mode unsigned legacy rejected');

    setStageN8nInboundTestOverrides(null);
    console.log('\nstage2-inbound-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
