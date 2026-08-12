import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import AuthSocialButtons from '../components/AuthSocialButtons';
import { useAuth } from '../contexts/AuthContext';
import {
    storePendingSignupProfile,
    syncProfileAfterSignup,
} from '../services/profileService';
import { useLanguage } from '../contexts/LanguageContext';
import './auth-forms.css';

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const Signup = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const { signup, isAuthenticated, loading, error, clearError, refreshSession } = useAuth();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [remember, setRemember] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});

    useEffect(() => {
        if (isAuthenticated) navigate('/dashboard', { replace: true });
    }, [isAuthenticated, navigate]);

    useEffect(() => () => clearError(), [clearError]);

    const friendlyError = (code) => {
        switch (code) {
            case 'invalid_email': return t('errInvalidEmail');
            case 'invalid_password': return t('errInvalidPassword');
            case 'invalid_name': return t('errInvalidName');
            case 'email_taken': return t('errEmailTaken');
            case 'rate_limited': return t('errClerkRateLimit');
            default: return t('errGeneric');
        }
    };

    const validate = () => {
        const errs = {};
        if (!name || name.trim().length < 2) errs.name = t('errInvalidName');
        if (!EMAIL_RX.test(email.trim())) errs.email = t('errInvalidEmail');
        if (!password || password.length < 6) errs.password = t('errPasswordShort');
        if (confirmPassword !== password) errs.confirmPassword = t('errPasswordMismatch');
        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        clearError();
        if (!validate()) return;
        try {
            await signup({ name: name.trim(), email: email.trim(), password, remember });
            await syncProfileAfterSignup({
                fullName: name.trim(),
            });
            refreshSession();
        } catch (err) {
            // Clerk path: verification needed → route to /verify-email with the email pre-filled.
            if (err?.message === 'verification_required') {
                try {
                    window.sessionStorage.setItem('evaalo:pendingVerifyEmail', email.trim());
                } catch {
                    /* sessionStorage unavailable — VerifyEmail handles empty target */
                }
                storePendingSignupProfile({ name: name.trim() });
                clearError();
                navigate('/verify-email', { state: { email: email.trim() }, replace: true });
                return;
            }
            // other errors captured in context.error
        }
    };

    return (
        <AuthShell
            heading={t('signupTitle')}
            subheading={t('signupSubtitle')}
            footerText={t('haveAccount')}
            footerLinkLabel={t('signIn')}
            footerLinkTo="/login"
            sidebarTitle={t('authSidebarTitle')}
            sidebarBody={t('authSidebarBody')}
        >
            <form className="auth-form" onSubmit={onSubmit} noValidate>
                {error && (
                    <div className="auth-alert" role="alert">{friendlyError(error)}</div>
                )}

                {/* Straight to Onboarding: a new account always needs it, and Onboarding
                    bounces anyone who doesn't to /dashboard — so this drops a whole hop. */}
                <AuthSocialButtons mode="signUp" redirectComplete="/onboarding" disabled={loading} />

                <label className="auth-field">
                    <span className="auth-field__label">{t('fullNameLabel')}</span>
                    <input
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('fullNamePlaceholder')}
                        className={`auth-input ${fieldErrors.name ? 'auth-input--error' : ''}`}
                        disabled={loading}
                    />
                    {fieldErrors.name && <span className="auth-field__error">{fieldErrors.name}</span>}
                </label>

                <label className="auth-field">
                    <span className="auth-field__label">{t('emailLabel')}</span>
                    <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('emailPlaceholder')}
                        className={`auth-input ${fieldErrors.email ? 'auth-input--error' : ''}`}
                        disabled={loading}
                    />
                    {fieldErrors.email && <span className="auth-field__error">{fieldErrors.email}</span>}
                </label>

                <label className="auth-field">
                    <span className="auth-field__label">{t('passwordLabel')}</span>
                    <div className="auth-input-wrap">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('passwordPlaceholder')}
                            className={`auth-input ${fieldErrors.password ? 'auth-input--error' : ''}`}
                            disabled={loading}
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

                <label className="auth-field">
                    <span className="auth-field__label">{t('confirmPasswordLabel')}</span>
                    <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('confirmPasswordPlaceholder')}
                        className={`auth-input ${fieldErrors.confirmPassword ? 'auth-input--error' : ''}`}
                        disabled={loading}
                    />
                    {fieldErrors.confirmPassword && <span className="auth-field__error">{fieldErrors.confirmPassword}</span>}
                </label>

                <label className="auth-checkbox" style={{ marginTop: 4 }}>
                    <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span>{t('rememberMe')}</span>
                </label>

                <button type="submit" className="auth-submit" disabled={loading}>
                    {loading ? t('creatingAccount') : t('createAccount')}
                </button>
            </form>
        </AuthShell>
    );
};

export default Signup;
