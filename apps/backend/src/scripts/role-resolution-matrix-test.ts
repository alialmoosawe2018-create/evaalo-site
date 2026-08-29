/**
 * Role Resolution Matrix — regression for Position / Job Level split.
 * Usage: npx tsx src/scripts/role-resolution-matrix-test.ts
 */
import {
    composeRoleResolution,
    getDefaultCareerLevelForRole,
    getLevelOptionsForRoleUI,
    getLevelsForRoleUI,
    getRepresentativeEntry,
    getRoleOptionsBySection,
    isImplicitDefaultLevel,
    isRecommendedLevelForRole,
    resolveCatalogEntry,
    toJobLevelUiValue,
    UI_CAREER_LEVELS,
} from '../shared/jobCatalog/catalogOptions.js';
import { deriveInterviewLevel } from '../shared/jobCatalog/careerLevelOverlays.js';
import { getRolePositionTitle, HIDDEN_FROM_ROLE_PICKER } from '../shared/jobCatalog/positionTitle.js';
import { ROLE_DEFINITIONS } from '../shared/jobCatalog/roleDefinitions.js';
import { resolveJobRole, resolveJobRoleFromCriteria } from '../shared/jobCatalog/resolveJobRole.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
    if (actual !== expected) {
        throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function main(): void {
    // Backend Developer, no explicit level → mid implicit
    {
        const rep = getRepresentativeEntry('backend_developer');
        assert(!!rep, 'backend_developer representative exists');
        const res = composeRoleResolution('backend_developer');
        assertEq(res.roleKey, 'backend_developer', 'backend default roleKey');
        assertEq(res.careerLevel, 'mid', 'backend default careerLevel');
        assert(isImplicitDefaultLevel('backend_developer', res.careerLevel), 'mid is implicit');
        assertEq(toJobLevelUiValue('backend_developer', res.careerLevel), '', 'UI level empty for mid');
    }

    // Backend Developer + Senior
    {
        const res = composeRoleResolution('backend_developer', 'senior');
        assertEq(res.roleKey, 'backend_developer', 'backend senior roleKey');
        assertEq(res.careerLevel, 'senior', 'backend senior level');
        assertEq(res.displayTitle, 'Senior Backend Developer', 'backend senior title');
        assertEq(toJobLevelUiValue('backend_developer', 'senior'), 'senior', 'UI shows senior');
    }

    // Legacy title hydration
    {
        const legacy = resolveJobRole('Senior Backend Developer');
        assertEq(legacy.roleKey, 'backend_developer', 'legacy senior backend roleKey');
        assertEq(legacy.careerLevel, 'senior', 'legacy senior backend level');
    }

    // Petroleum Engineer + Manager
    {
        const entry = resolveCatalogEntry('petroleum_engineer', 'manager');
        assert(!!entry, 'petroleum_engineer manager entry exists');
        const res = composeRoleResolution('petroleum_engineer', 'manager');
        assertEq(res.roleKey, 'petroleum_engineer', 'petroleum manager roleKey');
        assertEq(res.careerLevel, 'manager', 'petroleum manager level');
    }

    // Compensation and Benefits Specialist — default mid
    {
        const res = composeRoleResolution('compensation_benefits_specialist');
        assertEq(res.roleKey, 'compensation_benefits_specialist', 'comp specialist roleKey');
        assertEq(res.careerLevel, 'mid', 'comp specialist default mid');
        assertEq(
            toJobLevelUiValue('compensation_benefits_specialist', res.careerLevel),
            '',
            'comp specialist UI empty'
        );
    }

    // Role without senior in UI levels — getLevelsForRoleUI filters correctly
    {
        const levels = getLevelsForRoleUI('backend_developer');
        assert(levels.includes('senior'), 'backend_developer has senior in UI');
        assert(!levels.includes('mid'), 'mid never in UI levels list');
    }

    // Default level fallback for roles without mid
    {
        const internDef = getDefaultCareerLevelForRole('intern');
        assertEq(internDef, 'intern', 'intern role defaults to intern');
    }

    // HR Manager position title (no Senior prefix)
    {
        assertEq(getRolePositionTitle('hr_manager'), 'HR Manager', 'hr_manager positionTitle');
        const res = composeRoleResolution('hr_manager');
        assertEq(res.careerLevel, 'manager', 'hr_manager default manager not senior');
    }

    // HR Specialist + Senior
    {
        const res = composeRoleResolution('hr_specialist', 'senior');
        assertEq(res.displayTitle, 'Senior HR Specialist', 'hr specialist senior title');
    }

    // Graduate trainee neutral title
    {
        assertEq(getRolePositionTitle('graduate_trainee'), 'Graduate Trainee', 'graduate_trainee title');
    }

    // positionTitle must not start with Senior/Junior/Lead (except intern role)
    {
        const PREFIX = /^(Senior|Junior|Lead)\s/i;
        for (const def of ROLE_DEFINITIONS) {
            const title = getRolePositionTitle(def.roleKey);
            if (def.roleKey === 'intern') continue;
            assert(!PREFIX.test(title), `positionTitle has level prefix: ${def.roleKey} -> ${title}`);
        }
    }

    // resolveJobRoleFromCriteria with roleKey only
    {
        const res = resolveJobRoleFromCriteria({ roleKey: 'hr_specialist' });
        assertEq(res.roleKey, 'hr_specialist', 'criteria roleKey only');
        assertEq(res.careerLevel, 'mid', 'criteria default mid');
    }

    // Researcher specialized roles hidden from picker
    {
        const keys = getRoleOptionsBySection().flatMap((g) => g.options.map((o) => o.roleKey));
        for (const hidden of HIDDEN_FROM_ROLE_PICKER) {
            assert(!keys.includes(hidden), `hidden role in picker: ${hidden}`);
        }
    }

    // Same roleKey pack invariant
    {
        const mid = composeRoleResolution('recruiter', 'mid');
        const senior = composeRoleResolution('recruiter', 'senior');
        assertEq(mid.roleKey, senior.roleKey, 'recruiter pack roleKey invariant');
    }

    {
        const levels = getLevelsForRoleUI('ceo');
        assertEq(levels.length, 1, 'ceo one UI level');
        assertEq(levels[0], 'executive', 'ceo executive only');
    }

    // Backend developer intern level
    {
        const levels = getLevelsForRoleUI('backend_developer');
        assert(levels.includes('intern'), 'backend_developer has intern in UI');
    }

    // Regression: roles defined as mid + one other level used to be force-upgraded,
    // because mid is hidden from the UI list so only the other level remained visible.
    {
        const previouslyUpgraded = [
            'hr_specialist',
            'hr_officer',
            'hr_assistant',
            'marketing_specialist',
            'finance_specialist',
            'procurement_specialist',
            'credit_controller',
            'bim_engineer',
            'planning_engineer',
        ];
        for (const roleKey of previouslyUpgraded) {
            assert(!!getRepresentativeEntry(roleKey), `role exists: ${roleKey}`);
            const res = composeRoleResolution(roleKey);
            assertEq(res.careerLevel, 'mid', `${roleKey} must stay mid by default`);
            assertEq(toJobLevelUiValue(roleKey, res.careerLevel), '', `${roleKey} UI level empty`);
            assertEq(getLevelsForRoleUI(roleKey).length, 1, `${roleKey} still has one UI level`);
        }
        assertEq(
            composeRoleResolution('credit_controller').displayTitle,
            'Credit Controller',
            'credit_controller keeps base title, not Credit Control Manager'
        );
    }

    // Interview seniority vs catalog level: support titles kept at `mid` for UI
    // reasons must be INTERVIEWED as junior (so competencies match execution scope),
    // without changing the catalog level (the regression block above still holds).
    {
        // catalog level stays mid (UI-facing)…
        assertEq(composeRoleResolution('hr_assistant').careerLevel, 'mid', 'hr_assistant catalog level stays mid');
        // …but the interview overlay level is downgraded for the support title.
        assertEq(deriveInterviewLevel('HR Assistant', 'mid'), 'junior', 'HR Assistant interviews as junior');
        assertEq(deriveInterviewLevel('Administrative Assistant', 'mid'), 'junior', 'Administrative Assistant interviews as junior');
        assertEq(deriveInterviewLevel('مساعد موارد بشرية', 'mid'), 'junior', 'Arabic assistant title interviews as junior');
        // non-support mid roles are unaffected…
        assertEq(deriveInterviewLevel('HR Specialist', 'mid'), 'mid', 'specialist stays mid');
        assertEq(deriveInterviewLevel('HR Business Partner', 'mid'), 'mid', 'business partner stays mid');
        // …and a senior support title is never downgraded.
        assertEq(deriveInterviewLevel('Senior HR Assistant', 'senior'), 'senior', 'senior assistant stays senior');
        assertEq(deriveInterviewLevel('Executive Assistant', 'junior'), 'junior', 'already-junior passes through');
        // roleKey-driven support scope — the title need not self-identify.
        assertEq(deriveInterviewLevel('Front Desk Staff', 'mid', 'receptionist'), 'junior', 'receptionist roleKey → junior');
        assertEq(deriveInterviewLevel('Window Staff', 'mid', 'bank_teller'), 'junior', 'bank_teller roleKey → junior');
        // Broadened title heuristic catches more execution/support titles.
        assertEq(deriveInterviewLevel('Data Entry Operator', 'mid'), 'junior', 'data entry title → junior');
        assertEq(deriveInterviewLevel('موظف استقبال', 'mid'), 'junior', 'Arabic receptionist title → junior');
        // An explicit senior+ pick is honored even for a support roleKey (never downgraded).
        assertEq(deriveInterviewLevel('Receptionist', 'manager', 'receptionist'), 'manager', 'explicit manager pick honored');
    }

    // Generalized invariant behind the regression above
    {
        for (const def of ROLE_DEFINITIONS) {
            if (!def.levels.some((l) => l.careerLevel === 'mid')) continue;
            const res = composeRoleResolution(def.roleKey);
            assertEq(res.careerLevel, 'mid', `role defining mid must default to mid: ${def.roleKey}`);
        }
    }

    // Recommended Levels: a level the catalog does not pair with the role is kept,
    // and the neutral role title is used instead of a composed one.
    {
        assert(!resolveCatalogEntry('receptionist', 'manager'), 'receptionist manager is off-catalog');
        const res = composeRoleResolution('receptionist', 'manager');
        assertEq(res.roleKey, 'receptionist', 'off-catalog keeps roleKey');
        assertEq(res.careerLevel, 'manager', 'off-catalog keeps chosen level');
        assertEq(res.displayTitle, 'Receptionist', 'off-catalog keeps neutral title');
        assertEq(res.managementTrack, 'manager', 'off-catalog track implied by level');

        const senior = composeRoleResolution('credit_controller', 'senior');
        assertEq(senior.careerLevel, 'senior', 'credit_controller senior kept');
        assertEq(senior.displayTitle, 'Credit Controller', 'credit_controller keeps neutral title');

        // In-catalog pairs must still win over the neutral title
        const manager = composeRoleResolution('credit_controller', 'manager');
        assertEq(manager.displayTitle, 'Credit Control Manager', 'in-catalog title still composed');
    }

    // Every UI level stays selectable, split into recommended and the rest
    {
        for (const roleKey of ['receptionist', 'hr_specialist', 'backend_developer']) {
            const { recommended, other } = getLevelOptionsForRoleUI(roleKey);
            const all = [...recommended, ...other];
            assertEq(new Set(all).size, all.length, `${roleKey} level options are unique`);
            for (const level of UI_CAREER_LEVELS) {
                assert(all.includes(level), `${roleKey} exposes ${level}`);
            }
        }

        assert(isRecommendedLevelForRole('hr_specialist', 'senior'), 'senior recommended for hr_specialist');
        assert(isRecommendedLevelForRole('hr_specialist', 'mid'), 'implicit mid never flagged uncommon');
        assert(isRecommendedLevelForRole('hr_specialist', ''), 'empty level never flagged uncommon');
        assert(!isRecommendedLevelForRole('receptionist', 'manager'), 'manager uncommon for receptionist');
    }

    console.log('role-resolution-matrix-test: all assertions passed');
}

main();
