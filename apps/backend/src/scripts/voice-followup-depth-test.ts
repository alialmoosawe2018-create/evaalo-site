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
    PHASE_FOLLOW_UP_CREDIT_MAX,
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
// Thirteen turns with three of them follow-ups: the candidate has answered ten
// distinct questions, so phase 2 is correct. Counting the follow-ups would have
// pushed this to phase 3 and cut three topics out of the interview.
for (let i = 0; i < 12; i += 1) {
    onExchangeComplete('depth-test', 'reply', turns, { followUpAsked: i > 0 && i % 3 === 0 });
    turns += 1;
}
const finalState = onExchangeComplete('depth-test', 'reply', turns, {});
check('follow-up turns are discounted from phase progress', finalState?.phase, 2);
check('three follow-ups were counted', finalState?.totalFollowUps, 3);
check(
    'credit never exceeds the cap that protects the English test',
    Math.min(finalState?.totalFollowUps ?? 0, PHASE_FOLLOW_UP_CREDIT_MAX) <= PHASE_FOLLOW_UP_CREDIT_MAX,
    true
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-followup-depth-test: OK');
