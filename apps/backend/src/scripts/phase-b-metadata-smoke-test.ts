/**
 * Phase B metadata smoke test — glossary + tracks + versions in LiveKit metadata.
 * Usage: npx tsx src/scripts/phase-b-metadata-smoke-test.ts
 */
import { WAVE_1A_PACK_VERSION } from '../services/expertise/domainPacks.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';
import { buildBlueprintMetadata } from '../services/expertise/blueprintMetadata.js';
import type { LockedBlueprintBundle } from '../services/expertise/ensureBlueprint.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function bundleFromGenerated(
    generated: Awaited<ReturnType<typeof generateExpertiseAndBlueprint>>
): LockedBlueprintBundle {
    return {
        blueprint: {
            language: generated.language,
            anchorQuestions: generated.anchorQuestions,
            competencies: generated.competencies,
            knowledgeDepth: generated.knowledgeDepth,
            blueprintContentVersion: generated.blueprintContentVersion,
            packVersion: generated.packVersion,
            packMatchConfidence: generated.packMatchConfidence,
            blueprintGeneratedAt: new Date(generated.generatedAt || Date.now()),
            experienceTracks: generated.experienceTracks,
            interviewPaths: generated.interviewPaths,
        } as LockedBlueprintBundle['blueprint'],
        profile: {
            expertisePrompt: generated.expertisePrompt,
            domainGuidance: generated.domainGuidance,
            terminology: generated.terminology,
            domainPackKey: generated.domainPackKey,
            specialization: generated.specialization,
            roleKey: generated.roleKey,
            careerLevel: generated.careerLevel,
            managementTrack: generated.managementTrack,
            knowledgeDepth: generated.knowledgeDepth,
            blueprintContentVersion: generated.blueprintContentVersion,
            packVersion: generated.packVersion,
            packMatchConfidence: generated.packMatchConfidence,
            blueprintGeneratedAt: new Date(generated.generatedAt || Date.now()),
            roleResolution: generated.roleResolution,
            experienceTracks: generated.experienceTracks,
            interviewPaths: generated.interviewPaths,
        } as LockedBlueprintBundle['profile'],
    };
}

async function testWave1APhaseB(roleTitle: string, packKey: string): Promise<void> {
    const generated = await generateExpertiseAndBlueprint({
        criteria: { position: roleTitle },
    });
    assert(generated.knowledgeDepth === 'deep_pack', `${roleTitle} deep_pack`);
    assert((generated.terminology?.length ?? 0) >= 8, `${roleTitle} terminology`);
    assert((generated.experienceTracks?.length ?? 0) >= 4, `${roleTitle} tracks`);

    const meta = buildBlueprintMetadata(bundleFromGenerated(generated));
    assert(!!meta, `${roleTitle} metadata built`);
    assert(meta!.domain_pack_key === packKey, `${roleTitle} domain_pack_key`);
    assert(!!meta!.profile_terminology, `${roleTitle} profile_terminology`);
    assert(!!meta!.role_glossary, `${roleTitle} role_glossary`);

    const glossary = JSON.parse(meta!.role_glossary) as string[];
    assert(Array.isArray(glossary) && glossary.length >= 8, `${roleTitle} glossary array`);

    const compact = JSON.parse(meta!.blueprint) as Record<string, unknown>;
    assert(Array.isArray(compact.experienceTracks) && compact.experienceTracks.length >= 4, `${roleTitle} compact tracks`);
    assert(Array.isArray(compact.interviewPaths) && compact.interviewPaths.length >= 1, `${roleTitle} compact paths`);
    assert(Array.isArray(compact.terminology) && compact.terminology.length >= 8, `${roleTitle} compact terminology`);

    assert(meta!.pack_version === WAVE_1A_PACK_VERSION, `${roleTitle} pack_version`);
    assert(!!meta!.blueprint_content_version, `${roleTitle} content version`);
    assert(!!meta!.blueprint_generated_at, `${roleTitle} generated_at`);
    assert(!!meta!.role_key, `${roleTitle} role_key`);
}

async function main(): Promise<void> {
    await testWave1APhaseB('Recruiter', 'hr_recruiter');
    await testWave1APhaseB('Petroleum Engineer', 'petroleum_engineer');
    await testWave1APhaseB('Survey Engineer', 'survey_engineer');

    const fallback = await generateExpertiseAndBlueprint({
        criteria: { position: 'Office Clerk' },
    });
    const fbMeta = buildBlueprintMetadata(bundleFromGenerated(fallback));
    assert(!!fbMeta, 'fallback metadata');
    const fbCompact = JSON.parse(fbMeta!.blueprint) as Record<string, unknown>;
    assert(!fbMeta!.domain_pack_key, 'fallback no pack key');
    assert(!Array.isArray(fbCompact.experienceTracks) || fbCompact.experienceTracks.length === 0, 'fallback no tracks');

    console.log('✅ phase-b-metadata-smoke-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
