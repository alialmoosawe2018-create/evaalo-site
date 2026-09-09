/**
 * Regression for the video interview that asked about the wrong job.
 *
 * 2026-09-06, candidate 6a9dbf1d (علي احمد عواد), n8n executions 1730/1731:
 *
 *   campaign 9ae0f0716e1a  criteria.position = "Senior HR Assistant"
 *   his application        position_applied_for = "Senior Petroleum Engineer"
 *
 * It was his FIRST and ONLY application, so this is not a returning-applicant
 * leak — the value was wrong when it was written. The agent's question bank
 * reads that field (videoInterview.ts:529), its title_index carries
 * "petroleum engineer" and has no "hr assistant", so he was asked about wells,
 * reservoirs, GOR and nodal analysis — then scored against HR competencies.
 * Result: blueprint_coverage 0, score 0, Reject.
 *
 * Across the four recent video candidates the correlation was total: the only
 * one that produced a score was the only one whose two sources agreed.
 *
 * Run: npm run test:intake-position
 */
import { reconcileIntakePosition, campaignRoleFromCampaign } from '../services/campaignRole.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}\n       expected ${e}\n       got      ${a}`);
    }
}

// ── the real case ───────────────────────────────────────────────────────────
console.log('— علي احمد عواد, campaign 9ae0f0716e1a —');
check(
    'the campaign wins, and his wording is kept',
    reconcileIntakePosition({
        declared: 'Senior Petroleum Engineer',
        campaignRole: 'Senior HR Assistant',
    }),
    {
        position_applied_for: 'Senior HR Assistant',
        declaredPosition: 'Senior Petroleum Engineer',
        corrected: true,
    }
);

// The campaign document shape this is read from, exactly as stored.
check(
    'campaignRoleFromCampaign reads criteria.position',
    campaignRoleFromCampaign({
        criteria: { position: 'Senior HR Assistant', roleKey: 'hr_assistant', job: '' },
    }),
    'Senior HR Assistant'
);

console.log('\n— the other three video candidates —');
check(
    'عمار عماد already agreed — nothing to correct',
    reconcileIntakePosition({ declared: 'General Accountant', campaignRole: 'General Accountant' }),
    { position_applied_for: 'General Accountant', corrected: false }
);
check(
    'ALI MAHMOOD NAJM: "HR Supervisor" vs "Senior HR Specialist" is still a mismatch',
    reconcileIntakePosition({ declared: 'HR Supervisor', campaignRole: 'Senior HR Specialist' }),
    {
        position_applied_for: 'Senior HR Specialist',
        declaredPosition: 'HR Supervisor',
        corrected: true,
    }
);

// ── it must never blank out a job ───────────────────────────────────────────
//
// ⚠️ position_applied_for is `required: true` on the Candidate schema. A rule
// that returned an empty string here would fail every submission for a campaign
// that names no role — which is most of the older ones.
console.log('\n— a campaign with no role leaves the applicant alone —');
check(
    'no campaign role → untouched',
    reconcileIntakePosition({ declared: 'Mud Engineer', campaignRole: '' }),
    { corrected: false }
);
check(
    'no campaign role and no declared → still untouched',
    reconcileIntakePosition({ declared: '', campaignRole: undefined }),
    { corrected: false }
);
check(
    'a blank applicant field is filled from the campaign, and nothing is "corrected"',
    reconcileIntakePosition({ declared: '   ', campaignRole: 'Senior HR Assistant' }),
    { position_applied_for: 'Senior HR Assistant', corrected: false }
);

// ── cosmetic differences are not mismatches ─────────────────────────────────
//
// Counting these would make the mismatch metric useless — it would fire on
// every application whose form trimmed differently from the campaign's wording.
console.log('\n— spacing and case are not a mismatch —');
check(
    'different case',
    reconcileIntakePosition({ declared: 'senior hr assistant', campaignRole: 'Senior HR Assistant' }),
    { position_applied_for: 'Senior HR Assistant', corrected: false }
);
check(
    'double spaces and padding',
    reconcileIntakePosition({
        declared: '  Senior   HR  Assistant ',
        campaignRole: 'Senior HR Assistant',
    }),
    { position_applied_for: 'Senior HR Assistant', corrected: false }
);
// Arabic must behave the same way — the campaigns are written in both.
check(
    'Arabic, identical',
    reconcileIntakePosition({ declared: 'مهندس نفط أقدم', campaignRole: 'مهندس نفط أقدم' }),
    { position_applied_for: 'مهندس نفط أقدم', corrected: false }
);
check(
    'Arabic, genuinely different',
    reconcileIntakePosition({ declared: 'مهندس نفط', campaignRole: 'مساعد موارد بشرية' }),
    {
        position_applied_for: 'مساعد موارد بشرية',
        declaredPosition: 'مهندس نفط',
        corrected: true,
    }
);

// ── odd inputs must not throw on a submission path ──────────────────────────
console.log('\n— nothing here may throw: this runs inside POST /api/candidates —');
for (const [label, opts] of [
    ['null declared', { declared: null, campaignRole: 'X' }],
    ['numeric declared', { declared: 123, campaignRole: 'X' }],
    ['object campaignRole', { declared: 'Y', campaignRole: {} }],
    ['both undefined', {}],
] as const) {
    try {
        reconcileIntakePosition(opts as Record<string, unknown>);
        console.log(`ok   survives: ${label}`);
    } catch (err: any) {
        failures += 1;
        console.error(`FAIL threw on ${label}: ${err?.message || err}`);
    }
}
// `{}` stringifies to "[object Object]", which is not a real role — but the
// campaign field is a String in the schema, so this is a guard, not a case.
check(
    'a numeric declared value still gets corrected, not dropped',
    reconcileIntakePosition({ declared: 123, campaignRole: 'Senior HR Assistant' }),
    { position_applied_for: 'Senior HR Assistant', declaredPosition: '123', corrected: true }
);

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nintake-position-test: OK');
