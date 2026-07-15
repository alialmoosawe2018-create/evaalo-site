/** Merge Evaalo Job Catalog resolution into form/criteria state. */
export function mergeRoleResolution(prev, resolution) {
    if (!resolution) return prev;
    return {
        ...prev,
        roleKey: resolution.roleKey ?? '',
        careerLevel: resolution.careerLevel ?? '',
        managementTrack: resolution.managementTrack ?? '',
        labelKey: resolution.labelKey ?? '',
        roleMatchSource: resolution.matchSource ?? '',
    };
}

/** Apply composed resolution to criteria state including display position title. */
export function applyRoleResolutionToState(prev, resolution) {
    if (!resolution) return prev;
    return {
        ...mergeRoleResolution(prev, resolution),
        position: resolution.displayTitle ?? prev.position ?? '',
    };
}

/** Structured catalog fields for API payloads (omit empty strings). */
export function roleResolutionCriteriaFields(source) {
    const out = {};
    const roleKey = String(source?.roleKey ?? source?.appliedRoleKey ?? '').trim();
    const careerLevel = String(source?.careerLevel ?? source?.appliedCareerLevel ?? '').trim();
    const managementTrack = String(source?.managementTrack ?? '').trim();
    const labelKey = String(source?.labelKey ?? '').trim();
    const roleMatchSource = String(source?.roleMatchSource ?? '').trim();
    const researchDomain = String(source?.researchDomain ?? '').trim();
    if (roleKey) out.roleKey = roleKey;
    if (careerLevel) out.careerLevel = careerLevel;
    if (managementTrack) out.managementTrack = managementTrack;
    if (labelKey) out.labelKey = labelKey;
    if (roleMatchSource) out.roleMatchSource = roleMatchSource;
    if (researchDomain) out.researchDomain = researchDomain;
    return out;
}

export const RESEARCH_DOMAIN_OPTIONS = [
    'Energy',
    'Market Intelligence',
    'Public Policy',
    'Data Research',
];
