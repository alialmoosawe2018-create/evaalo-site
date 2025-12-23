import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

const Navigation = () => {
    const { currentLang, changeLanguage } = useLanguage();
    const location = useLocation();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [desktopLangDropdownOpen, setDesktopLangDropdownOpen] = useState(false);
    const [langDropdownOpen, setLangDropdownOpen] = useState(false);
    const desktopLangRef = useRef(null);
    const langDropdownRef = useRef(null);
    
    const isActive = (path) => location.pathname === path;

    const languages = [
        { code: 'en', name: 'English' },
        { code: 'ar', name: 'العربية', codeText: '' },
        { code: 'ku', name: 'کوردی', codeText: '(KU)' }
    ];

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (desktopLangRef.current && !desktopLangRef.current.contains(event.target)) {
                setDesktopLangDropdownOpen(false);
            }
            if (langDropdownRef.current && !langDropdownRef.current.contains(event.target)) {
                setLangDropdownOpen(false);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    useEffect(() => {
        // #region agent log
        const logoEl = document.querySelector('.nav-logo-img');
        const dashboardEl = document.querySelector('.nav-dashboard-link');
        const navLinkEl = document.querySelector('.nav-links-desktop .nav-link');
        const containerEl = document.querySelector('.nav-container');
        if (logoEl && dashboardEl && navLinkEl && containerEl) {
            const logoRect = logoEl.getBoundingClientRect();
            const dashboardRect = dashboardEl.getBoundingClientRect();
            const navLinkRect = navLinkEl.getBoundingClientRect();
            const containerRect = containerEl.getBoundingClientRect();
            const dashboardStyle = window.getComputedStyle(dashboardEl);
            const navLinkStyle = window.getComputedStyle(navLinkEl);
            fetch('http://127.0.0.1:7243/ingest/c523ff2f-71ad-4967-831d-33b661a300a0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Navigation.jsx:46',message:'Visual identity comparison',data:{logoLeft:logoRect.left,dashboardRight:containerRect.width-dashboardRect.right,containerWidth:containerRect.width,dashboardPadding:dashboardStyle.padding,navLinkPadding:navLinkStyle.padding,dashboardFontSize:dashboardStyle.fontSize,navLinkFontSize:navLinkStyle.fontSize,dashboardColor:dashboardStyle.color,navLinkColor:navLinkStyle.color,dashboardBg:dashboardStyle.backgroundColor,navLinkBg:navLinkStyle.backgroundColor,dashboardBorderRadius:dashboardStyle.borderRadius,navLinkBorderRadius:navLinkStyle.borderRadius},timestamp:Date.now(),sessionId:'debug-session',runId:'visual-identity',hypothesisId:'A'})}).catch(()=>{});
        } else {
            fetch('http://127.0.0.1:7243/ingest/c523ff2f-71ad-4967-831d-33b661a300a0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Navigation.jsx:57',message:'Elements missing',data:{logoExists:!!logoEl,dashboardExists:!!dashboardEl,navLinkExists:!!navLinkEl,containerExists:!!containerEl},timestamp:Date.now(),sessionId:'debug-session',runId:'visual-identity',hypothesisId:'B'})}).catch(()=>{});
        }
        // #endregion
    }, [location.pathname]);

    const handleLanguageChange = (lang) => {
        changeLanguage(lang);
        setDesktopLangDropdownOpen(false);
        setLangDropdownOpen(false);
    };

    return (
        <>
            <nav className="main-nav">
                <div className="nav-container">
                    <Link to="/" className="nav-logo-img" onClick={() => setMobileMenuOpen(false)}>
                        <img src="/images/last logo.png" alt="evaalo Logo" className="logo-image" />
                        <span className="logo-text">vaalo.Ai</span>
                    </Link>
                    
                    <div className="nav-links nav-links-desktop" id="navMenuDesktop">
                        {/* #region agent log */}
                        {(() => {
                            fetch('http://127.0.0.1:7243/ingest/c523ff2f-71ad-4967-831d-33b661a300a0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Navigation.jsx:58',message:'Rendering nav-links-desktop',data:{pathname:location.pathname},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'C'})}).catch(()=>{});
                            return null;
                        })()}
                        {/* #endregion */}
                        <Link to="/" className="nav-link" onClick={() => window.scrollTo(0, 0)}>Home</Link>
                        {location.pathname === '/' && (
                            <>
                                <a href="#features" className="nav-link">Features</a>
                                <a href="#features-2" className="nav-link">evaalo Visual Language</a>
                                <a href="#process" className="nav-link">How evaalo Works</a>
                            </>
                        )}
                        <Link to="/design" className={`nav-link ${isActive('/design') ? 'active' : ''}`}>Design</Link>
                        
                        <div 
                            className="nav-link nav-link-dropdown" 
                            id="navLanguageItemDesktop"
                            ref={desktopLangRef}
                            onMouseEnter={() => setDesktopLangDropdownOpen(true)}
                            onMouseLeave={() => setDesktopLangDropdownOpen(false)}
                        >
                            <span>Language</span>
                            <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <div 
                                className={`nav-language-dropdown ${desktopLangDropdownOpen ? 'active' : ''}`}
                                id="navLanguageDropdownDesktop"
                            >
                                {languages.map(lang => (
                                    <button
                                        key={lang.code}
                                        className={`nav-language-option ${currentLang === lang.code ? 'active' : ''}`}
                                        role="menuitem"
                                        data-lang={lang.code}
                                        onClick={() => handleLanguageChange(lang.code)}
                                    >
                                        <span className="language-name">{lang.name}</span>
                                        {lang.codeText && <span className="language-code">{lang.codeText}</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <Link 
                        to="/dashboard" 
                        className={`nav-dashboard-link ${isActive('/dashboard') ? 'active' : ''}`}
                        onClick={() => {
                            // #region agent log
                            fetch('http://127.0.0.1:7243/ingest/c523ff2f-71ad-4967-831d-33b661a300a0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Navigation.jsx:95',message:'Dashboard link clicked',data:{pathname:location.pathname,isActive:isActive('/dashboard')},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'D'})}).catch(()=>{});
                            // #endregion
                            setMobileMenuOpen(false);
                        }}
                    >
                        Dashboard
                    </Link>
                    
                    <div className="nav-menu-wrapper">
                        <button 
                            className="nav-menu-toggle" 
                            id="navMenuToggle"
                            aria-label="Navigation Menu"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        >
                            <span className="hamburger-icon">
                                <span className="hamburger-line"></span>
                                <span className="hamburger-line"></span>
                                <span className="hamburger-line"></span>
                            </span>
                        </button>
                        <div className={`nav-links nav-links-mobile ${mobileMenuOpen ? 'active' : ''}`} id="navMenu">
                            <Link to="/" className="nav-link" onClick={() => setMobileMenuOpen(false)}>Home</Link>
                            {location.pathname === '/' && (
                                <>
                                    <a href="#features" className="nav-link" onClick={() => setMobileMenuOpen(false)}>Features</a>
                                    <a href="#features-2" className="nav-link" onClick={() => setMobileMenuOpen(false)}>evaalo Visual Language</a>
                                    <a href="#process" className="nav-link" onClick={() => setMobileMenuOpen(false)}>How evaalo Works</a>
                                </>
                            )}
                            <Link to="/design" className={`nav-link ${isActive('/design') ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>Design</Link>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="language-selector-wrapper">
                <button 
                    className="language-icon-button" 
                    id="languageDropdownBtn"
                    aria-haspopup="true"
                    aria-expanded={langDropdownOpen}
                    onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                    ref={langDropdownRef}
                >
                    <div className="language-feature-icon">
                        <img src="/images/icon8-removebg-preview.png" alt="Language Icon" className="language-icon-image" />
                    </div>
                </button>
                <div 
                    className={`language-dropdown-menu ${langDropdownOpen ? 'active' : ''}`}
                    id="languageDropdownMenu"
                    role="menu"
                >
                    {languages.map(lang => (
                        <button
                            key={lang.code}
                            className={`language-option ${currentLang === lang.code ? 'active' : ''}`}
                            role="menuitem"
                            data-lang={lang.code}
                            onClick={() => handleLanguageChange(lang.code)}
                        >
                            <span className="language-name">{lang.name}</span>
                            {lang.codeText && <span className="language-code">{lang.codeText}</span>}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
};

export default Navigation;

