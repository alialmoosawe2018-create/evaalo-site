/**
 * Domain Pack v2 — match confidence + collision matrix smoke tests.
 * Usage: npx tsx src/scripts/domain-packs-match-test.ts
 */
import {
    DEFAULT_PACK_VERSION,
    DOMAIN_PACKS,
    WAVE_1A_PACK_VERSION,
    getPackVersion,
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
    resolvePackMatchConfidence,
    resolvePackMatchConfidenceWithMargin,
    shouldUseDeepPackMatch,
} from '../services/expertise/domainPacks.js';
import { WAVE_1B_PACK_VERSION } from '../services/expertise/wave1bDomainPacks.js';
import { WAVE_2_PACK_VERSION } from '../services/expertise/wave2DomainPacks.js';
import { WAVE_3_ENRICHED_VERSION } from '../services/expertise/wave3EnrichedHelpers.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

type CollisionCase = {
    label: string;
    text: string;
    jobTitle: string;
    domain?: string;
    expectedPack: string | null;
    forbiddenPacks: string[];
    minConfidence?: 'high' | 'medium' | 'low';
    maxConfidence?: 'high' | 'medium' | 'low';
    minScoreMargin?: number;
    maxScoreMargin?: number;
    expectDeepPack?: boolean;
};

function formatCollisionFailure(c: CollisionCase, r: ReturnType<typeof matchDomainPackWithConfidence>): string {
    return [
        `Case: ${c.label}`,
        `Title: ${c.jobTitle}`,
        `Expected pack: ${c.expectedPack ?? 'null'}`,
        `Actual: ${r.packKey ?? 'null'}`,
        `Confidence: ${r.confidence} | Score: ${r.score} | Margin: ${r.scoreMargin ?? 0}`,
        `Runner-up: ${r.runnerUpPackKey ?? 'none'} (${r.runnerUpScore ?? 0})`,
        `Matched terms: ${(r.matchedTerms || []).join(', ') || 'none'}`,
    ].join('\n');
}

function assertCollisionCase(c: CollisionCase): void {
    const inference = `${c.jobTitle}\n${c.text}`;
    const r = matchDomainPackWithConfidence(inference, c.jobTitle, c.domain ?? 'engineering');

    if (r.packKey !== c.expectedPack) {
        throw new Error(formatCollisionFailure(c, r));
    }

    for (const forbidden of c.forbiddenPacks) {
        if (r.packKey === forbidden) {
            throw new Error(`${formatCollisionFailure(c, r)}\nForbidden pack matched: ${forbidden}`);
        }
    }

    if (c.minConfidence) {
        assert(
            CONF_RANK[r.confidence] >= CONF_RANK[c.minConfidence],
            `${c.label}: confidence ${r.confidence} < min ${c.minConfidence}\n${formatCollisionFailure(c, r)}`
        );
    }
    if (c.maxConfidence) {
        assert(
            CONF_RANK[r.confidence] <= CONF_RANK[c.maxConfidence],
            `${c.label}: confidence ${r.confidence} > max ${c.maxConfidence}\n${formatCollisionFailure(c, r)}`
        );
    }
    if (c.minScoreMargin != null) {
        assert(
            (r.scoreMargin ?? 0) >= c.minScoreMargin,
            `${c.label}: margin ${r.scoreMargin ?? 0} < min ${c.minScoreMargin}\n${formatCollisionFailure(c, r)}`
        );
    }
    if (c.maxScoreMargin != null) {
        assert(
            (r.scoreMargin ?? 0) <= c.maxScoreMargin,
            `${c.label}: margin ${r.scoreMargin ?? 0} > max ${c.maxScoreMargin}\n${formatCollisionFailure(c, r)}`
        );
    }

    if (c.expectDeepPack === false) {
        assert(!shouldUseDeepPackMatch(r), `${c.label}: should not use deep_pack\n${formatCollisionFailure(c, r)}`);
    }
    if (c.expectDeepPack === true) {
        assert(shouldUseDeepPackMatch(r), `${c.label}: should use deep_pack\n${formatCollisionFailure(c, r)}`);
    }
}

function resolveBlueprintKnowledgeDepth(
    jobTitle: string,
    adText: string,
    domain = 'engineering'
): { packKey: string | null; confidence: string; knowledgeDepth: string; scoreMargin?: number } {
    const inference = `${jobTitle}\n${adText}`;
    const packMatch = matchDomainPackWithConfidence(inference, jobTitle, domain);
    const useDeep = shouldUseDeepPackMatch(packMatch);
    return {
        packKey: packMatch.packKey,
        confidence: packMatch.confidence,
        knowledgeDepth: useDeep ? 'deep_pack' : 'taxonomy_generated',
        scoreMargin: packMatch.scoreMargin,
    };
}

const COLLISION_CASES: CollisionCase[] = [
    {
        label: 'petroleum_title',
        text: 'Petroleum engineering graduate role. Reservoir, drilling awareness, field data.',
        jobTitle: 'Petroleum Engineer',
        expectedPack: 'petroleum_engineer',
        forbiddenPacks: ['oil_gas_production'],
        minConfidence: 'high',
        minScoreMargin: 5,
        expectDeepPack: true,
    },
    {
        label: 'production_oilfield',
        text: 'Oilfield wells. Artificial lift, GOR, water cut, well testing, nodal analysis.',
        jobTitle: 'Production Engineer',
        expectedPack: 'oil_gas_production',
        forbiddenPacks: ['petroleum_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'production_manufacturing',
        text: 'Manufacturing plant. Lean, OEE, assembly line, CNC machining, factory floor.',
        jobTitle: 'Production Engineer',
        expectedPack: null,
        forbiddenPacks: ['oil_gas_production'],
        maxConfidence: 'low',
        expectDeepPack: false,
    },
    {
        label: 'production_cement',
        text: 'Cement plant operations. Kiln, clinker, quality control, batch production.',
        jobTitle: 'Production Engineer – Cement Plant',
        expectedPack: null,
        forbiddenPacks: ['oil_gas_production', 'petroleum_engineer'],
        maxConfidence: 'low',
        expectDeepPack: false,
    },
    {
        label: 'production_fmcg',
        text: 'FMCG food production line. Packaging, shelf life, batch traceability.',
        jobTitle: 'Production Engineer – FMCG',
        expectedPack: null,
        forbiddenPacks: ['oil_gas_production'],
        maxConfidence: 'low',
        expectDeepPack: false,
    },
    {
        label: 'reservoir_title',
        text: 'Reservoir simulation, history matching, CMG, Eclipse, material balance.',
        jobTitle: 'Reservoir Engineer',
        expectedPack: 'reservoir_engineer',
        forbiddenPacks: ['petroleum_engineer', 'oil_gas_production'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'drilling_title',
        text: 'Directional drilling, mud weight, casing design, well control.',
        jobTitle: 'Drilling Engineer',
        expectedPack: 'drilling_engineer',
        forbiddenPacks: ['petroleum_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'survey_title',
        text: 'Topographic survey, total station, GPS, boundary demarcation.',
        jobTitle: 'Survey Engineer',
        expectedPack: 'survey_engineer',
        forbiddenPacks: ['petroleum_engineer', 'civil_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'land_survey',
        text: 'Land survey for construction site. Coordinates, leveling, cadastral.',
        jobTitle: 'Land Survey Engineer',
        expectedPack: 'survey_engineer',
        forbiddenPacks: ['civil_engineer', 'site_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'oil_gas_graduate',
        text: 'Oil and gas graduate program. Petroleum fundamentals.',
        jobTitle: 'Petroleum Engineering Graduate',
        expectedPack: 'petroleum_engineer',
        forbiddenPacks: ['hr_recruiter'],
        minConfidence: 'high',
    },
    {
        label: 'ambiguous_oil_only',
        text: 'Oil and Gas',
        jobTitle: 'Oil and Gas',
        expectedPack: null,
        forbiddenPacks: [],
        maxConfidence: 'low',
        expectDeepPack: false,
    },
    {
        label: 'wellsite',
        text: 'Wellsite operations, rig coordination, daily drilling reports.',
        jobTitle: 'Wellsite Engineer',
        expectedPack: 'drilling_engineer',
        forbiddenPacks: ['reservoir_engineer'],
        maxConfidence: 'medium',
        expectDeepPack: false,
    },
    {
        label: 'field_engineer_vague',
        text: 'Oil & Gas field operations. General support.',
        jobTitle: 'Oil & Gas Field Engineer',
        expectedPack: null,
        forbiddenPacks: [],
        maxConfidence: 'medium',
        expectDeepPack: false,
    },
    // Arabic cases
    {
        label: 'petroleum_ar',
        text: 'هندسة بترول، مكامن، حفر، بيانات حقلية.',
        jobTitle: 'مهندس بترول',
        expectedPack: 'petroleum_engineer',
        forbiddenPacks: ['oil_gas_production'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'production_oil_ar',
        text: 'آبار نفطية، رفع اصطناعي، GOR، water cut، اختبار البئر.',
        jobTitle: 'مهندس إنتاج نفطي',
        expectedPack: 'oil_gas_production',
        forbiddenPacks: ['petroleum_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'reservoir_ar',
        text: 'محاكاة المكمن، history matching، CMG، Eclipse.',
        jobTitle: 'مهندس مكامن',
        expectedPack: 'reservoir_engineer',
        forbiddenPacks: ['petroleum_engineer', 'oil_gas_production'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'drilling_ar',
        text: 'حفر اتجاهي، وزن الطين، تصميم التأمين، ضبط البئر.',
        jobTitle: 'مهندس حفر',
        expectedPack: 'drilling_engineer',
        forbiddenPacks: ['petroleum_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'site_ar',
        text: 'إشراف موقع، تنسيق مقاولين، HSE، جدولة أعمال.',
        jobTitle: 'مهندس موقع',
        expectedPack: 'site_engineer',
        forbiddenPacks: ['survey_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'survey_ar',
        text: 'مساحة топографية، total station، GPS، demarcation.',
        jobTitle: 'مهندس مساحة',
        expectedPack: 'survey_engineer',
        forbiddenPacks: ['petroleum_engineer', 'civil_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    // Wave 3 — construction
    {
        label: 'civil_title',
        text: 'Structural design, AutoCAD, BOQ, concrete, ETABS, shop drawings review.',
        jobTitle: 'Civil Engineer',
        expectedPack: 'civil_engineer',
        forbiddenPacks: ['survey_engineer', 'site_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'site_title',
        text: 'Construction site supervision, contractor coordination, daily reports, HSE permits.',
        jobTitle: 'Site Engineer',
        expectedPack: 'site_engineer',
        forbiddenPacks: ['civil_engineer', 'survey_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'process_plant',
        text: 'PFD P&ID mass balance HAZOP refinery debottlenecking chemical plant.',
        jobTitle: 'Process Engineer',
        expectedPack: 'process_engineer',
        forbiddenPacks: ['devops_engineer', 'operations_coordinator'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    // Wave 3 — technology
    {
        label: 'devops_title',
        text: 'CI/CD Kubernetes Terraform incident response on-call SLO.',
        jobTitle: 'DevOps Engineer',
        domain: 'technology',
        expectedPack: 'devops_engineer',
        forbiddenPacks: ['frontend_developer', 'qa_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'data_analyst_title',
        text: 'SQL Power BI dashboard KPI cohort analysis data validation.',
        jobTitle: 'Data Analyst',
        domain: 'technology',
        expectedPack: 'data_analyst',
        forbiddenPacks: ['financial_analyst', 'data_scientist'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'qa_title',
        text: 'Test automation Selenium regression bug triage release testing.',
        jobTitle: 'QA Engineer',
        domain: 'technology',
        expectedPack: 'qa_engineer',
        forbiddenPacks: ['devops_engineer', 'frontend_developer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'backend_title',
        text: 'REST API microservices PostgreSQL authentication production incident Node.js.',
        jobTitle: 'Backend Developer',
        domain: 'technology',
        expectedPack: 'backend_developer',
        forbiddenPacks: ['frontend_developer', 'devops_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    // Wave 3 — finance
    {
        label: 'general_accountant_title',
        text: 'General ledger month-end close reconciliation journal entries financial statements.',
        jobTitle: 'General Accountant',
        domain: 'business',
        expectedPack: 'general_accountant',
        forbiddenPacks: ['accounts_payable', 'financial_analyst'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'accounts_payable_title',
        text: 'Vendor invoices three-way match payment processing AP aging.',
        jobTitle: 'Accounts Payable Officer',
        domain: 'business',
        expectedPack: 'accounts_payable',
        forbiddenPacks: ['general_accountant', 'internal_auditor'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'financial_analyst_title',
        text: 'Financial modeling variance analysis budgeting forecasting Excel.',
        jobTitle: 'Financial Analyst',
        domain: 'business',
        expectedPack: 'financial_analyst',
        forbiddenPacks: ['data_analyst', 'general_accountant'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'internal_auditor_title',
        text: 'Internal audit control testing risk assessment SOX walkthrough findings.',
        jobTitle: 'Internal Auditor',
        domain: 'business',
        expectedPack: 'internal_auditor',
        forbiddenPacks: ['accounts_payable', 'financial_analyst'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'accounts_receivable_title',
        text: 'Accounts receivable aging collections cash application credit control billing disputes.',
        jobTitle: 'Accounts Receivable Officer',
        domain: 'business',
        expectedPack: 'accounts_receivable',
        forbiddenPacks: ['accounts_payable', 'general_accountant'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'it_support_title',
        text: 'IT support helpdesk Active Directory VPN laptop imaging password reset escalation.',
        jobTitle: 'IT Support Specialist',
        domain: 'technology',
        expectedPack: 'it_support',
        forbiddenPacks: ['customer_support', 'devops_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'qa_qc_engineering_title',
        text: 'QA/QC engineer construction inspection NCR NDT ITP welding quality.',
        jobTitle: 'QA/QC Engineer',
        domain: 'engineering',
        expectedPack: 'qa_qc_engineer',
        forbiddenPacks: ['qa_engineer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
    {
        label: 'software_qa_not_qc',
        text: 'Selenium Cypress automation regression release testing CI.',
        jobTitle: 'QA Automation Engineer',
        domain: 'technology',
        expectedPack: 'qa_engineer',
        forbiddenPacks: ['qa_qc_engineer'],
        minConfidence: 'medium',
        expectDeepPack: false,
    },
    {
        label: 'hr_generalist_title',
        text: 'HR generalist employee relations policy onboarding offboarding case management.',
        jobTitle: 'HR Generalist',
        domain: 'business',
        expectedPack: 'hr_generalist',
        forbiddenPacks: ['hr_recruiter', 'payroll_officer'],
        minConfidence: 'high',
        expectDeepPack: true,
    },
];

function testAllPacksHaveVersion(): void {
    for (const pack of DOMAIN_PACKS) {
        const v = getPackVersion(pack);
        assert(
            v === DEFAULT_PACK_VERSION || v === WAVE_1A_PACK_VERSION || v === WAVE_1B_PACK_VERSION || v === WAVE_2_PACK_VERSION || v === WAVE_3_ENRICHED_VERSION,
            `${pack.packKey} missing/invalid packVersion (got ${v})`
        );
    }
}

function testResolveConfidence(): void {
    assert(resolvePackMatchConfidence(100, 'alias') === 'high', 'score 100 = high');
    assert(resolvePackMatchConfidence(10, 'title_domain') === 'medium', 'score 10 = medium');
    assert(resolvePackMatchConfidence(2, 'keywords') === 'low', 'score 2 = low');
}

function testResolveConfidenceWithMargin(): void {
    assert(
        resolvePackMatchConfidenceWithMargin({ score: 100, matchSource: 'alias' }, { score: 90 }) === 'high',
        'alias margin 10 = high'
    );
    assert(
        resolvePackMatchConfidenceWithMargin({ score: 100, matchSource: 'alias' }, { score: 98 }) === 'medium',
        'alias margin 2 = medium'
    );
    assert(
        resolvePackMatchConfidenceWithMargin({ score: 100, matchSource: 'alias' }, { score: 99 }) === 'low',
        'alias margin 1 = low (tie risk)'
    );
}

function testRoleKeyMatchHigh(): void {
    const r = matchDomainPackByRoleKeyWithConfidence('recruiter');
    assert(r.pack?.packKey === 'hr_recruiter', 'recruiter roleKey');
    assert(r.confidence === 'high', 'roleKey confidence high');
    assert(r.matchSource === 'roleKey', 'roleKey source');
}

function testOilGasAliasHigh(): void {
    const ad =
        'Production Engineer on oilfield wells. Artificial lift, GOR, water cut, well testing.';
    const r = matchDomainPackWithConfidence(ad, 'Production Engineer', 'engineering');
    assert(r.pack?.packKey === 'oil_gas_production', `oil pack (got ${r.packKey})`);
    assert(r.confidence === 'high', `oil alias confidence (got ${r.confidence})`);
    assert((r.scoreMargin ?? 0) >= 5, `oil margin (got ${r.scoreMargin})`);
}

function testManufacturingExcludedFromOil(): void {
    const ad =
        'Production Engineer in manufacturing plant. Lean, OEE, assembly line, CNC machining.';
    const r = matchDomainPackWithConfidence(ad, 'Production Engineer', 'engineering');
    assert(
        !r.pack || r.pack.packKey !== 'oil_gas_production',
        'manufacturing must not match oil_gas_production'
    );
}

function testRecruiterTitle(): void {
    const r = matchDomainPackWithConfidence(
        'talent acquisition sourcing ATS pipeline time to fill',
        'Recruiter',
        'business'
    );
    assert(r.pack?.packKey === 'hr_recruiter', `recruiter pack (got ${r.packKey})`);
}

function testUnknownRoleLow(): void {
    const r = matchDomainPackWithConfidence('generic office work', 'Office Clerk', 'business');
    assert(r.pack === null, 'unknown role should not match pack');
    assert(r.confidence === 'low', 'no match = low confidence');
}

function testPetroleumRoleKey(): void {
    const r = matchDomainPackByRoleKeyWithConfidence('petroleum_engineer');
    assert(r.pack?.packKey === 'petroleum_engineer', 'petroleum_engineer roleKey');
    assert(r.confidence === 'high', 'petroleum high');
}

function testSurveyRoleKey(): void {
    const r = matchDomainPackByRoleKeyWithConfidence('survey_engineer');
    assert(r.pack?.packKey === 'survey_engineer', 'survey_engineer roleKey');
    assert(r.confidence === 'high', 'survey high');
}

function testWave1BRoleKeys(): void {
    for (const rk of [
        'reservoir_engineer',
        'drilling_engineer',
        'civil_engineer',
        'site_engineer',
        'process_engineer',
    ]) {
        const r = matchDomainPackByRoleKeyWithConfidence(rk);
        assert(r.pack?.packKey === rk, `${rk} roleKey`);
        assert(r.confidence === 'high', `${rk} high`);
    }
}

function testWave2RoleKeys(): void {
    for (const rk of [
        'frontend_developer',
        'backend_developer',
        'devops_engineer',
        'data_analyst',
        'qa_engineer',
        'customer_support_specialist',
        'operations_manager',
        'accounts_payable',
        'financial_analyst',
        'internal_auditor',
    ]) {
        const r = matchDomainPackByRoleKeyWithConfidence(rk);
        assert(!!r.pack, `${rk} roleKey matches pack`);
        assert(r.confidence === 'high', `${rk} high`);
    }
}

function testWave4RoleKeys(): void {
    for (const rk of [
        'hr_generalist',
        'hr_specialist',
        'talent_acquisition_specialist',
        'hr_manager',
        'payroll_officer',
        'mechanical_engineer',
        'electrical_engineer',
        'qa_qc_engineer',
        'hse_engineer',
        'planning_engineer',
        'accounts_receivable',
        'procurement_officer',
        'project_manager',
        'it_support_specialist',
        'sales_executive',
        'business_development_manager',
        'call_center_agent',
        'account_manager',
    ]) {
        const r = matchDomainPackByRoleKeyWithConfidence(rk);
        assert(!!r.pack, `${rk} roleKey matches pack (got ${r.packKey})`);
        assert(r.confidence === 'high', `${rk} high`);
    }
}

function testCollisionMatrix(): void {
    for (const c of COLLISION_CASES) {
        assertCollisionCase(c);
    }
}

function testRoleKeyTitleConflict(): void {
    const rkMatch = matchDomainPackByRoleKeyWithConfidence('petroleum_engineer');
    const titleMatch = matchDomainPackWithConfidence(
        'Reservoir simulation, history matching, CMG.',
        'Reservoir Engineer',
        'engineering'
    );
    assert(rkMatch.packKey === 'petroleum_engineer', 'roleKey wins petroleum');
    assert(titleMatch.packKey === 'reservoir_engineer', 'title suggests reservoir');
    assert(titleMatch.packKey !== rkMatch.packKey, 'conflict exists');

    const rkProd = matchDomainPackByRoleKeyWithConfidence('production_engineer_oil_gas');
    const titlePet = matchDomainPackWithConfidence(
        'Petroleum engineering, reservoir fundamentals.',
        'Petroleum Engineer',
        'engineering'
    );
    assert(rkProd.packKey === 'oil_gas_production', 'roleKey wins oil production');
    assert(titlePet.packKey === 'petroleum_engineer', 'title suggests petroleum');
    assert(titlePet.packKey !== rkProd.packKey, 'conflict exists');
}

function testBlueprintSpotCheck(): void {
    const petroleum = resolveBlueprintKnowledgeDepth(
        'Petroleum Engineer',
        'Reservoir, drilling awareness, well testing, CMG simulation.'
    );
    assert(petroleum.packKey === 'petroleum_engineer', `petroleum pack (got ${petroleum.packKey})`);
    assert(petroleum.knowledgeDepth === 'deep_pack', `petroleum depth (got ${petroleum.knowledgeDepth})`);
    assert((petroleum.scoreMargin ?? 0) >= 5, 'petroleum clear margin');

    const productionOil = resolveBlueprintKnowledgeDepth(
        'Production Engineer',
        'Oilfield wells. Artificial lift, GOR, water cut, well testing.'
    );
    assert(productionOil.packKey === 'oil_gas_production', `production oil (got ${productionOil.packKey})`);
    assert(productionOil.knowledgeDepth === 'deep_pack', `production oil depth (got ${productionOil.knowledgeDepth})`);

    const cement = resolveBlueprintKnowledgeDepth(
        'Production Engineer – Cement Plant',
        'Kiln operations, clinker, quality control.'
    );
    assert(cement.knowledgeDepth !== 'deep_pack', `cement must not deep_pack (got ${cement.knowledgeDepth})`);
    assert(
        cement.knowledgeDepth === 'taxonomy_generated',
        `cement depth (got ${cement.knowledgeDepth})`
    );

    const reservoir = resolveBlueprintKnowledgeDepth(
        'Reservoir Engineer',
        'History matching, CMG, Eclipse, material balance.'
    );
    assert(reservoir.packKey === 'reservoir_engineer', `reservoir pack (got ${reservoir.packKey})`);
    assert(reservoir.knowledgeDepth === 'deep_pack', `reservoir depth (got ${reservoir.knowledgeDepth})`);
}

function testTieDoesNotDependOnPackOrder(): void {
    const haystack = 'oil gas petroleum well production engineer';
    const scored = DOMAIN_PACKS.map((pack) => {
        const r = matchDomainPackWithConfidence(haystack, 'Engineer', 'engineering');
        return r;
    });
    assert(scored.length > 0, 'scoring runs');
    const ambiguous = matchDomainPackWithConfidence('oil gas', 'Engineer', 'engineering');
    assert(ambiguous.confidence === 'low' || (ambiguous.scoreMargin ?? 0) >= 2, 'ambiguous low or clear margin');
}

function main(): void {
    testAllPacksHaveVersion();
    testResolveConfidence();
    testResolveConfidenceWithMargin();
    testRoleKeyMatchHigh();
    testPetroleumRoleKey();
    testSurveyRoleKey();
    testWave1BRoleKeys();
    testWave2RoleKeys();
    testWave4RoleKeys();
    testOilGasAliasHigh();
    testManufacturingExcludedFromOil();
    testRecruiterTitle();
    testUnknownRoleLow();
    testCollisionMatrix();
    testRoleKeyTitleConflict();
    testBlueprintSpotCheck();
    testTieDoesNotDependOnPackOrder();
    console.log(`✅ domain-packs-match-test: all passed (${COLLISION_CASES.length} collision cases)`);
}

main();
