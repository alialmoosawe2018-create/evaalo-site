import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';

/** Preserve query/hash when redirecting legacy /demo URLs to /overview. */
function LegacyDemoRedirect({ to }) {
    const { search, hash } = useLocation();
    return <Navigate to={`${to}${search}${hash}`} replace />;
}
import { ClerkProvider } from '@clerk/clerk-react';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { InterviewTemplateProvider } from './contexts/InterviewTemplateContext';
import { DesignProvider } from './contexts/DesignContext';
import { AuthProvider } from './contexts/AuthContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { BillingProvider } from './contexts/BillingContext';
import VerifyEmail from './pages/VerifyEmail';

/**
 * Clerk wiring.
 *
 * - `useClerk` is true when both a publishable key and the feature flag are present.
 * - When false, the app skips ClerkProvider entirely and `authService` falls back
 *   to its mock implementation. This keeps dev safe even if Clerk Dashboard isn't
 *   reachable.
 */
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const useClerk =
    String(import.meta.env.VITE_USE_CLERK || 'true').toLowerCase() !== 'false' &&
    Boolean(CLERK_PUBLISHABLE_KEY);

if (!useClerk) {
    // eslint-disable-next-line no-console
    console.warn(
        '[App] Clerk disabled — falling back to MOCK auth. Set VITE_USE_CLERK=true and ' +
            'VITE_CLERK_PUBLISHABLE_KEY to enable real authentication.'
    );
}

function MaybeClerkProvider({ children }) {
    if (!useClerk) return children;
    return (
        <ClerkProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            afterSignOutUrl="/login"
            signInUrl="/login"
            signUpUrl="/signup"
            telemetry={{ disabled: true }}
        >
            {children}
        </ClerkProvider>
    );
}
import ProtectedRoute from './components/ProtectedRoute';
import Navigation from './components/Navigation';
import InsufficientCreditsToast from './components/InsufficientCreditsToast';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import SsoCallback from './pages/SsoCallback';
import Home from './pages/Home';
import Design from './pages/Design';
import DesignSharePreview from './pages/DesignSharePreview';
import DesignedInterviewRun from './pages/DesignedInterviewRun';
import Form from './pages/Form';
import Interview from './pages/Interview';
import PublicScreeningCall from './pages/PublicScreeningCall';
import PublicVideoScreeningCall from './pages/PublicVideoScreeningCall';
import Dashboard from './pages/Dashboard';
import Onboarding from './pages/Onboarding';
import Workflow from './pages/Workflow';
import Candidates from './pages/Candidates';
import AIHeadHunter from './pages/AIHeadHunter';
import AICvComparison from './pages/AICvComparison';
import HeadHunterSearchHistory from './pages/HeadHunterSearchHistory.jsx';
import HeadHunterCampaignPage from './pages/HeadHunterCampaignPage.jsx';
import InterviewTemplates from './pages/InterviewTemplates';
import WrittenInterview from './pages/WrittenInterview';
import VoiceInterview from './pages/VoiceInterview';
import Reception from './pages/Reception';
import VideoInterview from './pages/VideoInterview';
import VideoInterviewCall from './pages/VideoInterviewCall';
import ReceptionDemoCall from './pages/ReceptionDemoCall';
import DemoPage from './pages/DemoPage';
import Account from './pages/Account';
import AccountSettings from './pages/AccountSettings';
import AccountUsage from './pages/AccountUsage';
import AccountSpending from './pages/AccountSpending';
import AccountBilling from './pages/AccountBilling';
import AccountStripePortal from './pages/AccountStripePortal';
import AccountBillingSuccess from './pages/AccountBillingSuccess';
import AccountBillingCancel from './pages/AccountBillingCancel';
import AccountMembers from './pages/AccountMembers';
import Employees from './pages/Employees';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import DataSecurityPage from './pages/DataSecurityPage';
import Notifications from './pages/Notifications';
import AppBottomNav from './components/AppBottomNav';
import CandidateInterviewBodyClass from './components/CandidateInterviewBodyClass';

function App() {
    useEffect(() => {
        // Page load animation
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.5s ease';
        
        const timer = setTimeout(() => {
            document.body.style.opacity = '1';
        }, 100);
        
        // Scroll indicator hide on scroll
        const handleScroll = () => {
            const scrollIndicator = document.querySelector('.scroll-indicator');
            if (scrollIndicator) {
                if (window.scrollY > 100) {
                    scrollIndicator.style.opacity = '0';
                    scrollIndicator.style.pointerEvents = 'none';
                } else {
                    scrollIndicator.style.opacity = '1';
                    scrollIndicator.style.pointerEvents = 'auto';
                }
            }
        };
        
        window.addEventListener('scroll', handleScroll);
        
        return () => {
            clearTimeout(timer);
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (
        <LanguageProvider>
            <ThemeProvider>
            <InterviewTemplateProvider>
                <DesignProvider>
                    <Router
                        basename={import.meta.env.BASE_URL}
                        future={{
                            v7_startTransition: true,
                            v7_relativeSplatPath: true,
                        }}
                    >
                        <MaybeClerkProvider>
                        <AuthProvider>
                            <OrganizationProvider>
                            <BillingProvider>
                            <Navigation />
                            <InsufficientCreditsToast />
                            <CandidateInterviewBodyClass />
                            <AppBottomNav />
                            <Routes>
                                {/* Public pages */}
                                <Route path="/" element={<Home />} />
                                <Route path="/design" element={<Design />} />
                                <Route path="/form-preview" element={<DesignSharePreview />} />
                                <Route path="/interview-design" element={<DesignedInterviewRun />} />
                                <Route path="/form" element={<Form />} />
                                <Route path="/interview" element={<Interview />} />
                                <Route path="/screening-call" element={<PublicScreeningCall />} />
                                <Route path="/video-screening-call" element={<PublicVideoScreeningCall />} />
                                <Route path="/screening" element={<WrittenInterview />} />
                                <Route path="/written-interview" element={<Navigate to="/screening" replace />} />
                                <Route path="/call-evaluation" element={<VoiceInterview />} />
                                <Route path="/voice-interview" element={<Navigate to="/call-evaluation" replace />} />
                                <Route path="/reception" element={<Reception />} />
                                <Route path="/video-evaluation" element={<VideoInterview />} />
                                <Route path="/video-interview" element={<Navigate to="/video-evaluation" replace />} />
                                <Route path="/video-interview-call" element={<VideoInterviewCall />} />
                                <Route path="/overview/live" element={<ReceptionDemoCall />} />
                                <Route path="/overview" element={<DemoPage />} />
                                <Route path="/demo/live" element={<Navigate to="/overview/live" replace />} />
                                <Route path="/demo" element={<LegacyDemoRedirect to="/overview" />} />
                                <Route path="/about" element={<AboutPage />} />
                                <Route path="/contact" element={<ContactPage />} />
                                <Route path="/pricing" element={<PricingPage />} />
                                <Route path="/head-hunter" element={<Navigate to="/#process-head-hunter" replace />} />
                                <Route path="/privacy" element={<PrivacyPage />} />
                                <Route path="/terms" element={<TermsPage />} />
                                <Route path="/data-security" element={<DataSecurityPage />} />

                                {/* Auth pages (public) */}
                                <Route path="/login" element={<Login />} />
                                <Route path="/signup" element={<Signup />} />
                                <Route path="/forgot-password" element={<ForgotPassword />} />
                                <Route path="/verify-email" element={<VerifyEmail />} />
                                <Route path="/sso-callback" element={<SsoCallback />} />

                                {/* Protected (require an authenticated session) */}
                                <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
                                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                                <Route path="/workflow" element={<ProtectedRoute><Workflow /></ProtectedRoute>} />
                                <Route path="/candidates" element={<ProtectedRoute><Candidates /></ProtectedRoute>} />
                                <Route path="/ai-head-hunter" element={<ProtectedRoute><AIHeadHunter /></ProtectedRoute>} />
                                <Route path="/ai-cv-comparison" element={<ProtectedRoute><AICvComparison /></ProtectedRoute>} />
                                <Route path="/ai-head-hunter/search-history" element={<ProtectedRoute><HeadHunterSearchHistory /></ProtectedRoute>} />
                                <Route path="/ai-head-hunter/campaign/:id" element={<ProtectedRoute><HeadHunterCampaignPage /></ProtectedRoute>} />
                                <Route path="/interview-templates" element={<ProtectedRoute><InterviewTemplates /></ProtectedRoute>} />
                                <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
                                <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                                <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
                                <Route path="/account/settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
                                <Route path="/account/usage" element={<ProtectedRoute><AccountUsage /></ProtectedRoute>} />
                                <Route path="/account/spending" element={<ProtectedRoute><AccountSpending /></ProtectedRoute>} />
                                <Route path="/account/billing" element={<ProtectedRoute><AccountBilling /></ProtectedRoute>} />
                                <Route path="/account/billing/portal" element={<ProtectedRoute><AccountStripePortal /></ProtectedRoute>} />
                                <Route path="/account/billing/success" element={<ProtectedRoute><AccountBillingSuccess /></ProtectedRoute>} />
                                <Route path="/account/billing/cancel" element={<ProtectedRoute><AccountBillingCancel /></ProtectedRoute>} />
                                <Route path="/account/members" element={<ProtectedRoute><AccountMembers /></ProtectedRoute>} />
                            </Routes>
                            </BillingProvider>
                            </OrganizationProvider>
                        </AuthProvider>
                        </MaybeClerkProvider>
                    </Router>
                </DesignProvider>
            </InterviewTemplateProvider>
            </ThemeProvider>
        </LanguageProvider>
    );
}

export default App;
