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
import { recordSiteErrorAsync } from '../services/siteErrorService.js';

/**
 * Event types where "we did not process this" means a customer paid and received
 * nothing. Everything else Stripe sends is safe to no-op.
 */
const MONEY_EVENTS = new Set(['checkout.session.completed', 'invoice.paid']);

/**
 * Surface a webhook failure in `site_errors`.
 *
 * Until now every failure below was a `console.log` only, which means the one
 * defect that costs real money — Stripe charges the card, we never credit the
 * account — was invisible until a customer complained. A wrong
 * STRIPE_WEBHOOK_SECRET drops *every* payment this way and looks perfectly
 * healthy from the outside.
 *
 * The message deliberately carries the event TYPE but never the event ID: the
 * id changes per delivery and siteErrorService fingerprints on the message, so
 * including it would turn one broken secret into thousands of rows instead of a
 * single row with a rising `count`. The id goes in breadcrumbs, which is not
 * fingerprinted.
 */
/**
 * Stripe's SDK errors carry several lines of documentation links after the
 * actual reason. Keeping only the first line makes the alert readable and keeps
 * the fingerprint stable when Stripe edits its help text.
 */
function firstLine(text: string): string {
    return String(text).split('\n')[0].trim();
}

function reportWebhookFailure(
    message: string,
    httpStatus: number,
    eventId?: string,
): void {
    recordSiteErrorAsync({
        source: 'backend',
        severity: 'error',
        message,
        route: '/webhook/stripe',
        method: 'POST',
        httpStatus,
        breadcrumbs: eventId ? [{ eventId }] : undefined,
    });
}

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
    const sig = req.headers['stripe-signature'];
    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
        // express.json() ran before us, or the route wasn't mounted with express.raw.
        console.error(
            '[stripe] webhook received non-Buffer body — verify express.raw mount order in server.ts.',
        );
        // Only alert when the caller looked like Stripe. express.raw is typed to
        // application/json, so ANY junk POST to this public path lands here — and
        // an internet scanner must not be able to raise "every payment is being
        // dropped" at 3am. Real Stripe always sends both the JSON content type and
        // a signature header, so a missing signature means it was never Stripe.
        if (sigStr) {
            reportWebhookFailure(
                'stripe webhook: signed request arrived with a non-Buffer body (express.raw mount order broken) — every payment is being dropped',
                400,
            );
        }
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
        // The highest-value alert in this file. Stripe is reaching us and we are
        // rejecting it — normally a stale STRIPE_WEBHOOK_SECRET after a key
        // rotation or a test→live cutover.
        reportWebhookFailure(
            `stripe webhook: signature verification failed (${firstLine(wbErrorMessage(err))}) — check STRIPE_WEBHOOK_SECRET`,
            400,
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
            // Unhandled is the normal, correct outcome for the event types the
            // dashboard subscribes to beyond the five we translate. It is only a
            // defect for the two that move money — and because the event is
            // marked complete above, Stripe will not retry it.
            if (MONEY_EVENTS.has(event.type)) {
                reportWebhookFailure(
                    `stripe webhook: money event ${event.type} was NOT handled — customer paid and the account was not credited`,
                    200,
                    event.id,
                );
            }
        }
        res.status(200).json({ received: true, handled });
    } catch (err) {
        const message = wbErrorMessage(err);
        console.error(
            `[stripe] handler error for event=${event.type} id=${event.id}:`,
            err,
        );
        reportWebhookFailure(
            `stripe webhook: handler failed for ${event.type} (${firstLine(message)})`,
            500,
            event.id,
        );
        await failWebhook('stripe', idempotencyKey, message).catch(() => undefined);
        res.status(500).json({ error: 'handler_failed', message });
    }
}
