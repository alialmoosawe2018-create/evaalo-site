/**
 * How the video page collects the agent's turn-log records from the LiveKit data
 * channel (topic `evaalo.turnlog`) before shipping them on the heartbeat.
 *
 * Extracted from the page so it is testable — the page module cannot be loaded
 * outside Vite.
 *
 * ⚠️ Identity is the agent's per-emission `seq`, NEVER `turnIndex`.
 * The first version de-duplicated on `(kind, turnIndex)`. A live check against
 * the deployed agent on 2026-09-23 sent three distinct utterances that all
 * carried `turnIndex: 0` — `turn_index` only advances when a user turn completes,
 * so any two agent utterances without one between them share it. Keyed that way,
 * the three collapsed into one: the browser kept only the last, and the database
 * would have stored one record where three were spoken. For telemetry a duplicate
 * can be cleaned at analysis time; a silent overwrite cannot be recovered.
 *
 * A record without `seq` (an agent build older than this change) is appended,
 * never merged — for the same reason.
 */

/**
 * Merge one decoded record into the list, in place.
 * @param {Array<object>} list
 * @param {object} record
 * @returns {Array<object>} the same list
 */
export function mergeTurnLogRecord(list, record) {
    if (!Array.isArray(list) || !record || typeof record !== 'object') return list;
    if (typeof record.seq === 'number') {
        const at = list.findIndex((r) => r && r.seq === record.seq);
        if (at !== -1) {
            // The same emission delivered twice — replace, do not duplicate.
            list[at] = record;
            return list;
        }
    }
    list.push(record);
    return list;
}
