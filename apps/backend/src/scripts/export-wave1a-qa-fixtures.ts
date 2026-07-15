/**
 * Export Wave 1A pack fields for Python QA scorecard fixtures.
 * Usage: npx tsx src/scripts/export-wave1a-qa-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS, WAVE_1A_PACK_VERSION } from '../services/expertise/domainPacks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(
    __dirname,
    '../../../avatar-evaalov2/tests/fixtures/wave1a_pack_fixtures.json'
);

const PACK_KEYS = ['hr_recruiter', 'petroleum_engineer', 'survey_engineer'] as const;

function main(): void {
    const packs: Record<string, unknown> = {};
    for (const key of PACK_KEYS) {
        const p = DOMAIN_PACKS.find((x) => x.packKey === key);
        if (!p) throw new Error(`missing pack ${key}`);
        packs[key] = {
            packKey: p.packKey,
            packVersion: p.packVersion,
            roleKey: p.roleKey,
            position: p.roleAliases?.[0] || p.specialization,
            specialization: p.specialization,
            terminology: p.terminology || [],
            suggestedAnchorQuestions: p.suggestedAnchorQuestions,
            supportedExperienceTracks: p.supportedExperienceTracks || [],
            interviewPaths: p.interviewPaths || [],
            competencyCount: p.competencies.length,
        };
    }
    const payload = {
        generatedAt: new Date().toISOString(),
        wave1aPackVersion: WAVE_1A_PACK_VERSION,
        packs,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`✅ wrote ${OUT}`);
}

main();
