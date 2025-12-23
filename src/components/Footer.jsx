import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const Footer = () => {
    const { t } = useLanguage();

    return (
        <footer className="footer">
            <div className="footer-background">
                <div className="footer-ai-dots">
                    <div className="ai-dot" style={{left: '10%', top: '20%'}}></div>
                    <div className="ai-dot" style={{left: '25%', top: '45%'}}></div>
                    <div className="ai-dot" style={{left: '40%', top: '70%'}}></div>
                    <div className="ai-dot" style={{left: '60%', top: '30%'}}></div>
                    <div className="ai-dot" style={{left: '75%', top: '60%'}}></div>
                    <div className="ai-dot" style={{left: '90%', top: '40%'}}></div>
                </div>
                <svg className="footer-connection-lines" xmlns="http://www.w3.org/2000/svg">
                    <line className="connection-line" x1="10%" y1="20%" x2="25%" y2="45%" />
                    <line className="connection-line" x1="25%" y1="45%" x2="40%" y2="70%" />
                    <line className="connection-line" x1="40%" y1="70%" x2="60%" y2="30%" />
                    <line className="connection-line" x1="60%" y1="30%" x2="75%" y2="60%" />
                    <line className="connection-line" x1="75%" y1="60%" x2="90%" y2="40%" />
                </svg>
            </div>
            
            <div className="container">
                <div className="footer-content">
                    <div className="footer-section">
                        <h4 className="footer-title">{t('companyName')}</h4>
                        <p className="footer-text">{t('footerDescription')}</p>
                    </div>
                    <div className="footer-section">
                        <h4 className="footer-title">{t('quickLinks')}</h4>
                        <ul className="footer-links">
                            <li><a href="#">{t('aboutUs')}</a></li>
                            <li><a href="#">{t('contact')}</a></li>
                        </ul>
                    </div>
                    <div className="footer-section">
                        <h4 className="footer-title">{t('legal')}</h4>
                        <ul className="footer-links">
                            <li><a href="#">{t('privacy')}</a></li>
                            <li><a href="#">{t('terms')}</a></li>
                            <li><a href="#">{t('dataSecurity')}</a></li>
                        </ul>
                    </div>
                </div>
                <div className="footer-tagline">
                    <p>{t('footerTagline')}</p>
                </div>
                <div className="footer-bottom">
                    <p>{t('copyright')}</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;

