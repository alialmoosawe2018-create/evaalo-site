/**
 * Role depth baseline report — CSV with L1/collision/structural columns.
 * Usage: npx tsx src/scripts/role-depth-baseline.ts > role-depth-baseline.csv
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveJobRole } from '../shared/jobCatalog/resolveJobRole.js';
import {
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
} from '../services/expertise/domainPacks.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';
import { getPackMaturity } from '../services/expertise/packMaturityRegistry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPositionTitles(): string[] {
    const pyPath = join(
        __dirname,
        '../../../avatar-evaalov2/src/voice_interview/data/question_bank_sources/position_catalog.py'
    );
    const text = readFileSync(pyPath, 'utf8');
    const titles: string[] = [];
    const re = /\("([^"]+)",\s*"[^"]+",\s*"[^"]+"\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        titles.push(m[1]);
    }
    return titles;
}

async function main(): Promise<void> {
    const titles = loadPositionTitles();
    console.log(
        'title,roleKey,industry_family,packKey,matchConfidence,expectedDepth,matchSource,l1_ok,collision_risk,structuralLevel'
    );

    for (const title of titles) {
        const resolved = resolveJobRole(title);
        const roleKey = resolved.roleKey || '';
        const byKey = roleKey
            ? matchDomainPackByRoleKeyWithConfidence(roleKey)
            : { pack: null, packKey: null, confidence: 'low' as const, matchSource: 'none' as const };

        let packKey = byKey.packKey;
        let confidence = byKey.confidence;
        let matchSource = byKey.matchSource;
        let collisionRisk = 'no';

        if (!packKey) {
            const inf = matchDomainPackWithConfidence(title, title, resolved.domain || undefined);
            packKey = inf.packKey;
            confidence = inf.confidence;
            matchSource = inf.matchSource;
        } else {
            const titleMatch = matchDomainPackWithConfidence(title, title, resolved.domain || undefined);
            if (titleMatch.packKey && titleMatch.packKey !== packKey && titleMatch.confidence !== 'low') {
                collisionRisk = 'yes';
            }
        }

        const bp = await generateExpertiseAndBlueprint({ criteria: { position: title } });
        const depth = bp.knowledgeDepth;
        const l1Ok = depth === 'taxonomy_generated' || depth === 'deep_pack' ? 'yes' : 'no';
        const maturity = packKey ? getPackMaturity(packKey) : undefined;
        const structuralLevel = maturity?.structuralLevel
            ?? (depth === 'deep_pack' ? 'L3_enriched' : depth === 'taxonomy_generated' ? 'L1_generated' : 'L1_generated');

        const row = [
            title,
            roleKey,
            resolved.domain || '',
            packKey || '',
            confidence,
            depth,
            matchSource,
            l1Ok,
            collisionRisk,
            structuralLevel,
        ]
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(',');
        console.log(row);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
