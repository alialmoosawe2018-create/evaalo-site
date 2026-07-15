# Billing Status API v2

`GET /api/billing/status` — requires auth + `billing.read` permission.

## Response shape

```json
{
  "ok": true,
  "apiVersion": 2,
  "organization": {
    "id": "org_xxx",
    "permissions": {
      "billingRead": true,
      "billingWrite": false,
      "canManageBilling": false
    }
  },
  "configured": true,
  "planId": "team",
  "subscriptionStatus": "active",
  "billingCycle": "monthly",
  "periodEnd": "2026-08-01T00:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "creditsRemaining": 1200,
  "monthlyCredits": 1500,
  "balanceMicro": 1200000000,
  "remainingIncludedVideoSeconds": 1800,
  "remainingPurchasedVideoSeconds": 0,
  "canBuyVideoPack": true,
  "videoPackMinutes": 50,
  "videoPackPriceUsd": 20,
  "lifecycleState": "subscription_active",
  "pendingCheckoutPlanId": null,
  "subscription": {
    "status": "active",
    "interval": "monthly",
    "periodEnd": "2026-08-01T00:00:00.000Z",
    "cancelAtPeriodEnd": false,
    "lifecycleState": "subscription_active",
    "pendingCheckoutPlanId": null
  },
  "plan": {
    "officialPlanId": "team",
    "displayNameKey": "billing_plan_team",
    "legacyPlanCode": null,
    "resolutionError": null
  },
  "usage": {
    "credits": {
      "monthlyAllowance": 1500,
      "remaining": 1200,
      "usedThisPeriod": 300
    },
    "video": {
      "includedMinutesRemaining": 30,
      "purchasedMinutesRemaining": 0
    }
  }
}
```

## UI rules

- Show **credits** as `remaining / monthlyAllowance` — never label invoice dollars as credits.
- **`lifecycleState`**: UI must not switch displayed plan until `subscription_active`. Values:
  - `checkout_created` — Stripe Checkout open (pending session on org)
  - `payment_pending` — e.g. `past_due`
  - `payment_confirmed` — subscription created, activation in flight
  - `subscription_active` — confirmed active/trialing
  - `null` — no subscription or canceled
- Show **video** as included + purchased minutes separately.
- `videoPackPriceUsd` is always **$20** for Team, Professional, Business (50-minute pack).
- If `configured: false`, show catalog default for marketing only; block paid actions.
- Plan changes in UI must follow webhook-confirmed `planId` from this endpoint (not optimistic local state).

## Errors

| HTTP | Meaning |
|------|---------|
| 403 `ORG_REQUIRED` | Production request without Clerk org context |
| 403 `forbidden_permission` | Missing `billing.read` |
| 500 | Mongo/runtime failure |

`canManageBilling` is `true` when the caller is **OWNER** and has `billing.write` (local dev with `ENFORCE_AUTH=off` assigns OWNER to `dev_org_*` tenants).

## Related endpoints

- `GET /api/billing/catalog/public` — plan catalog + credit costs (no Stripe IDs)
- `docs/local-billing-testing.md` — local dev checklist
- `POST /api/billing/checkout` — Owner-only (`billing.write` + role OWNER)
- `POST /api/billing/video-pack/checkout` — 50 min pack checkout
