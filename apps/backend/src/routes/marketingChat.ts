import { Router } from 'express';
import type { Request, Response } from 'express';
import { MARKETING_CHAT_LLM_CONFIG } from '../evaalo-only-chat/marketingChatConfig.js';
import {
    getMarketingChatReply,
    type MarketingChatMessage,
} from '../evaalo-only-chat/marketingChatLLM.js';
import { parseMarketingChatAttachment } from '../evaalo-only-chat/marketingChatMedia.js';

const router = Router();

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function rateLimitOk(ip: string): boolean {
    const now = Date.now();
    let b = ipBuckets.get(ip);
    if (!b || now > b.resetAt) {
        b = { count: 1, resetAt: now + RATE_WINDOW_MS };
        ipBuckets.set(ip, b);
        return true;
    }
    if (b.count >= RATE_MAX) return false;
    b.count += 1;
    return true;
}

function isValidMessage(m: unknown): m is MarketingChatMessage {
    if (!m || typeof m !== 'object') return false;
    const role = (m as { role?: string }).role;
    const content = (m as { content?: string }).content;
    if (role !== 'user' && role !== 'assistant') return false;
    if (typeof content !== 'string') return false;
    if (content.length > MARKETING_CHAT_LLM_CONFIG.maxUserMessageChars) return false;
    return true;
}

/** POST /api/marketing-chat */
router.post('/', async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!rateLimitOk(ip)) {
        return res.status(429).json({ error: 'Too many requests', message: 'Rate limit exceeded' });
    }

    const { messages, language, attachment } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages_required', message: 'messages array is required' });
    }
    if (messages.length > MARKETING_CHAT_LLM_CONFIG.maxMessages) {
        return res.status(400).json({ error: 'too_many_messages', message: 'Too many messages' });
    }
    for (const m of messages) {
        if (!isValidMessage(m)) {
            return res.status(400).json({
                error: 'invalid_message',
                message: 'Each message must be { role: user|assistant, content: string } with bounded length',
            });
        }
    }

    const last = messages[messages.length - 1];
    if (last.role !== 'user') {
        return res.status(400).json({ error: 'last_must_be_user', message: 'Last message must be from user' });
    }

    const parsedAttachment = attachment ? parseMarketingChatAttachment(attachment) : null;
    if (attachment && !parsedAttachment) {
        return res.status(400).json({
            error: 'invalid_attachment',
            message: 'attachment must be a valid image or audio payload within size limits',
        });
    }

    if (!parsedAttachment && !String(last.content || '').trim()) {
        return res.status(400).json({ error: 'empty_message', message: 'Message text or attachment is required' });
    }

    const langParam =
        typeof language === 'string' && (language === 'en' || language === 'ar' || language === 'english' || language === 'arabic')
            ? language
            : undefined;

    try {
        const { reply, usedLlm } = await getMarketingChatReply(
            messages as MarketingChatMessage[],
            langParam,
            parsedAttachment
        );
        return res.json({ reply, usedLlm });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'chat_failed';
        console.error('[marketing-chat]', msg);
        return res.status(500).json({ error: 'chat_failed', message: 'Failed to generate reply' });
    }
});

export default router;
