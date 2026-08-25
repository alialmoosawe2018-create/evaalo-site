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
import {
    resolveTurnSilenceMs,
    shouldGraceBeforeSend,
    tailLooksIncomplete,
} from '../evaalo-only-voice/voiceTimingEnv.js';

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
const EXTRA = 700;
const sil = (tailIsFinal: boolean, endsWithPunctuation: boolean, text?: string) =>
    resolveTurnSilenceMs({
        tailIsFinal,
        endsWithPunctuation,
        punctuationMs: SHORT,
        defaultMs: LONG,
        text,
        incompleteTailExtraMs: EXTRA,
    });

// --- silence window gating ---------------------------------------------------
check('final tail + punctuation → short window', sil(true, true), SHORT);
check('final tail + no punctuation → long window', sil(true, false), LONG);
// The fix: an unfinalized partial must NOT trigger the short window even if it
// carries a premature ".".
check('partial tail + punctuation → long window (fix)', sil(false, true), LONG);
check('partial tail + no punctuation → long window', sil(false, false), LONG);

// --- one-time grace before sending ------------------------------------------
check('not graced yet → grace once', shouldGraceBeforeSend(false), true);
check('already graced → send now', shouldGraceBeforeSend(true), false);

// --- incomplete tails (prod session 788a5d4a) --------------------------------
// A truncated word: "كم" is the start of "كأخصائي" — the turn was sent mid-word.
check('truncated arabic word is incomplete', tailLooksIncomplete('اني ما اشتغلت كم'), true);
check('dangling connector is incomplete', tailLooksIncomplete('اقدر اعالج الموضوع في'), true);
check('dangling english connector is incomplete', tailLooksIncomplete('I handled it and'), true);
check('complete sentence is not incomplete', tailLooksIncomplete('اشتغلت كموظف موارد بشرية.'), false);
check('standalone short answer is not incomplete', tailLooksIncomplete('لا'), false);

// An incomplete tail must extend the window even when the STT appended a ".".
check('incomplete tail + punctuation → extended', sil(true, true, 'الموضوع في.'), LONG + EXTRA);
check('incomplete tail + no punctuation → extended', sil(true, false, 'اني ما اشتغلت كم'), LONG + EXTRA);
// Short answers must not take the fast path: a 3-word reply is usually unfinished.
check('short reply + punctuation → long window', sil(true, true, 'ما اشتغلت هناك.'), LONG);
check(
    'long complete reply + punctuation → short window',
    sil(true, true, 'اشتغلت كموظف موارد بشرية في شركة انشاءات.'),
    SHORT
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nvoice-turn-endpoint-test: OK');
