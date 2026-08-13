/**
 * Thin fetch wrapper used by every service. Automatically attaches the
 * current Bearer token to outgoing requests and hands back parsed JSON.
 *
 * UI code MUST NOT call `fetch` directly for anything that touches the API —
 * always go through `apiClient` so behaviours like 401 handling, retries,
 * or a future refresh-token flow stay in one place.
 */

import { authStorage } from './authStorage';

/** Dev: use Vite /api proxy on localhost and same-LAN IPs (mobile testing). */
function isDevProxyHost(hostname) {
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    return hostname.endsWith('.local');
}

function resolveApiBaseUrl() {
    if (typeof window !== 'undefined' && window.__EVAALO_API_BASE__) {
        return String(window.__EVAALO_API_BASE__).replace(/\/$/, '');
    }
    if (import.meta.env.DEV && typeof window !== 'undefined') {
        if (isDevProxyHost(window.location.hostname)) {
            return '';
        }
    }
    return (
        import.meta?.env?.VITE_API_BASE_URL ||
        import.meta?.env?.VITE_API_URL ||
        'https://api.evaalo.com'
    ).replace(/\/$/, '');
}

const DEFAULT_BASE_URL = resolveApiBaseUrl();

/**
 * Resolves the auth token for outbound API requests. Order:
 *   1. If window.Clerk.session exists, use the DEFAULT Clerk session token.
 *   2. Otherwise fall back to authStorage (MOCK mode / Phase 1 pending).
 *
 * IMPORTANT: We deliberately use the DEFAULT session token, NOT the legacy
 * `evaalo-backend` JWT template. The default token carries the active org as
 * Clerk's compact `o` claim ({ id, rol, slg }), which the backend reads via
 * getAuth(req). On the current Clerk instance the custom template's
 * role/permissions claims are empty, so template tokens resolve to the default
 * role (HR_MANAGER) and 403 on owner-only routes like billing. The default
 * token resolves the real org role (admin → OWNER) correctly.
 */
async function resolveClerkHeaders() {
    const extra = {};
    try {
        const clerk = typeof window !== 'undefined' ? window.Clerk : undefined;
        const user = clerk?.user;
        if (user?.id) extra['X-Clerk-User-Id'] = user.id;
        const email =
            user?.primaryEmailAddress?.emailAddress ||
            user?.emailAddresses?.[0]?.emailAddress;
        if (email) extra['X-User-Email'] = email;
    } catch {
        /* ignore */
    }
    return extra;
}

async function resolveAuthToken({ forceFresh = false } = {}) {
    try {
        const clerk = typeof window !== 'undefined' ? window.Clerk : undefined;
        const session = clerk?.session;
        if (session && typeof session.getToken === 'function') {
            // A Clerk session token lives ~60s and getToken() serves it from cache.
            // A tab that was frozen (back/forward cache, sleeping laptop) wakes with
            // that cached token already expired, so skipCache is what makes a retry
            // meaningfully different from the attempt that just failed.
            const options = forceFresh ? { skipCache: true } : undefined;
            return await session.getToken(options).catch(() => null);
        }
    } catch {
        /* fall through to mock storage */
    }
    return authStorage.getToken();
}

export class ApiError extends Error {
    constructor(message, { status, data } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

/** اسم حدث نفاد الرصيد المركزي — يستمع له InsufficientCreditsToast. */
export const INSUFFICIENT_CREDITS_EVENT = 'billing:insufficient-credits';

/**
 * بثّ مركزي عند 402/INSUFFICIENT_CREDITS: تنبيه موحّد أعلى التطبيق مهما كانت
 * الميزة. المعالجات المحلية (رسائل inline) تبقى كما هي — هذا طبقة إضافية.
 */
function emitInsufficientCredits(status, data) {
    const isInsufficient =
        status === 402 || data?.error === 'INSUFFICIENT_CREDITS' || data?.code === 'INSUFFICIENT_CREDITS';
    if (!isInsufficient || typeof window === 'undefined') return;
    try {
        window.dispatchEvent(
            new CustomEvent(INSUFFICIENT_CREDITS_EVENT, {
                detail: { status, message: data?.message || null },
            })
        );
    } catch {
        /* ignore */
    }
}

/**
 * A redirect is never a valid answer for these endpoints, and following one is
 * worse than failing: a signed-out request bounced to the API root arrives as a
 * 200 whose body carries no `success`/`data`, which callers read as "no rows" and
 * render an empty page while the session stays broken. Treat it as the 401 it is.
 */
function assertNotRedirected(response) {
    if (!response.redirected) return;
    authStorage.clear();
    throw new ApiError('authentication_required', { status: 401 });
}

/**
 * True when the API rejected us because the session token was missing, expired or
 * unverifiable — the marker our auth gate sends. Such a rejection happens in the
 * middleware, before any route handler runs, so nothing was created, charged or
 * deleted and the same call may safely be repeated with a fresh token.
 */
function isRecoverableAuthFailure(status, data) {
    return status === 401 && data?.error === 'authentication_required';
}

async function parseBody(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * One attempt: resolve a token, send, parse. `forceFresh` mints a new session
 * token instead of reusing the cached one.
 */
async function sendOnce(url, { method, body, formData, headers, signal }, forceFresh) {
    const token = await resolveAuthToken({ forceFresh });
    const clerkHeaders = await resolveClerkHeaders();
    const isForm = formData !== undefined;

    const finalHeaders = {
        Accept: 'application/json',
        // multipart must keep the boundary the browser generates — never set it here.
        ...(!isForm && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...clerkHeaders,
        ...headers,
    };

    let response;
    try {
        response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: isForm ? formData : body !== undefined ? JSON.stringify(body) : undefined,
            signal,
        });
    } catch (networkErr) {
        throw new ApiError(networkErr?.message || 'network_error', { status: 0 });
    }

    assertNotRedirected(response);
    return { response, data: await parseBody(response) };
}

/**
 * Sends a request, and retries it exactly once with a freshly minted token when
 * the API says the session was not usable.
 *
 * Without this, a tab that sat idle long enough for its ~60s token to expire — or
 * one restored from the back/forward cache — throws its first call away: the page
 * either renders empty or shows an error the user can only fix by reloading, even
 * though the session itself is perfectly valid.
 */
async function send(path, options) {
    const url = path.startsWith('http') ? path : `${DEFAULT_BASE_URL}${path}`;

    let { response, data } = await sendOnce(url, options, false);
    if (isRecoverableAuthFailure(response.status, data)) {
        const reason = data?.reason || 'unknown';
        ({ response, data } = await sendOnce(url, options, true));
        if (response.ok) {
            // DevTools keeps showing the rejected first attempt no matter what we do
            // here, so say plainly that it was recovered — otherwise a healthy page
            // looks broken in the console.
            console.info(`[evaalo] stale session token (${reason}) — refreshed and retried ${path}`);
        }
    }

    if (response.status === 401) {
        // Still rejected with a fresh token → the session really is gone.
        authStorage.clear();
    }

    if (!response.ok) {
        emitInsufficientCredits(response.status, data);
        const message = data?.message || data?.error || `request_failed_${response.status}`;
        throw new ApiError(message, { status: response.status, data });
    }

    return data;
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    return send(path, { method, body, headers, signal });
}

/** multipart/form-data (e.g. file uploads) — لا نضبط Content-Type يدوياً */
async function requestForm(path, { method = 'POST', formData, headers = {}, signal } = {}) {
    return send(path, { method, formData, headers, signal });
}

export const apiClient = {
    get: (path, opts) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    postForm: (path, formData, opts) => requestForm(path, { ...opts, method: 'POST', formData }),
    put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
    patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
    delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export default apiClient;
