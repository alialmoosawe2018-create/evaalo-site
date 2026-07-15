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
        communication: 8,
        language_fluency: 'Fluent with minor accent',
        confidence: 'Speaks clearly and calmly',
        problem_solving: 7,
        digital_skills: 'Comfortable with CRM and spreadsheets',
        professional_attitude: 'Polite and engaged throughout',
        summary: 'Strong communicator with relevant support experience.',
        strengths: ['Clear communication', 'Customer empathy'],
        weaknesses: ['Limited technical depth'],
        final_hr_evaluation:
            'Recommend proceeding to video interview; confirm stakeholder management examples.',
        overall_score: 74,
        recommendation: 'Consider',
    };
}

function testGateModeUnsetDefaultsToObserve(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: undefined }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'observe');
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

function testGateModeInvalidDefaultsToObserve(): void {
    withEnv({ STAGE2_EVALUATION_GATE_MODE: 'strict' }, () => {
        assert.equal(getStage2EvaluationGateMode(), 'observe');
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
    patch.weaknesses = [];
    const issues = getStage2VoicePatchIssues(patch);
    assert.deepEqual(issues, ['communication', 'weaknesses']);
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

function testNumericOrTextCompetencyFieldsAccepted(): void {
    const patch = {
        ...completeVoicePatch(),
        communication: 'Strong verbal clarity',
        problem_solving: 'Structured troubleshooting approach',
    };
    assert.equal(isCompleteStage2VoicePatch(patch), true);
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

function testEmptyStrengthsRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), strengths: [] };
    assertMissingFieldRejected(data, patch, ['strengths']);
}

function testEmptyWeaknessesRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch(), weaknesses: ['', '  '] };
    assertMissingFieldRejected(data, patch, ['weaknesses']);
}

function testMissingFinalHrEvaluationRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.final_hr_evaluation;
    assertMissingFieldRejected(data, patch, ['final_hr_evaluation']);
}

function testMissingOverallScoreRejected(): void {
    const data = { evaluationSource: 'voice', ingress: 'stage2' };
    const patch = { ...completeVoicePatch() };
    delete patch.overall_score;
    assertMissingFieldRejected(data, patch, ['overall_score']);
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
    testGateModeUnsetDefaultsToObserve();
    testGateModeObserveExplicit();
    testGateModeEnforceExplicit();
    testGateModeInvalidDefaultsToObserve();
    testObserveModeDoesNotBlockIncomplete();
    testEnforceModeBlocksIncomplete();
    testIncompleteIssuesListFieldNamesOnly();
    testDiagnosticOmitsTranscriptAndSecrets();
    testCompleteEvaluationAccepted();
    testValidRecommendationsAccepted();
    testNumericOrTextCompetencyFieldsAccepted();
    testMissingCommunicationRejected();
    testMissingLanguageFluencyRejected();
    testMissingConfidenceRejected();
    testMissingProblemSolvingRejected();
    testMissingDigitalSkillsRejected();
    testMissingProfessionalAttitudeRejected();
    testMissingSummaryRejected();
    testEmptyStrengthsRejected();
    testEmptyWeaknessesRejected();
    testMissingFinalHrEvaluationRejected();
    testMissingOverallScoreRejected();
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
