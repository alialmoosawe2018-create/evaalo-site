import React, { useCallback, useMemo, useState } from 'react';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AccountPageLayout from '../components/AccountPageLayout';
import AdjustPlanModal from '../components/AdjustPlanModal';
import AccountUsageMetricsCard from '../components/account/AccountUsageMetricsCard.jsx';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { getPriceDisplay, listNextUpgradePlans } from '../utils/billingDisplay';
import {
    accountPageH1Style,
    ACCOUNT_PAGE_H1_CLASS,
    ACCOUNT_SECTION_LABEL_COMPACT_CLASS,
    ACCOUNT_TEXT_MUTED_CLASS,
} from '../utils/accountTypography';

const AccountSpending = () => {
    const { currentLang, t } = useLanguage();
    const { currentPlanId, error: billingError } = useBilling();
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const [nextPlan, higherPlan] = useMemo(
        () => listNextUpgradePlans(currentPlanId, 2),
        [currentPlanId]
    );

    const formatPlanPrice = useCallback((planId) => {
        const priceInfo = getPriceDisplay(planId, 'monthly');
        if (priceInfo.kind === 'custom') return t('billing_price_custom');
        return `$${priceInfo.amount}${t('billing_price_per_month')}`;
    }, [t]);

    const [adjustPlanOpen, setAdjustPlanOpen] = useState(false);
    const [planModalScrollTo, setPlanModalScrollTo] = useState(null);

    const closePlanModal = useCallback(() => {
        setAdjustPlanOpen(false);
        setPlanModalScrollTo(null);
    }, []);

    const openAdjustPlan = useCallback((scrollTo = null) => {
        setPlanModalScrollTo(scrollTo);
        setAdjustPlanOpen(true);
    }, []);

    const renderUpgradeCard = (plan, labelKey) => {
        if (!plan) {
            return <div className="dashboard-card" style={{ padding: '22px 24px' }} />;
        }

        return (
            <div className="dashboard-card" style={{ padding: '22px 24px' }}>
                <div className={ACCOUNT_SECTION_LABEL_COMPACT_CLASS}>{t(labelKey)}</div>
                <div className="account-card-title-lg">
                    <span dir="ltr">{t(plan.displayNameKey)}</span>{' '}
                    <span dir="ltr" className="account-card-price">
                        {formatPlanPrice(plan.id)}
                    </span>
                </div>
                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                    {t(plan.displayDescKey)}
                </p>
                <button
                    type="button"
                    className="workflow-btn-primary account-btn-compact"
                    onClick={() => openAdjustPlan(plan.id)}
                >
                    {t('account_spending_upgradeBtn')}
                </button>
            </div>
        );
    };

    const spendingInjectStyle = `
                @media (max-width: 960px) {
                    .account-dashboard-inner { flex-direction: column !important; }
                    .account-spending-page aside {
                        position: relative !important;
                        top: 0 !important;
                        width: 100% !important;
                    }
                    .account-spending-plan-row {
                        grid-template-columns: 1fr !important;
                    }
                }
            `;

    return (
        <AccountPageLayout pageClass="account-spending-page" injectStyle={spendingInjectStyle}>
                <AccountSidebar activeId="spending" />

                <main dir={mainDir} style={{ flex: 1, minWidth: 0 }}>
                    <AccountMobileNav activeId="spending" />
                    <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 28px')}>{t('account_spending_title')}</h1>

                    {billingError ? (
                        <div className="account-system-alert" role="alert">
                            {t('account_billing_load_error')}
                        </div>
                    ) : null}

                    <AccountUsageMetricsCard />

                    {/* Upgrade plan row: next tier + the tier above that */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 16,
                            marginBottom: 16,
                        }}
                        className="account-spending-plan-row"
                    >
                        {renderUpgradeCard(nextPlan, 'account_spending_upgradeAvailable')}
                        {renderUpgradeCard(higherPlan, 'account_spending_higherPlan')}
                    </div>
                </main>

                <AdjustPlanModal
                    isOpen={adjustPlanOpen}
                    onClose={closePlanModal}
                    scrollToPlanId={planModalScrollTo ?? undefined}
                />
        </AccountPageLayout>
    );
};

export default AccountSpending;
