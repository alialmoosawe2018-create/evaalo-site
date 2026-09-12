/**
 * Regression for the follow-up depth tuning.
 *
 * The earlier cap made depth depend on the candidate's vocabulary: a follow-up
 * only fired when the answer was 15+ words AND contained an explicit word like
 * "تحدي" or "مشكلة", so a candidate describing real experience in plain words
 * was never probed. A long answer now earns a follow-up on its own, and
 * follow-up turns no longer push the phase forward and eat topic coverage.
 *
 * Run: npx tsx src/scripts/voice-followup-depth-test.ts
 */
import { detectIntent } from '../evaalo-only-voice/questionEngine.js';
import {
    createInterviewState,
    onExchangeComplete,
} from '../evaalo-only-voice/interviewState.js';
import { getControllerOutput } from '../evaalo-only-voice/interviewController.js';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `كلمة${i}`).join(' ');

// --- trigger -----------------------------------------------------------------
check(
    'passing mention stays normal (too short to be a story)',
    detectIntent('اي صار عندي مشكلة'),
    'normal'
);
check(
    'explicit challenge at the new 10-word floor',
    detectIntent(`واجهت مشكلة بالمشروع ${words(9)}`),
    'challenge'
);
check(
    'medium answer with no challenge word is still normal',
    detectIntent(words(14)),
    'normal'
);
check(
    'long detailed answer earns depth without the keyword',
    detectIntent(words(26)),
    'challenge'
);
check('clarification keeps priority', detectIntent('ما فهمت السؤال'), 'clarification');
check('change request keeps priority', detectIntent('ممكن نغير السؤال'), 'change_question');

// --- follow-ups must not consume the phase budget ----------------------------
createInterviewState('depth-test');
let turns = 0;
// A follow-up after every third answer — the densest shape the gap rule allows.
// ── THE TWO PHASE COMPUTATIONS MUST AGREE ────────────────────────────────────
//
// This block used to assert the opposite: that thirteen turns with three
// follow-ups left `state.phase` at 2, on the reasoning that "counting the
// follow-ups would have pushed this to phase 3 and cut three topics out of the
// interview". That reasoning was wrong, and the discount it protected did real
// damage.
//
// `state.phase` cuts no topics. It is read in four places and every one of them
// is a report: two metrics, and `phaseReached` twice. The phase that actually
// selects questions comes from `interviewController`, which has always been
// handed the RAW count. So the discount never lengthened phase 1 by a single
// turn — while `phaseReached` inherited it, and `endedBeforeEnglishPhase` flips
// `earlyEnd` to true below 3. An interview with three follow-ups reached the
// English test and was reported as having stopped at phase 2, so the evaluator
// was told a complete interview was incomplete and its real score was discarded.
//
// The invariant now, asserted directly: the state's phase equals the
// controller's phase at the same count. If they ever diverge again, this fails.
for (let i = 0; i < 12; i += 1) {
    onExchangeComplete('depth-test', 'reply', turns, { followUpAsked: i > 0 && i % 3 === 0 });
    turns += 1;
}
const finalState = onExchangeComplete('depth-test', 'reply', turns, {});
check('three follow-ups were counted', finalState?.totalFollowUps, 3);
check(
    'thirteen turns is phase 3, follow-ups or not',
    finalState?.phase,
    3
);
check(
    'and it agrees with the controller, which is what picks the questions',
    finalState?.phase,
    getControllerOutput(finalState?.userMessageCount ?? 0, finalState, 'ar').phase
);
// Walk the whole range: the two must never disagree at any count.
let divergences = 0;
for (let n = 0; n <= 16; n += 1) {
    const stateSide = n < 9 ? 1 : n < 13 ? 2 : 3;
    if (getControllerOutput(n, undefined, 'ar').phase !== stateSide) divergences += 1;
}
check('no count between 0 and 16 disagrees', divergences, 0);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-followup-depth-test: OK');
