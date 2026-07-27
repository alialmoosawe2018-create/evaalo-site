import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../services/apiClient';
import { getMyProfile } from '../services/profileService';
import { isNotificationsTabActive } from '../utils/appRoutes';
import {
    countUnreadNotifications,
    getNotificationsLastViewedAt,
    markNotificationsViewedAt,
} from '../utils/notificationActivity';

export function useUnreadNotifications() {
    const { pathname } = useLocation();
    const [unreadCount, setUnreadCount] = useState(0);

    const refresh = useCallback(async () => {
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

            setUnreadCount(
                countUnreadNotifications(candidates, clearedAtIso, lastViewedIso)
            );
        } catch {
            setUnreadCount(0);
        }
    }, [pathname]);

    useEffect(() => {
        if (!isNotificationsTabActive(pathname)) return;
        markNotificationsViewedAt();
        setUnreadCount(0);
    }, [pathname]);

    useEffect(() => {
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
    }, [refresh]);

    return unreadCount;
}
