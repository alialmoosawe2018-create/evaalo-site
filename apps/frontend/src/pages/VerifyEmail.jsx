import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import { useAuth } from '../contexts/AuthContext';
import {
    consumePendingSignupProfile,
    syncProfileAfterSignup,
} from '../services/profileService';
import { useLanguage } from '../contexts/LanguageContext';
import './auth-forms.css';

const CODE_LEN = 6;

const VerifyEmail = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const { verifyEmailCode, resendEmailCode, loading, error, clearError, isAuthenticated, refreshSession } = useAuth();

    const [code, setCode] = useState('');
    const [fieldError, setFieldError] = useState('');
    const [resentAt, setResentAt] = useState(0);

    const targetEmail =
        (location.state && typeof location.state === 'object' && location.state.email) ||
        (typeof window !== 'undefined' ? window.sessionStorage.getItem('evaalo:pendingVerifyEmail') : '') ||
        '';

    useEffect(() => () => clearError(), [clearError]);

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, navigate]);

    const friendlyError = (code) => {
        switch (code) {
            case 'invalid_code': return t('errClerkInvalidCode');
            case 'expired_code': return t('errClerkExpiredCode');
            case 'rate_limited': return t('errClerkRateLimit');
            case 'verify_complete': return t('errGeneric');
            default: return t('errGeneric');
        }
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        clearError();
        setFieldError('');
        const normalized = code.replace(/\s+/g, '').trim();
        if (normalized.length !== CODE_LEN) {
            setFieldError(t('verifyEmailCodeFormat'));
            return;
        }
        try {
            const result = await verifyEmailCode({ code: normalized });
            if (result?.ok) {
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem('evaalo:pendingVerifyEmail');
                }
                const pending = consumePendingSignupProfile();
                if (pending.fullName) {
                    await syncProfileAfterSignup(pending);
                    refreshSession();
                }
                navigate('/dashboard', { replace: true });
            }
        } catch {
            // captured in context.error
        }
    };

    const onResend = async () => {
        clearError();
        setFieldError('');
        try {
            await resendEmailCode();
            setResentAt(Date.now());
        } catch {
            // captured in context.error
        }
    };

    return (
        <AuthShell
            heading={t('verifyEmailTitle')}
            subheading={t('verifyEmailSubtitle')}
            footerText={t('rememberedPassword')}
            footerLinkLabel={t('signIn')}
            footerLinkTo="/login"
            sidebarTitle={t('authSidebarTitle')}
            sidebarBody={t('authSidebarBody')}
        >
            <form className="auth-form" onSubmit={onSubmit} noValidate>
                {error && (
                    <div className="auth-alert" role="alert">{friendlyError(error)}</div>
                )}
                {resentAt > 0 && !error && (
                    <div className="auth-success" role="status">{t('verifyEmailResent')}</div>
                )}

                {targetEmail && (
                    <p className="auth-meta" style={{ marginBottom: 12 }}>
                        {t('verifyEmailSentTo')} <strong>{targetEmail}</strong>
                    </p>
                )}

                <label className="auth-field">
                    <span className="auth-field__label">{t('verifyEmailCodeLabel')}</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, CODE_LEN))}
                        placeholder="••••••"
                        className={`auth-input ${fieldError ? 'auth-input--error' : ''}`}
                        disabled={loading}
                        maxLength={CODE_LEN}
                    />
                    {fieldError && <span className="auth-field__error">{fieldError}</span>}
                </label>

                <button type="submit" className="auth-submit" disabled={loading || code.length !== CODE_LEN}>
                    {loading ? t('verifying') : t('verifyEmailSubmit')}
                </button>

                <button
                    type="button"
                    className="auth-secondary"
                    onClick={onResend}
                    disabled={loading}
                    style={{ marginTop: 8 }}
                >
                    {t('verifyEmailResend')}
                </button>
            </form>
        </AuthShell>
    );
};

export default VerifyEmail;
