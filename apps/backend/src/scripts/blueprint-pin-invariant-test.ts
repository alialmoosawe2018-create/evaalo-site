/**
 * blueprint-pin-invariant-test
 *
 * THE INVARIANT: `/end` scores an interview against the blueprint pinned when it
 * STARTED, and nothing else. A blueprint that locks afterwards does not get to
 * rewrite the past.
 *
 * It was violated by design until 2026-09-18: `/end` rebuilt the snapshot from
 * the campaign whenever the session carried none, reasoning that generation had
 * certainly finished by then so it beat losing the evaluation. It does not.
 * Generation finishing LATER is exactly the case where the agent never had the
 * competencies — the candidate was asked one set of questions and graded against
 * another. Four measured sessions: coverage 0.22, 0.11, 0 and 0.33, one ZERO.
 *
 * ⚠️ Why a SOURCE detector and not a behaviour test. The rule itself lives in
 * `pinnedBlueprintForScoring` and is unit-tested (blueprint-gate-pin-test). What
 * that cannot see is the route deciding to ask the campaign again anyway — the
 * exact shape of the original defect. Reaching it through the handler needs the
 * whole Express app and a live session; this reads the one thing that matters.
 *
 * Its own worth was proven the day it was written: a mutation that reintroduced
 * the recovery call in the route left every behaviour test green.
 *
 * Read-only. Exits non-zero when the invariant is broken.
 *
 * Run: npm run test:blueprint-pin-invariant
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'routes',
    'videoInterview.ts'
);

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

const source = readFileSync(ROUTE, 'utf8');

/**
 * The /end handler's body, where the scoring payload is assembled.
 *
 * ⚠️ Cut at the handler's own closing `});` at column 0, NOT at the next
 * `router.` — the doc comment of the following route sits before it, and a
 * looser slice swallowed it and reported a false violation the first time.
 */
function endHandler(): string {
    const start = source.indexOf("router.post('/end'");
    if (start < 0) throw new Error("could not find the /end route — has it been renamed?");
    const close = source.indexOf('\n});', start);
    if (close < 0) throw new Error('could not find the end of the /end handler');
    return source.slice(start, close + 4);
}

check('/end exists and is readable', () => {
    const body = endHandler();
    if (body.length < 500) throw new Error('the /end handler looks too small to be right');
});

check('🔴 /end never rebuilds a blueprint from the campaign', () => {
    const body = endHandler();
    for (const forbidden of [
        'loadBlueprintBundleSafe',
        'getLockedBlueprintForCampaign',
        'ensureBlueprintForCampaign',
        'buildBlueprintSnapshot',
    ]) {
        if (body.includes(forbidden)) {
            throw new Error(
                `/end calls ${forbidden}() — that is how a blueprint locked AFTER the ` +
                    `interview reaches the scorer. It must use the pin from /start only.`
            );
        }
    }
});

check('/end reads the pin through the shared rule', () => {
    const body = endHandler();
    if (!body.includes('pinnedBlueprintForScoring')) {
        throw new Error(
            '/end no longer calls pinnedBlueprintForScoring() — the rule it is supposed ' +
                'to share with its unit test'
        );
    }
});

check('/start pins readiness on BOTH session-write paths', () => {
    // Without the pin, /end has nothing to read and every interview scores blind.
    //
    // ⚠️ Counted, not merely present. /start writes a session on two paths — the
    // fresh dispatch and the prewarm reuse — and a first version of this check
    // only asked whether the field appeared ANYWHERE, so deleting the pin from
    // the main path left it green while the reuse path still carried one.
    for (const needed of ['blueprintReady:', 'blueprintPinnedAt:']) {
        const count = source.split(needed).length - 1;
        if (count < 2) {
            throw new Error(
                `${needed} appears ${count} time(s) — both the fresh and the reuse ` +
                    `session write must pin it`
            );
        }
    }
});

check('/start still refuses to begin without a ready blueprint', () => {
    if (!source.includes('BLUEPRINT_NOT_READY')) {
        throw new Error('the /start readiness guard is gone — blind interviews can begin again');
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
