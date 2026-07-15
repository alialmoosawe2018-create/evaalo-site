import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import NewInterviewSidebar from './NewInterviewSidebar';

const CTA = () => {
    const { t } = useLanguage();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const handleOpenSidebar = () => {
        setIsSidebarOpen(true);
    };

    const handleSidebarOption = (optionId) => {
        console.log('Selected option:', optionId);
        // يمكن إضافة منطق إضافي هنا إذا لزم الأمر
    };

    return (
        <>
            <section className="cta">
                <div className="cta-content">
                    <h2 className="cta-title">{t('ctaTitle')}</h2>
                    <p className="cta-description">{t('ctaDescription')}</p>
                    <button className="btn btn-primary btn-large" onClick={handleOpenSidebar}>
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

            {/* New Campaign Sidebar */}
            <NewInterviewSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onSelectOption={handleSidebarOption}
            />
        </>
    );
};

export default CTA;
