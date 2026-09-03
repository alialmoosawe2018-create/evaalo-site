import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../services/apiClient';
import { getMyProfile } from '../services/profileService';
import { isNotificationsTabActive } from '../utils/appRoutes';
import { withoutPendingAnalysis } from '../utils/screeningCampaigns';
import {
    countUnreadNotifications,
    getNotificationsLastViewedAt,
    markNotificationsViewedAt,
} from '../utils/notificationActivity';

export function useUnreadNotifications() {
    const { pathname } = useLocation();
    // AppBottomNav calls this hook above its own visibility check, and the nav is
    // mounted for every route — so without this guard a signed-out visitor on any
    // public page hit two authed endpoints on mount, on focus and every 45s, each
    // cycle costing a 401, a token refresh and another 401.
    const { isAuthenticated } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const analysisTimerRef = useRef(null);
    const refreshRef = useRef(null);

    const refresh = useCallback(async () => {
        if (!isAuthenticated) {
            setUnreadCount(0);
            return;
        }
        if (isNotificationsTabActive(pathname)) {
            setUnreadCount(0);
            return;
        }

        try {
            const [profileResult, candidatesResult] = await Promise.all([
                getMyProfile().catch(() => null),
                apiClient.get('/api/candidates').catch(() => null),
            ]);

            const clearedAtIso = profileResult?.preferences?.dashboardRecentInterviewsClearedAt ?? null;
            const lastViewedIso = getNotificationsLastViewedAt();
            const candidates =
                candidatesResult?.success && Array.isArray(candidatesResult.data)
                    ? candidatesResult.data
                    : [];

            // لا يُحتسب إشعار لمرشح ما زال تحليله قيد الانتظار — نفس مهلة لوحة المرحلة الأولى.
            const { visible, nextReleaseAt } = withoutPendingAnalysis(candidates);
            setUnreadCount(countUnreadNotifications(visible, clearedAtIso, lastViewedIso));

            if (analysisTimerRef.current != null) {
                window.clearTimeout(analysisTimerRef.current);
                analysisTimerRef.current = null;
            }
            if (nextReleaseAt != null) {
                analysisTimerRef.current = window.setTimeout(
                    () => refreshRef.current?.(),
                    Math.max(0, nextReleaseAt - Date.now()) + 1000
                );
            }
        } catch {
            setUnreadCount(0);
        }
    }, [pathname, isAuthenticated]);

    refreshRef.current = refresh;

    useEffect(
        () => () => {
            if (analysisTimerRef.current != null) {
                window.clearTimeout(analysisTimerRef.current);
                analysisTimerRef.current = null;
            }
        },
        []
    );

    useEffect(() => {
        if (!isNotificationsTabActive(pathname)) return;
        markNotificationsViewedAt();
        setUnreadCount(0);
    }, [pathname]);

    useEffect(() => {
        if (!isAuthenticated) return undefined;
        refresh();

        const onFocus = () => refresh();
        const onViewed = () => setUnreadCount(0);
        const onCleared = () => refresh();

        window.addEventListener('focus', onFocus);
        window.addEventListener('evaalo:notifications-viewed', onViewed);
        window.addEventListener('evaalo:notifications-cleared', onCleared);
        window.addEventListener('evaalo:notification-dismissed', onCleared);

        const intervalId = window.setInterval(refresh, 45000);

        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('evaalo:notifications-viewed', onViewed);
            window.removeEventListener('evaalo:notifications-cleared', onCleared);
            window.removeEventListener('evaalo:notification-dismissed', onCleared);
            window.clearInterval(intervalId);
        };
    }, [refresh, isAuthenticated]);

    return unreadCount;
}
