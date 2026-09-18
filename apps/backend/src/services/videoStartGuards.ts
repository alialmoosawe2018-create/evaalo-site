// ============================================
// ملف: services/videoStartGuards.ts
// الوظيفة: حرّاس صغار نقيّون لمسار بدء/إنهاء مقابلة الفيديو — بلا استيراد،
//          حتى تُختبر مباشرة دون إقلاع الخادم (routes/videoInterview.ts يستوردها).
// ============================================

/**
 * Claims `key` once per `ttlMs`. Returns true to the first caller and false to
 * every caller after it until the claim expires. Expired claims are swept on
 * each call so the registry cannot grow without bound.
 *
 * Used by /end so one interview goes to the Stage 3 scorer once: the frontend
 * reaches /end from three places (pagehide beacon, End button, room disconnect)
 * and two of them fire together when a tab closes — measured on three sessions,
 * 100–300 ms apart, once returning scores 9 and 17 for the same transcript.
 */
export function claimOnce(
    registry: Map<string, number>,
    key: string,
    now: number = Date.now(),
    ttlMs: number = 6 * 60 * 60 * 1000
): boolean {
    for (const [k, t] of registry) {
        if (now - t > ttlMs) registry.delete(k);
    }
    if (registry.has(key)) return false;
    registry.set(key, now);
    return true;
}

/**
 * Resolves with the task's value, or with `null` once `ms` elapse — whichever
 * comes first. The task keeps running after a timeout; nothing is cancelled.
 * A rejected task also resolves to `null` (the caller treats both alike).
 */
export async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(0, ms));
    });
    try {
        return await Promise.race([task.catch(() => null), clock]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/* ───────────────── retired interview identities ───────────────── */

/**
 * Session ids that `/start` abandoned before the interview began, with the time
 * they were retired. Process-local on purpose: it guards a window of minutes,
 * and a restart costs only the old behaviour, never a worse one.
 */
const retiredIdentities = new Map<string, number>();

/**
 * How long a retired id stays refused. Long enough to cover a candidate who
 * leaves the finished tab open for a while, short enough that the map cannot
 * become a place where ids accumulate.
 */
export const RETIRED_IDENTITY_TTL_MS = 60 * 60 * 1000;

/**
 * Record that `sessionId` is no longer a valid identity for this interview.
 *
 * ⚠️ NOT "a room was deleted". The two are different facts and must stay
 * different. `cleanupExpiredSessions` deletes a room on a TTL while its session
 * id is still perfectly live, and `/prepare` deletes its own orphaned room after
 * losing a race — keying this on room teardown would silently drop the `/end` of
 * a real interview and leave it unscored. Only call this where the code has
 * DECIDED to abandon the id and hand the candidate a new one.
 *
 * Today that is exactly the four points where a prewarmed session is superseded:
 * a campaign mismatch or a blueprint that locked after the prewarm, each in the
 * in-memory and the durable resolver.
 */
export function retireInterviewIdentity(
    sessionId: string | undefined,
    reason: string,
    now: number = Date.now()
): void {
    const id = (sessionId || '').trim();
    if (!id) return;
    for (const [k, t] of retiredIdentities) {
        if (now - t > RETIRED_IDENTITY_TTL_MS) retiredIdentities.delete(k);
    }
    retiredIdentities.set(id, now);
    console.log(`🪦 Retiring interview identity ${id} (${reason}) — /end may not score it`);
}

/**
 * Was this id abandoned before its interview began?
 *
 * 🔴 Why `/end` has to ask. The browser keeps the `/prepare` session id in a ref
 * and falls back to it once the live id is cleared, so closing a finished tab
 * re-posts the REAL transcript under the retired id. The server then finds no
 * session row, takes the transcript from the request body, and scores it a
 * second time — and `claimOnce` cannot see it, because that dedupes per session
 * id and this arrives under a different one. Measured 2026-09-18: two Stage 3
 * callbacks for one interview, 12:11:32 and 12:14:16, and the second overwrote
 * the first on the application.
 */
export function isRetiredInterviewIdentity(
    sessionId: string | undefined,
    now: number = Date.now()
): boolean {
    const id = (sessionId || '').trim();
    if (!id) return false;
    const at = retiredIdentities.get(id);
    if (at === undefined) return false;
    if (now - at > RETIRED_IDENTITY_TTL_MS) {
        retiredIdentities.delete(id);
        return false;
    }
    return true;
}

/** Test seam: forget every retired id. */
export function __resetRetiredIdentities(): void {
    retiredIdentities.clear();
}

/**
 * Test seam: how many ids are being held.
 *
 * Needed because `isRetiredInterviewIdentity` drops an expired entry as it reads
 * it, so a test that checks expiry by reading cannot tell a real sweep from that
 * incidental deletion — and a mutation removing the sweep stayed green.
 */
export function __retiredIdentityCount(): number {
    return retiredIdentities.size;
}
