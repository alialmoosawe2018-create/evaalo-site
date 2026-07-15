/**
 * L1 coverage gate — all catalog roleKeys must pass structural + quality checks.
 * Usage: npx tsx src/scripts/taxonomy-l1-coverage-test.ts
 */
import { ROLE_DEFINITIONS } from '../shared/jobCatalog/roleDefinitions.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';
import {
    MANUAL_L1_REVIEW_SAMPLE,
    buildRoleL1Profile,
    hasBannedTerminology,
    isGenericOnlyCompetencies,
    wordCount,
} from '../services/expertise/roleL1Hints.js';
import { inferDomain } from '../services/expertise/domainTaxonomy.js';
import { matchDomainPackByRoleKeyWithConfidence } from '../services/expertise/domainPacks.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function countQuestionMarks(q: string): number {
    return (q.match(/[؟?]/g) || []).length;
}

async function validateRoleKey(roleKey: string, displayTitle: string, careerLevel: string): Promise<void> {
    const def = ROLE_DEFINITIONS.find((r) => r.roleKey === roleKey);
    assert(!!def, `missing role definition for ${roleKey}`);

    const packMatch = matchDomainPackByRoleKeyWithConfidence(roleKey);
    const result = await generateExpertiseAndBlueprint({
        criteria: { position: displayTitle, roleKey, careerLevel },
    });

    if (packMatch.packKey && packMatch.confidence === 'high') {
        assert(result.knowledgeDepth === 'deep_pack', `${roleKey}: expected deep_pack (got ${result.knowledgeDepth})`);
        return;
    }

    // Title-only false positives must not block L1 roles
    if (result.knowledgeDepth === 'deep_pack' && packMatch.confidence !== 'high') {
        assert(false, `${roleKey}: unexpected deep_pack via title match (${result.domainPackKey})`);
    }

    assert(
        result.knowledgeDepth === 'taxonomy_generated',
        `${roleKey}: expected taxonomy_generated (got ${result.knowledgeDepth})`
    );

    const compKeys = result.competencies.map((c) => c.competencyKey);
    assert(compKeys.length >= 4, `${roleKey}: competencies < 4`);
    assert(!isGenericOnlyCompetencies(compKeys), `${roleKey}: generic-only competencies`);

    const terms = result.terminology ?? [];
    assert(terms.length >= 10, `${roleKey}: terminology < 10 (got ${terms.length})`);
    assert(!hasBannedTerminology(terms), `${roleKey}: banned generic terminology`);

    assert(result.anchorQuestions.length === 3, `${roleKey}: anchors !== 3`);
    for (const q of result.anchorQuestions) {
        assert(countQuestionMarks(q) <= 1, `${roleKey}: double question in anchor: ${q}`);
    }

    assert(wordCount(result.domainGuidance) >= 150, `${roleKey}: domainGuidance < 150 words`);

    const taxonomy = inferDomain(displayTitle);
    const l1 = buildRoleL1Profile(roleKey, displayTitle, def!.domain, def!.specialization, taxonomy);
    assert(l1.competencies.length >= 4, `${roleKey}: l1 profile competencies`);
    assert(l1.terminology.length >= 10, `${roleKey}: l1 profile terminology`);
}

async function main(): Promise<void> {
    const roleKeys = ROLE_DEFINITIONS.map((r) => r.roleKey);
    assert(roleKeys.length >= 174, `expected >= 174 roleKeys (got ${roleKeys.length})`);

    let l1Count = 0;
    let deepCount = 0;
    for (const def of ROLE_DEFINITIONS) {
        const mid = def.levels.find((l) => l.careerLevel === 'mid')
            ?? def.levels.find((l) => l.careerLevel === 'junior')
            ?? def.levels[0];
        const title = mid.displayTitle;
        await validateRoleKey(def.roleKey, title, mid.careerLevel);
        const pack = matchDomainPackByRoleKeyWithConfidence(def.roleKey);
        if (pack.packKey && pack.confidence === 'high') deepCount += 1;
        else l1Count += 1;
    }

    for (const rk of MANUAL_L1_REVIEW_SAMPLE) {
        const def = ROLE_DEFINITIONS.find((r) => r.roleKey === rk);
        assert(!!def, `manual sample missing roleKey ${rk}`);
        const mid = def!.levels[0];
        const l1 = buildRoleL1Profile(
            rk,
            mid.displayTitle,
            def!.domain,
            def!.specialization,
            inferDomain(mid.displayTitle)
        );
        assert(l1.anchors.every((q) => countQuestionMarks(q) <= 1), `${rk}: manual sample anchor quality`);
        assert(l1.terminology.length >= 10, `${rk}: manual sample terminology`);
    }

    console.log(`✅ taxonomy-l1-coverage-test: ${roleKeys.length} roleKeys OK (${deepCount} deep_pack, ${l1Count} L1)`);
    console.log(`   manual review sample: ${MANUAL_L1_REVIEW_SAMPLE.length} roles validated`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
