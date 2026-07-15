/**
 * Reception LLM — استدعاء OpenAI مبسّط لإيجنت الريسبشن
 * بدون مراحل مقابلة، بدون أسئلة pool، بدون تقييم.
 */

import OpenAI from 'openai';
import { pickReceptionSystemPrompt, RECEPTION_LLM_CONFIG } from './receptionConfig.js';

export type ReceptionMessage = { role: 'user' | 'assistant'; content: string };

let _openai: OpenAI | null | undefined = undefined;

function getOpenAIClient(): OpenAI | null {
    if (_openai === undefined) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            console.warn('[RECEPTION] OPENAI_API_KEY is not set - LLM will be disabled');
            _openai = null;
        } else {
            _openai = new OpenAI({ apiKey: key });
        }
    }
    return _openai;
}

/** تنظيف خفيف من الإيموجي والرموز الخاصة */
function sanitizeReply(text: string): string {
    return text
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const CANONICAL_AR_BRAND = 'ایڤالو';

/** تصحيح كتابة اسم المنصة في الردود العربية */
function normalizeArabicBrandSpelling(text: string): string {
    let s = text;
    const wrongForms = [
        'ایvالo',
        'ایVالo',
        'ایvالO',
        'ایVالO',
        'ایvالو',
        'ایVالو',
        'إيفالo',
        'إيفالO',
        'إيفالو',
        'ايفالo',
        'ايفالO',
        'ايفالو',
    ];
    for (const wrong of wrongForms) {
        s = s.replaceAll(wrong, CANONICAL_AR_BRAND);
    }
    s = s.replace(/ای\s*[vV]\s*الو/g, CANONICAL_AR_BRAND);
    s = s.replace(/[إا]\s*[iI]\s*[vV]\s*الو/g, CANONICAL_AR_BRAND);
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s)) {
        s = s.replaceAll('Evaalo', CANONICAL_AR_BRAND);
    }
    return s;
}

/** استبدال صيغ عربية خاطئة شائعة في ردود الاستقبال */
function polishArabicReceptionReply(text: string): string {
    let s = normalizeArabicBrandSpelling(text);
    s = s.replace(/إذا\s+عند\s+أ?ي\s+استفسار\s+خبرني/giu, 'إذا عندك أي استفسار تفضل');
    s = s.replace(/إذا\s+عندك\s+أ?ي\s+استفسار\s+خبرني/giu, 'إذا عندك أي استفسار تفضل');
    s = s.replace(/عند\s+أ?ي\s+استفسار\s+خبرني/giu, 'إذا عندك أي استفسار تفضل');
    s = s.replace(/،?\s*خبرني\s*([.!?]|$)/gu, '، تفضل$1');
    s = s.replace(/خبرني/gu, 'تفضل');
    s = s.replace(/تفضل[،.]?\s+تفضل/gu, 'تفضل');
    return s.replace(/\s{2,}/g, ' ').trim();
}

function finalizeReply(text: string, preferArabic: boolean): string {
    const cleaned = sanitizeReply(text);
    if (!cleaned) return cleaned;
    if (preferArabic || /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(cleaned)) {
        return polishArabicReceptionReply(cleaned);
    }
    return cleaned;
}

/**
 * توليد رد ذكي للزائر — ريسبشن فقط (بدون منطق HR).
 */
export async function getReceptionReply(
    userText: string,
    history: ReceptionMessage[],
    language?: string
): Promise<string> {
    const openai = getOpenAIClient();

    const explicitEn = language === 'en' || language === 'english';
    const explicitAr = language === 'ar' || language === 'arabic';
    const isArabicInput = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(userText);

    /** الجلسة en (لغة الموقع) تبقى إنجليزية افتراضياً؛ إذا تحدث المستخدم بالعربية يُفعَّل الرد العربي والصوت العربي لاحقاً عبر TTS. */
    let effectiveLang: 'ar' | 'en';
    if (explicitAr) {
        effectiveLang = 'ar';
    } else if (explicitEn) {
        effectiveLang = isArabicInput ? 'ar' : 'en';
    } else {
        effectiveLang = isArabicInput ? 'ar' : 'en';
    }

    const preferAr = effectiveLang === 'ar';

    if (!openai) {
        return preferAr
            ? 'اعتذر، الخدمة الذكية مو متوفرة حالياً. حاول مرة لاحقاً.'
            : 'Sorry, the smart service is unavailable right now. Please try again later.';
    }

    const systemPrompt = pickReceptionSystemPrompt(effectiveLang);
    const recentHistory = history.slice(-RECEPTION_LLM_CONFIG.historyWindow);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...recentHistory.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        })),
        { role: 'user', content: userText },
    ];

    try {
        const response = await openai.chat.completions.create({
            model: RECEPTION_LLM_CONFIG.model,
            messages,
            temperature: RECEPTION_LLM_CONFIG.temperature,
            max_tokens: RECEPTION_LLM_CONFIG.maxTokens,
        });
        const raw = response.choices[0]?.message?.content?.trim() || '';
        const cleaned = finalizeReply(raw, preferAr);
        if (cleaned) return cleaned;
        return preferAr
            ? 'تمام، إذا عندك أي استفسار تفضل.'
            : 'Okay, feel free to ask if you have any other questions.';
    } catch (err: any) {
        console.error('[RECEPTION LLM ERROR]', err?.message || err);
        return preferAr
            ? 'صار خطأ بسيط، ممكن تعيد سؤالك؟'
            : 'A small error occurred, could you repeat your question?';
    }
}
