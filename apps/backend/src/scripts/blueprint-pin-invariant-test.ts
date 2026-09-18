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
 * that cannot see is the code deciding to ask the campaign again anyway — the
 * exact shape of the original defect. Reaching it through the handler needs the
 * whole Express app and a live session; this reads the one thing that matters.
 *
 * Its own worth was proven the day it was written: a mutation that reintroduced
 * the recovery call in the route left every behaviour test green.
 *
 * 🔴 AND ITS BLIND SPOT WAS PROVEN IN PRODUCTION THE SAME DAY. The first version
 * read only the `/end` handler, so it reported a clean invariant while a TWIN
 * recovery sat one module downstream, in `n8nService.sendVideoTranscriptToN8N` —
 * the last hop before the scorer. On 2026-09-18 12:13Z that twin handed 10
 * recovered competencies to a retired blind prewarm session with no session row
 * at all, producing a second 0/Reject evaluation for an interview it never
 * conducted. Deleting the front door while the back door stayed open bought
 * nothing.
 *
 * So this file no longer reads one handler. It sweeps EVERY module under src/
 * that can reach the campaign blueprint, and fails on any caller that is not a
 * consciously allowlisted one. A new recovery in a new file is a new red line,
 * not a silent pass.
 *
 * Read-only. Exits non-zero when the invariant is broken.
 *
 * Run: npm run test:blueprint-pin-invariant
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = join(SRC, 'routes', 'videoInterview.ts');

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

/* ───────────────────────── the repo-wide sweep ─────────────────────────── */

/** Reaching the campaign's locked blueprint is only possible through these two. */
const RECOVERY_APIS = ['getLockedBlueprintForCampaign', 'buildBlueprintSnapshot'] as const;

/**
 * The only places allowed to reach it, and why.
 *
 * ⚠️ Adding a path here is a decision about candidate fairness, not a formality:
 * it says this code may hand the scorer competencies the interview did not use.
 * `videoInterview.ts` qualifies because its calls PIN at /start (the checks above
 * assert /end itself stays clean); `interviewBlueprints.ts` is a read endpoint
 * that never feeds a score.
 */
const ALLOWED = new Set(['routes/videoInterview.ts', 'routes/interviewBlueprints.ts']);

/** Every .ts file under src/, minus the generator that owns the API and this suite. */
function sourceFiles(dir: string, rel = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const here = rel ? `${rel}/${entry}` : entry;
        if (statSync(abs).isDirectory()) {
            if (here === 'scripts' || here === 'services/expertise') continue;
            out.push(...sourceFiles(abs, here));
        } else if (entry.endsWith('.ts')) {
            out.push(here);
        }
    }
    return out;
}

check('🔴 no module outside /start may rebuild a blueprint from the campaign', () => {
    const offenders: string[] = [];
    for (const rel of sourceFiles(SRC)) {
        if (ALLOWED.has(rel)) continue;
        const text = readFileSync(join(SRC, rel), 'utf8');
        for (const api of RECOVERY_APIS) {
            if (text.includes(api)) offenders.push(`${rel} → ${api}`);
        }
    }
    if (offenders.length > 0) {
        throw new Error(
            `these modules can rebuild a blueprint the interview never had: ` +
                offenders.join(', ') +
                ` — a blueprint that locks after the interview does not get to rewrite ` +
                `the past. If a path genuinely must be allowed, add it to ALLOWED and say why.`
        );
    }
});

check('🔴 the n8n sender — the last hop — cannot reach the campaign at all', () => {
    // Belt and braces for the exact module that defeated the first fix: not merely
    // "does not call it" but "does not import it", so the capability is absent.
    const sender = readFileSync(join(SRC, 'services', 'n8nService.ts'), 'utf8');
    for (const api of RECOVERY_APIS) {
        if (sender.includes(api)) {
            throw new Error(
                `n8nService still references ${api}() — this is the LAST hop before the ` +
                    `scorer, so a recovery here silently defeats every guard upstream`
            );
        }
    }
    if (!/sendVideoTranscriptToN8N/.test(sender)) {
        throw new Error('sendVideoTranscriptToN8N is gone — this check no longer guards anything');
    }
});

check('the n8n sender says so out loud when nothing was pinned', () => {
    // Silence here is how the original defect stayed invisible for weeks.
    const sender = readFileSync(join(SRC, 'services', 'n8nService.ts'), 'utf8');
    if (!/no pinned blueprint/.test(sender)) {
        throw new Error(
            'the sender no longer warns when it ships a transcript with no pinned ' +
                'blueprint — an unscored interview must not pass quietly'
        );
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
