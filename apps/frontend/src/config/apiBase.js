/**
 * عنوان خادم الـ API للفرونتند.
 * للاختبار من الدومين: أنشئ apps/frontend/.env وحدد:
 *   VITE_API_BASE_URL=https://api.دومينك.com
 * (بدون شرطة أخيرة)
 */
/** Set at build time in index.html — survives stale JS cache when index.html updates first. */
const runtimeBase =
    typeof window !== 'undefined' && window.__EVAALO_API_BASE__
        ? window.__EVAALO_API_BASE__
        : '';

const raw =
    runtimeBase ||
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    'https://api.evaalo.com';

export const API_BASE_URL = String(raw).replace(/\/$/, '');

/**
 * رابط مطلق لصفحة في نفس تطبيق الفرونت (مشاركة، روابط عميقة).
 * يحترم import.meta.env.BASE_URL عند النشر تحت مسار فرعي.
 */
export function absoluteAppUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base === '/' ? '' : String(base).replace(/\/$/, '');
    if (typeof window === 'undefined') return `${prefix}${p}`;
    return `${window.location.origin}${prefix}${p}`;
}
