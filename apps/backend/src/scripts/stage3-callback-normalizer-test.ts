/**
 * Stage 3 offline tests for callback normalizer + strict patch pipeline.
 * Run: npm run test:stage3-callback-normalizer
 */
import assert from 'node:assert/strict';
import {
    extractNormalizedStage3VideoEval,
    isKnownStage3VideoCallbackShape,
    normalizeStage3CallbackPayload,
} from '../services/stage3CallbackNormalizer.js';
import {
    getStage3VideoPatchIssues,
    validateStage3VideoEvaluationPersistence,
} from '../services/stage3VideoEvaluationGate.js';

/** Minimal strict patch builder mirroring server.ts contract (uses normalized input). */
function buildStrictStage3VideoPatchFromNormalized(data: Record<string, unknown>): Record<string, unknown> {
    const nested = data.videoInterviewEvaluation as Record<string, unknown> | undefined;
    const sources: unknown[] = [];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) sources.push(nested);
    sources.push(data);

    const pick = (aliases: string[]): unknown => {
        for (const src of sources) {
            if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
            const rec = src as Record<string, unknown>;
            for (const alias of aliases) {
                if (rec[alias] !== undefined && rec[alias] !== null) return rec[alias];
            }
        }
        return undefined;
    };

    const patch: Record<string, unknown> = {};
    const fields = [
        'role_understanding',
        'professional_depth',
        'problem_handling',
        'decision_making',
        'prioritization',
        'process_thinking',
        'responsibility',
        'learning_ability',
        'job_readiness',
        'final_role_fit',
    ] as const;
    for (const key of fields) {
        const v = pick([key]);
        if (v !== undefined) patch[key] = v;
    }
    const summary = pick(['summary', 'Summary']);
    if (summary !== undefined) patch.summary = String(summary).trim();
    const score = pick(['overall_score', 'Overall Score']);
    if (score !== undefined) patch.overall_score = Number(score);
    const rec = pick(['recommendation', 'Recommendation', 'Final HR Recommendation']);
    if (rec !== undefined) patch.recommendation = rec;
    return patch;
}

function completeLegacyFlatPayload(): Record<string, unknown> {
    return {
        id: '507f1f77bcf86cd799439011',
        sessionId: 'sess-legacy-001',
        ingress: 'stage3',
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
        summary: 'Strong video interview performance.',
        'Overall Score': 76,
        Recommendation: 'Consider',
    };
}

function testTopLevelLegacyFlat(): void {
    const raw = completeLegacyFlatPayload();
    assert.equal(isKnownStage3VideoCallbackShape(raw), true);
    const normalized = normalizeStage3CallbackPayload(raw);
    assert.equal(normalized.evaluationSource, 'video');
    const evalRec = extractNormalizedStage3VideoEval(raw);
    assert.equal(evalRec.role_understanding, 8);
    assert.equal(evalRec.overall_score, 76);
    assert.equal(evalRec.recommendation, 'Consider');

    const patch = buildStrictStage3VideoPatchFromNormalized(normalized);
    assert.equal(getStage3VideoPatchIssues(patch).length, 0);
}

function testNestedVideoInterviewEvaluation(): void {
    const raw = {
        id: '507f1f77bcf86cd799439011',
        sessionId: 'sess-nested-001',
        evaluationSource: 'video',
        videoInterviewEvaluation: {
            role_understanding: 9,
            professional_depth: 8,
            problem_handling: 7,
            decision_making: 8,
            prioritization: 7,
            process_thinking: 8,
            responsibility: 9,
            learning_ability: 8,
            job_readiness: 8,
            final_role_fit: 9,
            summary: 'Excellent fit.',
            overall_score: 88,
            recommendation: 'Hire',
        },
    };
    const normalized = normalizeStage3CallbackPayload(raw);
    const patch = buildStrictStage3VideoPatchFromNormalized(normalized);
    assert.equal(getStage3VideoPatchIssues(patch).length, 0);
    assert.equal(patch.recommendation, 'Hire');
}

function testNestedAiEvaluationFallback(): void {
    const raw = {
        id: '507f1f77bcf86cd799439011',
        sessionId: 'sess-ai-001',
        event: 'video_interview_transcript',
        aiEvaluation: {
            role_understanding: 6,
            professional_depth: 6,
            problem_handling: 6,
            decision_making: 6,
            prioritization: 6,
            process_thinking: 6,
            responsibility: 6,
            learning_ability: 6,
            job_readiness: 6,
            final_role_fit: 6,
            summary: 'Adequate.',
            overall_score: 60,
            recommendation: 'Consider',
        },
    };
    const normalized = normalizeStage3CallbackPayload(raw);
    assert.equal(normalized.evaluationSource, 'video');
    const patch = buildStrictStage3VideoPatchFromNormalized(normalized);
    assert.equal(getStage3VideoPatchIssues(patch).length, 0);
}

function testTopLevelWinsOverNested(): void {
    const raw = {
        evaluationSource: 'video',
        role_understanding: 9,
        videoInterviewEvaluation: {
            role_understanding: 5,
            professional_depth: 7,
            problem_handling: 7,
            decision_making: 7,
            prioritization: 7,
            process_thinking: 7,
            responsibility: 7,
            learning_ability: 7,
            job_readiness: 7,
            final_role_fit: 7,
            summary: 'Nested summary',
            overall_score: 70,
            recommendation: 'Consider',
        },
    };
    const evalRec = extractNormalizedStage3VideoEval(raw);
    assert.equal(evalRec.role_understanding, 9);
}

function testBodyWrapper(): void {
    const inner = completeLegacyFlatPayload();
    const raw = { body: inner, sessionId: 'sess-body-001' };
    const evalRec = extractNormalizedStage3VideoEval(raw);
    assert.equal(evalRec.overall_score, 76);
}

function testJsonStringNested(): void {
    const raw = {
        evaluationSource: 'video',
        videoInterviewEvaluation: JSON.stringify({
            role_understanding: 7,
            professional_depth: 7,
            problem_handling: 7,
            decision_making: 7,
            prioritization: 7,
            process_thinking: 7,
            responsibility: 7,
            learning_ability: 7,
            job_readiness: 7,
            final_role_fit: 7,
            summary: 'JSON nested',
            overall_score: 72,
            recommendation: 'Consider',
        }),
    };
    const patch = buildStrictStage3VideoPatchFromNormalized(normalizeStage3CallbackPayload(raw));
    assert.equal(getStage3VideoPatchIssues(patch).length, 0);
}

function testEmptyPayloadDoesNotForceVideo(): void {
    const raw = { id: '507f1f77bcf86cd799439011', sessionId: 'sess-empty', notes: 'files only' };
    assert.equal(isKnownStage3VideoCallbackShape(raw), false);
    const evalRec = extractNormalizedStage3VideoEval(raw);
    assert.equal(Object.keys(evalRec).length, 0);
    const normalized = normalizeStage3CallbackPayload(raw);
    assert.equal(normalized.evaluationSource, undefined);
}

function testGateObserveWithLegacyShape(): void {
    const raw = completeLegacyFlatPayload();
    const normalized = normalizeStage3CallbackPayload(raw);
    const patch = buildStrictStage3VideoPatchFromNormalized(normalized);
    const gate = validateStage3VideoEvaluationPersistence(normalized, patch);
    assert.equal(gate.ok, true);
}

function testPartialLegacyObserve(): void {
    const raw = {
        evaluationSource: 'video',
        sessionId: 'sess-partial',
        ingress: 'stage3',
        summary: 'Only summary present',
    };
    const normalized = normalizeStage3CallbackPayload(raw);
    const patch = buildStrictStage3VideoPatchFromNormalized(normalized);
    const gate = validateStage3VideoEvaluationPersistence(normalized, patch);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.ok(gate.issues.length > 0);
}

function main(): void {
    testTopLevelLegacyFlat();
    testNestedVideoInterviewEvaluation();
    testNestedAiEvaluationFallback();
    testTopLevelWinsOverNested();
    testBodyWrapper();
    testJsonStringNested();
    testEmptyPayloadDoesNotForceVideo();
    testGateObserveWithLegacyShape();
    testPartialLegacyObserve();
    console.log('stage3-callback-normalizer-test: all passed');
}

main();
