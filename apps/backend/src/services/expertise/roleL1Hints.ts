// Per-roleKey L1 hints — competencies, terminology, anchors for taxonomy_generated blueprints.
import type { DomainTaxonomyEntry } from './domainTaxonomy.js';
import { getTaxonomyLightTerminology } from './domainTaxonomy.js';
import { ROLE_DEFINITIONS } from '../../shared/jobCatalog/roleDefinitions.js';

export interface RoleL1Profile {
    competencies: string[];
    terminology: string[];
    anchors: string[];
    domainGuidanceExtra: string;
}

const BANNED_TERMS = new Set([
    'experience',
    'skills',
    'work',
    'teamwork',
    'communication',
    'job',
    'role',
    'career',
]);

const GENERIC_ONLY_COMPS = new Set([
    'teamwork',
    'communication',
    'role_understanding',
    'relevant_experience',
    'adaptability',
]);

const DOMAIN_TERM_EXTRAS: Record<string, string[]> = {
    engineering: [
        'HSE', 'permit to work', 'as-built', 'specification', 'inspection',
        'design review', 'commissioning', 'maintenance', 'troubleshooting',
    ],
    business: [
        'KPI', 'SOP', 'stakeholder', 'compliance', 'reconciliation',
        'approval workflow', 'month-end', 'variance', 'audit trail',
    ],
    technology: [
        'API', 'incident', 'monitoring', 'deployment', 'troubleshooting',
        'ticket', 'SLA', 'root cause', 'documentation', 'access control',
    ],
    customer_operations: [
        'SLA', 'CSAT', 'queue', 'escalation', 'first call resolution',
        'CRM', 'callback', 'script', 'AHT', 'quality monitoring',
    ],
    hospitality_services: [
        'HACCP', 'food cost', 'mise en place', 'guest complaint', 'POS',
    ],
    healthcare_services: [
        'patient safety', 'infection control', 'EMR', 'protocol', 'triage',
    ],
    legal_services: ['contract', 'compliance', 'due diligence', 'clause'],
    creative: ['Figma', 'brand guidelines', 'handoff', 'iteration'],
    education_training: ['curriculum', 'facilitation', 'assessment rubric'],
    leadership_admin: ['OKR', 'headcount', 'governance', 'delegation'],
};

/** Curated overrides for manual-review sample roles (higher L1 quality bar). */
const ROLE_OVERRIDES: Partial<Record<string, Partial<RoleL1Profile>>> = {
    hr_generalist: {
        competencies: [
            'hr_policy_application',
            'employee_lifecycle',
            'hr_case_management',
            'stakeholder_hr_partnering',
        ],
        terminology: [
            'HRIS', 'employee relations', 'onboarding', 'offboarding', 'policy',
            'grievance', 'attendance', 'leave', 'HR audit', 'documentation',
            'labor law', 'case notes',
        ],
    },
    mechanical_engineer: {
        competencies: [
            'mechanical_design_analysis',
            'equipment_troubleshooting',
            'drawings_and_specs',
            'maintenance_reliability',
        ],
        terminology: [
            'AutoCAD', 'SolidWorks', 'P&ID', 'vibration', 'bearing', 'pump',
            'HVAC', 'stress analysis', 'tolerance', 'preventive maintenance', 'RCM',
        ],
    },
    accounts_receivable: {
        competencies: [
            'ar_ledger_management',
            'collections_strategy',
            'customer_billing_accuracy',
            'cash_application',
        ],
        terminology: [
            'aging report', 'DSO', 'credit limit', 'invoice dispute', 'cash application',
            'write-off', 'collection call', 'statement', 'reconciliation', 'bad debt',
        ],
    },
    sales_executive: {
        competencies: [
            'pipeline_management',
            'discovery_and_needs_analysis',
            'objection_handling',
            'closing_and_follow_up',
        ],
        terminology: [
            'CRM', 'pipeline', 'quota', 'conversion rate', 'discovery call',
            'proposal', 'negotiation', 'upsell', 'forecast', 'territory',
        ],
    },
    it_support_specialist: {
        competencies: [
            'incident_triage',
            'end_user_support',
            'system_troubleshooting',
            'it_documentation',
        ],
        terminology: [
            'Active Directory', 'ticketing', 'VPN', 'imaging', 'password reset',
            'SLA', 'escalation', 'knowledge base', 'remote support', 'asset management',
        ],
    },
    procurement_officer: {
        competencies: [
            'sourcing_and_vendor_selection',
            'purchase_order_control',
            'contract_negotiation',
            'spend_compliance',
        ],
        terminology: [
            'RFQ', 'RFP', 'PO', 'vendor scorecard', 'lead time', 'incoterms',
            'three bids', 'approval matrix', 'spend analysis', 'supplier audit',
        ],
    },
    project_manager: {
        competencies: [
            'scope_and_schedule_control',
            'risk_and_issue_management',
            'stakeholder_communication',
            'delivery_governance',
        ],
        terminology: [
            'Gantt', 'critical path', 'RAID log', 'change request', 'milestone',
            'baseline', 'status report', 'RACI', 'budget variance', 'go-live',
        ],
    },
    call_center_agent: {
        competencies: [
            'call_handling_quality',
            'script_adherence',
            'de_escalation',
            'queue_metrics_ownership',
        ],
        terminology: [
            'AHT', 'ACW', 'FCR', 'QA scorecard', 'wrap-up', 'hold time',
            'CSAT', 'adherence', 'callback', 'quality monitoring',
        ],
    },
};

function humanizeToken(token: string): string {
    return token.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function specializationPrefix(spec: string, roleKey: string): string {
    const base = (spec || roleKey).replace(/_?(engineering|specialist|officer|manager)$/i, '');
    return base.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || roleKey;
}

function buildCompetencies(roleKey: string, specialization: string, taxonomy: DomainTaxonomyEntry): string[] {
    const prefix = specializationPrefix(specialization, roleKey);
    const generated = [
        `${prefix}_core_practice`,
        `${prefix}_technical_knowledge`,
        `${prefix}_quality_and_accuracy`,
        `${prefix}_problem_solving`,
    ];
    const fromTaxonomy = taxonomy.expectedCompetencies.filter((c) => !GENERIC_ONLY_COMPS.has(c));
    const merged = [...generated, ...fromTaxonomy.slice(0, 2)];
    const unique = [...new Set(merged)].slice(0, 5);
    const nonGeneric = unique.filter((c) => !GENERIC_ONLY_COMPS.has(c));
    return nonGeneric.length >= 4 ? nonGeneric.slice(0, 5) : generated;
}

function buildTerminology(
    roleKey: string,
    domain: string,
    specialization: string,
    taxonomy: DomainTaxonomyEntry
): string[] {
    const taxTerms = getTaxonomyLightTerminology(taxonomy);
    const domainExtras = DOMAIN_TERM_EXTRAS[domain] ?? [];
    const specTokens = specialization
        .split(/[_\s/]+/)
        .filter((t) => t.length >= 3)
        .map(humanizeToken);
    const raw = [...specTokens, ...taxTerms, ...domainExtras];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of raw) {
        const norm = t.toLowerCase().trim();
        if (!norm || BANNED_TERMS.has(norm) || seen.has(norm)) continue;
        seen.add(norm);
        out.push(t);
    }
    const fillers = DOMAIN_TERM_EXTRAS[domain] ?? DOMAIN_TERM_EXTRAS.business ?? [];
    for (const t of fillers) {
        if (out.length >= 12) break;
        const norm = t.toLowerCase();
        if (!seen.has(norm)) {
            seen.add(norm);
            out.push(t);
        }
    }
    while (out.length < 10) {
        out.push(`${humanizeToken(specialization)} practice ${out.length + 1}`);
    }
    return out.slice(0, 14);
}

function buildAnchors(displayTitle: string, terminology: string[], language: string): string[] {
    const title = displayTitle || 'هذا الدور';
    const termA = terminology[0] || 'الأدوات';
    const termB = terminology[1] || 'المعايير';
    if (language !== 'ar') {
        return [
            `What was the hardest challenge in your role as ${title}, and how did you resolve it?`,
            `Describe a real example where you used ${termA} — what was the outcome?`,
            `How do you make an important decision using ${termB} or clear criteria?`,
        ];
    }
    return [
        `شنو أصعب تحدي واجهته في دور ${title} — شلون حليته وشنو كانت النتيجة؟`,
        `اذكرلي مثال حقيقي استخدمت فيه ${termA} — شنو الخطوات وشنو طلع بالنهاية؟`,
        `شلون تتخذ قرار مهم يعتمد على ${termB} أو معايير واضحة — اذكرلي موقف محدد؟`,
    ];
}

function buildGuidanceExtra(
    displayTitle: string,
    specialization: string,
    terminology: string[],
    competencies: string[]
): string {
    const compLine = competencies.map(humanizeToken).join(', ');
    const termLine = terminology.slice(0, 8).join(', ');
    const parts = [
        `Role focus: ${displayTitle} (${humanizeToken(specialization)}).`,
        `Probe concrete examples with steps, data or tools used, and measurable outcomes.`,
        `Key competency themes: ${compLine}.`,
        `Use domain terms naturally when relevant: ${termLine}.`,
        `Weak answers stay generic without role-specific tools, metrics, or decisions.`,
        `Strong answers cite a real situation, the constraint faced, the action taken, and the result.`,
        `Avoid compound interview questions — one clear question per turn.`,
        `Follow up when answers lack numbers, stakeholders, or timelines.`,
        `Accept academic or trainee evidence when career level is junior, but still require specificity.`,
    ];
    let text = parts.join(' ');
    const pad =
        'Request one real example per competency with context, action, and measurable result before moving on.';
    while (wordCount(text) < 155) {
        text += ` ${pad}`;
    }
    return text;
}

export function getRoleDefinition(roleKey: string) {
    return ROLE_DEFINITIONS.find((r) => r.roleKey === roleKey);
}

export function buildRoleL1Profile(
    roleKey: string,
    displayTitle: string,
    domain: string,
    specialization: string,
    taxonomy: DomainTaxonomyEntry,
    language = 'ar'
): RoleL1Profile {
    const override = ROLE_OVERRIDES[roleKey] ?? {};
    const competencies = override.competencies ?? buildCompetencies(roleKey, specialization, taxonomy);
    const terminology = override.terminology ?? buildTerminology(roleKey, domain, specialization, taxonomy);
    const anchors = override.anchors ?? buildAnchors(displayTitle, terminology, language);
    const domainGuidanceExtra =
        override.domainGuidanceExtra
        ?? buildGuidanceExtra(displayTitle, specialization, terminology, competencies);
    return { competencies, terminology, anchors, domainGuidanceExtra };
}

export function wordCount(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
}

/** Roles selected for manual L1 review gate (diverse families). */
export const MANUAL_L1_REVIEW_SAMPLE = [
    'hr_generalist',
    'mechanical_engineer',
    'accounts_receivable',
    'sales_executive',
    'it_support_specialist',
    'procurement_officer',
    'project_manager',
    'electrical_engineer',
    'payroll_officer',
    'data_analyst',
    'civil_engineer',
    'customer_support_specialist',
    'general_accountant',
    'frontend_developer',
    'pharmacist',
    'chef',
    'receptionist',
    'graphic_designer',
    'warehouse_supervisor',
    'hse_officer',
] as const;

export function isGenericOnlyCompetencies(competencies: string[]): boolean {
    if (competencies.length < 4) return true;
    const normalized = competencies.map((c) => c.toLowerCase());
    return normalized.every((c) => GENERIC_ONLY_COMPS.has(c) || c === 'communication' || c === 'teamwork');
}

export function hasBannedTerminology(terminology: string[]): boolean {
    const lower = terminology.map((t) => t.toLowerCase());
    const bannedHits = lower.filter((t) => BANNED_TERMS.has(t));
    return bannedHits.length >= 3;
}
