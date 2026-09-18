/**
 * prewarm-rebuild-order-test
 *
 * THE INVARIANT: a stale prewarmed room is fully retired BEFORE its replacement
 * is built and dispatched.
 *
 * 2026-09-18, a real public-path interview. Everything the gate was built for
 * worked: /prepare found no blueprint and prewarmed a BLIND room, generation took
 * 90.4 s and locked ten competencies, /start detected the stale prewarm and
 * rebuilt, the role matched, and the session was pinned with all ten.
 *
 * 🔴 And the avatar never appeared. The worker's own log says why:
 *
 *     10:50:28  ✅ Room created  …628118        ← the NEW room, first
 *               ✅ Room deleted  …544857        ← the old one, after, TWICE
 *               🚀 Agent dispatched → …628118
 *     10:50:29  received job request
 *     10:50:30  process exiting  ← carrying the OLD room's summary
 *               … and not one line for the new room ever after
 *
 * Deleting a room kills the agent process serving it, and the worker runs a
 * single replica. The delete was fire-and-forget, so the rebuild raced it and the
 * teardown took the new job down with it.
 *
 * ⚠️ Why a SOURCE detector. The resolvers are module-private, and the defect was
 * the ORDER of two calls, not a return value — a behaviour test asserting
 * "returns null" passes with the race fully intact. Reaching the real ordering
 * needs LiveKit and a live worker. Same reasoning, and same shape, as
 * blueprint-pin-invariant-test.
 *
 * Read-only. Exits non-zero when the invariant is broken.
 *
 * Run: npm run test:prewarm-rebuild-order
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'videoInterview.ts');
const source = readFileSync(ROUTE, 'utf8');

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

/** A named function's body, cut at its closing brace at column 0. */
function fnBody(signature: string): string {
    const start = source.indexOf(signature);
    if (start < 0) throw new Error(`could not find ${signature} — has it been renamed?`);
    const close = source.indexOf('\n}', start);
    if (close < 0) throw new Error(`could not find the end of ${signature}`);
    return source.slice(start, close + 2);
}

console.log('[prewarm-rebuild-order] running tests\n');

check('🔴 the SYNCHRONOUS resolver never deletes a room', () => {
    // It cannot await, so any delete here is fire-and-forget and races the
    // rebuild — which is exactly what left a candidate in a room with no avatar.
    const body = fnBody('function resolvePreparedSessionReuse(');
    if (body.includes('deleteLiveKitRoom')) {
        throw new Error(
            'resolvePreparedSessionReuse() deletes a room. It is synchronous: the ' +
                'delete cannot be awaited, so the rebuild races the teardown. It must ' +
                'collect the room into `retire` and let the async caller retire it.'
        );
    }
    if (!body.includes('retire?.push')) {
        throw new Error('it no longer hands retired rooms to the async caller');
    }
});

check('🔴 every stale-room teardown is AWAITED', () => {
    const helper = fnBody('async function retireStaleRoom(');
    if (!/await\s+deleteLiveKitRoom\(/.test(helper)) {
        throw new Error('retireStaleRoom() no longer awaits the delete');
    }
    const durable = fnBody('async function resolvePreparedSessionReuseDurable(');
    for (const call of durable.matchAll(/(await\s+)?retireStaleRoom\(/g)) {
        if (!call[1]) throw new Error('a retireStaleRoom() call in the durable resolver is not awaited');
    }
    if (!durable.includes('retireStaleRoom(')) {
        throw new Error('the durable resolver no longer retires stale rooms at all');
    }
});

check('the collected in-memory retires are drained before reuse is returned', () => {
    const durable = fnBody('async function resolvePreparedSessionReuseDurable(');
    const drain = durable.indexOf('await retireStaleRoom(');
    const ret = durable.indexOf('if (inMemory) return inMemory;');
    if (drain < 0 || ret < 0) throw new Error('the drain loop or the reuse return is missing');
    if (drain > ret) {
        throw new Error('rooms are retired AFTER the reuse decision is returned — too late');
    }
});

check('one teardown path, not two', () => {
    // The same room was deleted twice in production ("does not exist" right
    // after), because both resolvers deleted it independently.
    const region = source.slice(
        source.indexOf('async function retireStaleRoom('),
        source.indexOf('/** Best-effort mirror of the in-memory handoff')
    );
    const deletes = region.split('deleteLiveKitRoom(').length - 1;
    if (deletes !== 1) {
        throw new Error(`${deletes} delete call sites in the reuse region — there must be exactly 1`);
    }
});

check('a grace period actually RUNS after the delete, and is configurable', () => {
    const helper = fnBody('async function retireStaleRoom(');
    // ⚠️ Checked as a live guard, not a mention. A first version only asked
    // whether the identifier appeared, so `if (false) { … REBUILD_GRACE_MS … }`
    // disabled the wait and stayed green.
    if (!/if\s*\(\s*REBUILD_GRACE_MS\s*>\s*0\s*\)/.test(helper)) {
        throw new Error('the grace period is no longer guarded on REBUILD_GRACE_MS itself');
    }
    if (!/setTimeout\([^)]*REBUILD_GRACE_MS/.test(helper)) {
        throw new Error('nothing actually waits for REBUILD_GRACE_MS after the delete');
    }
    if (!source.includes('INTERVIEW_REBUILD_GRACE_MS')) {
        throw new Error('the grace period is no longer configurable');
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
