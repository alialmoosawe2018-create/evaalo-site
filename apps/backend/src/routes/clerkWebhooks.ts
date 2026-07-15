// ============================================
// ملف: routes/clerkWebhooks.ts
// الوظيفة: استقبال أحداث Clerk — Route رفيع فقط:
//   1) verify Svix signature
//   2) claim idempotency (svix-id) — يمنع تكرار upsert/audit عند retries من Clerk
//   3) dispatch إلى handlers (services/clerkWebhookHandlers.ts)
//   4) 200 / 401 / 503
// ============================================
//
// تسجيل في server.ts (يجب أن يكون express.raw قبل express.json):
//   app.use(
//       '/api/webhooks/clerk',
//       express.raw({ type: 'application/json' }),
//       clerkWebhookRoutes
//   );
//
// ENV المطلوبة:
//   CLERK_WEBHOOK_SECRET — من Clerk Dashboard → Webhooks → Signing Secret.
//
// dev tunneling (للاختبار محلياً):
//   cloudflared tunnel --url http://localhost:5000
//   ثم ضع الـ URL في Clerk Dashboard مؤقتاً.

import express, { Request, Response } from 'express';
import { Webhook } from 'svix';
import {
    upsertUserFromClerk,
    softDeleteUser,
    applyMembership,
} from '../services/clerkWebhookHandlers.js';
import {
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from '../services/webhookIdempotency.js';
import {
    normalizeClerkEvent,
    type ClerkWebhookEvent,
} from '../types/clerkWebhookEvents.js';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[clerkWebhooks] CLERK_WEBHOOK_SECRET is not set');
        return res.status(503).json({ error: 'webhook_not_configured' });
    }

    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];

    if (
        typeof svixId !== 'string' ||
        typeof svixTimestamp !== 'string' ||
        typeof svixSignature !== 'string'
    ) {
        return res.status(400).json({ error: 'missing_svix_headers' });
    }

    // req.body مع express.raw هو Buffer
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!rawBody) {
        return res.status(400).json({ error: 'empty_body' });
    }

    let event: ClerkWebhookEvent;
    try {
        const wh = new Webhook(secret);
        event = wh.verify(rawBody, {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        }) as ClerkWebhookEvent;
    } catch (err) {
        console.warn('[clerkWebhooks] signature verification failed:', err);
        return res.status(401).json({ error: 'invalid_signature' });
    }

    // Idempotency — قبل أي كتابة في Mongo أو audit log.
    // svix-id ثابت لكل event؛ Clerk retries تستخدم نفس id.
    const idempotencyKey = svixId;
    const claim = await claimWebhook('clerk', idempotencyKey, {
        clerkEventType: event.type,
    });
    if (claim.duplicate) {
        console.log('♻️ Clerk duplicate webhook ignored:', event.type, idempotencyKey);
        return res
            .status(200)
            .json({ received: true, duplicate: true, attemptCount: claim.record?.attemptCount });
    }

    try {
        const internal = normalizeClerkEvent(event);
        const ctx = { svixId };
        switch (internal.kind) {
            case 'USER_UPSERT':
                await upsertUserFromClerk(internal.user, internal.clerkEventType, ctx);
                break;
            case 'USER_DELETE':
                await softDeleteUser(internal.userId, internal.clerkEventType, ctx);
                break;
            case 'MEMBERSHIP':
                await applyMembership(
                    internal.payload,
                    internal.op,
                    internal.clerkEventType,
                    ctx
                );
                break;
            case 'NOOP':
                console.info('[clerkWebhooks] ignored event:', internal.clerkEventType);
                break;
        }
        await completeWebhook('clerk', idempotencyKey);
        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('[clerkWebhooks] handler error:', err);
        await failWebhook('clerk', idempotencyKey, wbErrorMessage(err)).catch(() => undefined);
        return res.status(500).json({ error: 'handler_failed' });
    }
});

export default router;
