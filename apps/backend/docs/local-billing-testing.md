# Local Billing Testing Guide

Step-by-step checklist for testing Evaalo billing on `localhost` (frontend `:3000`, backend `:5000`).

## 1. Environment (`apps/backend/.env`)

```env
NODE_ENV=development
ENFORCE_AUTH=off
BILLING_DEV_TOOLS=true
BILLING_ENFORCE=true
RBAC_ENFORCEMENT=off

MONGODB_URI=mongodb://...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from stripe listen output

# Subscription prices (test mode — monthly only)
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_PROFESSIONAL_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...

# Video packs — $20 / 50 minutes (Team, Professional, Business)
STRIPE_PRICE_VIDEOPACK_TEAM=price_...
STRIPE_PRICE_VIDEOPACK_PROFESSIONAL=price_...
STRIPE_PRICE_VIDEOPACK_BUSINESS=price_...
```

Restart the backend after changing `.env`. Boot logs should show `[stripePrices] OK` or warnings for missing price vars.

## 2. Stripe CLI webhook forwarding

**Recommended (auto-syncs API key + webhook secret):**

```bash
cd apps/backend
npm run stripe:listen
```

This runs `stripe listen --forward-to localhost:5000/webhook/stripe` using `STRIPE_SECRET_KEY` from `.env` and writes the `whsec_...` signing secret back into `.env`. **Restart the backend** after the secret is written.

**Or from the monorepo root** (backend + frontend + Stripe listener):

```bash
npm run dev:billing
```

Manual alternative:

```bash
stripe listen --forward-to localhost:5000/webhook/stripe --api-key sk_test_...
```

Copy the `whsec_...` secret into `STRIPE_WEBHOOK_SECRET`.

### Success-page fallback (dev + prod)

After Checkout, Stripe redirects to `/account/billing/success?session_id=...`. The frontend calls `POST /api/billing/checkout/complete` with that `sessionId` so the plan activates even if webhooks are delayed. Production still relies on webhooks; this path is idempotent and safe alongside them.

## 3. Dev org isolation

With `ENFORCE_AUTH=off`, each user gets `dev_org_<userId>` instead of shared `org_default`. The dev auth helper assigns **OWNER** + `billing.write` so checkout works without Clerk org.

## 4. Quick seed (no Stripe)

Seed credits and plan state directly:

```bash
cd apps/backend
BILLING_SEED_USER_ID=user_local_test BILLING_SEED_PLAN=team npx tsx src/scripts/seed-local-billing.ts
```

Or via HTTP (requires `BILLING_DEV_TOOLS=true`):

```bash
curl -X POST http://localhost:5000/api/billing/seed \
  -H "Content-Type: application/json" \
  -d '{"planId":"team"}'
```

## 5. API smoke tests

| Test | Endpoint | Expected |
|------|----------|----------|
| Catalog | `GET /api/billing/catalog/public` | 4 plans, credit costs, video pack $20 |
| Status v2 | `GET /api/billing/status` | `apiVersion: 2`, `usage.credits`, `usage.video`, `canManageBilling: true` (dev OWNER) |
| Checkout | `POST /api/billing/checkout` `{ planId, cycle, requestId }` | Stripe Checkout URL |
| Checkout complete | `POST /api/billing/checkout/complete` `{ sessionId }` | Applies paid session (success-page fallback) |
| Portal | `POST /api/billing/portal` | Stripe Customer Portal URL (after subscription) |
| Adjust credits | `POST /api/billing/adjust` `{ credits: 100 }` | Dev-only balance change |

## 6. UI flows

1. **Pricing page** (`/pricing`) — monthly prices; authenticated users start checkout.
2. **Account → Billing** — real credits (not invoice amount), cancel/resume banners, Stripe return refetch.
3. **Adjust plan modal** — monthly checkout, video pack purchase ($20).
4. **Invoices** — historical plan name from Stripe price on line items.

## 7. Usage metering (`BILLING_ENFORCE=true`)

| Feature | Cost | How to verify |
|---------|------|---------------|
| Voice interview | 15 credits/min | Start voice session; reservation → finalize on end |
| Video interview | Video minutes bucket | Team+ plans; pack adds 50 min |
| Head Hunter search | 6 credits/candidate | Preflight on `POST /api/head-hunter/search`; debit on n8n inbound |
| Contact reveal | 1 credit | Head Hunter reveal endpoint |
| Voice Reception | Exempt | `RECEPTION_BILLING_MODE=exempt` (default) |

Disable metering temporarily: `BILLING_ENFORCE=false`.

## 8. Automated verification scripts

```bash
cd apps/backend
npm run verify:billing-smoke
# or individually:
npx tsx src/scripts/verify-billing-phase2a.ts
npx tsx src/scripts/verify-billing-phase2b.ts
```

## 9. Common issues

| Symptom | Fix |
|---------|-----|
| `billing_checkout_failed` | Missing `STRIPE_PRICE_*` for plan/cycle; check boot warnings |
| Portal 500 | Stale subscription schedule — use checkout recovery flow |
| Wrong plan shown | Old `org_default` data — use `dev_org_*` or re-seed |
| Webhook not applied | Run `npm run stripe:listen`; restart backend after `whsec` is written; success page also calls `/checkout/complete` |
| Checkout forbidden | Need OWNER + `billing.write` (auto in dev org isolation) |
| Video pack wrong price | Create $20 one-time Price in Stripe Dashboard; update env vars |

## 10. Production release

See `docs/billing-release-playbook.md` for deploy/rollback checklist.

## 11. Production differences

- `ENFORCE_AUTH=on` — real Clerk org required; no `org_default` fallback (`403 ORG_REQUIRED`).
- `BILLING_DEV_TOOLS` must be unset/false — seed/adjust/change-plan blocked.
- All 8 subscription price env vars required at boot (fail-fast).
