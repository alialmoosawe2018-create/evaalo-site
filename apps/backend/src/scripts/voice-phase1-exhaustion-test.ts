/**
 * Phase 1 hands its leftover turns to phase 2 once its topics run out.
 *
 * THE ARITHMETIC IS THE DEFECT. Phase 1 is nine turns and has five topics
 * (PHASE1_TOPICS). Two of those five are booked by mandatory questions — the
 * opener books `warmup_and_self_introduction` and the Office question books
 * `digital_skills_and_tools` — so six free turns chase three fresh topics.
 * Three turns per interview therefore have no unasked topic left, and the
 * diversity guard in questionEngine has no unbooked pool to move to: it keeps
 * whatever the last answer inferred, and the subject comes back.
 *
 * Measured in production session 621efd4e (2026-09-11): turn 1 asked about
 * digital tools, turn 4 was the Office mandatory, and turn 8 returned to the
 * same subject with a different question. The owner heard it as a repeat.
 *
 * Rather than spend those turns on ground already covered, phase 1 ends when
 * its topics are exhausted and phase 2 — six topics built from the candidate's
 * own file, which four turns never covered anyway — gets them instead.
 *
 * TWO GUARDS, both asserted below:
 *   1. Never leave phase 1 with a mandatory question unasked. Those three are
 *      the ground every candidate is compared on; an early exit that skipped
 *      one would break the comparison it exists to protect.
 *   2. The caller only passes the flag when it has the candidate's profile.
 *      Phase 2 without a file falls back to generic questions that are weaker
 *      than the phase-1 banks, so a public session with no candidate row must
 *      keep the old behaviour. That gate lives at the call site
 *      (voiceSessionCore) and is represented here by passing `false`.
 *
 * Run: npm run test:voice-phase1-exhaustion
 */
import { getControllerOutput } from '../evaalo-only-voice/interviewController.js';
import { getAvailableTopicsForPhase1 } from '../evaalo-only-voice/questionEngine.js';
import { PHASE1_TOPICS } from '../evaalo-only-voice/interviewConfig.js';
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

const ALL_TOPICS = Object.values(PHASE1_TOPICS);

/** A state that has asked everything the guards care about. */
function state(over: Partial<InterviewState> = {}): InterviewState {
    return {
        firstMandatoryAsked: true,
        roleMandatoryAsked: true,
        secondMandatoryAsked: true,
        askedTopics: [...ALL_TOPICS],
        askedPools: [],
        askedPhase2Topics: [],
        userMessageCount: 6,
        ...over,
    } as unknown as InterviewState;
}

// ── the premise: five topics, and two of them are spoken for ─────────────────
check('phase 1 has exactly five topics', ALL_TOPICS.length, 5);
check(
    'a fresh state has all five available',
    getAvailableTopicsForPhase1(state({ askedTopics: [] })).length,
    5
);
check(
    'and none once they are all booked',
    getAvailableTopicsForPhase1(state()).length,
    0
);

// ── the old behaviour is untouched when the flag is absent ───────────────────
check(
    'no flag at all: turn 6 is still phase 1',
    getControllerOutput(6, state(), 'ar').phase,
    1
);
check(
    'flag false (public session, no profile): turn 6 is still phase 1',
    getControllerOutput(6, state(), 'ar', false).phase,
    1
);
check(
    'topics still available: turn 6 is phase 1 even with the flag wired',
    getControllerOutput(6, state({ askedTopics: ALL_TOPICS.slice(0, 3) }), 'ar', false).phase,
    1
);

// ── the fix ──────────────────────────────────────────────────────────────────
check(
    'topics exhausted + all mandatories asked: turn 6 moves to phase 2',
    getControllerOutput(6, state(), 'ar', true).phase,
    2
);
check(
    'and no mandatory is due there',
    getControllerOutput(6, state(), 'ar', true).mandatoryQuestionDue,
    undefined
);

// ── guard 1: a pending mandatory pins the interview in phase 1 ───────────────
check(
    'opener still unasked: stays in phase 1',
    getControllerOutput(6, state({ firstMandatoryAsked: false }), 'ar', true).phase,
    1
);
check(
    'role question still unasked: stays in phase 1',
    getControllerOutput(6, state({ roleMandatoryAsked: false }), 'ar', true).phase,
    1
);
check(
    'Office still unasked: stays in phase 1',
    getControllerOutput(6, state({ secondMandatoryAsked: false }), 'ar', true).phase,
    1
);
check(
    'and it is still DUE, not skipped',
    getControllerOutput(6, state({ secondMandatoryAsked: false }), 'ar', true).mandatoryQuestionDue,
    2
);

// ── the early exit must not reach past phase 2 ───────────────────────────────
//
// It only removes the lower bound on leaving phase 1. The phase-2 -> phase-3
// boundary is still the raw count, so the English test cannot be pulled
// forward, and it cannot be skipped either.
check(
    'turn 12 is phase 2, exhausted or not',
    getControllerOutput(12, state(), 'ar', true).phase,
    2
);
check(
    'turn 13 is phase 3 as always',
    getControllerOutput(13, state(), 'ar', true).phase,
    3
);
check(
    'turn 13 is phase 3 without the flag too',
    getControllerOutput(13, state(), 'ar').phase,
    3
);

// ── English sessions: same rule, and still no phase 3 ────────────────────────
check(
    'english, topics left: turn 6 is phase 1',
    getControllerOutput(6, state({ askedTopics: [] }), 'en', false).phase,
    1
);
check(
    'english, exhausted: turn 6 moves to phase 2',
    getControllerOutput(6, state(), 'en', true).phase,
    2
);
check(
    'english never reaches phase 3, even at turn 20',
    getControllerOutput(20, state(), 'en', true).phase,
    2
);

// ── a turn-by-turn sanity walk of the shape this produces ────────────────────
//
// Booked as the real session did: warmup at 0 (opener), one topic at 1, role at
// 2 (its own key, not a phase-1 topic), one topic at 3, digital at 4 (Office),
// the last topic at 5. From turn 6 there is nothing fresh left.
const walk: Array<{ count: number; asked: string[]; expect: 1 | 2 }> = [
    { count: 1, asked: [ALL_TOPICS[0]!], expect: 1 },
    { count: 3, asked: ALL_TOPICS.slice(0, 2), expect: 1 },
    { count: 5, asked: ALL_TOPICS.slice(0, 4), expect: 1 },
    { count: 6, asked: [...ALL_TOPICS], expect: 2 },
    { count: 7, asked: [...ALL_TOPICS], expect: 2 },
];
for (const w of walk) {
    const exhausted = getAvailableTopicsForPhase1(state({ askedTopics: w.asked })).length === 0;
    check(
        `turn ${w.count} with ${w.asked.length}/5 booked -> phase ${w.expect}`,
        getControllerOutput(w.count, state({ askedTopics: w.asked }), 'ar', exhausted).phase,
        w.expect
    );
}

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-phase1-exhaustion-test: OK');
