/**
 * One-off: remove stale stripeCustomerId / stripeSubscriptionId after switching Stripe accounts.
 */
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        console.error('MONGODB_URI missing in apps/backend/.env');
        process.exit(1);
    }

    await mongoose.connect(uri);
    const col = mongoose.connection.db!.collection('org_plan_states');

    const before = await col
        .find({ stripeCustomerId: { $exists: true, $ne: null } })
        .project({ organizationId: 1, stripeCustomerId: 1, stripeSubscriptionId: 1 })
        .toArray();

    console.log(`Found ${before.length} org(s) with stripeCustomerId:`);
    for (const doc of before) {
        console.log(` - ${doc.organizationId} | ${doc.stripeCustomerId} | ${doc.stripeSubscriptionId ?? ''}`);
    }

    const result = await col.updateMany(
        {
            $or: [
                { stripeCustomerId: { $exists: true, $ne: null } },
                { stripeSubscriptionId: { $exists: true, $ne: null } },
            ],
        },
        { $unset: { stripeCustomerId: '', stripeSubscriptionId: '' } },
    );

    console.log(`Cleared stripe fields on ${result.modifiedCount} document(s).`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
