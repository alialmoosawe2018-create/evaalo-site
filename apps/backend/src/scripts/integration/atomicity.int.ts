// ============================================
// scripts/integration/atomicity.int.ts
// Integration tests on a REAL in-memory MongoDB replica set — proves the guarantees
// that unit tests could only mock: transactional money atomicity (Phase 0.1),
// reservation atomicity (0.3b), and tenant isolation (0.2).
//
// Run: npx tsx src/scripts/integration/atomicity.int.ts
// Requires the mongodb-memory-server dev dependency (downloads mongod once).
// ============================================

import assert from 'node:assert';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import CreditBalance from '../../models/CreditBalance.js';
import CreditLedger from '../../models/CreditLedger.js';
import Candidate from '../../models/Candidate.js';
import * as balRepo from '../../repositories/creditBalanceRepository.js';
import * as ledRepo from '../../repositories/creditLedgerRepository.js';
import DomainEventOutbox from '../../models/DomainEventOutbox.js';
import { enqueueDomainEvent } from '../../services/domainEventService.js';

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

function seedBalance(organizationId: string, balanceMicro: number, reservedMicro = 0) {
    const now = new Date();
    return CreditBalance.create({
        organizationId,
        balanceMicro,
        reservedMicro,
        monthlyCredits: 0,
        includedVideoSeconds: 0,
        usedIncludedVideoSeconds: 0,
        purchasedVideoSeconds: 0,
        usedPurchasedVideoSeconds: 0,
        periodStart: now,
        periodEnd: now,
        refreshedFromPlanAt: now,
    });
}

async function main(): Promise<void> {
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(rs.getUri());
    console.log('[int] replica set up — running tests\n');

    // 0.1 — the CAS decrement can never overdraw under concurrency.
    await test('consume CAS: 20 concurrent -100 on 1000 → exactly 10 succeed, balance 0, never negative', async () => {
        await CreditBalance.deleteMany({});
        await seedBalance('orgA', 1000);
        const results = await Promise.all(
            Array.from({ length: 20 }, () => balRepo.decrementIfSufficient('orgA', 100)),
        );
        const successes = results.filter((r) => r !== null).length;
        assert.equal(successes, 10, `expected 10 successes, got ${successes}`);
        const bal = await CreditBalance.findOne({ organizationId: 'orgA' });
        assert.equal(bal!.balanceMicro, 0);
        assert.ok(bal!.balanceMicro >= 0, 'balance never negative');
    });

    // 0.3b — the reservation hold can never over-reserve under concurrency.
    await test('reserveHeadroom: 20 concurrent 100 on 1000 → exactly 10 held, reserved ≤ balance', async () => {
        await CreditBalance.deleteMany({});
        await seedBalance('orgB', 1000, 0);
        const results = await Promise.all(
            Array.from({ length: 20 }, () => balRepo.reserveHeadroom('orgB', 100)),
        );
        const held = results.filter(Boolean).length;
        assert.equal(held, 10, `expected 10 holds, got ${held}`);
        const bal = await CreditBalance.findOne({ organizationId: 'orgB' });
        assert.equal(bal!.reservedMicro, 1000);
        assert.ok(bal!.reservedMicro <= bal!.balanceMicro, 'reserved never exceeds balance');
    });

    await test('releaseHeadroom floors at 0 (over-release / drift can never go negative)', async () => {
        await CreditBalance.updateOne({ organizationId: 'orgB' }, { $set: { reservedMicro: 50 } });
        await balRepo.releaseHeadroom('orgB', 200);
        const bal = await CreditBalance.findOne({ organizationId: 'orgB' });
        assert.equal(bal!.reservedMicro, 0);
    });

    // 0.1 — balance + ledger commit/roll back together.
    await test('transaction: abort rolls back BOTH the balance decrement and the ledger row', async () => {
        await CreditBalance.deleteMany({});
        await CreditLedger.deleteMany({});
        await seedBalance('orgD', 1000);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await balRepo.decrementIfSufficient('orgD', 300, session);
                await ledRepo.create(
                    { organizationId: 'orgD', amountMicro: -300, balanceBeforeMicro: 1000, balanceAfterMicro: 700, source: 'manual_adjustment', idempotencyKey: 'abort-k' },
                    session,
                );
                throw new Error('force abort');
            });
        } catch {
            /* aborted as intended */
        }
        await session.endSession();
        const bal = await CreditBalance.findOne({ organizationId: 'orgD' });
        const ledgerCount = await CreditLedger.countDocuments({ organizationId: 'orgD' });
        assert.equal(bal!.balanceMicro, 1000, 'balance rolled back');
        assert.equal(ledgerCount, 0, 'ledger rolled back');
    });

    await test('transaction: commit persists BOTH the balance decrement and the ledger row', async () => {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await balRepo.decrementIfSufficient('orgD', 300, session);
            await ledRepo.create(
                { organizationId: 'orgD', amountMicro: -300, balanceBeforeMicro: 1000, balanceAfterMicro: 700, source: 'manual_adjustment', idempotencyKey: 'commit-k' },
                session,
            );
        });
        await session.endSession();
        const bal = await CreditBalance.findOne({ organizationId: 'orgD' });
        const ledgerCount = await CreditLedger.countDocuments({ organizationId: 'orgD' });
        assert.equal(bal!.balanceMicro, 700, 'balance committed');
        assert.equal(ledgerCount, 1, 'ledger committed');
    });

    // Mode A (grant/refresh, Phase B) — the balance snapshot + ledger row + the
    // CreditBalanceRefreshed outbox row commit or roll back as ONE unit, so a grant
    // event can never diverge from the money it describes.
    const grantSet = (micro: number) => ({
        balanceMicro: micro,
        monthlyCredits: micro,
        periodStart: new Date(),
        periodEnd: new Date(),
        refreshedFromPlanAt: new Date(),
    });

    await test('Mode A commit: upsertPeriod + ledger + CreditBalanceRefreshed persist together', async () => {
        await CreditBalance.deleteMany({});
        await CreditLedger.deleteMany({});
        await DomainEventOutbox.deleteMany({});
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await balRepo.upsertPeriod('orgE', grantSet(5000), { session });
            await ledRepo.create(
                { organizationId: 'orgE', amountMicro: 5000, balanceBeforeMicro: 0, balanceAfterMicro: 5000, source: 'monthly_refresh', idempotencyKey: 'grant-commit-k' },
                session,
            );
            await enqueueDomainEvent(
                { organizationId: 'orgE', type: 'CreditBalanceRefreshed', payload: { balanceAfterMicro: 5000, reason: 'seed' }, idempotencyKey: 'balance-refresh:grant-commit-k' },
                session,
            );
        });
        await session.endSession();
        const bal = await CreditBalance.findOne({ organizationId: 'orgE' });
        const led = await CreditLedger.countDocuments({ organizationId: 'orgE' });
        const evt = await DomainEventOutbox.countDocuments({ organizationId: 'orgE', type: 'CreditBalanceRefreshed' });
        assert.equal(bal!.balanceMicro, 5000, 'balance committed');
        assert.equal(led, 1, 'ledger committed');
        assert.equal(evt, 1, 'CreditBalanceRefreshed event committed');
    });

    await test('Mode A abort: a failure rolls back the balance, ledger AND the event together', async () => {
        await CreditBalance.deleteMany({});
        await CreditLedger.deleteMany({});
        await DomainEventOutbox.deleteMany({});
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await balRepo.upsertPeriod('orgF', grantSet(5000), { session });
                await ledRepo.create(
                    { organizationId: 'orgF', amountMicro: 5000, balanceBeforeMicro: 0, balanceAfterMicro: 5000, source: 'monthly_refresh', idempotencyKey: 'grant-abort-k' },
                    session,
                );
                await enqueueDomainEvent(
                    { organizationId: 'orgF', type: 'CreditBalanceRefreshed', payload: { balanceAfterMicro: 5000, reason: 'seed' }, idempotencyKey: 'balance-refresh:grant-abort-k' },
                    session,
                );
                throw new Error('force abort');
            });
        } catch {
            /* aborted as intended */
        }
        await session.endSession();
        const bal = await CreditBalance.countDocuments({ organizationId: 'orgF' });
        const led = await CreditLedger.countDocuments({ organizationId: 'orgF' });
        const evt = await DomainEventOutbox.countDocuments({ organizationId: 'orgF' });
        assert.equal(bal, 0, 'balance upsert rolled back (no row)');
        assert.equal(led, 0, 'ledger rolled back');
        assert.equal(evt, 0, 'event rolled back');
    });

    // 0.2 — tenant isolation guard in strict mode.
    await test('tenant guard (strict): an unscoped query throws; an org-scoped query passes', async () => {
        process.env.TENANT_GUARD = 'strict';
        await assert.rejects(
            () => Candidate.find({ email: 'nobody@example.com' }).exec(),
            /tenantGuard/,
            'unscoped Candidate.find should throw in strict mode',
        );
        await Candidate.find({ organizationId: 'orgA' }).exec(); // scoped → must not throw
        process.env.TENANT_GUARD = '';
    });

    console.log(`\n[int] PASS ${pass} / FAIL ${fail}`);
    await mongoose.disconnect();
    await rs.stop();
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
    console.error('[int] harness error:', err);
    process.exit(1);
});
