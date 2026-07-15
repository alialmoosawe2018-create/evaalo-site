// ============================================
// ملف: services/messaging/types.ts
// الوظيفة: عقد طبقة الرسائل الموحّدة (dispatcher + adapters).
// ============================================

export type MessageChannelId = 'whatsapp' | 'linkedin';

/** رسالة WhatsApp: إمّا قالب معتمد (للتواصل الأول/خارج 24h) أو نص حر داخل النافذة. */
export interface WhatsAppMessage {
    channel: 'whatsapp';
    toPhone: string;
    /** اسم قالب Meta المعتمد. عند غيابه يُرسَل text (داخل نافذة 24h فقط). */
    template?: string;
    /** متغيّرات القالب بالترتيب (body params). */
    templateParams?: string[];
    /** لغة القالب (افتراضي en_US). */
    templateLang?: string;
    /** نص حر (يعمل فقط داخل نافذة 24h). */
    text?: string;
}

/** رسالة LinkedIn: نص حر إلى رابط ملف شخصي (عبر مزوّد طرف ثالث أو n8n). */
export interface LinkedInMessage {
    channel: 'linkedin';
    profileUrl: string;
    text: string;
}

export type OutboundMessage = WhatsAppMessage | LinkedInMessage;

export interface SendResult {
    ok: boolean;
    channel: MessageChannelId;
    providerMessageId?: string;
    error?: string;
}

/** كل قناة تنفّذ هذا العقد. الموزّع (dispatcher) يختار المحوّل حسب channel. */
export interface MessageChannel {
    readonly id: MessageChannelId;
    send(orgId: string, message: OutboundMessage): Promise<SendResult>;
}
