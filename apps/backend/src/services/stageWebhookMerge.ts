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

/**
 * A negated decision word: "no hire", "not a hire", "not recommended",
 * "never hire", "do not consider".
 *
 * ⚠️ This exists because the substring tests below cannot see negation. The
 * original code listed `'no hire'` and `'not hire'` literally, so ANY wording
 * that put something between the negator and the verb fell through to the
 * final `includes('hire')` and was recorded as a HIRE. Measured on 2026-09-10,
 * seven phrasings inverted that way — including `not recommended` and
 * `never hire`, which are exactly what a model writes when it means Reject.
 *
 * The window between the negator and the decision word is capped at two words.
 * Wider windows start swallowing sentences like "not the strongest, but hire",
 * and a false Reject is a real harm too — this is not a "when unsure, reject"
 * rule, it is a "read the negation that is actually there" rule.
 *
 * `(?!\s+only\b)` excludes the "not only X but Y" construction, which is
 * praise, not negation.
 *
 * ⚠️ KNOWN LIMITATION, left deliberately unsolved: a double negative such as
 * "there is no reason not to hire" still reads as Reject, because the inner
 * "not to hire" matches on its own. Detecting that needs real parsing, and a
 * half-built negation parser would fail in ways harder to predict than this
 * one. The realistic input here is a short decision token ("Hire", "No hire",
 * "not recommended"), not rhetoric — if that ever stops being true, this needs
 * a proper classifier rather than a wider regex.
 */
const NEGATORS =
    'no|not|never|none|cannot|cant|wont|dont|doesnt|didnt|isnt|arent|wasnt|couldnt|wouldnt|shouldnt|unable|insufficient|hardly|lacks|lacking';

/** The words whose negation flips a decision. */
const DECISION_WORDS =
    'hire|hired|hiring|recommend|recommended|recommends|recommending|consider|considered|considering|suitable|suited|qualified|advance|proceed|fit';

/**
 * A negator followed, within two filler words, by a decision word.
 *
 * The lookahead lists words that make the negation PRAISE rather than
 * rejection — "no concerns", "no doubt", "not only", "no brainer". Negating a
 * negative noun is a compliment, and without this the guard turns
 * "no concerns about hiring" into a rejection.
 *
 * ⚠️ Run this against text that STILL HAS ITS PUNCTUATION. `\w+` cannot cross a
 * comma, and that is the only thing keeping the window from reaching across a
 * clause boundary: "not the strongest, but hire" and "not sure, consider" are
 * both praise, and both become rejections the moment the comma is stripped.
 * That is not hypothetical — an earlier version of this fix canonicalized
 * punctuation away first and inverted three verdicts that used to be right.
 * Because the comma holds, the window can afford three filler words, which is
 * what "not a strong enough hire" and "do not move forward with hire" need.
 */
const NEGATED_DECISION = new RegExp(
    `\\b(?:${NEGATORS})\\b` +
        `(?!\\s+(?:only|concern|concerns|doubt|doubts|hesitation|hesitations|hesitate|issue|issues|reservation|reservations|objection|objections|problem|problems|brainer|reason|reasons|red)\\b)` +
        `(?:\\s+\\w+){0,3}\\s+(?:${DECISION_WORDS})\\b`
);

/**
 * Fixed constructions that contain a negator but mean the opposite:
 * "cannot recommend her more highly", "would not hesitate to recommend",
 * "not a bad hire". These are idioms, not compositional negation, so they get
 * an explicit list rather than a cleverer rule.
 */
const NEGATION_IS_PRAISE = new RegExp(
    `\\b(?:cannot|cant|couldnt|wouldnt|not)\\b\\s+(?:recommend|recommended|speak|say|be)\\b[^.]{0,30}\\b(?:more|enough|higher|highly)\\b` +
        `|\\bnot\\s+(?:a\\s+|an\\s+)?bad\\b` +
        `|\\b(?:${NEGATORS})\\b\\s+(?:hesitate|hesitation)\\b`
);

/**
 * "no reason to reject" is an endorsement, but it carries the literal word
 * `reject`, so the substring fallback would score it as one. The negation guard
 * cannot help — it correctly declines to fire (`reason` is a negative noun) and
 * the substring test runs anyway. So the phrase is cut out of the text before
 * matching rather than special-cased inside every branch.
 */
const NEGATED_REJECT_IDIOM = /\b(?:no|not|without)\s+reasons?\s+to\s+reject\b/g;

/** Enum-ish values, matched exactly after canonicalization. */
const EXACT_DECISIONS: Record<string, 'Hire' | 'Consider' | 'Reject'> = {
    hire: 'Hire',
    yes: 'Hire',
    accept: 'Hire',
    accepted: 'Hire',
    recommended: 'Hire',
    'strong hire': 'Hire',
    consider: 'Consider',
    maybe: 'Consider',
    review: 'Consider',
    reject: 'Reject',
    rejected: 'Reject',
    no: 'Reject',
    'no hire': 'Reject',
    'not hire': 'Reject',
    'do not hire': 'Reject',
    'not recommended': 'Reject',
    unsuitable: 'Reject',
    مرفوض: 'Reject',
    رفض: 'Reject',
    'غير مناسب': 'Reject',
    مقبول: 'Hire',
};

/** `Hire: No`, `Recommendation: false`, `decision = yes`. */
const STRUCTURED = /^(?:hire|hiring|recommendation|recommended|recommend|decision|verdict)\s+(no|yes|false|true|0|1|لا|نعم)$/;
const STRUCTURED_NEGATIVE = new Set(['no', 'false', '0', 'لا']);

/**
 * Canonicalize before ANY matching.
 *
 * This is the half of the fix that matters most. `No-Hire`, `no_hire`,
 * `NoHire`, `NOT_RECOMMENDED` and `No–Hire` all used to reach the final
 * `includes('hire')` and be recorded as a HIRE, because the separator kept the
 * negator from ever sitting next to the verb. Enum-shaped values like these are
 * exactly what a workflow or a model emits, so they are handled first and
 * exactly, not by fuzzy matching.
 */
/**
 * Lowercase, fold contractions to one token, drop Arabic diacritics — but KEEP
 * punctuation, because the fuzzy matching below relies on it as a clause
 * boundary. See the warning on NEGATED_DECISION.
 */
function looseDecisionText(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/['’]/g, '') // isn't -> isnt, so the contraction stays one word
        .replace(/[ً-ْ]/g, '') // Arabic diacritics: يُنصح -> ينصح
        // WORD joiners become spaces so "no-hire" reads as two words. CLAUSE
        // punctuation (, ; : . ! ?) is deliberately kept — it is what stops the
        // negation window crossing into the next clause.
        .replace(/[-–—_/\\|+~]+/g, ' ')
        .trim()
        .replace(/[^\S\n]+/g, ' ');
}

/**
 * Separator-free form, used ONLY for the exact table and the structured
 * `key value` shape.
 *
 * This is the half of the fix that matters most. `No-Hire`, `no_hire`,
 * `NoHire`, `NOT_RECOMMENDED` and `No–Hire` all used to reach the final
 * `includes('hire')` and be recorded as a HIRE, because the separator kept the
 * negator from ever sitting next to the verb. Enum-shaped values like these are
 * exactly what a workflow or a model emits, so they are matched first and
 * exactly, never fuzzily.
 */
function canonicalizeDecisionText(raw: string): string {
    return raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // NoHire -> No Hire, before lowercasing
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[ً-ْ]/g, '')
        .replace(/[^a-z0-9ء-ي]+/g, ' ') // every separator becomes a space
        .trim()
        .replace(/\s+/g, ' ');
}

export function normalizeRecommendation(raw: unknown): 'Hire' | 'Consider' | 'Reject' | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw);

    const canonical = canonicalizeDecisionText(text);
    if (!canonical) return undefined;

    const exact = EXACT_DECISIONS[canonical];
    if (exact) return exact;

    const structured = STRUCTURED.exec(canonical);
    if (structured) return STRUCTURED_NEGATIVE.has(structured[1]) ? 'Reject' : 'Hire';

    // Everything below runs on the punctuation-preserving form.
    const s = looseDecisionText(text).replace(NEGATED_REJECT_IDIOM, ' ');

    // Negation before every substring test — they cannot see a "not".
    if (!NEGATION_IS_PRAISE.test(s) && NEGATED_DECISION.test(s)) return 'Reject';

    if (
        s.includes('no hire') ||
        s.includes('not hire') ||
        s.includes('reject') ||
        s.includes('unsuitable') ||
        s.includes('مرفوض') ||
        s.includes('لا ينصح')
    ) {
        return 'Reject';
    }
    if (/\bconsider(?:ed|ing|ation)?\b/.test(s) || s.includes('maybe') || s.includes('review')) {
        return 'Consider';
    }
    // Word-bounded on purpose: "recommendation" alone is a label, not a verdict.
    if (/\bhir(?:e|ed|ing)\b/.test(s) || /\brecommend(?:ed|s|ing)?\b/.test(s) || s.includes('ينصح')) {
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
