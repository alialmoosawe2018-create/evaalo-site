import React, { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useBilling } from '../../contexts/BillingContext';
import { getIncludedVideoMinutes, getPlanById } from '../../utils/billingDisplay';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import { ACCOUNT_TEXT_MUTED_CLASS } from '../../utils/accountTypography';

const cardPadding = { padding: '22px 24px', marginBottom: 16 };

export default function AccountUsageMetricsCard({ className = '' }) {
    const { t, currentLang } = useLanguage();
    const {
        currentPlanId,
        creditsRemaining,
        monthlyCredits,
        remainingIncludedVideoSeconds,
        remainingPurchasedVideoSeconds,
        includedVideoSeconds,
        purchasedVideoSeconds,
    } = useBilling();

    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const creditUsage = useMemo(() => {
        const plan = getPlanById(currentPlanId);
        const total = monthlyCredits || plan?.monthlyCredits || 0;
        const remaining = Math.max(0, Math.min(total, creditsRemaining ?? 0));
        const used = Math.max(0, total - remaining);
        const overallPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        return { total, remaining, used, overallPct };
    }, [currentPlanId, creditsRemaining, monthlyCredits]);

    const videoUsage = useMemo(() => {
        const includedCap =
            includedVideoSeconds > 0
                ? Math.floor(includedVideoSeconds / 60)
                : getIncludedVideoMinutes(currentPlanId);
        const purchasedTotal = Math.floor(Math.max(0, purchasedVideoSeconds ?? 0) / 60);
        if (includedCap <= 0 && purchasedTotal <= 0) return null;

        const includedRemaining = Math.floor(Math.max(0, remainingIncludedVideoSeconds ?? 0) / 60);
        const purchasedRemaining = Math.floor(Math.max(0, remainingPurchasedVideoSeconds ?? 0) / 60);
        const remaining = includedRemaining + purchasedRemaining;
        const total = includedCap + purchasedTotal;
        const used = Math.max(0, total - remaining);
        const overallPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        return { total, remaining, used, overallPct };
    }, [
        currentPlanId,
        includedVideoSeconds,
        purchasedVideoSeconds,
        remainingIncludedVideoSeconds,
        remainingPurchasedVideoSeconds,
    ]);

    return (
        <div
            className={`dashboard-card account-plan-card account-plan-card--usage ${className}`.trim()}
            style={{ ...cardPadding, display: 'flex', flexDirection: 'column', minHeight: 200 }}
        >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <h3 dir="ltr" className="account-usage-title" style={{ textAlign: mainDir === 'rtl' ? 'end' : 'start' }}>
                    {fillI18nTemplate(t('account_usageRatioSample'), {
                        used: (creditUsage.remaining ?? 0).toLocaleString('en-US'),
                        cap: (creditUsage.total ?? 0).toLocaleString('en-US'),
                    })}
                </h3>
                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '14px 0 8px', fontSize: 13 }}>
                    {t('billing_credits_label')}
                </p>
                <div className="account-usage-track">
                    <div
                        className="account-usage-fill"
                        style={{
                            width: `${creditUsage.total > 0 ? Math.max(creditUsage.used > 0 ? 4 : 0, creditUsage.overallPct) : 0}%`,
                        }}
                    />
                </div>
            </div>
            {videoUsage ? (
                <div className="account-usage-video-block">
                    <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '14px 0 8px', fontSize: 13 }}>
                        {t('billing_credit_video_label')}
                    </p>
                    <p
                        dir="ltr"
                        className="account-usage-video-ratio"
                        style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}
                    >
                        {/* متبقٍ/إجمالي — بنفس دلالة سطر الكردت أعلاه، لا مستهلَك/إجمالي */}
                        {fillI18nTemplate(t('account_usageRatioSample'), {
                            used: videoUsage.remaining.toLocaleString('en-US'),
                            cap: videoUsage.total.toLocaleString('en-US'),
                        })}
                    </p>
                    <div className="account-usage-track">
                        <div
                            className="account-usage-fill account-usage-fill--video"
                            style={{
                                width: `${videoUsage.total > 0 ? Math.max(videoUsage.used > 0 ? 4 : 0, videoUsage.overallPct) : 0}%`,
                            }}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}
