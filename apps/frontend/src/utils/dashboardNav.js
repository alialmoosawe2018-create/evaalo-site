/** Route state flag — triggers mobile slide-in panel when navigating from dashboard services grid */
export const MOBILE_SLIDE_FROM_DASHBOARD = 'mobileSlideFromDashboard';

export function navigateDashboardService(navigate, path, isMobile) {
    if (isMobile) {
        navigate(path, { state: { [MOBILE_SLIDE_FROM_DASHBOARD]: true } });
        return;
    }
    navigate(path);
}
