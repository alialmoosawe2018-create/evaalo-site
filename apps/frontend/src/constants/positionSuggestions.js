/**
 * Position suggestions — sourced from Evaalo Job Catalog (apps/shared/jobCatalog).
 * i18n: positionLabels.{ar,ku}.json keyed by labelKey (e.g. backend_developer.senior).
 */
import {
    getDisplayTitles,
    getRoleOptionsBySection,
    getRolePositionLabelKey,
    getRolePositionTitle,
    JOB_CATALOG,
} from '@evaalo/job-catalog';

export { JOB_CATALOG, getDisplayTitles };

export const POSITION_SUGGESTIONS = getDisplayTitles();

/** For combobox: value + labelKey + role metadata + UI section */
export const POSITION_CATALOG_OPTIONS = JOB_CATALOG.map((entry) => ({
    value: entry.displayTitle,
    labelKey: entry.labelKey,
    roleKey: entry.roleKey,
    careerLevel: entry.careerLevel,
    managementTrack: entry.managementTrack,
    domain: entry.domain,
    specialization: entry.specialization,
    section: entry.section,
    requiresDomainQualifier: entry.requiresDomainQualifier ?? false,
}));

/** One option per roleKey — for Position / role-only picker (level chosen separately). */
export const ROLE_CATALOG_OPTIONS = getRoleOptionsBySection().flatMap((group) =>
    group.options.map((opt) => ({
        value: opt.roleKey,
        label: getRolePositionTitle(opt.roleKey),
        labelKey: getRolePositionLabelKey(opt.roleKey),
        roleKey: opt.roleKey,
        section: group.section,
        domain: opt.domain,
        specialization: opt.specialization,
        managementTrack: 'ic',
        requiresDomainQualifier: opt.requiresDomainQualifier ?? false,
    }))
);
