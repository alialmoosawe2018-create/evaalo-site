import {
    findCatalogEntryByLabelKey,
    JOB_CATALOG,
} from './buildCatalog.js';
import { ROLE_DEFINITIONS, SECTION_ORDER } from './roleDefinitions.js';
import {
    getRolePositionLabelKey,
    getRolePositionTitle,
    HIDDEN_FROM_ROLE_PICKER,
} from './positionTitle.js';
import type {
    CareerLevel,
    CatalogSection,
    JobCatalogEntry,
    RoleDefinition,
    RoleResolution,
} from './types.js';

/** Levels shown in Job Level UI (mid is implicit default — not listed). */
export const UI_CAREER_LEVELS: CareerLevel[] = [
    'intern',
    'junior',
    'senior',
    'lead',
    'supervisor',
    'manager',
    'head',
    'director',
    'executive',
];

export const DEFAULT_CAREER_LEVEL: CareerLevel = 'mid';

export const CAREER_LEVEL_RANK: Record<string, number> = {
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

export interface RoleOption {
    roleKey: string;
    value: string;
    labelKey: string;
    section: CatalogSection;
    domain: string;
    specialization: string;
    requiresDomainQualifier?: boolean;
}

export interface RoleOptionsGroup {
    section: CatalogSection;
    options: RoleOption[];
}

function getRoleDefinition(roleKey: string): RoleDefinition | undefined {
    return ROLE_DEFINITIONS.find((d) => d.roleKey === roleKey);
}

/** Default career level for a role when user has not picked Job Level. */
export function getDefaultCareerLevelForRole(roleKey: string): CareerLevel {
    const def = getRoleDefinition(roleKey);
    if (!def?.levels.length) return DEFAULT_CAREER_LEVEL;
    if (def.levels.some((l) => l.careerLevel === DEFAULT_CAREER_LEVEL)) {
        return DEFAULT_CAREER_LEVEL;
    }
    const track = def.defaultManagementTrack;
    const trackLevel = def.levels.find((l) => {
        if (l.careerLevel === track) return true;
        if (track === 'director' && l.careerLevel === 'head') return true;
        if (track === 'executive' && l.careerLevel === 'executive') return true;
        return false;
    });
    if (trackLevel) return trackLevel.careerLevel;
    const sorted = [...def.levels].sort(
        (a, b) =>
            (CAREER_LEVEL_RANK[a.careerLevel] ?? 99) - (CAREER_LEVEL_RANK[b.careerLevel] ?? 99)
    );
    return sorted[0]?.careerLevel ?? DEFAULT_CAREER_LEVEL;
}

/** Representative catalog entry for role-only Position display (prefer mid). */
export function getRepresentativeEntry(
    roleKey: string,
    catalog: JobCatalogEntry[] = JOB_CATALOG
): JobCatalogEntry | undefined {
    const def = getRoleDefinition(roleKey);
    if (!def) return undefined;

    const defaultLevel = getDefaultCareerLevelForRole(roleKey);
    const byDefault = catalog.find(
        (e) => e.roleKey === roleKey && e.careerLevel === defaultLevel
    );
    if (byDefault) return byDefault;

    const sorted = catalog
        .filter((e) => e.roleKey === roleKey)
        .sort(
            (a, b) =>
                (CAREER_LEVEL_RANK[a.careerLevel] ?? 99) -
                (CAREER_LEVEL_RANK[b.careerLevel] ?? 99)
        );
    return sorted[0];
}

export function resolveCatalogEntry(
    roleKey: string,
    careerLevel: CareerLevel | string,
    catalog: JobCatalogEntry[] = JOB_CATALOG
): JobCatalogEntry | undefined {
    const rk = String(roleKey || '').trim();
    const cl = String(careerLevel || '').trim() as CareerLevel;
    if (!rk || !cl) return undefined;
    return catalog.find((e) => e.roleKey === rk && e.careerLevel === cl);
}

/** Career levels available in UI for a role (UI list + graduate when role-only). */
export function getLevelsForRoleUI(roleKey: string): CareerLevel[] {
    const def = getRoleDefinition(roleKey);
    if (!def) return [];

    const roleLevels = new Set(def.levels.map((l) => l.careerLevel));
    const uiLevels = UI_CAREER_LEVELS.filter((l) => roleLevels.has(l));

    if (roleLevels.has('graduate') && uiLevels.length === 0) {
        return ['graduate'];
    }
    if (roleLevels.has('graduate') && !uiLevels.includes('graduate' as CareerLevel)) {
        const hasOnlyGraduate =
            def.levels.length === 1 && def.levels[0]?.careerLevel === 'graduate';
        if (hasOnlyGraduate) return ['graduate'];
    }

    return uiLevels.sort(
        (a, b) => (CAREER_LEVEL_RANK[a] ?? 99) - (CAREER_LEVEL_RANK[b] ?? 99)
    );
}

/** Whether careerLevel should appear empty in Job Level UI (implicit mid). */
export function isImplicitDefaultLevel(
    roleKey: string,
    careerLevel: CareerLevel | string | null | undefined
): boolean {
    const cl = String(careerLevel || '').trim();
    if (!cl) return true;
    return cl === getDefaultCareerLevelForRole(roleKey);
}

/** UI value for Job Level select — empty string when mid/default is implicit. */
export function toJobLevelUiValue(
    roleKey: string,
    careerLevel: CareerLevel | string | null | undefined
): string {
    if (!roleKey || isImplicitDefaultLevel(roleKey, careerLevel)) return '';
    return String(careerLevel || '').trim();
}

/** Resolve stored careerLevel from UI Job Level selection. */
export function fromJobLevelUiValue(
    roleKey: string,
    uiValue: string
): CareerLevel {
    const trimmed = String(uiValue || '').trim();
    if (!trimmed) return getDefaultCareerLevelForRole(roleKey);
    return trimmed as CareerLevel;
}

export function getRoleOptionsBySection(): RoleOptionsGroup[] {
    const bySection = new Map<CatalogSection, RoleOption[]>();

    for (const def of ROLE_DEFINITIONS) {
        if (HIDDEN_FROM_ROLE_PICKER.has(def.roleKey)) continue;

        const opt: RoleOption = {
            roleKey: def.roleKey,
            value: def.roleKey,
            labelKey: getRolePositionLabelKey(def.roleKey),
            section: def.section,
            domain: def.domain,
            specialization: def.specialization,
            requiresDomainQualifier: def.requiresDomainQualifier,
        };

        if (!bySection.has(def.section)) bySection.set(def.section, []);
        bySection.get(def.section)!.push(opt);
    }

    return SECTION_ORDER.filter((sec) => bySection.has(sec)).map((section) => ({
        section,
        options: bySection
            .get(section)!
            .sort((a, b) =>
                getRolePositionTitle(a.roleKey).localeCompare(getRolePositionTitle(b.roleKey))
            ),
    }));
}

export function composeRoleResolution(
    roleKey: string,
    careerLevel?: CareerLevel | string | null,
    catalog: JobCatalogEntry[] = JOB_CATALOG
): RoleResolution {
    const rk = String(roleKey || '').trim();
    if (!rk) {
        return {
            roleKey: null,
            careerLevel: '',
            managementTrack: 'ic',
            displayTitle: '',
            confidence: 0,
            matchSource: 'unknown',
        };
    }

    const cl = careerLevel
        ? (String(careerLevel).trim() as CareerLevel)
        : getDefaultCareerLevelForRole(rk);

    const entry =
        resolveCatalogEntry(rk, cl, catalog) ??
        getRepresentativeEntry(rk, catalog);

    if (!entry) {
        return {
            roleKey: rk,
            careerLevel: cl,
            managementTrack: 'ic',
            displayTitle: rk.replace(/_/g, ' '),
            labelKey: `${rk}.${cl}`,
            confidence: 0.5,
            matchSource: 'unknown',
        };
    }

    return {
        roleKey: entry.roleKey,
        careerLevel: entry.careerLevel,
        managementTrack: entry.managementTrack,
        displayTitle: entry.displayTitle,
        labelKey: entry.labelKey,
        domain: entry.domain,
        specialization: entry.specialization,
        confidence: 0.98,
        matchSource: 'exact_catalog',
    };
}

export function resolutionFromCriteriaFields(
    criteria: Record<string, unknown> | null | undefined
): RoleResolution | null {
    if (!criteria) return null;

    const roleKey = typeof criteria.roleKey === 'string' ? criteria.roleKey.trim() : '';
    const labelKey = typeof criteria.labelKey === 'string' ? criteria.labelKey.trim() : '';

    if (labelKey) {
        const entry = findCatalogEntryByLabelKey(labelKey);
        if (entry) {
            return composeRoleResolution(entry.roleKey, entry.careerLevel);
        }
    }

    if (roleKey) {
        const careerLevel =
            typeof criteria.careerLevel === 'string' && criteria.careerLevel.trim()
                ? criteria.careerLevel.trim()
                : getDefaultCareerLevelForRole(roleKey);
        return composeRoleResolution(roleKey, careerLevel);
    }

    return null;
}
