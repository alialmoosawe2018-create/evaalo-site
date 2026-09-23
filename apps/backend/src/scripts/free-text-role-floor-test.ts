/**
 * The server-side confidence floor on free-text job titles, and the Head Hunter
 * route finally reading the picker's structured role.
 *
 * Background (measured against the deployed build, 2026-09-23): `fuzzyMatchCatalog`
 * reports a hardcoded 0.65 and matches on `endsWith`, so 22 catalog entries whose base
 * is a single generic noun ("Junior Specialist" → "specialist", "Partner" → "partner")
 * swallowed any title ending in that word. Of 452 realistic non-catalog titles that got
 * a roleKey, 176 were wrong and 135 landed in a different domain. The browser already
 * refused these (PositionSuggestCombobox: fuzzy only at confidence >= 0.85); the server
 * did not — so the exact strings the UI rejected were the ones the backend got wrong.
 *
 * Usage: npm run test:free-text-role-floor
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    MIN_FREE_TEXT_CONFIDENCE,
    resolveJobRole,
    resolveJobRoleFromCriteria,
} from '../shared/jobCatalog/resolveJobRole.js';

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${msg}`);
    } else {
        failures.push(msg);
        console.log(`  ✗ ${msg}`);
    }
}

/** The titles that used to be graded as an unrelated role. */
const SWALLOWED: { title: string; usedToBecome: string }[] = [
    { title: 'Payroll Specialist', usedToBecome: 'graduate_trainee' },
    { title: 'Senior Compensation & Benefits Specialist', usedToBecome: 'graduate_trainee' },
    { title: 'HSE Specialist', usedToBecome: 'graduate_trainee' },
    { title: 'Recruitment Specialist', usedToBecome: 'graduate_trainee' },
    { title: 'IT Specialist', usedToBecome: 'graduate_trainee' },
    { title: 'Talent Acquisition Partner', usedToBecome: 'lawyer' },
    { title: 'People Partner', usedToBecome: 'lawyer' },
    { title: 'Media Buyer', usedToBecome: 'buyer' },
    { title: 'Market Researcher', usedToBecome: 'researcher' },
    { title: 'Staff Accountant', usedToBecome: 'general_accountant' },
];

function testFloorRejectsWeakFuzzy(): void {
    console.log('\nfree text below the floor claims no role:');
    for (const { title, usedToBecome } of SWALLOWED) {
        // The raw resolver still finds the weak match — this is the bug being contained,
        // and proves each case really does exercise the fuzzy path (not some other branch).
        const raw = resolveJobRole(title);
        check(
            raw.matchSource === 'fuzzy' && raw.roleKey === usedToBecome,
            `"${title}" still fuzzy-matches ${usedToBecome} at the raw resolver (guards the fixture)`
        );

        const viaCriteria = resolveJobRoleFromCriteria({ position: title });
        check(viaCriteria.roleKey === null, `"${title}" → no roleKey (was ${usedToBecome})`);
        check(
            viaCriteria.displayTitle === title,
            `"${title}" keeps the recruiter's own title, not the catalog's`
        );
    }
}

function testFloorKeepsEverythingElse(): void {
    console.log('\nconfident paths are untouched:');

    const exact = resolveJobRoleFromCriteria({ position: 'HSE Engineer' });
    check(exact.roleKey === 'hse_engineer', 'exact catalog title still resolves');
    check(exact.matchSource === 'exact_catalog', 'exact catalog keeps its matchSource');

    const alias = resolveJobRoleFromCriteria({ position: 'Compensation & Benefits Specialist' });
    check(alias.roleKey === 'compensation_benefits_specialist', 'legacy alias still resolves');
    check(alias.matchSource === 'legacy_alias', 'legacy alias keeps its matchSource');
    check(alias.confidence >= MIN_FREE_TEXT_CONFIDENCE, 'legacy alias sits on/above the floor');

    const structured = resolveJobRoleFromCriteria({
        roleKey: 'compensation_benefits_specialist',
        labelKey: 'compensation_benefits_specialist.senior',
        careerLevel: 'senior',
        // A position string that WOULD fuzzy-match graduate_trainee if the structured
        // fields were ignored — this is exactly the Head Hunter situation.
        position: 'Senior Compensation & Benefits Specialist',
    });
    check(
        structured.roleKey === 'compensation_benefits_specialist',
        'structured labelKey wins over a string that would fuzzy-match elsewhere'
    );
    check(structured.careerLevel === 'senior', 'structured careerLevel survives');

    const ambiguous = resolveJobRoleFromCriteria({ position: 'Production Engineer' });
    check(ambiguous.roleKey === null, 'ambiguous legacy title still claims no role');
    check(
        ambiguous.matchSource === 'ambiguous_legacy',
        'ambiguous legacy keeps its own matchSource (not overwritten by the floor)'
    );
}

function testBrowserPathUnchanged(): void {
    console.log('\nthe browser path is byte-identical (the picker owns its own rule):');
    const raw = resolveJobRole('Payroll Specialist');
    check(raw.roleKey === 'graduate_trainee', 'resolveJobRole() itself is NOT changed');
    check(raw.confidence === 0.65, 'fuzzy still reports 0.65 to the picker');
    check(
        raw.confidence < MIN_FREE_TEXT_CONFIDENCE,
        'and the picker rejects it by the same floor the server now applies'
    );
}

function testHeadHunterRouteIsWired(): void {
    console.log('\nthe Head Hunter route actually forwards the picker fields:');
    const here = dirname(fileURLToPath(import.meta.url));
    const route = readFileSync(resolve(here, '../routes/headHunter.ts'), 'utf8');

    check(
        /function roleFieldsFrom\(/.test(route),
        'headHunter.ts defines the one shared derivation helper'
    );
    const wired = route.match(/\.\.\.roleFieldsFrom\(/g) || [];
    check(
        wired.length === 2,
        `both call sites use it — /search and the warm-up (found ${wired.length}, expected 2)`
    );
    for (const field of ['roleKey', 'labelKey', 'careerLevel', 'managementTrack']) {
        check(
            new RegExp(`${field}: str\\(body\\.${field}`).test(route),
            `the route reads body.${field} (it read none of these before)`
        );
    }

    const service = readFileSync(
        resolve(here, '../services/headHunterCompetencyModel.ts'),
        'utf8'
    );
    check(
        /criteria\.labelKey = labelKey/.test(service)
            && /criteria\.roleKey = roleKey/.test(service),
        'the service copies them into the criteria the resolver reads'
    );
    check(
        /parts\.push\(`labelKey=/.test(service),
        'the competency cache key includes the structured role, so two roles cannot collide'
    );
}

testFloorRejectsWeakFuzzy();
testFloorKeepsEverythingElse();
testBrowserPathUnchanged();
testHeadHunterRouteIsWired();

console.log(`\n[free-text-role-floor] ${passed} passed, ${failures.length} failed`);
if (failures.length) {
    for (const f of failures) console.error(`  FAILED: ${f}`);
    process.exit(1);
}
