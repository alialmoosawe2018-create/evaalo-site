import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import './workspace-language.css';

/**
 * زرّ اللغة داخل مساحة العمل — مكوّن قائم بذاته.
 *
 * لماذا مكوّن منفصل بأصنافه الخاصّة بدل توسعة `.nav-link-dropdown`؟ لأنّ أنماط
 * شريط الموقع التسويقي متشابكة عبر عشرات القواعد المرتبطة بـ `.nav-links-desktop`،
 * وأيّ تعديل عليها ينزف إلى صفحات التسويق. هنا لا يشترك شيء: بادئة `wls-` وحدها.
 */

const LANGUAGES = [
    { code: 'en', name: 'English', script: 'latin' },
    { code: 'ar', name: 'العربية', script: 'arabic' },
    { code: 'ku', name: 'کوردی', script: 'arabic' },
];

/**
 * القائمة نفسها هي قائمة اللغة القديمة شكلاً — لوح أبيض بحدّ سماوي وسهم صغير في
 * أعلاه، وصفوف بارتفاع 40 بكسل يفصلها خطّ شعرة، وشريط سماوي ينزلق على الحافة.
 * أُعيدت بطلب صريح. أنماطها منسوخة إلى `workspace-language.css` بأصنافها الخاصّة بدل
 * توسعة قواعد `.nav-links-desktop` — تلك مقيّدة بحاوية الروابط، وتعديلها ينزف إلى
 * شريط الموقع التسويقي كما حدث سابقاً.
 */

/**
 * العلامة: حرف لاتيني «A» وحرف عربي «ع» مرسومان مساراتٍ لا نصّاً.
 *
 * النصّ يستعير خطّ النظام، فيتبدّل شكل «ع» ووزنه بين ويندوز و iOS و أندرويد،
 * ويختلف عن وزن خطوط زرّ السمة المجاور. المسار يثبّت الشكل ويرث `currentColor`.
 * الجانب الموافق للغة الحالية يأخذ اللون الكامل، والآخر يخفت — فالأيقونة تدلّ على
 * حالتها دون شارة إضافية تزدحم عند أربعين بكسل.
 */
function ScriptMark() {
    return (
        <svg
            className="wls-mark"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <g className="wls-mark__latin">
                <path d="M2.6 13.2 L6.4 3.6 L10.2 13.2" />
                <path d="M4.2 10.2 H8.6" />
            </g>
            {/* «ع» بضربة واحدة متّصلة: رأس مقفل في الأعلى يهبط إلى كأس واسعة تنتهي
                برفعة يمنى. رُسمت بالمقارنة مع حرف خطّ Cairo على الشاشة، لا تخميناً —
                المحاولة الأولى خرجت خربشة تشبه «ʓ» ولا تُقرأ عيناً. */}
            <g className="wls-mark__arabic">
                <path d="M20.4 7.6 C19.6 6.5 17.5 6.7 16.7 8.2 C15.9 9.7 17.2 11.1 19.2 11.4 C15.2 12.2 12.2 14.2 12.2 17.2 C12.2 20 14.8 21.6 18.2 21 C20 20.7 21.2 20 21.8 19.2" />
            </g>
        </svg>
    );
}

export default function WorkspaceLanguageMenu() {
    const { currentLang, changeLanguage, t } = useLanguage();
    const { theme } = useTheme();
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const itemRefs = useRef([]);
    const switchTimerRef = useRef(null);
    const themeSettledRef = useRef(false);

    /**
     * الزرّان جاران، فيتفاعلان معاً: كلّ تبديل للسمة يُطلق نفس وميض زرّ السمة هنا
     * أيضاً، ويأخذ الزرّ لون السمة الجديدة. المدّة 640 مللي مطابقة لما في
     * `ThemeToggle` عمداً كي ينطفئ الوميضان في اللحظة ذاتها لا متتابعَين.
     * التخطّي في أوّل تمرير مقصود: التحميل ليس تبديلاً، ووميضه عند فتح كلّ صفحة ضجيج.
     */
    useEffect(() => {
        if (!themeSettledRef.current) {
            themeSettledRef.current = true;
            return;
        }
        setSwitching(true);
        if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
        switchTimerRef.current = setTimeout(() => setSwitching(false), 640);
    }, [theme]);

    useEffect(
        () => () => {
            if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
        },
        []
    );

    const active = LANGUAGES.find((lang) => lang.code === currentLang) ?? LANGUAGES[1];

    const close = useCallback(
        ({ restoreFocus = false } = {}) => {
            setOpen(false);
            if (restoreFocus) triggerRef.current?.focus();
        },
        []
    );

    // الإغلاق بالنقر خارج القائمة. `pointerdown` لا `click` حتى لا يسبق فتحُ القائمة
    // إغلاقَها في نفس الحدث على المتصفّحات التي تُطلق الاثنين.
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close({ restoreFocus: true });
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, close]);

    useEffect(() => {
        if (!open) return;
        const index = Math.max(0, LANGUAGES.findIndex((lang) => lang.code === currentLang));
        itemRefs.current[index]?.focus();
    }, [open, currentLang]);

    const handleSelect = (code) => {
        if (code !== currentLang) changeLanguage(code);
        close({ restoreFocus: true });
    };

    const handleItemKeyDown = (event, index) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = (index + step + LANGUAGES.length) % LANGUAGES.length;
        itemRefs.current[next]?.focus();
    };

    const label = `${t('language')}: ${active.name}`;

    return (
        <div className="wls" ref={rootRef}>
            <button
                type="button"
                ref={triggerRef}
                className={`wls__trigger${switching ? ' wls__trigger--switching' : ''}`}
                data-script={active.script}
                data-current-theme={theme}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={label}
                title={label}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="wls__burst" aria-hidden />
                <ScriptMark />
            </button>

            <div
                className={`wls__menu${open ? ' wls__menu--open' : ''}`}
                role="menu"
                aria-label={t('language')}
                aria-hidden={!open}
            >
                {LANGUAGES.map((lang, index) => {
                    const isActive = lang.code === currentLang;
                    return (
                        <button
                            key={lang.code}
                            type="button"
                            ref={(node) => {
                                itemRefs.current[index] = node;
                            }}
                            className={`wls__item${isActive ? ' wls__item--active' : ''}`}
                            role="menuitemradio"
                            aria-checked={isActive}
                            tabIndex={open ? 0 : -1}
                            data-lang={lang.code}
                            lang={lang.code}
                            onClick={() => handleSelect(lang.code)}
                            onKeyDown={(event) => handleItemKeyDown(event, index)}
                        >
                            <span className="wls__item-name">{lang.name}</span>
                            <span className="wls__item-code">{lang.code.toUpperCase()}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
