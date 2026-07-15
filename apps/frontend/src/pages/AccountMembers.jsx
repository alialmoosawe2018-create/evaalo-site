import React, { useMemo, useState } from 'react';
import AccountSidebar from '../components/AccountSidebar';
import AccountPageLayout from '../components/AccountPageLayout';
import CreateTeamModal from '../components/CreateTeamModal';
import { useLanguage } from '../contexts/LanguageContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { PERMISSIONS } from '../contexts/rbacRoles';
import {
    accountPageH1Style,
    ACCOUNT_PAGE_H1_CLASS,
    ACCOUNT_TEXT_MUTED_CLASS,
} from '../utils/accountTypography';

function IconUsersTeam(props) {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconShield(props) {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconBarChart(props) {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconShareTeam(props) {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const FEATURE_DEFS = [
    { icon: IconUsersTeam, titleKey: 'account_members_feat_team_title', descKey: 'account_members_feat_team_desc' },
    { icon: IconShield, titleKey: 'account_members_feat_admin_title', descKey: 'account_members_feat_admin_desc' },
    { icon: IconBarChart, titleKey: 'account_members_feat_usage_title', descKey: 'account_members_feat_usage_desc' },
    { icon: IconShareTeam, titleKey: 'account_members_feat_rules_title', descKey: 'account_members_feat_rules_desc' },
];

const AccountMembers = () => {
    const [createTeamOpen, setCreateTeamOpen] = useState(false);
    const { currentLang, t } = useLanguage();
    const { hasPermission } = useOrganization();
    const canManageMembers = hasPermission(PERMISSIONS.MEMBERS_WRITE);
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const features = useMemo(
        () =>
            FEATURE_DEFS.map((def) => ({
                icon: def.icon,
                title: t(def.titleKey),
                description: t(def.descKey),
            })),
        [t]
    );

    const membersInjectStyle = `
                @media (max-width: 900px) {
                    .account-dashboard-inner { flex-direction: column !important; }
                    .account-members-page aside {
                        position: relative !important;
                        top: 0 !important;
                        width: 100% !important;
                    }
                    .account-members-feature-grid {
                        grid-template-columns: 1fr !important;
                    }
                }
            `;

    return (
        <AccountPageLayout pageClass="account-members-page" injectStyle={membersInjectStyle}>
            <AccountSidebar activeId="members" />

            <main dir={mainDir} style={{ flex: 1, minWidth: 0 }}>
                <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 10px')}>{t('account_members_title')}</h1>
                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 28px', fontSize: 15, lineHeight: 1.5, maxWidth: 560 }}>
                    {t('account_members_intro')}
                </p>

                <div
                    className="dashboard-card"
                    style={{
                        padding: '28px 28px 24px',
                        marginBottom: 16,
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '28px 32px',
                            marginBottom: 32,
                        }}
                        className="account-members-feature-grid"
                    >
                        {features.map(({ icon: Icon, title, description }) => (
                            <div key={title} style={{ display: 'flex', gap: 16 }}>
                                <div className="account-members-feature-icon">
                                    <Icon />
                                </div>
                                <div>
                                    <h3 className="account-card-title-md" style={{ margin: '0 0 8px', fontSize: 15 }}>
                                        {title}
                                    </h3>
                                    <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                                        {description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                    {canManageMembers ? (
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact"
                            onClick={() => setCreateTeamOpen(true)}
                        >
                            {t('account_members_createBtn')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact"
                            disabled
                            title={t('rbacPermissionDenied')}
                        >
                            {t('account_members_createBtn')}
                        </button>
                    )}
                </div>
            </main>

            <CreateTeamModal isOpen={createTeamOpen} onClose={() => setCreateTeamOpen(false)} />
        </AccountPageLayout>
    );
};

export default AccountMembers;
