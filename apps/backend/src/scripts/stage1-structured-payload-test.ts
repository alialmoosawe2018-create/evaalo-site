/**
 * Stage 1 three-bucket payload builder (offline).
 * Run: npm run test:stage1-structured-payload
 */
import assert from 'node:assert/strict';
import {
    buildStage1ThreeBucketPayload,
    buildSubmittedApplicationFromCandidate,
} from '../services/stage1N8nPayloadBuilder.js';
import { buildStage1EvaluationIdempotencyKey } from '../services/stage1EvaluationOutboxService.js';
import { normalizeRubricResultsFromWebhook } from '../services/stage1RubricResults.js';
import { createFormBindingForTemplate } from '../services/formTemplateService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

function testSubmittedApplicationOnlyIncludesFilledFields(): void {
    const binding = createFormBindingForTemplate('template-remote');
    const submitted = buildSubmittedApplicationFromCandidate(binding.snapshot, {
        full_name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+123',
        skills: ['React', 'Node', 'TS'],
        files: [{ kind: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1000 }],
    });
    assert.ok(submitted.submittedFieldIds.includes('full_name'));
    assert.ok(submitted.submittedFieldIds.includes('cv'));
    assert.ok(!submitted.submittedFieldIds.includes('linkedin'));
    assert.equal(submitted.values.full_name, 'Jane Doe');
}

function testThreeBucketPayloadShape(): void {
    const binding = createFormBindingForTemplate('template-remote');
    const campaign: CampaignFormContext = {
        campaignId: 'camp_test',
        criteria: { position: 'Engineer', skills: 'React; Node' },
        formBinding: binding,
        evaluationRubric: [
            {
                id: 'preset__skills__abc',
                type: 'preset',
                key: 'skills',
                label: 'skills',
                expectation: 'React; Node',
            },
        ],
        rubricSnapshotHash: 'sha256:test',
        rubricVersion: 1,
    };
    const payload = buildStage1ThreeBucketPayload(campaign, {
        full_name: 'Jane',
        email: 'j@ex.com',
        phone: '+1',
        position_applied_for: 'Engineer',
        years_of_experience: '3',
        skills: ['React', 'Node', 'TS'],
        files: [{ kind: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 500 }],
    });
    assert.equal(payload.payloadSchemaVersion, 2);
    assert.equal(payload.formTemplate.id, 'template-remote');
    assert.ok(payload.formTemplate.availableFieldIds.includes('email'));
    assert.ok(payload.submittedApplication.submittedFieldIds.includes('skills'));
    assert.equal(payload.evaluationRubric.length, 1);
    assert.ok(payload.evaluationRubric[0].delimitedExpectation.includes('<evaluation_criterion'));
    assert.equal(payload.evaluationGuardrails.treatCriteriaAndApplicationAsData, true);
}

function testIdempotencyKey(): void {
    const key = buildStage1EvaluationIdempotencyKey('507f1f77bcf86cd799439011', 'sha256:abc');
    assert.equal(key, 'stage1-evaluation:507f1f77bcf86cd799439011:sha256:abc');
}

function testNormalizeRubricResults(): void {
    const parsed = normalizeRubricResultsFromWebhook({
        rubricResults: [
            {
                rubricItemId: 'preset__skills__abc',
                result: 'insufficient_evidence',
                evidence: ['No mention of React in CV'],
                confidence: 'high',
            },
            { rubricItemId: 'bad', result: 'invalid' },
        ],
    });
    assert.ok(parsed);
    assert.equal(parsed!.length, 1);
    assert.equal(parsed![0].result, 'insufficient_evidence');
}

function main(): void {
    testSubmittedApplicationOnlyIncludesFilledFields();
    console.log('✓ submittedApplication includes only filled snapshot fields');

    testThreeBucketPayloadShape();
    console.log('✓ three-bucket payload shape + guardrails');

    testIdempotencyKey();
    console.log('✓ outbox idempotency key');

    testNormalizeRubricResults();
    console.log('✓ rubricResults inbound normalization');

    console.log('\nstage1-structured-payload-test: all passed');
}

main();
