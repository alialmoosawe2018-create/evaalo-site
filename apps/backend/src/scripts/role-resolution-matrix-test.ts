/**
 * Role Resolution Matrix — regression for Position / Job Level split.
 * Usage: npx tsx src/scripts/role-resolution-matrix-test.ts
 */
import {
    composeRoleResolution,
    getDefaultCareerLevelForRole,
    getLevelsForRoleUI,
    getRepresentativeEntry,
    getRoleOptionsBySection,
    isImplicitDefaultLevel,
    resolveCatalogEntry,
    toJobLevelUiValue,
} from '../shared/jobCatalog/catalogOptions.js';
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

    // Generalized invariant behind the regression above
    {
        for (const def of ROLE_DEFINITIONS) {
            if (!def.levels.some((l) => l.careerLevel === 'mid')) continue;
            const res = composeRoleResolution(def.roleKey);
            assertEq(res.careerLevel, 'mid', `role defining mid must default to mid: ${def.roleKey}`);
        }
    }

    console.log('role-resolution-matrix-test: all assertions passed');
}

main();
