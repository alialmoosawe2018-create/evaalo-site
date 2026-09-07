import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { shouldShowAppBottomNav } from '../utils/appRoutes';
import './app-version-watcher.css';

/**
 * ينبّه على وجود نسخة أحدث من التطبيق.
 *
 * ترويسات الإنتاج سليمة أصلاً — Cloudflare Pages يعطي `index.html` قيمة
 * `max-age=0, must-revalidate` و `assets/*` قيمة سنة كاملة، وهو الضبط الصحيح.
 * الثغرة ليست في التخزين بل في **التبويب المفتوح**: تطبيق أحادي الصفحة يطلب
 * `index.html` مرّةً واحدة عند الإقلاع ثم لا يعود إليه أبداً، فيبقى يشغّل حزمة
 * الجافاسكربت القديمة ساعاتٍ بعد النشر مهما كانت الترويسة. لا ترويسة تُصلح هذا؛
 * يحتاج سؤالاً من داخل التطبيق.
 *
 * فيسأل هنا عند عودة التركيز إلى التبويب — اللحظة التي يرجع فيها المستخدم بعد
 * غياب، وهي بالضبط متى يُرجَّح أن يكون النشر قد حدث — لا بمؤقّت يدقّ في الخلفية.
 */

/** اسم حزمة الإقلاع كما بناها Vite، يُقرأ مرّةً من وسم السكربت في الصفحة. */
const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

function readLoadedBundle() {
    if (typeof document === 'undefined') return null;
    const tag = document.querySelector('script[type="module"][src*="/assets/index-"]');
    const src = tag?.getAttribute('src') || '';
    return BUNDLE_RE.exec(src)?.[0] ?? null;
}

/** لا تسأل أكثر من مرّة كلّ خمس دقائق مهما تكرّر تبديل التبويبات. */
const MIN_CHECK_GAP_MS = 5 * 60 * 1000;

export default function AppVersionWatcher() {
    const { t } = useLanguage();
    const location = useLocation();
    const loadedBundleRef = useRef(readLoadedBundle());
    const lastCheckRef = useRef(0);
    const inFlightRef = useRef(false);
    const [freshBundle, setFreshBundle] = useState(null);
    const [dismissed, setDismissed] = useState(null);

    const check = useCallback(async () => {
        const loaded = loadedBundleRef.current;
        // في التطوير لا يوجد وسم حزمة أصلاً (Vite يخدم /src/main.jsx)، فلا شيء يُقارَن.
        if (!loaded || inFlightRef.current) return;
        const now = Date.now();
        if (now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
        lastCheckRef.current = now;
        inFlightRef.current = true;
        try {
            const res = await fetch(`/index.html?_v=${now}`, {
                cache: 'no-store',
                credentials: 'same-origin',
            });
            if (!res.ok) return;
            const html = await res.text();
            const next = BUNDLE_RE.exec(html)?.[0];
            if (next && next !== loaded) setFreshBundle(next);
        } catch {
            // شبكة متقطّعة أو صفحة خطأ من الوسيط: الصمت هو التصرّف الصحيح —
            // هذا فحص مساعد، وإزعاج المستخدم بفشله أسوأ من عدم الفحص.
        } finally {
            inFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') check();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [check]);

    if (!freshBundle || dismissed === freshBundle) return null;

    // نفس المُحدِّد الذي يقرّر إظهار شريط التنقّل السفلي يقرّر رفع هذا فوقه، فلا
    // تنشأ قائمة مسارات ثانية تنحرف عن الأولى.
    const aboveBottomNav = shouldShowAppBottomNav(location.pathname);

    return (
        <div
            className={`app-version-banner${aboveBottomNav ? ' app-version-banner--above-bottom-nav' : ''}`}
            role="status"
            aria-live="polite"
        >
            <span className="app-version-banner__text">{t('appUpdateAvailable')}</span>
            <button
                type="button"
                className="app-version-banner__reload"
                onClick={() => window.location.reload()}
            >
                {t('appUpdateReload')}
            </button>
            <button
                type="button"
                className="app-version-banner__close"
                aria-label={t('appUpdateDismiss')}
                title={t('appUpdateDismiss')}
                onClick={() => setDismissed(freshBundle)}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
        </div>
    );
}
