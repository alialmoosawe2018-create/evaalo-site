import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import NeuralNetwork from './NeuralNetwork';

const Hero = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const canvasRef = useRef(null);

    const navigateToApplication = () => {
        navigate('/form');
    };

    const scrollToFeatures = () => {
        document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <section className="hero" id="hero">
            <div className="hero-background">
                <div className="circuit-pattern"></div>
                
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
                
                <div className="ai-particles">
                    <div className="ai-particle" style={{left: '10%', top: '15%'}}></div>
                    <div className="ai-particle" style={{left: '85%', top: '25%'}}></div>
                    <div className="ai-particle" style={{left: '20%', top: '70%'}}></div>
                    <div className="ai-particle" style={{left: '75%', top: '80%'}}></div>
                    <div className="ai-particle" style={{left: '50%', top: '40%'}}></div>
                    <div className="ai-particle" style={{left: '30%', top: '55%'}}></div>
                </div>
                
                <NeuralNetwork />
                
                <div className="floating-ai-icons">
                    <div className="ai-icon" style={{left: '15%', top: '20%'}}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
                            <circle cx="20" cy="20" r="3" fill="currentColor" opacity="0.8"/>
                            <line x1="20" y1="5" x2="20" y2="12" stroke="currentColor" strokeWidth="2"/>
                            <line x1="20" y1="28" x2="20" y2="35" stroke="currentColor" strokeWidth="2"/>
                            <line x1="5" y1="20" x2="12" y2="20" stroke="currentColor" strokeWidth="2"/>
                            <line x1="28" y1="20" x2="35" y2="20" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                    </div>
                    <div className="ai-icon" style={{right: '10%', top: '35%'}}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20 8L24 16H32L26 22L28 32L20 26L12 32L14 22L8 16H16L20 8Z" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"/>
                        </svg>
                    </div>
                    <div className="ai-icon" style={{left: '8%', bottom: '25%'}}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="10" y="10" width="20" height="20" rx="2" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
                            <path d="M15 15h10M15 20h10M15 25h6" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                    </div>
                    <div className="ai-icon" style={{right: '15%', bottom: '30%'}}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="10" cy="20" r="3" fill="currentColor" opacity="0.7"/>
                            <circle cx="30" cy="20" r="3" fill="currentColor" opacity="0.7"/>
                            <circle cx="20" cy="10" r="3" fill="currentColor" opacity="0.7"/>
                            <circle cx="20" cy="30" r="3" fill="currentColor" opacity="0.7"/>
                            <line x1="13" y1="18" x2="17" y2="12" stroke="currentColor" strokeWidth="2"/>
                            <line x1="23" y1="12" x2="27" y2="18" stroke="currentColor" strokeWidth="2"/>
                            <line x1="13" y1="22" x2="17" y2="28" stroke="currentColor" strokeWidth="2"/>
                            <line x1="23" y1="28" x2="27" y2="22" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                    </div>
                </div>
            </div>
            
            <div className="hero-content">
                <div className="hero-text-content">
                    <div className="hero-badge">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 2L12.5 7L18 7.75L14 11.5L15 17L10 14.25L5 17L6 11.5L2 7.75L7.5 7L10 2Z" fill="currentColor"/>
                        </svg>
                        <span>{t('nowHiring')}</span>
                    </div>
                    
                    <h1 className="hero-title">
                        <span className="hero-subtitle">Smart Hiring</span> AI evaluations<br />
                        for voice, video, and written interviews
                    </h1>
                
                    <div className="hero-actions">
                        <button className="btn btn-primary btn-large" onClick={navigateToApplication}>
                            <span>{t('applyNow')}</span>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>
                        <a href="#features" className="btn btn-secondary btn-large" onClick={scrollToFeatures}>
                            <span>{t('learnMore')}</span>
                        </a>
                        
                        <div className="hero-features">
                            <div className="hero-feature-item">
                                <div className="feature-icon">
                                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="12" y="8" width="40" height="48" rx="2" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinejoin="round"/>
                                        <line x1="20" y1="20" x2="44" y2="20" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="20" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="20" y1="36" x2="36" y2="36" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="20" y1="44" x2="40" y2="44" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
                                    </svg>
                                </div>
                                <span>Write</span>
                            </div>
                            <div className="hero-feature-item">
                                <div className="feature-icon">
                                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <ellipse cx="32" cy="20" rx="9" ry="14" stroke="#22d3ee" strokeWidth="3.5" fill="none"/>
                                        <line x1="25" y1="14" x2="39" y2="14" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="26" y1="18" x2="38" y2="18" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="27" y1="22" x2="37" y2="22" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                        <path d="M20 34C20 34 20 28 23 28C26 28 26 34 26 34" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
                                        <path d="M38 34C38 34 38 28 41 28C44 28 44 34 44 34" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
                                        <line x1="26" y1="34" x2="38" y2="34" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="32" y1="34" x2="32" y2="50" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                        <line x1="22" y1="50" x2="42" y2="50" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round"/>
                                    </svg>
                                </div>
                                <span>Voice</span>
                            </div>
                            <div className="hero-feature-item">
                                <div className="feature-icon">
                                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="cameraGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" style={{stopColor:'#ff6b6b',stopOpacity:1}} />
                                                <stop offset="100%" style={{stopColor:'#ee5a52',stopOpacity:1}} />
                                            </linearGradient>
                                        </defs>
                                        <rect x="10" y="18" width="36" height="28" rx="5" stroke="url(#cameraGradient)" strokeWidth="4" fill="none"/>
                                        <circle cx="21" cy="32" r="9" fill="url(#cameraGradient)"/>
                                        <circle cx="23" cy="30" r="2.5" fill="white" opacity="0.9"/>
                                        <circle cx="21" cy="32" r="6" stroke="white" strokeWidth="2.5" opacity="0.3" fill="none"/>
                                        <circle cx="35" cy="32" r="9" fill="url(#cameraGradient)"/>
                                        <circle cx="37" cy="30" r="2.5" fill="white" opacity="0.9"/>
                                        <circle cx="35" cy="32" r="6" stroke="white" strokeWidth="2.5" opacity="0.3" fill="none"/>
                                        <line x1="21" y1="32" x2="35" y2="32" stroke="url(#cameraGradient)" strokeWidth="3.5"/>
                                        <path d="M46 26L56 20V44L46 38V26Z" fill="url(#cameraGradient)" stroke="url(#cameraGradient)" strokeWidth="3.5" strokeLinejoin="round"/>
                                        <path d="M47 28L52 25V39L47 36V28Z" fill="white" opacity="0.2"/>
                                    </svg>
                                </div>
                                <span>{t('comingSoon')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="scroll-indicator">
                <div className="mouse">
                    <div className="wheel"></div>
                </div>
                <div className="arrow-down">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 5V19M12 19L5 12M12 19L19 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
            </div>
        </section>
    );
};

export default Hero;

