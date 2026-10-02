// ============================================
// ملف: services/headHunterSerpHealth.ts
// عدّادات صحّة محرّك البحث في رسالة إكمال الهيد هانتر — أرقام فقط
// ============================================
//
// The n8n completion callback (`Complete Search` → postHeadHunterN8nInbound) may
// carry ONE optional key describing how the SerpAPI calls behind the search went:
//
//     serpHealth: { calls, failed, ignoredFilter }
//
//   calls          distinct (query, page) SerpAPI calls, phase 1 and phase 2,
//                  each counted once in its FINAL state
//   failed         calls whose final state is "no answer" (503 / error)
//   ignoredFilter  answered calls with organic results but zero LinkedIn /in/
//                  profiles (Google ignored `site:linkedin.com/in/`)
//
// The page turns these into a localized note on a short result. The workflow
// cannot write that note itself: it does not know the recruiter's language, and
// its English `errorMessage` would flip a zero-candidate completion to 'failed'
// (headHunter.ts `failed = … || (complete && inboundError && rowCount === 0)`).
//
// WHY THE PARSE IS STRICT AND SILENT. This is a display hint, never an input to
// status, storage or billing. Anything that is not exactly three sane counts is
// dropped as if absent — no throw, no 4xx — because a malformed hint must never
// cost the search its completion. Only the three counts are copied out, so a body
// that also carried query text (the recruiter's position and location) cannot
// smuggle it into the record or the GET response.

/** The counts as stored on the in-memory search record and returned by GET /last-result. */
export type HeadHunterSerpHealth = {
    calls: number;
    failed: number;
    ignoredFilter: number;
};

/**
 * Ceiling on `calls`. A search makes 2-4 phase-1 calls plus at most a handful in
 * phase 2 today, so anything near this is not a real search — it is a broken or
 * hostile body, and it is ignored rather than shown.
 */
export const SERP_HEALTH_MAX_CALLS = 1000;

function isCount(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Reads `serpHealth` off an inbound n8n body. Returns the three counts, or
 * `undefined` for an absent or invalid value. Never throws.
 *
 * Valid means: a plain object whose `calls`, `failed` and `ignoredFilter` are
 * finite non-negative integers (numbers, not numeric strings), `calls` at most
 * SERP_HEALTH_MAX_CALLS, and `failed + ignoredFilter <= calls`.
 */
export function parseHeadHunterSerpHealth(body: unknown): HeadHunterSerpHealth | undefined {
    if (body == null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const raw = (body as Record<string, unknown>).serpHealth;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const { calls, failed, ignoredFilter } = raw as Record<string, unknown>;
    if (!isCount(calls) || !isCount(failed) || !isCount(ignoredFilter)) return undefined;
    if (calls > SERP_HEALTH_MAX_CALLS) return undefined;
    if (failed + ignoredFilter > calls) return undefined;
    return { calls, failed, ignoredFilter };
}
