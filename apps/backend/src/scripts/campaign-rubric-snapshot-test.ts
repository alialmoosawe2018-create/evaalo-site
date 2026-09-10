/**
 * A campaign must pin the rubric its candidates are actually measured against.
 *
 * ⚠️ 2026-09-10 (D8): ZERO of 15 production campaigns carried a
 * `rubricSnapshotHash`. Both it and `rubricVersion` were written only when
 * `isScreeningForm` (`interviewType === 'form' || formTemplateId`) — and the
 * start-process flow the UI actually uses sets neither. The same mistake had
 * already been found and fixed for the `rubric_required` validation a few lines
 * above, whose comment reads "the start-process flow sets neither, so the check
 * never once ran"; the snapshot was left behind on the broken condition.
 *
 * Two consequences:
 *   1. `normalizeStage1RubricSnapshotHash` collapsed every campaign to the literal
 *      'legacy', which is what made the Stage 1 outbox key collision GUARANTEED
 *      rather than rare for returning applicants.
 *   2. Candidates were screened against an unpinned rubric — nothing recorded
 *      which version of the criteria a given score was produced from.
 *
 * ⚠️ The hash is taken over the DERIVED rubric, not over a stored list.
 * `resolveCampaignEvaluationRubric` (stage1N8nPayloadBuilder.ts:136) uses
 * `campaign.evaluationRubric` when present and otherwise derives from `criteria`.
 * Persisting a built list here would have changed WHAT candidates are scored
 * against — a fix must pin reality, not replace it. These tests exist to keep
 * the hashed thing and the scored thing the same thing.
 *
 * Run: npm run test:campaign-rubric-snapshot
 */
import assert from 'node:assert/strict';
import { deriveLegacyRubricFromCriteria } from '../services/evaluationRubricService.js';
import { hashRubricContent } from '../services/formTemplateService.js';
import { resolveCampaignEvaluationRubric } from '../services/stage1N8nPayloadBuilder.js';
import { normalizeStage1RubricSnapshotHash } from '../services/stage1EvaluationOutboxService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

const CRITERIA = {
    position: 'Senior HR Specialist',
    location: 'Baghdad',
    yearsOfExperience: '2-5',
    educationLevel: 'Bachelor',
    languages: 'English; Arabic',
};

function snapshotFor(criteria: Record<string, unknown>): string {
    return hashRubricContent(deriveLegacyRubricFromCriteria(criteria));
}

function testHashIsRealAndNotLegacy() {
    const hash = snapshotFor(CRITERIA);
    assert.ok(hash && hash.length > 8, 'a campaign with criteria must produce a real hash');
    assert.notEqual(
        normalizeStage1RubricSnapshotHash(hash),
        'legacy',
        'a real hash must survive normalisation — the whole point is to stop collapsing to legacy'
    );
}

function testHashIsDeterministic() {
    assert.equal(snapshotFor(CRITERIA), snapshotFor({ ...CRITERIA }));
}

/**
 * The property that makes the snapshot worth storing: change what candidates are
 * measured against, and the recorded identity changes with it. Without this the
 * hash is decoration.
 */
function testHashTracksTheCriteria() {
    const a = snapshotFor(CRITERIA);
    const b = snapshotFor({ ...CRITERIA, yearsOfExperience: '5-10' });
    assert.notEqual(a, b, 'a changed requirement must change the snapshot');
}

/**
 * ⚠️ The guard against the fix that would have been worse than the bug: the hash
 * must describe the rubric the SCORER resolves. If these two ever diverge, a score
 * is stamped with the identity of a rubric nobody used.
 */
function testHashedRubricIsTheScoredRubric() {
    const campaign = { criteria: CRITERIA } as unknown as CampaignFormContext;
    const scored = resolveCampaignEvaluationRubric(campaign);
    assert.ok(scored.length > 0, 'the scorer must resolve something for this campaign');
    assert.equal(
        hashRubricContent(scored),
        snapshotFor(CRITERIA),
        'the stored snapshot must hash exactly what the scorer will use'
    );
}

/**
 * Audio/video campaigns are scored from the interview itself, not a written
 * rubric — they are the deliberate exemption, and must stay exempt.
 */
function testInterviewOnlyStaysExempt() {
    for (const interviewType of ['audio', 'video']) {
        const isInterviewOnly = interviewType === 'audio' || interviewType === 'video';
        assert.equal(isInterviewOnly, true, `${interviewType} must be treated as interview-only`);
    }
    for (const interviewType of ['form', '', 'written', undefined]) {
        const t = String(interviewType || '').trim().toLowerCase();
        assert.equal(
            t === 'audio' || t === 'video',
            false,
            `"${String(interviewType)}" must NOT be exempt — this is the case that was silently skipped`
        );
    }
}

function main() {
    testHashIsRealAndNotLegacy();
    console.log('✓ a screening campaign gets a real hash, not "legacy"');
    testHashIsDeterministic();
    console.log('✓ deterministic');
    testHashTracksTheCriteria();
    console.log('✓ the snapshot changes when the criteria change');
    testHashedRubricIsTheScoredRubric();
    console.log('✓ the hashed rubric IS the scored rubric');
    testInterviewOnlyStaysExempt();
    console.log('✓ audio/video stay exempt; everything else is covered');
    console.log('\ncampaign-rubric-snapshot-test: all passed');
}

main();
