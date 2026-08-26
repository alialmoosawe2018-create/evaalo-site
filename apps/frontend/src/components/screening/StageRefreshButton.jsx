import React, { useCallback, useRef, useState } from 'react';

/** أقل مدة يبقى فيها الدوّار ظاهراً — ردّ سريع كان يخفت قبل أن تلمحه العين */
const SPIN_FLOOR_MS = 450;

/**
 * زر تحديث لوحة المرحلة.
 *
 * يدور أثناء الطلب الفعلي ولا يُعطّل نفسه: التعطيل مع انتظار الوعد كان يبدو
 * تأخيراً بثوانٍ، وإزالة كل إشارة كانت تجعل الزر يبدو معطلاً لأن التحديث خلفي
 * ولا يغيّر شيئاً على الشاشة عندما تكون البيانات كما هي. النقر المتكرر لا
 * يُبتلع؛ الطلبات المتأخرة تُهمَل في مصدرها عبر عدّاد التسلسل.
 *
 * @param {object} props
 * @param {() => (Promise<unknown> | void)} props.onRefresh
 * @param {string} props.label
 * @param {string} [props.className]
 */
export default function StageRefreshButton({
    onRefresh,
    label,
    className = 'btn btn-secondary candidates-toolbar-filter-btn',
}) {
    const runsRef = useRef(0);
    const [spinning, setSpinning] = useState(false);

    const handleClick = useCallback(() => {
        const result = onRefresh?.();
        runsRef.current += 1;
        setSpinning(true);
        Promise.all([
            Promise.resolve(result).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, SPIN_FLOOR_MS)),
        ]).then(() => {
            runsRef.current = Math.max(0, runsRef.current - 1);
            if (runsRef.current === 0) setSpinning(false);
        });
    }, [onRefresh]);

    return (
        <button type="button" className={className} onClick={handleClick} aria-busy={spinning}>
            <svg
                width="20" height="20" viewBox="0 0 20 20" fill="none"
                xmlns="http://www.w3.org/2000/svg" aria-hidden
                style={spinning ? { animation: 'stageRefreshSpin 0.8s linear infinite' } : undefined}
            >
                <path d="M16 10C16 13.3137 13.3137 16 10 16C6.68629 16 4 13.3137 4 10C4 6.68629 6.68629 4 10 4C11.82 4 13.45 4.81 14.55 6.08" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 4V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="btn-text">{label}</span>
        </button>
    );
}
