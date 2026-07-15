import React, { useCallback, useId, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Single morphing celestial icon: a sun disc with rays that morphs into a
 * crescent moon. The crescent is carved by a mask circle that slides in over
 * the disc, while the rays retract. Driven entirely by CSS off data-current-theme.
 */
function MorphIcon({ maskId }) {
    return (
        <svg
            className="nav-theme-toggle__morph"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
        >
            <mask id={maskId}>
                <rect x="0" y="0" width="24" height="24" fill="white" />
                <circle className="nav-theme-toggle__mask-circle" cx="12" cy="12" r="7" fill="black" />
            </mask>
            <circle
                className="nav-theme-toggle__core"
                cx="12"
                cy="12"
                r="6"
                fill="currentColor"
                mask={`url(#${maskId})`}
            />
            <g
                className="nav-theme-toggle__rays"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            >
                <line x1="12" y1="1" x2="12" y2="3.2" />
                <line x1="12" y1="20.8" x2="12" y2="23" />
                <line x1="1" y1="12" x2="3.2" y2="12" />
                <line x1="20.8" y1="12" x2="23" y2="12" />
                <line x1="4.05" y1="4.05" x2="5.6" y2="5.6" />
                <line x1="18.4" y1="18.4" x2="19.95" y2="19.95" />
                <line x1="4.05" y1="19.95" x2="5.6" y2="18.4" />
                <line x1="18.4" y1="5.6" x2="19.95" y2="4.05" />
            </g>
        </svg>
    );
}

export default function ThemeToggle({ variant = 'nav' }) {
    const { t } = useLanguage();
    const { theme, setTheme } = useTheme();
    const isSettings = variant === 'settings';
    const [switching, setSwitching] = useState(false);
    const switchTimer = useRef(null);
    const maskId = useId().replace(/:/g, '') + '-moon-mask';

    const handleToggle = useCallback(() => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        setSwitching(true);
        if (switchTimer.current) clearTimeout(switchTimer.current);
        switchTimer.current = setTimeout(() => setSwitching(false), 640);
    }, [theme, setTheme]);

    if (isSettings) {
        const isDark = theme === 'dark';
        return (
            <label className="account-settings-theme-switch">
                <input
                    type="checkbox"
                    className="account-settings-theme-switch__input"
                    checked={isDark}
                    onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
                    aria-label={t('themeToggleAria')}
                />
                <span className="account-settings-theme-switch__track" aria-hidden />
                <span className="account-settings-theme-switch__thumb" aria-hidden />
            </label>
        );
    }

    const isDark = theme === 'dark';

    return (
        <div className="nav-theme-toggle-wrap">
            <button
                type="button"
                className={`nav-theme-toggle${switching ? ' nav-theme-toggle--switching' : ''}`}
                data-current-theme={theme}
                role="switch"
                aria-checked={isDark}
                aria-label={t('themeToggleAria')}
                title={isDark ? t('themeLight') : t('themeDark')}
                onClick={handleToggle}
            >
                <span className="nav-theme-toggle__burst" aria-hidden />
                <MorphIcon maskId={maskId} />
            </button>
        </div>
    );
}
