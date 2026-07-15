# Stripe Event Matrix

How Stripe webhook events update MongoDB billing projection.

**Handler entry:** `POST /webhook/stripe` → `claimWebhook` → `dispatchStripeEvent`

## Subscription lifecycle

| Event | Mongo update | Notes |
|-------|--------------|-------|
| `checkout.session.completed` (mode=subscription) | `org_plan_states`: planId, stripe IDs, status active/trialing; seed `credit_balances` | Idempotent via session id |
| `checkout.session.completed` (mode=payment, metadata purchaseType=video_pack) | `credit_balances.purchasedVideoSeconds` += minutes; `credit_ledger` video_pack entry | Never debits credits |
| `customer.subscription.updated` | planId, billingCycle, status, periodEnd, cancelAtPeriodEnd | Unknown price → skip, log error |
| `customer.subscription.deleted` | status canceled; entitlements per policy | |
| `invoice.paid` | Refresh period; reset included video minutes; monthly credit allowance | Race-safe / idempotent |
| `invoice.payment_failed` | status past_due | `consumeCredits` blocked |

## Idempotency

| Store | Key |
|-------|-----|
| `processed_webhooks` | Stripe `event.id` |
| `credit_ledger` | `(organizationId, idempotencyKey)` |
| `usage_reservations` | `(organizationId, idempotencyKey)` |

## Retry policy

- Duplicate `event.id` with status `completed` → 200 duplicate
- Duplicate with status `failed` or stale `processing` (>15 min) → retry allowed
- Unknown event types → 200 no-op (intentional)

## Local testing

```bash
stripe listen --forward-to localhost:5000/webhook/stripe
```

Set `STRIPE_WEBHOOK_SECRET` from CLI output.

## Video pack metadata (checkout.session.completed)

Required session metadata:

- `organizationId`
- `purchaseType`: `video_pack`
- `minutes`: pack size (50 × quantity)
- `planId`: team | professional | business

Pack catalog price: **$20** for all video-capable plans (Stripe Price ID in env per plan).
