import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/** Stable color slot per feature card (original 8-card palette). */
const FEATURE_CARD_COLOR = {
    'smart-integrations': '1',
    'multilingual-voice': '2',
    'global-reach': '3',
    'see-beyond-answers': '4',
    'visual-lang-5': '5',
    'visual-lang-6': '6',
    'visual-lang-7': '7',
    'visual-lang-8': '8',
    'home-candidate-screening': '8',
    'home-cv-screening': '1',
    'home-voice-interview': '2',
    'home-video-interview': '3',
    'home-head-hunter': '4',
};

/** Same filename in public/images is cached by the browser — bump when you replace an image file. */
const IMAGE_CACHE_BUST = '15';
const publicImageSrc = (filename) => `/images/${filename}?v=${IMAGE_CACHE_BUST}`;

const Features = ({ showWhyChoose = true, excludeFeatureIds = [], variant = 'home' }) => {
    const { t } = useLanguage();
    const featuresRef = useRef(null);
    const features2Ref = useRef(null);
    
    // Function to wrap "evaalo" with span for English styling
    const wrapEvaalo = (text) => {
        if (!text) return text;
        return text.replace(/(evaalo)/gi, '<span class="evaalo-text-en">$1</span>');
    };
    
    useEffect(() => {
        // Apply evaalo styling to all section titles and links
        const elements = featuresRef.current?.querySelectorAll('.section-title, .nav-link');
        elements?.forEach(el => {
            // Only process if evaalo exists and is not already wrapped
            if (el.innerHTML && el.innerHTML.includes('evaalo') && !el.innerHTML.includes('evaalo-text-en')) {
                // Replace evaalo with wrapped version, avoiding already wrapped ones
                el.innerHTML = el.innerHTML.replace(/\bevaalo\b/gi, '<span class="evaalo-text-en">$&</span>');
            }
        });
    }, [t]);


    const demoVisualLanguageIcons = [
        { id: 'smart-integrations', img: 'icon9-removebg-preview.png', title: t('visualLang1Title'), desc: t('visualLang1Desc') },
        { id: 'multilingual-voice', img: 'icon10-removebg-preview.png', title: t('visualLang2Title'), desc: t('visualLang2Desc') },
        { id: 'global-reach', img: 'icon11-removebg-preview.png', title: t('visualLang3Title'), desc: t('visualLang3Desc') },
        { id: 'visual-lang-5', img: 'icon2-removebg-preview.png', title: t('visualLang5Title'), desc: t('visualLang5Desc') },
        { id: 'visual-lang-6', img: 'icon17-removebg-preview.png', title: t('visualLang6Title'), desc: t('visualLang6Desc') },
        { id: 'visual-lang-8', img: 'icon16-removebg-preview.png', title: t('visualLang8Title'), desc: t('visualLang8Desc') },
    ];

    const homeVisualLanguageIcons = [
        {
            id: 'home-candidate-screening',
            img: 'feature-candidate-screening.png',
            title: t('navProductAiCandidateScreening'),
            desc: t('homeFeatureCandidateScreeningDesc'),
            centerInGrid: 'top',
        },
        { id: 'home-cv-screening', img: '2.png', title: t('navProductAiScreening'), desc: t('homeFeatureCvScreeningDesc') },
        { id: 'home-voice-interview', img: 'feature-voice-interview.png', title: t('navProductAiVoiceInterview'), desc: t('homeFeatureVoiceInterviewDesc') },
        { id: 'home-video-interview', img: 'feature-video-interview.png', title: t('navProductAiVideoInterview'), desc: t('homeFeatureVideoInterviewDesc') },
        { id: 'home-head-hunter', img: '1PM.png', title: t('navProductAiHeadHunter'), desc: t('homeFeatureHeadHunterDesc') },
        {
            id: 'visual-lang-7',
            img: 'feature-candidate-comparison.png',
            title: t('visualLang7Title'),
            mobileTitle: t('visualLang7TitleMobile'),
            desc: t('visualLang7Desc'),
            centerInGrid: 'bottom',
        },
    ];

    const visualLanguageIcons = (variant === 'demo' ? demoVisualLanguageIcons : homeVisualLanguageIcons)
        .filter((icon) => !excludeFeatureIds.includes(icon.id));

    useEffect(() => {
        const cards = featuresRef.current?.querySelectorAll(
            '.simple-icon-wrapper--scroll-reveal, .features-hub-robot--scroll-reveal'
        );
        if (!cards?.length) return undefined;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            cards.forEach((card) => card.classList.add('is-revealed'));
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    entry.target.classList.toggle('is-revealed', entry.isIntersecting);
                });
            },
            { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
        );

        cards.forEach((card) => observer.observe(card));
        return () => observer.disconnect();
    }, [variant, visualLanguageIcons.length, t]);

    useEffect(() => {
        if (!showWhyChoose) return undefined;

        const cards = features2Ref.current?.querySelectorAll('.icon-card--why-reveal');
        if (!cards?.length) return undefined;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            cards.forEach((card) => card.classList.add('is-why-revealed'));
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    entry.target.classList.toggle('is-why-revealed', entry.isIntersecting);
                });
            },
            { threshold: 0.14, rootMargin: '0px 0px -5% 0px' }
        );

        cards.forEach((card) => observer.observe(card));
        return () => observer.disconnect();
    }, [showWhyChoose, t]);

    const whyChooseFeatures = [
        { img: 'icon3-removebg-preview.png', title: t('whyChoose1Title'), desc: t('whyChoose1Desc') },
        { img: 'icon1-removebg-preview2.png', title: t('whyChoose3Title'), desc: t('whyChoose3Desc') },
        { img: 'icon14-removebg-preview.png', title: t('whyChoose2Title'), desc: t('whyChoose2Desc') },
        { img: 'icon5-removebg-preview.png', title: t('whyChoose4Title'), desc: t('whyChoose4Desc') },
        { img: 'icon15-removebg-preview.png', title: t('whyChoose5Title'), desc: t('whyChoose5Desc') },
        { img: 'icon4-removebg-preview.png', title: t('whyChoose6Title'), desc: t('whyChoose6Desc') },
        { img: 'icon18-removebg-preview.png', title: t('whyChoose7Title'), subtitle: t('whyChoose7Subtitle'), desc: t('whyChoose7Desc') },
        { img: 'icon6-removebg-preview.png', title: t('whyChoose8Title'), subtitle: t('whyChoose8Subtitle'), desc: t('whyChoose8Desc') }
    ];

    const isCenteredGridIcon = (icon) =>
        icon.centerInGrid === true || icon.centerInGrid === 'top' || icon.centerInGrid === 'bottom';

    const hubIcons = variant !== 'demo'
        ? visualLanguageIcons.filter((icon) => !isCenteredGridIcon(icon))
        : [];
    const topCenteredIcons = variant !== 'demo'
        ? visualLanguageIcons.filter((icon) => icon.centerInGrid === 'top')
        : [];
    const bottomCenteredIcons = variant !== 'demo'
        ? visualLanguageIcons.filter((icon) => icon.centerInGrid === true || icon.centerInGrid === 'bottom')
        : [];

    const hubCorners = ['br', 'bl', 'tr', 'tl'];
    const hubArcPaths = {
        br: 'M 0 80 A 80 80 0 0 1 80 0',
        bl: 'M 80 0 A 80 80 0 0 1 160 80',
        tr: 'M 80 160 A 80 80 0 0 1 0 80',
        tl: 'M 160 80 A 80 80 0 0 1 80 160',
    };

    const renderFeatureCard = (icon, index) => {
        const revealFrom =
            icon.centerInGrid === 'top'
                ? 'hub-top'
                : icon.centerInGrid === 'bottom'
                  ? 'hub-bottom'
                  : isCenteredGridIcon(icon)
                    ? 'center'
                    : index % 2 === 0
                      ? 'left'
                      : 'right';
        const scrollRevealClass = ` simple-icon-wrapper--scroll-reveal simple-icon-wrapper--from-${revealFrom}`;
        const hubCorner = variant !== 'demo' && !isCenteredGridIcon(icon) ? hubCorners[index] : undefined;
        const featureColor = FEATURE_CARD_COLOR[icon.id];

        const iconOnEnd =
            variant !== 'demo' &&
            (icon.centerInGrid === 'top' ||
                (!isCenteredGridIcon(icon) &&
                    (icon.id === 'home-cv-screening' || icon.id === 'home-video-interview')));

        return (
            <div
                key={icon.id}
                className={`simple-icon-wrapper${isCenteredGridIcon(icon) ? ' simple-icon-wrapper--grid-centered' : ''}${icon.centerInGrid === 'top' ? ' simple-icon-wrapper--grid-centered-top' : ''}${icon.centerInGrid === 'bottom' ? ' simple-icon-wrapper--grid-centered-bottom' : ''}${iconOnEnd ? ' simple-icon-wrapper--icon-end' : ''}${scrollRevealClass}`}
                data-hub-corner={hubCorner}
                data-feature-color={featureColor}
                style={{ '--reveal-delay': `${index * 0.1}s` }}
            >
                {hubCorner ? (
                    <span className={`hub-card__arc hub-card__arc--${hubCorner}`} aria-hidden="true">
                        <svg viewBox="0 0 160 160" preserveAspectRatio="xMidYMid meet">
                            <path
                                d={hubArcPaths[hubCorner]}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            />
                        </svg>
                    </span>
                ) : null}
                <div className="icon-wrapper-inner">
                    <img src={publicImageSrc(icon.img)} alt={icon.title} className="simple-icon" />
                </div>
                <div className="icon-text-content">
                    {icon.mobileTitle ? (
                        <>
                            <h3
                                className="icon-label icon-label--desktop-only"
                                dangerouslySetInnerHTML={{ __html: wrapEvaalo(icon.title) }}
                            />
                            <h3
                                className="icon-label icon-label--mobile-only"
                                dangerouslySetInnerHTML={{ __html: wrapEvaalo(icon.mobileTitle) }}
                            />
                        </>
                    ) : (
                        <h3
                            className="icon-label"
                            dangerouslySetInnerHTML={{ __html: wrapEvaalo(icon.title) }}
                        />
                    )}
                    {variant === 'demo' && icon.desc ? (
                        <p className="icon-description">{icon.desc}</p>
                    ) : null}
                </div>
            </div>
        );
    };

    return (
        <>
            <section
                className={`features${variant === 'demo' ? ' features--demo' : ''}`}
                id="features"
                ref={featuresRef}
            >
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">{t('features')}</h2>
                        {/* Home only — the demo page runs this section on a dark
                            background, where .section-description is forced dark. */}
                        {variant !== 'demo' ? (
                            <p className="section-description">
                                {t('featuresSubtitle')}
                            </p>
                        ) : null}
                    </div>
                    <div className={`icon-highlights-grid${variant !== 'demo' ? ' icon-highlights-grid--hub' : ''}`}>
                        {variant === 'demo' ? (
                            visualLanguageIcons.map((icon, index) => renderFeatureCard(icon, index))
                        ) : (
                            <>
                                {topCenteredIcons.map((icon, index) => renderFeatureCard(icon, index))}
                                <div className="features-hub-core">
                                    {hubIcons.map((icon, index) => renderFeatureCard(icon, index))}
                                    <div
                                        className="features-hub-robot features-hub-robot--scroll-reveal"
                                        style={{ '--reveal-delay': '0.2s' }}
                                        aria-hidden="true"
                                    >
                                        <div className="features-hub-robot__flip">
                                            <div className="features-hub-robot__circle features-hub-robot__circle--front">
                                                <img
                                                    src={publicImageSrc('icon16-removebg-preview.png')}
                                                    alt=""
                                                    className="features-hub-robot__icon"
                                                />
                                            </div>
                                            <div className="features-hub-robot__circle features-hub-robot__circle--back">
                                                <img
                                                    src={publicImageSrc('icon16-removebg-preview.png')}
                                                    alt=""
                                                    className="features-hub-robot__icon"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {bottomCenteredIcons.map((icon, index) =>
                                    renderFeatureCard(icon, hubIcons.length + index)
                                )}
                            </>
                        )}
                    </div>
                </div>
            </section>

            {showWhyChoose ? (
            <section className="features" id="features-2" ref={features2Ref}>
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">{t('whyChooseTitle')}</h2>
                        <p className="section-description">
                            {t('whyChooseDescription')}
                        </p>
                    </div>
                    <div className="icon-highlights-grid">
                        {whyChooseFeatures.map((feature, index) => {
                            const revealVariant = index % 2 === 0 ? 'left' : 'right';
                            return (
                            <div 
                                key={index} 
                                className={`icon-card icon-card--why-reveal icon-card--why-from-${revealVariant}`}
                                style={{ '--why-reveal-delay': `${(index % 4) * 0.14}s` }}
                            >
                                <div className="icon-card-graphic">
                                    <img src={publicImageSrc(feature.img)} alt={feature.title || `Icon ${index + 1}`} className="icon-card-image" />
                                </div>
                                <div className="icon-card-body">
                                    <h3 className="icon-card-title">{feature.title}</h3>
                                    {feature.subtitle && (
                                        <p 
                                            className="icon-card-subtitle" 
                                            style={{
                                                fontSize: '14px',
                                                fontWeight: 600,
                                                color: '#22d3ee',
                                                marginTop: '4px',
                                                marginBottom: '8px'
                                            }}
                                        >
                                            {feature.subtitle}
                                        </p>
                                    )}
                                    <p className="icon-card-text">
                                        {feature.desc}
                                    </p>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>
            </section>
            ) : null}
        </>
    );
};

export default Features;
