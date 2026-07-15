import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { ACCOUNT_SECTION_LABEL_CLASS, ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { apiClient } from '../services/apiClient';

function IconExternalLink() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function IconLinkedInBrand() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
            />
        </svg>
    );
}

function IconWhatsAppBrand() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
            />
        </svg>
    );
}

/**
 * Temporarily disabled: LinkedIn + WhatsApp run on Unipile, which is too costly
 * right now. Hiding the whole section (and skipping the /api/integrations call).
 * Re-enable by setting VITE_INTEGRATIONS_ENABLED=true (or flip the default).
 */
const INTEGRATIONS_ENABLED =
    String(import.meta.env?.VITE_INTEGRATIONS_ENABLED ?? '').toLowerCase() === 'true';

const INTEGRATIONS = [
    {
        id: 'linkedin',
        Icon: IconLinkedInBrand,
        iconClass: 'account-integration-row__icon--linkedin',
        titleKey: 'account_integrations_linkedinTitle',
        descKey: 'account_integrations_linkedinDesc',
    },
    {
        id: 'whatsapp',
        Icon: IconWhatsAppBrand,
        iconClass: 'account-integration-row__icon--whatsapp',
        titleKey: 'account_integrations_whatsappTitle',
        descKey: 'account_integrations_whatsappDesc',
    },
];

function Field({ label, value, onChange, placeholder, type = 'text' }) {
    return (
        <label className="account-integration-field">
            <span className="account-integration-field__label">{label}</span>
            <input
                className="account-integration-field__input"
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                autoComplete="off"
            />
        </label>
    );
}

/** نافذة ربط WhatsApp فقط (LinkedIn يستخدم تدفق Hosted Auth بزر واحد). */
function WhatsAppConnectModal({ t, onClose, onSubmit }) {
    const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', defaultTemplate: '' });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: val }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await onSubmit(form);
        } catch (err) {
            setError(err?.data?.error || err?.message || t('account_integrations_error'));
            setSubmitting(false);
        }
    };

    return (
        <div className="account-integration-modal__overlay" role="dialog" aria-modal="true" onClick={onClose}>
            <form
                className="account-integration-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleSubmit}
            >
                <h3 className="account-integration-modal__title">{t('account_integrations_wa_modalTitle')}</h3>
                <Field
                    label={t('account_integrations_wa_phoneNumberId')}
                    value={form.phoneNumberId}
                    onChange={set('phoneNumberId')}
                    placeholder="1234567890"
                />
                <Field
                    label={t('account_integrations_wa_wabaId')}
                    value={form.wabaId}
                    onChange={set('wabaId')}
                    placeholder=""
                />
                <Field
                    label={t('account_integrations_wa_accessToken')}
                    value={form.accessToken}
                    onChange={set('accessToken')}
                    placeholder="EAAB…"
                    type="password"
                />
                <Field
                    label={t('account_integrations_wa_defaultTemplate')}
                    value={form.defaultTemplate}
                    onChange={set('defaultTemplate')}
                    placeholder="hello_world"
                />
                <p className="account-integration-modal__help">{t('account_integrations_wa_help')}</p>

                {error ? <p className="account-integration-modal__error">{error}</p> : null}

                <div className="account-integration-modal__actions">
                    <button type="button" className="btn btn-secondary account-btn-compact" onClick={onClose} disabled={submitting}>
                        {t('account_integrations_cancel')}
                    </button>
                    <button type="submit" className="workflow-btn-primary account-btn-connect" disabled={submitting}>
                        {submitting ? t('account_integrations_connecting') : t('account_integrations_save')}
                    </button>
                </div>
            </form>
        </div>
    );
}

function IntegrationRow({ item, state, automationOff, connecting, connectingLabel, onConnect, onDisconnect, t }) {
    const title = t(item.titleKey);
    const desc = t(item.descKey);
    const { Icon } = item;
    const connected = Boolean(state?.connected);

    return (
        <div className="account-integration-row">
            <div className={`account-integration-row__icon ${item.iconClass}`} aria-hidden>
                <Icon />
            </div>
            <div className="account-integration-row__body">
                <div className="account-integration-row__title-row">
                    <span className="account-integration-row__title">{title}</span>
                    {connected ? (
                        <span className="account-integration-row__badge">{t('account_integrations_connected')}</span>
                    ) : null}
                </div>
                <p className="account-integration-row__desc">{desc}</p>
                {automationOff ? (
                    <p className="account-integration-row__note">{t('account_integrations_automationOff')}</p>
                ) : null}
                {connected && state?.health?.lastError && state?.status === 'error' ? (
                    <p className="account-integration-row__note" style={{ color: '#f87171' }}>
                        {fillI18nTemplate(t('account_integrations_lastError'), { error: state.health.lastError })}
                    </p>
                ) : null}
            </div>
            {connected ? (
                <button
                    type="button"
                    className="btn btn-secondary btn-large account-btn-compact account-integration-row__action"
                    onClick={onDisconnect}
                >
                    {t('account_integrations_disconnect')}
                </button>
            ) : (
                <button
                    type="button"
                    className="workflow-btn-primary account-btn-connect account-integration-row__action"
                    onClick={onConnect}
                    disabled={connecting}
                    aria-label={fillI18nTemplate(t('account_integrations_connectAria'), { name: title })}
                >
                    {connecting ? connectingLabel : t('account_integrations_connect')}
                    <IconExternalLink />
                </button>
            )}
        </div>
    );
}

export default function AccountIntegrationsSection() {
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [integrations, setIntegrations] = useState({});
    const [flags, setFlags] = useState({ linkedinAutomationEnabled: false, linkedinProviderConfigured: false });
    const [waModalOpen, setWaModalOpen] = useState(false);
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState(null); // { ok, text }

    const refresh = useCallback(async () => {
        if (!INTEGRATIONS_ENABLED) {
            setLoading(false);
            return null;
        }
        try {
            const data = await apiClient.get('/api/integrations');
            if (data?.ok) {
                setIntegrations(data.integrations || {});
                setFlags(data.flags || {});
                return data.integrations || {};
            }
        } catch {
            /* keep previous state */
        } finally {
            setLoading(false);
        }
        return null;
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleWhatsAppSubmit = useCallback(
        async (form) => {
            await apiClient.post('/api/integrations/whatsapp/connect', form);
            setWaModalOpen(false);
            await refresh();
        },
        [refresh]
    );

    // LinkedIn: تدفق Hosted Auth بزر واحد — init → popup → polling حتى الاتصال.
    const handleLinkedInConnect = useCallback(async () => {
        setNotice(null);
        if (!flags.linkedinProviderConfigured) {
            setNotice({ ok: false, text: t('account_integrations_li_notConfigured') });
            return;
        }
        setBusy('linkedin');
        try {
            const data = await apiClient.post('/api/integrations/linkedin/connect/init', {});
            if (!data?.url) throw new Error('no_url');
            const popup = window.open(data.url, '_blank', 'noopener,noreferrer,width=520,height=720');
            if (!popup) {
                // المتصفح حظر النافذة المنبثقة — نفتح الرابط في نفس التبويب بدون تحذير.
                window.location.assign(data.url);
                return;
            }
            // polling حتى يصل إشعار Unipile ويُحدّث الحالة (حتى ~2 دقيقة)
            let tries = 0;
            const timer = setInterval(async () => {
                tries += 1;
                const next = await refresh();
                if (next?.linkedin?.connected || tries >= 48) {
                    clearInterval(timer);
                    setBusy('');
                }
            }, 2500);
        } catch (err) {
            setNotice({
                ok: false,
                text: err?.data?.error === 'linkedin_provider_not_configured'
                    ? t('account_integrations_li_notConfigured')
                    : t('account_integrations_error'),
            });
            setBusy('');
        }
    }, [flags.linkedinProviderConfigured, refresh, t]);

    const handleConnect = useCallback(
        (providerId) => {
            if (providerId === 'linkedin') return handleLinkedInConnect();
            setWaModalOpen(true);
            return undefined;
        },
        [handleLinkedInConnect]
    );

    const handleDisconnect = useCallback(
        async (providerId) => {
            if (!window.confirm(t('account_integrations_disconnectConfirm'))) return;
            try {
                await apiClient.delete(`/api/integrations/${providerId}`);
                await refresh();
            } catch {
                /* ignore */
            }
        },
        [refresh, t]
    );

    const linkedinAutomationOff = useMemo(() => !flags.linkedinAutomationEnabled, [flags]);

    // Service paused (Unipile cost) — render nothing until re-enabled.
    if (!INTEGRATIONS_ENABLED) return null;

    return (
        <section className="account-integrations-section" style={{ marginBottom: 16 }}>
            <div className={`${ACCOUNT_SECTION_LABEL_CLASS} account-integrations-section__title`}>
                {t('account_integrations_section')}
            </div>
            <div className="dashboard-card account-integrations-card">
                {loading ? (
                    <p className="account-integration-row__desc" style={{ padding: '8px 4px' }}>
                        {t('account_integrations_loading')}
                    </p>
                ) : (
                    INTEGRATIONS.map((item) => (
                        <IntegrationRow
                            key={item.id}
                            item={item}
                            state={integrations[item.id]}
                            automationOff={item.id === 'linkedin' && linkedinAutomationOff}
                            connecting={busy === item.id}
                            connectingLabel={item.id === 'linkedin' ? t('account_integrations_li_opening') : t('account_integrations_connecting')}
                            onConnect={() => handleConnect(item.id)}
                            onDisconnect={() => handleDisconnect(item.id)}
                            t={t}
                        />
                    ))
                )}
                {notice ? (
                    <p className={`account-integration-row__note${notice.ok ? '' : ''}`} style={{ color: notice.ok ? '#34d399' : '#f87171' }}>
                        {notice.text}
                    </p>
                ) : null}
            </div>

            {waModalOpen ? (
                <WhatsAppConnectModal
                    t={t}
                    onClose={() => setWaModalOpen(false)}
                    onSubmit={handleWhatsAppSubmit}
                />
            ) : null}
        </section>
    );
}
