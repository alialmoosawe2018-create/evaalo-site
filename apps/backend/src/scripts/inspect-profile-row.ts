/* Shapes real applications exactly the way the API does, and reports which keys
   the row stops inheriting from the person once the application owns state. */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { applicationToStageListRow } from '../services/candidateApplicationService.js';

dotenv.config();

async function main() {
    const uri = (process.env.MONGODB_URI as string).replace(/\/evaalo_dev\?/, '/evaalo?');
    await mongoose.connect(uri);
    const db = mongoose.connection.db!;
    // Prefer people with more than one application — that is where leaks show.
    const apps = await db.collection('candidate_applications')
        .find({ deletedAt: null }).sort({ createdAt: -1 }).limit(40).toArray();

    let inspected = 0;
    for (const app of apps) {
        const person = await db.collection('candidates').findOne({ _id: app.candidateId });
        if (!person) continue;
        const siblings = await db.collection('candidate_applications')
            .countDocuments({ candidateId: app.candidateId, deletedAt: null });
        if (siblings < 2) continue; // returning applicants only

        process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'false';
        const before = applicationToStageListRow(app as never, person as never) as Record<string, unknown>;
        process.env.APPLICATION_OWNS_CAMPAIGN_STATE = 'true';
        const after = applicationToStageListRow(app as never, person as never) as Record<string, unknown>;

        const changed: string[] = [];
        for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
        }
        inspected += 1;
        console.log(`\napplication ${app.applicationId} (campaign ${app.campaignId}, ${siblings} applications by this person)`);
        console.log(`  job shown: "${after.position_applied_for}"   person carries: "${(person as any).position_applied_for}"`);
        if (!changed.length) {
            console.log('  no key changes — this row never leaked');
        } else {
            for (const k of changed.sort()) {
                const b = JSON.stringify(before[k]);
                console.log(`  stopped inheriting  ${k.padEnd(30)} was: ${b && b.length > 70 ? b.slice(0, 70) + '…' : b}`);
            }
        }
        if (inspected >= 4) break;
    }
    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
