/**
 * EventsSocket — single client for the backend business-events channel (`/ws/events`).
 *
 * - One shared WebSocket for the whole app (singleton).
 * - Authenticates with the Clerk session token (query `?token=`), fetched fresh on
 *   every (re)connect since tokens are short-lived.
 * - Reconnects with exponential backoff + jitter.
 * - Durable at-least-once: tracks the highest `seq` seen and, on reconnect, asks the
 *   server to replay `seq > lastAckedSeq` (query `?since=`). Acks each event.
 * - Consumers subscribe with onEvent(type, handler) / onAnyEvent(handler). Handlers
 *   are isolated (a throwing handler never breaks the socket) and must be idempotent
 *   (replayed + live events can overlap; dedupe by `seq`/`outboxId`).
 *
 * This is UI-liveness only. It never carries money truth — the server stays the
 * authority; events just tell the UI when to reflect a change instantly.
 */

import { API_BASE_URL } from '../config/apiBase';

const WS_BASE = API_BASE_URL.replace(/^http/, 'ws');
const EVENTS_PATH = '/ws/events';
const MAX_BACKOFF_MS = 30_000;

let socket = null;
let connected = false;
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let started = false;
let lastAckedSeq = -1;

/** type → Set<handler> */
const typeHandlers = new Map();
const anyHandlers = new Set();

async function getToken() {
    try {
        return (await window.Clerk?.session?.getToken?.()) || null;
    } catch {
        return null;
    }
}

function backoffMs() {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(reconnectAttempts, 5));
    return base + Math.floor(Math.random() * 500); // jitter
}

function scheduleReconnect() {
    if (reconnectTimer || intentionalClose) return;
    const delay = backoffMs();
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
    }, delay);
}

function dispatch(evt) {
    const set = evt?.type ? typeHandlers.get(evt.type) : null;
    if (set) {
        for (const h of set) {
            try {
                h(evt);
            } catch {
                /* isolate a throwing consumer */
            }
        }
    }
    for (const h of anyHandlers) {
        try {
            h(evt);
        } catch {
            /* isolate */
        }
    }
}

async function connect() {
    if (typeof window === 'undefined') return;
    if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    const token = await getToken();
    if (!token) {
        // Not authenticated yet — retry until a session exists.
        scheduleReconnect();
        return;
    }

    intentionalClose = false;
    const since = lastAckedSeq >= 0 ? `&since=${lastAckedSeq}` : '';
    const url = `${WS_BASE}${EVENTS_PATH}?token=${encodeURIComponent(token)}${since}`;

    let ws;
    try {
        ws = new WebSocket(url);
    } catch {
        scheduleReconnect();
        return;
    }
    socket = ws;

    ws.onopen = () => {
        connected = true;
        reconnectAttempts = 0;
    };

    ws.onmessage = (e) => {
        let evt;
        try {
            evt = JSON.parse(e.data);
        } catch {
            return;
        }
        if (evt?.type === 'ready') return;
        if (typeof evt?.seq === 'number') {
            if (evt.seq > lastAckedSeq) lastAckedSeq = evt.seq;
            try {
                ws.send(JSON.stringify({ type: 'ack', seq: evt.seq }));
            } catch {
                /* best-effort ack */
            }
        }
        dispatch(evt);
    };

    ws.onclose = () => {
        connected = false;
        if (socket === ws) {
            socket = null;
            scheduleReconnect();
        }
        // else: superseded by a newer socket (e.g. org-switch reconnect) — do nothing.
    };

    ws.onerror = () => {
        // onclose follows and handles reconnect.
    };
}

/**
 * A page restored from the back/forward cache comes back without its socket: the
 * browser closes it on entry, since a frozen page may not hold one open (that is
 * the "Page entered Back-Forward Cache" close, not a server failure). The retry
 * scheduled by onclose can be up to MAX_BACKOFF_MS away by then, so live updates
 * would lag for no reason. Reconnect at once, keeping `lastAckedSeq` so the server
 * replays whatever arrived while the page was frozen.
 */
function onPageShow(event) {
    if (!event?.persisted || intentionalClose) return;
    reconnectAttempts = 0;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    void connect();
}

/** Start the shared socket (idempotent). Call once the app is authenticated. */
export function startEventsSocket() {
    if (typeof window === 'undefined') return;
    if (!started) {
        started = true;
        window.addEventListener('online', () => void connect());
        window.addEventListener('pageshow', onPageShow);
    }
    void connect();
}

/** Close the socket and stop reconnecting. */
export function stopEventsSocket() {
    intentionalClose = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket) {
        try {
            socket.close();
        } catch {
            /* ignore */
        }
        socket = null;
    }
    connected = false;
}

/** Force a fresh connection (e.g. after an org switch): drops the cursor + old socket. */
export function reconnectEventsSocket() {
    lastAckedSeq = -1;
    reconnectAttempts = 0;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    const old = socket;
    socket = null;
    if (old) {
        try {
            old.close();
        } catch {
            /* ignore */
        }
    }
    void connect();
}

/** Subscribe to a specific event type. Returns an unsubscribe function. */
export function onEvent(type, handler) {
    if (!typeHandlers.has(type)) typeHandlers.set(type, new Set());
    typeHandlers.get(type).add(handler);
    return () => {
        typeHandlers.get(type)?.delete(handler);
    };
}

/** Subscribe to every event. Returns an unsubscribe function. */
export function onAnyEvent(handler) {
    anyHandlers.add(handler);
    return () => anyHandlers.delete(handler);
}

export function isEventsConnected() {
    return connected;
}
