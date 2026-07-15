/** Pure types — shared by frontend and backend. No knowledgeDepth here. */

export type CareerLevel =
    | 'intern'
    | 'junior'
    | 'graduate'
    | 'mid'
    | 'senior'
    | 'lead'
    | 'supervisor'
    | 'manager'
    | 'head'
    | 'director'
    | 'executive';

export type ManagementTrack = 'ic' | 'supervisor' | 'manager' | 'director' | 'executive';

export type CatalogSection =
    | 'hr'
    | 'sales'
    | 'marketing'
    | 'finance'
    | 'admin'
    | 'procurement'
    | 'technology'
    | 'product_design'
    | 'project'
    | 'engineering'
    | 'oil_gas'
    | 'hse_security'
    | 'legal'
    | 'hospitality'
    | 'healthcare';

export interface JobCatalogEntry {
    roleKey: string;
    domain: string;
    specialization: string;
    careerLevel: CareerLevel;
    managementTrack: ManagementTrack;
    labelKey: string;
    displayTitle: string;
    section: CatalogSection;
    requiresDomainQualifier?: boolean;
}

export type MatchSource =
    | 'exact_catalog'
    | 'legacy_alias'
    | 'fuzzy'
    | 'ambiguous_legacy'
    | 'unknown';

export interface RoleResolution {
    roleKey: string | null;
    careerLevel: CareerLevel | string;
    managementTrack: ManagementTrack | string;
    displayTitle: string;
    labelKey?: string;
    domain?: string;
    specialization?: string;
    confidence: number;
    matchSource: MatchSource;
}

export interface LegacyAliasTarget {
    roleKey: string;
    careerLevel: CareerLevel;
    managementTrack: ManagementTrack;
    labelKey: string;
    displayTitle: string;
}

export interface RoleLevelDef {
    careerLevel: CareerLevel;
    displayTitle: string;
    managementTrack?: ManagementTrack;
}

export interface RoleDefinition {
    roleKey: string;
    domain: string;
    specialization: string;
    section: CatalogSection;
    defaultManagementTrack: ManagementTrack;
    levels: RoleLevelDef[];
    /** Neutral title for role-only Position picker (no level prefix). */
    positionTitle?: string;
    requiresDomainQualifier?: boolean;
}

export interface CareerLevelOverlay {
    questionDifficulty: 'foundational' | 'intermediate' | 'advanced' | 'strategic';
    leadershipExpectations: string;
    expectedEvidenceBias: string;
    rubricEmphasis: string;
}
