import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import AuthSocialButtons from '../components/AuthSocialButtons';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './auth-forms.css';

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const Login = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const { login, isAuthenticated, submitting, authReady, clerkTimedOut, error, clearError } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});

    const from = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get('from') || '/dashboard';
    }, [location.search]);

    useEffect(() => {
        if (isAuthenticated) navigate(from, { replace: true });
    }, [isAuthenticated, navigate, from]);

    useEffect(() => () => clearError(), [clearError]);

    const friendlyError = (code) => {
        switch (code) {
            case 'invalid_email': return t('errInvalidEmail');
            case 'invalid_password': return t('errInvalidPassword');
            case 'rate_limited': return t('errClerkRateLimit');
            case 'session_exists': return t('errGeneric');
            default: return t('errGeneric');
        }
    };

    const validate = () => {
        const errs = {};
        if (!EMAIL_RX.test(email.trim())) errs.email = t('errInvalidEmail');
        if (!password || password.length < 6) errs.password = t('errPasswordShort');
        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        clearError();
        if (!validate()) return;
        try {
            await login({ email: email.trim(), password, remember });
        } catch {
            // error captured in context.error
        }
    };

    return (
        <AuthShell
            heading={t('loginWelcome')}
            subheading={t('loginSubtitle')}
            footerText={t('noAccount')}
            footerLinkLabel={t('signUp')}
            footerLinkTo="/signup"
            sidebarTitle={t('authSidebarTitle')}
            sidebarBody={t('authSidebarBody')}
        >
            <form className="auth-form" onSubmit={onSubmit} noValidate>
                {error && (
                    <div className="auth-alert" role="alert">{friendlyError(error)}</div>
                )}

                {clerkTimedOut && (
                    <div className="auth-alert" role="alert">
                        {t('authLoadFailed')}{' '}
                        <button
                            type="button"
                            className="auth-link"
                            onClick={() => window.location.reload()}
                        >
                            {t('authReload')}
                        </button>
                    </div>
                )}

                <AuthSocialButtons mode="signIn" redirectComplete={from} disabled={submitting || !authReady} />

                <label className="auth-field">
                    <span className="auth-field__label">{t('emailLabel')}</span>
                    <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('emailPlaceholder')}
                        className={`auth-input ${fieldErrors.email ? 'auth-input--error' : ''}`}
                        disabled={submitting}
                    />
                    {fieldErrors.email && <span className="auth-field__error">{fieldErrors.email}</span>}
                </label>

                <label className="auth-field">
                    <span className="auth-field__label">{t('passwordLabel')}</span>
                    <div className="auth-input-wrap">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('passwordPlaceholder')}
                            className={`auth-input ${fieldErrors.password ? 'auth-input--error' : ''}`}
                            disabled={submitting}
                        />
                        <button
                            type="button"
                            className="auth-input-toggle"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                            tabIndex={-1}
                        >
                            {showPassword ? '\u25CC' : '\u25CF'}
                        </button>
                    </div>
                    {fieldErrors.password && <span className="auth-field__error">{fieldErrors.password}</span>}
                </label>

                <div className="auth-row-split">
                    <label className="auth-checkbox">
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                        />
                        <span>{t('rememberMe')}</span>
                    </label>
                    <a href="/forgot-password" className="auth-link" onClick={(e) => { e.preventDefault(); navigate('/forgot-password'); }}>
                        {t('forgotPassword')}
                    </a>
                </div>

                <button
                    type="submit"
                    className="auth-submit"
                    disabled={submitting || !authReady}
                >
                    {submitting ? t('signingIn') : t('signIn')}
                </button>
            </form>
        </AuthShell>
    );
};

export default Login;
