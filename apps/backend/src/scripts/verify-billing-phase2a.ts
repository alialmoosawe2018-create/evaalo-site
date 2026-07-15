/**
 * Phase 2a billing runtime verification (requires MongoDB).
 * Unified credit model: single microCredit pool, per-second interview billing.
 * Run from apps/backend: npx tsx src/scripts/verify-billing-phase2a.ts
 */
import '../loadEnv.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import {
    consumeCredits,
    getBillingStatus,
    seedOrgBilling,
} from '../services/billingRuntimeService.js';
import CreditLedger from '../models/CreditLedger.js';
import OrgPlanState from '../models/OrgPlanState.js';
import CreditBalance from '../models/CreditBalance.js';
import { getMonthlyCredits } from '../services/billingEngine.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';

const ORG = 'org_phase2a_verify';
const STARTER_ORG = 'org_phase2a_verify_starter';
const FAILS: string[] = [];

const PRO_CREDITS = getMonthlyCredits('professional');
const VOICE_MINUTE_CREDITS = 15;

function check(label: string, ok: boolean, detail?: string) {
    const line = `${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`;
    console.log(line);
    if (!ok) FAILS.push(label);
}

async function main() {
    await connectDatabase();

    for (const org of [ORG, STARTER_ORG]) {
        await OrgPlanState.deleteOne({ organizationId: org });
        await CreditBalance.deleteOne({ organizationId: org });
        await CreditLedger.deleteMany({ organizationId: org });
    }

    const { creditBalance } = await seedOrgBilling(ORG, 'professional');
    check(
        `seed professional balanceMicro = ${PRO_CREDITS} credits`,
        creditBalance.balanceMicro === PRO_CREDITS * MICRO_PER_CREDIT,
        `(got ${creditBalance.balanceMicro})`,
    );

    const status = await getBillingStatus(ORG);
    check('status configured', status.configured === true);
    check('status planId professional', status.planId === 'professional');
    check(
        `status creditsRemaining ${PRO_CREDITS}`,
        status.creditsRemaining === PRO_CREDITS,
        `(got ${status.creditsRemaining})`,
    );

    const sessionId = `verify-session-${Date.now()}`;
    const key = `vi_end:${sessionId}`;
    const expectedAfterMicro = (PRO_CREDITS - VOICE_MINUTE_CREDITS) * MICRO_PER_CREDIT;

    const first = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: key,
        source: 'video_interview',
        sourceId: sessionId,
    });
    check('consume ok', first.ok === true);
    if (first.ok) {
        check(
            `balanceAfterMicro = ${PRO_CREDITS - VOICE_MINUTE_CREDITS} credits`,
            first.balanceAfterMicro === expectedAfterMicro,
            `(got ${first.balanceAfterMicro})`,
        );
    }

    const dup = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: key,
        source: 'video_interview',
        sourceId: sessionId,
    });
    check('idempotent duplicate', dup.ok === true && dup.duplicate === true);

    const afterDup = await getBillingStatus(ORG);
    check(
        `creditsRemaining still ${PRO_CREDITS - VOICE_MINUTE_CREDITS} after duplicate`,
        afterDup.creditsRemaining === PRO_CREDITS - VOICE_MINUTE_CREDITS,
        `(got ${afterDup.creditsRemaining})`,
    );

    const ledgerCount = await CreditLedger.countDocuments({ organizationId: ORG, idempotencyKey: key });
    check('single ledger entry for idempotency key', ledgerCount === 1, `(count ${ledgerCount})`);

    await CreditBalance.updateOne({ organizationId: ORG }, { $set: { balanceMicro: 0 } });
    const exhausted = await consumeCredits({
        organizationId: ORG,
        usageType: 'VOICE_SECONDS',
        units: 60,
        idempotencyKey: `vi_end:exhausted-${Date.now()}`,
        source: 'video_interview',
        sourceId: 'exhausted',
    });
    check(
        'insufficient credits when balance 0',
        !exhausted.ok && exhausted.code === 'INSUFFICIENT_CREDITS',
    );

    const ledger = await CreditLedger.findOne({ organizationId: ORG, idempotencyKey: key }).lean();
    check(
        'ledger has balanceBeforeMicro/AfterMicro',
        Boolean(
            ledger &&
                ledger.balanceBeforeMicro === PRO_CREDITS * MICRO_PER_CREDIT &&
                ledger.balanceAfterMicro === expectedAfterMicro,
        ),
    );

    // Feature gating: Starter has no video → VIDEO_SECONDS must be denied.
    await seedOrgBilling(STARTER_ORG, 'starter');
    const videoOnStarter = await consumeCredits({
        organizationId: STARTER_ORG,
        usageType: 'VIDEO_SECONDS',
        units: 60,
        idempotencyKey: `vi_end:starter-video-${Date.now()}`,
        source: 'video_interview',
        sourceId: 'starter-video',
    });
    check(
        'video denied on starter (FEATURE_DENIED)',
        !videoOnStarter.ok && videoOnStarter.code === 'FEATURE_DENIED',
        !videoOnStarter.ok ? `(${videoOnStarter.code})` : '(ok=true unexpectedly)',
    );

    for (const org of [ORG, STARTER_ORG]) {
        await OrgPlanState.deleteOne({ organizationId: org });
        await CreditBalance.deleteOne({ organizationId: org });
        await CreditLedger.deleteMany({ organizationId: org });
    }

    console.log('\n' + (FAILS.length === 0 ? 'ALL CHECKS PASS' : `FAILED: ${FAILS.join(', ')}`));
    await mongoose.disconnect();
    process.exit(FAILS.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
