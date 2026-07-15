// ============================================
// ملف: services/messaging/adapters/whatsappAdapter.ts
// الوظيفة: إرسال رسائل WhatsApp عبر Meta Cloud API (Graph).
// ============================================

import { callExternal } from '../../callExternal.js';
import { getDecryptedSecrets } from '../../integrationService.js';
import type { MessageChannel, OutboundMessage, SendResult } from '../types.js';

const GRAPH_VERSION = (process.env.WHATSAPP_GRAPH_VERSION || 'v21.0').trim();

interface WhatsAppSecrets {
    phoneNumberId?: string;
    accessToken?: string;
    defaultTemplate?: string;
}

function buildTemplatePayload(toPhone: string, template: string, lang: string, params: string[]) {
    const components =
        params.length > 0
            ? [
                  {
                      type: 'body',
                      parameters: params.map((p) => ({ type: 'text', text: p })),
                  },
              ]
            : undefined;
    return {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'template',
        template: {
            name: template,
            language: { code: lang },
            ...(components ? { components } : {}),
        },
    };
}

function buildTextPayload(toPhone: string, text: string) {
    return {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text, preview_url: true },
    };
}

export const whatsappAdapter: MessageChannel = {
    id: 'whatsapp',
    async send(orgId: string, message: OutboundMessage): Promise<SendResult> {
        if (message.channel !== 'whatsapp') {
            return { ok: false, channel: 'whatsapp', error: 'wrong_channel' };
        }
        const secrets = (await getDecryptedSecrets(orgId, 'whatsapp')) as WhatsAppSecrets | null;
        if (!secrets?.phoneNumberId || !secrets?.accessToken) {
            return { ok: false, channel: 'whatsapp', error: 'not_connected' };
        }

        const toPhone = message.toPhone.replace(/[^\d]/g, '');
        if (!toPhone) {
            return { ok: false, channel: 'whatsapp', error: 'invalid_phone' };
        }

        const template = message.template || secrets.defaultTemplate;
        let payload: Record<string, unknown>;
        if (template) {
            payload = buildTemplatePayload(
                toPhone,
                template,
                message.templateLang || 'en_US',
                message.templateParams || []
            );
        } else if (message.text) {
            // نص حر يعمل فقط داخل نافذة 24h
            payload = buildTextPayload(toPhone, message.text);
        } else {
            return { ok: false, channel: 'whatsapp', error: 'no_template_or_text' };
        }

        try {
            const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
                secrets.phoneNumberId
            )}/messages`;
            const res = await callExternal(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${secrets.accessToken}` },
                body: payload,
                timeoutMs: 12_000,
                retries: 2,
            });
            const data = (await res.json().catch(() => ({}))) as {
                messages?: { id?: string }[];
                error?: { message?: string };
            };
            if (!res.ok) {
                return {
                    ok: false,
                    channel: 'whatsapp',
                    error: data?.error?.message || `http_${res.status}`,
                };
            }
            return {
                ok: true,
                channel: 'whatsapp',
                providerMessageId: data?.messages?.[0]?.id,
            };
        } catch (err) {
            return {
                ok: false,
                channel: 'whatsapp',
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
};
