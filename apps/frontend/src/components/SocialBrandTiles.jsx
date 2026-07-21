import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { brandRgba } from '../utils/brandColor';
import { CONTACT_EMAIL, getContactWhatsAppUrl } from '../constants/contact';

const SOCIAL_DEFAULTS = {
    facebook: 'https://www.facebook.com/share/1BVLXtPvji/?mibextid=wwXIfr',
    instagram: 'https://www.instagram.com/evaalo.ai/',
    linkedin: 'https://www.linkedin.com/company/evaalo/',
    tiktok: 'https://www.tiktok.com/',
};

const SOCIAL_TILE_ACCENTS = {
    facebook: '#1877F2',
    instagram: '#E4405F',
    linkedin: '#0A66C2',
    whatsapp: '#25D366',
    tiktok: '#FE2C55',
};

const EMAIL_TILE_ACCENT = '#2563EB';

const EMAIL_ICON = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" strokeLinejoin="round" />
    </svg>
);

const SOCIAL_NETWORKS = [
    {
        id: 'facebook',
        accent: SOCIAL_TILE_ACCENTS.facebook,
        labelKey: 'socialFacebook',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
            </svg>
        ),
    },
    {
        id: 'instagram',
        accent: SOCIAL_TILE_ACCENTS.instagram,
        labelKey: 'socialInstagram',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
            </svg>
        ),
    },
    {
        id: 'linkedin',
        accent: SOCIAL_TILE_ACCENTS.linkedin,
        labelKey: 'socialLinkedIn',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
        ),
    },
    {
        id: 'whatsapp',
        accent: SOCIAL_TILE_ACCENTS.whatsapp,
        labelKey: 'socialWhatsapp',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
        ),
    },
    {
        id: 'tiktok',
        accent: SOCIAL_TILE_ACCENTS.tiktok,
        labelKey: 'socialTiktok',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
            </svg>
        ),
    },
];

const MESSENGER_NETWORK = {
    id: 'messenger',
    accent: '#0084FF',
    labelKey: 'socialMessenger',
    icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.13 2 11.12c0 2.87 1.44 5.43 3.7 7.11V22l3.4-1.87c.9.25 1.86.39 2.9.39 5.52 0 10-4.13 10-9.12S17.52 2 12 2zm1 11.17l-2.55-2.72-4.99 2.72 5.49-5.82 2.61 2.72 4.92-2.72-5.48 5.82z" />
        </svg>
    ),
};

function socialBrandTileStyle(accentHex, variant = 'dark') {
    if (variant === 'light') {
        return {
            '--footer-tile-a26': brandRgba(accentHex, 0.92),
            '--footer-tile-a08': brandRgba(accentHex, 0.72),
            '--footer-tile-border': brandRgba(accentHex, 1),
            '--footer-tile-shadow': brandRgba(accentHex, 0.38),
            '--footer-tile-shadow-hover': brandRgba(accentHex, 0.58),
            '--footer-tile-solid': accentHex,
        };
    }

    return {
        '--footer-tile-a26': brandRgba(accentHex, 0.26),
        '--footer-tile-a08': brandRgba(accentHex, 0.08),
        '--footer-tile-border': brandRgba(accentHex, 0.5),
        '--footer-tile-shadow': brandRgba(accentHex, 0.22),
        '--footer-tile-shadow-hover': brandRgba(accentHex, 0.38),
    };
}

export default function SocialBrandTiles({
    className = 'footer-social',
    variant = 'dark',
    includeEmail = false,
    email = CONTACT_EMAIL,
    networkIds = null,
    decorative = false,
}) {
    const { t } = useLanguage();

    const socialUrls = useMemo(
        () => ({
            facebook: import.meta.env.VITE_SOCIAL_FACEBOOK_URL || SOCIAL_DEFAULTS.facebook,
            instagram: import.meta.env.VITE_SOCIAL_INSTAGRAM_URL || SOCIAL_DEFAULTS.instagram,
            linkedin:
                import.meta.env.VITE_SOCIAL_LINKEDIN_URL ||
                import.meta.env.VITE_SOCIAL_TWITTER_URL ||
                SOCIAL_DEFAULTS.linkedin,
            tiktok: import.meta.env.VITE_SOCIAL_TIKTOK_URL || SOCIAL_DEFAULTS.tiktok,
            whatsapp: getContactWhatsAppUrl(),
            messenger: import.meta.env.VITE_SOCIAL_MESSENGER_URL || 'https://www.messenger.com/',
        }),
        []
    );

    const networks = useMemo(() => {
        const catalog = [...SOCIAL_NETWORKS, MESSENGER_NETWORK];
        if (!networkIds?.length) return SOCIAL_NETWORKS;
        const allowed = new Set(networkIds);
        return catalog.filter((network) => allowed.has(network.id));
    }, [networkIds]);

    const navClass = [className, variant === 'light' ? 'footer-social--light' : '']
        .filter(Boolean)
        .join(' ');

    const tileClassName = decorative
        ? 'footer-social-brand-tile footer-social-brand-tile--decorative'
        : 'footer-social-brand-tile';

    const tiles = networks.map((network) => {
        const style = socialBrandTileStyle(network.accent, variant);
        const content = network.icon;

        if (decorative) {
            return (
                <span
                    key={network.id}
                    className={tileClassName}
                    data-footer-brand-tile="true"
                    data-social={network.id}
                    style={style}
                    aria-hidden="true"
                >
                    {content}
                </span>
            );
        }

        return (
            <a
                key={network.id}
                href={socialUrls[network.id]}
                className={tileClassName}
                data-footer-brand-tile="true"
                data-social={network.id}
                style={style}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t(network.labelKey)}
            >
                {content}
            </a>
        );
    });

    if (decorative) {
        return <span className={navClass}>{tiles}</span>;
    }

    return (
        <nav className={navClass} aria-label={includeEmail ? t('contact') : t('followUs')}>
            {includeEmail ? (
                <a
                    href={`mailto:${email}`}
                    className="footer-social-brand-tile"
                    data-footer-brand-tile="true"
                    data-social="email"
                    style={socialBrandTileStyle(EMAIL_TILE_ACCENT, variant)}
                    aria-label={`${t('contactPageEmailPrompt')} ${email}`}
                >
                    {EMAIL_ICON}
                </a>
            ) : null}
            {tiles}
        </nav>
    );
}
