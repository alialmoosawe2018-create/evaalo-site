/**
 * Blueprint versioning smoke test (no DB).
 * Usage: npx tsx src/scripts/blueprint-version-smoke-test.ts
 */
import { WAVE_1A_PACK_VERSION } from '../services/expertise/domainPacks.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
    const recruiter = await generateExpertiseAndBlueprint({
        criteria: { position: 'Recruiter' },
    });
    assert(recruiter.knowledgeDepth === 'deep_pack', 'Recruiter deep_pack');
    assert(
        recruiter.blueprintContentVersion.startsWith('pack-hr_recruiter-'),
        `content version (got ${recruiter.blueprintContentVersion})`
    );
    assert(recruiter.packVersion === WAVE_1A_PACK_VERSION, `packVersion ${WAVE_1A_PACK_VERSION}`);
    assert(!!recruiter.generatedAt, 'generatedAt set');
    assert(recruiter.packMatchConfidence === 'high', 'pack match high');

    const unknown = await generateExpertiseAndBlueprint({
        criteria: { position: 'Office Clerk' },
    });
    assert(
        unknown.knowledgeDepth === 'fallback' || unknown.knowledgeDepth === 'taxonomy_generated',
        'unknown role not deep_pack without pack'
    );
    assert(
        unknown.blueprintContentVersion.startsWith('taxonomy-'),
        `unknown taxonomy version (got ${unknown.blueprintContentVersion})`
    );

    console.log('✅ blueprint-version-smoke-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
