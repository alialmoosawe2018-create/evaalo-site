import React from 'react';

/** Shared account sidebar / mobile nav configuration */

function IconOverview(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
    );
}

function IconBarChart(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M12 20V10M18 20V4M6 20v-4" />
        </svg>
    );
}

function IconWallet(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
    );
}

function IconReceipt(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM16 8H8M16 12H8M10 16H8" />
        </svg>
    );
}

export const accountNavIconById = {
    overview: IconOverview,
    usage: IconBarChart,
    spending: IconWallet,
    billing: IconReceipt,
};

export const accountNavLabelKey = {
    overview: 'account_navOverview',
    usage: 'account_navInterviewActivity',
    spending: 'account_navSpending',
    billing: 'account_navBilling',
};

/** Mobile top bar — billing, activity (usage), spending, plus overview */
export const ACCOUNT_MOBILE_NAV_IDS = ['overview', 'usage', 'spending', 'billing'];

export const ACCOUNT_SIDEBAR_NAV_IDS = [
    { section: 0, id: 'overview' },
    { section: 1, id: 'members' },
    { section: 1, id: 'usage' },
    { section: 1, id: 'spending' },
    { section: 1, id: 'billing' },
];

export function routeForAccountNavItem(id) {
    if (id === 'overview') return '/account';
    if (id === 'usage') return '/account/usage';
    if (id === 'spending') return '/account/spending';
    if (id === 'billing') return '/account/billing';
    if (id === 'members') return '/account/members';
    return null;
}
