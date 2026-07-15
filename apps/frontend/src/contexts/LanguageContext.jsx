import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations } from '../translations';
import { accountAreaExtras } from '../translations/accountAreaExtras';

const LanguageContext = createContext();

const STORAGE_KEY = 'evaalo_ui_lang';

function readStoredLang() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'ar' || v === 'ku' || v === 'en') return v;
    } catch (_) {}
    return 'en';
}

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within LanguageProvider');
    }
    return context;
};

export const LanguageProvider = ({ children }) => {
    const [currentLang, setCurrentLang] = useState(() =>
        typeof window === 'undefined' ? 'en' : readStoredLang()
    );

    useEffect(() => {
        // Update HTML lang; keep document dir LTR so nav/footer/grids do not mirror when lang is ar/ku.
        // Arabic/Kurdish reading direction is applied via body.rtl-text and CSS (direction:rtl) on text blocks.
        const htmlElement = document.documentElement;
        if (htmlElement) {
            htmlElement.setAttribute('lang', currentLang);
            htmlElement.setAttribute('dir', 'ltr');
        }

        // Update body classes and lang attribute for RTL
        if (currentLang === 'ar' || currentLang === 'ku') {
            document.body.classList.add('rtl-text');
            document.body.classList.remove('ltr-text');
            document.body.setAttribute('lang', currentLang);
        } else {
            document.body.classList.add('ltr-text');
            document.body.classList.remove('rtl-text');
            document.body.setAttribute('lang', currentLang);
        }
    }, [currentLang]);

    const changeLanguage = (lang) => {
        setCurrentLang(lang);
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (_) {}
    };

    const t = (key) => {
        return (
            translations[currentLang]?.[key] ??
            accountAreaExtras[currentLang]?.[key] ??
            translations.en[key] ??
            accountAreaExtras.en?.[key] ??
            key
        );
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
