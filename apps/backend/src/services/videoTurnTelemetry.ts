/**
 * تطبيع ما ترسله الواجهة عن مقابلة الفيديو: الترانسكريبت وسجل أدوار الوكيل.
 *
 * وحدة نقية بلا أي أثر جانبي عمداً — الدوال كانت داخل `routes/videoInterview.ts`
 * فتعذّر اختبارها: استيراد الراوتر يسحب شجرة الخدمات كاملة (عميل OpenAI ينفجر
 * بلا مفتاح). وهي منطق حدودي يستحق اختباراً مباشراً.
 */

export type IncomingMessage = {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date;
};

/**
 * ترانسكريبت وارد من الواجهة **مع الحفاظ على طابع كل رسالة**.
 *
 * كان التطبيع يُسقط `timestamp`، فتُسنَد المصفوفة كاملةً دفعةً واحدة ويطبّق
 * Mongoose `default: Date.now` على كل العناصر في لحظة الحفظ نفسها — فخرجت كل
 * رسائل مقابلة 2026-09-23 بالطابع 08:05:12.84x، وصار زمن كل دور غير قابل للقياس
 * بعد انتهاء المقابلة.
 *
 * الطابع يُقبل فقط إن كان تاريخاً صالحاً، ويُحذف إن لم يكن: تركه للمخطط يعني
 * قيمة افتراضية واضحة، بينما اختلاق قيمة هنا يبدو توقيتاً حقيقياً ويُفسد القياس.
 */
export function normalizeIncomingTranscript(incoming: any): IncomingMessage[] {
    if (!Array.isArray(incoming)) return [];
    return incoming
        .map((m: any) => {
            const parsed = m?.timestamp ? new Date(m.timestamp) : null;
            const out: IncomingMessage = {
                role: m?.role === 'assistant' ? 'assistant' : 'user',
                content: String(m?.content || '').trim(),
            };
            if (parsed && !Number.isNaN(parsed.getTime())) out.timestamp = parsed;
            return out;
        })
        .filter((m: IncomingMessage) => m.content.length > 0);
}

/** سقف سجل الأدوار — القياس لا يجوز أن يكون هو ما يُفجّر حجم الوثيقة. */
export const MAX_TURN_LOG_ENTRIES = 500;

/**
 * سجل أدوار الوكيل (قياس بحت — لا يقرأه أي منطق تقييم).
 *
 * وكيل LiveKit لا يملك أي مسار HTTP لخادمنا، فالمتصفح هو الناقل الوحيد — أي أن
 * هذه الدالة هي حدّ الثقة: تستقبل ما يرسله تبويبٌ ما. لذلك تُسقط كل ما ليس
 * سجلاً، وتُبقي **الأحدث** لأن نهاية المقابلة هي موضع الخلل عادةً.
 */
export function normalizeIncomingTurnLog(incoming: any): Record<string, any>[] {
    if (!Array.isArray(incoming)) return [];
    return incoming
        .filter((r: any) => r && typeof r === 'object' && !Array.isArray(r))
        .slice(-MAX_TURN_LOG_ENTRIES)
        .map((r: any) => sanitizeRecord(r));
}

/** أقصى عمق تعشيش مقبول — سجل مسطّح أصلاً، والعمق الزائد إشارة عبث لا بيانات. */
const MAX_TURN_LOG_DEPTH = 4;

/**
 * تنقية مفتاح-بمفتاح لسجل قادم من المتصفح قبل تخزينه كـ`Mixed`.
 *
 * الحقل يُخزَّن بلا مخطط، أي أن كل ما يرسله التبويب يُكتب كما هو. ثلاثة مفاتيح
 * تُرفض لأنها ليست بيانات قياس بحال:
 *  - البادئة `$` والنقطة `.` — صيغة معاملات MongoDB؛ تخزينها يزرع وثيقة قد
 *    يفسّرها أي كود لاحق (`{$set: doc}`) كأمر لا كقيمة.
 *  - `__proto__` / `constructor` / `prototype` — تلويث النموذج الأولي عند أي
 *    دمج أو نسخ لاحق في Node.
 *
 * ولا يُعتمد هنا على «المتصفح لنا»: هذه نقطة حدّ ثقة، والمصدر تبويب يمكن العبث به.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeRecord(value: any, depth = 0): any {
    if (Array.isArray(value)) {
        if (depth >= MAX_TURN_LOG_DEPTH) return [];
        return value.map((v) => sanitizeRecord(v, depth + 1));
    }
    if (!value || typeof value !== 'object') return value;
    if (depth >= MAX_TURN_LOG_DEPTH) return {};

    const out: Record<string, any> = Object.create(null);
    for (const [key, v] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (key.startsWith('$') || key.includes('.')) continue;
        out[key] = sanitizeRecord(v, depth + 1);
    }
    // بلا نموذج أولي أعلاه لمنع التلويث أثناء البناء؛ نعيده كائناً عادياً كي
    // يتعامل معه Mongoose ووحدات الفحص بشكل طبيعي.
    return Object.assign({}, out);
}
