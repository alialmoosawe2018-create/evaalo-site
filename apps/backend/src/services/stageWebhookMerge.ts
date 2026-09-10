// ============================================
// ملف: services/stageWebhookMerge.ts
// الوظيفة: دمج تحديثات n8n الواردة فوق التقييم المخزّن، ومعالجة الرفض.
// ============================================
//
// استُخرجت هذه الدوالّ من `server.ts` في ٢٠٢٦-٠٩-١٠ بأجسادها حرفيّاً، بلا أيّ
// تغيير في السلوك. السبب: `server.ts` يستدعي `connectDatabase()` و
// `httpServer.listen()` في نطاق الوحدة، فاستيراده من اختبارٍ يُقلع الخادم
// ويتّصل بقاعدة البيانات. ولأنّ ذلك مستحيل، كان اختبار `stage1-parity` ينسخ
// هذه الدوالّ داخله ثمّ يفحص نسخته هو — فينجح مهما انكسر الإنتاج.
//
// الآن يستوردها الاختبار من هنا، فصار يفحص الكود الذي يعمل فعلاً.

/** رفض القيم النصية الخاطئة الشائعة من n8n/JS (مثل "undefined") */
export const INVALID_WEBHOOK_ID_TOKENS = new Set(['', 'undefined', 'null', 'nan']);

export function normalizeRecommendation(raw: unknown): 'Hire' | 'Consider' | 'Reject' | undefined {
    if (raw === undefined || raw === null) return undefined;
    const s = String(raw).trim().toLowerCase();
    if (!s) return undefined;
    if (s.includes('no hire') || s.includes('not hire') || s.includes('reject') || s.includes('unsuitable')) {
        return 'Reject';
    }
    if (s.includes('consider') || s.includes('maybe') || s.includes('review')) {
        return 'Consider';
    }
    if (s.includes('hire') || s.includes('recommended')) {
        return 'Hire';
    }
    return undefined;
}

export function toLooseKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function pickLoose(obj: unknown, aliases: string[]): unknown {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const rec = obj as Record<string, unknown>;
    const wanted = new Set(aliases.map((a) => toLooseKey(a)));
    for (const [k, v] of Object.entries(rec)) {
        if (wanted.has(toLooseKey(k))) return v;
    }
    return undefined;
}

export function pickLooseFromSources(sources: unknown[], aliases: string[]): unknown {
    for (const src of sources) {
        const v = pickLoose(src, aliases);
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) return v;
        const s = String(v).trim();
        if (!s || INVALID_WEBHOOK_ID_TOKENS.has(s.toLowerCase())) continue;
        return v;
    }
    return undefined;
}

/** دمج تحديث n8n فوق التقييم المخزّن — القيم undefined/null في patch لا تمس الحقول القديمة */
export function mergeEval(
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const base = existing ? { ...existing } : {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && INVALID_WEBHOOK_ID_TOKENS.has(v.trim().toLowerCase())) continue;
        base[k] = v;
    }
    for (const [k, v] of Object.entries(base)) {
        if (typeof v === 'string' && INVALID_WEBHOOK_ID_TOKENS.has(v.trim().toLowerCase())) {
            delete base[k];
        }
    }
    return base;
}

/** معالجة رفض n8n: status=rejected + تخزين rejectCode في الملاحظات */
export function applyN8nRejectHandling(
    dataRec: Record<string, unknown>,
    updateData: Record<string, unknown>,
    patch: Record<string, unknown>,
    existingNotes?: string
): void {
    const rejectCodeRaw = pickLooseFromSources([dataRec], ['rejectCode', 'reject_code']);
    const rejectCode = rejectCodeRaw != null ? String(rejectCodeRaw).trim() : '';
    const ingress = String(pickLooseFromSources([dataRec], ['ingress']) ?? '').toLowerCase();
    const rec = normalizeRecommendation(
        patch.recommendation ?? pickLooseFromSources([dataRec], ['recommendation', 'Recommendation'])
    );
    const isReject = Boolean(rejectCode) || ingress.includes('reject') || rec === 'Reject';

    if (isReject && !dataRec.status) {
        updateData.status = 'rejected';
    }

    const incomingNotes = (dataRec.notes || dataRec.comments) as string | undefined;
    if (incomingNotes?.trim()) {
        updateData.notes = incomingNotes.trim();
    } else if (rejectCode) {
        const summary = pickLooseFromSources([dataRec], ['summary', 'Summary']);
        const line = `[n8n:${rejectCode}]${summary ? ` ${String(summary).trim()}` : ''}`;
        const base = existingNotes?.trim() || '';
        updateData.notes = base ? `${base}\n${line}` : line;
    }
}
