/**
 * Stage 1 written-evaluation persistence hardening tests.
 * Run: npx tsx src/scripts/stage1-evaluation-hardening-test.ts
 */
import assert from 'node:assert/strict';
import {
    isCompleteStage1WrittenPatch,
    isStage1RejectOrSpamIngress,
    isStage1WrittenSuccessEvaluationAttempt,
    STAGE1_INCOMPLETE_EVALUATION_ERROR,
    STAGE1_INCOMPLETE_EVALUATION_MESSAGE,
    validateStage1WrittenEvaluationPersistence,
} from '../services/stage1WrittenEvaluationGate.js';

function testMissingOverallScoreRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = { strengths: ['Clear communication'], weaknesses: ['Limited experience'] };
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(result.message, STAGE1_INCOMPLETE_EVALUATION_MESSAGE);
    }
}

function testMissingRecommendationRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 72,
        final_hr_evaluation: 'Proceed to phone screen after reference check.',
        strengths: ['Clear communication'],
        weaknesses: ['Limited experience'],
    };
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
    }
}

function testMissingFinalHrEvaluationRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 72,
        recommendation: 'Consider',
        strengths: ['Clear communication'],
        weaknesses: ['Limited experience'],
        summary: 'Solid candidate.',
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
    }
}

function testInvalidScoreRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: Number.NaN,
        recommendation: 'Hire',
        strengths: ['A'],
        weaknesses: ['B'],
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
}

function testScoreOutOfRangeRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 101,
        recommendation: 'Hire',
        strengths: ['A'],
        weaknesses: ['B'],
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
}

function testUnknownRecommendationRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 80,
        recommendation: 'Maybe',
        strengths: ['A'],
        weaknesses: ['B'],
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
}

function testCompleteEvaluationAccepted(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 78,
        recommendation: 'Consider',
        final_hr_evaluation:
            'Recommend moving to Stage 2 voice interview; verify HR certification and English fluency in follow-up.',
        fit_for_role: 'Strong alignment with HR business partner responsibilities.',
        strengths: ['Strong fit'],
        weaknesses: ['Needs mentoring'],
        summary: 'Solid candidate overall.',
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), true);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testMissingFitForRoleRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 78,
        recommendation: 'Consider',
        final_hr_evaluation: 'Final HR report.',
        strengths: ['Strong fit'],
        weaknesses: ['Needs mentoring'],
        summary: 'Solid candidate overall.',
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.includes('fit_for_role'));
}

function testMissingSummaryRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 78,
        recommendation: 'Consider',
        final_hr_evaluation: 'Final HR report.',
        fit_for_role: 'Good fit.',
        strengths: ['Strong fit'],
        weaknesses: ['Needs mentoring'],
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.includes('summary'));
}

function testMissingStrengthsRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 78,
        recommendation: 'Consider',
        final_hr_evaluation: 'Final HR report.',
        fit_for_role: 'Good fit.',
        summary: 'Solid candidate overall.',
        weaknesses: ['Needs mentoring'],
    };
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.includes('strengths'));
}

function testValidRecommendationsAccepted(): void {
    for (const recommendation of ['Hire', 'Consider', 'Reject'] as const) {
        const patch = {
            overall_score: 50,
            recommendation,
            final_hr_evaluation: `Final HR report for ${recommendation} recommendation.`,
            fit_for_role: 'Role fit assessment.',
            summary: 'Brief summary.',
            strengths: ['Strength A'],
            weaknesses: ['Weakness B'],
        };
        assert.equal(isCompleteStage1WrittenPatch(patch), true);
    }
}

function testStage1RejectPathUnaffected(): void {
    const data = {
        evaluationSource: 'written',
        ingress: 'stage1-reject',
        rejectCode: 'duplicate',
        recommendation: 'Reject',
    };
    const patch = { strengths: ['N/A'], recommendation: 'Reject' };
    assert.equal(isStage1RejectOrSpamIngress(data), true);
    assert.equal(isStage1WrittenSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testStage1SpamRejectCodeUnaffected(): void {
    const data = {
        evaluationSource: 'written',
        ingress: 'stage1',
        rejectCode: 'honeypot',
    };
    const patch = { summary: 'Spam detected' };
    assert.equal(isStage1RejectOrSpamIngress(data), true);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testEmptyPatchDoesNotRequireCompleteEvaluation(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {};
    assert.equal(isStage1WrittenSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testNonWrittenSourceSkipped(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage1' };
    const patch = { strengths: ['A'], weaknesses: ['B'] };
    assert.equal(isStage1WrittenSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

/** Gate is only wired in the Stage 1 handler; voice/video sources are not enforced here. */
function testVoiceSourcePartialPatchSkipped(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage1' };
    const patch = { strengths: ['A'], weaknesses: ['B'] };
    assert.equal(isStage1WrittenSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testVideoSourcePartialPatchSkipped(): void {
    const data = { evaluationSource: 'video', ingress: 'stage1' };
    const patch = { strengths: ['A'], weaknesses: ['B'] };
    assert.equal(isStage1WrittenSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function main(): void {
    testMissingOverallScoreRejected();
    testMissingRecommendationRejected();
    testMissingFinalHrEvaluationRejected();
    testInvalidScoreRejected();
    testScoreOutOfRangeRejected();
    testUnknownRecommendationRejected();
    testCompleteEvaluationAccepted();
    testMissingFitForRoleRejected();
    testMissingSummaryRejected();
    testMissingStrengthsRejected();
    testValidRecommendationsAccepted();
    testStage1RejectPathUnaffected();
    testStage1SpamRejectCodeUnaffected();
    testEmptyPatchDoesNotRequireCompleteEvaluation();
    testNonWrittenSourceSkipped();
    testVoiceSourcePartialPatchSkipped();
    testVideoSourcePartialPatchSkipped();
    console.log('stage1-evaluation-hardening-test: all passed');
}

main();
