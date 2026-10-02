/**
 * headhunter-contact-reveal-test
 *
 * THE DEFECT (measured 2026-10-02): every Head Hunter card showed a lock - "reveal
 * contact details, 1 credit per item" - but no search ever returns a phone or an
 * email (0 of 418 enriched profiles in the 14 retained searches, 0 of 98 stored
 * candidates in production). The only "piece" behind the lock was the LinkedIn
 * link, so paying 1 credit unlocked a link to the profile the search had just
 * found. Production recorded exactly one such charge (1 credit, 2026-09-06).
 *
 * THE FIX: the LinkedIn link is free and always open. Only a phone or an email is
 * a paid piece, on both sides:
 *   - frontend: countRevealPieces / availableRevealFieldsForCandidate ignore it, so
 *     the lock (and the yellow corner) appear only when a phone or email exists;
 *   - backend: parseAvailableContactFields ignores it, so it is never charged. A
 *     request carrying only a LinkedIn link (sent only by a tab opened before the
 *     fix, which still draws the lock) is answered "already revealed" for free and
 *     writes nothing, so that tab unlocks instead of failing on every retry; every
 *     answer lists 'linkedin' as revealed whenever the request carried the link.
 * Rows revealed (and paid) before the fix still read back.
 *
 * Part 1 runs the REAL frontend helpers next to the REAL backend ones (parity).
 * Part 2 drives the real executeContactReveal on a real mongod replica set (so the
 * production transaction path runs), and checks the balance and the ledger.
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
    fieldIdempotencyKey,
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

const LI = (n: number) => `https://www.linkedin.com/in/example-candidate-${n}`;
const PHONE = '+1 555 000 0001';
const EMAIL = 'candidate@example.com';

type Cand = { id: string; linkedin_url?: string; phone?: string; email?: string };
const C_LINK: Cand = { id: 'c1', linkedin_url: LI(1) };
const C_PHONE: Cand = { id: 'c2', linkedin_url: LI(2), phone: PHONE };
const C_ALL: Cand = { id: 'c3', linkedin_url: LI(3), phone: PHONE, email: EMAIL };
const C_NOTHING: Cand = { id: 'c4' };
const bodyOf = (c: Cand) => ({ candidateKey: reveal.candidateRevealKey(c), phone: c.phone, email: c.email, linkedin: c.linkedin_url });

function partParity(): void {
    console.log('\nPART 1 — the frontend lock and the backend charge agree');
    const pieces = (c: Cand) => reveal.countRevealPieces(channels.buildHeadHunterContactChannels(c));
    check('LinkedIn only: 0 paid pieces, so no lock on the card', pieces(C_LINK) === 0);
    check('LinkedIn only: the card still links to the profile', channels.buildHeadHunterContactChannels(C_LINK).linkedinHref === LI(1));
    check('LinkedIn only: frontend lists no payable field', same(reveal.availableRevealFieldsForCandidate(C_LINK), []));
    check('LinkedIn only: backend lists no payable field', same(parseAvailableContactFields(bodyOf(C_LINK)), []));
    check('phone + LinkedIn: 1 paid piece (the phone)', pieces(C_PHONE) === 1);
    check('phone + LinkedIn: both sides list ["phone"]',
        same(reveal.availableRevealFieldsForCandidate(C_PHONE), ['phone']) && same(parseAvailableContactFields(bodyOf(C_PHONE)), ['phone']));
    check('phone + email + LinkedIn: 2 pieces, both sides list ["phone","email"]',
        pieces(C_ALL) === 2
        && same(reveal.availableRevealFieldsForCandidate(C_ALL), ['phone', 'email'])
        && same(parseAvailableContactFields(bodyOf(C_ALL)), ['phone', 'email']));
    check('nothing at all: 0 pieces', pieces(C_NOTHING) === 0);
    for (const c of [C_LINK, C_PHONE, C_ALL]) {
        check(`candidate key parity (${c.id}): frontend == backend`,
            reveal.candidateRevealKey(c) === resolveCandidateKey({ linkedin: c.linkedin_url, phone: c.phone, email: c.email }));
    }
    // A candidate whose LinkedIn was paid for before the fix, now with a phone:
    // the phone is still locked; the old 'linkedin' field does not unlock it.
    const legacy = reveal.mergeRevealRecord(new Map(), reveal.candidateRevealKey(C_PHONE), { revealedFields: ['linkedin'] });
    check('a paid-before-the-fix LinkedIn reveal does not unlock a phone', reveal.isContactFullyRevealed(C_PHONE, legacy) === false);
    const paidPhone = reveal.mergeRevealRecord(new Map(), reveal.candidateRevealKey(C_PHONE), { revealedFields: ['phone'] });
    check('a revealed phone unlocks the card', reveal.isContactFullyRevealed(C_PHONE, paidPhone) === true);
    const legacyFull = reveal.mergeRevealRecord(new Map(), reveal.candidateRevealKey(C_ALL), { legacyFullReveal: true, revealedFields: [] });
    check('a legacy full reveal stays unlocked', reveal.isContactFullyRevealed(C_ALL, legacyFull) === true);
}

const ORG = 'org_test_contact_reveal';
const START_CREDITS = 10;

async function balanceCredits(): Promise<number> {
    const b = await CreditBalance.findOne({ organizationId: ORG }).lean();
    return (b?.balanceMicro ?? -1) / MICRO_PER_CREDIT;
}
const ledgerRows = () => CreditLedger.find({ organizationId: ORG, usageType: 'CONTACT_REVEAL' }).lean();
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
    check('LinkedIn only: answered as already revealed, for free',
        a.ok && a.alreadyRevealed === true && a.creditsCharged === 0 && same(a.revealedFields, ['linkedin']), JSON.stringify(a));
    check('   ...and charged nothing', (await balanceCredits()) === START_CREDITS);
    check('   ...no ledger row, no reveal record',
        (await ledgerRows()).length === 0 && (await HeadHunterContactReveal.countDocuments({ organizationId: ORG })) === 0);
    // An open tab from before the fix still draws the lock and needs every field it
    // knew, LinkedIn included, before it unlocks the card.
    const oldTabUnlocks = (c: Cand, revealed: string[]) =>
        ['phone', 'email', 'linkedin'].filter((f) => (f === 'linkedin' ? c.linkedin_url : c[f as 'phone' | 'email']))
            .every((f) => revealed.includes(f));
    check('   ...an open tab from before the fix unlocks with that answer', a.ok && oldTabUnlocks(C_LINK, a.revealedFields));

    const none = await executeContactReveal({ organizationId: ORG, body: { candidateKey: 'id:c4' }, clerkUserId: 'user_test', auditPayload: audit });
    check('nothing at all (no link, no phone, no email): NO_CONTACT_PIECES', !none.ok && none.code === 'NO_CONTACT_PIECES', JSON.stringify(none));

    const b = await run(C_PHONE);
    check('phone + LinkedIn: 1 credit, for the phone only',
        b.ok && b.creditsCharged === 1 && same(b.newlyRevealedFields, ['phone'])
        && same([...(b.ok ? b.revealedFields : [])].sort(), ['linkedin', 'phone']), JSON.stringify(b));
    check('   ...an open tab from before the fix unlocks with that answer', b.ok && oldTabUnlocks(C_PHONE, b.revealedFields));
    check('   ...balance down by exactly 1', (await balanceCredits()) === START_CREDITS - 1);
    const rowsB = await ledgerRows();
    check('   ...one ledger row, field "phone"',
        rowsB.length === 1 && (rowsB[0].metadata as { field?: string })?.field === 'phone');

    const b2 = await run(C_PHONE);
    check('the same reveal again is free (already revealed)', b2.ok && b2.alreadyRevealed === true && b2.creditsCharged === 0);
    check('   ...balance unchanged, still one ledger row', (await balanceCredits()) === START_CREDITS - 1 && (await ledgerRows()).length === 1);

    // A candidate whose LinkedIn was revealed (and paid) before the fix.
    const legacyKey = resolveCandidateKey(bodyOf(C_ALL));
    await HeadHunterContactReveal.create({
        organizationId: ORG,
        candidateKey: legacyKey,
        revealedFields: { linkedin: { revealedAt: now, idempotencyKey: fieldIdempotencyKey(ORG, legacyKey, 'linkedin') } },
        pieces: 1,
        creditsCharged: 1,
        revealedAt: now,
    });
    const c = await run(C_ALL);
    check('paid-before LinkedIn + phone + email: charges 2 (phone, email), never the link again',
        c.ok && c.creditsCharged === 2 && same([...(c.ok ? c.newlyRevealedFields : [])].sort(), ['email', 'phone']), JSON.stringify(c));
    check('   ...the old LinkedIn reveal still reads back', c.ok && c.revealedFields.includes('linkedin'));
    check('   ...balance down by exactly 2 more', (await balanceCredits()) === START_CREDITS - 3);
    check('   ...no ledger row was ever written for "linkedin"',
        (await ledgerRows()).every((r) => (r.metadata as { field?: string })?.field !== 'linkedin'));
}

async function main(): Promise<void> {
    console.log('='.repeat(90));
    console.log('Head Hunter — contact reveal: the LinkedIn link is free; only a phone or email is paid');
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
