import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import SocialBrandTiles from './SocialBrandTiles';

/** Feature bullets — sky/cyan accent (aligned with Hero / Dashboard / Process). */
const IconSpark = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
);

const IconBolt = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path
            d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
        />
    </svg>
);

const IconGlobe = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
            d="M2 12h20M12 2a14 14 0 0 0 0 20 14 14 0 0 0 0-20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        />
    </svg>
);

const IconSliders = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M4 15h16M10 9h14M8 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="7" cy="15" r="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="17" cy="9" r="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="13" cy="21" r="2" stroke="currentColor" strokeWidth="2" />
    </svg>
);

const IconLink = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path
            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

const IconMedia = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="2" y="6" width="12" height="9" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
        <path
            d="M2 13.5l3.2-2.6 2.3 1.8 2.1-2 3.4 2.8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <circle cx="6.5" cy="9.5" r="1.25" stroke="currentColor" strokeWidth="1.75" />
        <rect x="16" y="8" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
        <path d="M13.5 14h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
);

/** Use cases — one fixed icon for every scenario row (briefcase / business agent) */
const IconUseCase = () => (
    <svg className="avatar-showcase__feat-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
        <path
            d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path d="M3 13h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const UseCaseFeatIcon = () => (
    <span className="avatar-showcase__feat-icon avatar-showcase__feat-icon--use-case">
        <IconUseCase />
    </span>
);

/** Primary CTA — video / demo (camera + record triangle). */
const IconVideo = () => (
    <svg className="avatar-showcase__cta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="2" y="6" width="14" height="12" rx="2" ry="2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path
            d="m22 8-6 4 6 4V8Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

/** Primary CTA — voice / audio demo placeholder (wire LiveKit/agent later). */
const IconMic = () => (
    <svg className="avatar-showcase__cta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/** Primary CTA — text / chat style (message lines in bubble). */
const IconTextChat = () => (
    <svg className="avatar-showcase__cta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
        />
        <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const FEATURE_ROW_ICONS = [<IconSpark />, <IconBolt />, <IconGlobe />, <IconSliders />, <IconMedia />, <IconLink />];

/** Voice / video showcase use cases (shared labels) */
const VOICE_USE_CASE_KEYS = [1, 2, 3, 4, 5, 6].map((i) => `avatarShowcaseVoiceUseCase${i}`);

/** Chat showcase use cases: chat-specific items + shared voice-style labels */
const CHAT_USE_CASE_KEYS = [
    'avatarShowcaseChatUseCase1',
    'avatarShowcaseChatUseCase3',
    'avatarShowcaseChatUseCase4',
    'avatarShowcaseVoiceUseCase2',
    'avatarShowcaseVoiceUseCase3',
    'avatarShowcaseVoiceUseCase4',
    'avatarShowcaseVoiceUseCase5',
    'avatarShowcaseVoiceUseCase6',
];

/**
 * @param {{
 *   sectionId?: string;
 *   ctaIcon?: 'video' | 'audio' | 'text';
 *   onTryDemo?: () => void;
 *   tryDemoTo?: string | null;
 *     — string: مسار التوجيه للزر الأساسي؛ null: زر معطّل (محجوز لميزة لاحقة، لا تنقل).
 *   copyVariant?: 'default' | 'voice' | 'chat';
 * }} props
 */
const AvatarShowcase = ({
    sectionId = 'avatar-showcase',
    ctaIcon = 'video',
    onTryDemo,
    tryDemoTo = '/overview/live',
    copyVariant = 'default',
}) => {
    const { t } = useLanguage();
    const ref = useRef(null);

    const titleKey =
        copyVariant === 'voice'
            ? 'avatarShowcaseVoiceTitle'
            : copyVariant === 'chat'
              ? 'avatarShowcaseChatTitle'
              : 'avatarShowcaseTitle';
    const descKey =
        copyVariant === 'voice'
            ? 'avatarShowcaseVoiceDesc'
            : copyVariant === 'chat'
              ? 'avatarShowcaseChatDesc'
              : 'avatarShowcaseDesc';
    const feature4Key = copyVariant === 'voice' ? 'avatarShowcaseVoiceFeature4' : 'avatarShowcaseFeature4';
    const feature1Key = copyVariant === 'voice' ? 'avatarShowcaseVoiceFeature1' : 'avatarShowcaseFeature1';
    const partnerLabelKey =
        copyVariant === 'voice'
            ? 'avatarShowcaseVoicePartnerLabel'
            : copyVariant === 'chat'
              ? 'avatarShowcaseChatPartnerLabel'
              : 'avatarShowcasePartnerLabel';

    const isChat = copyVariant === 'chat';
    const isVoice = copyVariant === 'voice';

    useEffect(() => {
        const el = ref.current?.querySelector('.section-title');
        if (el?.innerHTML?.includes('evaalo') && !el.innerHTML.includes('evaalo-text-en')) {
            el.innerHTML = el.innerHTML.replace(/\bevaalo\b/gi, '<span class="evaalo-text-en">$&</span>');
        }
    }, [t, copyVariant, titleKey]);

    const tryDemoIcon =
        ctaIcon === 'audio' ? <IconMic /> : ctaIcon === 'text' ? <IconTextChat /> : <IconVideo />;
    const tryDemoLabel = (
        <>
            {tryDemoIcon}
            <span>{t('avatarShowcaseTryDemo')}</span>
        </>
    );

    return (
        <section className="avatar-showcase" id={sectionId} ref={ref}>
            <div className="avatar-showcase__bg-glow avatar-showcase__bg-glow--a" aria-hidden />
            <div className="avatar-showcase__bg-glow avatar-showcase__bg-glow--b" aria-hidden />

            <div className="container avatar-showcase__container avatar-showcase__container--no-visual">
                <div className="avatar-showcase__copy">
                    <h2 className="section-title avatar-showcase__title">{t(titleKey)}</h2>
                    <p className="avatar-showcase__desc">{t(descKey)}</p>

                    <div className="avatar-showcase__cta">
                        <Link to="/contact" className="avatar-showcase__btn avatar-showcase__btn--ghost">
                            {t('avatarShowcaseViewPricing')}
                        </Link>
                        {typeof onTryDemo === 'function' ? (
                            <button
                                type="button"
                                className="avatar-showcase__btn avatar-showcase__btn--primary"
                                onClick={onTryDemo}
                            >
                                {tryDemoLabel}
                            </button>
                        ) : tryDemoTo === null ? (
                            <button
                                type="button"
                                className="avatar-showcase__btn avatar-showcase__btn--primary"
                                disabled
                                aria-disabled="true"
                            >
                                {tryDemoLabel}
                            </button>
                        ) : (
                            <Link to={tryDemoTo} className="avatar-showcase__btn avatar-showcase__btn--primary">
                                {tryDemoLabel}
                            </Link>
                        )}
                    </div>

                    {isVoice ? (
                        <>
                            <ul className="avatar-showcase__features avatar-showcase__features--chat-block avatar-showcase__features--primary">
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconSpark /></span>
                                    <span>{t(feature1Key)}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconBolt /></span>
                                    <span>{t('avatarShowcaseFeature2')}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconGlobe /></span>
                                    <span>{t('avatarShowcaseFeature3')}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconSliders /></span>
                                    <span>{t(feature4Key)}</span>
                                </li>
                            </ul>
                            <h3 className="avatar-showcase__group-heading">{t('avatarShowcaseChatUseCasesHeading')}</h3>
                            <ul className="avatar-showcase__features avatar-showcase__features--chat-block avatar-showcase__features--use-cases">
                                {VOICE_USE_CASE_KEYS.map((key) => (
                                    <li key={`voice-use-${key}`}>
                                        <UseCaseFeatIcon />
                                        <span>{t(key)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}

                    {isChat ? (
                        <>
                            <ul className="avatar-showcase__features avatar-showcase__features--chat-block avatar-showcase__features--primary">
                                {[1, 2, 3, 4, 5, 6].map((i) => (
                                    <li key={`chat-feat-${i}`}>
                                        <span className="avatar-showcase__feat-icon">{FEATURE_ROW_ICONS[i - 1]}</span>
                                        {i === 6 ? (
                                            <span className="avatar-showcase__feat-copy avatar-showcase__feat-copy--platforms">
                                                <span className="avatar-showcase__feat-label">
                                                    {t(`avatarShowcaseChatFeature${i}`)}
                                                </span>
                                                <SocialBrandTiles
                                                    className="avatar-showcase__platform-icons footer-social"
                                                    networkIds={['whatsapp', 'instagram', 'tiktok', 'messenger']}
                                                    decorative
                                                />
                                            </span>
                                        ) : (
                                            <span>{t(`avatarShowcaseChatFeature${i}`)}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <h3 className="avatar-showcase__group-heading">{t('avatarShowcaseChatUseCasesHeading')}</h3>
                            <ul className="avatar-showcase__features avatar-showcase__features--chat-block avatar-showcase__features--use-cases">
                                {CHAT_USE_CASE_KEYS.map((key) => (
                                    <li key={key}>
                                        <UseCaseFeatIcon />
                                        <span>{t(key)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}

                    {!isChat && !isVoice ? (
                        <>
                            <ul className="avatar-showcase__features avatar-showcase__features--primary">
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconSpark /></span>
                                    <span>{t('avatarShowcaseFeature1')}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconBolt /></span>
                                    <span>{t('avatarShowcaseFeature2')}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconGlobe /></span>
                                    <span>{t('avatarShowcaseFeature3')}</span>
                                </li>
                                <li>
                                    <span className="avatar-showcase__feat-icon"><IconSliders /></span>
                                    <span>{t(feature4Key)}</span>
                                </li>
                            </ul>
                            <h3 className="avatar-showcase__group-heading">{t('avatarShowcaseChatUseCasesHeading')}</h3>
                            <ul className="avatar-showcase__features avatar-showcase__features--chat-block avatar-showcase__features--use-cases">
                                {VOICE_USE_CASE_KEYS.map((key) => (
                                    <li key={`default-use-${key}`}>
                                        <UseCaseFeatIcon />
                                        <span>{t(key)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}

                    <div
                        className="avatar-showcase__partner"
                        aria-label={`${t('avatarShowcasePartnerName')} — ${t(partnerLabelKey)}`}
                    >
                        <span className="avatar-showcase__partner-name">{t('avatarShowcasePartnerName')}</span>
                        <span className="avatar-showcase__partner-sep" aria-hidden>
                            —
                        </span>
                        <span className="avatar-showcase__partner-tag">{t(partnerLabelKey)}</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default AvatarShowcase;
