// ============================================
// File: pages/Onboarding.jsx
// Purpose: First-login onboarding — collects full name, company, and a
// company description. The description feeds AI features (job-ad "About
// the company" section and future uses). Shown by ProtectedRoute when
// profileComplete is false; fields are editable later in Account Settings.
// Standalone light page (no app nav / dark shell).
// ============================================

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getMyProfile, updateMyProfile } from '../services/profileService';
import './onboarding-page.css';

const Onboarding = () => {
    const navigate = useNavigate();
    const { user, refreshSession } = useAuth();
    const { t, currentLang } = useLanguage();
    const isRtl = currentLang === 'ar' || currentLang === 'ku';

    const [fullName, setFullName] = useState('');
    const [company, setCompany] = useState('');
    const [companyDescription, setCompanyDescription] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

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

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const profile = await getMyProfile();
                if (cancelled) return;
                setFullName(profile.fullName || user?.name || '');
                setCompany(profile.companyName || user?.companyName || '');
                setCompanyDescription(profile.companyDescription || '');
                setEmail(profile.email || user?.email || '');
                if (profile.profileComplete && (profile.companyDescription || '').trim()) {
                    navigate('/dashboard', { replace: true });
                }
            } catch {
                if (!cancelled) {
                    setFullName(user?.name || '');
                    setCompany(user?.companyName || '');
                    setEmail(user?.email || '');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const canSubmit =
        fullName.trim().length >= 2 &&
        company.trim().length >= 2 &&
        companyDescription.trim().length >= 10 &&
        !saving &&
        !loading;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSaving(true);
        setError(null);
        try {
            await updateMyProfile({
                fullName: fullName.trim(),
                companyName: company.trim(),
                companyDescription: companyDescription.trim(),
            });
            try {
                await refreshSession?.();
            } catch {
                /* session refresh is best-effort */
            }
            navigate('/dashboard', { replace: true });
        } catch (err) {
            console.error('[onboarding] save failed:', err);
            setError(t('onboarding_saveError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="onboarding-page" dir={isRtl ? 'rtl' : 'ltr'} data-app-theme="light">
            <Link to="/" className="onboarding-page__brand" aria-label="evaalo">
                <img
                    src="/images/onboarding-logo.png"
                    alt=""
                    className="onboarding-page__brand-logo"
                    width={56}
                    height={56}
                />
                <span className="onboarding-page__brand-name">evaalo</span>
            </Link>

            <form onSubmit={handleSubmit} className="onboarding-page__card">
                <h1 className="onboarding-page__title">{t('onboarding_title')}</h1>
                <p className="onboarding-page__subtitle">{t('onboarding_subtitle')}</p>

                <div className="onboarding-page__fields">
                    <div className="onboarding-page__field">
                        <label htmlFor="onboarding-full-name" className="onboarding-page__label">
                            {t('account_settingsFullName')}
                        </label>
                        <input
                            id="onboarding-full-name"
                            className="onboarding-page__input"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            autoComplete="name"
                            disabled={loading || saving}
                            required
                        />
                    </div>

                    <div className="onboarding-page__field">
                        <label htmlFor="onboarding-email" className="onboarding-page__label">
                            {t('account_settingsEmail')}
                        </label>
                        <input
                            id="onboarding-email"
                            className="onboarding-page__input onboarding-page__input--readonly"
                            type="email"
                            value={email}
                            readOnly
                            aria-readonly="true"
                        />
                    </div>

                    <div className="onboarding-page__field">
                        <label htmlFor="onboarding-company" className="onboarding-page__label">
                            {t('account_settingsCompany')}
                        </label>
                        <input
                            id="onboarding-company"
                            className="onboarding-page__input"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            placeholder={t('account_settingsCompany_ph')}
                            autoComplete="organization"
                            disabled={loading || saving}
                            required
                        />
                    </div>

                    <div className="onboarding-page__field">
                        <label htmlFor="onboarding-company-description" className="onboarding-page__label">
                            {t('account_settingsCompanyDescription')}
                        </label>
                        <textarea
                            id="onboarding-company-description"
                            className="onboarding-page__textarea"
                            value={companyDescription}
                            onChange={(e) => setCompanyDescription(e.target.value.slice(0, 2000))}
                            placeholder={t('account_settingsCompanyDescription_ph')}
                            rows={5}
                            disabled={loading || saving}
                            required
                        />
                    </div>
                </div>

                {error ? (
                    <div className="onboarding-page__error" role="alert">
                        {error}
                    </div>
                ) : null}

                <div className="onboarding-page__actions">
                    <button
                        type="submit"
                        className="nav-dashboard-link onboarding-page__submit"
                        disabled={!canSubmit}
                    >
                        {saving ? t('onboarding_saving') : t('onboarding_continue')}
                    </button>
                </div>
            </form>
        </main>
    );
};

export default Onboarding;
