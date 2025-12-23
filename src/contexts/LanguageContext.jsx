import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations } from '../translations';

const LanguageContext = createContext();

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within LanguageProvider');
    }
    return context;
};

export const LanguageProvider = ({ children }) => {
    const [currentLang, setCurrentLang] = useState('en');

    useEffect(() => {
        // Update HTML lang attribute
        const htmlElement = document.getElementById('htmlLang');
        if (htmlElement) {
            htmlElement.setAttribute('lang', currentLang);
        }

        // Update body classes for RTL
        if (currentLang === 'ar' || currentLang === 'ku') {
            document.body.classList.add('rtl-text');
            document.body.classList.remove('ltr-text');
        } else {
            document.body.classList.add('ltr-text');
            document.body.classList.remove('rtl-text');
        }
    }, [currentLang]);

    const changeLanguage = (lang) => {
        setCurrentLang(lang);
    };

    const t = (key) => {
        return translations[currentLang]?.[key] || translations.en[key] || key;
    };

    const value = {
        currentLang,
        changeLanguage,
        t,
        translations: translations[currentLang]
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
};

