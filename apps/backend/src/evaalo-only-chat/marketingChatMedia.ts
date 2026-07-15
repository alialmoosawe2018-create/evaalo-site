import OpenAI, { toFile } from 'openai';
import { MARKETING_CHAT_LLM_CONFIG } from './marketingChatConfig.js';

export type MarketingChatAttachmentType = 'image' | 'audio';

export type MarketingChatAttachment = {
    type: MarketingChatAttachmentType;
    mimeType: string;
    base64: string;
};

const IMAGE_MIMES = new Set(MARKETING_CHAT_LLM_CONFIG.allowedImageMimes);
const AUDIO_MIMES = new Set(MARKETING_CHAT_LLM_CONFIG.allowedAudioMimes);

function normalizeMimeType(mimeType: string): string {
    return mimeType.split(';')[0].trim().toLowerCase();
}

function isAllowedImageMime(mimeType: string): boolean {
    return IMAGE_MIMES.has(normalizeMimeType(mimeType) as (typeof MARKETING_CHAT_LLM_CONFIG.allowedImageMimes)[number]);
}

function isAllowedAudioMime(mimeType: string): boolean {
    const base = normalizeMimeType(mimeType);
    if (AUDIO_MIMES.has(base as (typeof MARKETING_CHAT_LLM_CONFIG.allowedAudioMimes)[number])) {
        return true;
    }
    // Safari / Edge variants
    return base === 'audio/x-m4a' || base === 'audio/aac' || base === 'audio/x-wav';
}

function decodeBase64Payload(base64: string): Buffer {
    const raw = base64.includes(',') ? base64.split(',').pop()! : base64;
    return Buffer.from(raw, 'base64');
}

export function parseMarketingChatAttachment(input: unknown): MarketingChatAttachment | null {
    if (!input || typeof input !== 'object') return null;
    const type = (input as { type?: string }).type;
    const mimeType = (input as { mimeType?: string }).mimeType;
    const base64 = (input as { base64?: string }).base64;
    if (type !== 'image' && type !== 'audio') return null;
    if (typeof mimeType !== 'string' || typeof base64 !== 'string' || !base64.trim()) return null;

    const buffer = decodeBase64Payload(base64.trim());
    if (!buffer.length) return null;

    if (type === 'image') {
        if (!isAllowedImageMime(mimeType)) return null;
        if (buffer.length > MARKETING_CHAT_LLM_CONFIG.maxImageBytes) return null;
    } else {
        if (!isAllowedAudioMime(mimeType)) return null;
        if (buffer.length > MARKETING_CHAT_LLM_CONFIG.maxAudioBytes) return null;
    }

    return { type, mimeType: normalizeMimeType(mimeType), base64: base64.trim() };
}

function audioExtension(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'wav';
}

export async function transcribeMarketingAudio(
    openai: OpenAI,
    attachment: MarketingChatAttachment,
    language?: 'ar' | 'en'
): Promise<string> {
    const buffer = decodeBase64Payload(attachment.base64);
    const file = await toFile(buffer, `voice-message.${audioExtension(attachment.mimeType)}`, {
        type: attachment.mimeType,
    });

    const result = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        ...(language ? { language } : {}),
        response_format: 'text',
    });

    return String(result).trim();
}

export function imageDataUrl(attachment: MarketingChatAttachment): string {
    if (attachment.base64.startsWith('data:')) return attachment.base64;
    return `data:${attachment.mimeType};base64,${attachment.base64.includes(',') ? attachment.base64.split(',').pop() : attachment.base64}`;
}
