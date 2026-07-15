/**
 * Wave 2 L3 pack smoke test — technology, ops, finance expansion.
 * Usage: npx tsx src/scripts/wave-2-pack-smoke-test.ts
 */
import {
    DEFAULT_PACK_VERSION,
    DOMAIN_PACKS,
    WAVE_1A_PACK_VERSION,
    WAVE_1B_PACK_VERSION,
    getPackVersion,
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
} from '../services/expertise/domainPacks.js';
import { WAVE_2_PACK_VERSION, WAVE_3_WAVE2_ENRICHED_KEYS } from '../services/expertise/wave2DomainPacks.js';
import { WAVE_3_ENRICHED_VERSION } from '../services/expertise/wave3EnrichedHelpers.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';

const WAVE_2_KEYS = [
    'frontend_developer',
    'devops_engineer',
    'data_analyst',
    'qa_engineer',
    'customer_support',
    'operations_coordinator',
    'accounts_payable',
    'financial_analyst',
    'internal_auditor',
] as const;

const ROLE_KEY_TO_PACK: Record<string, string> = {
    frontend_developer: 'frontend_developer',
    devops_engineer: 'devops_engineer',
    data_analyst: 'data_analyst',
    qa_engineer: 'qa_engineer',
    customer_support_specialist: 'customer_support',
    operations_manager: 'operations_coordinator',
    accounts_payable: 'accounts_payable',
    financial_analyst: 'financial_analyst',
    internal_auditor: 'internal_auditor',
};

const TITLE_CASES: Array<[string, string, string?]> = [
    ['Frontend Developer', 'frontend_developer', 'technology'],
    ['DevOps Engineer', 'devops_engineer', 'technology'],
    ['Data Analyst', 'data_analyst', 'technology'],
    ['QA Engineer', 'qa_engineer', 'technology'],
    ['Customer Support Specialist', 'customer_support', 'business'],
    ['Operations Coordinator', 'operations_coordinator', 'business'],
    ['Accounts Payable Officer', 'accounts_payable', 'business'],
    ['Financial Analyst', 'financial_analyst', 'business'],
    ['Internal Auditor', 'internal_auditor', 'business'],
];

function expectedPackVersion(packKey: string): string {
    return WAVE_3_WAVE2_ENRICHED_KEYS.has(packKey) ? WAVE_3_ENRICHED_VERSION : WAVE_2_PACK_VERSION;
}

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function testPackVersions(): void {
    for (const pack of DOMAIN_PACKS) {
        const v = getPackVersion(pack);
        assert(
            v === DEFAULT_PACK_VERSION ||
                v === WAVE_1A_PACK_VERSION ||
                v === WAVE_1B_PACK_VERSION ||
                v === WAVE_2_PACK_VERSION ||
                v === WAVE_3_ENRICHED_VERSION,
            `${pack.packKey} unexpected version ${v}`
        );
    }
}

function testWave2L3Structure(): void {
    for (const key of WAVE_2_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key} exists`);
        assert(pack!.packVersion === expectedPackVersion(key), `${key} version (got ${pack!.packVersion})`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);
        assert(pack!.competencies.length >= 4, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
        for (const anchor of pack!.suggestedAnchorQuestions) {
            assert((anchor.match(/[؟?]/g) || []).length <= 1, `${key} anchor: ${anchor}`);
        }
        if (WAVE_3_WAVE2_ENRICHED_KEYS.has(key)) {
            for (const path of pack!.interviewPaths ?? []) {
                assert(!!path.preferredTracks?.length, `${key} path ${path.pathKey} preferredTracks`);
                assert(path.steps.length >= 5, `${key} path ${path.pathKey} steps >= 5`);
            }
        }
    }
}

function testRoleKeyMatches(): void {
    for (const [roleKey, packKey] of Object.entries(ROLE_KEY_TO_PACK)) {
        const r = matchDomainPackByRoleKeyWithConfidence(roleKey);
        assert(r.pack?.packKey === packKey, `roleKey ${roleKey} -> ${packKey} (got ${r.packKey})`);
        assert(r.confidence === 'high', `${roleKey} high`);
    }
}

function testTitleMatches(): void {
    for (const [title, packKey, domain] of TITLE_CASES) {
        const r = matchDomainPackWithConfidence(title, title, domain);
        assert(r.pack?.packKey === packKey, `${title} -> ${packKey} (got ${r.packKey})`);
    }
}

function testCrossPackExclusions(): void {
    const devops = matchDomainPackWithConfidence(
        'DevOps Engineer CI/CD Kubernetes Terraform incident response',
        'DevOps Engineer',
        'technology'
    );
    assert(devops.pack?.packKey === 'devops_engineer', `devops not frontend (got ${devops.packKey})`);

    const ops = matchDomainPackWithConfidence(
        'Operations Coordinator vendor scheduling SOP workflow KPI',
        'Operations Coordinator',
        'business'
    );
    assert(
        ops.pack?.packKey === 'operations_coordinator',
        `ops coord not devops (got ${ops.packKey})`
    );
}

async function testBlueprintCarriesTracks(): Promise<void> {
    for (const [position, packKey] of TITLE_CASES.map(([t, p]) => [t, p] as const)) {
        const gen = await generateExpertiseAndBlueprint({ criteria: { position } });
        assert(gen.knowledgeDepth === 'deep_pack', `${position} deep_pack`);
        assert(gen.domainPackKey === packKey, `${position} pack`);
        assert((gen.experienceTracks?.length ?? 0) >= 4, `${position} tracks`);
        assert(gen.packVersion === expectedPackVersion(packKey), `${position} version (got ${gen.packVersion})`);
    }
}

async function main(): Promise<void> {
    testPackVersions();
    testWave2L3Structure();
    testRoleKeyMatches();
    testTitleMatches();
    testCrossPackExclusions();
    await testBlueprintCarriesTracks();
    console.log('✅ wave-2-pack-smoke-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
