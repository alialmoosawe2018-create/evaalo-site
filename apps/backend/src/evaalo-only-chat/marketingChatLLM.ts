/**
 * Marketing demo text chat — OpenAI completions (same pattern as voice reception LLM).
 */

import OpenAI from 'openai';
import {
    MARKETING_CHAT_LLM_CONFIG,
    fallbackReplyWhenNoApi,
    pickMarketingChatSystemPrompt,
} from './marketingChatConfig.js';
import {
    imageDataUrl,
    transcribeMarketingAudio,
    type MarketingChatAttachment,
} from './marketingChatMedia.js';

export type MarketingChatMessage = { role: 'user' | 'assistant'; content: string };

let _openai: OpenAI | null | undefined = undefined;

function getOpenAIClient(): OpenAI | null {
    if (_openai === undefined) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            console.warn('[MARKETING-CHAT] OPENAI_API_KEY is not set - LLM will be disabled');
            _openai = null;
        } else {
            _openai = new OpenAI({ apiKey: key });
        }
    }
    return _openai;
}

function sanitizeReply(text: string): string {
    return text
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

/** Placeholders sent when the user attaches media without typing text. */
const MEDIA_PLACEHOLDER_RE =
    /^\((?:voice message|رسالة صوتية|پەیامی دەنگی|image|صورة|وێنە)\)$/i;

function stripMediaPlaceholder(text: string): string {
    const trimmed = text.trim();
    return MEDIA_PLACEHOLDER_RE.test(trimmed) ? '' : trimmed;
}

function detectLangFromText(text: string): 'ar' | 'en' {
    return ARABIC_SCRIPT_RE.test(text) ? 'ar' : 'en';
}

function resolveLang(language: string | undefined, lastUserText: string): 'ar' | 'en' {
    const explicitEn = language === 'en' || language === 'english';
    const explicitAr = language === 'ar' || language === 'arabic';
    const isArabicInput = detectLangFromText(lastUserText) === 'ar';
    if (explicitAr) return 'ar';
    if (explicitEn) return isArabicInput ? 'ar' : 'en';
    return isArabicInput ? 'ar' : 'en';
}

async function buildLatestUserContent(
    openai: OpenAI,
    text: string,
    attachment: MarketingChatAttachment | null | undefined,
    lang: 'ar' | 'en',
    audioTranscript?: string | null
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[] | string> {
    const trimmed = stripMediaPlaceholder(text);

    if (attachment?.type === 'audio') {
        const transcript =
            audioTranscript ?? (await transcribeMarketingAudio(openai, attachment));
        if (!transcript) {
            return lang === 'ar'
                ? 'لم أستطع فهم الرسالة الصوتية. هل يمكنك إعادة الإرسال أو الكتابة؟'
                : 'I could not understand the voice message. Could you resend or type it?';
        }
        const merged = trimmed ? `${trimmed}\n\n[Voice message transcript]: ${transcript}` : transcript;
        return merged;
    }

    if (attachment?.type === 'image') {
        const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
        const prompt =
            trimmed ||
            (lang === 'ar'
                ? 'الزائر أرسل هذه الصورة. صف ما تراه باختصار وساعده في سياق Evaalo.'
                : 'The visitor sent this image. Briefly describe what you see and help them in the Evaalo context.');
        parts.push({ type: 'text', text: prompt });
        parts.push({
            type: 'image_url',
            image_url: { url: imageDataUrl(attachment), detail: 'low' },
        });
        return parts;
    }

    return trimmed;
}

/**
 * @param history — alternating user/assistant, last message must be user for a new turn (caller ensures).
 */
export async function getMarketingChatReply(
    history: MarketingChatMessage[],
    language?: string,
    attachment?: MarketingChatAttachment | null
): Promise<{ reply: string; usedLlm: boolean }> {
    const openai = getOpenAIClient();
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const lastUserText = stripMediaPlaceholder(lastUser?.content ?? '');
    let effectiveLang = resolveLang(language, lastUserText);

    let audioTranscript: string | null = null;
    if (attachment?.type === 'audio' && openai) {
        audioTranscript = await transcribeMarketingAudio(openai, attachment);
        if (audioTranscript) {
            effectiveLang = detectLangFromText(audioTranscript);
        }
    }

    if (!openai) {
        return { reply: fallbackReplyWhenNoApi(effectiveLang), usedLlm: false };
    }

    const systemPrompt = pickMarketingChatSystemPrompt(effectiveLang);
    const recent = history.slice(-MARKETING_CHAT_LLM_CONFIG.historyWindow);
    const prior = recent.slice(0, -1);
    const latest = recent[recent.length - 1];

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...prior.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        })),
    ];

    if (latest?.role === 'user') {
        const userContent = await buildLatestUserContent(
            openai,
            latest.content,
            attachment,
            effectiveLang,
            audioTranscript
        );
        if (typeof userContent === 'string' && userContent.startsWith('I could not understand')) {
            return { reply: userContent, usedLlm: true };
        }
        if (typeof userContent === 'string' && userContent.startsWith('لم أستطع فهم')) {
            return { reply: userContent, usedLlm: true };
        }
        messages.push({ role: 'user', content: userContent });
    }

    try {
        const response = await openai.chat.completions.create({
            model: MARKETING_CHAT_LLM_CONFIG.model,
            messages,
            temperature: MARKETING_CHAT_LLM_CONFIG.temperature,
            max_tokens: MARKETING_CHAT_LLM_CONFIG.maxTokens,
        });
        const raw = response.choices[0]?.message?.content?.trim() || '';
        const cleaned = sanitizeReply(raw);
        if (cleaned) return { reply: cleaned, usedLlm: true };
        return {
            reply:
                effectiveLang === 'ar'
                    ? 'كيف أقدر أساعدك أكثر؟'
                    : 'How else can I help you?',
            usedLlm: true,
        };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MARKETING-CHAT LLM ERROR]', msg);
        return {
            reply:
                effectiveLang === 'ar'
                    ? 'صار خطأ بسيط، حاول مرة ثانية.'
                    : 'Something went wrong, please try again.',
            usedLlm: true,
        };
    }
}
