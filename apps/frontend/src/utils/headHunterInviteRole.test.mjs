/**
 * The role a Head Hunter interview invite is FOR.
 *
 * The invite used to read `headHunterCandidatePosition(candidate) || campaignPosition`
 * — the job the candidate holds RIGHT NOW outranked the job the employer is
 * hiring for. An employer searching for "HR Generalist" who shared with a
 * candidate titled "Sales Manager" produced `position=Sales Manager`.
 *
 * ⚠️ No interview was actually run on the wrong role: the server repairs the
 * interview's identity in two existing layers (`reconcileIntakePosition` at
 * intake, `applyApplicationJobContext` on read), and production logs show
 * `[AGENT JOB] … → match` throughout. But both layers need a campaign role to
 * repair towards — a campaign that names none has no reference, and the
 * candidate's own title passes straight through. The link must not be the
 * source of that truth at all.
 *
 * Run: node src/utils/headHunterInviteRole.test.mjs   (from apps/frontend)
 */
import { headHunterInviteRole } from '../utils/headHunterInviteRole.js';
import { buildPublicVideoScreeningQuery } from './publicVideoScreeningUrl.js';

let failed = 0;
let passed = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
        passed += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', err.message);
        failed += 1;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

// The exact shape from the report: the candidate holds a completely different job.
const SALES_CANDIDATE = { current_title: 'Sales Manager', headline: 'Sales Manager at X' };

check('the campaign role is what the invite carries', () => {
    assert(headHunterInviteRole('HR Generalist') === 'HR Generalist', 'campaign role lost');
});

check("the candidate's current job cannot reach the invite", () => {
    // there is no argument by which the candidate could influence it
    assert(headHunterInviteRole(undefined) === '', 'undefined campaign role must yield ""');
    assert(headHunterInviteRole('') === '', 'blank campaign role must yield ""');
    assert(
        headHunterInviteRole(SALES_CANDIDATE.current_title) === 'Sales Manager',
        'sanity: the helper takes a ROLE, and only the campaign supplies it',
    );
});

// 🔴 This used to be a hand-copied mirror of the builder's rule, written when
// the only implementation lived in the hook module (which imports the API client
// and touches `window`, so it cannot load under plain node).
//
// The mirror contained `if (campaignId) params.set('campaignId', campaignId)` —
// the defect itself, preserved inside a passing test. A copy of a rule cannot
// fail when the rule changes; that is the whole reason it was useless.
//
// The rule now lives in its own pure module, so this calls the real thing.
const linkParams = (campaignId, position) =>
    buildPublicVideoScreeningQuery({ campaignId, position });

check('a campaign with no role sends no position at all — never a guess', () => {
    const qs = linkParams('camp-1', headHunterInviteRole(undefined));
    assert(!qs.includes('position='), `position must be absent: ${qs}`);
    assert(qs.includes('campaignId=camp-1'), 'campaignId must survive');
});

check('the campaign role reaches the link', () => {
    const qs = linkParams('camp-1', headHunterInviteRole('HR Generalist'));
    assert(qs.includes('position=HR+Generalist'), `campaign role missing: ${qs}`);
    assert(!qs.includes('Sales'), `candidate title leaked: ${qs}`);
});

check('whitespace-only campaign roles are treated as absent', () => {
    assert(headHunterInviteRole('   ') === '', 'blank-ish role must yield ""');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
