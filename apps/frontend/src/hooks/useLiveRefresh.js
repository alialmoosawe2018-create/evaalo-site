/**
 * useLiveRefresh — live invalidation for a data view.
 *
 * Calls `refetch` (debounced) whenever any of the given domain-event types arrives
 * on the shared events socket. The server stays the source of truth — events only
 * signal "something changed, re-read". This keeps list pages fresh without polling,
 * and avoids client-side merge/ordering bugs (no normalized store to keep in sync).
 *
 * @param {string[]|string} eventTypes  Event type(s) to listen for.
 * @param {Function} refetch            Called (debounced) when a relevant event fires.
 * @param {object} [opts]
 * @param {number} [opts.debounceMs=500] Collapse bursts into one refetch.
 * @param {boolean} [opts.enabled=true]  Gate (e.g. only when authenticated).
 */
import { useEffect, useRef } from 'react';
import { onEvent, startEventsSocket } from '../services/eventsSocket';

export function useLiveRefresh(eventTypes, refetch, opts = {}) {
    const { debounceMs = 500, enabled = true } = opts;
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;
    const timerRef = useRef(null);

    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const key = types.join('|'); // stable dep for a literal array of strings

    useEffect(() => {
        if (!enabled) return undefined;
        startEventsSocket();

        const trigger = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                try {
                    refetchRef.current?.();
                } catch {
                    /* isolate a throwing refetch */
                }
            }, debounceMs);
        };

        const offs = key
            .split('|')
            .filter(Boolean)
            .map((t) => onEvent(t, trigger));

        return () => {
            offs.forEach((off) => off());
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [key, debounceMs, enabled]);
}
