/**
 * Stage 2 voice-evaluation persistence hardening tests (offline gate only).
 * Run: npm run test:stage2-eval-gate
 */
import assert from 'node:assert/strict';
import {
    formatStage2EvaluationGateDiagnostic,
    getStage2EvaluationGateMode,
    getStage2VoicePatchIssues,
    isCompleteStage2VoicePatch,
    isStage2RejectOrSpamIngress,
    isStage2VoiceSuccessEvaluationAttempt,
    shouldBlockStage2IncompleteEvaluation,
    STAGE2_INCOMPLETE_EVALUATION_ERROR,
    STAGE2_INCOMPLETE_EVALUATION_MESSAGE,
    validateStage2VoiceEvaluationPersistence,
} from '../services/stage2VoiceEvaluationGate.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        const val = overrides[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    try {
        fn();
    } finally {
        for (const key of Object.keys(overrides)) {
            const val = prev[key];
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    }
}

function completeVoicePatch(): Record<string, unknown> {
    return {
        communication: 'Good',
        language_fluency: 'Intermediate',
        confidence: 'Good',
        problem_solving: 'Good',
        digital_skills: 'Excellent',
        professional_attitude:
            'The candidate remained polite, engaged, and professional throughout the interview, responding thoughtfully to each question.',
        summary: 'Strong communicator with relevant support experience.',
        strengths: ['Clear communication', 'Customer empathy'],
        weaknesses: ['Limited technical depth'],
        final_hr_evaluation:
            'Recommend proceeding to video interview; confirm stakeholder management examples.',
        overall_score: 74,
        recommendation: 'Consider',
    };
}

function testGateModeUnsetDefaultsToEnforce(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: undefined }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'enforce');
    });
}

function testGateModeObserveExplicit(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: 'observe' }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'observe');
    });
}

function testGateModeEnforceExplicit(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: 'enforce' }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'enforce');
    });
}

function testGateModeInvalidDefaultsToEnforce(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: 'strict' }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'enforce');
    });
}

function testObserveModeDoesNotBlockIncomplete(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.communication;
    const validation = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(validation.ok, false);
    assert.equal(shouldBlockStage2IncompleteEvaluation('observe', validation), false);
}

function testEnforceModeBlocksIncomplete(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.communication;
    const validation = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(validation.ok, false);
    assert.equal(shouldBlockStage2IncompleteEvaluation('enforce', validation), true);
}

function testIncompleteIssuesListFieldNamesOnly(): void {
    const patch = { ...completeVoicePatch() };
    delete patch.communication;
    patch.summary = '';
    const issues = getStage2VoicePatchIssues(patch);
    assert.deepEqual(issues, ['communication', 'summary']);
}

function testDiagnosticOmitsTranscriptAndSecrets(): void {
    const diagnostic = formatStage2EvaluationGateDiagnostic({
        mode: 'observe',
        gateResult: 'incomplete',
        issues: ['communication', 'summary'],
        candidateRef: '507f****9011',
    });
    assert.match(diagnostic, /mode=observe/);
    assert.match(diagnostic, /result=incomplete/);
    assert.match(diagnostic, /issues=communication,summary/);
    assert.match(diagnostic, /candidateRef=507f\*\*\*\*9011/);
    assert.doesNotMatch(diagnostic, /transcript|secret|password/i);
}

function testCompleteEvaluationAccepted(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = completeVoicePatch();
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
    assert.equal(shouldBlockStage2IncompleteEvaluation('observe', result), false);
    assert.equal(shouldBlockStage2IncompleteEvaluation('enforce', result), false);
}

function testValidRecommendationsAccepted(): void {
    for (const recommendation of ['Hire', 'Consider', 'Reject'] as const) {
        const patch = { ...completeVoicePatch(), recommendation };
        assert.equal(isCompleteStage2VoicePatch(patch), true);
    }
}

function testRatingTokensAccepted(): void {
    const patch = { ...completeVoicePatch() };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
}

function testNumericCommunicationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), communication: 8 };
    assertMissingFieldRejected(data, patch, ['communication']);
}

function testRatingWordAsProfessionalAttitudeRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), professional_attitude: 'Bad' };
    assertMissingFieldRejected(data, patch, ['professional_attitude']);
}

function testPhraseAsCompetencyRatingRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), language_fluency: 'Fluent with minor accent' };
    assertMissingFieldRejected(data, patch, ['language_fluency']);
}

function testMissingCommunicationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.communication;
    assertMissingFieldRejected(data, patch, ['communication']);
}

function testMissingLanguageFluencyRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), language_fluency: '' };
    assertMissingFieldRejected(data, patch, ['language_fluency']);
}

function testMissingConfidenceRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), confidence: 'null' };
    assertMissingFieldRejected(data, patch, ['confidence']);
}

function testMissingProblemSolvingRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.problem_solving;
    assertMissingFieldRejected(data, patch, ['problem_solving']);
}

function testMissingDigitalSkillsRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), digital_skills: 'undefined' };
    assertMissingFieldRejected(data, patch, ['digital_skills']);
}

function testMissingProfessionalAttitudeRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), professional_attitude: '   ' };
    assertMissingFieldRejected(data, patch, ['professional_attitude']);
}

function testMissingSummaryRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), summary: 'nan' };
    assertMissingFieldRejected(data, patch, ['summary']);
}

function testEmptyStrengthsAccepted(): void {
    // v2 instrument may legitimately return an empty strengths array on a thin interview.
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), strengths: [] as string[] };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testEmptyWeaknessesAccepted(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), weaknesses: [] as string[] };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testNotAssessedRatingAccepted(): void {
    // v2 may abstain on a competency it cannot evaluate — "Not Assessed" is a valid rating.
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), language_fluency: 'Not Assessed' };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testMissingFinalHrEvaluationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.final_hr_evaluation;
    assertMissingFieldRejected(data, patch, ['final_hr_evaluation']);
}

function testMissingOverallScoreAccepted(): void {
    // v2 returns null/absent overall_score on insufficient_data — accepted (recommendation still required).
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch: Record<string, unknown> = { ...completeVoicePatch() };
    delete patch.overall_score;
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testNullOverallScoreAccepted(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), overall_score: null };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
    assert.equal(validateStage2VoiceEvaluationPersistence(data, patch).ok, true);
}

function testInvalidScoreRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), overall_score: Number.NaN };
    assertMissingFieldRejected(data, patch, ['overall_score']);
}

function testScoreOutOfRangeRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), overall_score: 101 };
    assertMissingFieldRejected(data, patch, ['overall_score']);
}

function testUnknownRecommendationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), recommendation: 'Maybe' };
    assertMissingFieldRejected(data, patch, ['recommendation']);
}

function testStage2RejectPathUnaffected(): void {
    const data = {
        evaluationSource: 'voice',
        ingress: 'stage2-reject',
        rejectCode: 'duplicate',
        recommendation: 'Reject',
    };
    const patch = { strengths: ['N/A'], recommendation: 'Reject' };
    assert.equal(isStage2RejectOrSpamIngress(data), true);
    assert.equal(isStage2VoiceSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
    assert.equal(shouldBlockStage2IncompleteEvaluation('enforce', result), false);
}

function testStage2SpamRejectCodeUnaffected(): void {
    const data = {
        evaluationSource: 'voice',
        ingress: 'stage2',
        rejectCode: 'honeypot',
    };
    const patch = { summary: 'Spam detected' };
    assert.equal(isStage2RejectOrSpamIngress(data), true);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
    assert.equal(shouldBlockStage2IncompleteEvaluation('observe', result), false);
    assert.equal(shouldBlockStage2IncompleteEvaluation('enforce', result), false);
}

function testEmptyPatchDoesNotRequireCompleteEvaluation(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = {};
    assert.equal(isStage2VoiceSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testNonVoiceSourceSkipped(): void {
    const data = { evaluationSource: 'written', ingress: 'stage2' };
    const patch = { strengths: ['A'], weaknesses: ['B'] };
    assert.equal(isStage2VoiceSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function assertMissingFieldRejected(
    data: Record<string, unknown>,
    patch: Record<string, unknown>,
    expectedIssues: string[]
): void {
    assert.equal(isCompleteStage2VoicePatch(patch), false);
    const result = validateStage2VoiceEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error, STAGE2_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(result.message, STAGE2_INCOMPLETE_EVALUATION_MESSAGE);
        for (const issue of expectedIssues) {
            assert.ok(result.issues.includes(issue), `expected issue ${issue}`);
        }
    }
}

function main(): void {
    testGateModeUnsetDefaultsToEnforce();
    testGateModeObserveExplicit();
    testGateModeEnforceExplicit();
    testGateModeInvalidDefaultsToEnforce();
    testObserveModeDoesNotBlockIncomplete();
    testEnforceModeBlocksIncomplete();
    testIncompleteIssuesListFieldNamesOnly();
    testDiagnosticOmitsTranscriptAndSecrets();
    testCompleteEvaluationAccepted();
    testValidRecommendationsAccepted();
    testRatingTokensAccepted();
    testNumericCommunicationRejected();
    testRatingWordAsProfessionalAttitudeRejected();
    testPhraseAsCompetencyRatingRejected();
    testMissingCommunicationRejected();
    testMissingLanguageFluencyRejected();
    testMissingConfidenceRejected();
    testMissingProblemSolvingRejected();
    testMissingDigitalSkillsRejected();
    testMissingProfessionalAttitudeRejected();
    testMissingSummaryRejected();
    testEmptyStrengthsAccepted();
    testEmptyWeaknessesAccepted();
    testNotAssessedRatingAccepted();
    testMissingFinalHrEvaluationRejected();
    testMissingOverallScoreAccepted();
    testNullOverallScoreAccepted();
    testInvalidScoreRejected();
    testScoreOutOfRangeRejected();
    testUnknownRecommendationRejected();
    testStage2RejectPathUnaffected();
    testStage2SpamRejectCodeUnaffected();
    testEmptyPatchDoesNotRequireCompleteEvaluation();
    testNonVoiceSourceSkipped();
    console.log('stage2-evaluation-hardening-test: all passed');
}

main();
