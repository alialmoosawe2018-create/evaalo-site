import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LegalPageShell from '../components/LegalPageShell';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useBilling } from '../contexts/BillingContext';
import { PRICING_FAQ_ITEMS } from '../config/pricingFaq';
import {
    getPriceDisplay,
    getPlanById,
    listUsageCreditCosts,
    listFeaturesForPlan,
    buildPricingFeatureRows,
} from '../utils/billingDisplay';
import PlanCardContents from '../components/PlanCardContents';
import { apiClient } from '../services/apiClient';
import { navigateFromCheckoutResponse } from '../utils/billingCheckout';

const ENTERPRISE_SALES_EMAIL = 'team@evaalo.com';

const PRICING_TIERS = [
    {
        id: 'starter',
        nameKey: 'billing_plan_starter_name',
        planId: 'starter',
        ctaKey: 'pricing_cta_start',
        to: '/signup',
    },
    {
        id: 'team',
        nameKey: 'billing_plan_team_name',
        planId: 'team',
        ctaKey: 'pricing_cta_start',
        to: '/signup',
    },
    {
        id: 'professional',
        nameKey: 'billing_plan_professional_name',
        planId: 'professional',
        featured: true,
        ctaKey: 'pricing_cta_start',
        to: '/signup',
    },
    {
        id: 'business',
        nameKey: 'billing_plan_business_name',
        planId: 'business',
        ctaKey: 'pricing_cta_start',
        to: '/signup',
    },
];

function CheckIcon() {
    return (
        <svg
            className="pricing-card__feature-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
        >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/** Enterprise card: Starter features (video instead of default voice) + custom extras. */
function EnterprisePlanCardContents({ t }) {
    const features = [
        ...listFeaturesForPlan('starter').map((feature) =>
            feature === 'voice.default' ? 'interviews.video' : feature,
        ),
        'integrations.custom',
        'voice.identity.customization',
        'avatar.branding',
    ];
    const labelOverrides = {
        'integrations.custom': t('pricing_enterprise_feature_integrations'),
        'voice.identity.customization': t('pricing_enterprise_feature_voice'),
        'avatar.branding': t('pricing_enterprise_feature_avatar'),
    };
    const noUnlimitedKeys = new Set([
        'integrations.custom',
        'voice.identity.customization',
        'avatar.branding',
    ]);
    const featureRows = buildPricingFeatureRows('enterprise', features, 0, t).map((row) => ({
        ...row,
        label: labelOverrides[row.key] || row.label,
        showUnlimited: !noUnlimitedKeys.has(row.key),
    }));
    const unlimitedLabel = t('pricing_unlimited');

    return (
        <>
            <div className="pricing-card__credits" dir="ltr">
                <div className="pricing-card__credits-row">
                    <span className="pricing-card__credits-value pricing-card__credits-value--unlimited">
                        {unlimitedLabel}
                    </span>
                    <span className="pricing-card__credits-word">{t('pricing_credits_word')}</span>
                </div>
            </div>
            <div className="pricing-card__promo" dir="auto" />
            <div className="pricing-card__body">
                <ul className="pricing-card__features">
                    {featureRows.map((row) => (
                        <li key={row.key} className="pricing-card__feature pricing-card__feature--split">
                            <span className="pricing-card__feature-main">
                                <CheckIcon />
                                <span>{row.label}</span>
                            </span>
                            {row.showUnlimited ? (
                                <span className="pricing-card__feature-limit" dir="auto">
                                    {unlimitedLabel}
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </div>
        </>
    );
}

function PricingAudienceToggle({ audience, onChange, t }) {
    return (
        <div
            className="pricing-plans__audience-toggle"
            role="tablist"
            aria-label={t('navPricing')}
        >
            <button
                type="button"
                role="tab"
                aria-selected={audience === 'plans'}
                className={`pricing-plans__audience-btn${
                    audience === 'plans' ? ' pricing-plans__audience-btn--active' : ''
                }`}
                onClick={() => onChange('plans')}
            >
                {t('pricing_tab_plans')}
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={audience === 'enterprise'}
                className={`pricing-plans__audience-btn${
                    audience === 'enterprise' ? ' pricing-plans__audience-btn--active' : ''
                }`}
                onClick={() => onChange('enterprise')}
            >
                {t('pricing_tab_enterprise')}
            </button>
        </div>
    );
}

function EnterpriseContactCta({ t }) {
    const href = `mailto:${ENTERPRISE_SALES_EMAIL}?subject=${encodeURIComponent(
        'Enterprise plan inquiry',
    )}`;
    return (
        <a href={href} className="pricing-card__cta">
            {t('pricing_cta_contact')}
        </a>
    );
}

function PricingPlanCta({ tier, featured, t }) {
    const { isAuthenticated } = useAuth();
    const billing = useBilling();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [alreadyOnPlan, setAlreadyOnPlan] = useState(false);

    // زر Back من Stripe يستعيد الصفحة من bfcache مع loading=true — نُصفّره عند الاستعادة.
    useEffect(() => {
        const onPageShow = (event) => {
            if (event.persisted) setLoading(false);
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

    // Only trust the current plan once billing has loaded, so a placeholder
    // default never marks the wrong card as "current".
    const isCurrent =
        isAuthenticated && billing.isLoaded && tier.planId === billing.currentPlanId;

    const startCheckout = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);
        setAlreadyOnPlan(false);
        try {
            const requestId =
                typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `req-${Date.now()}`;
            const res = await apiClient.post('/api/billing/checkout', {
                planId: tier.planId,
                cycle: 'monthly',
                requestId,
            });
            // Already on this plan (e.g. cached plan looked different) — say so
            // plainly instead of the misleading success redirect, and refresh.
            if (res?.kind === 'already_active') {
                setAlreadyOnPlan(true);
                setLoading(false);
                billing.refetch?.();
                return;
            }
            if (navigateFromCheckoutResponse(res, tier.planId)) {
                return;
            }
            throw new Error('checkout_failed');
        } catch {
            setError(t('billing_checkout_failed'));
            setLoading(false);
        }
    };

    // Subscriber viewing their current plan: disabled CTA only (no duplicate badge).
    if (isCurrent) {
        return (
            <button
                type="button"
                disabled
                className={
                    featured ? 'pricing-card__cta btn btn-primary btn-large' : 'pricing-card__cta'
                }
            >
                {t('adjust_plan_btnCurrent')}
            </button>
        );
    }

    if (isAuthenticated) {
        return (
            <>
                <button
                    type="button"
                    disabled={loading}
                    aria-busy={loading}
                    onClick={startCheckout}
                    className={
                        featured
                            ? 'pricing-card__cta btn btn-primary btn-large'
                            : 'pricing-card__cta'
                    }
                >
                    <span className="pricing-card__cta-inner">
                        {loading ? <span className="pricing-card__cta-spinner" aria-hidden /> : null}
                        {t('pricing_cta_subscribe')}
                    </span>
                </button>
                {alreadyOnPlan ? (
                    <p className="pricing-card__cta-note" style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                        {t('adjust_plan_alreadyOnPlan')}
                    </p>
                ) : null}
                {error ? (
                    <p className="pricing-card__cta-error" style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>
                        {error}
                    </p>
                ) : null}
            </>
        );
    }

    return (
        <Link
            to={tier.to}
            className={
                featured ? 'pricing-card__cta btn btn-primary btn-large' : 'pricing-card__cta'
            }
        >
            {featured ? (
                <>
                    <span>{t(tier.ctaKey)}</span>
                    <CtaArrowIcon />
                </>
            ) : (
                t(tier.ctaKey)
            )}
        </Link>
    );
}

function CtaArrowIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M7.5 15L12.5 10L7.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Horizontal strip: credit cost per operation (above plan cards). */
function PricingUsageCostsBar({ t }) {
    const items = useMemo(() => listUsageCreditCosts(), []);
    return (
        <section className="pricing-usage-costs" aria-label={t('pricing_usage_costs_heading')}>
            <div className="pricing-usage-costs__row">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className="pricing-usage-costs__item"
                        dir="ltr"
                        data-unit={item.unitKey}
                    >
                        <span className="pricing-usage-costs__label">{t(item.labelKey)}</span>
                        <span className="pricing-usage-costs__eq" aria-hidden="true">
                            =
                        </span>
                        <span className="pricing-usage-costs__value">
                            <span className="pricing-usage-costs__credits">{item.credits}</span>
                            <span className="pricing-usage-costs__unit">{t(item.unitKey)}</span>
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function PricingPrice({ tier, t }) {
    if (tier.priceKind === 'free') {
        return (
            <span className="pricing-card__price" dir="ltr">
                <span className="pricing-card__price-value">{t('pricing_price_free')}</span>
            </span>
        );
    }

    if (tier.priceKind === 'custom') {
        return (
            <span className="pricing-card__price" dir="ltr">
                <span className="pricing-card__price-value">{t('billing_price_custom')}</span>
            </span>
        );
    }

    const info = getPriceDisplay(tier.planId, 'monthly');
    if (info.kind === 'custom') {
        return (
            <span className="pricing-card__price" dir="ltr">
                <span className="pricing-card__price-value">{t('billing_price_custom')}</span>
            </span>
        );
    }

    return (
        <span className="pricing-card__price" dir="ltr">
            <span className="pricing-card__price-value">${info.amount}</span>
            <span className="pricing-card__price-suffix">
                {t('billing_price_per_month')}
            </span>
        </span>
    );
}

function FaqChevron({ open }) {
    return (
        <svg
            className={`pricing-faq__chevron${open ? ' pricing-faq__chevron--open' : ''}`}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
        >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/** Accordion FAQ — styled to match the agent pricing shell. */
function PricingFaq({ t }) {
    const [openId, setOpenId] = useState(null);

    const toggle = (id) => {
        setOpenId((prev) => (prev === id ? null : id));
    };

    return (
        <section className="pricing-faq" aria-labelledby="pricing-faq-heading">
            <div className="pricing-faq__header">
                <h2 id="pricing-faq-heading" className="pricing-faq__title">
                    {t('pricing_faq_title')}
                </h2>
            </div>
            <div className="pricing-faq__list">
                {PRICING_FAQ_ITEMS.map((item) => {
                    const isOpen = openId === item.id;
                    const panelId = `pricing-faq-panel-${item.id}`;
                    const buttonId = `pricing-faq-button-${item.id}`;
                    return (
                        <article
                            key={item.id}
                            className={`pricing-faq__item${isOpen ? ' pricing-faq__item--open' : ''}`}
                        >
                            <div className="pricing-faq__question-wrap">
                                <button
                                    id={buttonId}
                                    type="button"
                                    className="pricing-faq__question"
                                    aria-expanded={isOpen}
                                    aria-controls={panelId}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggle(item.id);
                                    }}
                                >
                                    <span className="pricing-faq__question-text">{t(item.qKey)}</span>
                                    <FaqChevron open={isOpen} />
                                </button>
                            </div>
                            <div
                                id={panelId}
                                role="region"
                                aria-labelledby={buttonId}
                                aria-hidden={!isOpen}
                                className={`pricing-faq__answer-wrap${isOpen ? ' pricing-faq__answer-wrap--open' : ''}`}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="pricing-faq__answer-inner">
                                    <p className="pricing-faq__answer">{t(item.aKey)}</p>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

export default function PricingPage() {
    const { t } = useLanguage();
    const [audience, setAudience] = useState('plans');

    const tiers = useMemo(() => PRICING_TIERS, []);
    const showEnterprise = audience === 'enterprise';

    useEffect(() => {
        const previous = document.title;
        document.title = `${t('navPricing')} · evaalo`;
        return () => {
            document.title = previous;
        };
    }, [t]);

    return (
        <LegalPageShell title={t('navPricing')} variant="agent">
            <div className="pricing-plans">
                <PricingUsageCostsBar t={t} />
                <PricingAudienceToggle audience={audience} onChange={setAudience} t={t} />
                {showEnterprise ? (
                    <div className="pricing-plans__grid pricing-plans__grid--enterprise">
                        <article className="pricing-card pricing-card--featured pricing-card--enterprise">
                            <div className="pricing-card__header">
                                <h2 className="pricing-card__name">
                                    {t('billing_plan_enterprise_name')}
                                </h2>
                                <p className="pricing-card__tagline">
                                    {t('pricing_tagline_enterprise')}
                                </p>
                                <PricingPrice tier={{ priceKind: 'custom' }} t={t} />
                            </div>
                            <EnterprisePlanCardContents t={t} />
                            <div className="pricing-card__footer">
                                <EnterpriseContactCta t={t} />
                            </div>
                        </article>
                    </div>
                ) : (
                    <div className="pricing-plans__grid">
                        {tiers.map((tier) => (
                            <article
                                key={tier.id}
                                className={`pricing-card${tier.featured ? ' pricing-card--featured' : ''}`}
                            >
                                <div className="pricing-card__header">
                                    {tier.featured ? (
                                        <span className="pricing-card__badge">
                                            {t('billing_badge_popular')}
                                        </span>
                                    ) : null}
                                    <h2 className="pricing-card__name">{t(tier.nameKey)}</h2>
                                    <p className="pricing-card__tagline">
                                        {t(getPlanById(tier.planId)?.displayDescKey ?? '')}
                                    </p>
                                    <PricingPrice tier={tier} t={t} />
                                </div>
                                <PlanCardContents planId={tier.planId} t={t} />
                                <div className="pricing-card__footer">
                                    <PricingPlanCta
                                        tier={tier}
                                        featured={tier.featured}
                                        t={t}
                                    />
                                </div>
                            </article>
                        ))}
                    </div>
                )}
                <PricingFaq t={t} />
            </div>
        </LegalPageShell>
    );
}
