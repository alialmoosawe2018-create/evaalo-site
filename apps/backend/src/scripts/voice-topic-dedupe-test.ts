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

const digitalCount = topics.filter((t) => t === 'digital_skills_and_tools').length;
const distinct = new Set(topics);

console.log('   Phase 1 topics asked:', topics.join(' > '));
check('digital-tools topic is asked exactly once', digitalCount, 1);
check('all five Phase 1 topics were covered', distinct.size, 5);
check(
    'the mandatory Office question owns the tools slot (recorded in memory)',
    getInterviewState(SID)?.askedTopics.includes('digital_skills_and_tools'),
    true
);
removeInterviewState(SID);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-topic-dedupe-test: OK');
