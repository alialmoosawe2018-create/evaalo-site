# Evaalo Billing Product Contract (Phase 0)

**Status:** Adopted — Option A (unified intelligence credits + separate video minutes)

## Official plans (checkout)

| planId | Display | Monthly price (USD) | monthlyCredits | includedVideoMinutes |
|--------|---------|---------------------|----------------|----------------------|
| `starter` | Starter | $39 | 500 | 0 |
| `team` | Team | $99 | 1,500 | 50 |
| `professional` | Professional | $189 | 3,500 | 100 |
| `business` | Business | $359 | 7,000 | 150 |

There is **no** `enterprise` planId. Legacy i18n keys may say Enterprise; UI maps to Business.

## Usage model (Option A)

### Unified intelligence credits

Each plan grants one **monthly pool** of intelligence credits (`monthlyCredits`). Metered operations debit this pool via `billingEngine` / `CREDIT_COST_MICRO`:

| Operation | Cost |
|-----------|------|
| Voice interview | 15 credits / minute |
| Video (after included minutes exhausted) | 35 credits / minute |
| AI Head Hunter search | 6 credits / candidate |
| Application screening | 2 credits / action |
| Top candidate report | 5 credits / action |
| CV analysis | 2 credits / action |
| Job advertisement | 1 credit / action |

**There is no separate voice or search minutes bucket.** UI shows remaining credits + operation cost table (Pricing page pattern).

### Video minutes (separate bucket)

- Included video minutes reset each billing period per plan.
- Purchased video packs (50 min) are **never** deducted from credits.
- Pack price: **$20** for 50 minutes (Team, Professional, Business — same price). Starter has no video pack.

## Source of truth

| Layer | Owns |
|-------|------|
| Stripe | Payments, subscriptions, invoices, proration |
| MongoDB | Org plan projection, credit balance, video seconds, ledger |
| Clerk | Identity, org membership, RBAC |
| `billingPlans.ts` | Catalog data (plans, credits, features) |
| `stripePrices.ts` | Stripe Price ID env mapping |

Frontend reads catalog via `GET /api/billing/catalog/public` (Phase 0+) or mirror until migrated. Never embed Stripe Price IDs in UI.

## Legacy mapping

Current `.env` Stripe prices map **1:1** to official plans. Legacy table applies only to **retired** Stripe Price IDs:

```
old_price_id → officialPlanId (starter | team | professional | business)
```

**Forbidden:** `unknown → starter` (silent). Unknown → `planResolutionError` in API + error banner in UI.

## Plan changes (Stripe)

- **Upgrade:** typically immediate with proration (Stripe Customer Portal / Checkout).
- **Downgrade:** may schedule at period end (subscription schedule).
- FAQ must not claim all changes wait until next cycle.

## Dev isolation

When `ENFORCE_AUTH=off` and not production: each Clerk user gets `dev_org_<userId>` instead of shared `org_default`.

## API status shape (v2 direction)

```typescript
usage: {
  credits: { monthlyAllowance, remaining, usedThisPeriod },
  video: { includedMinutesRemaining, purchasedMinutesRemaining },
}
billing: {
  nextInvoiceEstimateCents,
  outstandingBalanceCents,
  currency: 'usd',
}
```

Money fields are **never** labeled as credits in the UI.
