import { useLayoutEffect } from 'react';

/**
 * Keep a <textarea> exactly as tall as its content, so it never grows its own
 * scrollbar inside a container that already scrolls.
 *
 * Why it exists: the New Interview modal scrolls as one layer, but a textarea
 * has a fixed height, so a long job description or job ad produced a second
 * scrollbar nested inside the first — and with overscroll-behavior: none on the
 * modal scroller, reaching the inner end did not chain out to the page.
 *
 * `value` is the dependency, not an onChange handler, so programmatic writes
 * resize the box too: accepting the AI rewrite, generating the ad, translating it.
 *
 * Height is set, never min-height, so the CSS min-height still acts as the floor
 * for an empty box.
 */
export function useAutoGrowTextarea(ref, value, enabled = true) {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return undefined;

        const fit = () => {
            // Reset first: scrollHeight never reports less than the current
            // height, so without this the box grows and never shrinks again.
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
        };

        fit();
        // A width change rewraps the text, which changes the height.
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, [ref, value, enabled]);
}
