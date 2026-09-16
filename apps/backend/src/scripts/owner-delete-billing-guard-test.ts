/**
 * owner-delete-billing-guard-test
 *
 * The bug this locks down (production, 2026-09-16): an owner cancelled their
 * organization subscription, pressed delete, and got the SAME "cancel your
 * subscription first" 409 — forever. Stripe keeps a cancelled subscription at
 * status 'active' until the paid period ends, so a guard reading only the
 * status could never see the cancellation; the row carried cancelAtPeriodEnd
 * true and subscriptionStatus 'active' side by side, and deletion would not
 * have unblocked until the period expired a month later.
 *
 * This runs the REAL exported predicate — no Express, no Mongo, no network —
 * and then proves the fix is not dead code by re-running every case through a
 * faithful copy of the OLD rule and asserting it disagrees exactly where it
 * should.
 *
 * Run: npm run test:owner-delete-guard
 */
import { ownerDeleteBlockedByBilling } from '../routes/userProfile.js';
import type { SubscriptionStatus } from '../types/billing.js';

type Plan = Parameters<typeof ownerDeleteBlockedByBilling>[0];

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: boolean, expected: boolean): void {
    if (actual === expected) {
        passed++;
        console.log(`  ok    ${label} -> blocked=${actual}`);
    } else {
        failures.push(`${label}: expected blocked=${expected}, got ${actual}`);
        console.log(`  FAIL  ${label} -> expected ${expected}, got ${actual}`);
    }
}

const ACTIVE = 'active' as SubscriptionStatus;
const TRIALING = 'trialing' as SubscriptionStatus;
const CANCELED = 'canceled' as SubscriptionStatus;
const SUB = 'sub_1UC3TRP09V1we6EYY651ebPn';

/** The exact shape of the production row that produced the bug report. */
const PRODUCTION_ROW: Plan = {
    stripeSubscriptionId: SUB,
    subscriptionStatus: ACTIVE,
    cancelAtPeriodEnd: true,
};

const cases: Array<{ label: string; plan: Plan; live: boolean; blocked: boolean }> = [
    // ---- the reported bug: this is the case that must now pass through ----
    {
        label: 'THE BUG: production row, cancelled at period end, still "active"',
        plan: PRODUCTION_ROW,
        live: true,
        blocked: false,
    },
    {
        label: 'trialing subscription cancelled at period end',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: TRIALING, cancelAtPeriodEnd: true },
        live: true,
        blocked: false,
    },

    // ---- the guard must still do its job ----
    {
        label: 'live paying subscription, not cancelled',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: ACTIVE, cancelAtPeriodEnd: false },
        live: true,
        blocked: true,
    },
    {
        label: 'trialing, not cancelled',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: TRIALING, cancelAtPeriodEnd: false },
        live: true,
        blocked: true,
    },
    {
        label: 'legacy row written before the flag existed (undefined)',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: ACTIVE },
        live: true,
        blocked: true,
    },
    {
        label: 'flag explicitly null — unknown is not cancelled',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: ACTIVE, cancelAtPeriodEnd: null },
        live: true,
        blocked: true,
    },

    // ---- everything that was already allowed must stay allowed ----
    {
        label: 'free org, no Stripe subscription (8 of 9 production orgs)',
        plan: { subscriptionStatus: ACTIVE, cancelAtPeriodEnd: false },
        live: true,
        blocked: false,
    },
    {
        label: 'subscription already fully canceled',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: CANCELED, cancelAtPeriodEnd: false },
        live: true,
        blocked: false,
    },
    {
        label: 'test mode never blocks',
        plan: { stripeSubscriptionId: SUB, subscriptionStatus: ACTIVE, cancelAtPeriodEnd: false },
        live: false,
        blocked: false,
    },
    { label: 'no plan row at all', plan: null, live: true, blocked: false },
    { label: 'plan undefined', plan: undefined, live: true, blocked: false },
];

console.log('\n=== ownerDeleteBlockedByBilling ===');
for (const c of cases) {
    check(c.label, ownerDeleteBlockedByBilling(c.plan, c.live), c.blocked);
}

/**
 * Mutation proof. A faithful copy of the rule as it stood before the fix —
 * status only, flag never read. If the new predicate were dead code the two
 * would agree everywhere, and this section would report zero divergence.
 */
function oldRule(plan: Plan, liveMode: boolean): boolean {
    return Boolean(plan?.stripeSubscriptionId && isActiveLike(plan.subscriptionStatus) && liveMode);
}
function isActiveLike(s: SubscriptionStatus | null | undefined): boolean {
    return s === ACTIVE || s === TRIALING;
}

console.log('\n=== MUTATION PROOF: old rule vs new rule ===');
const divergences = cases.filter(
    (c) => oldRule(c.plan, c.live) !== ownerDeleteBlockedByBilling(c.plan, c.live),
);
for (const d of divergences) {
    console.log(`  changed  ${d.label}: old blocked=true, new blocked=false`);
}
const expectedDivergences = 2; // the two cancel-at-period-end cases, and only those
if (divergences.length === expectedDivergences) {
    passed++;
    console.log(`  ok    exactly ${expectedDivergences} cases changed behaviour`);
} else {
    failures.push(
        `mutation proof: expected ${expectedDivergences} divergences, got ${divergences.length}`,
    );
    console.log(`  FAIL  expected ${expectedDivergences} divergences, got ${divergences.length}`);
}
if (divergences.every((d) => d.plan?.cancelAtPeriodEnd === true)) {
    passed++;
    console.log('  ok    every changed case is one the owner had already cancelled');
} else {
    failures.push('mutation proof: a case changed that was NOT cancelled at period end');
    console.log('  FAIL  a case changed that was NOT cancelled at period end');
}

console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passed} assertions passed`);
if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
