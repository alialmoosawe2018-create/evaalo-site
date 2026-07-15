/**
 * Wave 3 L3 Enriched — structural QA for all v1.4.0 deep packs.
 * Usage: npx tsx src/scripts/wave-3-pack-smoke-test.ts
 */
import {
    DOMAIN_PACKS,
    matchDomainPackByRoleKeyWithConfidence,
    WAVE_3_ENRICHED_VERSION,
} from '../services/expertise/domainPacks.js';
import { L3_ENRICHED_PACK_KEYS } from '../services/expertise/wave3EnrichedHelpers.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function testEnrichedStructure(): void {
    for (const key of L3_ENRICHED_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key} exists`);
        assert(pack!.packVersion === WAVE_3_ENRICHED_VERSION, `${key} version ${pack!.packVersion}`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert((pack!.competencies.length ?? 0) >= 4, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
        assert((pack!.suggestedAnchorQuestions.length ?? 0) >= 3, `${key} anchors`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);

        for (const path of pack!.interviewPaths ?? []) {
            assert(!!path.preferredTracks?.length, `${key} path ${path.pathKey} preferredTracks`);
            assert(path.steps.length >= 5, `${key} path ${path.pathKey} steps >= 5 (got ${path.steps.length})`);
            for (const step of path.steps) {
                assert(!!step.clusterKey, `${key} step ${step.stepKey} clusterKey`);
            }
        }

        const rk = matchDomainPackByRoleKeyWithConfidence(pack!.roleKey);
        assert(rk.packKey === key, `${key} roleKey match (got ${rk.packKey})`);
        assert(rk.confidence === 'high', `${key} roleKey high`);
    }
}

function testOilGasProductionL3(): void {
    const pack = DOMAIN_PACKS.find((p) => p.packKey === 'oil_gas_production')!;
    assert(pack.competencies.length >= 6, 'oil_gas 6 competencies');
    assert((pack.interviewPaths?.length ?? 0) >= 2, 'oil_gas dual paths');
    const field = pack.interviewPaths!.find((p) => p.pathKey === 'production_field_ops');
    const academic = pack.interviewPaths!.find((p) => p.pathKey === 'production_academic');
    assert(!!field?.preferredTracks?.includes('experienced'), 'field path tracks');
    assert(!!academic?.preferredTracks?.includes('academic_only'), 'academic path tracks');
}

function testGeneralAccountantL3(): void {
    const pack = DOMAIN_PACKS.find((p) => p.packKey === 'general_accountant')!;
    assert(pack.competencies.length >= 4, 'accountant 4+ comps');
    assert((pack.supportedExperienceTracks?.length ?? 0) >= 6, 'accountant tracks');
}

function testPetroleumDualPaths(): void {
    const pack = DOMAIN_PACKS.find((p) => p.packKey === 'petroleum_engineer')!;
    assert((pack.interviewPaths?.length ?? 0) >= 2, 'petroleum dual paths');
    const field = pack.interviewPaths!.find((p) => p.pathKey === 'petroleum_experienced');
    const academic = pack.interviewPaths!.find((p) => p.pathKey === 'petroleum_academic_only');
    assert(!!field?.preferredTracks?.includes('experienced'), 'petroleum field tracks');
    assert(!!academic?.preferredTracks?.includes('academic_only'), 'petroleum academic tracks');
}

function main(): void {
    testEnrichedStructure();
    testOilGasProductionL3();
    testGeneralAccountantL3();
    testPetroleumDualPaths();
    console.log(`✅ wave-3-pack-smoke-test: all passed (${L3_ENRICHED_PACK_KEYS.length} enriched packs)`);
}

main();
