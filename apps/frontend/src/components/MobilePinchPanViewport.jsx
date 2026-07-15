import React, { useCallback, useEffect, useRef, useState } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';
const MIN_SCALE = 1;
const MAX_SCALE = 2.75;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function touchDistance(touches) {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function touchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
    };
}

/**
 * Mobile-only pinch-to-zoom + drag pan for data-heavy dashboard pages.
 * On desktop/tablet (>768px) renders children unchanged.
 */
export default function MobilePinchPanViewport({ children, className = '' }) {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
    );
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const gestureRef = useRef(null);
    const transformRef = useRef({ scale: 1, x: 0, y: 0, originX: '50%', originY: '0%' });

    const applyTransform = useCallback(() => {
        const content = contentRef.current;
        const viewport = viewportRef.current;
        if (!content) return;

        const { scale, x, y, originX, originY } = transformRef.current;
        content.style.transformOrigin = `${originX} ${originY}`;
        content.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        viewport?.classList.toggle('mobile-pinch-pan-viewport--zoomed', scale > 1.02);
    }, []);

    const resetTransform = useCallback(() => {
        transformRef.current = { scale: 1, x: 0, y: 0, originX: '50%', originY: '0%' };
        gestureRef.current = null;
        applyTransform();
        viewportRef.current?.classList.remove(
            'mobile-pinch-pan-viewport--pinching',
            'mobile-pinch-pan-viewport--panning'
        );
    }, [applyTransform]);

    useEffect(() => {
        const mq = window.matchMedia(MOBILE_QUERY);
        const onChange = () => {
            setIsMobile(mq.matches);
            if (!mq.matches) resetTransform();
        };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [resetTransform]);

    useEffect(() => {
        if (!isMobile) return undefined;

        const viewport = viewportRef.current;
        const content = contentRef.current;
        if (!viewport || !content) return undefined;

        const onTouchStart = (e) => {
            if (e.touches.length === 2) {
                const center = touchCenter(e.touches);
                const rect = content.getBoundingClientRect();
                const originX = center.x - rect.left;
                const originY = center.y - rect.top;

                transformRef.current.originX = `${originX}px`;
                transformRef.current.originY = `${originY}px`;

                gestureRef.current = {
                    type: 'pinch',
                    startDistance: touchDistance(e.touches),
                    startScale: transformRef.current.scale,
                    startX: transformRef.current.x,
                    startY: transformRef.current.y,
                    startCenter: center,
                };
                viewport.classList.add('mobile-pinch-pan-viewport--pinching');
                viewport.classList.remove('mobile-pinch-pan-viewport--panning');
                return;
            }

            if (e.touches.length === 1 && transformRef.current.scale > 1.02) {
                gestureRef.current = {
                    type: 'pan',
                    startX: e.touches[0].clientX,
                    startY: e.touches[0].clientY,
                    baseX: transformRef.current.x,
                    baseY: transformRef.current.y,
                };
                viewport.classList.add('mobile-pinch-pan-viewport--panning');
            }
        };

        const onTouchMove = (e) => {
            const gesture = gestureRef.current;
            if (!gesture) return;

            if (gesture.type === 'pinch' && e.touches.length === 2) {
                e.preventDefault();
                const nextScale = clamp(
                    gesture.startScale * (touchDistance(e.touches) / gesture.startDistance),
                    MIN_SCALE,
                    MAX_SCALE
                );
                const center = touchCenter(e.touches);
                transformRef.current.scale = nextScale;
                transformRef.current.x = gesture.startX + (center.x - gesture.startCenter.x);
                transformRef.current.y = gesture.startY + (center.y - gesture.startCenter.y);
                applyTransform();
                return;
            }

            if (gesture.type === 'pan' && e.touches.length === 1) {
                e.preventDefault();
                transformRef.current.x = gesture.baseX + (e.touches[0].clientX - gesture.startX);
                transformRef.current.y = gesture.baseY + (e.touches[0].clientY - gesture.startY);
                applyTransform();
            }
        };

        const onTouchEnd = (e) => {
            if (e.touches.length === 0) {
                gestureRef.current = null;
                viewport.classList.remove(
                    'mobile-pinch-pan-viewport--pinching',
                    'mobile-pinch-pan-viewport--panning'
                );
                if (transformRef.current.scale < 1.02) {
                    resetTransform();
                }
                return;
            }

            if (e.touches.length === 1 && gestureRef.current?.type === 'pinch') {
                gestureRef.current = null;
                viewport.classList.remove('mobile-pinch-pan-viewport--pinching');
            }
        };

        viewport.addEventListener('touchstart', onTouchStart, { passive: true });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        viewport.addEventListener('touchcancel', onTouchEnd);

        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
            viewport.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [isMobile, applyTransform, resetTransform]);

    if (!isMobile) {
        return children;
    }

    return (
        <div
            ref={viewportRef}
            className={`mobile-pinch-pan-viewport${className ? ` ${className}` : ''}`}
        >
            <div ref={contentRef} className="mobile-pinch-pan-viewport__content">
                {children}
            </div>
        </div>
    );
}
