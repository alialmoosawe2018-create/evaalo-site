import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'evaalo_app_theme';

const ThemeContext = createContext(null);

function readStoredTheme() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'light' || v === 'dark') return v;
    } catch {
        /* ignore */
    }
    return 'dark';
}

function applyThemeToDocument(theme) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-app-theme', theme);
}

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return ctx;
};

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(() => {
        const initial = readStoredTheme();
        applyThemeToDocument(initial);
        return initial;
    });

    useEffect(() => {
        applyThemeToDocument(theme);
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            /* ignore */
        }
    }, [theme]);

    const setTheme = useCallback((next) => {
        if (next === 'light' || next === 'dark') {
            setThemeState(next);
        }
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};
