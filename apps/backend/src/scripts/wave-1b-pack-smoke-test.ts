/**
 * Wave 1B L3 pack smoke test — engineering family expansion.
 * Usage: npx tsx src/scripts/wave-1b-pack-smoke-test.ts
 */
import {
    DEFAULT_PACK_VERSION,
    DOMAIN_PACKS,
    WAVE_1A_PACK_VERSION,
    getPackVersion,
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
} from '../services/expertise/domainPacks.js';
import { WAVE_1B_PACK_VERSION } from '../services/expertise/wave1bDomainPacks.js';
import { WAVE_2_PACK_VERSION, WAVE_3_WAVE2_ENRICHED_KEYS } from '../services/expertise/wave2DomainPacks.js';
import { WAVE_3_ENRICHED_VERSION } from '../services/expertise/wave3EnrichedHelpers.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';

const WAVE_1B_KEYS = [
    'reservoir_engineer',
    'drilling_engineer',
    'civil_engineer',
    'site_engineer',
    'process_engineer',
] as const;

const ROLE_KEY_TO_PACK: Record<(typeof WAVE_1B_KEYS)[number], string> = {
    reservoir_engineer: 'reservoir_engineer',
    drilling_engineer: 'drilling_engineer',
    civil_engineer: 'civil_engineer',
    site_engineer: 'site_engineer',
    process_engineer: 'process_engineer',
};

const TITLE_CASES: Array<[string, string]> = [
    ['Reservoir Engineer', 'reservoir_engineer'],
    ['Drilling Engineer', 'drilling_engineer'],
    ['Civil Engineer', 'civil_engineer'],
    ['Site Engineer', 'site_engineer'],
    ['Process Engineer', 'process_engineer'],
];

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function testPackVersions(): void {
    for (const pack of DOMAIN_PACKS) {
        const v = getPackVersion(pack);
        assert(
            v === DEFAULT_PACK_VERSION || v === WAVE_1A_PACK_VERSION || v === WAVE_1B_PACK_VERSION || v === WAVE_2_PACK_VERSION || v === WAVE_3_ENRICHED_VERSION,
            `${pack.packKey} unexpected version ${v}`
        );
    }
}

function testWave1BL3Structure(): void {
    for (const key of WAVE_1B_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key} exists`);
        assert(pack!.packVersion === WAVE_1B_PACK_VERSION, `${key} version`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);
        assert(pack!.competencies.length >= 4, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
        for (const anchor of pack!.suggestedAnchorQuestions) {
            assert((anchor.match(/[؟?]/g) || []).length <= 1, `${key} anchor: ${anchor}`);
        }
    }
}

function testRoleKeyMatches(): void {
    for (const [roleKey, packKey] of Object.entries(ROLE_KEY_TO_PACK)) {
        const r = matchDomainPackByRoleKeyWithConfidence(roleKey);
        assert(r.pack?.packKey === packKey, `roleKey ${roleKey}`);
        assert(r.confidence === 'high', `${roleKey} high`);
    }
}

function testTitleMatches(): void {
    for (const [title, packKey] of TITLE_CASES) {
        const r = matchDomainPackWithConfidence(title, title, 'engineering');
        assert(r.pack?.packKey === packKey, `${title} -> ${packKey} (got ${r.packKey})`);
    }
}

function testCrossPackExclusions(): void {
    const drilling = matchDomainPackWithConfidence(
        'Drilling Engineer well control mud weight BHA ROP',
        'Drilling Engineer',
        'engineering'
    );
    assert(drilling.pack?.packKey === 'drilling_engineer', `drilling not petroleum (got ${drilling.packKey})`);

    const reservoir = matchDomainPackWithConfidence(
        'Reservoir Engineer history matching simulation CMG Eclipse',
        'Reservoir Engineer',
        'engineering'
    );
    assert(reservoir.pack?.packKey === 'reservoir_engineer', `reservoir (got ${reservoir.packKey})`);
}

async function testBlueprintCarriesTracks(): Promise<void> {
    for (const [position, packKey] of TITLE_CASES) {
        const gen = await generateExpertiseAndBlueprint({ criteria: { position } });
        assert(gen.knowledgeDepth === 'deep_pack', `${position} deep_pack`);
        assert(gen.domainPackKey === packKey, `${position} pack`);
        assert((gen.experienceTracks?.length ?? 0) >= 4, `${position} tracks`);
        assert(gen.packVersion === WAVE_1B_PACK_VERSION, `${position} version`);
    }
}

async function main(): Promise<void> {
    testPackVersions();
    testWave1BL3Structure();
    testRoleKeyMatches();
    testTitleMatches();
    testCrossPackExclusions();
    await testBlueprintCarriesTracks();
    console.log('✅ wave-1b-pack-smoke-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
