/**
 * application-org-invariant-test
 *
 * THE INVARIANT: an application that names a campaign must carry that campaign's
 * organizationId. Nothing else is acceptable — the campaign owner is the only
 * party entitled to the application and its evaluation.
 *
 * It was violated in production on 2026-09-16: `orgScopedQuery` spreads the
 * SESSION org last, so the campaign org handed to the existing-person lookup in
 * routes/candidates.ts was silently overwritten. When the applicant's e-mail
 * already existed in the submitter's own org, that person matched and the whole
 * application was filed under the wrong tenant. Application 6aaadce5 at 18:16 is
 * the measured case: campaign owned by org_3IsSo…, row written to org_3GmTS…,
 * because the applicant was signed into his own Evaalo account on his phone.
 *
 * The lookup is fixed and `orgScopedQuery` now rejects an `organizationId`
 * argument at compile time. This script is the detector that would have caught it
 * without anyone noticing a stray row on a dashboard — run it after any change to
 * the intake path, and to confirm a repair.
 *
 * Read-only. It never writes. Exits non-zero when the invariant is broken.
 *
 * Run: npm run test:application-org-invariant
 */
/*
 * Deliberately on the RAW driver, not the Mongoose models. This audit has to read
 * EVERY tenant at once, and `tenantGuard` rightly refuses an unscoped model query
 * ("Cross-tenant scan risk"). Bypassing the guard with a flag would teach the
 * wrong habit; a read-only auditor that never touches the app's query path is the
 * honest way to look across tenants.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

interface Violation {
    kind: 'application' | 'person';
    id: string;
    campaignId: string;
    holderOrg: string;
    campaignOrg: string;
    name: string;
}

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    await mongoose.connect(uri);
    console.log(`\nconnected to ${mongoose.connection.db?.databaseName}`);

    const db = mongoose.connection.db;
    if (!db) throw new Error('no database handle');

    const campaignOrgById = new Map<string, string>();
    for (const c of await db
        .collection('recruitmentcampaigns')
        .find({})
        .project({ campaignId: 1, organizationId: 1 })
        .toArray()) {
        if (c.campaignId) campaignOrgById.set(String(c.campaignId), String(c.organizationId ?? ''));
    }
    console.log(`campaigns: ${campaignOrgById.size}`);

    const violations: Violation[] = [];
    let checkedApps = 0;
    let orphanApps = 0;

    const apps = await db
        .collection('candidate_applications')
        .find({ campaignId: { $exists: true, $ne: null } })
        .project({
            campaignId: 1,
            organizationId: 1,
            candidateId: 1,
            'applicationSnapshot.full_name': 1,
        })
        .toArray();

    for (const a of apps) {
        const campaignId = String(a.campaignId ?? '');
        if (!campaignId) continue;
        checkedApps++;
        const campaignOrg = campaignOrgById.get(campaignId);
        if (campaignOrg === undefined) {
            // Not a tenancy violation — a campaign that no longer exists. Reported
            // separately so a deleted campaign never masquerades as a leak.
            orphanApps++;
            continue;
        }
        const holderOrg = String(a.organizationId ?? '');
        if (holderOrg !== campaignOrg) {
            violations.push({
                kind: 'application',
                id: String(a._id),
                campaignId,
                holderOrg,
                campaignOrg,
                name: String((a as { applicationSnapshot?: { full_name?: string } })
                    .applicationSnapshot?.full_name ?? ''),
            });
        }
    }

    // The person row travels with the application — a leak puts BOTH in the wrong
    // org, and repairing only one would leave the dashboard inconsistent.
    for (const v of violations.filter((x) => x.kind === 'application')) {
        const app = apps.find((a) => String(a._id) === v.id);
        if (!app?.candidateId) continue;
        const person = await db
            .collection('candidates')
            .findOne(
                { _id: app.candidateId },
                { projection: { organizationId: 1, full_name: 1 } }
            );
        if (person && String(person.organizationId ?? '') !== v.campaignOrg) {
            violations.push({
                kind: 'person',
                id: String(person._id),
                campaignId: v.campaignId,
                holderOrg: String(person.organizationId ?? ''),
                campaignOrg: v.campaignOrg,
                name: String((person as { full_name?: string }).full_name ?? ''),
            });
        }
    }

    console.log(`applications checked: ${checkedApps}`);
    console.log(`applications whose campaign no longer exists: ${orphanApps} (not a violation)`);

    if (violations.length === 0) {
        console.log('\nPASS — every application sits in its campaign\'s organization');
    } else {
        console.log(`\nFAIL — ${violations.length} cross-tenant row(s):\n`);
        for (const v of violations) {
            console.log(
                `  ${v.kind.padEnd(11)} ${v.id}  "${v.name}"\n` +
                    `              campaign ${v.campaignId}\n` +
                    `              belongs to ${v.campaignOrg}\n` +
                    `              but is filed under ${v.holderOrg}`
            );
        }
        console.log('\nRepair moves the row to the campaign org — an owner decision, not this script\'s.');
    }

    await mongoose.disconnect();
    if (violations.length > 0) process.exit(1);
}

main().catch(async (err) => {
    console.error('\nERROR —', err instanceof Error ? err.message : err);
    try {
        await mongoose.disconnect();
    } catch {
        /* already down */
    }
    process.exit(1);
});
