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
