import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import ThemeToggle from './ThemeToggle';
import { isAppThemeRoute } from '../utils/appRoutes';
import { isCandidateInterviewRoute } from '../utils/interviewShareLink.js';

/** صفحة Design غير جاهزة للعامة؛ الإخفاء من الشريط فقط — المسار /design يبقى يعمل مباشرة */
const SHOW_DESIGN_IN_NAV = false;

/** شريحة رصيد الكردت؛ الإخفاء من الشريط فقط — الرصيد يبقى ظاهراً في بانر الباقة وصفحة الحساب */
const SHOW_CREDITS_IN_NAV = false;

const DropdownArrow = () => (
    <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ProductDropdownPanel = ({ sections, dropdownClassName, onNavigate, isPathActive, panelProps = {} }) => (
    <div className={dropdownClassName} {...panelProps}>
        <div className="nav-product-dropdown-columns">
            {sections.map((section, sectionIndex) => (
                <React.Fragment key={section.key}>
                    {sectionIndex > 0 ? <div className="nav-product-dropdown-divider" aria-hidden /> : null}
                    <div className="nav-product-dropdown-column">
                        <div className="nav-product-dropdown-heading">{section.title}</div>
                        {section.items.map((item) => (
                            <Link
                                key={item.to}
                                to={item.to}
                                className={`nav-language-option nav-product-option ${isPathActive(item.to) ? 'active' : ''}`}
                                onClick={onNavigate}
                            >
                                <span className="language-name">{item.label}</span>
                            </Link>
                        ))}
                    </div>
                </React.Fragment>
            ))}
        </div>
    </div>
);

const wrapEvaaloInLabel = (text) => {
    if (!text || !/evaalo/i.test(text)) return text;
    const parts = text.split(/(evaalo)/gi);
    return parts.map((part, index) =>
        /^evaalo$/i.test(part) ? (
            <span key={`evaalo-${index}`} className="evaalo-text-en">
                {part}
            </span>
        ) : (
            <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
        )
    );
};

const Navigation = () => {
    const { currentLang, changeLanguage, t } = useLanguage();

    const location = useLocation();
    const showThemeToggle = isAppThemeRoute(location.pathname);
    // ويدجت الرصيد: يظهر على صفحات التطبيق فقط وعندما تكون الفوترة مهيأة ومحمّلة.
    const { creditsRemaining, configured: billingConfigured, isLoaded: billingLoaded } = useBilling();
    const showCreditsChip = SHOW_CREDITS_IN_NAV && showThemeToggle && billingConfigured && billingLoaded;
    const hideNavOnRoutes = ['/account/billing/portal', '/login', '/signup', '/forgot-password', '/form', '/onboarding'];
    const hideNav = hideNavOnRoutes.includes(location.pathname) || isCandidateInterviewRoute(location.pathname);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [desktopLangDropdownOpen, setDesktopLangDropdownOpen] = useState(false);
    const [desktopProductDropdownOpen, setDesktopProductDropdownOpen] = useState(false);
    const [mobileProductExpanded, setMobileProductExpanded] = useState(false);
    const [mobileLangExpanded, setMobileLangExpanded] = useState(false);
    const desktopLangRef = useRef(null);
    const desktopProductRef = useRef(null);
    const desktopLangTimeoutRef = useRef(null);
    const desktopProductTimeoutRef = useRef(null);
    
    const isActive = (path) => location.pathname === path;

    const isProductPathActive = (path) => {
        if (path.includes('#')) {
            const [pathname, hash] = path.split('#');
            return location.pathname === pathname && location.hash === `#${hash}`;
        }
        if (path === '/') return location.pathname === '/';
        if (path.startsWith('/reception')) {
            return location.pathname === '/reception' || location.pathname.startsWith('/reception/');
        }
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
    };

    const isProductNavActive =
        isProductPathActive('/overview') ||
        isProductPathActive('/demo') ||
        isProductPathActive('/reception') ||
        isProductPathActive('/overview/live') ||
        isProductPathActive('/demo/live') ||
        isProductPathActive('/#process-cv-comparison') ||
        isProductPathActive('/#process-stage-2') ||
        isProductPathActive('/#process-stage-3') ||
        isProductPathActive('/#process-head-hunter');

    const voiceReceptionPath = useMemo(() => {
        const sessionLang =
            currentLang === 'en' ? 'en' : currentLang === 'ku' ? 'ku' : 'ar';
        return `/reception?language=${sessionLang}`;
    }, [currentLang]);

    const productSections = useMemo(
        () => [
            {
                key: 'evaalo',
                title: t('navProductEvaalo'),
                items: [
                    { label: t('navProductAiScreening'), to: '/#process-cv-comparison' },
                    { label: t('navProductAiVoiceInterview'), to: '/#process-stage-2' },
                    { label: t('navProductAiVideoInterview'), to: '/#process-stage-3' },
                    { label: t('navProductAiHeadHunter'), to: '/#process-head-hunter' },
                ],
            },
            {
                key: 'ai-agent',
                title: t('navProductAiAgent'),
                items: [
                    { label: t('navProductDemo'), to: '/overview' },
                    { label: t('navProductChat'), to: '/overview?openChat=1' },
                    { label: t('navProductVoice'), to: voiceReceptionPath },
                    { label: t('navProductVideo'), to: '/overview/live' },
                ],
            },
        ],
        [t, voiceReceptionPath]
    );

    const languages = [
        { code: 'en', name: 'English' },
        { code: 'ar', name: 'العربية', codeText: '' },
        { code: 'ku', name: 'کوردی', codeText: '(KU)' },
    ];

    useEffect(() => {
        setMobileMenuOpen(false);
        setMobileProductExpanded(false);
        setMobileLangExpanded(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!mobileMenuOpen) {
            document.body.classList.remove('sidebar-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('touch-action');
            return undefined;
        }

        const scrollY = window.scrollY;
        document.body.classList.add('sidebar-open');
        document.body.dataset.mobileNavScrollY = String(scrollY);

        return () => {
            document.body.classList.remove('sidebar-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('touch-action');
            const savedScrollY = Number(document.body.dataset.mobileNavScrollY || '0');
            delete document.body.dataset.mobileNavScrollY;
            window.scrollTo(0, savedScrollY);
        };
    }, [mobileMenuOpen]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (desktopLangRef.current && !desktopLangRef.current.contains(event.target)) {
                if (desktopLangTimeoutRef.current) {
                    clearTimeout(desktopLangTimeoutRef.current);
                    desktopLangTimeoutRef.current = null;
                }
                setDesktopLangDropdownOpen(false);
            }
            if (desktopProductRef.current && !desktopProductRef.current.contains(event.target)) {
                if (desktopProductTimeoutRef.current) {
                    clearTimeout(desktopProductTimeoutRef.current);
                    desktopProductTimeoutRef.current = null;
                }
                setDesktopProductDropdownOpen(false);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('click', handleClickOutside);
            if (desktopLangTimeoutRef.current) {
                clearTimeout(desktopLangTimeoutRef.current);
            }
            if (desktopProductTimeoutRef.current) {
                clearTimeout(desktopProductTimeoutRef.current);
            }
        };
    }, []);

    const handleLanguageChange = (lang) => {
        changeLanguage(lang);
        setDesktopLangDropdownOpen(false);
        setMobileLangExpanded(false);
        setMobileMenuOpen(false);
    };

    const closeMobileMenu = () => {
        setMobileMenuOpen(false);
        setMobileProductExpanded(false);
        setMobileLangExpanded(false);
    };

    const closeProductMenus = () => {
        setDesktopProductDropdownOpen(false);
        setMobileProductExpanded(false);
        setMobileMenuOpen(false);
    };

    const openDesktopProduct = () => {
        if (desktopProductTimeoutRef.current) {
            clearTimeout(desktopProductTimeoutRef.current);
            desktopProductTimeoutRef.current = null;
        }
        setDesktopProductDropdownOpen(true);
    };

    const scheduleCloseDesktopProduct = () => {
        desktopProductTimeoutRef.current = setTimeout(() => {
            setDesktopProductDropdownOpen(false);
        }, 500);
    };

    if (hideNav) {
        return null;
    }

    const mobileMenuPanel = (
        <div
            className={`nav-links nav-links-mobile${mobileMenuOpen ? ' nav-links-mobile--open' : ''}`}
            id="navMenu"
            aria-hidden={!mobileMenuOpen}
        >
            <Link to="/" className="nav-link" onClick={closeMobileMenu}>
                {t('home')}
            </Link>

            <div
                className={`nav-link nav-link-dropdown nav-product-trigger ${mobileProductExpanded ? 'expanded' : ''} ${isProductNavActive ? 'active' : ''}`}
                onClick={() => setMobileProductExpanded(!mobileProductExpanded)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setMobileProductExpanded(!mobileProductExpanded);
                    }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={mobileProductExpanded}
            >
                <span>{t('navProduct')}</span>
                <DropdownArrow />
                <ProductDropdownPanel
                    sections={productSections}
                    dropdownClassName="nav-language-dropdown nav-product-dropdown-menu"
                    onNavigate={closeProductMenus}
                    isPathActive={isProductPathActive}
                />
            </div>

            <Link
                to="/pricing"
                className={`nav-link ${isActive('/pricing') ? 'active' : ''}`}
                onClick={closeMobileMenu}
            >
                {t('navPricing')}
            </Link>

            <Link to="/#features" className="nav-link" onClick={closeMobileMenu}>
                {t('features')}
            </Link>
            <Link to="/#features-2" className="nav-link" onClick={closeMobileMenu}>
                <span className="nav-link-label">{t('navWhyUsMobile')}</span>
            </Link>
            <Link to="/#process" className="nav-link" onClick={closeMobileMenu}>
                <span className="nav-link-label">{t('navHowWorkMobile')}</span>
            </Link>

            {SHOW_DESIGN_IN_NAV && (
                <Link
                    to="/design"
                    className={`nav-link ${isActive('/design') ? 'active' : ''}`}
                    onClick={closeMobileMenu}
                >
                    {t('design')}
                </Link>
            )}

            <div
                className={`nav-link nav-link-dropdown ${mobileLangExpanded ? 'expanded' : ''}`}
                onClick={() => setMobileLangExpanded(!mobileLangExpanded)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setMobileLangExpanded(!mobileLangExpanded);
                    }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={mobileLangExpanded}
            >
                <span>{t('language')}</span>
                <DropdownArrow />
                <div className="nav-language-dropdown">
                    {languages.map((lang) => (
                        <button
                            key={lang.code}
                            type="button"
                            className={`nav-language-option ${currentLang === lang.code ? 'active' : ''}`}
                            role="menuitem"
                            data-lang={lang.code}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleLanguageChange(lang.code);
                            }}
                        >
                            <span className="language-name">{lang.name}</span>
                            {lang.codeText ? (
                                <span className="language-code">{lang.codeText}</span>
                            ) : null}
                        </button>
                    ))}
                </div>
            </div>

            <div className="nav-mobile-menu-footer">
                <Link
                    to="/dashboard"
                    className={`nav-dashboard-link nav-dashboard-link--mobile-menu ${isActive('/dashboard') ? 'active' : ''}`}
                    onClick={closeMobileMenu}
                >
                    {t('dashboard')}
                </Link>
            </div>
        </div>
    );

    const mobileMenuPortal =
        typeof document !== 'undefined'
            ? createPortal(
                  <>
                      <div
                          className="nav-menu-backdrop"
                          onClick={() => setMobileMenuOpen(false)}
                          aria-hidden={!mobileMenuOpen}
                      />
                      {mobileMenuPanel}
                  </>,
                  document.body
              )
            : null;

    return (
        <>
            {mobileMenuPortal}
            <nav className="main-nav">
                <div className="nav-container">
                    <Link to="/" className="nav-logo-img" onClick={() => setMobileMenuOpen(false)}>
                        <img src="/images/last logo.png" alt="evaalo Logo" className="logo-image" />
                        <span className="logo-text">vaalo.Ai</span>
                    </Link>
                    
                    <div className="nav-links nav-links-desktop" id="navMenuDesktop">
                        <Link to="/" className="nav-link" onClick={() => window.scrollTo(0, 0)}>
                            {t('home')}
                        </Link>

                        <div
                            className={`nav-link nav-link-dropdown nav-product-trigger ${isProductNavActive ? 'active' : ''}`}
                            id="navProductItemDesktop"
                            ref={desktopProductRef}
                            onMouseEnter={openDesktopProduct}
                            onMouseLeave={scheduleCloseDesktopProduct}
                        >
                            <span>{t('navProduct')}</span>
                            <DropdownArrow />
                            <ProductDropdownPanel
                                sections={productSections}
                                dropdownClassName={`nav-language-dropdown nav-product-dropdown-menu ${desktopProductDropdownOpen ? 'active' : ''}`}
                                onNavigate={closeProductMenus}
                                isPathActive={isProductPathActive}
                                panelProps={{
                                    onMouseEnter: openDesktopProduct,
                                    onMouseLeave: () => setDesktopProductDropdownOpen(false),
                                }}
                            />
                        </div>

                        <Link
                            to="/pricing"
                            className={`nav-link ${isActive('/pricing') ? 'active' : ''}`}
                            onClick={() => window.scrollTo(0, 0)}
                        >
                            {t('navPricing')}
                        </Link>

                        {(location.pathname === '/' || location.pathname === '/overview' || location.pathname === '/demo') && (
                            <a href="#features" className="nav-link">
                                {t('features')}
                            </a>
                        )}
                        {location.pathname === '/' && (
                            <>
                                <a href="#features-2" className="nav-link">
                                    <span className="nav-link-label">{wrapEvaaloInLabel(t('evaaloVisualLanguage'))}</span>
                                </a>
                                <a href="#process" className="nav-link">
                                    <span className="nav-link-label">{wrapEvaaloInLabel(t('applicationProcess'))}</span>
                                </a>
                            </>
                        )}
                        {SHOW_DESIGN_IN_NAV && (
                            <Link to="/design" className={`nav-link ${isActive('/design') ? 'active' : ''}`}>
                                {t('design')}
                            </Link>
                        )}
                        
                        <div 
                            className="nav-link nav-link-dropdown" 
                            id="navLanguageItemDesktop"
                            ref={desktopLangRef}
                            onMouseEnter={() => {
                                if (desktopLangTimeoutRef.current) {
                                    clearTimeout(desktopLangTimeoutRef.current);
                                    desktopLangTimeoutRef.current = null;
                                }
                                setDesktopLangDropdownOpen(true);
                            }}
                            onMouseLeave={() => {
                                desktopLangTimeoutRef.current = setTimeout(() => {
                                    setDesktopLangDropdownOpen(false);
                                }, 500);
                            }}
                        >
                            <span>{t('language')}</span>
                            <DropdownArrow />
                            <div 
                                className={`nav-language-dropdown ${desktopLangDropdownOpen ? 'active' : ''}`}
                                id="navLanguageDropdownDesktop"
                                onMouseEnter={() => {
                                    if (desktopLangTimeoutRef.current) {
                                        clearTimeout(desktopLangTimeoutRef.current);
                                        desktopLangTimeoutRef.current = null;
                                    }
                                    setDesktopLangDropdownOpen(true);
                                }}
                                onMouseLeave={() => setDesktopLangDropdownOpen(false)}
                            >
                                {languages.map((lang) => (
                                    <button
                                        key={lang.code}
                                        type="button"
                                        className={`nav-language-option ${currentLang === lang.code ? 'active' : ''}`}
                                        role="menuitem"
                                        data-lang={lang.code}
                                        onClick={() => handleLanguageChange(lang.code)}
                                    >
                                        <span className="language-name">{lang.name}</span>
                                        {lang.codeText ? <span className="language-code">{lang.codeText}</span> : null}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div className="nav-actions">
                        {showCreditsChip ? (
                            <Link
                                to="/account/spending"
                                className="nav-credits-chip"
                                title={t('billing_credits_label')}
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path d="M13 2L4.09 12.11a1 1 0 0 0 .76 1.64H11l-1 8 8.91-10.11a1 1 0 0 0-.76-1.64H13l1-8z" fill="currentColor" />
                                </svg>
                                <span className="nav-credits-chip__value">
                                    {Number(creditsRemaining ?? 0).toLocaleString()}
                                </span>
                            </Link>
                        ) : null}
                        {showThemeToggle ? <ThemeToggle /> : null}
                    <Link
                        to="/dashboard"
                        className={`nav-dashboard-link ${isActive('/dashboard') ? 'active' : ''}`}
                            onClick={() => setMobileMenuOpen(false)}
                    >
                        {t('dashboard')}
                    </Link>
                    </div>
                    
                    <div className={`nav-menu-wrapper${mobileMenuOpen ? ' active' : ''}`}>
                        <button 
                            type="button"
                            className="nav-menu-toggle" 
                            id="navMenuToggle"
                            aria-label="Navigation Menu"
                            aria-expanded={mobileMenuOpen}
                            aria-controls="navMenu"
                            onClick={() => setMobileMenuOpen((open) => !open)}
                        >
                            <span className="hamburger-icon">
                                <span className="hamburger-line" />
                                <span className="hamburger-line" />
                                <span className="hamburger-line" />
                            </span>
                        </button>
                    </div>
                </div>
            </nav>
        </>
    );
};

export default Navigation;
