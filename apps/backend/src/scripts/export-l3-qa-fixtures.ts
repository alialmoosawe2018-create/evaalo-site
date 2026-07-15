/**
 * Export all L3 pack fields for Python QA fixtures (Wave 1A + 1B + 2).
 * Usage: npx tsx src/scripts/export-l3-qa-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PACK_VERSION, DOMAIN_PACKS } from '../services/expertise/domainPacks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(
    __dirname,
    '../../../avatar-evaalov2/tests/fixtures/l3_pack_fixtures.json'
);

function isL3Pack(packVersion: string | undefined): boolean {
    const v = (packVersion || DEFAULT_PACK_VERSION).trim();
    return v !== DEFAULT_PACK_VERSION;
}

function main(): void {
    const packs: Record<string, unknown> = {};
    for (const p of DOMAIN_PACKS) {
        if (!isL3Pack(p.packVersion)) continue;
        if ((p.supportedExperienceTracks?.length ?? 0) < 4) continue;
        packs[p.packKey] = {
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
        packCount: Object.keys(packs).length,
        packs,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`✅ wrote ${OUT} (${payload.packCount} L3 packs)`);
}

main();
