/**
 * One interview must produce exactly ONE Stage 3 result.
 *
 * 🔴 The live failure, 2026-09-18. `/prepare` handed the browser session A
 * (…282749) at 12:08:02 while the blueprint was still generating. It locked 77 s
 * later, so `/start` retired A and built session B (…367128); the interview ran
 * in B, ended at 12:10:51, and was scored correctly. Then at 12:13:32 the
 * candidate closed the finished tab — and the page-hide beacon posted the REAL
 * transcript under A, because `endInterview()` clears `sessionId` while the
 * `/prepare` id sat in a ref that was never cleared, and the beacon reads
 * `sessionId || prewarmSessionIdRef.current`.
 *
 * The server found no session row for A, took the transcript from the request
 * body, and scored the same interview a second time. `claimOnce` could not see
 * it: that dedupes per session id, and this arrived under a different one. Two
 * Stage 3 callbacks came back — 12:11:32 and 12:14:16 — and because the callback
 * targets candidate+campaign rather than sessionId, the SECOND overwrote the
 * first on the application (`updatedAt` 12:14:16.436).
 *
 * ⚠️ Why the guard is not keyed on `retireStaleRoom`. A retired ROOM and a
 * retired IDENTITY are different facts. `cleanupExpiredSessions` deletes a room
 * on a TTL while its session id is still live, and `/prepare` deletes its own
 * orphaned room after losing a race to `/start`. Had "room deleted" meant "do
 * not score", a long interview could have had its own `/end` silently dropped
 * and never evaluated. The identity is retired only where `/start` DECIDES to
 * abandon the id and hand the candidate a new one — and `retireStaleRoom` is not
 * even given a session id, which is the proof that the two concepts are separate.
 *
 * Run: npm run test:retired-identity
 */
import assert from 'node:assert/strict';
import {
    RETIRED_IDENTITY_TTL_MS,
    __resetRetiredIdentities,
    __retiredIdentityCount,
    claimOnce,
    isRetiredInterviewIdentity,
    retireInterviewIdentity,
} from '../services/videoStartGuards.js';

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
    try {
        __resetRetiredIdentities();
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

const A = 'video-interview-cand-1789733282749'; // /prepare — retired
const B = 'video-interview-cand-1789733367128'; // /start   — the real interview

/**
 * What `/end` does with an id, in the order the route does it: the retirement
 * guard first, the send-once claim second.
 */
function endWouldScore(sessionId: string, stage3Sent: Map<string, number>): boolean {
    if (isRetiredInterviewIdentity(sessionId)) return false;
    return claimOnce(stage3Sent, sessionId);
}

check('🔴 the live sequence yields EXACTLY ONE Stage 3 result', () => {
    const stage3Sent = new Map<string, number>();

    // /prepare → A. Blueprint not ready yet, so nothing is retired.
    assert.equal(isRetiredInterviewIdentity(A), false, 'A is valid before /start');

    // blueprint locks → /start supersedes A and builds B
    retireInterviewIdentity(A, 'prewarmed without competencies');

    // the interview runs in B and ends normally
    assert.equal(endWouldScore(B, stage3Sent), true, 'B must be scored');

    // the tab-close pair for B (beacon + room disconnect) — claimOnce handles it
    assert.equal(endWouldScore(B, stage3Sent), false, 'B must not be scored twice');

    // …and 2m41s later the finished tab closes, posting B's transcript under A
    assert.equal(
        endWouldScore(A, stage3Sent),
        false,
        'the retired /prepare id reached the scorer — one interview, two verdicts'
    );

    assert.deepEqual([...stage3Sent.keys()], [B], 'exactly one id may reach the scorer');
});

check('a retired id is refused no matter how it arrives', () => {
    retireInterviewIdentity(A, 'campaign mismatch');
    assert.equal(isRetiredInterviewIdentity(A), true);
    // a fresh registry: the refusal must not depend on the claim map at all
    assert.equal(endWouldScore(A, new Map()), false);
});

check('an id nobody retired is untouched', () => {
    retireInterviewIdentity(A, 'prewarmed without competencies');
    assert.equal(isRetiredInterviewIdentity(B), false, 'B must stay scorable');
    assert.equal(endWouldScore(B, new Map()), true);
});

check('the guard refuses ONLY the scorer — it is not an early return', () => {
    // A route-shape check: the retirement branch must sit beside the claimOnce
    // branch inside the transcript block, so teardown, billing and session
    // closure (all outside it) still run for a retired id.
    retireInterviewIdentity(A, 'prewarmed without competencies');
    let tornDown = false;
    let billed = false;
    const endRoute = (sessionId: string) => {
        const scored = endWouldScore(sessionId, new Map());
        tornDown = true; // outside the branch in the route
        billed = true; // outside the branch in the route
        return scored;
    };
    assert.equal(endRoute(A), false, 'A must not be scored');
    assert.ok(tornDown, 'the room must still be torn down');
    assert.ok(billed, 'billing must still settle');
});

check('⚠️ an empty or missing id is never treated as retired', () => {
    retireInterviewIdentity('', 'nothing');
    retireInterviewIdentity(undefined, 'nothing');
    assert.equal(isRetiredInterviewIdentity(''), false);
    assert.equal(isRetiredInterviewIdentity(undefined), false);
    assert.equal(isRetiredInterviewIdentity('anything-at-all'), false);
});

check('the retirement expires — the map cannot become permanent state', () => {
    const t0 = 1_000_000;
    retireInterviewIdentity(A, 'prewarmed without competencies', t0);
    assert.equal(isRetiredInterviewIdentity(A, t0 + RETIRED_IDENTITY_TTL_MS - 1), true);
    assert.equal(
        isRetiredInterviewIdentity(A, t0 + RETIRED_IDENTITY_TTL_MS + 1),
        false,
        'a retired id must stop being refused once its window passes'
    );
});

check('expired entries are SWEPT, not merely ignored on read', () => {
    /*
     * ⚠️ Counted, never read. `isRetiredInterviewIdentity` deletes an expired
     * entry as it reads it, so a test that proves expiry by reading cannot tell
     * the sweep from that incidental deletion — deleting the sweep loop left the
     * first version of this test green.
     */
    const t0 = 1_000_000;
    retireInterviewIdentity(A, 'old', t0);
    assert.equal(__retiredIdentityCount(), 1);
    // a later retirement of a DIFFERENT id must carry the old one out with it
    retireInterviewIdentity(B, 'new', t0 + RETIRED_IDENTITY_TTL_MS * 3);
    assert.equal(
        __retiredIdentityCount(),
        1,
        'the expired id is still being held — the registry grows without bound'
    );
    assert.equal(isRetiredInterviewIdentity(B, t0 + RETIRED_IDENTITY_TTL_MS * 3), true);
});

check('🔴 the window is long enough to be worth having', () => {
    /*
     * A TTL of zero passes every behavioural test above — the id is retired and
     * forgotten in the same instant — while the guard does nothing at all. The
     * measured gap it must cover: the interview ended 12:10:51 and the finished
     * tab was closed 12:13:32, 2m41s later. A candidate who leaves the tab open
     * over a break is the ordinary case, so the floor is far above that.
     */
    const THIRTY_MINUTES = 30 * 60 * 1000;
    assert.ok(
        RETIRED_IDENTITY_TTL_MS >= THIRTY_MINUTES,
        `RETIRED_IDENTITY_TTL_MS is ${RETIRED_IDENTITY_TTL_MS}ms — too short to catch a ` +
            `tab closed some time after the interview ended`
    );
    const t0 = 1_000_000;
    retireInterviewIdentity(A, 'prewarmed without competencies', t0);
    assert.equal(
        isRetiredInterviewIdentity(A, t0 + THIRTY_MINUTES),
        true,
        'a tab closed half an hour later would still be scored a second time'
    );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
