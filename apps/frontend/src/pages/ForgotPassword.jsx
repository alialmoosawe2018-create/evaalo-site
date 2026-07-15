import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './auth-forms.css';

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_LEN = 6;

const ForgotPassword = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const { forgotPassword, resetPassword, loading, error, clearError } = useAuth();

    // step: 'request' (إدخال البريد) → 'reset' (إدخال الكود + كلمة مرور جديدة)
    const [step, setStep] = useState('request');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [fieldError, setFieldError] = useState('');

    useEffect(() => () => clearError(), [clearError]);

    const friendlyError = (code) => {
        switch (code) {
            case 'invalid_email': return t('errInvalidEmail');
            case 'invalid_password': return t('errInvalidPassword');
            case 'invalid_code':
            case 'expired_code': return t('errClerkInvalidCode');
            case 'rate_limited': return t('errClerkRateLimit');
            default: return t('errGeneric');
        }
    };

    const onRequest = async (e) => {
        e.preventDefault();
        clearError();
        setFieldError('');
        if (!EMAIL_RX.test(email.trim())) {
            setFieldError(t('errInvalidEmail'));
            return;
        }
        try {
            await forgotPassword({ email: email.trim() });
            setStep('reset');
        } catch {
            // captured in context.error
        }
    };

    const onReset = async (e) => {
        e.preventDefault();
        clearError();
        setFieldError('');
        const normalizedCode = code.replace(/\s+/g, '').trim();
        if (normalizedCode.length !== CODE_LEN) {
            setFieldError(t('verifyEmailCodeFormat'));
            return;
        }
        if (password.length < 6) {
            setFieldError(t('errInvalidPassword'));
            return;
        }
        if (password !== confirm) {
            setFieldError(t('errPasswordMismatch'));
            return;
        }
        try {
            const result = await resetPassword({ code: normalizedCode, password });
            if (result?.ok) {
                navigate('/dashboard', { replace: true });
            }
        } catch {
            // captured in context.error
        }
    };

    return (
        <AuthShell
            heading={step === 'reset' ? t('forgotResetTitle') : t('forgotTitle')}
            subheading={step === 'reset' ? t('forgotResetSubtitle') : t('forgotSubtitle')}
            footerText={t('rememberedPassword')}
            footerLinkLabel={t('signIn')}
            footerLinkTo="/login"
            sidebarTitle={t('authSidebarTitle')}
            sidebarBody={t('authSidebarBody')}
        >
            {step === 'request' ? (
                <form className="auth-form" onSubmit={onRequest} noValidate>
                    {error && (
                        <div className="auth-alert" role="alert">{friendlyError(error)}</div>
                    )}

                    <label className="auth-field">
                        <span className="auth-field__label">{t('emailLabel')}</span>
                        <input
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('emailPlaceholder')}
                            className={`auth-input ${fieldError ? 'auth-input--error' : ''}`}
                            disabled={loading}
                        />
                        {fieldError && <span className="auth-field__error">{fieldError}</span>}
                    </label>

                    <button type="submit" className="auth-submit" disabled={loading}>
                        {loading ? t('sending') : t('sendResetLink')}
                    </button>
                </form>
            ) : (
                <form className="auth-form" onSubmit={onReset} noValidate>
                    {error && (
                        <div className="auth-alert" role="alert">{friendlyError(error)}</div>
                    )}
                    <div className="auth-success" role="status">{t('forgotSuccess')}</div>

                    {email && (
                        <p className="auth-meta" style={{ marginBottom: 12 }}>
                            {t('verifyEmailSentTo')} <strong>{email}</strong>
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
                            className="auth-input"
                            disabled={loading}
                            maxLength={CODE_LEN}
                        />
                    </label>

                    <label className="auth-field">
                        <span className="auth-field__label">{t('newPasswordLabel')}</span>
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('passwordPlaceholder')}
                            className="auth-input"
                            disabled={loading}
                        />
                    </label>

                    <label className="auth-field">
                        <span className="auth-field__label">{t('confirmPasswordLabel')}</span>
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder={t('passwordPlaceholder')}
                            className={`auth-input ${fieldError ? 'auth-input--error' : ''}`}
                            disabled={loading}
                        />
                        {fieldError && <span className="auth-field__error">{fieldError}</span>}
                    </label>

                    <button type="submit" className="auth-submit" disabled={loading}>
                        {loading ? t('resetting') : t('resetPasswordSubmit')}
                    </button>
                </form>
            )}
        </AuthShell>
    );
};

export default ForgotPassword;
