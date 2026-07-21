import React, { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useBilling } from '../../contexts/BillingContext';
import { getIncludedVideoMinutes, getPlanById } from '../../utils/billingDisplay';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import { ACCOUNT_TEXT_MUTED_CLASS } from '../../utils/accountTypography';

const cardPadding = { padding: '22px 24px', marginBottom: 16 };

function UsageMetricBlock({
    label,
    remaining,
    total,
    used,
    overallPct,
    usedLabelKey,
    fillClassName = '',
    t,
}) {
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');

    return (
        <div className="account-usage-metric">
            <p className={`${ACCOUNT_TEXT_MUTED_CLASS} account-usage-metric__label`}>{label}</p>
            <div dir="ltr" className="account-usage-metric__values">
                <span className="account-usage-metric__remaining">{fmt(remaining)}</span>
                <span className="account-usage-metric__of">
                    {fillI18nTemplate(t('account_usageCreditsOfTotal'), { total: fmt(total) })}
                </span>
            </div>
            <div className="account-usage-track account-usage-metric__track">
                <div
                    className={`account-usage-fill ${fillClassName}`.trim()}
                    style={{
                        width: `${total > 0 ? Math.max(used > 0 ? 4 : 0, overallPct) : 0}%`,
                    }}
                />
            </div>
            {used > 0 ? (
                <p className={`${ACCOUNT_TEXT_MUTED_CLASS} account-usage-metric__used`}>
                    {fillI18nTemplate(t(usedLabelKey), { used: fmt(used) })}
                </p>
            ) : null}
        </div>
    );
}

export default function AccountUsageMetricsCard({ className = '' }) {
    const { t } = useLanguage();
    const {
        currentPlanId,
        creditsRemaining,
        monthlyCredits,
        remainingIncludedVideoSeconds,
        remainingPurchasedVideoSeconds,
        includedVideoSeconds,
        purchasedVideoSeconds,
    } = useBilling();

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
                <UsageMetricBlock
                    label={t('billing_credits_label')}
                    remaining={creditUsage.remaining}
                    total={creditUsage.total}
                    used={creditUsage.used}
                    overallPct={creditUsage.overallPct}
                    usedLabelKey="account_usageCreditsUsed"
                    t={t}
                />
            </div>
            {videoUsage ? (
                <div className="account-usage-video-block">
                    <UsageMetricBlock
                        label={t('billing_credit_video_label')}
                        remaining={videoUsage.remaining}
                        total={videoUsage.total}
                        used={videoUsage.used}
                        overallPct={videoUsage.overallPct}
                        usedLabelKey="account_usageVideoMinutesUsed"
                        fillClassName="account-usage-fill--video"
                        t={t}
                    />
                </div>
            ) : null}
        </div>
    );
}
