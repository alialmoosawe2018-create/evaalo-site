# Billing API Routes

Base: `/api/billing` — all routes except `catalog/public` require auth.

## Public catalog

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/catalog/public` | No | 4 plans, credit costs, video pack $20/50min |

## Status & checkout

| Method | Path | Permission | Owner only |
|--------|------|------------|------------|
| GET | `/status` | billing.read | No |
| POST | `/checkout` | billing.write | **Yes** |
| POST | `/video-pack/checkout` | billing.write | **Yes** |
| POST | `/change-plan` | billing.write | **Yes** (deprecated → 410 unless BILLING_DEV_TOOLS) |

## Customer portal

| Method | Path | Permission | Owner only |
|--------|------|------------|------------|
| GET | `/portal/summary` | auth | No |
| GET | `/portal/invoices` | auth | No |
| POST | `/portal/session` | billing.write | **Yes** |
| POST | `/portal/cancel` | billing.write | **Yes** |
| POST | `/portal/resume` | billing.write | **Yes** |
| POST | `/portal/payment-method` | billing.write | **Yes** |
| POST | `/portal/payment-method/complete` | billing.write | **Yes** |

## Dev-only (BILLING_DEV_TOOLS=true in dev, or BILLING_ADMIN_KEY in prod)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/seed` | Initialize org billing |
| POST | `/adjust` | Manual credit adjustment |

## Credit costs (intelligence pool)

| Operation | Credits |
|-----------|---------|
| Voice interview | 15 / min |
| AI Head Hunter search | 6 / candidate |
| Top candidate report | 5 |
| Application screening | 2 |
| CV analysis | 2 |
| Job advertisement | 1 |
| Contact reveal | 1 / piece |

Video uses **included minutes** first, then **$20 video pack** (50 min). Fallback: 35 credits/min if no minutes left.

## Dev org isolation

When `ENFORCE_AUTH=off` (non-production): each user gets `dev_org_<userId>` instead of shared `org_default`.

Production: missing Clerk org → `403 ORG_REQUIRED` on billing routes.

## Scripts

```bash
# Stripe ↔ Mongo reconcile (dry-run default)
npx tsx src/scripts/sync-stripe-subscription.ts --dry-run

# Phase 2b webhook verification
npx tsx src/scripts/verify-billing-phase2b.ts

# Reservation + billing health report
npx tsx src/scripts/reconcile-billing-health.ts --dry-run
```
