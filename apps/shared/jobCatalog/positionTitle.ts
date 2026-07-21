import { ROLE_DEFINITIONS } from './roleDefinitions.js';
import type { RoleDefinition } from './types.js';

const CAREER_LEVEL_RANK: Record<string, number> = {
    intern: 0,
    graduate: 1,
    junior: 2,
    mid: 3,
    senior: 4,
    lead: 5,
    supervisor: 6,
    manager: 7,
    head: 8,
    director: 9,
    executive: 10,
};

const LEVEL_PREFIX_RE = /^(Senior|Junior|Lead)\s+/i;

/** Roles where auto-derivation needs an explicit neutral title. */
const POSITION_TITLE_OVERRIDES: Record<string, string> = {
    graduate_trainee: 'Graduate Trainee',
    researcher: 'Researcher',
    researcher_energy: 'Energy Researcher',
    researcher_market_intelligence: 'Market Intelligence Researcher',
    researcher_public_policy: 'Public Policy Researcher',
    researcher_data_research: 'Data Researcher',
    recruiter: 'Recruitment',
};

function stripLevelPrefix(title: string): string {
    return title.replace(LEVEL_PREFIX_RE, '').trim();
}

function derivePositionTitle(def: RoleDefinition): string {
    if (def.positionTitle) return def.positionTitle;

    const override = POSITION_TITLE_OVERRIDES[def.roleKey];
    if (override) return override;

    const mid = def.levels.find((l) => l.careerLevel === 'mid');
    if (mid) return mid.displayTitle;

    const manager = def.levels.find((l) => l.careerLevel === 'manager');
    if (manager) return stripLevelPrefix(manager.displayTitle);

    const executive = def.levels.find((l) => l.careerLevel === 'executive');
    if (executive) return executive.displayTitle;

    const graduate = def.levels.find((l) => l.careerLevel === 'graduate');
    if (graduate && def.levels.length > 1) return graduate.displayTitle;

    if (def.levels.length === 1) return def.levels[0]!.displayTitle;

    const sorted = [...def.levels].sort(
        (a, b) =>
            (CAREER_LEVEL_RANK[a.careerLevel] ?? 99) - (CAREER_LEVEL_RANK[b.careerLevel] ?? 99)
    );
    return stripLevelPrefix(sorted[0]?.displayTitle ?? def.roleKey.replace(/_/g, ' '));
}

const POSITION_TITLE_BY_ROLE = new Map<string, string>(
    ROLE_DEFINITIONS.map((def) => [def.roleKey, derivePositionTitle(def)])
);

/** Neutral position name for role-only picker (no Senior/Junior/Lead prefix). */
export function getRolePositionTitle(roleKey: string): string {
    const rk = String(roleKey || '').trim();
    if (!rk) return '';
    return POSITION_TITLE_BY_ROLE.get(rk) ?? rk.replace(/_/g, ' ');
}

/** i18n key for position-only labels in positionLabels.{ar,ku}.json */
export function getRolePositionLabelKey(roleKey: string): string {
    return `positionRole_${String(roleKey || '').trim()}`;
}

/** Roles hidden from role-only Position picker (legacy hydration only). */
export const HIDDEN_FROM_ROLE_PICKER = new Set([
    'researcher_energy',
    'researcher_market_intelligence',
    'researcher_public_policy',
    'researcher_data_research',
]);
