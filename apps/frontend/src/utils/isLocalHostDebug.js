/**
 * Local-only UI (e.g. video interview transcript panel for QA).
 * Hidden on production hosts (evaalo.com, etc.).
 */
export function isLocalHostDebug() {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
