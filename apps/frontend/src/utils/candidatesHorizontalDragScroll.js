const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, [role="link"], label';

function isInteractiveTarget(target) {
    return target?.closest?.(INTERACTIVE_SELECTOR);
}

/**
 * Horizontal drag / finger-pan for wide scroll containers (tables, ledgers).
 * Uses Pointer Events so the same handler works for mouse and touch on mobile.
 */
export function onHorizontalDragScrollPointerDown(e) {
    if (isInteractiveTarget(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const container = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const startScroll = container.scrollLeft;
    let dragging = false;
    const thresholdPx = 6;

    const cleanup = () => {
        container.classList.remove('h-scroll-pan--dragging');
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerup', onEnd);
        container.removeEventListener('pointercancel', onEnd);
    };

    const onMove = (ev) => {
        if (ev.pointerId !== e.pointerId) return;

        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!dragging) {
            if (Math.abs(dx) < thresholdPx && Math.abs(dy) < thresholdPx) return;
            if (Math.abs(dy) > Math.abs(dx)) {
                cleanup();
                return;
            }
            dragging = true;
            container.classList.add('h-scroll-pan--dragging');
            try {
                container.setPointerCapture(ev.pointerId);
            } catch {
                /* ignore */
            }
        }

        ev.preventDefault();
        container.scrollLeft = startScroll - dx;
    };

    const onEnd = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        try {
            container.releasePointerCapture(ev.pointerId);
        } catch {
            /* ignore */
        }
        cleanup();
    };

    container.addEventListener('pointermove', onMove, { passive: false });
    container.addEventListener('pointerup', onEnd);
    container.addEventListener('pointercancel', onEnd);
}

/** @deprecated Use onHorizontalDragScrollPointerDown with onPointerDown */
export const onCandidatesTableHorizontalDragMouseDown = onHorizontalDragScrollPointerDown;
