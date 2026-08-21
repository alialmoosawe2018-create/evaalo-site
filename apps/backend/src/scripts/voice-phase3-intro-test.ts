/**
 * Regression for the Phase 3 English-test announcement.
 *
 * Bug (seen in prod session b4e9e4b7): the interview jumped straight into an
 * English question without the spoken intro «هسة راح أختبر لغتك الإنكليزية. جاهز؟».
 * Two root causes:
 *   1. The intro was gated on the controller's raw-count `isFirstPhase3Message`
 *      (userMessageCount === 13) AND `!changeRequested`, so a change/clarify
 *      request at the phase 2→3 boundary swallowed it.
 *   2. `onExchangeComplete` flipped `englishTestAnnounced` using a follow-up-credit
 *      -adjusted phase that diverges from the controller's raw-count phase, so the
 *      "announced" flag was consumed as bookkeeping without the intro ever airing.
 *
 * Fix: the intro is now state-driven (`!englishTestAnnounced`), never suppressed
 * by a change request, and the flag flips only when the intro is actually emitted
 * (explicit `englishIntroEmitted` signal from the caller).
 *
 * Run: npx tsx src/scripts/voice-phase3-intro-test.ts
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

const hasArabic = (t: string) => /[؀-ۿ]/.test(t);

/** Mirror one voiceSessionCore turn: select the question, then commit state. */
function runTurn(
    sessionId: string,
    userMessageCount: number,
    opts: { changeRequested?: boolean; followUpAsked?: boolean } = {}
) {
    const state = getInterviewState(sessionId);
    const controller = getControllerOutput(userMessageCount, state, 'ar');
    const selected = selectNextQuestion(controller, state, 'ar', opts.changeRequested ?? false);
    const englishIntroEmitted =
        controller.phase === 3 && selected?.isFixed === true && selected?.isInterviewEnd !== true;
    onExchangeComplete(sessionId, 'reply', userMessageCount, {
        phase3Reached: controller.phase === 3,
        englishIntroEmitted,
        followUpAsked: opts.followUpAsked,
    });
    return { controller, selected };
}

// --- Scenario A: 3 follow-ups + a change request exactly at the 2→3 boundary ---
const A = 'p3-intro-A';
createInterviewState(A);
// Turns 0..12 are Phase 1/2. Inject 3 follow-ups (i = 4, 8, 12) so the credit-
// adjusted phase diverges from the controller's raw-count phase — the exact
// condition that used to eat the announcement.
for (let i = 0; i < 13; i += 1) {
    const { controller, selected } = runTurn(A, i, { followUpAsked: i > 0 && i % 4 === 0 });
    if (controller.phase === 3) {
        failures += 1;
        console.error(`FAIL turn ${i} should still be pre-Phase-3, got phase 3`);
    }
    if (selected?.isFixed && (selected.text ?? '').includes('أختبر')) {
        failures += 1;
        console.error(`FAIL intro fired too early at turn ${i}`);
    }
}
check('three follow-ups were counted before Phase 3', getInterviewState(A)?.totalFollowUps, 3);

// Turn 13 = first Phase-3 turn, WITH a change request — the intro must still fire.
const intro = runTurn(A, 13, { changeRequested: true });
check('turn 13 controller phase is 3', intro.controller.phase, 3);
check('intro fired despite change request (isFixed)', intro.selected?.isFixed, true);
check('intro is Arabic (preferArabic)', intro.selected?.preferArabic, true);
check('intro text is the English-test announcement', (intro.selected?.text ?? '').includes('أختبر'), true);
check('englishTestAnnounced set after intro emitted', getInterviewState(A)?.englishTestAnnounced, true);
check('no English question counted on the intro turn', getInterviewState(A)?.englishQuestionsAsked, 0);

// Turn 14 = first real English question.
const q1 = runTurn(A, 14);
check('turn 14 is a real question, not the intro again', q1.selected?.isFixed !== true, true);
check('real Phase-3 question is English (preferArabic false)', q1.selected?.preferArabic, false);
check('real Phase-3 question has no Arabic text', hasArabic(q1.selected?.text ?? ''), false);
check('englishQuestionsAsked incremented to 1', getInterviewState(A)?.englishQuestionsAsked, 1);

// Turn 15 = second English question, counter keeps advancing.
const q2 = runTurn(A, 15);
check('second Phase-3 question is English', hasArabic(q2.selected?.text ?? ''), false);
check('englishQuestionsAsked incremented to 2', getInterviewState(A)?.englishQuestionsAsked, 2);
removeInterviewState(A);

// --- Scenario B: baseline (no follow-ups, no change request) still announces ---
const B = 'p3-intro-B';
createInterviewState(B);
for (let i = 0; i < 13; i += 1) runTurn(B, i);
const introB = runTurn(B, 13);
check('baseline: intro fires at first Phase-3 turn', introB.selected?.isFixed, true);
check('baseline: intro text correct', (introB.selected?.text ?? '').includes('أختبر'), true);
const qB = runTurn(B, 14);
check('baseline: next turn is an English question', hasArabic(qB.selected?.text ?? ''), false);
removeInterviewState(B);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-phase3-intro-test: OK');
