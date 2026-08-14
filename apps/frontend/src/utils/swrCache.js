// Minimal in-memory stale-while-revalidate cache for dashboard data tables.
//
// Lives for the tab's lifetime. On revisit we show the last data instantly and
// revalidate in the background, instead of flashing a loader on every navigation.
// Deliberately not persisted to storage — it only smooths in-session navigation,
// never serves stale data across a page reload.

const store = new Map(); // key -> { data, ts }

/** @returns {*} the cached data, or undefined if never cached */
export function getCached(key) {
    const entry = store.get(key);
    return entry ? entry.data : undefined;
}

/** @returns {boolean} whether a value has ever been cached for this key */
export function hasCached(key) {
    return store.has(key);
}

/** Store (or replace) the cached value for a key and stamp it with now(). */
export function setCached(key, data) {
    store.set(key, { data, ts: Date.now() });
}

/** @returns {boolean} true if missing or older than maxAgeMs */
export function isStale(key, maxAgeMs) {
    const entry = store.get(key);
    if (!entry) return true;
    return Date.now() - entry.ts > maxAgeMs;
}
