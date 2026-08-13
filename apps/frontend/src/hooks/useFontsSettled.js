import { useEffect, useState } from 'react';

/** Guard window for decorations that reflow when the Arabic font swaps in. */
const FONT_SETTLE_FALLBACK_MS = 800;

let settled =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : true;

/** @type {Set<() => void>} */
const listeners = new Set();
let started = false;

function markSettled() {
    if (settled) return;
    settled = true;
    listeners.forEach((notify) => notify());
    listeners.clear();
}

function startWatching() {
    if (started || settled || typeof window === 'undefined') return;
    started = true;
    const fontsReady =
        typeof document !== 'undefined' && document.fonts && document.fonts.ready
            ? document.fonts.ready
            : Promise.resolve();
    fontsReady
        .then(() => {
            requestAnimationFrame(() => requestAnimationFrame(markSettled));
        })
        .catch(markSettled);
    window.setTimeout(markSettled, FONT_SETTLE_FALLBACK_MS);
}

/**
 * `true` once web fonts have settled, shared process-wide.
 *
 * Resolving this per component meant one promise chain plus one timer for every
 * mounted card, and any card mounted later (Show more, scrolling) restarted the
 * guard and flashed its undecorated background even though fonts had long
 * settled. The signal latches once, so late mounts read `true` immediately.
 *
 * @returns {boolean}
 */
export function useFontsSettled() {
    const [value, setValue] = useState(settled);

    useEffect(() => {
        if (settled) {
            setValue(true);
            return undefined;
        }
        startWatching();
        const notify = () => setValue(true);
        listeners.add(notify);
        return () => {
            listeners.delete(notify);
        };
    }, []);

    return value;
}
