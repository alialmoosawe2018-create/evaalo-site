/**
 * A Head Hunter invite interviews for the CAMPAIGN's role — end to end.
 *
 * The share link used to carry the candidate's CURRENT job
 * (`headHunterCandidatePosition = current_title || headline`) in preference to
 * the role the employer is hiring for, and that value is what prefills the
 * public intake form and is submitted as `position_applied_for`.
 *
 * ⚠️ No interview actually ran on the wrong role. Two server layers already
 * repair it — `reconcileIntakePosition` when the application is written, and
 * `applyApplicationJobContext` (via `resolveApplicationJobContext`) when
 * /prepare and /start read it back — and production logs show
 * `[AGENT JOB] … → match` on every session. This file exists because that
 * protection was UNTESTED for this path: nothing stopped it regressing, and the
 * owner asked for proof through the server rather than a check on the URL.
 *
 * So the chain asserted here is the logical one:
 *
 *   campaign target role → intake → CandidateApplication → /prepare + /start read
 *
 * and the invariant is that `current_title` / `headline` can never define it.
 *
 * The frontend half — that the link carries the campaign role at all — is
 * pinned separately in apps/frontend/src/utils/headHunterInviteRole.test.mjs.
 *
 * Runs on an in-memory mongo; no external database.
 *
 * Run: npm run test:headhunter-target-role
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { reconcileIntakePosition } from '../services/campaignRole.js';
import { resolveApplicationJobContext } from '../services/applicationJobContext.js';

/** What the employer is hiring for. */
const CAMPAIGN_ROLE = 'HR Generalist';
/** What the candidate happens to do today — sourced from LinkedIn, not declared. */
const CANDIDATE_CURRENT_TITLE = 'Sales Manager';
const CAMPAIGN_ID = 'camp-hh-role-001';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

function withFlag<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
    const previous = process.env.APPLICATION_OWNS_CAMPAIGN_STATE;
    process.env.APPLICATION_OWNS_CAMPAIGN_STATE = on ? 'true' : 'false';
    return fn().finally(() => {
        if (previous === undefined) delete process.env.APPLICATION_OWNS_CAMPAIGN_STATE;
        else process.env.APPLICATION_OWNS_CAMPAIGN_STATE = previous;
    });
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    console.log('[hh-target-role] in-memory mongo up — running tests\n');

    // ── layer 1: intake. What the link declared vs what gets recorded. ───────

    await test('intake records the CAMPAIGN role, not the title the link carried', () => {
        const out = reconcileIntakePosition({
            declared: CANDIDATE_CURRENT_TITLE, // what the old link put in the form
            campaignRole: CAMPAIGN_ROLE,
        });
        assert.equal(out.position_applied_for, CAMPAIGN_ROLE);
        assert.equal(out.declaredPosition, CANDIDATE_CURRENT_TITLE);
        assert.equal(out.corrected, true);
    });

    await test('with the link fixed there is nothing to correct', () => {
        const out = reconcileIntakePosition({ declared: '', campaignRole: CAMPAIGN_ROLE });
        assert.equal(out.position_applied_for, CAMPAIGN_ROLE);
        assert.equal(out.corrected, false);
    });

    await test('⚠️ a campaign with NO role has nothing to repair towards', () => {
        // This is why the link had to stop carrying the candidate's title: both
        // server layers are no-ops here, so whatever the link declared survives.
        const out = reconcileIntakePosition({
            declared: CANDIDATE_CURRENT_TITLE,
            campaignRole: '',
        });
        assert.equal(out.corrected, false);
        assert.equal(out.position_applied_for, undefined);
    });

    // ── layer 2: what /prepare and /start read back ──────────────────────────

    const person = await Candidate.create({
        full_name: 'Sourced Candidate',
        email: 'sourced@example.com',
        phone: '07800000001',
        // The person row carries the sourced title — this is the value that must
        // never reach the interview.
        position_applied_for: CANDIDATE_CURRENT_TITLE,
        years_of_experience: '3-5 years',
    });

    await RecruitmentCampaign.create({
        campaignId: CAMPAIGN_ID,
        criteria: { position: CAMPAIGN_ROLE },
    });

    await CandidateApplication.create({
        candidateId: person._id,
        applicationId: 'APP-HH-001',
        emailDenorm: person.email,
        campaignId: CAMPAIGN_ID,
        // Worst case on purpose: even a polluted application row must lose to
        // the campaign's own role.
        position_applied_for: CANDIDATE_CURRENT_TITLE,
    });

    await test('the read path hands the agent the campaign role', async () => {
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({
                candidateId: String(person._id),
                campaignId: CAMPAIGN_ID,
            })
        );
        assert.ok(ctx, 'context must exist when the flag is on');
        assert.equal(ctx?.position_applied_for, CAMPAIGN_ROLE);
        assert.notEqual(
            ctx?.position_applied_for,
            CANDIDATE_CURRENT_TITLE,
            "the candidate's current job reached the interview"
        );
    });

    await test('⚠️ no campaign row ⇒ the polluted application value wins', async () => {
        // Found by this file: the first draft omitted the campaign document and
        // the repair silently fell through to `app.position_applied_for`. That is
        // the same shape as a campaign that names no role, and it is the third
        // reason the LINK must never carry the candidate's title — neither server
        // layer can help when there is nothing to repair towards.
        const orphan = 'camp-hh-role-missing';
        await CandidateApplication.create({
            candidateId: person._id,
            applicationId: 'APP-HH-002',
            emailDenorm: person.email,
            campaignId: orphan,
            position_applied_for: CANDIDATE_CURRENT_TITLE,
        });
        const ctx = await withFlag(true, () =>
            resolveApplicationJobContext({
                candidateId: String(person._id),
                campaignId: orphan,
            })
        );
        assert.equal(ctx?.position_applied_for, CANDIDATE_CURRENT_TITLE);
    });

    await test('⚠️ flag OFF removes the repair — the link becomes the truth', async () => {
        // Not a bug being asserted, a dependency being named: with
        // APPLICATION_OWNS_CAMPAIGN_STATE off, resolveApplicationJobContext
        // returns null and videoInterview.ts leaves the person's own value in
        // place. The link fix is what keeps that value correct anyway.
        const ctx = await withFlag(false, () =>
            resolveApplicationJobContext({
                candidateId: String(person._id),
                campaignId: CAMPAIGN_ID,
            })
        );
        assert.strictEqual(ctx, null);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
