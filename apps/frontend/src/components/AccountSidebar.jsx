import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBilling } from '../contexts/BillingContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getMyProfile } from '../services/profileService';
import { getPlanById } from '../utils/billingDisplay';
import {
    ACCOUNT_SIDEBAR_NAV_IDS,
    accountNavIconById,
    accountNavLabelKey,
    routeForAccountNavItem,
} from './accountNavConfig.jsx';

export const ACCOUNT_BORDER = 'rgba(255, 255, 255, 0.1)';
export const ACCOUNT_MUTED = '#94a3b8';
const SIDEBAR_AVATAR_SIZE = 48;

function IconUsers(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
    );
}

const navIconById = { ...accountNavIconById, members: IconUsers };

const navItemIds = ACCOUNT_SIDEBAR_NAV_IDS;

function IconArrowLeft(props) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
            <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
    );
}

function IconUpgrade(props) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
            <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
    );
}

function IconLogOut(props) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
    );
}

function IconChevron(props) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

const navLabelKey = { ...accountNavLabelKey, members: 'account_navMembers' };

function routeForNavItem(id) {
    return routeForAccountNavItem(id);
}

function initialsFromName(name) {
    const parts = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
    return '?';
}

/**
 * @param {object} props
 * @param {string} props.activeId — e.g. 'overview' | 'usage' | 'spending' | 'billing' | 'members'
 * @param {{ to: string, ariaLabel?: string, label?: string } | null | undefined} [props.bottomBack] — footer control; undefined = default /dashboard + aria; null = hide
 */
export function AccountSidebar({ activeId, bottomBack }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { user, clerk, provider, logout } = useAuth();
    const { currentPlanId } = useBilling();
    const [profile, setProfile] = useState(null);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const moreMenuRef = useRef(null);
    const BORDER = ACCOUNT_BORDER;
    useEffect(() => {
        let cancelled = false;
        getMyProfile()
            .then((p) => {
                if (!cancelled) setProfile(p);
            })
            .catch(() => {
                if (!cancelled) setProfile(null);
            });
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const displayName = useMemo(() => {
        const fromProfile = profile?.fullName?.trim();
        const fromSession = user?.name?.trim();
        const fromClerk = [clerk?.user?.firstName, clerk?.user?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
        return fromProfile || fromSession || fromClerk || '';
    }, [profile?.fullName, user?.name, clerk?.user?.firstName, clerk?.user?.lastName]);

    const avatarUrl = useMemo(() => {
        if (provider === 'clerk' && clerk?.user?.imageUrl) return clerk.user.imageUrl;
        const fromProfile = profile?.imageUrl?.trim();
        const fromSession = user?.imageUrl?.trim();
        return fromProfile || fromSession || '';
    }, [provider, clerk?.user?.imageUrl, profile?.imageUrl, user?.imageUrl]);

    const avatarInitials = useMemo(() => initialsFromName(displayName), [displayName]);

    const planBadgeLabel = useMemo(() => {
        const plan = getPlanById(currentPlanId);
        return plan ? t(plan.displayNameKey) : t('account_planBadgePro');
    }, [currentPlanId, t]);

    const sidebarSections = useMemo(() => {
        const bySection = [[], []];
        for (const row of navItemIds) {
            const Icon = navIconById[row.id];
            bySection[row.section].push({ id: row.id, label: t(navLabelKey[row.id]), icon: Icon });
        }
        return [{ items: bySection[0] }, { items: bySection[1] }];
    }, [t]);

    const resolvedBottom =
        bottomBack === undefined
            ? { to: '/dashboard', ariaLabel: t('account_sidebarBackAria') }
            : bottomBack;

    const handleNavClick = (itemId) => {
        const path = routeForNavItem(itemId);
        if (path) navigate(path);
    };

    useEffect(() => {
        if (!moreMenuOpen) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') setMoreMenuOpen(false);
        };
        const onMouseDown = (e) => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
                setMoreMenuOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [moreMenuOpen]);

    const handleUpgradeSubscription = () => {
        setMoreMenuOpen(false);
        navigate('/account/billing');
    };

    const handleLogOut = async () => {
        if (loggingOut) return;
        setMoreMenuOpen(false);
        setLoggingOut(true);
        try {
            await logout();
            navigate('/login');
        } finally {
            setLoggingOut(false);
        }
    };

    const bottomAria = resolvedBottom && (resolvedBottom.ariaLabel || resolvedBottom.label || t('account_back'));

    return (
        <aside
            className="dashboard-card account-sidebar"
            style={{
                width: 260,
                flexShrink: 0,
                position: 'sticky',
                top: 88,
                borderRadius: 8,
                padding: '18px 14px',
                boxSizing: 'border-box',
            }}
        >
            <div
                className="account-sidebar-head"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 10px 16px',
                    borderBottom: `1px solid ${BORDER}`,
                    position: 'relative',
                }}
            >
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt=""
                        className="account-sidebar-avatar"
                        width={SIDEBAR_AVATAR_SIZE}
                        height={SIDEBAR_AVATAR_SIZE}
                        style={{
                            width: SIDEBAR_AVATAR_SIZE,
                            height: SIDEBAR_AVATAR_SIZE,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            flexShrink: 0,
                            border: `1px solid ${BORDER}`,
                        }}
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div
                        className="account-sidebar-avatar account-sidebar-avatar--fallback"
                        style={{
                            width: SIDEBAR_AVATAR_SIZE,
                            height: SIDEBAR_AVATAR_SIZE,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 15,
                            color: '#fff',
                            flexShrink: 0,
                        }}
                        aria-hidden
                    >
                        {avatarInitials}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {displayName ? (
                        <div
                            className="account-sidebar-user-name"
                            style={{
                                fontWeight: 600,
                                fontSize: 14,
                                lineHeight: 1.3,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                            title={displayName}
                        >
                            {displayName}
                        </div>
                    ) : null}
                    <span
                        className={`account-sidebar-plan-badge${
                            displayName ? '' : ' account-sidebar-plan-badge--solo'
                        }`}
                    >
                        {planBadgeLabel}
                    </span>
                </div>
                <div ref={moreMenuRef} className="account-sidebar-more-wrap">
                    <button
                        type="button"
                        aria-label={t('account_moreMenu')}
                        aria-expanded={moreMenuOpen}
                        aria-haspopup="menu"
                        className={`btn btn-secondary btn-large account-sidebar-more${
                            moreMenuOpen ? ' account-sidebar-more--open' : ''
                        }`}
                        onClick={() => setMoreMenuOpen((open) => !open)}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <circle cx="12" cy="6" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="18" r="1.5" />
                        </svg>
                    </button>
                    {moreMenuOpen ? (
                        <div role="menu" className="account-sidebar-more-menu">
                            <div className="account-sidebar-more-menu-head">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt=""
                                        className="account-sidebar-more-menu-head__avatar"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <span className="account-sidebar-more-menu-head__avatar account-sidebar-more-menu-head__avatar--fallback" aria-hidden>
                                        {avatarInitials}
                                    </span>
                                )}
                                <span className="account-sidebar-more-menu-head__text">
                                    {displayName ? (
                                        <span className="account-sidebar-more-menu-head__name" title={displayName}>
                                            {displayName}
                                        </span>
                                    ) : null}
                                    <span className="account-sidebar-more-menu-head__plan">
                                        <span className="account-sidebar-more-menu-head__plan-label">
                                            {t('account_sidebarMenuCurrentPlan')}
                                        </span>
                                        <span className="account-sidebar-more-menu-head__plan-badge">
                                            {planBadgeLabel}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="account-sidebar-more-menu-body">
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="account-sidebar-more-menu-item account-sidebar-more-menu-item--upgrade"
                                    onClick={handleUpgradeSubscription}
                                >
                                    <span className="account-sidebar-more-menu-item__icon" aria-hidden>
                                        <IconUpgrade />
                                    </span>
                                    <span className="account-sidebar-more-menu-item__label">
                                        {t('account_sidebarMenuUpgradeSubscription')}
                                    </span>
                                    <span className="account-sidebar-more-menu-item__chevron" aria-hidden>
                                        <IconChevron />
                                    </span>
                                </button>
                                <div className="account-sidebar-more-menu-divider" role="separator" />
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="account-sidebar-more-menu-item account-sidebar-more-menu-item--logout"
                                    disabled={loggingOut}
                                    onClick={handleLogOut}
                                >
                                    <span className="account-sidebar-more-menu-item__icon" aria-hidden>
                                        <IconLogOut />
                                    </span>
                                    <span className="account-sidebar-more-menu-item__label">
                                        {loggingOut ? t('account_settingsLoggingOut') : t('account_settingsLogOut')}
                                    </span>
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <nav className="account-sidebar-nav" style={{ paddingTop: 8 }}>
                {sidebarSections.map((section, si) => (
                    <div key={si}>
                        {si > 0 ? (
                            <div className="account-sidebar-nav-divider" style={{ height: 1, background: BORDER, margin: '10px 8px' }} />
                        ) : null}
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {section.items.map((item) => {
                                const Icon = item.icon;
                                const active = item.id === activeId;
                                return (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={`btn btn-secondary account-nav-item${
                                                active ? ' account-nav-item--active' : ''
                                            }`}
                                            style={{ marginBottom: 2 }}
                                            onClick={() => handleNavClick(item.id)}
                                        >
                                            <Icon style={{ opacity: active ? 1 : 0.85 }} />
                                            {item.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            {resolvedBottom ? (
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
                    <button
                        type="button"
                        onClick={() => navigate(resolvedBottom.to)}
                        className="btn btn-secondary btn-large account-sidebar-cta"
                        aria-label={bottomAria}
                    >
                        <IconArrowLeft />
                    </button>
                </div>
            ) : null}
        </aside>
    );
}

export default AccountSidebar;
