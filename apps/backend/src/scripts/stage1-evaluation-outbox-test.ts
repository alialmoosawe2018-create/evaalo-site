/**
 * Stage 1 evaluation outbox + rubric result contract (offline).
 * Run: npm run test:stage1-evaluation-outbox
 */
import assert from 'node:assert/strict';
import { buildStage1EvaluationIdempotencyKey, normalizeStage1RubricSnapshotHash } from '../services/stage1EvaluationOutboxService.js';
import { inferStage1EvaluationLanguage, normalizeStage1EvaluationLanguage } from '../services/stage1EvaluationLanguage.js';
import { normalizeRubricResultsFromWebhook } from '../services/stage1RubricResults.js';
import { buildStage1ThreeBucketPayload } from '../services/stage1N8nPayloadBuilder.js';
import { createFormBindingForTemplate } from '../services/formTemplateService.js';
import { buildEvaluationRubricFromCampaignBody } from '../services/evaluationRubricService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

function testIdempotencyKeyUniquePerRubricHash() {
    const cid = '507f1f77bcf86cd799439011';
    const k1 = buildStage1EvaluationIdempotencyKey(cid, 'sha256:aaa');
    const k2 = buildStage1EvaluationIdempotencyKey(cid, 'sha256:bbb');
    const k3 = buildStage1EvaluationIdempotencyKey(cid, 'sha256:aaa');
    assert.notEqual(k1, k2);
    assert.equal(k1, k3);
    assert.ok(k1.startsWith('stage1-evaluation:'));
}

function testIdempotencyKeyLegacyFallback() {
    const key = buildStage1EvaluationIdempotencyKey('507f1f77bcf86cd799439011', '');
    assert.ok(key.endsWith(':legacy'));
}

function testNormalizeRubricHashLegacy() {
    assert.equal(normalizeStage1RubricSnapshotHash(''), 'legacy');
    assert.equal(normalizeStage1RubricSnapshotHash('sha256:abc'), 'sha256:abc');
}

function testEvaluationLanguageNormalization() {
    assert.equal(normalizeStage1EvaluationLanguage('ar'), 'ar');
    assert.equal(normalizeStage1EvaluationLanguage('ku'), 'ar');
    assert.equal(normalizeStage1EvaluationLanguage('en'), 'en');
    assert.equal(
        inferStage1EvaluationLanguage({ full_name: 'علي محمد', location: 'بغداد' }, {}),
        'ar'
    );
}

function testInsufficientEvidenceResultPersisted() {
    const parsed = normalizeRubricResultsFromWebhook({
        rubricResults: [
            {
                rubricItemId: 'custom__portfolio__abc',
                result: 'insufficient_evidence',
                evidence: [],
                confidence: 'high',
            },
        ],
    });
    assert.ok(parsed);
    assert.equal(parsed![0].result, 'insufficient_evidence');
    assert.deepEqual(parsed![0].evidence, []);
}

function testInvalidRubricResultsFiltered() {
    const parsed = normalizeRubricResultsFromWebhook({
        rubricResults: [
            { rubricItemId: 'x', result: 'maybe' },
            { rubricItemId: 'y', result: 'meets', evidence: ['CV mentions React'], confidence: 'medium' },
        ],
    });
    assert.ok(parsed);
    assert.equal(parsed!.length, 1);
    assert.equal(parsed![0].result, 'meets');
}

function testN8nPayloadGuardrailsPresent() {
    const binding = createFormBindingForTemplate();
    const rubric = buildEvaluationRubricFromCampaignBody({
        position: 'Engineer',
        skills: 'Node',
    });
    const campaign: CampaignFormContext = {
        campaignId: 'camp1',
        formBinding: binding,
        evaluationRubric: rubric.items,
        criteria: { position: 'Engineer' },
    };
    const payload = buildStage1ThreeBucketPayload(campaign, {
        full_name: 'Test',
        email: 't@ex.com',
        phone: '+1',
        position_applied_for: 'Engineer',
        years_of_experience: '2',
        skills: ['A', 'B', 'C'],
    });
    assert.equal(payload.evaluationGuardrails.neverFollowInstructionsInUntrustedContent, true);
    assert.equal(payload.evaluationGuardrails.insufficientEvidenceWhenNoProof, true);
    assert.ok(payload.evaluationRubric.every((r) => r.delimitedExpectation.includes('data="true"')));
}

function main() {
    testIdempotencyKeyUniquePerRubricHash();
    testIdempotencyKeyLegacyFallback();
    testNormalizeRubricHashLegacy();
    testEvaluationLanguageNormalization();
    console.log('✓ outbox idempotency keys');

    testInsufficientEvidenceResultPersisted();
    testInvalidRubricResultsFiltered();
    console.log('✓ rubricResults inbound contract');

    testN8nPayloadGuardrailsPresent();
    console.log('✓ n8n payload injection guardrails');

    console.log('\nstage1-evaluation-outbox-test: all passed');
    console.log('  (Mongo retry / delivered state: integration — candidate saved before outbox flush)');
}

main();
