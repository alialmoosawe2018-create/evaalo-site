/**
 * Central browser error reporter.
 *
 * Until now nothing in the app recorded a client-side failure: a render crash, a
 * rejected promise or a failed API call left no trace anywhere, so a user could
 * hit a broken page and we would never know. This module captures those and ships
 * them to /api/site-errors.
 *
 * Non-negotiable rule: reporting must NEVER break the site. Every path here is
 * wrapped, every limit is hard, and a failed send is swallowed silently.
 */

const ENDPOINT = '/api/site-errors';
const FLUSH_MS = 10_000;
const MAX_EVENTS_PER_SESSION = 50;
const MAX_PER_FINGERPRINT = 3;
const MAX_BATCH = 20;
const MAX_STACK = 8000;
const MAX_BREADCRUMBS = 20;

let started = false;
let sentCount = 0;
const seen = new Map(); // fingerprint -> times reported this session
const queue = [];
const breadcrumbs = [];

const sessionId =
    Math.random().toString(36).slice(2) + Date.now().toString(36);

function apiBase() {
    try {
        return (typeof window !== 'undefined' && window.__EVAALO_API_BASE__) || '';
    } catch {
        return '';
    }
}

function buildId() {
    try {
        return (typeof window !== 'undefined' && window.__EVAALO_BUILD__) || 'dev';
    } catch {
        return 'dev';
    }
}

/** Strip anything that looks personal before it leaves the browser. */
function scrub(text) {
    return String(text ?? '')
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]')
        .replace(/\b(eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[jwt]');
}

function fingerprintOf(message, stack, route) {
    const frame = String(stack || '')
        .split('\n')
        .find((l) => /\s+at\s+|@/.test(l)) || '';
    return `${String(message).slice(0, 200)}|${frame.trim().slice(0, 160)}|${route}`;
}

export function addBreadcrumb(type, detail) {
    try {
        breadcrumbs.push({ t: Date.now(), type, detail: scrub(detail).slice(0, 160) });
        if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
    } catch {
        /* breadcrumbs are best-effort */
    }
}

/** Public entry — safe to call from anywhere. */
export function reportError(input) {
    try {
        if (sentCount >= MAX_EVENTS_PER_SESSION) return;
        const message = scrub(input?.message);
        if (!message.trim()) return;

        const route = (typeof location !== 'undefined' && location.pathname) || '';
        const fp = fingerprintOf(message, input?.stack, route);
        const times = seen.get(fp) || 0;
        if (times >= MAX_PER_FINGERPRINT) return; // local dedup: don't spam one bug
        seen.set(fp, times + 1);

        queue.push({
            severity: input?.severity || 'error',
            message,
            stack: input?.stack ? scrub(input.stack).slice(0, MAX_STACK) : undefined,
            route,
            httpStatus: input?.httpStatus,
            buildId: buildId(),
            sessionId,
            language: (typeof document !== 'undefined' && document.documentElement.lang) || '',
            viewport:
                typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
            breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
        });
        sentCount += 1;
        if (queue.length >= MAX_BATCH) flush();
    } catch {
        /* never throw from the reporter */
    }
}

function flush(useBeacon = false) {
    try {
        if (!queue.length) return;
        const events = queue.splice(0, MAX_BATCH);
        const url = `${apiBase()}${ENDPOINT}`;
        const payload = JSON.stringify({ events });

        // sendBeacon survives page unload — same approach the interview pages already
        // use to release their LiveKit rooms on pagehide.
        if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
            return;
        }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        }).catch(() => undefined);
    } catch {
        /* a failed report is not an error worth surfacing */
    }
}

export function initErrorReporter() {
    if (started || typeof window === 'undefined') return;
    started = true;

    window.addEventListener('error', (event) => {
        reportError({
            message: event?.message || 'window.onerror',
            stack: event?.error?.stack,
            severity: 'error',
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        reportError({
            message: `Unhandled rejection: ${reason?.message || reason}`,
            stack: reason?.stack,
            severity: 'error',
        });
    });

    // Wrap console.error so existing logging becomes signal too — pass through first
    // so nothing about current behaviour changes.
    try {
        const originalError = console.error;
        console.error = (...args) => {
            originalError.apply(console, args);
            const first = args[0];
            reportError({
                message: `console.error: ${first?.message || args.map(String).join(' ')}`,
                stack: first?.stack,
                severity: 'error',
            });
        };
    } catch {
        /* keep the original console if wrapping fails */
    }

    setInterval(() => flush(), FLUSH_MS);
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush(true);
    });
}

export default { initErrorReporter, reportError, addBreadcrumb };
