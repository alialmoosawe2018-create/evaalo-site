import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import {
    ACCOUNT_MOBILE_NAV_IDS,
    accountNavIconById,
    accountNavLabelKey,
    routeForAccountNavItem,
} from './accountNavConfig.jsx';

/**
 * Horizontal account sub-nav for mobile (overview, activity, spending, billing).
 * @param {object} props
 * @param {string} props.activeId
 */
export function AccountMobileNav({ activeId }) {
    const navigate = useNavigate();
    const { t } = useLanguage();

    const items = useMemo(
        () =>
            ACCOUNT_MOBILE_NAV_IDS.map((id) => ({
                id,
                label: t(accountNavLabelKey[id]),
                Icon: accountNavIconById[id],
                path: routeForAccountNavItem(id),
            })),
        [t],
    );

    return (
        <nav className="account-mobile-nav" aria-label={t('account_mobileNavAria')}>
            <div className="account-mobile-nav__track" role="tablist">
                {items.map(({ id, label, Icon, path }) => {
                    const active = id === activeId;
                    return (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            className={`account-mobile-nav__item${active ? ' account-mobile-nav__item--active' : ''}`}
                            onClick={() => {
                                if (!active && path) navigate(path);
                            }}
                        >
                            <Icon className="account-mobile-nav__icon" aria-hidden />
                            <span className="account-mobile-nav__label">{label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

export default AccountMobileNav;
