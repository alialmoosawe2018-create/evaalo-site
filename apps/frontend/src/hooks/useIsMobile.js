import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT_PX = 768;

export function useIsMobile(breakpointPx = MOBILE_BREAKPOINT_PX) {
    const query = `(max-width: ${breakpointPx}px)`;

    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia(query).matches;
    });

    useEffect(() => {
        const mq = window.matchMedia(query);
        const sync = () => setIsMobile(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, [query]);

    return isMobile;
}
