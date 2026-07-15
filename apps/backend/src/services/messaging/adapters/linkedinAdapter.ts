// ============================================
// ملف: services/messaging/adapters/linkedinAdapter.ts
// الوظيفة: إرسال رسائل LinkedIn عبر مزوّد طرف ثالث أو n8n (خلف feature flag).
// ============================================
//
// أتمتة LinkedIn محكومة بـ LINKEDIN_AUTOMATION_ENABLED. عند الإطفاء يُرفَض
// الإرسال فوراً دون أي نداء خارجي.

import { callExternal } from '../../callExternal.js';
import { getDecryptedSecrets } from '../../integrationService.js';
import { isLinkedInAutomationEnabled } from '../../../config/featureFlags.js';
import { unipileConfigured, sendLinkedInMessageViaUnipile } from '../../unipileService.js';
import type { MessageChannel, OutboundMessage, SendResult } from '../types.js';

interface LinkedInSecrets {
    accountId?: string;
    provider?: string;
}

/** يستخرج الهوية العامة من رابط ملف LinkedIn (آخر مقطع في /in/<id>). */
function profileIdentifier(profileUrl: string): string {
    const m = profileUrl.match(/\/in\/([^/?#]+)/i);
    if (m && m[1]) return decodeURIComponent(m[1]);
    return profileUrl.trim();
}

export const linkedinAdapter: MessageChannel = {
    id: 'linkedin',
    async send(orgId: string, message: OutboundMessage): Promise<SendResult> {
        if (message.channel !== 'linkedin') {
            return { ok: false, channel: 'linkedin', error: 'wrong_channel' };
        }
        if (!isLinkedInAutomationEnabled()) {
            return { ok: false, channel: 'linkedin', error: 'automation_disabled' };
        }
        const secrets = (await getDecryptedSecrets(orgId, 'linkedin')) as LinkedInSecrets | null;
        if (!secrets?.accountId) {
            return { ok: false, channel: 'linkedin', error: 'not_connected' };
        }
        if (!message.profileUrl || !message.text) {
            return { ok: false, channel: 'linkedin', error: 'missing_fields' };
        }

        // المسار 1: Unipile مباشرة (إن كانت المنصّة مهيّأة).
        if (unipileConfigured()) {
            const result = await sendLinkedInMessageViaUnipile(
                secrets.accountId,
                profileIdentifier(message.profileUrl),
                message.text
            );
            return result.ok
                ? { ok: true, channel: 'linkedin' }
                : { ok: false, channel: 'linkedin', error: result.error };
        }

        // المسار 2: توجيه عبر n8n (يحمل account_id ليُرسِل n8n عبر المزوّد).
        const webhookUrl = (process.env.N8N_LINKEDIN_MESSAGE_WEBHOOK_URL || '').trim();
        if (!webhookUrl) {
            return { ok: false, channel: 'linkedin', error: 'no_route_configured' };
        }

        try {
            const res = await callExternal(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: {
                    event: 'linkedin_message',
                    orgId,
                    provider: secrets.provider || process.env.LINKEDIN_PROVIDER || 'unipile',
                    accountId: secrets.accountId,
                    profileUrl: message.profileUrl,
                    text: message.text,
                    submittedAt: new Date().toISOString(),
                },
                timeoutMs: 15_000,
                retries: 1,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return { ok: false, channel: 'linkedin', error: `http_${res.status}: ${text.slice(0, 120)}` };
            }
            return { ok: true, channel: 'linkedin' };
        } catch (err) {
            return {
                ok: false,
                channel: 'linkedin',
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
};
