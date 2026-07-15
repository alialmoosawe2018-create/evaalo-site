/**
 * Single source of truth for persisting the auth session in the browser.
 *
 * No other file in the app should ever read/write `localStorage` or
 * `sessionStorage` for auth — always go through this wrapper so that the
 * storage strategy can be swapped (secure cookie, IndexedDB, etc.) without
 * touching any UI code.
 */

const STORAGE_KEY = 'evaalo.session.v1';

/** @type {Storage} */
let driver = typeof window !== 'undefined' ? window.localStorage : null;

function safeParse(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export const authStorage = {
    /**
     * Choose driver according to "Remember me".
     * remember=true  -> localStorage (persists across browser restarts)
     * remember=false -> sessionStorage (cleared when tab/window closes)
     */
    useRemember(remember) {
        if (typeof window === 'undefined') return;
        driver = remember ? window.localStorage : window.sessionStorage;
    },

    /** Persist a full session object. */
    setSession(session) {
        if (!driver) return;
        driver.setItem(STORAGE_KEY, JSON.stringify(session));
    },

    /** Read current session from either driver (prefer active, fall back). */
    getSession() {
        if (typeof window === 'undefined') return null;
        const active = driver?.getItem(STORAGE_KEY);
        if (active) return safeParse(active);
        const persistent = window.localStorage.getItem(STORAGE_KEY);
        if (persistent) {
            driver = window.localStorage;
            return safeParse(persistent);
        }
        const temp = window.sessionStorage.getItem(STORAGE_KEY);
        if (temp) {
            driver = window.sessionStorage;
            return safeParse(temp);
        }
        return null;
    },

    /** Shortcut: only the raw token string. */
    getToken() {
        return authStorage.getSession()?.token ?? null;
    },

    /** Wipe every trace of the session from both drivers. */
    clear() {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(STORAGE_KEY);
        window.sessionStorage.removeItem(STORAGE_KEY);
    },
};

export default authStorage;
