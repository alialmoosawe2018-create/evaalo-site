/**
 * Wave 1A L3 pack smoke test — tracks, paths, roleKey match.
 * Wave 1A pilots (hr, petroleum, survey) are now L3 Enriched v1.4.0 — see wave-3-pack-smoke-test.
 * Usage: npx tsx src/scripts/wave-1a-pack-smoke-test.ts
 */
import {
    DEFAULT_PACK_VERSION,
    DOMAIN_PACKS,
    WAVE_1A_PACK_VERSION,
    WAVE_3_ENRICHED_VERSION,
    getPackVersion,
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
} from '../services/expertise/domainPacks.js';
import { WAVE_1B_PACK_VERSION } from '../services/expertise/wave1bDomainPacks.js';
import { WAVE_2_PACK_VERSION } from '../services/expertise/wave2DomainPacks.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';

const WAVE_1A_ROLE_KEYS = ['recruiter', 'petroleum_engineer', 'survey_engineer'] as const;

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

function testWave1ARoleKeyMatches(): void {
    const cases: Array<[string, string]> = [
        ['recruiter', 'hr_recruiter'],
        ['petroleum_engineer', 'petroleum_engineer'],
        ['survey_engineer', 'survey_engineer'],
    ];
    for (const [roleKey, packKey] of cases) {
        const r = matchDomainPackByRoleKeyWithConfidence(roleKey);
        assert(r.pack?.packKey === packKey, `roleKey ${roleKey} -> ${packKey}`);
        assert(r.confidence === 'high', `${roleKey} high confidence`);
    }
}

function testTitleMatchPetroleumSurvey(): void {
    const petro = matchDomainPackWithConfidence(
        'Petroleum Engineer reservoir well testing water cut',
        'Petroleum Engineer',
        'engineering'
    );
    assert(petro.pack?.packKey === 'petroleum_engineer', `petroleum title (got ${petro.packKey})`);

    const survey = matchDomainPackWithConfidence(
        'Survey Engineer GNSS GPS Total Station RTK coordinates',
        'Survey Engineer',
        'engineering'
    );
    assert(survey.pack?.packKey === 'survey_engineer', `survey title (got ${survey.packKey})`);
}

async function testBlueprintCarriesTracks(): Promise<void> {
    for (const [position, packKey] of [
        ['Petroleum Engineer', 'petroleum_engineer'],
        ['Survey Engineer', 'survey_engineer'],
        ['Recruiter', 'hr_recruiter'],
    ] as const) {
        const gen = await generateExpertiseAndBlueprint({ criteria: { position } });
        assert(gen.knowledgeDepth === 'deep_pack', `${position} deep_pack`);
        assert(gen.domainPackKey === packKey, `${position} pack`);
        assert((gen.experienceTracks?.length ?? 0) >= 4, `${position} tracks`);
        assert(gen.packVersion === WAVE_3_ENRICHED_VERSION, `${position} version ${gen.packVersion}`);
    }
}

async function main(): Promise<void> {
    testPackVersions();
    testWave1ARoleKeyMatches();
    testTitleMatchPetroleumSurvey();
    await testBlueprintCarriesTracks();
    console.log(`✅ wave-1a-pack-smoke-test: all passed (${WAVE_1A_ROLE_KEYS.length} role keys)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
