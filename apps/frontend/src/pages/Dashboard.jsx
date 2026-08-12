import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import '../design-styles.css';
import NewInterviewSidebar from '../components/NewInterviewSidebar';
import RecentInterviewsCard from '../components/RecentInterviewsCard';
import FreePlanBanner from '../components/FreePlanBanner';
import DeferredScreeningBanner from '../components/DeferredScreeningBanner';
import PhoneCallOutlineIcon from '../components/PhoneCallOutlineIcon.jsx';
import { serviceIconTones } from '../utils/brandColor';

const filledServiceIconSvgProps = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    style: { display: 'block' },
};

/** New Campaign + Settings + Templates: filled multi-tone؛ الباقي خطّي كالسابق */
function DashboardServiceIcon({ type, color }) {
    /** Templates — نفس أيقونة «استمارة / Form» في Hero (مستند بخطوط، outline) */
    if (type === 'template') {
        return (
            <svg
                width={28}
                height={28}
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: 'block' }}
            >
                <rect x="12" y="8" width="40" height="48" rx="2" stroke={color} strokeWidth="3.5" fill="none" strokeLinejoin="round" />
                <line x1="20" y1="20" x2="44" y2="20" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="28" x2="44" y2="28" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="36" x2="36" y2="36" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="44" x2="40" y2="44" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
            </svg>
        );
    }

    if (type === 'plus') {
        const { a, b } = serviceIconTones(color);
        return (
            <svg {...filledServiceIconSvgProps}>
                <rect x="9" y="4" width="6" height="16" rx="2" fill={b} />
                <rect x="4" y="9" width="16" height="6" rx="2" fill={a} />
            </svg>
        );
    }

    if (type === 'settings') {
        const { a, b, c, d } = serviceIconTones(color);
        return (
            <svg {...filledServiceIconSvgProps}>
                <rect x="3" y="5" width="18" height="3" rx="1.5" fill={c} />
                <rect x="3" y="10.5" width="18" height="3" rx="1.5" fill={b} />
                <rect x="3" y="16" width="18" height="3" rx="1.5" fill={d} />
                <circle cx="15" cy="6.5" r="2.25" fill={a} />
                <circle cx="8" cy="12" r="2.25" fill={a} />
                <circle cx="13" cy="17.5" r="2.25" fill={a} />
            </svg>
        );
    }

    const p = {
        width: 26,
        height: 26,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
    };
    const s = { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

    switch (type) {
        /** Chart — مخطط هيكل تنظيمي (org chart) */
        case 'clipboard':
            return (
                <svg {...p}>
                    <rect x="8" y="2" width="8" height="5" rx="1.5" fill="none" {...s} />
                    <path d="M12 7v2.5M6 9.5h12M6 9.5V12M18 9.5V12" {...s} />
                    <rect x="2" y="12" width="8" height="6" rx="1.5" fill="none" {...s} />
                    <rect x="14" y="12" width="8" height="6" rx="1.5" fill="none" {...s} />
                </svg>
            );
        /** Candidates — مجموعة أشخاص */
        case 'users':
            return (
                <svg {...p}>
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" {...s} />
                    <circle cx="9" cy="7" r="4" {...s} />
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" {...s} />
                </svg>
            );
        /** Stage 1 — مستند مكتوب (مقابلة كتابية) */
        case 'pen':
            return (
                <svg {...p}>
                    <path
                        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                        {...s}
                    />
                    <path d="M14 2v6h6" {...s} />
                    <path d="M8 13h8M8 17h6M8 9h4" {...s} />
                </svg>
            );
        /** Stage 2 — مكالمة (سماعة + موجات) */
        case 'mic':
            return <PhoneCallOutlineIcon color={color} size={26} strokeWidth={2} />;
        /** Stage 3 — كاميرا فيديو */
        case 'video':
            return (
                <svg {...p}>
                    <path
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        {...s}
                    />
                </svg>
            );
        /** AI CV Comparison — مستندان للسيرة + ميزان مقارنة */
        case 'cvCompare':
            return (
                <svg {...p}>
                    <rect x="2" y="3" width="8" height="11" rx="1.5" {...s} />
                    <rect x="14" y="5" width="8" height="9" rx="1.5" {...s} />
                    <path d="M5 7h4M5 9.5h5M5 12h3.5" {...s} />
                    <path d="M16.5 7.5h4M16.5 10h3" {...s} />
                    <path d="M9.5 15.5l2.5 1.7 2.5-1.7" {...s} />
                    <circle cx="12" cy="19.5" r="1.6" {...s} />
                </svg>
            );
        /** Account — ملف شخصي */
        case 'user':
            return (
                <svg {...p}>
                    <circle cx="12" cy="8" r="4" {...s} />
                    <path d="M4 20v-1a6 6 0 016-6h4a6 6 0 016 6v1" {...s} />
                </svg>
            );
        /** AI HeadHunter — عدسة بحث عن مواهب */
        case 'headhunter':
            return (
                <svg {...p}>
                    <circle cx="11" cy="11" r="7" {...s} />
                    <path d="M21 21l-4.3-4.3" {...s} />
                </svg>
            );
        default:
            return (
                <svg {...p}>
                    <circle cx="12" cy="12" r="10" {...s} />
                </svg>
            );
    }
}

const DASHBOARD_SERVICE_DEFS = [
    { id: 'newCampaign', iconKey: 'plus' },
    { id: 'headhunter', iconKey: 'headhunter' },
    { id: 'cvComparison', iconKey: 'cvCompare' },
    { id: 'stage1', iconKey: 'pen' },
    { id: 'stage2', iconKey: 'mic' },
    { id: 'stage3', iconKey: 'video' },
    { id: 'templates', iconKey: 'template' },
    { id: 'candidates', iconKey: 'users' },
    { id: 'chart', iconKey: 'clipboard' },
    { id: 'settings', iconKey: 'settings' },
    { id: 'account', iconKey: 'user' },
];

const DASHBOARD_SERVICE_THEMES = {
    newCampaign: { c1: '#3b82f6', c2: '#8b5cf6' },
    headhunter: { c1: '#22d3ee', c2: '#a855f7' },
    chart: { c1: '#06b6d4', c2: '#3b82f6' },
    candidates: { c1: '#8b5cf6', c2: '#ec4899' },
    stage1: { c1: '#22c55e', c2: '#10b981' },
    stage2: { c1: '#f59e0b', c2: '#f97316' },
    stage3: { c1: '#ec4899', c2: '#f43f5e' },
    cvComparison: { c1: '#6366f1', c2: '#a855f7' },
    settings: { c1: '#14b8a6', c2: '#0ea5e9' },
    account: { c1: '#0ea5e9', c2: '#6366f1' },
    templates: { c1: '#a855f7', c2: '#3b82f6' },
};

const Dashboard = () => {
    const { t, currentLang } = useLanguage();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        if (searchParams.get('open') !== 'newCampaign') return;
        setIsSidebarOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        if (searchParams.get('open') !== 'cvComparison') return;
        const card = document.getElementById('dashboard-service-cvComparison');
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
        if (!card) return;
        requestAnimationFrame(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('ds-service-card--spotlight');
            card.focus({ preventScroll: true });
            window.setTimeout(() => card.classList.remove('ds-service-card--spotlight'), 2400);
        });
    }, [searchParams, setSearchParams]);

    const services = useMemo(
        () =>
            DASHBOARD_SERVICE_DEFS.map((s) => ({
                ...s,
                title: t(`dashboardSvc_${s.id}`),
                description: t(`dashboardSvcDesc_${s.id}`),
            })),
        [t, currentLang]
    );

    // Handle sidebar option selection
    const handleSidebarOption = (optionId) => {
        switch (optionId) {
            case 'start-process':
                break;
            case 'video-interview':
                break;
            case 'audio-interview':
                break;
            case 'application-form':
                break;
            default:
                break;
        }
    };

    return (
        <>
        <div
            className="dashboard-page dashboard-page--evaalo-visual dashboard-home-page"
            style={{
            minHeight: '100vh', 
                padding: '70px 20px 40px',
                position: 'relative',
            }}
        >
                {/* Background — نفس عائلة ألوان قسم Features (أوراق دافئة + بنفسجي/سماوي) */}
                <div className="design-background design-background--evaalo-visual">
                    <div className="design-orb-1"></div>
                    <div className="design-orb-2"></div>
                    <div className="design-orb-3"></div>
                </div>
                {/* نسيج بصري مثل #features: نقاط + شبكة خفيفة */}
                <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
                <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

                <div className="container dashboard-visual-container" style={{
                    maxWidth: '1400px',
                    margin: '0 auto',
                    position: 'relative',
                    zIndex: 1,
                    minHeight: 'calc(100vh - 250px)'
                }}>
                    <FreePlanBanner />
                    <DeferredScreeningBanner />
                    {/* Main Content Grid */}
                    <div className="dashboard-grid" style={{ 
                        marginBottom: '40px'
                    }}>
                        {/* Our Services */}
                        <div className="dashboard-card dashboard-card--page-active platform-features-card">
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">{t('dashboardOurServices')}</h2>
                            </div>
                            <div className="dashboard-card-body">
                                {/* Platform service cards (grid) */}
                                <div className="platform-features-grid">
                                    {services.map((service) => {
                                        const theme =
                                            DASHBOARD_SERVICE_THEMES[service.id] || {
                                                c1: '#3b82f6',
                                                c2: '#06b6d4',
                                            };

                                        const handleClick = () => {
                                            switch (service.id) {
                                                case 'newCampaign':
                                                    setIsSidebarOpen(true);
                                                    break;
                                                case 'headhunter':
                                                    navigate('/ai-head-hunter');
                                                    break;
                                                case 'chart':
                                                    navigate('/employees');
                                                    break;
                                                case 'settings':
                                                    navigate('/account/settings');
                                                    break;
                                                case 'stage1':
                                                    navigate('/screening');
                                                    break;
                                                case 'stage2':
                                                    navigate('/call-evaluation');
                                                    break;
                                                case 'stage3':
                                                    navigate('/video-evaluation');
                                                    break;
                                                case 'account':
                                                    navigate('/account');
                                                    break;
                                                case 'candidates':
                                                    navigate('/candidates');
                                                    break;
                                                case 'cvComparison':
                                                    navigate('/ai-cv-comparison');
                                                    break;
                                                case 'templates':
                                                    navigate('/interview-templates');
                                                    break;
                                                default:
                                                    break;
                                            }
                                        };

                                        const isAccountCard = service.id === 'account';
                                        const isSettingsCard = service.id === 'settings';
                                        
                                        return (
                                            <button
                                                key={service.id}
                                                id={service.id === 'cvComparison' ? 'dashboard-service-cvComparison' : undefined}
                                                type="button"
                                            onClick={handleClick}
                                                className={`ds-service-card${
                                                    isAccountCard ? ' ds-service-card--dashboard-account' : ''
                                                }${isSettingsCard ? ' ds-service-card--dashboard-settings' : ''}`}
                                                aria-label={service.title}
                                                title={service.title}
                                                    style={{
                                                    '--ds-c1': theme.c1,
                                                    '--ds-c2': theme.c2,
                                                }}
                                            >
                                                <span className="ds-service-card__glow" aria-hidden />
                                                <span className="ds-service-card__shine" aria-hidden />
                                                <span className="ds-service-card__content">
                                                    <span className="ds-service-card__icon-wrap">
                                                        <DashboardServiceIcon type={service.iconKey} color="#ffffff" />
                                                    </span>
                                                    <span className="ds-service-card__title">
                                                    {service.title}
                                                    </span>
                                                {service.description && (
                                                        <span className="ds-service-card__desc">
                                                        {service.description}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="ds-service-card__arrow" dir="ltr" aria-hidden>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                                        <path
                                                            d="M5 12h14M13 5l7 7-7 7"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                    </svg>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <RecentInterviewsCard variant="dashboard" />
                    </div>
                </div>
            </div>

            {/* New Campaign Sidebar */}
            <NewInterviewSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onSelectOption={handleSidebarOption}
            />
        </>
    );
};

export default Dashboard;