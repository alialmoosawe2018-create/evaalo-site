import React, { useEffect } from 'react';
import { Routes, useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { MOBILE_SLIDE_FROM_DASHBOARD } from '../utils/dashboardNav';

/**
 * On mobile, routes opened from the dashboard services grid slide in from the side
 * (drawer-style) instead of appearing abruptly.
 */
export default function MobileSlideRoutes({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const slidePanel = isMobile && Boolean(location.state?.[MOBILE_SLIDE_FROM_DASHBOARD]);

    useEffect(() => {
        document.body.classList.toggle('mobile-slide-route-open', slidePanel);
        return () => document.body.classList.remove('mobile-slide-route-open');
    }, [slidePanel]);

    const routes = <Routes location={location}>{children}</Routes>;

    if (!slidePanel) {
        return routes;
    }

    const closeToDashboard = () => {
        navigate('/dashboard', { replace: false });
    };

    return (
        <div className="mobile-slide-route-root" role="presentation">
            <button
                type="button"
                className="mobile-slide-route-backdrop"
                aria-label="Back to services"
                onClick={closeToDashboard}
            />
            <div className="mobile-slide-route-panel">{routes}</div>
        </div>
    );
}
