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
 * JWT template name used to fetch backend-bound tokens from Clerk (Phase 2).
 * Template must be configured in Clerk Dashboard with these claims:
 *   { userId, email, orgId, orgSlug, role, permissions }
 */
const CLERK_JWT_TEMPLATE = 'evaalo-backend';

/**
 * Resolves the auth token for outbound API requests. Order:
 *   1. If window.Clerk.session exists (Phase 1 complete), use Clerk token (with template).
 *   2. Otherwise fall back to authStorage (MOCK mode / Phase 1 pending).
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

async function resolveAuthToken() {
    try {
        const clerk = typeof window !== 'undefined' ? window.Clerk : undefined;
        const session = clerk?.session;
        if (session && typeof session.getToken === 'function') {
            const token = await session.getToken({ template: CLERK_JWT_TEMPLATE }).catch(() => null);
            if (token) return token;
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn(
                    `[apiClient] JWT template "${CLERK_JWT_TEMPLATE}" unavailable — falling back to default session token. ` +
                        'Configure the template in Clerk Dashboard (see backend env.example).'
                );
            }
            return await session.getToken().catch(() => null);
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

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const url = path.startsWith('http') ? path : `${DEFAULT_BASE_URL}${path}`;
    const token = await resolveAuthToken();
    const clerkHeaders = await resolveClerkHeaders();

    const finalHeaders = {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...clerkHeaders,
        ...headers,
    };

    let response;
    try {
        response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal,
        });
    } catch (networkErr) {
        throw new ApiError(networkErr?.message || 'network_error', { status: 0 });
    }

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (response.status === 401) {
        // Token invalid/expired → let callers decide, but clear local state
        authStorage.clear();
    }

    if (!response.ok) {
        emitInsufficientCredits(response.status, data);
        const message = data?.message || data?.error || `request_failed_${response.status}`;
        throw new ApiError(message, { status: response.status, data });
    }

    return data;
}

/** multipart/form-data (e.g. file uploads) — لا نضبط Content-Type يدوياً */
async function requestForm(path, { method = 'POST', formData, headers = {}, signal } = {}) {
    const url = path.startsWith('http') ? path : `${DEFAULT_BASE_URL}${path}`;
    const token = await resolveAuthToken();
    const clerkHeaders = await resolveClerkHeaders();
    const finalHeaders = {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...clerkHeaders,
        ...headers,
    };

    let response;
    try {
        response = await fetch(url, { method, headers: finalHeaders, body: formData, signal });
    } catch (networkErr) {
        throw new ApiError(networkErr?.message || 'network_error', { status: 0 });
    }

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (response.status === 401) {
        authStorage.clear();
    }

    if (!response.ok) {
        emitInsufficientCredits(response.status, data);
        const message = data?.message || data?.error || `request_failed_${response.status}`;
        throw new ApiError(message, { status: response.status, data });
    }

    return data;
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
