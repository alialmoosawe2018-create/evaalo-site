/**
 * Wave 4 L3 Enriched — structural QA.
 * Usage: npx tsx src/scripts/wave-4-pack-smoke-test.ts
 */
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';
import {
    WAVE_3_ENRICHED_VERSION,
    WAVE_4_PACK_KEYS,
} from '../services/expertise/wave3EnrichedHelpers.js';
import { matchDomainPackByRoleKeyWithConfidence } from '../services/expertise/domainPacks.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function main(): void {
    for (const key of WAVE_4_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key}`);
        assert(pack!.packVersion === WAVE_3_ENRICHED_VERSION, `${key} version`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert(pack!.competencies.length >= 6, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
        assert(pack!.suggestedAnchorQuestions.length >= 3, `${key} anchors`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);
        for (const path of pack!.interviewPaths ?? []) {
            assert(path.steps.length >= 6, `${key} path steps`);
            for (const step of path.steps) {
                assert(!!step.clusterKey, `${key} step ${step.stepKey} clusterKey`);
            }
        }
        const rk = matchDomainPackByRoleKeyWithConfidence(pack!.roleKey);
        assert(rk.packKey === key, `${key} roleKey ${pack!.roleKey} (got ${rk.packKey})`);
        assert(rk.confidence === 'high', `${key} roleKey high`);
    }
    console.log(`✅ wave-4-pack-smoke-test: ${WAVE_4_PACK_KEYS.length} packs passed`);
}

main();
