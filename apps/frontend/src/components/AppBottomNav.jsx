import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';
import { fillI18nTemplate } from '../utils/i18nTemplate';
import {
    isAccountTabActive,
    isNotificationsTabActive,
    isServicesTabActive,
    isSettingsTabActive,
    shouldShowAppBottomNav,
} from '../utils/appRoutes';
import '../design-styles.css';

const ServicesIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
);

const NotificationsIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
            d="M18 8.5A6 6 0 0 0 6 8.5c0 7-3 8-3 8h18s-3-1-3-8Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
        />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
            d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
        />
        <circle cx="4" cy="14" r="2" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="12" cy="6" r="2" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="20" cy="13" r="2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
);

const AccountIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
        <path
            d="M4 20v-1a6 6 0 016-6h4a6 6 0 016 6v1"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
        />
    </svg>
);

const BRANDED_NAV_KEYS = new Set(['services', 'notifications', 'settings', 'account']);

const AppBottomNav = () => {
    const { pathname } = useLocation();
    const { t } = useLanguage();
    const unreadNotificationCount = useUnreadNotifications();
    const visible = shouldShowAppBottomNav(pathname);

    useEffect(() => {
        document.body.classList.toggle('app-mobile-bottom-nav', visible);
        return () => document.body.classList.remove('app-mobile-bottom-nav');
    }, [visible]);

    if (!visible) return null;

    const tabs = [
        {
            key: 'services',
            to: '/dashboard',
            label: t('appBottomNavServices'),
            active: isServicesTabActive(pathname),
            Icon: ServicesIcon,
        },
        {
            key: 'notifications',
            to: '/notifications',
            label: t('appBottomNavNotifications'),
            active: isNotificationsTabActive(pathname),
            Icon: NotificationsIcon,
        },
        {
            key: 'settings',
            to: '/account/settings',
            label: t('appBottomNavSettings'),
            active: isSettingsTabActive(pathname),
            Icon: SettingsIcon,
        },
        {
            key: 'account',
            to: '/account',
            label: t('appBottomNavAccount'),
            active: isAccountTabActive(pathname),
            Icon: AccountIcon,
        },
    ];

    return (
        <nav className="app-bottom-nav" aria-label={t('appBottomNavAria')}>
            <div className="app-bottom-nav__inner">
                {tabs.map(({ key, to, label, active, Icon }) => (
                    <Link
                        key={key}
                        to={to}
                        className={[
                            'app-bottom-nav__item',
                            active ? 'app-bottom-nav__item--active' : '',
                            BRANDED_NAV_KEYS.has(key) ? `app-bottom-nav__item--${key}` : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        aria-current={active ? 'page' : undefined}
                        aria-label={
                            key === 'notifications' && unreadNotificationCount > 0 && !active
                                ? fillI18nTemplate(t('appBottomNavNotificationsUnread'), {
                                      count: String(unreadNotificationCount),
                                  })
                                : undefined
                        }
                    >
                        <span className="app-bottom-nav__icon">
                            <Icon />
                            {key === 'notifications' && unreadNotificationCount > 0 && !active ? (
                                <span className="app-bottom-nav__badge" aria-hidden="true">
                                    {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                                </span>
                            ) : null}
                        </span>
                        <span className="app-bottom-nav__label">{label}</span>
                    </Link>
                ))}
            </div>
        </nav>
    );
};

export default AppBottomNav;
