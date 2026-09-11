/**
 * Regression for Phase 1 topic repetition (the "tools" topic asked ~3×).
 *
 * In prod session b4e9e4b7 the digital-tools topic recurred: a pool question,
 * the mandatory Microsoft Office question, then more tools questions — because
 *   (a) pool questions were never recorded in `askedTopics` (only topic-choice
 *       mode was), so topic memory could not exclude an already-covered topic;
 *   (b) the inference path re-selected the same pool whenever the candidate kept
 *       mentioning tools, and nothing reserved the tools slot for the mandatory
 *       Office question.
 *
 * Fix: every Phase 1 question (pool + mandatory) records its topic; the pool
 * picker walks past already-covered topics; the tools pool is reserved for the
 * mandatory Office question so the topic is asked exactly once.
 *
 * Run: npx tsx src/scripts/voice-topic-dedupe-test.ts
 */
import { getControllerOutput } from '../evaalo-only-voice/interviewController.js';
import { selectNextQuestion } from '../evaalo-only-voice/questionEngine.js';
import {
    createInterviewState,
    getInterviewState,
    onExchangeComplete,
    removeInterviewState,
} from '../evaalo-only-voice/interviewState.js';
import { PHASE1_TOPICS } from '../evaalo-only-voice/interviewConfig.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// A tools-heavy answer every turn — this is what pulled inference back to the
// digital-tools pool over and over.
const TOOLS_ANSWER = 'استخدم برامج مايكروسوفت واكسل وادوات رقمية وانظمة حاسوب كثيرة';

/** Mirror one voiceSessionCore Phase 1 turn: select, then commit topic memory. */
function runTurn(sid: string, count: number) {
    const state = getInterviewState(sid);
    const controller = getControllerOutput(count, state, 'ar');
    const selected = selectNextQuestion(controller, state, 'ar', false, undefined, TOOLS_ANSWER, []);
    onExchangeComplete(sid, selected?.text ?? 'q', count, {
        mandatoryQuestion1Asked: controller.mandatoryQuestionDue === 1,
        mandatoryQuestion2Asked: controller.mandatoryQuestionDue === 2,
        /* ⚠️ Without this the role mandatory never records as asked and the
           controller re-issues it every turn — this simulation asked it SEVEN
           times in a row and starved three phase-1 topics. Any caller that
           schedules a mandatory question must also report it back. */
        mandatoryQuestion3Asked: controller.mandatoryQuestionDue === 3,
        poolUsed: selected?.pool,
        topicUsed: selected?.topic, // topic memory is enabled by default
        phase3Reached: controller.phase === 3,
    });
    return { controller, selected };
}

const SID = 'topic-dedupe';
createInterviewState(SID);
const topics: string[] = [];
// Phase 1 spans user messages 0..8 (9 questions).
for (let i = 0; i < 9; i += 1) {
    const { controller, selected } = runTurn(SID, i);
    if (controller.phase !== 1) break;
    if (selected?.topic) topics.push(selected.topic);
}

const technicalCount = topics.filter((t) => t === 'technical_skills_and_tools').length;
const distinct = new Set(topics);

console.log('   Phase 1 topics asked:', topics.join(' > '));
check('technical topic is asked exactly once', technicalCount, 1);
/* Every pool topic, plus `role_task_and_fit` — a mandatory since 2026-09-10 that
   books its own key so a later pool cannot repeat it. The pool topics are still
   all covered: the role question is added to the phase, not taken out of it. */
const POOL_TOPICS = Object.values(PHASE1_TOPICS);
check('every Phase 1 pool topic was covered', POOL_TOPICS.every((t) => distinct.has(t)), true);
check('the role question is asked exactly once', topics.filter((t) => t === 'role_task_and_fit').length, 1);
check('and nothing else crept in', distinct.size, POOL_TOPICS.length + 1);
check(
    'the mandatory Office question owns the technical slot (recorded in memory)',
    getInterviewState(SID)?.askedTopics.includes('technical_skills_and_tools'),
    true
);

/* ── what widening the banks bought, stated as a number ──────────────────────
   Phase 1 is nine turns. The mandatories book two pool topics (warmup and
   technical), so the free turns chase POOL_COUNT - 2 fresh ones. With five
   pools that left three fresh topics for six free turns — three repeats. With
   seven it leaves five, so at most one turn has nothing new left, and in
   production the phase-1 early exit hands that turn to phase 2 instead.

   This simulation calls the engine directly, so it does NOT apply that early
   exit — which is exactly why one repeat still shows here. */
const repeats = topics.length - distinct.size;
check('at most one repeated topic remains across the nine turns', repeats <= 1, true);
removeInterviewState(SID);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-topic-dedupe-test: OK');
