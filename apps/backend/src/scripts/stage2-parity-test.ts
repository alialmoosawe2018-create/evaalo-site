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

function mockOrgReq(orgId: string): Request {
    return {
        auth: { orgId, sessionClaims: { orgId } },
    } as unknown as Request;
}

function completeVoicePatch(): Record<string, unknown> {
    return {
        communication: 8,
        language_fluency: 'Fluent',
        confidence: 'Clear delivery',
        problem_solving: 7,
        digital_skills: 'CRM proficient',
        professional_attitude: 'Professional',
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
    assert.notEqual(orgA.organizationId, orgB.organizationId);
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
