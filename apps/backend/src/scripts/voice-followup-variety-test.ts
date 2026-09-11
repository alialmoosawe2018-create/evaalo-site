/**
 * Regression for follow-up repetition (prod: same "شنو صار بالضبط؟ وصفلي الموقف"
 * and the communication probe recurred). Follow-ups now rotate on two axes:
 * the evaluates offset (so one intent no longer always wins) and the variant
 * within an intent — so consecutive follow-ups differ.
 *
 * Run: npx tsx src/scripts/voice-followup-variety-test.ts
 */
import { getFollowUpPromptPair, FOLLOW_UP_GENERIC, FOLLOW_UP_BY_INTENT } from '../evaalo-only-voice/questionEngine.js';
import { POOL_QUESTIONS, PHASE1_TOPICS } from '../evaalo-only-voice/interviewConfig.js';
import { createInterviewState, getInterviewState, onExchangeComplete, removeInterviewState } from '../evaalo-only-voice/interviewState.js';

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

// ── COVERAGE: the intent table must actually reach the questions ─────────────
//
// Measured 2026-09-12, before this was fixed: of 50 pool questions only 28 (56%)
// had an `evaluates` value the table could match, so 22 fell straight through to
// the three generic seeds. 44 distinct evaluates values existed and exactly 10
// were covered. The carefully written intent table was mostly dead weight, and
// the heaviest misses were the ones that matter most: professionalism 7 uses,
// self_awareness 5, emotional_intelligence / prioritization / accountability 4
// each. This pins the coverage so it cannot silently rot again — every new pool
// question either matches an intent or gets an alias.
const genericAr = new Set(FOLLOW_UP_GENERIC.map((v) => v.ar));
let total = 0;
let matched = 0;
const misses: string[] = [];
for (const p of Object.keys(PHASE1_TOPICS).map(Number)) {
    const pool = POOL_QUESTIONS[p];
    for (const lvl of ['L1', 'L2', 'L3'] as const) {
        for (const question of pool[lvl]) {
            total += 1;
            // A question is covered when the seed it produces is NOT the generic one.
            const seed = getFollowUpPromptPair({ evaluates: question.evaluates ?? [] }, 0).ar;
            if (!genericAr.has(seed)) matched += 1;
            else misses.push(`${PHASE1_TOPICS[p]}/${lvl}: ${(question.evaluates ?? []).join('+')}`);
        }
    }
}
const pct = Math.round((matched / total) * 100);
console.log(`   intent coverage: ${matched}/${total} pool questions (${pct}%)`);
if (misses.length) misses.forEach((m) => console.log('     falls back to generic ->', m));
check('at least 90% of pool questions reach a real intent', pct >= 90);

// The six intents added on 2026-09-12 must exist and be reachable.
for (const k of ['professionalism', 'accountability', 'self_awareness', 'emotional_intelligence', 'prioritization', 'integrity', 'technical']) {
    check(`intent "${k}" is defined`, Array.isArray(FOLLOW_UP_BY_INTENT[k]) && FOLLOW_UP_BY_INTENT[k].length > 0);
}

// Spot-check a few aliases: each must resolve to its target's phrasings.
const aliasCases: Array<[string, string]> = [
    ['maturity', 'professionalism'],
    ['values', 'integrity'],
    ['time_management', 'prioritization'],
    ['digital_skills', 'technical'],
    ['reflection', 'self_awareness'],
    ['conflict_resolution', 'conflict'],
    ['patience', 'emotional_intelligence'],
];
for (const [alias, target] of aliasCases) {
    check(
        `alias ${alias} -> ${target}`,
        FOLLOW_UP_BY_INTENT[target].some((v) => v.ar === getFollowUpPromptPair({ evaluates: [alias] }, 0).ar)
    );
}

// ── THE SEED MUST COME FROM THE QUESTION THE CANDIDATE ANSWERED ─────────────
//
// On a follow-up turn voiceSessionCore still calls selectNextQuestion, and that
// question is then DISCARDED (poolUsed and topicUsed are forced to undefined).
// Its `evaluates` used to be what seeded the probe, so the follow-up was written
// for a question nobody had asked. Reproduced 2026-09-12: a candidate answered a
// teamwork question at length, the discarded pick evaluated
// ["stress_management","prioritization"], and the seed fell to the generic
// «انطيني مثال محدد صار وياك» instead of «شنو كان دورك إنت بالضبط بالفريق؟».
//
// The answered question's evaluates are now carried on the state.
const SID = 'followup-seed';
createInterviewState(SID);
onExchangeComplete(SID, 'a teamwork question was asked', 0, { evaluatesUsed: ['teamwork'] });
check(
    'the answered question evaluates are carried on the state',
    getInterviewState(SID)?.lastQuestionEvaluates?.[0] === 'teamwork'
);

// A follow-up turn then arrives, and the engine picks (and discards) something
// unrelated — the time-pressure question from the real reproduction.
const discarded = { evaluates: ['stress_management', 'prioritization'] };
const carried = getInterviewState(SID)?.lastQuestionEvaluates;
const seedFromCarried = getFollowUpPromptPair({ evaluates: carried ?? [] }, 0).ar;
check(
    'the seed is the teamwork probe, not the discarded question',
    FOLLOW_UP_BY_INTENT.teamwork.some((v) => v.ar === seedFromCarried)
);
check(
    'and it differs from what the discarded question would have produced',
    seedFromCarried !== getFollowUpPromptPair(discarded, 0).ar
);

// A follow-up turn must NOT overwrite the reference: a second follow-up on the
// same answer still deepens the same subject.
onExchangeComplete(SID, 'the follow-up itself', 1, { evaluatesUsed: undefined });
check(
    'a follow-up turn does not overwrite the carried evaluates',
    getInterviewState(SID)?.lastQuestionEvaluates?.[0] === 'teamwork'
);
removeInterviewState(SID);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-followup-variety-test: OK');
