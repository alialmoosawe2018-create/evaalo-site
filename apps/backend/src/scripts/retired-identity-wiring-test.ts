/**
 * The two-layer defence against one interview being scored twice — wired, not
 * merely written.
 *
 * `retired-identity-test` exercises the guards in isolation. What it cannot see
 * is the route quietly not calling them, or the page quietly not clearing the
 * ref: both layers would keep every unit test green while production regressed
 * to the exact 2026-09-18 failure. This reads the code that runs.
 *
 * ⚠️ THE DISTINCTION THIS FILE EXISTS TO PROTECT. A retired ROOM and a retired
 * IDENTITY are different facts:
 *
 *   * `cleanupExpiredSessions` deletes a room on a TTL while its session id is
 *     still perfectly live;
 *   * `/prepare` deletes its own orphaned room after losing a race to `/start`.
 *
 * If "a room was deleted" ever came to mean "do not score", a real interview
 * could have its `/end` silently dropped and never be evaluated — a worse defect
 * than the one being fixed. So `retireStaleRoom` must never retire an identity,
 * and the checks below assert that, not just the happy path.
 *
 * Read-only. Exits non-zero when the wiring is broken.
 *
 * Run: npm run test:retired-identity-wiring
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HERE, '..', 'routes', 'videoInterview.ts');
const PAGE = join(HERE, '..', '..', '..', 'frontend', 'src', 'pages', 'VideoInterviewCall.jsx');

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

/**
 * Comments blanked out, newlines and offsets preserved.
 *
 * ⚠️ Without this the whole file was theatre. Its first version searched the raw
 * source, so commenting a clear out — `// prewarmSessionIdRef.current = null;` —
 * left every check green while the defect was fully restored. Both frontend
 * mutations passed. A detector that cannot tell live code from a comment is
 * worse than none, because it is believed.
 */
function stripComments(src: string): string {
    let out = '';
    let inBlock = false;
    const NL = String.fromCharCode(10);
    for (const line of src.split(NL)) {
        let kept = '';
        let i = 0;
        while (i < line.length) {
            if (inBlock) {
                const close = line.indexOf('*/', i);
                if (close < 0) { i = line.length; break; }
                inBlock = false;
                i = close + 2;
                continue;
            }
            if (line.startsWith('//', i)) break;
            if (line.startsWith('/*', i)) { inBlock = true; i += 2; continue; }
            kept += line[i];
            i += 1;
        }
        out += kept + NL;
    }
    return out;
}

const route = stripComments(readFileSync(ROUTE, 'utf8'));
const page = stripComments(readFileSync(PAGE, 'utf8'));

/** A function body, cut at its own closing brace at the given indent. */
function bodyOf(source: string, opener: string, closer: string): string {
    const start = source.indexOf(opener);
    if (start < 0) throw new Error(`could not find "${opener}" — has it been renamed?`);
    const end = source.indexOf(closer, start);
    if (end < 0) throw new Error(`could not find the end of "${opener}"`);
    return source.slice(start, end + closer.length);
}

/* ─────────────────────────── backend wiring ─────────────────────────── */

check('every point that abandons a prewarmed id retires the identity', () => {
    // Four: campaign mismatch and "prewarmed without competencies", each in the
    // in-memory resolver and in the durable one. Counted, because a check that
    // only asked whether the call appeared ANYWHERE would stay green after three
    // of the four were deleted.
    // Counted with the paren, so the named import does not inflate the total.
    const n = route.split('retireInterviewIdentity(').length - 1;
    if (n < 4) {
        throw new Error(
            `retireInterviewIdentity is CALLED ${n} time(s); expected four abandonment ` +
                `points — campaign mismatch and no-competencies, each in the in-memory ` +
                `resolver and in the durable one`
        );
    }
});

check('each retirement is given the session id, not the room name', () => {
    for (const expr of ['retireInterviewIdentity(existing.sessionId', 'retireInterviewIdentity(row.sessionId']) {
        if (!route.includes(expr)) {
            throw new Error(
                `${expr}…) is gone — an identity retired by room name would be wrong ` +
                    `even when it happened to work`
            );
        }
    }
});

check('🔴 retireStaleRoom must NOT retire identities — rooms and identities differ', () => {
    const fn = bodyOf(route, 'async function retireStaleRoom(', '\n}');
    if (fn.includes('retireInterviewIdentity')) {
        throw new Error(
            'retireStaleRoom retires an identity. It tears down rooms, and rooms are ' +
                'torn down in cases where the session id stays live — a TTL sweep, or ' +
                '/prepare dropping its own orphan. Keying identity on room teardown ' +
                'would drop the /end of a real interview.'
        );
    }
    if (/sessionId/.test(fn)) {
        throw new Error(
            'retireStaleRoom now sees a session id. It is deliberately blind to them; ' +
                'that blindness is what keeps the two concepts from merging.'
        );
    }
});

check('🔴 cleanupExpiredSessions must NOT retire identities', () => {
    const fn = bodyOf(route, 'function cleanupExpiredSessions(', '\n}');
    if (fn.includes('retireInterviewIdentity')) {
        throw new Error(
            'a TTL sweep now retires identities — a long interview would lose its own ' +
                'evaluation when the sweep reached it'
        );
    }
});

check('/end asks before it scores', () => {
    const end = bodyOf(route, "router.post('/end'", '\n});');
    if (!end.includes('isRetiredInterviewIdentity(sessionId)')) {
        throw new Error('/end no longer checks for a retired identity');
    }
    const guard = end.indexOf('isRetiredInterviewIdentity(sessionId)');
    const claim = end.indexOf('claimOnce(stage3Sent, sessionId)');
    if (claim < 0) throw new Error('the send-once claim is gone from /end');
    if (guard > claim) {
        throw new Error(
            'the retirement check runs AFTER the send-once claim — a retired id would ' +
                'consume the claim on its way to being refused'
        );
    }
});

check('the guard refuses the scorer only — teardown and billing stay outside it', () => {
    const end = bodyOf(route, "router.post('/end'", '\n});');
    const guard = end.indexOf('isRetiredInterviewIdentity(sessionId)');
    const region = end.slice(guard, guard + 1400);
    if (/return res\./.test(region)) {
        throw new Error(
            'the retirement branch returns early — the room, the agent, the session ' +
                'row and the billing settlement would all be left hanging'
        );
    }
    for (const later of ['consumeIdempotencyKey: `vi_end:', 'endedBy = endedByReason']) {
        if (end.indexOf(later) < guard) {
            throw new Error(`${later} moved above the guard — it must still run for a retired id`);
        }
    }
});

/* ─────────────────────────── frontend wiring ────────────────────────── */

check('the page clears the prewarm ref on BOTH lifecycle points', () => {
    const n = page.split('prewarmSessionIdRef.current = null').length - 1;
    if (n < 2) {
        throw new Error(
            `the prewarm ref is cleared ${n} time(s); it must be cleared after a ` +
                `successful /start and again in endInterview()`
        );
    }
});

check('/start clears it the moment the real session id arrives', () => {
    const at = page.indexOf('setSessionId(newSessionId)');
    if (at < 0) throw new Error('the /start success handler was renamed');
    const window = page.slice(at, at + 1200);
    if (!window.includes('prewarmSessionIdRef.current = null')) {
        throw new Error(
            'the /prepare id survives /start — after endInterview() clears sessionId, ' +
                'the page-hide beacon falls back to it and re-posts the real transcript ' +
                'under a retired id'
        );
    }
});

check('endInterview() clears it too', () => {
    const at = page.indexOf('setSessionId(null)');
    if (at < 0) throw new Error('endInterview no longer clears sessionId — read this again');
    const window = page.slice(Math.max(0, at - 400), at + 400);
    if (!window.includes('prewarmSessionIdRef.current = null')) {
        throw new Error(
            'sessionId is cleared while the prewarm ref is left behind — this is the ' +
                'exact shape of the 2026-09-18 duplicate'
        );
    }
});

check('the beacon still prefers the live id (the fallback is not the defect)', () => {
    if (!page.includes('sessionId || prewarmSessionIdRef.current')) {
        throw new Error(
            'the page-hide beacon no longer reads the live id first — if the fallback ' +
                'was removed entirely, say so here deliberately'
        );
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
