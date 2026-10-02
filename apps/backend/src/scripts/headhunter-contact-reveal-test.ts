/**
 * headhunter-contact-reveal-test
 *
 * THE RULE (owner decision, 2026-10-02): pressing the lock on a Head Hunter card
 * charges 1 credit for EACH contact method the candidate has - the LinkedIn link,
 * the email and the phone. A candidate with only a LinkedIn profile costs 1 credit;
 * one with all three costs 3. Each method is charged once per organisation and
 * candidate, never twice. (A change that made the LinkedIn link free was built and
 * reverted the same day, before it was ever deployed; this test locks the rule in.)
 *
 * Part 1 runs the REAL frontend helpers next to the REAL backend ones: the number
 * of pieces the card shows and the fields the server charges must agree.
 * Part 2 drives the real executeContactReveal on a real mongod replica set (so the
 * production transaction path runs) and checks the balance and the ledger.
 * Synthetic data only.
 *
 * Run: npm run test:headhunter-contact-reveal
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import OrgPlanState from '../models/OrgPlanState.js';
import HeadHunterContactReveal from '../models/HeadHunterContactReveal.js';
import {
    executeContactReveal,
    parseAvailableContactFields,
    resolveCandidateKey,
} from '../services/contactRevealService.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';

const FRONTEND_UTILS = new URL('../../../frontend/src/utils/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reveal: any = await import(`${FRONTEND_UTILS}headHunterContactReveal.js`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const channels: any = await import(`${FRONTEND_UTILS}headHunterContactChannels.js`);

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a: readonly string[]) => [...a].sort();

const LI = (n: number) => `https://www.linkedin.com/in/example-candidate-${n}`;
const PHONE = '+1 555 000 0001';
const EMAIL = 'candidate@example.com';

type Cand = { id: string; linkedin_url?: string; phone?: string; email?: string };
const C_LINK: Cand = { id: 'c1', linkedin_url: LI(1) };
const C_PHONE: Cand = { id: 'c2', linkedin_url: LI(2), phone: PHONE };
const C_ALL: Cand = { id: 'c3', linkedin_url: LI(3), phone: PHONE, email: EMAIL };
const C_ALL_2: Cand = { id: 'c5', linkedin_url: LI(5), phone: PHONE, email: EMAIL };
const C_NOTHING: Cand = { id: 'c4' };
const bodyOf = (c: Cand) => ({ candidateKey: reveal.candidateRevealKey(c), phone: c.phone, email: c.email, linkedin: c.linkedin_url });

function partParity(): void {
    console.log('\nPART 1 — the card and the server count the same pieces');
    const pieces = (c: Cand) => reveal.countRevealPieces(channels.buildHeadHunterContactChannels(c));
    check('LinkedIn only: 1 piece on the card (the lock shows)', pieces(C_LINK) === 1);
    check('LinkedIn only: both sides list ["linkedin"]',
        same(reveal.availableRevealFieldsForCandidate(C_LINK), ['linkedin']) && same(parseAvailableContactFields(bodyOf(C_LINK)), ['linkedin']));
    check('phone + LinkedIn: 2 pieces, both sides list phone and linkedin',
        pieces(C_PHONE) === 2
        && same(sorted(reveal.availableRevealFieldsForCandidate(C_PHONE)), ['linkedin', 'phone'])
        && same(sorted(parseAvailableContactFields(bodyOf(C_PHONE))), ['linkedin', 'phone']));
    check('phone + email + LinkedIn: 3 pieces, both sides list all three',
        pieces(C_ALL) === 3
        && same(sorted(reveal.availableRevealFieldsForCandidate(C_ALL)), ['email', 'linkedin', 'phone'])
        && same(sorted(parseAvailableContactFields(bodyOf(C_ALL))), ['email', 'linkedin', 'phone']));
    check('nothing at all: 0 pieces, no lock', pieces(C_NOTHING) === 0);
    for (const c of [C_LINK, C_PHONE, C_ALL]) {
        check(`candidate key parity (${c.id}): card == server`,
            reveal.candidateRevealKey(c) === resolveCandidateKey({ linkedin: c.linkedin_url, phone: c.phone, email: c.email }));
    }
    const paidLinkOnly = reveal.mergeRevealRecord(new Map(), reveal.candidateRevealKey(C_PHONE), { revealedFields: ['linkedin'] });
    check('a paid LinkedIn alone does not unlock a card that also has a phone', reveal.isContactFullyRevealed(C_PHONE, paidLinkOnly) === false);
    const paidBoth = reveal.mergeRevealRecord(new Map(), reveal.candidateRevealKey(C_PHONE), { revealedFields: ['phone', 'linkedin'] });
    check('paying every piece unlocks the card', reveal.isContactFullyRevealed(C_PHONE, paidBoth) === true);
}

const ORG = 'org_test_contact_reveal';
const START_CREDITS = 10;

async function balanceCredits(): Promise<number> {
    const b = await CreditBalance.findOne({ organizationId: ORG }).lean();
    return (b?.balanceMicro ?? -1) / MICRO_PER_CREDIT;
}
const ledgerFields = async () =>
    (await CreditLedger.find({ organizationId: ORG, usageType: 'CONTACT_REVEAL' }).lean())
        .map((r) => String((r.metadata as { field?: string })?.field));
const audit = { actorClerkUserId: 'user_test', actorEmail: 'tester@example.com' };
const run = (c: Cand) => executeContactReveal({ organizationId: ORG, body: bodyOf(c), clerkUserId: 'user_test', auditPayload: audit });

async function partLifecycle(): Promise<void> {
    console.log('\nPART 2 — the real reveal on a real replica set (transaction path)');
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400_000);
    await OrgPlanState.create({
        organizationId: ORG, planId: 'starter', billingProvider: 'manual', subscriptionStatus: 'active',
        billingCycle: 'monthly', currentPeriodStart: now, currentPeriodEnd: end,
    });
    await CreditBalance.create({
        organizationId: ORG, balanceMicro: START_CREDITS * MICRO_PER_CREDIT,
        periodStart: now, periodEnd: end, refreshedFromPlanAt: now,
    });

    const a = await run(C_LINK);
    check('LinkedIn only: 1 credit', a.ok && a.creditsCharged === 1 && same(a.newlyRevealedFields, ['linkedin']), JSON.stringify(a));
    check('   ...balance down by exactly 1', (await balanceCredits()) === START_CREDITS - 1);
    const a2 = await run(C_LINK);
    check('pressing the lock again is free (already revealed)', a2.ok && a2.alreadyRevealed === true && a2.creditsCharged === 0);
    check('   ...balance unchanged', (await balanceCredits()) === START_CREDITS - 1);

    const b = await run(C_ALL);
    check('phone + email + LinkedIn: 3 credits, one per method',
        b.ok && b.creditsCharged === 3 && same(sorted(b.ok ? b.newlyRevealedFields : []), ['email', 'linkedin', 'phone']), JSON.stringify(b));
    check('   ...balance down by exactly 3 more', (await balanceCredits()) === START_CREDITS - 4);
    check('   ...one ledger row per method so far (linkedin, then linkedin + phone + email)',
        same(sorted(await ledgerFields()), ['email', 'linkedin', 'linkedin', 'phone']));

    // The candidate later gains a phone: only the new method is charged.
    const c = await run({ ...C_LINK, phone: PHONE });
    check('a method added later costs only that method (1 credit for the phone)',
        c.ok && c.creditsCharged === 1 && same(c.newlyRevealedFields, ['phone']), JSON.stringify(c));
    check('   ...balance down by exactly 1 more', (await balanceCredits()) === START_CREDITS - 5);

    // Not enough credits for every method: nothing is charged at all.
    await CreditBalance.updateOne({ organizationId: ORG }, { $set: { balanceMicro: 2 * MICRO_PER_CREDIT } });
    const ledgerBefore = (await ledgerFields()).length;
    const d = await run(C_ALL_2);
    check('3 methods with only 2 credits left: refused (INSUFFICIENT_CREDITS)', !d.ok && d.code === 'INSUFFICIENT_CREDITS', JSON.stringify(d));
    check('   ...nothing charged, no ledger row, no reveal record',
        (await balanceCredits()) === 2
        && (await ledgerFields()).length === ledgerBefore
        && (await HeadHunterContactReveal.countDocuments({ organizationId: ORG, candidateKey: resolveCandidateKey(bodyOf(C_ALL_2)) })) === 0);

    const none = await executeContactReveal({ organizationId: ORG, body: { candidateKey: 'id:c4' }, clerkUserId: 'user_test', auditPayload: audit });
    check('no contact method at all: NO_CONTACT_PIECES, nothing charged', !none.ok && none.code === 'NO_CONTACT_PIECES' && (await balanceCredits()) === 2);
}

async function main(): Promise<void> {
    console.log('='.repeat(90));
    console.log('Head Hunter — contact reveal: 1 credit per contact method (LinkedIn, email, phone)');
    console.log('='.repeat(90));
    partParity();

    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri());
    try {
        await partLifecycle();
        // The audit outbox flushes fire-and-forget after each reveal; let it land.
        await new Promise((r) => setTimeout(r, 300));
    } finally {
        await mongoose.disconnect();
        await rs.stop();
    }

    console.log('\n' + '='.repeat(90));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main().catch(async (err) => {
    console.error('\nERROR —', err instanceof Error ? err.message : err);
    try { await mongoose.disconnect(); } catch { /* already down */ }
    process.exit(1);
});
