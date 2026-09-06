/**
 * A row must name the job its CAMPAIGN is hiring for.
 *
 * `position_applied_for` holds what the applicant typed about themselves, and on
 * production it disagreed with the campaign in 4 of 6 recent applications — one
 * of them "Mud Engineer" against a campaign for "Senior HR Specialist". Every
 * screen repaired that separately: the notifications card in a second request
 * (so the wrong title flashed for a second on every refresh), the campaign cards
 * by guessing the most common applicant-typed title, and the shared interview
 * page not at all — which is the one the CANDIDATE reads.
 *
 * Run: npx tsx src/scripts/campaign-role-test.ts
 */
import assert from 'node:assert';
import { applyCampaignRole, campaignRoleFromCampaign } from '../services/campaignRole.js';

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

/* ── naming a campaign ─────────────────────────────────────────────────────── */

test('the role comes from the campaign criteria, in the frontend’s own order', () => {
    assert.strictEqual(campaignRoleFromCampaign({ criteria: { position: 'Senior HR Specialist' } }), 'Senior HR Specialist');
    assert.strictEqual(campaignRoleFromCampaign({ criteria: { position_applied_for: 'HR Assistant' } }), 'HR Assistant');
    assert.strictEqual(campaignRoleFromCampaign({ criteria: { job: 'Accountant' } }), 'Accountant');
});

test('position wins over the other two, so both sides name a campaign identically', () => {
    assert.strictEqual(
        campaignRoleFromCampaign({ criteria: { job: 'Accountant', position: 'Senior Accountant' } }),
        'Senior Accountant'
    );
});

test('a template-only campaign falls back to its template name', () => {
    assert.strictEqual(campaignRoleFromCampaign({ templateName: 'Sales Screening' }), 'Sales Screening');
    assert.strictEqual(
        campaignRoleFromCampaign({ criteria: { position: 'Sales Rep' }, templateName: 'Sales Screening' }),
        'Sales Rep'
    );
});

test('a campaign that names no role answers with nothing, not a guess', () => {
    assert.strictEqual(campaignRoleFromCampaign({ criteria: { location: 'Baghdad' } }), '');
    assert.strictEqual(campaignRoleFromCampaign({ criteria: { position: '   ' } }), '');
    assert.strictEqual(campaignRoleFromCampaign(null), '');
    assert.strictEqual(campaignRoleFromCampaign({ criteria: ['not', 'an', 'object'] }), '');
});

/* ── applying it to a row ──────────────────────────────────────────────────── */

const ROLES = new Map([['c1', 'Senior HR Specialist']]);

test('this is the regression: the applicant’s own title is replaced by the campaign’s', () => {
    const row = applyCampaignRole(
        { campaignId: 'c1', position_applied_for: 'Mud Engineer' } as Record<string, unknown>,
        ROLES
    );
    assert.strictEqual(row.position_applied_for, 'Senior HR Specialist');
});

test('their own wording is kept, not discarded', () => {
    const row = applyCampaignRole(
        { campaignId: 'c1', position_applied_for: 'Mud Engineer' } as Record<string, unknown>,
        ROLES
    );
    assert.strictEqual(row.declaredPosition, 'Mud Engineer');
});

test('a row whose campaign is unknown is left exactly as it was', () => {
    const original = { campaignId: 'c-unknown', position_applied_for: 'Mud Engineer' };
    const row = applyCampaignRole(original, ROLES);
    assert.strictEqual(row, original, 'no copy should be made');
    assert.strictEqual(row.position_applied_for, 'Mud Engineer');
});

test('a candidate with no campaign at all — a head-hunter contact — keeps their title', () => {
    const original = { position_applied_for: 'Mud Engineer' };
    assert.strictEqual(applyCampaignRole(original, ROLES), original);
});

test('an already-correct row is returned untouched, with no declaredPosition noise', () => {
    const original: Record<string, unknown> = { campaignId: 'c1', position_applied_for: 'Senior HR Specialist' };
    const row = applyCampaignRole(original, ROLES);
    assert.strictEqual(row, original);
    assert.strictEqual((row as Record<string, unknown>).declaredPosition, undefined);
});

test('a row with no title of its own simply gains the campaign’s', () => {
    const row = applyCampaignRole({ campaignId: 'c1' } as Record<string, unknown>, ROLES);
    assert.strictEqual(row.position_applied_for, 'Senior HR Specialist');
    assert.strictEqual(row.declaredPosition, undefined, 'nothing was declared, so nothing to keep');
});

test('an existing declaredPosition is never overwritten', () => {
    const row = applyCampaignRole(
        { campaignId: 'c1', position_applied_for: 'Mud Engineer', declaredPosition: 'Drilling Fluids Engineer' } as Record<string, unknown>,
        ROLES
    );
    assert.strictEqual(row.declaredPosition, 'Drilling Fluids Engineer');
});

console.log(`\n[campaign-role] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
