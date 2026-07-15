import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import ProcessHeadHunterPanel from './ProcessHeadHunterPanel';
import ProcessHowWorksPanel from './ProcessHowWorksPanel';
import ProcessEmptyCardPanel from './ProcessEmptyCardPanel';
import ProcessCvComparisonPanel from './ProcessCvComparisonPanel';
import { CampaignReadyIcon } from './CampaignReadyIcon.jsx';
import { CAMPAIGN_READY_OPTIONS } from '../constants/campaignReadyOptions.js';

const HOW_WORKS_ICON_TYPES = ['rocket', 'form', 'phone', 'video'];
/** Desktop overview: cards 01–05 only; cards 06–16 stay in the mobile swiper. */
const PROCESS_OVERVIEW_DESKTOP_ROWS = [[0], [1, 2, 3, 4]];

/** أيقونات المراحل الثلاث — خطوط واضحة؛ 1: viewBox 40×40 stroke 2؛ 2: viewBox 24×24 stroke 1.2؛ 3: نفس stroke 2 مع تكبير مركزي ~22% لملء البطاقة مثل البقية */
const ProcessStage1Illustration = () => (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M35 5H5V35H35V5Z" stroke="currentColor" strokeWidth="2" />
        <path
            d="M10 14H30M10 19H30M10 24H26M10 29H30"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        />
    </svg>
);

/** مرحلة الصوت — هاتف + موجات (نفس سماكة الخط كباقي الأيقونات: viewBox 24×24، stroke 1.2 ≈ 2px عند 40px) */
const ProcessStage2Illustration = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path
            d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M14.05 2a9 9 0 018 7.99"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M14.05 6A5 5 0 0 1 18 10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

/** مرحلة الفيديو — تكبير مركزي ليطابق بصريًا أيقونات 1 و2 (المحتوى كان أصغر داخل 40×40) */
const ProcessStage3Illustration = () => (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <g transform="translate(20 20) scale(1.22) translate(-20 -20)">
        <path
            d="M7 12h18a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V14a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
                vectorEffect="nonScalingStroke"
        />
        <path
            d="M27 17l7-4v14l-7-4z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
                vectorEffect="nonScalingStroke"
        />
        </g>
    </svg>
);

/** Splits "…\\n\\nResult / النتيجة / ئەنجام" so the result line can sit at a consistent height across cards. */
function splitProcessStageDescription(text) {
    if (typeof text !== 'string' || !text.trim()) {
        return { body: text || '', result: null };
    }
    const parts = text.split(/\n\n+/);
    if (parts.length < 2) {
        return { body: text, result: null };
    }
    const result = parts[parts.length - 1].trim();
    const body = parts.slice(0, -1).join('\n\n').trim();
    return { body, result };
}

function ProcessBackStageDescription({ t, descKey }) {
    const text = t(descKey);
    const { body, result } = splitProcessStageDescription(text);
    if (result) {
        return (
            <>
                <p className="step-description step-description--stage-body">{body}</p>
                <p className="step-description step-description--stage-result">{result}</p>
            </>
        );
    }
    return <p className="step-description">{text}</p>;
}

function ProcessStepIcon({ step }) {
    if (step.howWorks) {
        return (
            <div
                className="process-how-works-icon-wrap"
                style={{ '--ni-c1': step.howWorks.accent, '--ni-c2': step.howWorks.accent2 }}
            >
                <CampaignReadyIcon type={step.howWorks.iconType} color="#ffffff" size={28} />
            </div>
        );
    }
    return <div className="step-icon">{step.icon}</div>;
}

function ProcessStepDescription({ step, t }) {
    if (step.stageDescription) {
        return <ProcessBackStageDescription t={t} descKey={step.descKey} />;
    }
    return <p className="step-description">{step.description}</p>;
}

function processStepClassName(step, { isFirst = false } = {}) {
    return [
        'process-step',
        'process-step--reveal',
        isFirst ? 'process-step-first process-step--reveal-hero' : 'process-step--reveal-flow',
        step.variant === 'how-works' ? 'process-step--how-works' : '',
    ]
        .filter(Boolean)
        .join(' ');
}

const PROCESS_STAGE_HASH_RE = /^#process-stage-([1-3])$/;
const PROCESS_HEAD_HUNTER_HASH = '#process-head-hunter';
const PROCESS_CV_COMPARISON_HASH = '#process-cv-comparison';
const PROCESS_NAV_OFFSET = 96;
/** Mobile overview swiper indices for Stage 1–3 (steps 10–12). */
const MOBILE_PROCESS_STAGE_SLIDE_INDEX = { 1: 9, 2: 10, 3: 11 };

function scrollToProcessSection(behavior = 'smooth') {
    const section = document.getElementById('process');
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY - PROCESS_NAV_OFFSET;
    window.scrollTo({ top: Math.max(0, top), behavior });
}

const Process = () => {
    const { t } = useLanguage();
    const location = useLocation();
    const processRef = useRef(null);
    
    useEffect(() => {
        // Apply evaalo styling to section title
        const elements = processRef.current?.querySelectorAll('.section-title');
        elements?.forEach(el => {
            // Only process if evaalo exists and is not already wrapped
            if (el.innerHTML && el.innerHTML.includes('evaalo') && !el.innerHTML.includes('evaalo-text-en')) {
                // Replace evaalo with wrapped version, avoiding already wrapped ones
                el.innerHTML = el.innerHTML.replace(/\bevaalo\b/gi, '<span class="evaalo-text-en">$&</span>');
            }
        });
    }, [t]);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;
    const swiperRef = useRef(null);
    const [currentPage, setCurrentPage] = useState(0); // 0 overview, 1 how works, 2 stages, 3 head hunter, 4 cv comparison, 5 ops
    const currentPageRef = useRef(0);
    currentPageRef.current = currentPage;

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const nodes = processRef.current?.querySelectorAll(
            '.process-step--reveal, .process-connector--reveal, .process-how-card--reveal, .process-stage-back-card--reveal, .process-head-hunter-card--reveal, .process-cv-comparison-card--reveal, .process-ops-card--reveal'
        );
        if (!nodes?.length) return undefined;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            nodes.forEach((node) => node.classList.add('is-process-revealed'));
            return undefined;
        }

        const syncVisible = () => {
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const page = currentPageRef.current;
            nodes.forEach((node) => {
                const isStageBack = node.classList.contains('process-stage-back-card--reveal');
                const isHeadHunter = node.classList.contains('process-head-hunter-card--reveal');
                const isHowWorks = node.classList.contains('process-how-card--reveal');
                const isCvComparison = node.classList.contains('process-cv-comparison-card--reveal');
                const isOpsCard = node.classList.contains('process-ops-card--reveal');
                if (isCvComparison && page !== 4) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                if (isCvComparison && page === 4) {
                    node.classList.add('is-process-revealed');
                    return;
                }
                if (isOpsCard && page !== 5) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                if (isOpsCard && page === 5) {
                    node.classList.add('is-process-revealed');
                    return;
                }
                if (isHowWorks && page !== 1) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                if (isHowWorks && page === 1) {
                    node.classList.add('is-process-revealed');
                    return;
                }
                if (isHeadHunter && page !== 3) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                if (isHeadHunter && page === 3) {
                    node.classList.add('is-process-revealed');
                    return;
                }
                if (isStageBack && page !== 2) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                if (isStageBack && page === 2) {
                    node.classList.add('is-process-revealed');
                    return;
                }
                if (
                    node.classList.contains('process-step--reveal') &&
                    !isStageBack &&
                    !isHeadHunter &&
                    !isHowWorks &&
                    !isCvComparison &&
                    !isOpsCard &&
                    page !== 0
                ) {
                    node.classList.remove('is-process-revealed');
                    return;
                }
                const rect = node.getBoundingClientRect();
                const visible = rect.top < viewportHeight * 0.94 && rect.bottom > viewportHeight * 0.06;
                node.classList.toggle('is-process-revealed', visible);
            });
        };

        const observer = new IntersectionObserver(
            () => syncVisible(),
            { threshold: [0, 0.08, 0.18], rootMargin: '0px 0px 0px 0px' }
        );

        nodes.forEach((node) => observer.observe(node));
        requestAnimationFrame(() => requestAnimationFrame(syncVisible));

        let flipTimer;
        if (currentPage === 1) {
            processRef.current
                ?.querySelectorAll('.process-how-card--reveal')
                .forEach((node) => node.classList.remove('is-process-revealed'));
            flipTimer = window.setTimeout(syncVisible, 420);
        } else if (currentPage === 2) {
            processRef.current
                ?.querySelectorAll('.process-stage-back-card--reveal')
                .forEach((node) => node.classList.remove('is-process-revealed'));
            flipTimer = window.setTimeout(syncVisible, 420);
        } else if (currentPage === 3) {
            processRef.current
                ?.querySelectorAll('.process-head-hunter-card--reveal')
                .forEach((node) => node.classList.remove('is-process-revealed'));
            flipTimer = window.setTimeout(syncVisible, 420);
        } else if (currentPage === 4) {
            processRef.current
                ?.querySelectorAll('.process-cv-comparison-card--reveal')
                .forEach((node) => node.classList.remove('is-process-revealed'));
            flipTimer = window.setTimeout(syncVisible, 420);
        } else if (currentPage === 5) {
            processRef.current
                ?.querySelectorAll('.process-ops-card--reveal')
                .forEach((node) => node.classList.remove('is-process-revealed'));
            flipTimer = window.setTimeout(syncVisible, 420);
        }

        window.addEventListener('scroll', syncVisible, { passive: true });
        window.addEventListener('resize', syncVisible);

        return () => {
            observer.disconnect();
            window.removeEventListener('scroll', syncVisible);
            window.removeEventListener('resize', syncVisible);
            if (flipTimer) window.clearTimeout(flipTimer);
        };
    }, [t, isMobile, currentPage]);

    const steps = useMemo(() => [
        {
            number: '01',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 5L25 15H35L27 22L30 32L20 26L10 32L13 22L5 15H15L20 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            title: t('step1Title'),
            description: t('step1Description')
        },
        {
            number: '02',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M35 5H5V35H35V5Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M10 15H30M10 20H30M10 25H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step2Title'),
            description: t('step2Description')
        },
        {
            number: '03',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step3Title'),
            description: t('step3Description')
        },
        {
            number: '04',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 15C22.7614 15 25 12.7614 25 10C25 7.23858 22.7614 5 20 5C17.2386 5 15 7.23858 15 10C15 12.7614 17.2386 15 20 15Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M10 35V32C10 27.5817 13.5817 24 18 24H22C26.4183 24 30 27.5817 30 32V35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step4Title'),
            description: t('step4Description')
        },
        {
            number: '05',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M35 15L15 35L5 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M35 5L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            title: t('step5Title'),
            description: t('step5Description')
        },
        ...HOW_WORKS_ICON_TYPES.map((iconType, index) => {
            const theme = CAMPAIGN_READY_OPTIONS[index];
            const cardIndex = index + 1;
            return {
                number: String(6 + index).padStart(2, '0'),
                title: t(`processHowWorks${cardIndex}Title`),
                description: t(`processHowWorks${cardIndex}Description`),
                variant: 'how-works',
                howWorks: {
                    iconType,
                    accent: theme?.accent ?? '#3b82f6',
                    accent2: theme?.accent2 ?? '#06b6d4',
                },
            };
        }),
        {
            number: '10',
            icon: <ProcessStage1Illustration />,
            title: t('processStage1Title'),
            descKey: 'processStage1Description',
            stageDescription: true,
        },
        {
            number: '11',
            icon: <ProcessStage2Illustration />,
            title: t('processStage2Title'),
            descKey: 'processStage2Description',
            stageDescription: true,
        },
        {
            number: '12',
            icon: <ProcessStage3Illustration />,
            title: t('processStage3Title'),
            descKey: 'processStage3Description',
            stageDescription: true,
        },
        {
            number: '13',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="29" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="20" cy="9" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="18" cy="24" r="7" stroke="currentColor" strokeWidth="2"/>
                    <path d="M24 29L31 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step6Title'),
            description: t('step6Description')
        },
        {
            number: '14',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M6 8H22V28H6V8Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M18 12H34V32H18V12Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M10 14H18M10 19H18M10 24H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M22 16H30M22 21H30M22 26H28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            title: t('step7Title'),
            description: t('step7Description')
        },
        {
            number: '15',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <ellipse cx="20" cy="10" rx="12" ry="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8 10V28C8 30.2 13.4 32 20 32C26.6 32 32 30.2 32 28V10" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8 19C8 21.2 13.4 23 20 23C26.6 23 32 21.2 32 19" stroke="currentColor" strokeWidth="2"/>
                </svg>
            ),
            title: t('step8Title'),
            description: t('step8Description')
        },
        {
            number: '16',
            icon: (
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <circle cx="20" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
                    <path d="M20 11v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M11 19h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M11 15v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M29 15v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="11" cy="22" r="3" stroke="currentColor" strokeWidth="2" />
                    <circle cx="29" cy="22" r="3" stroke="currentColor" strokeWidth="2" />
                    <rect x="10" y="29" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
                    <circle cx="20" cy="33" r="2" stroke="currentColor" strokeWidth="1.6" />
                </svg>
            ),
            title: t('step9Title'),
            description: t('step9Description')
        },
    ], [t]);

    const handlePrev = () => {
        if (currentPage === 5) {
            setCurrentPage(4);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 4) {
            setCurrentPage(3);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 3) {
            setCurrentPage(2);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 2) {
            setCurrentPage(1);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 1) {
                setCurrentPage(0);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (swiperRef.current) {
            swiperRef.current.slidePrev();
        }
    };

    const handleNext = () => {
        if (currentPage === 4 && !isMobile) {
            setCurrentPage(5);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 3 && !isMobile) {
            setCurrentPage(4);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 2 && !isMobile) {
            setCurrentPage(3);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 1 && !isMobile) {
            setCurrentPage(2);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (currentPage === 0 && !isMobile) {
                setCurrentPage(1);
            window.requestAnimationFrame(() => scrollToProcessSection('auto'));
            return;
        }
        if (swiperRef.current) {
            swiperRef.current.slideNext();
        }
    };

    const openProcessStageFromHash = useCallback((hash, { fromRouteChange = false } = {}) => {
        const stageMatch = (hash || '').match(PROCESS_STAGE_HASH_RE);
        const isHeadHunter = hash === PROCESS_HEAD_HUNTER_HASH;
        const isCvComparison = hash === PROCESS_CV_COMPARISON_HASH;

        if (!stageMatch && !isHeadHunter && !isCvComparison) return;

        const alignProcessSection = (behavior = 'smooth') => {
            scrollToProcessSection(behavior);
        };

        const openMobileStageSlide = (stageNum) => {
            const slideIndex = MOBILE_PROCESS_STAGE_SLIDE_INDEX[stageNum];
            if (slideIndex == null) return;

            alignProcessSection(fromRouteChange ? 'auto' : 'smooth');

            window.setTimeout(() => {
                if (currentPageRef.current !== 0) {
                    setCurrentPage(0);
                }

                window.requestAnimationFrame(() => {
                    alignProcessSection('auto');

                    const slideWhenReady = (attempt = 0) => {
                        if (swiperRef.current) {
                            swiperRef.current.slideTo(slideIndex, fromRouteChange ? 0 : 450);
                            return;
                        }
                        if (attempt < 30) {
                            window.setTimeout(() => slideWhenReady(attempt + 1), 50);
                        }
                    };

                    slideWhenReady();
                });
            }, fromRouteChange ? 120 : 420);
        };

        const openView = () => {
            if (isCvComparison) {
                alignProcessSection(fromRouteChange ? 'auto' : 'smooth');
                window.setTimeout(() => {
                    setCurrentPage(4);
                    window.requestAnimationFrame(() => alignProcessSection('auto'));
                }, fromRouteChange ? 80 : 420);
                return;
            }

            if (isHeadHunter) {
                alignProcessSection(fromRouteChange ? 'auto' : 'smooth');
                window.setTimeout(() => {
                    setCurrentPage(3);
                    window.requestAnimationFrame(() => alignProcessSection('auto'));
                }, fromRouteChange ? 80 : 420);
                return;
            }

            if (isMobileRef.current) {
                openMobileStageSlide(Number(stageMatch[1]));
                return;
            }

            if (currentPageRef.current === 2) {
                alignProcessSection('smooth');
                return;
            }

            alignProcessSection(fromRouteChange ? 'auto' : 'smooth');

            window.setTimeout(() => {
                setCurrentPage(2);
                window.requestAnimationFrame(() => {
                    alignProcessSection('auto');
                });
            }, fromRouteChange ? 80 : 420);
        };

        window.requestAnimationFrame(openView);
    }, []);

    useEffect(() => {
        if (location.pathname !== '/') return undefined;

        const fromRouteChange = Boolean(
            location.hash.match(PROCESS_STAGE_HASH_RE)
            || location.hash === PROCESS_HEAD_HUNTER_HASH
            || location.hash === PROCESS_CV_COMPARISON_HASH
        );
        const run = () => openProcessStageFromHash(location.hash, { fromRouteChange });

        const timer = window.setTimeout(run, fromRouteChange ? 120 : 0);

        const onHashChange = () => {
            if (window.location.pathname !== '/') return;
            openProcessStageFromHash(window.location.hash, { fromRouteChange: false });
        };

        window.addEventListener('hashchange', onHashChange);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('hashchange', onHashChange);
        };
    }, [location.pathname, location.hash, openProcessStageFromHash]);

    return (
        <section className="process" id="process" ref={processRef}>
            <div className="circuit-lines-pattern"></div>
            <div className="tech-grid-overlay"></div>
            <div className="radial-waves"></div>
            
            <div className="container process-flip-shell">
                {currentPage === 5 ? (
                    <>
                        <div className="section-header" id="process-ops">
                            <h2 className="section-title process-stages-title">{t('processOpsTitle')}</h2>
                            <p className="section-subtitle process-ops-panel__subtitle">{t('processOpsSubtitle')}</p>
                        </div>
                        <div className="process-steps-wrapper">
                            <button 
                                type="button"
                                className="process-nav-btn process-nav-prev" 
                                onClick={handlePrev}
                                aria-label="Go back"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <ProcessEmptyCardPanel />
                            <div className="process-nav-spacer" aria-hidden="true" />
                                        </div>
                    </>
                ) : currentPage === 4 ? (
                    <>
                        <div className="section-header" id="process-cv-comparison">
                            <h2 className="section-title process-stages-title">{t('processCvComparisonTitle')}</h2>
                            <p className="section-subtitle process-ops-panel__subtitle">{t('processCvComparisonSubtitle')}</p>
                                    </div>
                        <div className="process-steps-wrapper">
                            <button
                                type="button"
                                className="process-nav-btn process-nav-prev"
                                onClick={handlePrev}
                                aria-label="Go back"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <ProcessCvComparisonPanel />
                            <button
                                type="button"
                                className="process-nav-btn process-nav-next"
                                onClick={handleNext}
                                aria-label="Next"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                                                </div>
                    </>
                ) : currentPage === 3 ? (
                    <>
                        <div className="section-header" id="process-head-hunter">
                            <h2 className="section-title process-stages-title">{t('navProductAiHeadHunter')}</h2>
                            <p className="section-subtitle process-head-hunter-panel__subtitle">
                                {t('processHeadHunterSubtitle')}
                            </p>
                                    </div>
                        <div className="process-steps-wrapper">
                            <button
                                type="button"
                                className="process-nav-btn process-nav-prev"
                                onClick={handlePrev}
                                aria-label="Go back"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <div className="process-head-hunter-card-shell">
                                <ProcessHeadHunterPanel />
                                </div>
                            <button 
                                type="button"
                                className="process-nav-btn process-nav-next" 
                                onClick={handleNext}
                                aria-label="Next"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </>
                ) : currentPage === 2 ? (
                    <>
                        <div className="section-header" id="process-stages-view">
                            <h2 className="section-title process-stages-title">
                                {t('applicationProcess')}
                            </h2>
                            <p 
                                className="section-subtitle"
                                style={{
                                    fontSize: '18px',
                                    fontWeight: 500,
                                    color: '#64748B',
                                    marginTop: '8px',
                                    marginBottom: '16px',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {t('processSubtitle')}
                            </p>
                        </div>
                        
                        <div className="process-steps-wrapper">
                            <button 
                                type="button"
                                className="process-nav-btn process-nav-prev" 
                                onClick={handlePrev}
                                aria-label="Go back"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            
                            <div className="process-stages-back-row">
                                <div
                                    id="process-stage-1"
                                    className="process-step process-stage-back-card process-stage-back-card--reveal process-stage-back-card--from-left"
                                    style={{ '--process-reveal-delay': '0s' }}
                                >
                                    <div className="step-number">01</div>
                                    <div className="step-icon">
                                        <ProcessStage1Illustration />
                                    </div>
                                    <h3 className="step-title">{t('processStage1Title')}</h3>
                                    <ProcessBackStageDescription t={t} descKey="processStage1Description" />
                                </div>
                                <div
                                    id="process-stage-2"
                                    className="process-step process-stage-back-card process-stage-back-card--reveal process-stage-back-card--from-center"
                                    style={{ '--process-reveal-delay': '0.18s' }}
                                >
                                    <div className="step-number">02</div>
                                    <div className="step-icon">
                                        <ProcessStage2Illustration />
                                    </div>
                                    <h3 className="step-title">{t('processStage2Title')}</h3>
                                    <ProcessBackStageDescription t={t} descKey="processStage2Description" />
                                </div>
                                <div
                                    id="process-stage-3"
                                    className="process-step process-stage-back-card process-stage-back-card--reveal process-stage-back-card--from-right"
                                    style={{ '--process-reveal-delay': '0.36s' }}
                                >
                                    <div className="step-number">03</div>
                                    <div className="step-icon">
                                        <ProcessStage3Illustration />
                                    </div>
                                    <h3 className="step-title">{t('processStage3Title')}</h3>
                                    <ProcessBackStageDescription t={t} descKey="processStage3Description" />
                                </div>
                            </div>

                            <button
                                type="button"
                                className="process-nav-btn process-nav-next"
                                onClick={handleNext}
                                aria-label="Next"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </>
                ) : currentPage === 1 ? (
                    <>
                        <div className="section-header" id="process-how-works">
                            <h2 className="section-title process-stages-title">{t('processHowWorksTitle')}</h2>
                        </div>
                        <div className="process-steps-wrapper">
                            <button
                                type="button"
                                className="process-nav-btn process-nav-prev"
                                onClick={handlePrev}
                                aria-label="Go back"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <ProcessHowWorksPanel />
                            <button
                                type="button"
                                className="process-nav-btn process-nav-next"
                                onClick={handleNext}
                                aria-label="Next"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </>
                ) : (
                    <>
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
                                <div className="process-steps-container" id="processStepsDesktop">
                                    {PROCESS_OVERVIEW_DESKTOP_ROWS.map((rowIndices, rowIndex) => (
                                        <div
                                            key={rowIndices.join('-')}
                                            className={[
                                                'process-steps-row',
                                                rowIndex === 0 ? 'process-steps-row-top' : '',
                                                rowIndices.length < 4 ? 'process-steps-row--centered' : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                        >
                                            {rowIndices.map((stepIndex, index) => {
                                                const step = steps[stepIndex];
                                                const isFirst = stepIndex === 0;
                                                return (
                                                    <React.Fragment key={step.number}>
                                                        <div
                                                            className={processStepClassName(step, { isFirst })}
                                                            style={{ '--process-reveal-delay': `${stepIndex * 0.16}s` }}
                                                        >
                                                            <div className="step-number">{step.number}</div>
                                                            <ProcessStepIcon step={step} />
                                                            <h3 className="step-title">{step.title}</h3>
                                                            <ProcessStepDescription step={step} t={t} />
                                                        </div>
                                                        {index < rowIndices.length - 1 ? (
                                                            <div
                                                                className="process-connector process-connector--reveal"
                                                                style={{ '--process-reveal-delay': `${stepIndex * 0.16 + 0.08}s` }}
                                                                aria-hidden
                                                            />
                                                        ) : null}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <Swiper
                                    modules={[Navigation, Pagination]}
                                    spaceBetween={12}
                                    slidesPerView={1}
                                    slidesPerGroup={1}
                                    centeredSlides={false}
                                    watchOverflow
                                    pagination={{ 
                                        el: '.process-step-indicators',
                                        clickable: true,
                                        bulletActiveClass: 'swiper-pagination-bullet-active',
                                        dynamicBullets: true,
                                        dynamicMainBullets: 3,
                                    }}
                                    onSwiper={(swiper) => {
                                        swiperRef.current = swiper;
                                    }}
                                    className="process-steps-swiper"
                                >
                                    {steps.map((step) => (
                                        <SwiperSlide
                                            key={step.number}
                                            className={processStepClassName(step)}
                                            style={{ '--process-reveal-delay': '0.08s' }}
                                        >
                                            <div className="step-number">{step.number}</div>
                                            <ProcessStepIcon step={step} />
                                            <h3 className="step-title">{step.title}</h3>
                                            <ProcessStepDescription step={step} t={t} />
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
                    </>
                )}
                    </div>
            {currentPage === 1 ? (
                <div className="process-how-works-cta-wrap">
                    <Link
                        className="process-how-works-page-cta"
                        to="/dashboard?open=newCampaign"
                    >
                        {t('processHowWorksOpenNewCampaign')}
                    </Link>
                </div>
            ) : null}
            {currentPage === 3 ? (
                <div className="process-how-works-cta-wrap">
                    <Link className="process-how-works-page-cta" to="/ai-head-hunter">
                        {t('headHunterPageCta')}
                    </Link>
                </div>
            ) : null}
            {currentPage === 4 ? (
                <div className="process-how-works-cta-wrap">
                    <Link
                        className="process-how-works-page-cta"
                        to="/ai-cv-comparison"
                    >
                        {t('processCvComparisonCta')}
                    </Link>
            </div>
            ) : null}
        </section>
    );
};

export default Process;
