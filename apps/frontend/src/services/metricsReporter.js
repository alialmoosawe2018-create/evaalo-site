import { API_BASE_URL } from '../config/apiBase.js';
import { isAutomatedClient } from '../observability/isAutomatedClient.js';

/**
 * Batched timing reporter.
 *
 * Sends samples on an interval and on `pagehide`, never one request per sample —
 * measuring the network by adding a request per network call would be its own
 * bug. The queue is capped so a broken loop cannot grow memory, and the send is
 * fire-and-forget: a failed report is dropped, never retried, never surfaced.
 *
 * `sendBeacon` on page hide is the only way a sample from the last seconds of a
 * session survives, which is exactly where an abandoned interview lives.
 */

const ENDPOINT = `${API_BASE_URL}/api/site-metrics`;
const FLUSH_INTERVAL_MS = 20_000;
const MAX_QUEUE = 60;
/** Below this nothing is learned that the average does not already say. */
const MIN_REPORT_MS = 150;

let queue = [];
let timer = null;

function post(samples) {
    if (!samples.length) return;
    const payload = JSON.stringify({ samples });
    try {
        // On page hide only beacon survives; elsewhere keepalive behaves the same.
        if (navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
            return;
        }
    } catch {
        /* fall through to fetch */
    }
    try {
        void fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        }).catch(() => {});
    } catch {
        /* observability must never throw into the caller */
    }
}

function flush() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    post(batch);
}

function schedule() {
    if (timer) return;
    timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/**
 * @param {{scope:'api'|'interview', name:string, durationMs:number, failed?:boolean, outcome?:string}} sample
 */
export function reportMetric(sample) {
    try {
        // Same exclusion as the error reporter: a tool driving the site would skew
        // the very baseline the timings exist to establish.
        if (isAutomatedClient()) return;
        if (!sample || !sample.name) return;
        const ms = Number(sample.durationMs);
        if (!Number.isFinite(ms) || ms < 0) return;
        // A failure or a labelled outcome is always worth a row, however fast.
        if (ms < MIN_REPORT_MS && !sample.failed && !sample.outcome) return;

        if (queue.length >= MAX_QUEUE) {
            flush();
            if (queue.length >= MAX_QUEUE) return;
        }
        queue.push({
            scope: sample.scope,
            name: String(sample.name).slice(0, 120),
            durationMs: Math.round(ms),
            failed: Boolean(sample.failed),
            outcome: sample.outcome ? String(sample.outcome).slice(0, 40) : undefined,
        });
        schedule();
    } catch {
        /* never break a caller to record a measurement */
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
}

export const __testing = { flush };
