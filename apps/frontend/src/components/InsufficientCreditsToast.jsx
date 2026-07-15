import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { INSUFFICIENT_CREDITS_EVENT } from '../services/apiClient';

const AUTO_HIDE_MS = 7000;

/**
 * تنبيه مركزي موحّد لنفاد الرصيد (402/INSUFFICIENT_CREDITS من أي ميزة).
 * يستمع لحدث apiClient ويعرض توست بزر ترقية — الرسائل المحلية داخل الميزات تبقى.
 * يُركّب مرة واحدة في App داخل BillingProvider.
 */
export default function InsufficientCreditsToast() {
    const { t } = useLanguage();
    const { refetch } = useBilling();
    const [visible, setVisible] = useState(false);
    const hideTimerRef = useRef(null);

    useEffect(() => {
        const onInsufficient = () => {
            setVisible(true);
            // حدّث الرصيد المعروض في الهيدر فوراً.
            refetch?.().catch(() => undefined);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            hideTimerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
        };
        window.addEventListener(INSUFFICIENT_CREDITS_EVENT, onInsufficient);
        return () => {
            window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, onInsufficient);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [refetch]);

    if (!visible) return null;

    return (
        <div className="insufficient-credits-toast" role="alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="insufficient-credits-toast__text">
                {t('billing_insufficient_toast')}
            </span>
            <Link
                to="/account/billing"
                className="insufficient-credits-toast__cta"
                onClick={() => setVisible(false)}
            >
                {t('billing_insufficient_cta')}
            </Link>
            <button
                type="button"
                className="insufficient-credits-toast__close"
                aria-label="Close"
                onClick={() => setVisible(false)}
            >
                ×
            </button>
        </div>
    );
}
