import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountPageLayout from '../components/AccountPageLayout';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import authService, { getSessionStartedAtMs } from '../services/authService';
import { getMyProfile, updateMyProfile, deleteMyAccount } from '../services/profileService';
import {
    formatSessionRelativeTime,
    getBrowserDeviceLabel,
} from '../utils/accountSessions';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import {
    accountPageH1Style,
    ACCOUNT_PAGE_H1_CLASS,
    ACCOUNT_SECTION_LABEL_CLASS,
    ACCOUNT_TEXT_MUTED_CLASS,
    ACCOUNT_TEXT_PRIMARY_CLASS,
} from '../utils/accountTypography';

const BORDER = 'rgba(255, 255, 255, 0.1)';

function IconMonitor(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
        </svg>
    );
}

function SectionLabel({ children }) {
    return <div className={ACCOUNT_SECTION_LABEL_CLASS}>{children}</div>;
}

const AccountSettings = () => {
    const navigate = useNavigate();
    const { session, user, logout, refreshSession } = useAuth();
    const { currentLang, t } = useLanguage();
    const [fullName, setFullName] = useState('');
    const [company, setCompany] = useState('');
    const [companyDescription, setCompanyDescription] = useState('');
    const [email, setEmail] = useState('');
    const [initialSnapshot, setInitialSnapshot] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);
    const [revokingSession, setRevokingSession] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    const loadProfile = useCallback(async () => {
        setProfileLoading(true);
        setSaveStatus(null);
        try {
            const profile = await getMyProfile();
            const snapshot = {
                fullName: profile.fullName || '',
                company: profile.companyName || '',
                companyDescription: profile.companyDescription || '',
                email: profile.email || user?.email || '',
            };
            setFullName(snapshot.fullName);
            setCompany(snapshot.company);
            setCompanyDescription(snapshot.companyDescription);
            setEmail(snapshot.email);
            setInitialSnapshot(snapshot);
        } catch {
            const fallback = {
                fullName: user?.name || '',
                company: user?.companyName || '',
                companyDescription: user?.companyDescription || '',
                email: user?.email || '',
            };
            setFullName(fallback.fullName);
            setCompany(fallback.company);
            setCompanyDescription(fallback.companyDescription);
            setEmail(fallback.email);
            setInitialSnapshot(fallback);
        } finally {
            setProfileLoading(false);
        }
    }, [user?.name, user?.companyName, user?.email]);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    const isDirty =
        initialSnapshot &&
        (fullName !== initialSnapshot.fullName ||
            company !== initialSnapshot.company ||
            companyDescription !== (initialSnapshot.companyDescription ?? ''));

    const handleSaveProfile = async () => {
        if (!isDirty || saving) return;
        setSaving(true);
        setSaveStatus(null);
        try {
            await updateMyProfile({
                fullName: fullName.trim(),
                companyName: company.trim(),
                companyDescription: companyDescription.trim(),
            });
            await authService.refreshCurrentUser();
            refreshSession();
            const snapshot = {
                fullName: fullName.trim(),
                company: company.trim(),
                companyDescription: companyDescription.trim(),
                email,
            };
            setInitialSnapshot(snapshot);
            setSaveStatus('saved');
            try {
                window.sessionStorage.removeItem('evaalo:profileBannerDismissed');
            } catch {
                /* ignore */
            }
        } catch (err) {
            if (import.meta.env.DEV && err?.message) {
                console.error('[AccountSettings] save profile failed:', err);
            }
            setSaveStatus('error');
        } finally {
            setSaving(false);
        }
    };

    const relLocale = currentLang === 'ar' ? 'ar' : currentLang === 'ku' ? 'ku' : 'en';

    const activeSessionRow = useMemo(() => {
        if (!session?.token) return null;
        const startedAt = getSessionStartedAtMs(session);
        return {
            id: `${session.user?.id ?? 'session'}-${String(session.token).slice(0, 16)}`,
            device: getBrowserDeviceLabel(),
            created: formatSessionRelativeTime(startedAt, relLocale),
        };
    }, [session, relLocale]);

    const handleRevokeCurrentSession = async () => {
        if (!session?.token || revokingSession) return;
        setRevokingSession(true);
        try {
            await logout();
            navigate('/login');
        } finally {
            setRevokingSession(false);
        }
    };

    const handleLogOut = async () => {
        if (loggingOut || deletingAccount) return;
        setLoggingOut(true);
        try {
            await logout();
            navigate('/login');
        } finally {
            setLoggingOut(false);
        }
    };

    const openDeleteModal = () => {
        if (deletingAccount || loggingOut) return;
        setDeleteError(null);
        setDeleteModalOpen(true);
    };

    const closeDeleteModal = () => {
        if (deletingAccount) return;
        setDeleteModalOpen(false);
        setDeleteError(null);
    };

    const executeDeleteAccount = async () => {
        if (deletingAccount || loggingOut) return;
        setDeletingAccount(true);
        setDeleteError(null);
        try {
            await deleteMyAccount();
            // نجاح فقط: نسجّل الخروج ثم نوجّه لصفحة الدخول.
            await logout();
            navigate('/login');
        } catch (err) {
            if (err?.status === 409 && err?.data?.code === 'ACTIVE_SUBSCRIPTION') {
                setDeleteError(t('account_settingsDeleteActiveSubscription'));
            } else {
                setDeleteError(t('account_settingsDeleteError'));
            }
            // لا نسجّل الخروج عند الفشل — نُبقي المستخدم والـ modal.
            setDeletingAccount(false);
        }
    };

    return (
        <AccountPageLayout pageClass="account-settings-page">
                <main
                    dir={currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr'}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 28px')}>{t('account_settingsTitle')}</h1>

                    <div className="account-settings-appearance-section">
                        <SectionLabel>{t('account_settingsAppearanceSection')}</SectionLabel>
                        <div className="dashboard-card account-settings-appearance-card" style={{ padding: '18px 22px', marginBottom: 24 }}>
                            <div className="account-settings-appearance-row">
                                <span className={ACCOUNT_TEXT_PRIMARY_CLASS} style={{ fontSize: 14, fontWeight: 500 }}>
                                    {t('account_settingsLanguageLabel')}
                                    </span>
                                <LanguageToggle variant="settings" />
                            </div>
                            <div className="account-settings-appearance-row">
                                <span className={ACCOUNT_TEXT_PRIMARY_CLASS} style={{ fontSize: 14, fontWeight: 500 }}>
                                    {t('account_settingsThemeLabel')}
                                </span>
                                <ThemeToggle variant="settings" />
                            </div>
                        </div>
                    </div>

                    {/* Profile */}
                    <SectionLabel>{t('account_profileSection')}</SectionLabel>
                    <div className="dashboard-card account-settings-profile-card" style={{ padding: '20px 22px', marginBottom: 24 }}>
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 20,
                                marginBottom: 20,
                            }}
                            className="account-settings-profile-grid"
                        >
                            <div>
                                <label htmlFor="settings-full-name" className="account-settings-label">
                                    {t('account_settingsFullName')}
                                </label>
                                <input
                                    id="settings-full-name"
                                    className="account-settings-input"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    autoComplete="name"
                                    disabled={profileLoading || saving}
                                />
                            </div>
                            <div>
                                <label htmlFor="settings-company" className="account-settings-label">
                                    {t('account_settingsCompany')}
                                </label>
                                <input
                                    id="settings-company"
                                    className="account-settings-input"
                                    value={company}
                                    onChange={(e) => setCompany(e.target.value)}
                                    autoComplete="organization"
                                    disabled={profileLoading || saving}
                                />
                            </div>
                            <div>
                                <label htmlFor="settings-company-description" className="account-settings-label">
                                    {t('account_settingsCompanyDescription')}
                                </label>
                                <textarea
                                    id="settings-company-description"
                                    className="account-settings-input"
                                    value={companyDescription}
                                    onChange={(e) => setCompanyDescription(e.target.value.slice(0, 2000))}
                                    placeholder={t('account_settingsCompanyDescription_ph')}
                                    rows={4}
                                    disabled={profileLoading || saving}
                                    style={{ resize: 'vertical', minHeight: 96, lineHeight: 1.6 }}
                                />
                            </div>
                            <div>
                                <label htmlFor="settings-email" className="account-settings-label">
                                    {t('account_settingsEmail')}
                                </label>
                                <input
                                    id="settings-email"
                                    className="account-settings-input"
                                    type="email"
                                    value={email}
                                    readOnly
                                    aria-readonly="true"
                                    autoComplete="email"
                                    inputMode="email"
                                    disabled={profileLoading}
                                    style={{ opacity: 0.85, cursor: 'not-allowed' }}
                                />
                            </div>
                        </div>
                        <div
                            className="account-settings-profile-actions"
                            style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                                gap: 12,
                                flexWrap: 'wrap',
                            }}
                        >
                            {saveStatus === 'saved' && (
                                <span style={{ fontSize: 13, color: '#86efac' }}>{t('account_settingsSaved')}</span>
                            )}
                            {saveStatus === 'error' && (
                                <span style={{ fontSize: 13, color: '#fca5a5' }}>{t('account_settingsSaveError')}</span>
                            )}
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact"
                                disabled={profileLoading || saving || !isDirty}
                                onClick={() => handleSaveProfile()}
                            >
                                {saving ? t('account_settingsSaving') : t('account_settingsSave')}
                            </button>
                        </div>
                    </div>

                    {/* Active Sessions */}
                    <SectionLabel>{t('account_sessionsSection')}</SectionLabel>
                    <div
                        className="dashboard-card"
                        style={{
                            padding: 0,
                            marginBottom: 12,
                            overflowX: 'auto',
                        }}
                    >
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1fr) auto',
                                gap: 12,
                                padding: '16px 22px 12px',
                                borderBottom: `1px solid ${BORDER}`,
                            }}
                            className="account-sessions-header"
                        >
                            <span>{t('account_settingsDevice')}</span>
                            <span>{t('account_settingsCreated')}</span>
                            <span style={{ width: 88 }} aria-hidden="true" />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            {!activeSessionRow ? (
                                <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ padding: '22px', fontSize: 14, textAlign: 'center' }}>
                                    {t('account_settingsNoSessions')}
                                </div>
                            ) : (
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1fr) auto',
                                        gap: 12,
                                        alignItems: 'center',
                                        padding: '14px 22px',
                                        borderBottom: 'none',
                                    }}
                                    className="account-sessions-row"
                                >
                                    <div className="account-sessions-device">
                                        <IconMonitor style={{ flexShrink: 0, opacity: 0.85 }} />
                                        <span>{activeSessionRow.device}</span>
                                        <span
                                            className="account-session-current-badge"
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                padding: '2px 8px',
                                                borderRadius: 4,
                                            }}
                                        >
                                            {t('account_settingsCurrentSession')}
                                        </span>
                                    </div>
                                    <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ fontSize: 14 }}>
                                        {activeSessionRow.created}
                                    </div>
                                    <button
                                        type="button"
                                        className="workflow-btn-primary account-btn-compact"
                                        disabled={revokingSession || loggingOut || deletingAccount}
                                        onClick={() => handleRevokeCurrentSession()}
                                    >
                                        {revokingSession ? t('account_settingsRevoking') : t('account_settingsRevoke')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 28px', fontSize: 12, lineHeight: 1.5 }}>
                        {t('account_settingsSessionsHint')}
                    </p>

                    {/* More */}
                    <SectionLabel>{t('account_settingsMoreSection')}</SectionLabel>
                    <div className="dashboard-card account-settings-more-card" style={{ padding: 0 }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 16,
                                padding: '18px 22px',
                                borderBottom: `1px solid ${BORDER}`,
                                flexWrap: 'wrap',
                            }}
                        >
                            <span className={ACCOUNT_TEXT_PRIMARY_CLASS} style={{ fontSize: 14, fontWeight: 500 }}>
                                {t('account_settingsLogOut')}
                            </span>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact"
                                disabled={loggingOut || deletingAccount}
                                onClick={() => handleLogOut()}
                            >
                                {loggingOut ? t('account_settingsLoggingOut') : t('account_settingsLogOut')}
                            </button>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 16,
                                padding: '18px 22px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <span className={ACCOUNT_TEXT_PRIMARY_CLASS} style={{ fontSize: 14, fontWeight: 500 }}>
                                {t('account_settingsDeleteAccount')}
                            </span>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact account-btn-danger"
                                disabled={loggingOut || deletingAccount}
                                onClick={() => openDeleteModal()}
                            >
                                {deletingAccount ? t('account_settingsProcessing') : t('account_settingsDelete')}
                            </button>
                        </div>
                    </div>
                </main>

                {deleteModalOpen ? (
                    <div
                        className="ai-compare-modal-overlay danger-zone-modal-overlay"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="account-danger-zone-title"
                        dir={currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr'}
                        onClick={() => closeDeleteModal()}
                    >
                        <div className="ai-compare-modal danger-zone-modal" onClick={(e) => e.stopPropagation()}>
                            <h3 id="account-danger-zone-title" className="danger-zone-modal__title">
                                {t('account_settingsDangerZoneTitle')}
                            </h3>
                            <p className="danger-zone-modal__body">{t('account_settingsDeleteConfirm')}</p>
                            <p className="danger-zone-modal__warning">
                                {t('account_settingsDangerZoneWarning')}
                            </p>
                            {deleteError ? (
                                <p className="danger-zone-modal__error" role="alert">
                                    {deleteError}
                                </p>
                            ) : null}
                            <div className="danger-zone-modal__actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => closeDeleteModal()}
                                    disabled={deletingAccount}
                                >
                                    {t('account_settingsDangerZoneCancel')}
                                </button>
                                <button
                                    type="button"
                                    className="btn danger-zone-modal__confirm"
                                    onClick={() => executeDeleteAccount()}
                                    disabled={deletingAccount}
                                >
                                    {deletingAccount
                                        ? t('account_settingsDangerZoneDeleting')
                                        : t('account_settingsDangerZoneConfirm')}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
        </AccountPageLayout>
    );
};

export default AccountSettings;
