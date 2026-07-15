/**
 * Taxonomy L1 lift smoke test (no DB).
 * Usage: npx tsx src/scripts/taxonomy-l1-smoke-test.ts
 */
import { buildDomainGuidance, generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';
import {
    inferDomain,
    inferSpecialization,
    getTaxonomyLightTerminology,
} from '../services/expertise/domainTaxonomy.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function countQuestionMarks(q: string): number {
    return (q.match(/[؟?]/g) || []).length;
}

async function main(): Promise<void> {
    // --- Direct taxonomy / guidance (no LLM) ---
    const engTax = inferDomain('Survey Engineer');
    assert(engTax.domain === 'engineering', `engineering domain (got ${engTax.domain})`);
    const engTerms = getTaxonomyLightTerminology(engTax);
    assert(engTerms.length >= 10, `engineering lightTerminology (got ${engTerms.length})`);
    assert(
        engTerms.some((t) => /GPS|GNSS|Total Station/i.test(t)),
        'survey-related terms in engineering taxonomy'
    );
    assert(
        engTax.commonSpecializations.some((s) => /Survey/i.test(s)),
        'Survey Engineering in commonSpecializations'
    );
    assert(engTax.expectedCompetencies.length >= 5, 'engineering expectedCompetencies >= 5');

    const spec = inferSpecialization(engTax, 'Survey Engineer');
    const guidance = buildDomainGuidance(undefined, engTax, spec);
    assert(
        /GPS|GNSS|Total Station|coordinates/i.test(guidance),
        'domainGuidance includes light terminology'
    );

    const petroTax = inferDomain('Petroleum Engineer');
    const petroTerms = getTaxonomyLightTerminology(petroTax);
    assert(
        petroTerms.some((t) => /well|GOR|water cut|HSE/i.test(t)),
        'petroleum-related terms in engineering taxonomy'
    );

    // --- Wave 1A roles → deep_pack + tracks ---
    for (const title of ['Survey Engineer', 'Petroleum Engineer', 'Recruiter']) {
        const result = await generateExpertiseAndBlueprint({
            criteria: { position: title },
        });
        assert(result.knowledgeDepth === 'deep_pack', `${title} deep_pack (got ${result.knowledgeDepth})`);
        assert((result.experienceTracks?.length ?? 0) >= 4, `${title}: experienceTracks`);
        assert(result.anchorQuestions.length === 3, `${title}: 3 anchors`);
        assert(
            result.anchorQuestions.every((q) => countQuestionMarks(q) <= 1),
            `${title}: single question mark per anchor`
        );
        assert(
            (result.terminology?.length ?? 0) >= 5,
            `${title}: terminology populated (got ${result.terminology?.length ?? 0})`
        );
        assert(
            result.domainGuidance.length > 80,
            `${title}: domainGuidance non-trivial`
        );
    }

    const clerk = await generateExpertiseAndBlueprint({
        criteria: { position: 'Office Clerk' },
    });
    assert(
        clerk.knowledgeDepth === 'fallback' || clerk.knowledgeDepth === 'taxonomy_generated',
        `Office Clerk not deep_pack (got ${clerk.knowledgeDepth})`
    );

    const survey = await generateExpertiseAndBlueprint({
        criteria: { position: 'Survey Engineer' },
    });
    const surveyProbe = `${survey.specialization} ${survey.anchorQuestions.join(' ')}`.toLowerCase();
    assert(
        /survey|مسح|gnss|gps|total station|إحداثيات|طبوغرافي/i.test(surveyProbe),
        'Survey Engineer anchors or specialization are domain-specific'
    );

    console.log('✅ taxonomy-l1-smoke-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
