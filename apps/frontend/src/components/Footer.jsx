import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';
import SocialBrandTiles from './SocialBrandTiles';

const Footer = () => {
    const { t, currentLang } = useLanguage();
    const lt = (text) => localizeLegalBrandText(text, currentLang);

    return (
        <footer className="footer">
            <div className="container">
                <div className="footer-main">
                    <div className="footer-brand">
                        <Link to="/" className="footer-brand-logo" aria-label="evaalo home">
                            <img src="/images/last logo.png" alt="" className="logo-image" aria-hidden="true" />
                            <span className="logo-text">vaalo.Ai</span>
                        </Link>
                        <p className="footer-brand-description">{t('footerDescription')}</p>
                    </div>

                    <div className="footer-links-grid">
                        <div className="footer-column footer-column--quick">
                            <h4 className="footer-column-title">{t('quickLinks')}</h4>
                            <ul className="footer-column-links">
                                <li>
                                    <Link to="/about">{t('aboutUs')}</Link>
                                </li>
                            </ul>
                            <SocialBrandTiles />
                        </div>

                        <div className="footer-column">
                            <h4 className="footer-column-title">{t('legal')}</h4>
                            <ul className="footer-column-links">
                                <li>
                                    <Link to="/privacy">{t('privacy')}</Link>
                                </li>
                                <li>
                                    <Link to="/terms">{t('terms')}</Link>
                                </li>
                                <li>
                                    <Link to="/data-security">{t('dataSecurity')}</Link>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="footer-divider"></div>

                <div className="footer-bottom">
                    <p className="footer-copyright">{lt(t('copyright'))}</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
