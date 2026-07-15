import type { JobCatalogEntry } from './types.js';
import { ROLE_DEFINITIONS, SECTION_ORDER } from './roleDefinitions.js';

export function buildJobCatalog(): JobCatalogEntry[] {
    const entries: JobCatalogEntry[] = [];

    for (const def of ROLE_DEFINITIONS) {
        for (const level of def.levels) {
            const careerLevel = level.careerLevel;
            const labelKey = `${def.roleKey}.${careerLevel}`;
            entries.push({
                roleKey: def.roleKey,
                domain: def.domain,
                specialization: def.specialization,
                careerLevel,
                managementTrack: level.managementTrack ?? def.defaultManagementTrack,
                labelKey,
                displayTitle: level.displayTitle,
                section: def.section,
                requiresDomainQualifier: def.requiresDomainQualifier,
            });
        }
    }

    return entries;
}

const bySectionIndex = (section: JobCatalogEntry['section']) =>
    SECTION_ORDER.indexOf(section);

/** Sorted for UI: section order, then roleKey, then career level rank. */
const LEVEL_RANK: Record<string, number> = {
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

export function sortCatalogEntries(entries: JobCatalogEntry[]): JobCatalogEntry[] {
    return [...entries].sort((a, b) => {
        const sa = bySectionIndex(a.section);
        const sb = bySectionIndex(b.section);
        if (sa !== sb) return sa - sb;
        const rk = a.roleKey.localeCompare(b.roleKey);
        if (rk !== 0) return rk;
        return (LEVEL_RANK[a.careerLevel] ?? 99) - (LEVEL_RANK[b.careerLevel] ?? 99);
    });
}

export const JOB_CATALOG: JobCatalogEntry[] = sortCatalogEntries(buildJobCatalog());

export function getDisplayTitles(catalog: JobCatalogEntry[] = JOB_CATALOG): string[] {
    return catalog.map((e) => e.displayTitle);
}

export function findCatalogEntryByDisplayTitle(
    title: string,
    catalog: JobCatalogEntry[] = JOB_CATALOG
): JobCatalogEntry | undefined {
    const norm = normalizeTitle(title);
    return catalog.find((e) => normalizeTitle(e.displayTitle) === norm);
}

export function findCatalogEntryByLabelKey(
    labelKey: string,
    catalog: JobCatalogEntry[] = JOB_CATALOG
): JobCatalogEntry | undefined {
    return catalog.find((e) => e.labelKey === labelKey);
}

export function normalizeTitle(s: string): string {
    return String(s || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\u2013/g, '-')
        .replace(/–/g, '-')
        .toLowerCase();
}
