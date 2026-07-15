// ============================================
// ملف: routes/integrations.ts
// الوظيفة: ربط/فصل تكاملات المؤسسة (LinkedIn عبر مزوّد، WhatsApp Cloud API).
// ============================================
//
// الأسرار تُشفَّر في integrationService ولا تُعاد للواجهة. كل الكتابة محمية بـ
// integrations.manage + تُسجَّل في AuditLog. أتمتة LinkedIn خلف feature flag.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { conditionalRequireAuth } from '../middleware/conditionalAuth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getOrgId, getClerkUserId } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { getPublicFeatureFlags } from '../config/featureFlags.js';
import { callExternal } from '../services/callExternal.js';
import {
    listIntegrationStatus,
    connectIntegration,
    disconnectIntegration,
} from '../services/integrationService.js';
import {
    createLinkedInHostedAuthLink,
    unipileConfigured,
    isCreationSuccess,
    type UnipileNotifyPayload,
} from '../services/unipileService.js';
import type { IntegrationProvider } from '../models/OrgIntegration.js';

const router = Router();

const VALID_PROVIDERS: IntegrationProvider[] = ['linkedin', 'whatsapp'];
const WHATSAPP_GRAPH_VERSION = (process.env.WHATSAPP_GRAPH_VERSION || 'v21.0').trim();

function publicApiUrl(): string {
    return (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function appPublicUrl(): string {
    return (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(
        /\/$/,
        ''
    );
}

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/** يخفي وسط القيمة الحساسة لعرضها بأمان. */
function mask(value: string): string {
    if (!value) return '';
    if (value.length <= 6) return '••••';
    return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

/** GET /api/integrations — حالة كل التكاملات + أعلام الميزات */
router.get('/', conditionalRequireAuth(), async (req: Request, res: Response) => {
    try {
        const orgId = getOrgId(req);
        const statuses = await listIntegrationStatus(orgId);
        const byProvider: Record<string, unknown> = {};
        for (const p of VALID_PROVIDERS) {
            const found = statuses.find((s) => s.provider === p);
            byProvider[p] = found || { provider: p, connected: false, status: 'disconnected', meta: {} };
        }
        res.json({
            ok: true,
            integrations: byProvider,
            flags: { ...getPublicFeatureFlags(), linkedinProviderConfigured: unipileConfigured() },
        });
    } catch (err) {
        console.error('[integrations] status error:', err);
        res.status(500).json({ ok: false, error: 'Failed to load integrations' });
    }
});

/**
 * POST /api/integrations/linkedin/connect/init — يبدأ تدفق Hosted Auth.
 * يُرجِع { url } لفتحها (popup). المستخدم يسجّل دخول LinkedIn مرة واحدة، ثم
 * يُرسل Unipile account_id إلى /api/integrations/unipile/notify.
 */
router.post(
    '/linkedin/connect/init',
    conditionalRequireAuth(),
    requirePermission('integrations.manage'),
    async (req: Request, res: Response) => {
        try {
            if (!unipileConfigured()) {
                return res.status(503).json({ ok: false, error: 'linkedin_provider_not_configured' });
            }
            const orgId = getOrgId(req);
            const secret = (process.env.UNIPILE_NOTIFY_SECRET || '').trim();
            const notifyUrl = `${publicApiUrl()}/api/integrations/unipile/notify${
                secret ? `?secret=${encodeURIComponent(secret)}` : ''
            }`;
            const redirect = `${appPublicUrl()}/account`;

            const { url } = await createLinkedInHostedAuthLink({
                orgId,
                notifyUrl,
                successUrl: redirect,
                failureUrl: redirect,
            });

            await logAudit(req, {
                action: 'integration.connect_init',
                targetType: 'integration',
                targetId: 'linkedin',
            });

            res.json({ ok: true, url });
        } catch (err) {
            console.error('[integrations] linkedin init error:', err);
            res.status(502).json({ ok: false, error: 'Failed to start LinkedIn connect' });
        }
    }
);

/**
 * POST /api/integrations/unipile/notify — إشعار Unipile بعد ربط الحساب.
 * بدون مصادقة مستخدم (يستدعيه Unipile)؛ محمي بـ UNIPILE_NOTIFY_SECRET.
 * payload: { status, account_id, name } حيث name = organizationId.
 */
router.post('/unipile/notify', async (req: Request, res: Response) => {
    try {
        const secret = (process.env.UNIPILE_NOTIFY_SECRET || '').trim();
        if (secret) {
            const provided = str((req.query.secret as string) || req.headers['x-unipile-secret']);
            if (provided !== secret) {
                return res.status(401).json({ ok: false, error: 'invalid_secret' });
            }
        }

        const payload = (req.body ?? {}) as UnipileNotifyPayload;
        const orgId = str(payload.name);
        const accountId = str(payload.account_id);

        if (!isCreationSuccess(payload) || !orgId || !accountId) {
            // نردّ 200 حتى لا يُعيد Unipile المحاولة على حالات غير ناجحة
            return res.json({ ok: true, ignored: true });
        }

        await connectIntegration({
            orgId,
            provider: 'linkedin',
            secrets: { accountId, provider: 'unipile' },
            meta: { provider: 'unipile', accountLabel: mask(accountId) },
            updatedBy: 'unipile-hosted-auth',
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[integrations] unipile notify error:', err);
        res.status(500).json({ ok: false, error: 'notify_failed' });
    }
});

/** POST /api/integrations/whatsapp/connect — WhatsApp Business Cloud API (Meta) */
router.post(
    '/whatsapp/connect',
    conditionalRequireAuth(),
    requirePermission('integrations.manage'),
    async (req: Request, res: Response) => {
        try {
            const orgId = getOrgId(req);
            const body = req.body ?? {};
            const phoneNumberId = str(body.phoneNumberId);
            const wabaId = str(body.wabaId);
            const accessToken = str(body.accessToken);
            const defaultTemplate = str(body.defaultTemplate);

            if (!phoneNumberId || !accessToken) {
                return res
                    .status(400)
                    .json({ ok: false, error: 'phoneNumberId and accessToken are required' });
            }

            // تحقّق من الكردنشل عبر Graph API ping (لا نعيد المحاولة على 4xx)
            let displayPhoneNumber = '';
            let verifiedName = '';
            try {
                const pingUrl = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(
                    phoneNumberId
                )}?fields=display_phone_number,verified_name`;
                const pingRes = await callExternal(pingUrl, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeoutMs: 10_000,
                    retries: 1,
                });
                if (!pingRes.ok) {
                    const text = await pingRes.text().catch(() => '');
                    console.warn('[integrations] whatsapp ping non-OK:', pingRes.status, text.slice(0, 200));
                    return res.status(400).json({
                        ok: false,
                        error: 'WhatsApp verification failed — check phoneNumberId and accessToken',
                    });
                }
                const data = (await pingRes.json().catch(() => ({}))) as {
                    display_phone_number?: string;
                    verified_name?: string;
                };
                displayPhoneNumber = str(data.display_phone_number);
                verifiedName = str(data.verified_name);
            } catch (pingErr) {
                console.error('[integrations] whatsapp ping error:', pingErr);
                return res
                    .status(502)
                    .json({ ok: false, error: 'Could not reach WhatsApp Cloud API' });
            }

            const result = await connectIntegration({
                orgId,
                provider: 'whatsapp',
                secrets: { phoneNumberId, wabaId, accessToken, defaultTemplate },
                meta: {
                    phoneNumberId,
                    wabaId,
                    displayPhoneNumber,
                    verifiedName,
                    defaultTemplate,
                },
                updatedBy: getClerkUserId(req),
            });

            await logAudit(req, {
                action: 'integration.connect',
                targetType: 'integration',
                targetId: 'whatsapp',
                metadata: { phoneNumberId, verifiedName },
            });

            res.json({ ok: true, integration: result });
        } catch (err) {
            console.error('[integrations] whatsapp connect error:', err);
            res.status(500).json({ ok: false, error: 'Failed to connect WhatsApp' });
        }
    }
);

/** DELETE /api/integrations/:provider — فصل التكامل (مسح الأسرار) */
router.delete(
    '/:provider',
    conditionalRequireAuth(),
    requirePermission('integrations.manage'),
    async (req: Request, res: Response) => {
        try {
            const provider = str(req.params.provider) as IntegrationProvider;
            if (!VALID_PROVIDERS.includes(provider)) {
                return res.status(400).json({ ok: false, error: 'Unknown provider' });
            }
            const orgId = getOrgId(req);
            await disconnectIntegration(orgId, provider, getClerkUserId(req));
            await logAudit(req, {
                action: 'integration.disconnect',
                targetType: 'integration',
                targetId: provider,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('[integrations] disconnect error:', err);
            res.status(500).json({ ok: false, error: 'Failed to disconnect' });
        }
    }
);

export default router;
