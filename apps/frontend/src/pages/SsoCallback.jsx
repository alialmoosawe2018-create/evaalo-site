// ============================================
// File: pages/SsoCallback.jsx
// Purpose: Branded loading screen shown during the OAuth (Google/LinkedIn)
// redirect handshake. Wraps Clerk's headless AuthenticateWithRedirectCallback
// so the user never sees a blank page or any third-party auth UI.
// ============================================

import React from 'react';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { useLanguage } from '../contexts/LanguageContext';

const SsoCallback = () => {
    const { t } = useLanguage();

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '20px',
                background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 35%, #0f172a 100%)',
                color: '#e2e8f0',
            }}
        >
            <div
                style={{
                    width: '46px',
                    height: '46px',
                    border: '3px solid rgba(34, 211, 238, 0.2)',
                    borderTopColor: '#22d3ee',
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                }}
            />
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'rgba(203, 213, 225, 0.9)' }}>
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
