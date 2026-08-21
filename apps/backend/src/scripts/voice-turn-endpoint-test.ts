/**
 * Regression for last-word truncation (prod session 1c541410: "...خلينا" cut).
 *
 * Two causes, two guards:
 *   1. The shorter punctuation silence window was applied even when the tail was
 *      an unfinalized partial — Speechmatics adds "." mid-sentence, so the window
 *      shrank and the turn was sent mid-thought. Now the short window applies
 *      only to a FINAL tail ending in punctuation.
 *   2. When the silence timer fired while the tail was still an unfinalized
 *      partial, the turn was sent before the delayed final arrived (Speechmatics
 *      lags up to ~1.35s). Now we grant one short grace for the final to land.
 *
 * Run: npx tsx src/scripts/voice-turn-endpoint-test.ts
 */
import { resolveTurnSilenceMs, shouldGraceForPendingTail } from '../evaalo-only-voice/voiceTimingEnv.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

const SHORT = 1050;
const LONG = 1300;
const sil = (tailIsFinal: boolean, endsWithPunctuation: boolean) =>
    resolveTurnSilenceMs({ tailIsFinal, endsWithPunctuation, punctuationMs: SHORT, defaultMs: LONG });

// --- silence window gating ---------------------------------------------------
check('final tail + punctuation → short window', sil(true, true), SHORT);
check('final tail + no punctuation → long window', sil(true, false), LONG);
// The fix: an unfinalized partial must NOT trigger the short window even if it
// carries a premature ".".
check('partial tail + punctuation → long window (fix)', sil(false, true), LONG);
check('partial tail + no punctuation → long window', sil(false, false), LONG);

// --- one-time grace for a pending partial tail -------------------------------
check('pending partial, not graced → grace once', shouldGraceForPendingTail(true, false), true);
check('pending partial, already graced → send now', shouldGraceForPendingTail(true, true), false);
check('no pending partial (final tail) → send now', shouldGraceForPendingTail(false, false), false);
check('no pending partial, graced → send now', shouldGraceForPendingTail(false, true), false);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-turn-endpoint-test: OK');
