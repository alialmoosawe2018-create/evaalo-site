import React, { useCallback, useState } from 'react';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AccountPageLayout from '../components/AccountPageLayout';
import AdjustPlanModal from '../components/AdjustPlanModal';
import AccountUsageMetricsCard from '../components/account/AccountUsageMetricsCard.jsx';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { getPlanById, getPriceDisplay, listPlans } from '../utils/billingDisplay';
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

    const currentPlan = getPlanById(currentPlanId);
    const currentPriceInfo = getPriceDisplay(currentPlanId, 'monthly');
    const currentPriceLabel =
        currentPriceInfo.kind === 'custom'
            ? t('billing_price_custom')
            : `$${currentPriceInfo.amount}${t('billing_price_per_month')}`;
    const allPlans = listPlans();
    const currentIndex = allPlans.findIndex((p) => p.id === currentPlanId);
    const upgradePlan = currentIndex >= 0 && currentIndex < allPlans.length - 1 ? allPlans[currentIndex + 1] : null;
    const upgradePriceInfo = upgradePlan ? getPriceDisplay(upgradePlan.id, 'monthly') : null;
    const upgradePriceLabel = !upgradePlan
        ? ''
        : upgradePriceInfo.kind === 'custom'
            ? t('billing_price_custom')
            : `$${upgradePriceInfo.amount}${t('billing_price_per_month')}`;
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
                        <div
                            role="alert"
                            style={{
                                padding: '10px 14px',
                                marginBottom: 12,
                                borderRadius: 8,
                                background: 'rgba(127, 29, 29, 0.35)',
                                border: '1px solid rgba(248, 113, 113, 0.45)',
                                color: '#fecaca',
                                fontSize: 13,
                            }}
                        >
                            {t('account_billing_load_error')}
                        </div>
                    ) : null}

                    <AccountUsageMetricsCard />

                    {/* Plan row */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 16,
                            marginBottom: 16,
                        }}
                        className="account-spending-plan-row"
                    >
                        <div className="dashboard-card" style={{ padding: '22px 24px' }}>
                            <div className={ACCOUNT_SECTION_LABEL_COMPACT_CLASS}>{t('account_spending_currentPlan')}</div>
                            <div className="account-card-title-lg">
                                <span dir="ltr">{currentPlan ? t(currentPlan.displayNameKey) : ''}</span>{' '}
                                <span dir="ltr" className="account-card-price">
                                    {currentPriceLabel}
                                </span>
                            </div>
                            <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                                {t('account_spending_planResetHint')}
                            </p>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact"
                                onClick={() => openAdjustPlan(null)}
                            >
                                {t('account_planAdjust')}
                            </button>
                        </div>
                        {upgradePlan ? (
                            <div className="dashboard-card" style={{ padding: '22px 24px' }}>
                                <div className={ACCOUNT_SECTION_LABEL_COMPACT_CLASS}>{t('account_spending_upgradeAvailable')}</div>
                                <div className="account-card-title-lg">
                                    <span dir="ltr">{t(upgradePlan.displayNameKey)}</span>{' '}
                                    <span dir="ltr" className="account-card-price">
                                        {upgradePriceLabel}
                                    </span>
                                </div>
                                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                                    {t('account_spending_upgradeBlurb')}
                                </p>
                                <button
                                    type="button"
                                    className="workflow-btn-primary account-btn-compact"
                                    onClick={() => openAdjustPlan(upgradePlan.id)}
                                >
                                    {t('account_spending_upgradeBtn')}
                                </button>
                            </div>
                        ) : (
                            <div className="dashboard-card" style={{ padding: '22px 24px' }} />
                        )}
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
