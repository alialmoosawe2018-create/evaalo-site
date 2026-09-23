/**
 * What the video-interview page sends the server as the transcript.
 *
 * Extracted from the page so it is testable: the page module cannot be loaded
 * outside Vite, and this function carries the one piece of data the whole
 * Phase-0 measurement round depends on — a per-message timestamp.
 *
 * Why that matters: every message of the 2026-09-23 interview reached the
 * database with the SAME timestamp (08:05:12.84x), so no turn could be timed
 * afterwards. The cause was a chain: the page never stamped a message at all,
 * this serializer kept only role+content, and Mongoose then applied its schema
 * `default: Date.now` to the whole array in one save.
 *
 * ⚠️ The stamp rides the MESSAGE OBJECT, never its array index. Indexing was
 * tried first and is wrong: the page's merge logic drops partials from the array
 * (`filter(msg => !(msg.role === role && msg.isFinal === false))`), and an
 * assistant partial can sit mid-array while a user final is appended after it —
 * so when the assistant's final arrives, that middle entry is removed and every
 * index after it shifts down by one. Turn times would then be attributed to the
 * wrong turns, and a wrong timestamp is worse than a missing one, because the
 * whole point is to compute per-turn latency from it.
 *
 * The merge paths rebuild messages with spread (`{ ...m, content: folded }`), so
 * the stamp survives them. A merge path that builds a fresh object loses it, and
 * the page simply re-stamps that message on the next render — correct, because
 * such a message is genuinely new.
 */

/**
 * Key for the timestamp written onto a message object by the page.
 * Deliberately not `timestamp`: that name is the WIRE field produced below, and
 * having the two differ keeps "what we stamp" separate from "what we send".
 */
export const MSG_TS = '__tsMs';

/**
 * @param {Array} history the page's conversationHistory (may contain partials)
 * @returns {Array<{role: 'user'|'assistant', content: string, timestamp?: string}>}
 */
export function serializeTranscript(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((msg) => msg && msg.isFinal !== false && String(msg.content || '').trim())
        .map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content || '').trim(),
            ...(msg[MSG_TS] ? { timestamp: new Date(msg[MSG_TS]).toISOString() } : {}),
        }));
}

/**
 * Stamp every message that does not carry a time yet, in place.
 *
 * Never re-stamps: a turn's time is when it STARTED, not when it was last
 * edited by a merge or a correction.
 *
 * @param {Array} history
 * @param {number} nowMs
 */
export function stampNewMessages(history, nowMs) {
    if (!Array.isArray(history)) return;
    for (const msg of history) {
        if (msg && !msg[MSG_TS]) msg[MSG_TS] = nowMs;
    }
}
