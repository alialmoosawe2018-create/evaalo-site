/**
 * Auth service — the ONLY module that produces/consumes Session objects.
 *
 * Session contract (stable — same shape regardless of backend):
 * {
 *   token: string,                            // JWT (Clerk session id or mock token)
 *   user: {
 *     id: string,
 *     email: string,
 *     name: string,
 *     role: 'HR' | 'ADMIN' | 'RECRUITER' | string
 *   },
 *   expiresAt: number,                        // epoch ms
 *   loggedInAt?: number                       // epoch ms — session start
 * }
 *
 * Runtime modes (decided by env at app boot):
 *   1. Clerk mode — VITE_USE_CLERK=true (default) AND VITE_CLERK_PUBLISHABLE_KEY set
 *      AND window.Clerk loaded. Real authentication via @clerk/clerk-react headless API.
 *   2. Mock mode — fallback. Used when Clerk isn't available so dev never breaks.
 *
 * UI surface is unchanged: pages call useAuth() which calls these methods.
 * Migration path to WorkOS (future): replace the Clerk branch inside each method.
 */

import { apiClient } from './apiClient';
import { authStorage } from './authStorage';

const USE_CLERK_FLAG =
    String(import.meta.env.VITE_USE_CLERK || 'true').toLowerCase() !== 'false';
const CLERK_AVAILABLE = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Best-effort start time for Active Sessions UI (handles stored sessions predating loggedInAt). */
export function getSessionStartedAtMs(session) {
    if (!session || typeof session !== 'object') return Date.now();
    if (typeof session.loggedInAt === 'number' && Number.isFinite(session.loggedInAt)) {
        return session.loggedInAt;
    }
    if (typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt)) {
        return Math.max(0, session.expiresAt - SESSION_TTL_MS);
    }
    return Date.now();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidEmail(email) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

// ─── Clerk plumbing ───────────────────────────────────────────────────────────

function getClerk() {
    if (!USE_CLERK_FLAG || !CLERK_AVAILABLE) return null;
    if (typeof window === 'undefined') return null;
    const clerk = window.Clerk;
    if (!clerk || !clerk.loaded) return null;
    return clerk;
}

async function waitForClerk({ timeoutMs = 4000 } = {}) {
    if (!USE_CLERK_FLAG || !CLERK_AVAILABLE) return null;
    if (typeof window === 'undefined') return null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const clerk = window.Clerk;
        if (clerk?.loaded) return clerk;
        await delay(50);
    }
    return null;
}

/** Maps a Clerk error code to one of our friendly i18n keys consumed by Login/Signup. */
function friendlyClerkError(err) {
    const code = err?.errors?.[0]?.code || err?.code || '';
    const message = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || '';
    const map = {
        form_identifier_not_found: 'invalid_email',
        form_password_incorrect: 'invalid_password',
        form_password_pwned: 'invalid_password',
        form_password_validation_failed: 'invalid_password',
        form_identifier_exists: 'email_taken',
        form_param_format_invalid: 'invalid_email',
        form_code_incorrect: 'invalid_code',
        verification_expired: 'expired_code',
        too_many_requests: 'rate_limited',
        session_exists: 'session_exists',
    };
    const mapped = map[code];
    const e = new Error(mapped || code || message || 'clerk_error');
    e.clerkCode = code;
    e.clerkMessage = message;
    return e;
}

export function computeProfileComplete({ fullName, companyName, email } = {}) {
    const name = String(fullName ?? '').trim();
    const company = String(companyName ?? '').trim();
    const mail = String(email ?? '').trim();
    return Boolean(mail && name.length >= 2 && company.length >= 2);
}

/** Gate used by ProtectedRoute + Onboarding — must stay in sync. */
export function userNeedsOnboarding(user) {
    if (!user) return false;
    if (user.profileComplete === false) return true;
    if (!String(user.companyDescription ?? '').trim()) return true;
    return false;
}

/** Overlay Mongo/API profile fields saved via applyProfileToSession onto a Clerk-built session. */
function mergeStoredProfileOverlay(session) {
    if (!session?.user?.id) return session;
    const stored = authStorage.getSession();
    if (!stored?.user?.id || stored.user.id !== session.user.id) return session;

    const su = stored.user;
    const u = session.user;
    const name = String(su.name ?? '').trim() || u.name;
    const companyName = String(su.companyName ?? '').trim() || u.companyName;
    const companyDescription = String(su.companyDescription ?? u.companyDescription ?? '').trim();
    const email = String(su.email ?? '').trim() || u.email;
    const profileComplete =
        su.profileComplete === true ||
        computeProfileComplete({ fullName: name, companyName, email });
    const imageUrl = String(su.imageUrl ?? '').trim() || u.imageUrl;

    return {
        ...session,
        user: {
            ...u,
            name,
            companyName,
            companyDescription,
            email,
            profileComplete,
            imageUrl,
        },
    };
}

function clerkSessionToSession(clerk, { remember = true } = {}) {
    const session = clerk.session;
    const user = clerk.user;
    if (!session || !user) return null;
    const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || '';
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.username ||
        email.split('@')[0];
    const companyName = String(user.unsafeMetadata?.companyName ?? '').trim();
    const companyDescription = String(user.unsafeMetadata?.companyDescription ?? '').trim();
    const role = user.publicMetadata?.role || 'HR_MANAGER';
    const profileComplete =
        user.publicMetadata?.profileComplete === true ||
        computeProfileComplete({ fullName, companyName, email });
    const expiresAt = session.expireAt
        ? new Date(session.expireAt).getTime()
        : Date.now() + SESSION_TTL_MS;

    const out = {
        token: session.id, // not a JWT — token is fetched lazily via apiClient → Clerk.session.getToken()
        user: {
            id: user.id,
            email,
            name: fullName,
            companyName,
            companyDescription,
            profileComplete,
            imageUrl: user.imageUrl || '',
            role,
        },
        expiresAt,
        loggedInAt: session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : Date.now(),
    };
    const merged = mergeStoredProfileOverlay(out);
    persistSession(merged, { remember });
    return merged;
}

// ─── Mock plumbing (fallback) ─────────────────────────────────────────────────

function randomToken() {
    const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `mock.${rand}.${Math.random().toString(36).slice(2)}`;
}

function buildMockSession({ email, name, role = 'HR_MANAGER', company }) {
    const now = Date.now();
    const base = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') || 'user';
    const displayName = name || base.charAt(0).toUpperCase() + base.slice(1);
    const companyName = String(company ?? '').trim();
    const profileComplete = computeProfileComplete({
        fullName: displayName,
        companyName,
        email,
    });
    return {
        token: randomToken(),
        user: {
            id: `u_${base}_${Math.floor(Math.random() * 10000)}`,
            email,
            name: displayName,
            companyName,
            profileComplete,
            role,
        },
        expiresAt: now + SESSION_TTL_MS,
        loggedInAt: now,
    };
}

/** Merge profile fields into the persisted session (mock + post-save refresh). */
export function applyProfileToSession(profile, { remember = true } = {}) {
    const current = authStorage.getSession();
    if (!current?.user) return null;
    const fullName = profile?.fullName ?? profile?.name ?? current.user.name ?? '';
    const companyName = profile?.companyName ?? current.user.companyName ?? '';
    const companyDescription = profile?.companyDescription ?? current.user.companyDescription ?? '';
    const email = profile?.email ?? current.user.email ?? '';
    const profileComplete =
        profile?.profileComplete === true ||
        computeProfileComplete({ fullName, companyName, email });
    const next = {
        ...current,
        user: {
            ...current.user,
            name: String(fullName).trim() || current.user.name,
            companyName: String(companyName).trim(),
            companyDescription: String(companyDescription).trim(),
            email: String(email).trim() || current.user.email,
            profileComplete,
            imageUrl: profile?.imageUrl ?? current.user.imageUrl ?? '',
        },
    };
    return persistSession(next, { remember });
}

function persistSession(session, { remember = true } = {}) {
    authStorage.useRemember(remember);
    authStorage.setSession(session);
    return session;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function login({ email, password, remember = true }) {
    if (!isValidEmail(email)) throw new Error('invalid_email');
    if (!password || String(password).length < 6) throw new Error('invalid_password');

    const clerk = await waitForClerk();
    if (!clerk) {
        // Mock fallback — keeps dev unblocked when Clerk isn't loaded.
        await delay(300);
        return persistSession(buildMockSession({ email }), { remember });
    }

    try {
        // If a session already exists, sign it out first to avoid Clerk's "session_exists" error.
        if (clerk.session) {
            await clerk.signOut().catch(() => undefined);
        }
        const signIn = await clerk.client.signIn.create({ identifier: email, password });
        if (signIn.status === 'complete' && signIn.createdSessionId) {
            await clerk.setActive({ session: signIn.createdSessionId });
            return clerkSessionToSession(clerk, { remember });
        }
        // Otherwise Clerk wants additional factors (e.g., email code, 2FA).
        // The /verify-email page handles email-link/code flows.
        const next = signIn.firstFactorVerification?.status === 'transferable'
            ? 'transfer'
            : 'pending';
        const err = new Error(`login_${next}`);
        err.clerkStatus = signIn.status;
        throw err;
    } catch (err) {
        throw friendlyClerkError(err);
    }
}

export async function signup({ name, email, password, company, remember = true }) {
    if (!name || String(name).trim().length < 2) throw new Error('invalid_name');
    if (!company || String(company).trim().length < 2) throw new Error('invalid_company');
    if (!isValidEmail(email)) throw new Error('invalid_email');
    if (!password || String(password).length < 6) throw new Error('invalid_password');

    const clerk = await waitForClerk();
    if (!clerk) {
        await delay(400);
        return persistSession(buildMockSession({ email, name, company: company.trim() }), { remember });
    }

    try {
        if (clerk.session) {
            await clerk.signOut().catch(() => undefined);
        }
        const [firstName, ...rest] = name.trim().split(/\s+/);
        const lastName = rest.join(' ') || undefined;
        const companyName = company.trim();

        const signUp = await clerk.client.signUp.create({
            emailAddress: email,
            password,
            firstName,
            lastName,
            unsafeMetadata: { companyName },
        });

        if (signUp.status === 'complete' && signUp.createdSessionId) {
            await clerk.setActive({ session: signUp.createdSessionId });
            return clerkSessionToSession(clerk, { remember });
        }

        // Most flows require email verification → trigger it and redirect.
        try {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        } catch {
            /* prepare may already have been triggered */
        }
        const err = new Error('verification_required');
        err.clerkStatus = signUp.status;
        err.email = email;
        throw err;
    } catch (err) {
        if (err.message === 'verification_required') throw err;
        throw friendlyClerkError(err);
    }
}

export async function forgotPassword({ email }) {
    if (!isValidEmail(email)) throw new Error('invalid_email');

    const clerk = await waitForClerk();
    if (!clerk) {
        await delay(450);
        return { ok: true, sentTo: email };
    }

    try {
        const signIn = await clerk.client.signIn.create({
            identifier: email,
            strategy: 'reset_password_email_code',
        });
        return { ok: true, sentTo: email, status: signIn.status };
    } catch (err) {
        // For privacy don't reveal whether email exists when Clerk returns "not found".
        if (err?.errors?.[0]?.code === 'form_identifier_not_found') {
            return { ok: true, sentTo: email, status: 'mock_not_found' };
        }
        throw friendlyClerkError(err);
    }
}

/**
 * إكمال إعادة تعيين كلمة المرور: يُستخدم بعد forgotPassword الذي أرسل كوداً.
 * يعتمد على نفس مورد signIn في clerk.client (strategy: reset_password_email_code).
 */
export async function resetPassword({ code, password, remember = true }) {
    if (!code || String(code).trim().length < 4) throw new Error('invalid_code');
    if (!password || String(password).length < 6) throw new Error('invalid_password');

    const clerk = await waitForClerk();
    if (!clerk) {
        await delay(300);
        return { ok: true };
    }

    try {
        const result = await clerk.client.signIn.attemptFirstFactor({
            strategy: 'reset_password_email_code',
            code: String(code).trim(),
            password,
        });
        if (result.status === 'complete' && result.createdSessionId) {
            await clerk.setActive({ session: result.createdSessionId });
            return { ok: true, session: clerkSessionToSession(clerk, { remember }) };
        }
        // قد يطلب Clerk عاملاً ثانياً (2FA) — نعرض رسالة عامة عبر friendlyClerkError لاحقاً.
        const err = new Error(`reset_${result.status}`);
        err.clerkStatus = result.status;
        throw err;
    } catch (err) {
        throw friendlyClerkError(err);
    }
}

export async function verifyEmailCode({ code }) {
    const clerk = await waitForClerk();
    if (!clerk) {
        await delay(400);
        return { ok: true };
    }
    try {
        const signUp = clerk.client.signUp;
        const result = await signUp.attemptEmailAddressVerification({ code: String(code).trim() });
        if (result.status === 'complete' && result.createdSessionId) {
            await clerk.setActive({ session: result.createdSessionId });
            return { ok: true, session: clerkSessionToSession(clerk, { remember: true }) };
        }
        const err = new Error(`verify_${result.status}`);
        err.clerkStatus = result.status;
        throw err;
    } catch (err) {
        throw friendlyClerkError(err);
    }
}

export async function resendEmailCode() {
    const clerk = await waitForClerk();
    if (!clerk) return { ok: true };
    try {
        await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        return { ok: true };
    } catch (err) {
        throw friendlyClerkError(err);
    }
}

export async function logout() {
    const clerk = getClerk();
    if (clerk) {
        try {
            await clerk.signOut();
        } catch {
            /* even if Clerk fails, clear local state below */
        }
    } else {
        try {
            await apiClient.post('/api/auth/logout', {});
        } catch {
            /* ignore */
        }
    }
    authStorage.clear();
}

const SSO_CALLBACK_PATH = '/sso-callback';

/**
 * OAuth redirect (Google / LinkedIn) — configured in Clerk Dashboard.
 * @param {'oauth_google' | 'oauth_linkedin_oidc'} strategy
 * @param {{ mode?: 'signIn' | 'signUp', redirectComplete?: string }} opts
 */
export async function loginWithOAuth(strategy, { mode = 'signIn', redirectComplete = '/dashboard' } = {}) {
    const clerk = await waitForClerk();
    if (!clerk) {
        throw new Error('clerk_unavailable');
    }

    const redirectUrl = `${window.location.origin}${SSO_CALLBACK_PATH}`;

    if (clerk.session) {
        await clerk.signOut().catch(() => undefined);
    }

    try {
        if (mode === 'signUp') {
            const signUp = await clerk.client.signUp.create({});
            await signUp.authenticateWithRedirect({
                strategy,
                redirectUrl,
                redirectUrlComplete: redirectComplete,
            });
        } else {
            const signIn = await clerk.client.signIn.create({});
            await signIn.authenticateWithRedirect({
                strategy,
                redirectUrl,
                redirectUrlComplete: redirectComplete,
            });
        }
    } catch (err) {
        throw friendlyClerkError(err);
    }
}

export function getCurrentSession() {
    const clerk = getClerk();
    if (clerk?.session && clerk?.user) {
        return clerkSessionToSession(clerk, { remember: true });
    }
    const s = authStorage.getSession();
    if (!s) return null;
    if (typeof s.expiresAt === 'number' && s.expiresAt < Date.now()) {
        authStorage.clear();
        return null;
    }
    return s;
}

export async function refreshCurrentUser() {
    const clerk = await waitForClerk();
    if (clerk?.session && clerk?.user) {
        // الكائن بالمتصفح لا يعرف تحديثات السيرفر (profileComplete/companyName بعد
        // PATCH من الباك) — بدون reload نعيد بناء الجلسة من بيانات قديمة وتعلق
        // البوابة المستخدم بين /onboarding و /dashboard.
        try {
            await clerk.user.reload();
        } catch {
            /* reload is best-effort */
        }
        return clerkSessionToSession(clerk, { remember: true });
    }
    return getCurrentSession();
}

export default {
    login,
    signup,
    forgotPassword,
    resetPassword,
    verifyEmailCode,
    resendEmailCode,
    logout,
    loginWithOAuth,
    getCurrentSession,
    refreshCurrentUser,
    computeProfileComplete,
    applyProfileToSession,
    userNeedsOnboarding,
};
