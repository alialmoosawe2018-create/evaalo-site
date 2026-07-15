import React from 'react';
import PhoneCallOutlineIcon from './PhoneCallOutlineIcon.jsx';

/** أيقونات خطية لشاشة Campaign Ready (Heroicons-style) */
export function CampaignReadyIcon({ type, color, size = 26 }) {
    const p = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        style: { display: 'block', flexShrink: 0 },
    };
    const s = { stroke: color, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (type === 'rocket') {
        return (
            <svg {...p} aria-hidden>
                <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" {...s} />
            </svg>
        );
    }
    if (type === 'video') {
        return (
            <svg {...p} aria-hidden>
                <path
                    d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                    {...s}
                />
            </svg>
        );
    }
    if (type === 'mic') {
        return (
            <svg {...p} aria-hidden>
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" {...s} />
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" {...s} />
            </svg>
        );
    }
    /** مكالمة صوتية — سماعة + موجات (نفس أيقونة Stage 2 في لوحة التحكم) */
    if (type === 'phone') {
        return <PhoneCallOutlineIcon color={color} size={size} strokeWidth={1.75} />;
    }
    if (type === 'form') {
        return (
            <svg
                width={size}
                height={size}
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
                style={{ display: 'block', flexShrink: 0 }}
            >
                <rect x="12" y="8" width="40" height="48" rx="2" stroke={color} strokeWidth="3.5" fill="none" strokeLinejoin="round" />
                <line x1="20" y1="20" x2="44" y2="20" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="28" x2="44" y2="28" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="36" x2="36" y2="36" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
                <line x1="20" y1="44" x2="40" y2="44" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
            </svg>
        );
    }
    return null;
}
