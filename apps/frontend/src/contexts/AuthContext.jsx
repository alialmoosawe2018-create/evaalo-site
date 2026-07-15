/**
 * AuthContext — the only interface the UI touches for authentication state.
 *
 * Pages/components must call `useAuth()` and never import `authService` /
 * `authStorage` / `apiClient` directly for auth-related work. This keeps the
 * UI decoupled from storage and transport, so the whole app can migrate from
 * Clerk to WorkOS (or any other provider) by changing this context only.
 *
 * Implementation notes:
 *   - In Clerk mode, AuthProviderClerk syncs with Clerk via useUser/useSession.
 *   - In mock mode, AuthProviderMock keeps existing dev flows working.
 *   - The external API (`{ user, token, isAuthenticated, login, signup, ... }`)
 *     stays identical regardless of mode.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useClerk, useUser, useSession } from '@clerk/clerk-react';
import authService from '../services/authService';
import { runUserDataMigration } from '../utils/runUserDataMigration';

const USE_CLERK = String(import.meta.env.VITE_USE_CLERK || 'true').toLowerCase() !== 'false';
const CLERK_AVAILABLE = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const CLERK_ENABLED = USE_CLERK && CLERK_AVAILABLE;

const AuthContext = createContext(null);

function buildSharedActions(setSession, setError, setLoading) {
    const login = async ({ email, password, remember }) => {
        setError(null);
        setLoading(true);
        try {
            const next = await authService.login({ email, password, remember });
            setSession(next);
            return next;
        } catch (err) {
            setError(err?.message || 'login_failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const signup = async ({ name, email, password, company, remember }) => {
        setError(null);
        setLoading(true);
        try {
            const next = await authService.signup({ name, email, password, company, remember });
            setSession(next);
            return next;
        } catch (err) {
            setError(err?.message || 'signup_failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const forgotPassword = async ({ email }) => {
        setError(null);
        setLoading(true);
        try {
            return await authService.forgotPassword({ email });
        } catch (err) {
            setError(err?.message || 'forgot_password_failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const resetPassword = async ({ code, password, remember }) => {
        setError(null);
        setLoading(true);
        try {
            const result = await authService.resetPassword({ code, password, remember });
            if (result?.session) setSession(result.session);
            return result;
        } catch (err) {
            setError(err?.message || 'reset_failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const verifyEmailCode = async ({ code }) => {
        setError(null);
        setLoading(true);
        try {
            const result = await authService.verifyEmailCode({ code });
            if (result?.session) setSession(result.session);
            return result;
        } catch (err) {
            setError(err?.message || 'verify_failed');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const resendEmailCode = async () => {
        setError(null);
        try {
            return await authService.resendEmailCode();
        } catch (err) {
            setError(err?.message || 'resend_failed');
            throw err;
        }
    };

    const logout = async () => {
        setLoading(true);
        try {
            await authService.logout();
            setSession(null);
        } finally {
            setLoading(false);
        }
    };

    const loginWithOAuth = async (strategy, opts) => {
        setError(null);
        setLoading(true);
        try {
            await authService.loginWithOAuth(strategy, opts);
        } catch (err) {
            setError(err?.message || 'oauth_failed');
            setLoading(false);
            throw err;
        }
        /* redirect in progress — page unloads */
    };

    return { login, signup, forgotPassword, resetPassword, verifyEmailCode, resendEmailCode, logout, loginWithOAuth };
}

function ClerkAuthProvider({ children }) {
    const clerk = useClerk();
    const { isLoaded: userLoaded, user: clerkUser } = useUser();
    const { isLoaded: sessionLoaded, session: clerkSession } = useSession();

    const [session, setSession] = useState(() => authService.getCurrentSession());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userLoaded || !sessionLoaded) {
            setLoading(true);
            return;
        }
        setSession(authService.getCurrentSession());
        setLoading(false);
    }, [userLoaded, sessionLoaded, clerkUser?.id, clerkSession?.id, clerkSession?.lastActiveAt]);

    useEffect(() => {
        if (!userLoaded || !sessionLoaded || !clerkUser?.id) return;
        const user = authService.getCurrentSession()?.user;
        if (!user?.id) return;
        runUserDataMigration(user).catch(() => {});
    }, [userLoaded, sessionLoaded, clerkUser?.id]);

    const actions = useMemo(() => buildSharedActions(setSession, setError, setLoading), []);
    const clearError = useCallback(() => setError(null), []);
    const refreshSession = useCallback(() => {
        setSession(authService.getCurrentSession());
    }, []);

    const value = useMemo(() => ({
        user: session?.user ?? null,
        token: session?.token ?? null,
        session,
        isAuthenticated: Boolean(session?.token),
        loading,
        error,
        ...actions,
        clearError,
        refreshSession,
        provider: 'clerk',
        clerk,
    }), [session, loading, error, actions, clearError, refreshSession, clerk]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function MockAuthProvider({ children }) {
    const [session, setSession] = useState(() => authService.getCurrentSession());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        setSession(authService.getCurrentSession());
        setLoading(false);
    }, []);

    useEffect(() => {
        const user = authService.getCurrentSession()?.user;
        if (!user?.id && !user?.email) return;
        runUserDataMigration(user).catch(() => {});
    }, [session?.user?.id, session?.user?.email]);

    const actions = useMemo(() => buildSharedActions(setSession, setError, setLoading), []);
    const clearError = useCallback(() => setError(null), []);
    const refreshSession = useCallback(() => {
        setSession(authService.getCurrentSession());
    }, []);

    const value = useMemo(() => ({
        user: session?.user ?? null,
        token: session?.token ?? null,
        session,
        isAuthenticated: Boolean(session?.token),
        loading,
        error,
        ...actions,
        clearError,
        refreshSession,
        provider: 'mock',
        clerk: null,
    }), [session, loading, error, actions, clearError, refreshSession]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const AuthProvider = CLERK_ENABLED ? ClerkAuthProvider : MockAuthProvider;

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used inside <AuthProvider>');
    }
    return ctx;
};

export default AuthContext;
