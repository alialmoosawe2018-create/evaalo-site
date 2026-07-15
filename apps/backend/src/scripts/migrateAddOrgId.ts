// ============================================
// ملف: scripts/migrateAddOrgId.ts
// الوظيفة: backfill لحقول organizationId + createdByClerkUserId على
// candidates / video_interview_sessions / recruitmentcampaigns.
// ============================================
//
// تشغيل:
//   npm run migrate:org-id
//
// خيارات بيئية:
//   ORG_ID_OVERRIDE       — استخدم org id بدل DEFAULT_ORG_ID (مثلًا في staging).
//   CREATED_BY_OVERRIDE   — استخدم user id بدل SYSTEM_ACTOR_ID.
//   DRY_RUN=true          — لا يكتب شيئًا، يطبع التقرير فقط.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { DEFAULT_ORG_ID, SYSTEM_ACTOR_ID } from '../config/multiTenant.js';
import Candidate from '../models/Candidate.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';

dotenv.config();

const ORG_ID = (process.env.ORG_ID_OVERRIDE || DEFAULT_ORG_ID).trim();
const CREATED_BY = (process.env.CREATED_BY_OVERRIDE || SYSTEM_ACTOR_ID).trim();
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

interface MigrateResult {
    collection: string;
    matchedNoOrg: number;
    matchedNoCreator: number;
    modifiedOrg: number;
    modifiedCreator: number;
}

async function backfillModel(name: string, model: mongoose.Model<any>): Promise<MigrateResult> {
    const matchedNoOrg = await model.countDocuments({
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }, { organizationId: '' }],
    });
    const matchedNoCreator = await model.countDocuments({
        $or: [
            { createdByClerkUserId: { $exists: false } },
            { createdByClerkUserId: null },
            { createdByClerkUserId: '' },
        ],
    });

    let modifiedOrg = 0;
    let modifiedCreator = 0;

    if (!DRY_RUN && matchedNoOrg > 0) {
        const r = await model.updateMany(
            {
                $or: [
                    { organizationId: { $exists: false } },
                    { organizationId: null },
                    { organizationId: '' },
                ],
            },
            { $set: { organizationId: ORG_ID } }
        );
        modifiedOrg = r.modifiedCount || 0;
    }

    if (!DRY_RUN && matchedNoCreator > 0) {
        const r = await model.updateMany(
            {
                $or: [
                    { createdByClerkUserId: { $exists: false } },
                    { createdByClerkUserId: null },
                    { createdByClerkUserId: '' },
                ],
            },
            { $set: { createdByClerkUserId: CREATED_BY } }
        );
        modifiedCreator = r.modifiedCount || 0;
    }

    return { collection: name, matchedNoOrg, matchedNoCreator, modifiedOrg, modifiedCreator };
}

async function main(): Promise<void> {
    console.log('🚀 migrate:org-id');
    console.log(`   organizationId  -> ${ORG_ID}`);
    console.log(`   createdByClerk  -> ${CREATED_BY}`);
    console.log(`   DRY_RUN         -> ${DRY_RUN}\n`);

    await connectDatabase();

    const results: MigrateResult[] = [];
    results.push(await backfillModel('candidates', Candidate));
    results.push(await backfillModel('video_interview_sessions', VideoInterviewSession));
    results.push(await backfillModel('recruitmentcampaigns', RecruitmentCampaign));

    console.log('\n📊 النتائج:');
    for (const r of results) {
        console.log(
            `   • ${r.collection.padEnd(28)} ` +
                `noOrg=${r.matchedNoOrg.toString().padStart(5)}  ` +
                `noCreator=${r.matchedNoCreator.toString().padStart(5)}  ` +
                `modOrg=${r.modifiedOrg.toString().padStart(5)}  ` +
                `modCreator=${r.modifiedCreator.toString().padStart(5)}`
        );
    }

    if (DRY_RUN) {
        console.log('\n⚠️ DRY_RUN=true — لم يُكتَب شيء في قاعدة البيانات.');
    } else {
        console.log('\n✅ اكتملت الـ migration.');
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
