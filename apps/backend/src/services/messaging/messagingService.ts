// ============================================
// ملف: services/messaging/messagingService.ts
// الوظيفة: موزّع رسائل موحّد (dispatcher) فوق محوّلات القنوات.
// ============================================
//
// نقطة دخول واحدة sendMessage(orgId, message) حيث message اتحاد مميّز حسب
// القناة. إضافة قناة جديدة (Email/Slack/SMS) = محوّل جديد فقط.

import { whatsappAdapter } from './adapters/whatsappAdapter.js';
import { linkedinAdapter } from './adapters/linkedinAdapter.js';
import type { MessageChannel, MessageChannelId, OutboundMessage, SendResult } from './types.js';

const channels: Record<MessageChannelId, MessageChannel> = {
    whatsapp: whatsappAdapter,
    linkedin: linkedinAdapter,
};

/** الموزّع: يختار المحوّل حسب message.channel ويُمرّر بدون توحيد الحمولة. */
export async function sendMessage(orgId: string, message: OutboundMessage): Promise<SendResult> {
    const adapter = channels[message.channel];
    if (!adapter) {
        return { ok: false, channel: message.channel, error: 'unknown_channel' };
    }
    return adapter.send(orgId, message);
}

function appBaseUrl(): string {
    return (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(
        /\/$/,
        ''
    );
}

export type InterviewLinkType = 'form' | 'video';

export interface BuildInterviewLinkOptions {
    campaignId?: string;
    interviewType?: InterviewLinkType;
    position?: string;
    /** معرّف لقطة سياق الهيد هانتر (HeadHunterSourcingContext) — يُلحق كـ ?hh= لمسار الفيديو. */
    headHunterContextId?: string;
}

/** يبني رابط استمارة التقديم أو مقابلة الفيديو العامة. */
export function buildInterviewLink(options?: string | BuildInterviewLinkOptions): string {
    const opts: BuildInterviewLinkOptions =
        typeof options === 'string' ? { campaignId: options } : options ?? {};
    const interviewType = opts.interviewType === 'video' ? 'video' : 'form';
    const base = appBaseUrl();

    if (interviewType === 'video') {
        const params = new URLSearchParams();
        if (opts.campaignId) params.set('campaignId', opts.campaignId);
        const position = (opts.position || '').trim();
        if (position) params.set('position', position);
        const hh = (opts.headHunterContextId || '').trim();
        if (hh) params.set('hh', hh);
        const qs = params.toString();
        return qs ? `${base}/video-screening-call?${qs}` : `${base}/video-screening-call`;
    }

    return opts.campaignId
        ? `${base}/form?campaign=${encodeURIComponent(opts.campaignId)}`
        : `${base}/form`;
}

export interface InterviewInviteInput {
    orgId: string;
    channel: MessageChannelId;
    /** رقم هاتف (whatsapp) أو رابط ملف LinkedIn. */
    recipient: string;
    campaignId?: string;
    /** نص مخصّص يسبق الرابط (LinkedIn / WhatsApp نص حر). */
    message?: string;
    interviewType?: InterviewLinkType;
    position?: string;
    headHunterContextId?: string;
}

/** يبني رابط المقابلة ويُرسله عبر القناة المختارة. */
export async function sendInterviewInvite(input: InterviewInviteInput): Promise<SendResult> {
    const { orgId, channel, recipient, campaignId, message, interviewType, position, headHunterContextId } = input;
    const link = buildInterviewLink({ campaignId, interviewType, position, headHunterContextId });

    if (channel === 'whatsapp') {
        const body = message ? `${message}\n\n${link}` : link;
        return sendMessage(orgId, {
            channel: 'whatsapp',
            toPhone: recipient,
            // ملاحظة: داخل نافذة 24h يعمل النص الحر؛ للتواصل الأول استخدم قالباً معتمداً.
            text: body,
        });
    }

    // LinkedIn
    const text = message ? `${message}\n\n${link}` : link;
    return sendMessage(orgId, { channel: 'linkedin', profileUrl: recipient, text });
}
