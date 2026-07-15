/**
 * POST /webhook/stripe — Phase 2b
 *
 * CRITICAL: must be mounted BEFORE `express.json()` in server.ts so the
 * raw body Buffer is available for signature verification.
 *
 * Pipeline:
 *   1. express.raw → req.body is Buffer
 *   2. stripeService.verifyWebhookSignature(rawBody, sig) — drops invalid signatures
 *   3. webhookIdempotency.claimWebhook('stripe', event.id) — Stripe replays the same
 *      event.id on retry; ProcessedWebhook unique index blocks duplicates.
 *   4. dispatchStripeEvent → translator handlers → billingRuntimeService.apply*
 *   5. completeWebhook on success → 200 OK
 *      failWebhook on handler error → 500 (Stripe will retry)
 *      unknown event.type → 200 OK no-op (Stripe stops retrying)
 *
 * The endpoint is intentionally NOT behind requireAuth — caller is Stripe, not a user.
 * Signature verification is the only trust boundary that matters.
 */

import type { Request, Response } from 'express';
import { verifyWebhookSignature } from '../services/stripeService.js';
import {
    claimWebhook,
    completeWebhook,
    failWebhook,
    errorMessage as wbErrorMessage,
} from '../services/webhookIdempotency.js';
import { dispatchStripeEvent } from '../services/stripeWebhookHandlers.js';

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
    const sig = req.headers['stripe-signature'];
    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
        // express.json() ran before us, or the route wasn't mounted with express.raw.
        console.error(
            '[stripe] webhook received non-Buffer body — verify express.raw mount order in server.ts.',
        );
        res.status(400).json({ error: 'invalid_body' });
        return;
    }

    let event;
    try {
        event = verifyWebhookSignature(rawBody, sigStr);
    } catch (err) {
        console.warn(
            `[stripe] webhook signature verification failed: ${wbErrorMessage(err)}`,
        );
        res.status(400).json({ error: 'invalid_signature' });
        return;
    }

    const idempotencyKey = event.id;
    const claim = await claimWebhook('stripe', idempotencyKey, {
        eventType: event.type,
    });

    if (claim.duplicate) {
        console.log(
            `[stripe] duplicate event ignored — id=${event.id} type=${event.type} status=${claim.record?.status} attempt=${claim.record?.attemptCount}`,
        );
        res.status(200).json({ received: true, duplicate: true });
        return;
    }

    if (claim.reclaimed) {
        console.log(
            `[stripe] reclaimed event for retry — id=${event.id} type=${event.type} attempt=${claim.record?.attemptCount}`,
        );
    }

    try {
        const { handled } = await dispatchStripeEvent(event);
        await completeWebhook('stripe', idempotencyKey);
        if (!handled) {
            console.log(`[stripe] event type=${event.type} not handled (no-op).`);
        }
        res.status(200).json({ received: true, handled });
    } catch (err) {
        const message = wbErrorMessage(err);
        console.error(
            `[stripe] handler error for event=${event.type} id=${event.id}:`,
            err,
        );
        await failWebhook('stripe', idempotencyKey, message).catch(() => undefined);
        res.status(500).json({ error: 'handler_failed', message });
    }
}
