/**
 * Daily quota — عدّاد استخدام يومي عام (لكل مفتاح، بحسب يوم UTC) فوق موديل ReceptionDemoUsage.
 *
 * تعميم منطق consumeDemoQuota الموجود في routes/receptionDemo.ts ليخدم مستهلكين آخرين —
 * أولهم الرسبشن الصوتي عبر الـWS (ببادئة مفتاح "vr:" لكل IP).
 *
 * ملاحظة مهمة: فشل Mongo لا يمنع الجلسة (fail-open). هذه حماية تكلفة، لا بوابة أمان.
 * السجلات تحذف نفسها عبر TTL الموجود على ReceptionDemoUsage.createdAt (3 أيام).
 */

import ReceptionDemoUsage from '../models/ReceptionDemoUsage.js';

export class DailyQuotaExceededError extends Error {
    readonly code = 'DAILY_QUOTA_EXCEEDED';
    constructor(public readonly limit: number) {
        super('daily quota exceeded');
    }
}

/** يوم UTC بصيغة YYYY-MM-DD (نفس مفتاح اليوم المستخدم في receptionDemo). */
function utcDay(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * يفحص عدّاد اليوم للمفاتيح المعطاة ثم يزيده بمقدار 1 لكل مفتاح.
 *
 * @param keys  مفاتيح مستقلة (مثل ["vr:1.2.3.4"]). كل مفتاح يُحسب على حدة؛
 *              تجاوز أي واحد منها يرمي الخطأ.
 * @param limit الحد الأقصى اليومي لكل مفتاح (<= 0 يعطّل الفحص تماماً).
 * @throws DailyQuotaExceededError عند بلوغ أحد المفاتيح الحد قبل الزيادة.
 *
 * عطل Mongo يُبتلع (fail-open) ولا يمنع المتابعة.
 */
export async function consumeDailyQuota(keys: string[], limit: number): Promise<void> {
    if (limit <= 0) return;
    const uniqueKeys = Array.from(new Set(keys.filter((k) => k && k.trim())));
    if (uniqueKeys.length === 0) return;
    const day = utcDay();
    try {
        const rows = await ReceptionDemoUsage.find({ key: { $in: uniqueKeys }, day }).lean();
        if (rows.some((r) => (r.count ?? 0) >= limit)) {
            throw new DailyQuotaExceededError(limit);
        }
        await Promise.all(
            uniqueKeys.map((key) =>
                ReceptionDemoUsage.updateOne(
                    { key, day },
                    { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
                    { upsert: true }
                )
            )
        );
    } catch (e) {
        if (e instanceof DailyQuotaExceededError) throw e;
        // عطل Mongo لا يمنع الجلسة — الحد حماية تكلفة وليس بوابة أمان
        console.warn('⚠️ dailyQuota check skipped:', (e as Error)?.message || e);
    }
}
