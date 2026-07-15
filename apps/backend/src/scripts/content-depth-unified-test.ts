/**
 * L3 content depth — unique rubrics + domain-specific tracks (no RUBRIC_STD / stdTracks).
 * Usage: npx tsx src/scripts/content-depth-unified-test.ts
 */
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';
import { assertPackRubricsUnique } from '../services/expertise/packRubrics.js';
import { L3_ENRICHED_PACK_KEYS } from '../services/expertise/wave3EnrichedHelpers.js';

const GENERIC_RUBRIC_FINGERPRINT = 'لا أدلة عملية.|تحليل عميق بقرار ونتيجة قابلة للقياس.';
const GENERIC_EXPERIENCED_SIGNALS = new Set(['experienced']);

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function testUniqueRubricsPerPack(): void {
    for (const key of L3_ENRICHED_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key}`);
        assertPackRubricsUnique(pack!.packKey, pack!.competencies);
        for (const c of pack!.competencies) {
            const fp = `${c.scoreRubric['1']}|${c.scoreRubric['5']}`;
            assert(
                fp !== GENERIC_RUBRIC_FINGERPRINT,
                `${key}/${c.competencyKey}: still uses generic RUBRIC_STD fingerprint`
            );
        }
    }
}

function testDomainSpecificTracks(): void {
    for (const key of L3_ENRICHED_PACK_KEYS) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        const experienced = pack!.supportedExperienceTracks?.find((t) => t.trackKey === 'experienced');
        assert(!!experienced, `${key}: missing experienced track`);
        const hasDomainSignal = experienced!.detectSignals.some(
            (s) => !['اشتغلت', 'سنوات', 'خبرة', 'مشروع', 'فريق', 'experienced'].includes(s)
        );
        assert(hasDomainSignal, `${key}: experienced track has only generic detectSignals`);
        const academic = pack!.supportedExperienceTracks?.find((t) => t.trackKey === 'academic_only');
        assert(!!academic?.rubricAdjustments || !!academic?.openingAnchors?.length, `${key}: academic track thin`);
    }
}

function testChefExcluded(): void {
    const chef = DOMAIN_PACKS.find((p) => p.packKey === 'chef');
    assert(chef?.packVersion === '1.0.0', 'chef stays L2');
    assert(!(L3_ENRICHED_PACK_KEYS as readonly string[]).includes('chef'), 'chef not in enriched set');
}

function main(): void {
    testUniqueRubricsPerPack();
    testDomainSpecificTracks();
    testChefExcluded();
    console.log(`✅ content-depth-unified-test: all passed (${L3_ENRICHED_PACK_KEYS.length} packs)`);
}

main();
