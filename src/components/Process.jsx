import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

const Process = () => {
    const { t } = useLanguage();
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const swiperRef = useRef(null);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const steps = [
        {
            number: '01',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M35 5H5V35H35V5Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M10 15H30M10 20H30M10 25H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step1Title'),
            description: t('step1Description')
        },
        {
            number: '02',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step2Title'),
            description: t('step2Description')
        },
        {
            number: '03',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 15C22.7614 15 25 12.7614 25 10C25 7.23858 22.7614 5 20 5C17.2386 5 15 7.23858 15 10C15 12.7614 17.2386 15 20 15Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M10 35V32C10 27.5817 13.5817 24 18 24H22C26.4183 24 30 27.5817 30 32V35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step3Title'),
            description: t('step3Description')
        },
        {
            number: '04',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M35 15L15 35L5 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M35 5L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            title: t('step4Title'),
            description: t('step4Description')
        }
    ];

    const handlePrev = () => {
        if (swiperRef.current) {
            swiperRef.current.slidePrev();
        }
    };

    const handleNext = () => {
        if (swiperRef.current) {
            swiperRef.current.slideNext();
        }
    };

    return (
        <section className="process" id="process">
            <div className="circuit-lines-pattern"></div>
            <div className="tech-grid-overlay"></div>
            <div className="radial-waves"></div>
            
            <div className="container">
                <div className="section-header">
                    <h2 className="section-title">{t('applicationProcess')}</h2>
                    <p className="section-description">{t('processDescription')}</p>
                </div>
                
                <div className="process-steps-wrapper">
                    <button 
                        className="process-nav-btn process-nav-prev" 
                        onClick={handlePrev}
                        aria-label="Previous step"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                    
                    {!isMobile ? (
                        <div className="process-steps" id="processStepsDesktop">
                            {steps.map((step, index) => (
                                <React.Fragment key={index}>
                                    <div className="process-step">
                                        <div className="step-number">{step.number}</div>
                                        <div className="step-icon">{step.icon}</div>
                                        <h3 className="step-title">{step.title}</h3>
                                        <p className="step-description">{step.description}</p>
                                    </div>
                                    {index < steps.length - 1 && <div className="process-connector"></div>}
                                </React.Fragment>
                            ))}
                        </div>
                    ) : (
                        <Swiper
                            modules={[Navigation, Pagination]}
                            spaceBetween={20}
                            slidesPerView={1}
                            pagination={{ 
                                el: '.process-step-indicators',
                                clickable: true,
                                bulletActiveClass: 'swiper-pagination-bullet-active'
                            }}
                            onSwiper={(swiper) => {
                                swiperRef.current = swiper;
                            }}
                            className="process-steps-swiper"
                        >
                            {steps.map((step, index) => (
                                <SwiperSlide key={index} className="process-step">
                                    <div className="step-number">{step.number}</div>
                                    <div className="step-icon">{step.icon}</div>
                                    <h3 className="step-title">{step.title}</h3>
                                    <p className="step-description">{step.description}</p>
                                </SwiperSlide>
                            ))}
                            <div className="swiper-pagination process-step-indicators"></div>
                        </Swiper>
                    )}
                    
                    <button 
                        className="process-nav-btn process-nav-next" 
                        onClick={handleNext}
                        aria-label="Next step"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        </section>
    );
};

export default Process;

