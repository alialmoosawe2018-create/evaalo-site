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

/**
 * ⚠️ 2026-09-10: a returning applicant's new application was never analysed.
 *
 * علي محمود نجم applied to campaign 1ae52ee1 on 09-06 — outbox row delivered,
 * key `stage1-evaluation:<cand>:legacy`. On 09-10 he applied to a DIFFERENT
 * campaign, a7070dada. `normalizeStage1RubricSnapshotHash` returns 'legacy' for
 * every campaign without a rubric snapshot — all five production rows carry it —
 * so the key was identical, the September row was found, and
 * `shouldDispatch = status === 'pending' && attempts === 0` was false because it
 * was already 'delivered'. No send, no new row, no error, no log line.
 *
 * The evaluation belongs to the APPLICATION, not the person, so the campaign has
 * to be part of the key. Without it every returning applicant is analysed once,
 * ever, and every later application silently records an empty result.
 */
function testIdempotencyKeyIsPerCampaign() {
    const cid = '507f1f77bcf86cd799439011';
    const first = buildStage1EvaluationIdempotencyKey(cid, 'legacy', '1ae52ee1a11f93eb0e0e6dca44d8c03f');
    const second = buildStage1EvaluationIdempotencyKey(cid, 'legacy', 'a7070dada04939ea3802fe8844e8c2c7');
    assert.notEqual(first, second, 'the same person applying to a second campaign must not be deduped');
    // Same person, same campaign, same rubric → still one evaluation.
    assert.equal(
        first,
        buildStage1EvaluationIdempotencyKey(cid, 'legacy', '1ae52ee1a11f93eb0e0e6dca44d8c03f'),
        're-submitting to the SAME campaign must still dedupe'
    );
    // The rubric hash must keep separating keys within one campaign.
    assert.notEqual(
        first,
        buildStage1EvaluationIdempotencyKey(cid, 'sha256:aaa', '1ae52ee1a11f93eb0e0e6dca44d8c03f')
    );
}

/**
 * Rows written before this change have no campaign in their key. Callers fall back
 * to that shape (filtered by campaignId) so an existing row for the SAME campaign
 * still dedupes; keeping the shape byte-identical is what makes that lookup work.
 */
function testIdempotencyKeyWithoutCampaignKeepsLegacyShape() {
    const cid = '507f1f77bcf86cd799439011';
    assert.equal(
        buildStage1EvaluationIdempotencyKey(cid, 'legacy'),
        `stage1-evaluation:${cid}:legacy`
    );
    assert.equal(
        buildStage1EvaluationIdempotencyKey(cid, 'legacy', '   '),
        `stage1-evaluation:${cid}:legacy`,
        'a blank campaign must not produce an empty segment'
    );
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
    testIdempotencyKeyIsPerCampaign();
    testIdempotencyKeyWithoutCampaignKeepsLegacyShape();
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
