/**
 * Stage 3 inbound security + evaluation gate (offline, no DB/network/n8n).
 * Run: npm run test:stage3-inbound
 */
import assert from 'node:assert/strict';
import type { Response } from 'express';
import {
    buildCanonicalSigningPayload,
    computeStageHmacToken,
    STAGE_CALLBACK_TOKEN_TTL_SEC,
} from '../services/stageCallbackAuth.js';
import {
    formatStage3EvaluationGateDiagnostic,
    getStage3EvaluationGateMode,
    shouldBlockStage3IncompleteEvaluation,
    STAGE3_INCOMPLETE_EVALUATION_ERROR,
    validateStage3VideoEvaluationPersistence,
} from '../services/stage3VideoEvaluationGate.js';
import {
    postStageN8nInbound,
    setStageN8nInboundTestOverrides,
    type StageN8nIngressRequest,
} from '../services/stageN8nInbound.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const OTHER_CANDIDATE_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = 'video-sess-inbound-test-001';
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
    return { query: q, headers, body, files: [] } as unknown as StageN8nIngressRequest;
}

function buildSecureQuery(candidateId: string, sessionId: string, tokenOverride?: string, nowSec = currentNowSec()) {
    const payload = buildCanonicalSigningPayload({
        mode: 'stage3',
        candidateId,
        sessionId,
        campaignId: '',
        issuedAt: nowSec,
        expiresAt: nowSec + STAGE_CALLBACK_TOKEN_TTL_SEC,
    });
    const token = tokenOverride ?? computeStageHmacToken(payload, SIGNING_SECRET);
    return {
        candidateId,
        mode: 'stage3',
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
        get statusCode() { return state.statusCode; },
        set statusCode(code: number) { state.statusCode = code; },
        get headersSent() { return state.sent; },
        get body() { return state.body; },
        status(code: number) { state.statusCode = code; return this; },
        json(payload: unknown) { state.body = payload; state.sent = true; return this; },
    } as unknown as Response & { statusCode: number; body: unknown };
}

const REQUIRED_ENV = {
    STAGE_CALLBACK_SECURITY_MODE: 'required',
    N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
    STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
    STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
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

function buildStage3PatchFromBody(data: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const keys = [
        'role_understanding', 'professional_depth', 'problem_handling', 'decision_making',
        'prioritization', 'process_thinking', 'responsibility', 'learning_ability',
        'job_readiness', 'final_role_fit', 'summary', 'overall_score', 'recommendation',
    ] as const;
    for (const k of keys) {
        if (data[k] !== undefined) patch[k] = data[k];
    }
    return patch;
}

function completeStage3VideoBody(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        id: CANDIDATE_ID,
        sessionId: SESSION_ID,
        evaluationSource: 'video',
        ingress: 'stage3',
        role_understanding: 8,
        professional_depth: 7,
        problem_handling: 8,
        decision_making: 7,
        prioritization: 6,
        process_thinking: 7,
        responsibility: 8,
        learning_ability: 7,
        job_readiness: 8,
        final_role_fit: 7,
        summary: 'Strong candidate with relevant experience.',
        overall_score: 76,
        recommendation: 'Consider',
        ...extra,
    };
}

async function stage3ProcessWithEvalGate(
    req: StageN8nIngressRequest,
    res: Response,
    persistenceFlag: { reached: boolean },
    diagnostics: string[]
): Promise<void> {
    const dataRec = (req.body || {}) as Record<string, unknown>;
    const patch = buildStage3PatchFromBody(dataRec);
    const gateMode = getStage3EvaluationGateMode();
    const gate = validateStage3VideoEvaluationPersistence(dataRec, patch);
    if (!gate.ok) {
        diagnostics.push(
            formatStage3EvaluationGateDiagnostic({
                mode: gateMode,
                gateResult: 'incomplete',
                issues: gate.issues,
                candidateRef: CANDIDATE_ID.slice(0, 4) + '****' + CANDIDATE_ID.slice(-4),
            })
        );
        if (shouldBlockStage3IncompleteEvaluation(gateMode, gate)) {
            res.status(400).json({
                success: false,
                error: gate.error,
                message: gate.message,
            });
            return;
        }
    }
    persistenceFlag.reached = true;
    res.status(200).json({ success: true, ingress: 'stage3' });
}

async function main(): Promise<void> {
    await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, completeStage3VideoBody());
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];
        await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
            await stage3ProcessWithEvalGate(r, response, persistence, diagnostics);
        });
        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
    });
    console.log('✓ required secure Stage 3 callback accepted');

    await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, '');
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, { id: CANDIDATE_ID, sessionId: '', evaluationSource: 'video' });
        const res = mockRes();
        const persistence = { reached: false };
        await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
            await stage3ProcessWithEvalGate(r, response, persistence, []);
        });
        assert.equal(res.statusCode, 400);
        assert.equal(persistence.reached, false);
    });
    console.log('✓ empty sessionId rejected');

    await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: 'observe' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const req = mockReq(query, { 'x-n8n-stage-secret': 'wrong' }, completeStage3VideoBody());
        const res = mockRes();
        const persistence = { reached: false };
        await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
            await stage3ProcessWithEvalGate(r, response, persistence, []);
        });
        assert.equal(res.statusCode, 401);
    });
    console.log('✓ wrong inbound secret rejected');

    await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: undefined }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'video', ingress: 'stage3', summary: 'partial' };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        const diagnostics: string[] = [];
        await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
            await stage3ProcessWithEvalGate(r, response, persistence, diagnostics);
        });
        assert.equal(getStage3EvaluationGateMode(), 'observe');
        assert.equal(res.statusCode, 200);
        assert.equal(persistence.reached, true);
        assert.equal(diagnostics.length, 1);
    });
    console.log('✓ unset gate mode → observe; incomplete persisted');

    await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: 'enforce' }, async () => {
        installInboundMocks();
        const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
        const body = { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'video', ingress: 'stage3', summary: 'partial' };
        const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
        const res = mockRes();
        const persistence = { reached: false };
        await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
            await stage3ProcessWithEvalGate(r, response, persistence, []);
        });
        assert.equal(res.statusCode, 400);
        assert.equal((res.body as { error?: string }).error, STAGE3_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(persistence.reached, false);
    });
    console.log('✓ enforce mode → STAGE3_INCOMPLETE_EVALUATION');

    for (const mode of ['observe', 'enforce'] as const) {
        await withEnv({ ...REQUIRED_ENV, STAGE3_EVALUATION_GATE_MODE: mode }, async () => {
            installInboundMocks();
            const query = buildSecureQuery(CANDIDATE_ID, SESSION_ID);
            const body = { id: CANDIDATE_ID, sessionId: SESSION_ID, evaluationSource: 'video', ingress: 'stage3-reject', rejectCode: 'spam' };
            const req = mockReq(query, { 'x-n8n-stage-secret': INBOUND_SECRET }, body);
            const res = mockRes();
            const persistence = { reached: false };
            await postStageN8nInbound(req, res, 'stage3', async (r, response) => {
                await stage3ProcessWithEvalGate(r, response, persistence, []);
            });
            assert.equal(res.statusCode, 200, `mode=${mode}`);
            assert.equal(persistence.reached, true, `mode=${mode}`);
        });
    }
    console.log('✓ reject/spam allowed in both modes');

    setStageN8nInboundTestOverrides(null);
    console.log('\nstage3-inbound-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
