/**
 * Regression for the repeated question in session c6660f6c (2026-09-08).
 *
 * The candidate was asked about his languages, answered, and was asked about his
 * languages again. Not a race — arithmetic. Phase-2 topic selection was:
 *
 *   (userMessageCount + (changeRequested ? 1 : 0)) % PHASE2_TOPIC_KEYS.length
 *
 * The +1 that a change request applies is transient: it advances THIS turn to the
 * next topic, and then the counter advances the NEXT turn to that same topic. So
 * every «غيّر السؤال» in phase 2 guaranteed a repeat on the turn after it, unless
 * the candidate happened to ask to change again (which is what masked it at the
 * end of that session).
 *
 * The text-level duplicate guard could not see it either: the repeat came out as
 * the leaked instruction text, which looks nothing like the previous question.
 *
 * Selection is now driven by what was actually asked.
 *
 * Run: npm run test:voice-phase2-topic-memory
 */
import { pickPhase2Topic } from '../evaalo-only-voice/questionEngine.js';
import { PHASE2_TOPIC_KEYS, getPhase2TopicKeys } from '../evaalo-only-voice/interviewConfig.js';
import type { InterviewState } from '../evaalo-only-voice/interviewState.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const st = (asked: string[], userMessageCount = 0) =>
    ({ askedPhase2Topics: asked, userMessageCount }) as unknown as InterviewState;

// ── the old formula, kept here as the thing being disproved ──────────────────
const oldPick = (userMessageCount: number, change: boolean) =>
    PHASE2_TOPIC_KEYS[(userMessageCount + (change ? 1 : 0)) % PHASE2_TOPIC_KEYS.length];

console.log('— the defect, reproduced from the real session —');
check('old: turn 10 + change → language', oldPick(10, true), 'language');
check('old: turn 11 no change → language AGAIN', oldPick(11, false), 'language');
check('old: the two collide', oldPick(10, true) === oldPick(11, false), true);

console.log('\n— and it was never specific to that turn —');
let collisions = 0;
for (let n = 0; n < PHASE2_TOPIC_KEYS.length * 3; n += 1) {
    if (oldPick(n, true) === oldPick(n + 1, false)) collisions += 1;
}
check('old: EVERY change request collided with the next turn', collisions, PHASE2_TOPIC_KEYS.length * 3);

// ── the fix: selection follows what was actually asked ───────────────────────
console.log('\n— replaying the same session against the new selection —');
const asked: string[] = [];
const serve = (change: boolean) => {
    const k = pickPhase2Topic(st(asked, asked.length), change);
    if (k === null) throw new Error("the bank is not exhausted here — null means the picker regressed");
    asked.push(k);
    return k;
};
const first = serve(false);
const afterChange = serve(true);
const next = serve(false);
check('a topic is served', typeof first, 'string');
check('a change request moves on', afterChange === first, false);
check('the next turn does NOT repeat it', next === afterChange, false);
check('nor the one before', next === first, false);
check('three turns, three distinct topics', new Set([first, afterChange, next]).size, 3);

console.log('\n— every topic is served exactly once before any repeat —');
const seen: string[] = [];
for (let i = 0; i < PHASE2_TOPIC_KEYS.length; i += 1) {
    // alternate change requests to prove they cannot cause a collision either
    const k = pickPhase2Topic(st(seen, seen.length), i % 2 === 1);
    if (k === null) throw new Error("exhausted too early: the base six must all be servable");
    seen.push(k);
}
check('all topics covered', new Set(seen).size, PHASE2_TOPIC_KEYS.length);
check('no topic served twice', seen.length, new Set(seen).size);

/* ── what happens once the bank runs out — CHANGED 2026-09-23 ──────────────
   This used to assert a round-robin fallback: once every topic had been asked the
   picker returned `keys[userMessageCount % keys.length]`, so the interview re-asked
   the whole bank in order. That IS the repetition heard in the two English sessions
   of 2026-09-23 (6cfb7d62, 2718fd5f), so the fallback is gone: the picker now reports
   exhaustion with `null` and `selectNextQuestion` answers it with a deepening question
   about what the candidate just said. Pinned here so the old behaviour cannot return. */
console.log('\n— once they run out, the picker says so instead of repeating —');
const allAsked = [...getPhase2TopicKeys()];
check('exhaustion is reported, not papered over', pickPhase2Topic(st(allAsked, 7), false), null);
check('and no counter value revives a repeat', pickPhase2Topic(st(allAsked, 8), true), null);
check(
    'one short of the end still serves that last topic',
    pickPhase2Topic(st(allAsked.slice(0, -1), 7), false),
    allAsked[allAsked.length - 1]
);

console.log('\n— a change request must not skip a topic into oblivion —');
// With one topic left, a change request has nowhere to go: serve it, do not
// return undefined and do not fall through to the exhausted-rotation branch.
const BANK = getPhase2TopicKeys();
const oneLeft = BANK.slice(0, BANK.length - 1);
const last = BANK[BANK.length - 1];
check('the last remaining topic is still served on a change', pickPhase2Topic(st([...oneLeft], 5), true), last);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-phase2-topic-memory-test: OK');
