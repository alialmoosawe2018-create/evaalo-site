/**
 * The wiring, not the libraries.
 *
 * The Phase 2 plan fix is four library changes plus four one-line edits inside
 * `voiceSessionCore.handleVoiceWsConnection` — and every one of those four
 * DEFAULTS BACK TO THE OLD BEHAVIOUR when omitted:
 *
 *   • `sessionLanguage` missing from `onExchangeComplete`  ⇒ the reported phase is
 *     computed with the Arabic thresholds again, so every English interview once
 *     more claims `phaseReached: 3`.
 *   • `deepDiveUsed` missing                               ⇒ `phase2DeepDives` never
 *     advances, so every deepening question uses angle 0 — the same question, which
 *     is the defect this all started from.
 *   • `userMessageCount` missing from `endedBeforeEnglishPhase` ⇒ no English
 *     interview is ever reported as cut short.
 *   • `phase1TopicsExhausted` missing from `getControllerOutput` ⇒ Phase 2 opens
 *     four turns later than production and the whole thing looks fine in a replay.
 *
 * A unit test of the libraries cannot see any of that: it builds its own call.
 * So this file reads the source of voiceSessionCore and asserts the calls carry
 * their arguments. It is a text check, deliberately — it is the only thing that
 * fails when someone refactors the handler and drops a line.
 *
 * Run: npx tsx src/scripts/voice-phase2-wiring-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = readFileSync(join(HERE, '..', 'evaalo-only-voice', 'voiceSessionCore.ts'), 'utf8');

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

/** The body of the first call to `fn(` in the source, brace/paren balanced. */
function callBody(source: string, fn: string): string {
    const at = source.indexOf(fn + '(');
    if (at < 0) return '';
    let depth = 0;
    for (let i = at + fn.length; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
            depth -= 1;
            if (depth === 0) return source.slice(at, i + 1);
        }
    }
    return '';
}

const exchange = callBody(CORE, 'onExchangeComplete');
check('onExchangeComplete is called at all', exchange.length > 0, true);
check('…and carries the session language', /sessionLanguage:\s*interviewLanguage/.test(exchange), true);
check('…and reports a deepening turn', /deepDiveUsed:/.test(exchange), true);
check('…and still books the Phase 2 topic', /phase2TopicUsed:/.test(exchange), true);

const controller = callBody(CORE, 'getControllerOutput');
check('getControllerOutput is called at all', controller.length > 0, true);
check('…and is told whether Phase 1 topics ran out', /phase1TopicsExhausted/.test(controller), true);
check('…and is told the session language', /interviewLanguage/.test(controller), true);

const early = callBody(CORE, 'endedBeforeEnglishPhase');
check('endedBeforeEnglishPhase is called at all', early.length > 0, true);
check('…and carries the session language', /sessionLanguage:\s*interviewLanguage/.test(early), true);
check('…and the turn count it judges English sessions by', /userMessageCount:/.test(early), true);

/* The log label lied for months: every Phase 2 turn printed `mode=rephrase`,
   because a Phase 2 question carries `topicKey` but none of `topic` /
   `availableTopics` / `isFixed`, so the ternary fell through to its last arm.
   That label cost a full day of wrong diagnosis on 2026-09-23. */
check('the PHASE log names Phase 2 turns for what they are', /phase2:\$\{selectedQuestion\.topicKey\}/.test(CORE), true);
check('and names a deepening turn', /'deep-dive'/.test(CORE), true);
check('and no longer calls anything "rephrase"', /'rephrase'/.test(CORE), false);

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall checks passed');
