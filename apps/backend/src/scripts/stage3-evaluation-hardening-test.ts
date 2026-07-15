/**
 * Stage 3 video evaluation gate tests (offline only).
 * Run: npm run test:stage3-eval-gate
 */
import assert from 'node:assert/strict';
import {
    formatStage3EvaluationGateDiagnostic,
    getStage3EvaluationGateMode,
    getStage3VideoPatchIssues,
    isCompleteStage3VideoPatch,
    isStage3RejectOrSpamIngress,
    isStage3VideoSuccessEvaluationAttempt,
    shouldBlockStage3IncompleteEvaluation,
    STAGE3_INCOMPLETE_EVALUATION_ERROR,
    STAGE3_INCOMPLETE_EVALUATION_MESSAGE,
    validateStage3VideoEvaluationPersistence,
} from '../services/stage3VideoEvaluationGate.js';

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

function completeVideoPatch(): Record<string, unknown> {
    return {
        role_understanding: 8,
        professional_depth: 7,
        problem_handling: 8,
        decision_making: 7,
        prioritization: 6,
        process_thinking: 7,
        responsibility: 8,
        learning_ability: 7,
        job_readiness: 8,
        final_role_fit: 7,
        summary: 'Strong candidate with relevant leadership experience.',
        overall_score: 76,
        recommendation: 'Consider',
    };
}

function testGateModeUnsetDefaultsToObserve(): void {
    withEnv({ STAGE3_EVALUATION_GATE_MODE: undefined }, () => {
        assert.equal(getStage3EvaluationGateMode(), 'observe');
    });
}

function testObserveModeDoesNotBlockIncomplete(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = { ...completeVideoPatch() };
    delete patch.role_understanding;
    const validation = validateStage3VideoEvaluationPersistence(data, patch);
    assert.equal(validation.ok, false);
    assert.equal(shouldBlockStage3IncompleteEvaluation('observe', validation), false);
}

function testEnforceModeBlocksIncomplete(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = { ...completeVideoPatch() };
    delete patch.summary;
    const validation = validateStage3VideoEvaluationPersistence(data, patch);
    assert.equal(validation.ok, false);
    assert.equal(shouldBlockStage3IncompleteEvaluation('enforce', validation), true);
}

function testCompleteEvaluationAccepted(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = completeVideoPatch();
    assert.equal(isCompleteStage3VideoPatch(patch), true);
    const result = validateStage3VideoEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testMissingCompetencyRejected(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = { ...completeVideoPatch() };
    delete patch.decision_making;
    assertMissingFieldRejected(data, patch, ['decision_making']);
}

function testInvalidCompetencyScoreRejected(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = { ...completeVideoPatch(), prioritization: 11 };
    assertMissingFieldRejected(data, patch, ['prioritization']);
}

function testMissingSummaryRejected(): void {
    const data = { evaluationSource: 'video', ingress: 'stage3' };
    const patch = { ...completeVideoPatch(), summary: '' };
    assertMissingFieldRejected(data, patch, ['summary']);
}

function testStage3RejectPathUnaffected(): void {
    const data = {
        evaluationSource: 'video',
        ingress: 'stage3-reject',
        rejectCode: 'duplicate',
    };
    const patch = { summary: 'Rejected' };
    assert.equal(isStage3RejectOrSpamIngress(data), true);
    assert.equal(isStage3VideoSuccessEvaluationAttempt(data, patch), false);
    const result = validateStage3VideoEvaluationPersistence(data, patch);
    assert.equal(result.ok, true);
}

function testDiagnosticSafe(): void {
    const diagnostic = formatStage3EvaluationGateDiagnostic({
        mode: 'observe',
        gateResult: 'incomplete',
        issues: ['summary', 'overall_score'],
        candidateRef: '507f****9011',
    });
    assert.match(diagnostic, /stage3_evaluation_gate/);
    assert.match(diagnostic, /issues=summary,overall_score/);
    assert.doesNotMatch(diagnostic, /transcript|secret/i);
}

function testIssuesList(): void {
    const patch = { ...completeVideoPatch() };
    delete patch.job_readiness;
    patch.overall_score = 150;
    const issues = getStage3VideoPatchIssues(patch);
    assert.ok(issues.includes('job_readiness'));
    assert.ok(issues.includes('overall_score'));
}

function assertMissingFieldRejected(
    data: Record<string, unknown>,
    patch: Record<string, unknown>,
    expectedIssues: string[]
): void {
    assert.equal(isCompleteStage3VideoPatch(patch), false);
    const result = validateStage3VideoEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.error, STAGE3_INCOMPLETE_EVALUATION_ERROR);
        assert.equal(result.message, STAGE3_INCOMPLETE_EVALUATION_MESSAGE);
        for (const issue of expectedIssues) {
            assert.ok(result.issues.includes(issue), `expected issue ${issue}`);
        }
    }
}

function main(): void {
    testGateModeUnsetDefaultsToObserve();
    testObserveModeDoesNotBlockIncomplete();
    testEnforceModeBlocksIncomplete();
    testCompleteEvaluationAccepted();
    testMissingCompetencyRejected();
    testInvalidCompetencyScoreRejected();
    testMissingSummaryRejected();
    testStage3RejectPathUnaffected();
    testDiagnosticSafe();
    testIssuesList();
    console.log('stage3-evaluation-hardening-test: all passed');
}

main();
