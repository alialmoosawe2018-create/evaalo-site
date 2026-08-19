import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import NewInterviewSidebar from './NewInterviewSidebar';

const CTA_FAQ_ITEMS = [
    { id: 'what-is', qKey: 'ctaFaqWhatIsQ', aKey: 'ctaFaqWhatIsA' },
    { id: 'free-trial', qKey: 'ctaFaqFreeTrialQ', aKey: 'ctaFaqFreeTrialA' },
    { id: 'languages', qKey: 'ctaFaqLanguagesQ', aKey: 'ctaFaqLanguagesA' },
];

function CtaFaqChevron({ open }) {
    return (
        <svg
            className={`cta-faq__chevron${open ? ' cta-faq__chevron--open' : ''}`}
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

const CTA = () => {
    const { t } = useLanguage();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [openFaqId, setOpenFaqId] = useState(null);

    const handleOpenSidebar = () => {
        setIsSidebarOpen(true);
    };

    const handleSidebarOption = (optionId) => {
        console.log('Selected option:', optionId);
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
                    <div className="cta-faq" aria-label={t('ctaFaqLabel')}>
                        {CTA_FAQ_ITEMS.map((item) => {
                            const isOpen = openFaqId === item.id;
                            const panelId = `cta-faq-panel-${item.id}`;
                            const buttonId = `cta-faq-button-${item.id}`;
                            return (
                                <article
                                    key={item.id}
                                    className={`cta-faq__item${isOpen ? ' cta-faq__item--open' : ''}`}
                                >
                                    <button
                                        id={buttonId}
                                        type="button"
                                        className="cta-faq__question"
                                        aria-expanded={isOpen}
                                        aria-controls={panelId}
                                        onClick={() => setOpenFaqId((prev) => (prev === item.id ? null : item.id))}
                                    >
                                        <span className="cta-faq__question-text">{t(item.qKey)}</span>
                                        <CtaFaqChevron open={isOpen} />
                                    </button>
                                    <div
                                        id={panelId}
                                        role="region"
                                        aria-labelledby={buttonId}
                                        hidden={!isOpen}
                                        className="cta-faq__answer-wrap"
                                    >
                                        <p className="cta-faq__answer">{t(item.aKey)}</p>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
                <div className="cta-background">
                    <div className="cta-orb cta-orb-1"></div>
                    <div className="cta-orb cta-orb-2"></div>
                    <div className="cta-orb cta-orb-3"></div>
                </div>
            </section>

            <NewInterviewSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onSelectOption={handleSidebarOption}
            />
        </>
    );
};

export default CTA;
