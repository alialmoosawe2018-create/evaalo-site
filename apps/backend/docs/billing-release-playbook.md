# Billing Release Playbook

Mandatory path before production billing changes (Phase 4.6).

## Pre-release checklist

### 1. Local verification

```bash
cd apps/backend
npm run type-check
npm run verify:billing
```

With Stripe CLI (separate terminal):

```bash
stripe listen --forward-to localhost:5000/webhook/stripe
```

Manual E2E (see `docs/local-billing-testing.md`):

- [ ] New subscription checkout (monthly)
- [ ] Plan change via portal
- [ ] Cancel at period end + resume
- [ ] Video pack $20 purchase
- [ ] Voice/video usage reservation + debit
- [ ] Head Hunter search debit (6 credits/candidate)
- [ ] `GET /api/billing/status` shows `lifecycleState: subscription_active` after checkout

### 2. Frontend build

```bash
cd apps/frontend
npm run build
```

### 3. Environment review (production)

- [ ] All 8 `STRIPE_PRICE_*` subscription env vars set (test → live IDs swapped)
- [ ] 3 `STRIPE_PRICE_VIDEOPACK_*` at **$20** in Stripe Dashboard
- [ ] `STRIPE_WEBHOOK_SECRET` for production endpoint
- [ ] `ENFORCE_AUTH=on`, `BILLING_DEV_TOOLS` unset/false
- [ ] `BILLING_ENFORCE=true`
- [ ] Clerk org required (no `org_default` fallback)
- [ ] Boot log: `[stripePrices] OK`

### 4. Mongo snapshot (before migration)

Export before any schema migration:

```bash
# org_plan_states, credit_balances, credit_ledger
mongodump --uri="$MONGODB_URI" --collection=org_plan_states --out=billing-backup-$(date +%Y%m%d)
mongodump --uri="$MONGODB_URI" --collection=credit_balances --out=billing-backup-$(date +%Y%m%d)
mongodump --uri="$MONGODB_URI" --collection=credit_ledger --out=billing-backup-$(date +%Y%m%d)
```

Record mapping: Stripe Customer ID → organizationId → planId for each tenant.

## Deploy sequence

1. Merge PR after review + CI green (`billing-verify.yml`)
2. Deploy backend with new env vars (no code deploy before env review)
3. Deploy frontend
4. Register production webhook in Stripe Dashboard → `/webhook/stripe`
5. Webhook smoke: `stripe trigger checkout.session.completed` (test mode staging first)
6. Run reconciliation dry-run:

```bash
npx tsx src/scripts/reconcile-billing-health.ts --dry-run
```

7. Monitor for 24h: webhook failures, stuck `processing`, reservation leaks

## Rollback

1. Revert deploy to previous image/tag
2. Do **not** auto-reset Mongo billing collections
3. If Stripe/Mongo drift: use `sync-stripe-subscription.ts --mirror-only` per org with approval
4. Restore from mongodump only with explicit approval

## Post-release

- [ ] Update `BILLING_LEGACY_PRICE_MAP` if retiring old Stripe price IDs
- [ ] Announce plan/credit changes to support team
- [ ] Verify first live checkout + invoice in Stripe Dashboard
