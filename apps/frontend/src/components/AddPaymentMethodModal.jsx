import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useLanguage } from '../contexts/LanguageContext';
import '../design-styles.css';

const SHELL_BG = 'linear-gradient(180deg, rgba(30, 41, 59, 0.65) 0%, rgba(15, 23, 42, 0.72) 100%)';
const SHELL_BORDER = '2px solid rgba(255, 255, 255, 0.12)';
const SHELL_SHADOW = '0 12px 40px rgba(0, 0, 0, 0.4)';
const MUTED = '#94a3b8';

function PaymentMethodForm({ onSuccess, onClose, setupIntentId }) {
    const { t } = useLanguage();
    const stripe = useStripe();
    const elements = useElements();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [elementReady, setElementReady] = useState(false);
    const [elementLoadError, setElementLoadError] = useState(null);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!stripe || !elements || submitting || !elementReady) return;

        setSubmitting(true);
        setError(null);
        try {
            const { error: confirmError, setupIntent } = await stripe.confirmSetup({
                elements,
                confirmParams: {
                    return_url: window.location.href,
                },
                redirect: 'if_required',
            });

            if (confirmError) {
                setError(confirmError.message || t('billing_portal_action_failed'));
                return;
            }

            const intentId = setupIntent?.id || setupIntentId;
            if (setupIntent?.status === 'succeeded' && intentId) {
                await onSuccess(intentId);
                return;
            }

            setError(t('billing_portal_action_failed'));
        } catch (err) {
            setError(err?.message || t('billing_portal_action_failed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
                className="add-payment-method-modal__element-host"
                style={{
                    minHeight: elementReady ? 'auto' : 120,
                    padding: '4px 0',
                }}
            >
                {!elementReady && !elementLoadError ? (
                    <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                        {t('billing_portal_paymentElementLoading')}
                    </p>
                ) : null}
                <PaymentElement
                    id="add-payment-method-element"
                    onReady={() => setElementReady(true)}
                    onLoadError={(event) => {
                        setElementLoadError(
                            event?.error?.message || t('billing_portal_paymentElementFailed'),
                        );
                    }}
                    options={{
                        layout: 'accordion',
                        wallets: {
                            applePay: 'never',
                            googlePay: 'never',
                            link: 'never',
                        },
                    }}
                />
            </div>
            {elementLoadError ? (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: '#f87171', lineHeight: 1.45 }}>
                    {elementLoadError}
                </p>
            ) : null}
            {error ? (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: '#f87171', lineHeight: 1.45 }}>
                    {error}
                </p>
            ) : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                <button
                    type="submit"
                    disabled={!stripe || !elements || !elementReady || submitting || Boolean(elementLoadError)}
                    className="workflow-btn-primary ni-continue-btn"
                    style={{
                        flex: 1,
                        minWidth: 140,
                        padding: '11px 18px',
                        fontSize: 14,
                        fontWeight: 600,
                        borderRadius: 10,
                        cursor: submitting ? 'wait' : 'pointer',
                        opacity: !stripe || !elements || !elementReady || submitting ? 0.7 : 1,
                    }}
                >
                    {submitting ? '…' : t('billing_portal_savePaymentMethod')}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="btn btn-secondary"
                    style={{
                        padding: '11px 18px',
                        fontSize: 14,
                        fontWeight: 600,
                        borderRadius: 10,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        opacity: submitting ? 0.6 : 1,
                    }}
                >
                    {t('billing_portal_cancel')}
                </button>
            </div>
        </form>
    );
}

/**
 * In-page modal for adding a card via Stripe Payment Element (no redirect).
 */
export default function AddPaymentMethodModal({
    isOpen,
    onClose,
    clientSecret,
    publishableKey,
    setupIntentId,
    onSuccess,
}) {
    const { t, currentLang } = useLanguage();
    const modalDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const [stripeLoadError, setStripeLoadError] = useState(null);

    const stripePromise = useMemo(() => {
        if (!publishableKey) return null;
        return loadStripe(publishableKey);
    }, [publishableKey]);

    const appearance = useMemo(
        () => ({
            theme: 'night',
            variables: {
                colorPrimary: '#0ea5e9',
                colorBackground: '#0f172a',
                colorText: '#f8fafc',
                colorDanger: '#f87171',
                fontFamily: 'Inter, system-ui, sans-serif',
                borderRadius: '10px',
                spacingUnit: '4px',
            },
            rules: {
                '.Input': {
                    border: '1px solid rgba(34, 211, 238, 0.28)',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
                },
                '.Label': {
                    color: '#cbd5e1',
                },
            },
        }),
        [],
    );

    useEffect(() => {
        if (!isOpen) {
            setStripeLoadError(null);
            return undefined;
        }
        if (!stripePromise) return undefined;

        let cancelled = false;
        stripePromise
            .then((stripe) => {
                if (!cancelled && !stripe) {
                    setStripeLoadError(t('billing_portal_paymentElementFailed'));
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setStripeLoadError(t('billing_portal_paymentElementFailed'));
                }
            });

        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            cancelled = true;
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [isOpen, onClose, stripePromise, t]);

    if (!isOpen || !clientSecret || !stripePromise) return null;

    return createPortal(
        <>
            <style>{`
                .add-payment-method-modal__element-host .StripeElement,
                .add-payment-method-modal__element-host iframe {
                    width: 100% !important;
                    min-height: 44px;
                }
            `}</style>
            <div
                role="presentation"
                onClick={onClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    zIndex: 10001,
                }}
            />
            <div
                dir={modalDir}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-payment-method-title"
                className="new-interview-modal add-payment-method-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '94%',
                    maxWidth: 480,
                    background: SHELL_BG,
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: SHELL_BORDER,
                    borderRadius: 16,
                    boxShadow: SHELL_SHADOW,
                    zIndex: 10002,
                    padding: '24px 22px 20px',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 16,
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2
                            id="add-payment-method-title"
                            style={{
                                margin: 0,
                                fontSize: 20,
                                fontWeight: 700,
                                color: '#fff',
                                letterSpacing: '-0.02em',
                            }}
                        >
                            {t('billing_portal_addPaymentTitle')}
                        </h2>
                        <p style={{ margin: '8px 0 0', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                            {t('billing_portal_addPaymentSubtitle')}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="ni-header-btn-close"
                        onClick={onClose}
                        aria-label={t('adjust_plan_closeAria')}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                                d="M18 6L6 18M6 6l12 12"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>

                {stripeLoadError ? (
                    <p role="alert" style={{ margin: '0 0 16px', fontSize: 13, color: '#f87171', lineHeight: 1.5 }}>
                        {stripeLoadError}
                    </p>
                ) : (
                    <Elements
                        key={clientSecret}
                        stripe={stripePromise}
                        options={{
                            clientSecret,
                            appearance,
                            locale: currentLang === 'ar' ? 'ar' : 'en',
                        }}
                    >
                        <PaymentMethodForm
                            onSuccess={onSuccess}
                            onClose={onClose}
                            setupIntentId={setupIntentId}
                        />
                    </Elements>
                )}
            </div>
        </>,
        document.body,
    );
}
