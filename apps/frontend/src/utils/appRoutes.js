/** App shell routes (dashboard, services, account). */
export const APP_THEME_ROUTE_PREFIXES = [
    '/dashboard',
    '/workflow',
    '/candidates',
    '/ai-head-hunter',
    '/ai-cv-comparison',
    '/interview-templates',
    '/employees',
    '/screening',
    '/call-evaluation',
    '/video-evaluation',
    '/notifications',
    '/account',
];

export const APP_BOTTOM_NAV_HIDE_ROUTES = [
    '/login',
    '/signup',
    '/forgot-password',
    '/account/billing/portal',
    '/interview',
    '/video-interview-call',
];

const APP_SERVICE_ROUTE_PREFIXES = [
    '/dashboard',
    '/workflow',
    '/candidates',
    '/ai-head-hunter',
    '/ai-cv-comparison',
    '/interview-templates',
    '/employees',
    '/screening',
    '/call-evaluation',
    '/video-evaluation',
];

export function matchesRoutePrefix(pathname, prefixes) {
    return prefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

export function isAppThemeRoute(pathname) {
    return matchesRoutePrefix(pathname, APP_THEME_ROUTE_PREFIXES);
}

export function shouldShowAppBottomNav(pathname) {
    if (matchesRoutePrefix(pathname, APP_BOTTOM_NAV_HIDE_ROUTES)) {
        return false;
    }
    return isAppThemeRoute(pathname);
}

export function isServicesTabActive(pathname) {
    if (pathname.startsWith('/account')) return false;
    if (pathname.startsWith('/notifications')) return false;
    return matchesRoutePrefix(pathname, APP_SERVICE_ROUTE_PREFIXES);
}

export function isNotificationsTabActive(pathname) {
    return pathname === '/notifications' || pathname.startsWith('/notifications/');
}

export function isSettingsTabActive(pathname) {
    return pathname === '/account/settings' || pathname.startsWith('/account/settings/');
}

export function isAccountTabActive(pathname) {
    if (isSettingsTabActive(pathname)) return false;
    return pathname === '/account' || pathname.startsWith('/account/');
}
