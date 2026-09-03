import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { reportError } from '../observability/errorReporter';

/**
 * 404 page. Previously an unknown URL rendered the shell and nothing else — no
 * signal to the user and no trace for us. Now it says so and reports the miss,
 * which also surfaces broken internal links.
 */
const NotFound = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();

    React.useEffect(() => {
        reportError({
            message: `Route not found: ${location.pathname}`,
            severity: 'warn',
        });
    }, [location.pathname]);

    return (
        <div style={{ maxWidth: 560, margin: '16vh auto', padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 52, fontWeight: 800, color: '#3b82f6' }}>404</div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '8px 0 10px' }}>
                {t('notFoundTitle')}
            </h1>
            <p style={{ color: '#475569', lineHeight: 1.7, margin: '0 0 22px' }}>
                {t('notFoundBody')}
            </p>
            <button
                type="button"
                onClick={() => navigate('/')}
                style={{
                    padding: '12px 26px',
                    fontWeight: 700,
                    color: '#fff',
                    background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                    border: 'none',
                    borderRadius: 12,
                    cursor: 'pointer',
                }}
            >
                {t('notFoundHome')}
            </button>
        </div>
    );
};

export default NotFound;
