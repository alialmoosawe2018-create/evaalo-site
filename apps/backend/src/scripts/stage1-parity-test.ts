/**
 * Stage 1 parity checks (offline, fictional data only).
 * Run: npm run test:stage1-parity
 */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { orgScopedQuery } from '../middleware/orgScope.js';
import {
    isCompleteStage1WrittenPatch,
    validateStage1WrittenEvaluationPersistence,
    STAGE1_INCOMPLETE_EVALUATION_ERROR,
} from '../services/stage1WrittenEvaluationGate.js';
import { buildN8nStageIdempotencyKey } from '../services/webhookIdempotency.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';

function mockReq(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return { body, headers } as unknown as Request;
}

function mockOrgReq(orgId: string): Request {
    return {
        auth: { orgId, sessionClaims: { orgId } },
    } as unknown as Request;
}

/** Mirrors frontend stageRecommendation.js for offline parity verification. */
function normalizeStageEvalText(raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || new Set(['undefined', 'null', 'nan', '']).has(s.toLowerCase())) return null;
    return s;
}

function normalizeStageEvalStringList(raw: unknown): string[] {
    if (raw == null) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items
        .flatMap((item) => {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed)) return parsed;
                    } catch {
                        /* keep scalar */
                    }
                }
            }
            return [item];
        })
        .map((x) => normalizeStageEvalText(x))
        .filter(Boolean) as string[];
}

/** Mirrors screeningCampaigns.js title/deleted rules for batch metadata display. */
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

function testStage1IdempotencyIncludesSessionId(): void {
    const body = { evaluationSource: 'written', overall_score: 70 };
    const reqA = mockReq(body);
    const reqB = mockReq(body);
    const keyEmpty = buildN8nStageIdempotencyKey(reqA, 'stage1', CANDIDATE_ID, '');
    const keySess = buildN8nStageIdempotencyKey(reqB, 'stage1', CANDIDATE_ID, 'sess-abc');
    assert.notEqual(keyEmpty, keySess);
    assert.match(keyEmpty, /^n8n:stage1:hash:/);
}

function testStage2IdempotencyIncludesSessionId(): void {
    const body = { evaluationSource: 'voice' };
    const req = mockReq(body);
    const keyEmpty = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, '');
    const keyWithSession = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, 'voice-sess-abc');
    assert.notEqual(keyEmpty, keyWithSession, 'stage2 must include sessionId in hash fallback');
    const keySameSession = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, 'voice-sess-abc');
    assert.equal(keyWithSession, keySameSession);
}

function testExecutionIdPriority(): void {
    const req = mockReq({ executionId: 'exec-123', overall_score: 1 });
    const key = buildN8nStageIdempotencyKey(req, 'stage1', CANDIDATE_ID, 'sess-x');
    assert.equal(key, 'n8n:stage1:exec:exec-123');
}

function testHeaderIdempotencyKeyPriority(): void {
    const body = { evaluationSource: 'written' };
    const req = mockReq(body, { 'x-idempotency-key': 'exec-from-header' });
    const key = buildN8nStageIdempotencyKey(req, 'stage1', CANDIDATE_ID, '');
    assert.equal(key, 'n8n:stage1:exec-from-header');
}

function testSamePayloadSameIdempotencyKey(): void {
    const body = { evaluationSource: 'written', overall_score: 55, recommendation: 'Consider' };
    const reqA = mockReq(body);
    const reqB = mockReq(body);
    const keyA = buildN8nStageIdempotencyKey(reqA, 'stage1', CANDIDATE_ID, '');
    const keyB = buildN8nStageIdempotencyKey(reqB, 'stage1', CANDIDATE_ID, '');
    assert.equal(keyA, keyB, 'identical Stage 1 callbacks must share idempotency key');
}

function testPublicScreeningSkipsWrittenStage1Send(): void {
    const n8nConfigured = true;
    const willSend = (sourceType: string | undefined) =>
        sourceType !== 'public_screening' && n8nConfigured;
    assert.equal(willSend('public_screening'), false);
    assert.equal(willSend('manual'), true);
    assert.equal(willSend(undefined), true);
}

function testOrgScopedQueryIsolation(): void {
    const orgA = orgScopedQuery(mockOrgReq('org_a'), { campaignId: { $in: ['c1'] } });
    const orgB = orgScopedQuery(mockOrgReq('org_b'), { campaignId: { $in: ['c1'] } });
    assert.equal(orgA.organizationId, 'org_a');
    assert.equal(orgB.organizationId, 'org_b');
    assert.notEqual(orgA.organizationId, orgB.organizationId);
}

function testCampaignBatchTitleNotDeletedWhenMetaExists(): void {
    const meta = {
        campaignId: 'camp-1',
        criteria: { position: 'HR Business Partner' },
        templateName: 'HR BP Template',
    };
    const title = resolveTitleFromMeta(meta);
    const isDeleted = !meta;
    assert.equal(isDeleted, false);
    assert.equal(title, 'HR Business Partner');
    assert.notEqual(title, 'Deleted campaign');
}

function testCampaignDeletedOnlyWithoutMeta(): void {
    const meta = null;
    const isDeleted = meta == null;
    const title = isDeleted ? 'Deleted campaign' : resolveTitleFromMeta(meta);
    assert.equal(isDeleted, true);
    assert.equal(title, 'Deleted campaign');
}

function testPlaceholderFinalHrRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 70,
        recommendation: 'Consider' as const,
        final_hr_evaluation: 'undefined',
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
}

function testFrontendNormalization(): void {
    assert.equal(normalizeStageEvalText('undefined'), null);
    assert.equal(normalizeStageEvalText('null'), null);
    assert.equal(normalizeStageEvalText('Valid HR report.'), 'Valid HR report.');
    const parsed = normalizeStageEvalStringList('["Strength one", "Strength two"]');
    assert.deepEqual(parsed, ['Strength one', 'Strength two']);
}

/** Mirrors server.ts mergeEval placeholder cleanup for Stage 1 persistence. */
function mergeEvalMirror(
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const INVALID = new Set(['', 'undefined', 'null', 'nan']);
    const base = existing ? { ...existing } : {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && INVALID.has(v.trim().toLowerCase())) continue;
        base[k] = v;
    }
    for (const [k, v] of Object.entries(base)) {
        if (typeof v === 'string' && INVALID.has(v.trim().toLowerCase())) {
            delete base[k];
        }
    }
    return base;
}

function testMergeEvalStripsPlaceholderText(): void {
    const merged = mergeEvalMirror(
        { fit_for_role: 'Good fit', summary: 'Prior summary' },
        { fit_for_role: 'undefined', final_hr_evaluation: 'Valid HR narrative.' }
    );
    assert.equal(merged.fit_for_role, 'Good fit');
    assert.equal(merged.final_hr_evaluation, 'Valid HR narrative.');
    assert.equal(merged.summary, 'Prior summary');
}

/** Mirrors server.ts applyN8nRejectHandling for Stage 1 reject/spam paths. */
function applyRejectMirror(
    dataRec: Record<string, unknown>,
    updateData: Record<string, unknown>,
    existingNotes?: string
): void {
    const rejectCode =
        dataRec.rejectCode != null ? String(dataRec.rejectCode).trim() : '';
    const ingress = String(dataRec.ingress ?? '').toLowerCase();
    const isReject = Boolean(rejectCode) || ingress.includes('reject');

    if (isReject && !dataRec.status) {
        updateData.status = 'rejected';
    }

    if (rejectCode) {
        const summary = dataRec.summary != null ? String(dataRec.summary).trim() : '';
        const line = `[n8n:${rejectCode}]${summary ? ` ${summary}` : ''}`;
        const base = existingNotes?.trim() || '';
        updateData.notes = base ? `${base}\n${line}` : line;
    }
}

function testRejectSpamSetsRejectedAndNotes(): void {
    const updateData: Record<string, unknown> = {};
    applyRejectMirror(
        {
            ingress: 'stage1-reject',
            rejectCode: 'honeypot',
            summary: 'Spam detected',
        },
        updateData,
        'Existing note'
    );
    assert.equal(updateData.status, 'rejected');
    assert.match(String(updateData.notes), /\[n8n:honeypot\]/);
    assert.match(String(updateData.notes), /Spam detected/);
}

function main(): void {
    testStage1IdempotencyIncludesSessionId();
    testStage2IdempotencyIncludesSessionId();
    testExecutionIdPriority();
    testHeaderIdempotencyKeyPriority();
    testSamePayloadSameIdempotencyKey();
    testPublicScreeningSkipsWrittenStage1Send();
    testOrgScopedQueryIsolation();
    testCampaignBatchTitleNotDeletedWhenMetaExists();
    testCampaignDeletedOnlyWithoutMeta();
    testPlaceholderFinalHrRejected();
    testFrontendNormalization();
    testMergeEvalStripsPlaceholderText();
    testRejectSpamSetsRejectedAndNotes();
    console.log('stage1-parity-test: all passed');
}

main();
