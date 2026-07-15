import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const GlobeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path
            d="M3 12h18M12 3c2.5 2.8 4 6 4 9s-1.5 6.2-4 9M12 3c-2.5 2.8-4 6-4 9s1.5 6.2 4 9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        />
    </svg>
);

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const NAV_LANGUAGES = [
    { id: 'en', name: 'English' },
    { id: 'ar', name: 'العربية' },
    { id: 'ku', name: 'کوردی', codeText: '(KU)' },
];

const SETTINGS_LANGUAGES = [
    { id: 'ar', name: 'عربي' },
    { id: 'ku', name: 'کوردی' },
    { id: 'en', name: 'English' },
];

function SettingsLanguageOptions({ currentLang, changeLanguage, ariaLabel }) {
    return (
        <div className="account-settings-lang-options" role="radiogroup" aria-label={ariaLabel}>
            {SETTINGS_LANGUAGES.map(({ id, name }) => (
                <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={currentLang === id}
                    data-lang={id}
                    className={`account-settings-lang-option${
                        currentLang === id ? ' account-settings-lang-option--active' : ''
                    }`}
                    onClick={() => changeLanguage(id)}
                >
                    {name}
                </button>
            ))}
        </div>
    );
}

export default function LanguageToggle({ variant = 'nav' }) {
    const { currentLang, changeLanguage, t } = useLanguage();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const isSettings = variant === 'settings';

    useEffect(() => {
        if (isSettings || !open) return;
        const onDocDown = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const onEsc = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocDown);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocDown);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open, isSettings]);

    if (isSettings) {
        return (
            <SettingsLanguageOptions
                currentLang={currentLang}
                changeLanguage={changeLanguage}
                ariaLabel={t('languageToggleAria')}
            />
        );
    }

    return (
        <div className="nav-lang-toggle-wrap" ref={wrapRef}>
            <button
                type="button"
                className={`nav-lang-toggle${open ? ' nav-lang-toggle--open' : ''}`}
                data-current-lang={currentLang}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={t('languageToggleAria')}
                onClick={() => setOpen((o) => !o)}
            >
                <GlobeIcon />
            </button>
            <div
                className={`nav-lang-dropdown ${open ? 'nav-lang-dropdown--open' : ''}`}
                role="menu"
                aria-hidden={!open}
            >
                {NAV_LANGUAGES.map(({ id, name, codeText }) => (
                    <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentLang === id}
                        data-lang={id}
                        className={`nav-lang-dropdown__option ${
                            currentLang === id ? 'nav-lang-dropdown__option--active' : ''
                        }`}
                        onClick={() => {
                            changeLanguage(id);
                            setOpen(false);
                        }}
                    >
                        <span className="nav-lang-dropdown__option-label">{name}</span>
                        {codeText ? (
                            <span className="nav-lang-dropdown__option-code">{codeText}</span>
                        ) : null}
                        {currentLang === id ? (
                            <span className="nav-lang-dropdown__check" aria-hidden>
                                <CheckIcon />
                            </span>
                        ) : (
                            <span className="nav-lang-dropdown__check nav-lang-dropdown__check--empty" aria-hidden />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
