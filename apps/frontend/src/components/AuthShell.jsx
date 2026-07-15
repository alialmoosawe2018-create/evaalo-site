/**
 * Two-column auth shell, visually identical to `AccountStripePortal`.
 *
 *  ┌───────────────────────────────┬─────────────────────────────────────┐
 *  │        dark aside             │           cream main content        │
 *  │ (evaalo logo + marketing      │  (<Login> / <Signup> / <Forgot>)    │
 *  │  copy)                        │                                     │
 *  └───────────────────────────────┴─────────────────────────────────────┘
 *
 * The shell intentionally owns only layout + chrome — the form markup is
 * passed in via `children`, so each auth page focuses on its own fields.
 */

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

const SIDEBAR_BG = 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)';
const MAIN_BG = '#FDF8F0';
const MAIN_TEXT = '#1f2937';
const MUTED = '#94a3b8';
const MUTED_LIGHT = '#cbd5e1';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.12)';
const PORTAL_LOGO_SRC = '/images/last logo.png';

const AUTH_FONT_LATIN =
    "'Inter', 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const AUTH_FONT_ARABIC =
    "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const AUTH_FONT_KURDISH =
    "'Noto Sans Arabic', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function getAuthFontFamily(lang) {
    if (lang === 'ar') return AUTH_FONT_ARABIC;
    if (lang === 'ku') return AUTH_FONT_KURDISH;
    return AUTH_FONT_LATIN;
}

const AuthShell = ({
    heading,
    subheading,
    footerText,
    footerLinkLabel,
    footerLinkTo,
    sidebarTitle,
    sidebarBody,
    children,
}) => {
    const { t, currentLang } = useLanguage();
    const isRtl = currentLang === 'ar' || currentLang === 'ku';
    const authFontFamily = getAuthFontFamily(currentLang);

    useEffect(() => {
        const prevHtmlBg = document.documentElement.style.background;
        const prevBodyBg = document.body.style.background;
        const prevBodyOverflow = document.body.style.overflow;
        document.documentElement.style.background = SIDEBAR_BG;
        document.body.style.background = MAIN_BG;
        document.body.style.overflow = 'hidden';
        return () => {
            document.documentElement.style.background = prevHtmlBg;
            document.body.style.background = prevBodyBg;
            document.body.style.overflow = prevBodyOverflow;
        };
    }, []);

    return (
        <>
            <style>{`
                .auth-shell {
                    position: fixed;
                    inset: 0;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    width: 100%;
                    height: 100dvh;
                    min-height: 100dvh;
                    display: flex;
                    flex-direction: row;
                    background: ${MAIN_BG};
                    font-family: ${authFontFamily};
                    color: ${MAIN_TEXT};
                    overflow: auto;
                    overscroll-behavior: contain;
                }
                .auth-shell__aside {
                    width: 48%;
                    min-width: 0;
                    max-width: 560px;
                    flex: 0 1 560px;
                    background: ${SIDEBAR_BG};
                    color: #fff;
                    padding: 32px 28px 24px;
                    display: flex;
                    flex-direction: column;
                    flex-shrink: 0;
                    border-right: 1px solid ${BORDER_SUBTLE};
                }
                .auth-shell__logo {
                    display: block;
                    width: 36px;
                    height: 36px;
                    object-fit: contain;
                    flex-shrink: 0;
                }
                .auth-shell__aside-copy {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    min-height: 0;
                }
                .auth-shell__aside-title {
                    margin: 0 0 12px;
                    font-size: 24px;
                    font-weight: 700;
                    line-height: 1.3;
                }
                .auth-shell__aside-body {
                    margin: 0;
                    font-size: 17px;
                    font-weight: 400;
                    line-height: 1.5;
                    color: ${MUTED_LIGHT};
                }
                .auth-shell__aside-footer {
                    font-size: 12px;
                    color: ${MUTED};
                    line-height: 1.6;
                    flex-shrink: 0;
                }
                .auth-shell__aside-footer-brand {
                    margin-bottom: 8px;
                }
                .auth-shell__aside-footer-links {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .auth-shell__aside-footer-link {
                    color: ${MUTED_LIGHT};
                    text-decoration: none;
                }
                .auth-shell__aside-footer-sep {
                    color: ${BORDER_SUBTLE};
                }
                .auth-shell__main {
                    flex: 1;
                    min-width: 0;
                    padding: 48px clamp(24px, 4vw, 48px) calc(64px + env(safe-area-inset-bottom, 0px));
                    padding-top: calc(48px + env(safe-area-inset-top, 0px));
                    overflow: auto;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                .auth-shell__form-wrap {
                    width: 100%;
                    max-width: 440px;
                }
                .auth-shell__eyebrow {
                    font-size: 13px;
                    font-weight: 600;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: #64748b;
                    margin: 0 0 12px;
                }
                .auth-shell__heading {
                    font-size: 32px;
                    font-weight: 700;
                    line-height: 1.2;
                    margin: 0 0 10px;
                    color: ${MAIN_TEXT};
                }
                .auth-shell__subheading {
                    font-size: 15px;
                    line-height: 1.55;
                    color: #6b7280;
                    margin: 0 0 28px;
                }
                .auth-shell__footer {
                    margin-top: 24px;
                    font-size: 14px;
                    color: #6b7280;
                    text-align: center;
                }
                .auth-shell__footer a {
                    color: #2563eb;
                    font-weight: 600;
                    text-decoration: none;
                }
                .auth-shell__footer a:hover { text-decoration: underline; }

                @media (max-width: 900px) {
                    .auth-shell {
                        flex-direction: column;
                        overflow-x: hidden;
                        overflow-y: auto;
                    }
                    .auth-shell__aside {
                        width: 100%;
                        max-width: none;
                        flex: 0 0 auto;
                        border-right: none;
                        border-bottom: 1px solid ${BORDER_SUBTLE};
                        padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px;
                    }
                    .auth-shell__aside-copy {
                        flex: 0 0 auto;
                        padding: 12px 0 16px;
                    }
                    .auth-shell__main {
                        flex: 1 1 auto;
                        justify-content: flex-start;
                        padding: 20px 16px calc(24px + env(safe-area-inset-bottom, 0px));
                        padding-top: 20px;
                    }
                }

                @media (max-width: 640px) {
                    .auth-shell__aside {
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        gap: 12px;
                        padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px;
                    }
                    .auth-shell__logo {
                        width: 28px;
                        height: 28px;
                    }
                    .auth-shell__aside-copy {
                        display: none;
                    }
                    .auth-shell__aside-footer {
                        font-size: 10px;
                        text-align: end;
                    }
                    .auth-shell__aside-footer-brand {
                        margin-bottom: 4px;
                    }
                    .auth-shell__aside-footer-links {
                        justify-content: flex-end;
                        gap: 6px;
                    }
                    .auth-shell__main {
                        padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px));
                    }
                    .auth-shell__heading {
                        font-size: 26px;
                        margin-bottom: 8px;
                    }
                    .auth-shell__subheading {
                        font-size: 14px;
                        margin-bottom: 22px;
                    }
                    .auth-shell__footer {
                        margin-top: 18px;
                        font-size: 13px;
                    }
                }

                @media (max-width: 420px) {
                    .auth-shell__heading {
                        font-size: 24px;
                    }
                    .auth-shell__main {
                        padding-inline: 14px;
                    }
                }
            `}</style>

            <div className="auth-shell" dir={isRtl ? 'rtl' : 'ltr'} lang={currentLang}>
                <aside className="auth-shell__aside">
                    <img
                        src={PORTAL_LOGO_SRC}
                        alt="evaalo"
                        width={36}
                        height={36}
                        className="auth-shell__logo"
                        draggable={false}
                    />
                    <div className="auth-shell__aside-copy">
                        {sidebarTitle && (
                            <h2 className="auth-shell__aside-title">{sidebarTitle}</h2>
                        )}
                        {sidebarBody && (
                            <p className="auth-shell__aside-body">{sidebarBody}</p>
                        )}
                    </div>
                    <div className="auth-shell__aside-footer">
                        <div className="auth-shell__aside-footer-brand">
                            &copy; {new Date().getFullYear()}{' '}
                            <span style={{ color: '#fff', fontWeight: 600 }}>evaalo</span>
                        </div>
                        <div className="auth-shell__aside-footer-links">
                            <Link to="/terms" className="auth-shell__aside-footer-link">
                                {t('termsOfService') || 'Terms'}
                            </Link>
                            <span className="auth-shell__aside-footer-sep">|</span>
                            <Link to="/privacy" className="auth-shell__aside-footer-link">
                                {t('privacyPolicy') || 'Privacy'}
                            </Link>
                        </div>
                    </div>
                </aside>

                <main className="auth-shell__main">
                    <div className="auth-shell__form-wrap">
                        <h1 className="auth-shell__heading">{heading}</h1>
                        {subheading && <p className="auth-shell__subheading">{subheading}</p>}
                        {children}
                        {footerText && footerLinkTo && (
                            <p className="auth-shell__footer">
                                {footerText}{' '}
                                <Link to={footerLinkTo}>{footerLinkLabel}</Link>
                            </p>
                        )}
                    </div>
                </main>
            </div>
        </>
    );
};

export default AuthShell;
