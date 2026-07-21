import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Guard wrapper for pages that require an authenticated session.
 *
 *  <Route
 *      path="/dashboard"
 *      element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
 *  />
 *
 * On first render we check whether the AuthContext finished bootstrapping
 * its initial session read. While loading we render a lightweight splash so
 * the UI doesn't flash the login page for authenticated users on refresh.
 */
const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, loading, user } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div
                style={{
                    minHeight: '60vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    fontSize: 14,
                    letterSpacing: '0.04em',
                }}
            >
                ...
            </div>
        );
    }

    if (!isAuthenticated) {
        const from = `${location.pathname}${location.search || ''}`;
        const suffix = from && from !== '/login' ? `?from=${encodeURIComponent(from)}` : '';
        return <Navigate to={`/login${suffix}`} replace />;
    }

    // أول تسجيل دخول: بروفايل غير مكتمل أو بدون وصف شركة → صفحة Onboarding.
    // مقارنات صارمة (=== false / === '') حتى لا نزعج جلسات قديمة لا تحمل الحقول.
    const needsOnboarding =
        user?.profileComplete === false || user?.companyDescription === '';
    if (needsOnboarding && location.pathname !== '/onboarding') {
        return <Navigate to="/onboarding" replace />;
    }

    return children;
};

export default ProtectedRoute;
