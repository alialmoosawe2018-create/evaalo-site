/**
 * Read-through cache (Phase 5) — thin helper over the realtime Redis connection.
 *
 * Graceful: every method NO-OPs when Redis is unavailable (REDIS_URL unset), so the
 * server behaves exactly as before — the cache is a pure optimization, never a
 * dependency. Values are JSON-serialized under a `cache:` namespace with a TTL.
 *
 * Reuses the realtime publisher connection for GET/SET/DEL (PUBLISH does not put a
 * connection into subscriber mode, so normal commands are safe on it). A dedicated
 * cache connection is a future optimization if command volume grows.
 */

import { getPublisher, isRealtimeEnabled } from '../realtime/redisClient.js';

const PREFIX = 'cache:';

function client() {
    return isRealtimeEnabled() ? getPublisher() : null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
    const c = client();
    if (!c) return null;
    try {
        const raw = await c.get(PREFIX + key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const c = client();
    if (!c) return;
    try {
        await c.set(PREFIX + key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } catch {
        /* cache write is best-effort */
    }
}

export async function cacheDel(...keys: string[]): Promise<void> {
    const c = client();
    if (!c || keys.length === 0) return;
    try {
        await c.del(...keys.map((k) => PREFIX + k));
    } catch {
        /* ignore */
    }
}

/**
 * Cache-aside read: return the cached value, else run `fetchFn`, cache it, and return.
 * A cache miss or any Redis error falls straight through to `fetchFn` — correctness
 * never depends on the cache.
 */
export async function cacheGetOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
): Promise<T> {
    const cached = await cacheGet<T>(key);
    if (cached !== null) return cached;
    const fresh = await fetchFn();
    void cacheSet(key, fresh, ttlSeconds);
    return fresh;
}
