import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

const CTA = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();

    const navigateToApplication = () => {
        navigate('/form');
    };

    return (
        <section className="cta">
            <div className="cta-content">
                <h2 className="cta-title">{t('ctaTitle')}</h2>
                <p className="cta-description">{t('ctaDescription')}</p>
                <button className="btn btn-primary btn-large" onClick={navigateToApplication}>
                    <span>{t('startApplication')}</span>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </button>
            </div>
            <div className="cta-background">
                <div className="cta-orb cta-orb-1"></div>
                <div className="cta-orb cta-orb-2"></div>
                <div className="cta-orb cta-orb-3"></div>
            </div>
        </section>
    );
};

export default CTA;

