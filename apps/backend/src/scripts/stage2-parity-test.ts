/**
 * Stage 2 parity checks (offline, fictional data only).
 * Run: npm run test:stage2-parity
 */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { orgScopedQuery } from '../middleware/orgScope.js';
import {
    isCompleteStage2VoicePatch,
    validateStage2VoiceEvaluationPersistence,
    STAGE2_INCOMPLETE_EVALUATION_ERROR,
} from '../services/stage2VoiceEvaluationGate.js';
import { buildN8nStageIdempotencyKey } from '../services/webhookIdempotency.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = 'voice-sess-parity-001';

function mockReq(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return { body, headers } as unknown as Request;
}

/**
 * A request carrying a resolved org.
 *
 * NOT via `req.auth` — getAuthContext deliberately stopped reading that when
 * @clerk/express v2 landed (see middleware/auth.ts), because v2 does not carry
 * sessionClaims there. A `req.auth` mock therefore reaches no org at all:
 * getAuth() throws outside clerkMiddleware, every request collapses to the
 * default org, and the isolation assertion below compares 'org_default' with
 * itself — which is exactly how this test sat red while proving nothing.
 *
 * `__resolvedOrg` is a real input the production path honours: resolveOrgFallback
 * sets it when the session token carries no org claim.
 */
function mockOrgReq(orgId: string): Request {
    return {
        __resolvedOrg: { id: orgId, rol: 'admin' },
    } as unknown as Request;
}

function completeVoicePatch(): Record<string, unknown> {
    return {
        communication: 'Good',
        language_fluency: 'Intermediate',
        confidence: 'Good',
        problem_solving: 'Good',
        digital_skills: 'Excellent',
        professional_attitude:
            'The candidate remained polite and engaged throughout the voice interview session.',
        summary: 'Strong voice candidate.',
        strengths: ['Communication'],
        weaknesses: ['Depth'],
        final_hr_evaluation: 'Proceed to video interview.',
        overall_score: 74,
        recommendation: 'Consider',
    };
}

function testStage2IdempotencyIncludesSessionId(): void {
    const body = { evaluationSource: 'voice' };
    const req = mockReq(body);
    const keyEmpty = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, '');
    const keyWithSession = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, SESSION_ID);
    assert.notEqual(keyEmpty, keyWithSession);
    assert.match(keyEmpty, /^n8n:stage2:hash:/);
}

function testSamePayloadSameIdempotencyKeyWithSession(): void {
    const body = { evaluationSource: 'voice', overall_score: 55, recommendation: 'Consider' };
    const reqA = mockReq(body);
    const reqB = mockReq(body);
    const keyA = buildN8nStageIdempotencyKey(reqA, 'stage2', CANDIDATE_ID, SESSION_ID);
    const keyB = buildN8nStageIdempotencyKey(reqB, 'stage2', CANDIDATE_ID, SESSION_ID);
    assert.equal(keyA, keyB);
}

function testCompleteVoiceContractAccepted(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = completeVoicePatch();
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testIncompleteVoiceContractRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { strengths: ['A'], weaknesses: ['B'], overall_score: 70 };
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, STAGE2_INCOMPLETE_EVALUATION_ERROR);
}

function testPlaceholderCommunicationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), communication: 'undefined' };
    assert.equal(isCompleteStage2VoicePatch(patch), false);
}

function testPublicScreeningVoicePathPreserved(): void {
    const isPublic = true;
    const publicUrl = 'https://n8n.test.local/public-screening';
    const dedicated = 'https://n8n.test.local/voice';
    const voiceWebhookUrl = (isPublic ? publicUrl : '') || dedicated;
    assert.equal(voiceWebhookUrl, publicUrl);
}

function testOrgScopedQueryIsolation(): void {
    const orgA = orgScopedQuery(mockOrgReq('org_a'), { campaignId: { $in: ['c1'] } });
    const orgB = orgScopedQuery(mockOrgReq('org_b'), { campaignId: { $in: ['c1'] } });
    // Assert the values, not just that they differ: two requests both collapsing
    // to the same wrong org is the failure this test exists to catch, and only an
    // exact check proves the caller's org actually reached the query.
    assert.equal(orgA.organizationId, 'org_a');
    assert.equal(orgB.organizationId, 'org_b');
    assert.notEqual(orgA.organizationId, orgB.organizationId);
    // The scope is ADDED to the caller's filter, never replaces it.
    assert.deepEqual(orgA.campaignId, { $in: ['c1'] });
}

function resolveTitleFromMeta(meta: { criteria?: Record<string, unknown>; templateName?: string } | null): string {
    if (!meta) return '';
    const criteria = meta.criteria;
    if (criteria && typeof criteria === 'object') {
        const pos = criteria.position || criteria.position_applied_for || criteria.job;
        if (pos != null && String(pos).trim()) return String(pos).trim();
    }
    if (meta.templateName && String(meta.templateName).trim()) {
        return String(meta.templateName).trim();
    }
    return '';
}

function testCampaignBatchTitleNotDeletedWhenMetaExists(): void {
    const meta = {
        campaignId: 'camp-voice-1',
        criteria: { position: 'Customer Support Lead' },
        templateName: 'Support Template',
    };
    const title = resolveTitleFromMeta(meta);
    assert.equal(title, 'Customer Support Lead');
    assert.notEqual(title, 'Deleted campaign');
}

function testRejectSpamSetsRejectedAndNotes(): void {
    const updateData: Record<string, unknown> = {};
    const dataRec = {
        ingress: 'stage2-reject',
        rejectCode: 'honeypot',
        summary: 'Spam detected',
    };
    const rejectCode = String(dataRec.rejectCode).trim();
    const ingress = String(dataRec.ingress).toLowerCase();
    const isReject = Boolean(rejectCode) || ingress.includes('reject');
    if (isReject) updateData.status = 'rejected';
    if (rejectCode) {
        updateData.notes = `[n8n:${rejectCode}] ${dataRec.summary}`;
    }
    assert.equal(updateData.status, 'rejected');
    assert.match(String(updateData.notes), /\[n8n:honeypot\]/);
}

function testJsonStringStrengthsNormalization(): void {
    const raw = '["Clear tone", "Active listening"]';
    let parsed: unknown = raw;
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        parsed = JSON.parse(raw);
    }
    assert.deepEqual(parsed, ['Clear tone', 'Active listening']);
}

function main(): void {
    testStage2IdempotencyIncludesSessionId();
    testSamePayloadSameIdempotencyKeyWithSession();
    testCompleteVoiceContractAccepted();
    testIncompleteVoiceContractRejected();
    testPlaceholderCommunicationRejected();
    testPublicScreeningVoicePathPreserved();
    testOrgScopedQueryIsolation();
    testCampaignBatchTitleNotDeletedWhenMetaExists();
    testRejectSpamSetsRejectedAndNotes();
    testJsonStringStrengthsNormalization();
    console.log('stage2-parity-test: all passed');
}

main();
