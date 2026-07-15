// ============================================
// ملف: scripts/migrateIncludedVideoV2.ts
// الوظيفة: backfill لمرة واحدة لحقول الفيديو المشمول (V2) على credit_balances.
//   - includedVideoSeconds  حسب خطة كل منظمة (Starter 0 / Team 3000 / Pro 6000 / Business 9000)
//   - usedIncludedVideoSeconds = 0  (مرة واحدة فقط عند الترحيل الأولي)
//   - purchasedVideoSeconds / usedPurchasedVideoSeconds = 0  (فقط إن لم تكن موجودة،
//     حتى لا تُمحى دقائق مدفوعة عند إعادة التشغيل بـ FORCE)
// ============================================
//
// تشغيل:
//   npm run migrate:included-video-v2
//
// خيارات بيئية:
//   DRY_RUN=true   — لا يكتب شيئًا، يطبع التقرير فقط.
//   FORCE=true     — يتجاوز علامة الإتمام ويعيد التشغيل (خطير: يصفّر الدقائق المستهلكة).
//
// أمان: يكتب علامة إتمام في مجموعة `migrations` باسم
//   `v2_included_video` (مع حقل completedAt). إن وُجدت ولم يُمرَّر FORCE،
//   يتوقف فورًا حتى لا يصفّر شخصٌ دقائق الفيديو المستهلكة لكل العملاء بالخطأ.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import CreditBalance from '../models/CreditBalance.js';
import OrgPlanState from '../models/OrgPlanState.js';
import { getIncludedVideoSeconds } from '../services/billingEngine.js';
import { DEFAULT_PLAN_ID } from '../config/billingPlans.js';

dotenv.config();

const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const FORCE = String(process.env.FORCE || 'false').toLowerCase() === 'true';

const MIGRATION_NAME = 'v2_included_video';

async function main(): Promise<void> {
    console.log('🚀 migrate:included-video-v2');
    console.log(`   DRY_RUN -> ${DRY_RUN}`);
    console.log(`   FORCE   -> ${FORCE}\n`);

    await connectDatabase();

    const migrationsCol = mongoose.connection.collection('migrations');
    const existing = await migrationsCol.findOne({ name: MIGRATION_NAME });
    if (existing && !FORCE) {
        console.log(
            `⏭️  Migration "${MIGRATION_NAME}" already completed at ${existing.completedAt}. ` +
                'Skipping (pass FORCE=true to re-run — WARNING: resets used video minutes).',
        );
        await mongoose.disconnect();
        process.exit(0);
    }

    // Map every org's plan once to avoid N queries.
    const states = await OrgPlanState.find({}, { organizationId: 1, planId: 1 }).lean().exec();
    const planByOrg = new Map<string, string>();
    for (const s of states) {
        if (s.organizationId) planByOrg.set(s.organizationId, s.planId || DEFAULT_PLAN_ID);
    }

    const balances = await CreditBalance.find({}, { organizationId: 1 }).lean().exec();

    let updated = 0;
    const perPlan: Record<string, number> = {};

    for (const bal of balances) {
        const orgId = bal.organizationId;
        if (!orgId) continue;
        const planId = (planByOrg.get(orgId) || DEFAULT_PLAN_ID) as any;
        const includedVideoSeconds = getIncludedVideoSeconds(planId);
        perPlan[planId] = (perPlan[planId] || 0) + 1;

        if (!DRY_RUN) {
            await CreditBalance.updateOne(
                { organizationId: orgId },
                { $set: { includedVideoSeconds, usedIncludedVideoSeconds: 0 } },
            ).exec();

            // Initialize PURCHASED video fields to 0 — but ONLY when missing, so a
            // FORCE re-run can never wipe minutes a customer actually paid for.
            await CreditBalance.updateOne(
                { organizationId: orgId, purchasedVideoSeconds: { $exists: false } },
                { $set: { purchasedVideoSeconds: 0, usedPurchasedVideoSeconds: 0 } },
            ).exec();
        }
        updated += 1;
    }

    console.log('\n📊 النتائج:');
    console.log(`   • balances scanned   = ${balances.length}`);
    console.log(`   • balances updated   = ${updated}`);
    for (const [plan, count] of Object.entries(perPlan)) {
        console.log(
            `     - ${plan.padEnd(14)} count=${String(count).padStart(5)}  ` +
                `includedVideoSeconds=${getIncludedVideoSeconds(plan as any)}`,
        );
    }

    if (DRY_RUN) {
        console.log('\n⚠️ DRY_RUN=true — لم يُكتَب شيء، ولم تُسجَّل علامة الإتمام.');
    } else {
        await migrationsCol.updateOne(
            { name: MIGRATION_NAME },
            { $set: { name: MIGRATION_NAME, completedAt: new Date(), updatedCount: updated } },
            { upsert: true },
        );
        console.log('\n✅ اكتملت الـ migration وسُجِّلت علامة الإتمام.');
    }

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('❌ migration failed:', err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
