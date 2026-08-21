/**
 * Regression for follow-up repetition (prod: same "شنو صار بالضبط؟ وصفلي الموقف"
 * and the communication probe recurred). Follow-ups now rotate on two axes:
 * the evaluates offset (so one intent no longer always wins) and the variant
 * within an intent — so consecutive follow-ups differ.
 *
 * Run: npx tsx src/scripts/voice-followup-variety-test.ts
 */
import { getFollowUpPromptPair, FOLLOW_UP_GENERIC, FOLLOW_UP_BY_INTENT } from '../evaalo-only-voice/questionEngine.js';

let failures = 0;
function check(name: string, cond: boolean) {
    if (cond) console.log(`ok   ${name}`);
    else { failures += 1; console.error(`FAIL ${name}`); }
}

// A pool question whose evaluates lists communication first (the intent that used
// to dominate). Rotating should not return the same probe three times running.
const q = { evaluates: ['communication', 'clarity', 'motivation', 'role_fit'] };
const r0 = getFollowUpPromptPair(q, 0).ar;
const r1 = getFollowUpPromptPair(q, 1).ar;
const r2 = getFollowUpPromptPair(q, 2).ar;
console.log('   rotations:', [r0, r1, r2].join(' | '));
check('three consecutive follow-ups are all distinct', new Set([r0, r1, r2]).size === 3);
check('rotation 0 uses the first intent (communication)', FOLLOW_UP_BY_INTENT.communication.some((v) => v.ar === r0));

// No matching intent -> generic, and generic rotates through its variants.
const noMatch = { evaluates: ['totally_unknown_intent'] };
const g0 = getFollowUpPromptPair(noMatch, 0).ar;
const g1 = getFollowUpPromptPair(noMatch, 1).ar;
check('generic fallback used when no intent matches', FOLLOW_UP_GENERIC.some((v) => v.ar === g0));
check('generic rotates (0 != 1)', g0 !== g1);

// Empty / missing evaluates -> generic, still valid.
check('empty evaluates -> generic', FOLLOW_UP_GENERIC.some((v) => v.ar === getFollowUpPromptPair({ evaluates: [] }, 0).ar));
check('undefined question -> generic', FOLLOW_UP_GENERIC.some((v) => v.ar === getFollowUpPromptPair(undefined, 0).ar));

// Every intent variant is a single clause (no compound "و ... و" chains / no "?" mid).
const allVariants = [...Object.values(FOLLOW_UP_BY_INTENT).flat(), ...FOLLOW_UP_GENERIC];
check('all follow-up variants are short (<= 9 words AR)', allVariants.every((v) => v.ar.trim().split(/\s+/).length <= 9));
check('no follow-up variant has two question marks', allVariants.every((v) => (v.ar.match(/؟/g) || []).length <= 1));

// Aliases resolve (e.g. collaboration -> teamwork, learning_agility -> learning).
check('alias collaboration -> teamwork', FOLLOW_UP_BY_INTENT.teamwork.some((v) => v.ar === getFollowUpPromptPair({ evaluates: ['collaboration'] }, 0).ar));

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-followup-variety-test: OK');
