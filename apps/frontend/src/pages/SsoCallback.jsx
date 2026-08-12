// ============================================
// File: pages/SsoCallback.jsx
// Purpose: Branded loading screen shown during the OAuth (Google/LinkedIn)
// redirect handshake. Wraps Clerk's headless AuthenticateWithRedirectCallback
// so the user never sees a blank page or any third-party auth UI.
// ============================================

import React, { useEffect } from 'react';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * Same light surface as `onboarding-page.css`, because a first-time sign-up lands
 * on Onboarding straight after this screen — one continuous page, not two themes.
 */
const LIGHT_SURFACE =
    'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(56, 189, 248, 0.12), transparent 55%),' +
    ' radial-gradient(ellipse 60% 40% at 100% 100%, rgba(99, 102, 241, 0.08), transparent 50%),' +
    ' #f8fafc';

const SsoCallback = () => {
    const { t } = useLanguage();

    // The app shell can be dark; paint the document light so no dark band shows
    // around this screen or during the hand-off to Onboarding.
    useEffect(() => {
        const prevHtmlBg = document.documentElement.style.background;
        const prevBodyBg = document.body.style.background;
        document.documentElement.style.background = '#f8fafc';
        document.body.style.background = '#f8fafc';
        return () => {
            document.documentElement.style.background = prevHtmlBg;
            document.body.style.background = prevBodyBg;
        };
    }, []);

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '20px',
                background: LIGHT_SURFACE,
                color: '#0f172a',
            }}
        >
            <div
                style={{
                    width: '46px',
                    height: '46px',
                    border: '3px solid rgba(37, 99, 235, 0.18)',
                    borderTopColor: '#2563eb',
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                }}
            />
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#64748b' }}>
                {t('ssoCallbackLoading')}
            </p>
            <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
            {/* Headless handler: completes the redirect and routes onward. Renders nothing. */}
            <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/dashboard"
                signUpFallbackRedirectUrl="/dashboard"
            />
        </div>
    );
};

export default SsoCallback;
