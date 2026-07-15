/**
 * Depth dashboard — packCount, roleTitleCoverage, L1/L3/validated metrics.
 * Usage: npx tsx src/scripts/depth-dashboard.ts
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';
import { L3_ENRICHED_PACK_KEYS } from '../services/expertise/wave3EnrichedHelpers.js';
import {
    countByStructuralLevel,
    countConversationValidated,
    PACK_MATURITY_REGISTRY,
} from '../services/expertise/packMaturityRegistry.js';
import { ROLE_DEFINITIONS } from '../shared/jobCatalog/roleDefinitions.js';
import { resolveJobRole } from '../shared/jobCatalog/resolveJobRole.js';
import {
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
    shouldUseDeepPackMatch,
} from '../services/expertise/domainPacks.js';
import { generateExpertiseAndBlueprint } from '../services/expertise/blueprintGenerator.js';

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
    let roleTitleDeep = 0;
    let roleTitleL1 = 0;
    let collisionRisk = 0;

    for (const title of titles) {
        const resolved = resolveJobRole(title);
        const roleKey = resolved.roleKey || '';
        const byKey = roleKey
            ? matchDomainPackByRoleKeyWithConfidence(roleKey)
            : { packKey: null, confidence: 'low' as const };

        let packKey = byKey.packKey;
        let confidence = byKey.confidence;

        if (!packKey) {
            const inf = matchDomainPackWithConfidence(title, title, resolved.domain || undefined);
            packKey = inf.packKey;
            confidence = inf.confidence;
            if (packKey && roleKey && byKey.packKey !== packKey) collisionRisk += 1;
        }

        if (packKey && (confidence === 'high' || confidence === 'medium')) {
            roleTitleDeep += 1;
        } else {
            const bp = await generateExpertiseAndBlueprint({ criteria: { position: title } });
            if (bp.knowledgeDepth === 'taxonomy_generated' || bp.knowledgeDepth === 'deep_pack') {
                roleTitleL1 += 1;
            }
        }
    }

    const structural = countByStructuralLevel();
    const packCount = DOMAIN_PACKS.length;
    const l3PackCount = L3_ENRICHED_PACK_KEYS.length;
    const validated = countConversationValidated();

    console.log('metric,value');
    console.log(`packCount,${packCount}`);
    console.log(`l3PackCount,${l3PackCount}`);
    console.log(`roleTitleCount,${titles.length}`);
    console.log(`roleKeyCount,${ROLE_DEFINITIONS.length}`);
    console.log(`roleTitleCoverage_deep,${roleTitleDeep}`);
    console.log(`L1Coverage,${roleTitleL1}`);
    console.log(`L3Coverage,${roleTitleDeep}`);
    console.log(`conversationValidatedCount,${validated}`);
    console.log(`collisionRiskTitles,${collisionRisk}`);
    console.log(`structural_L1,${structural.L1_generated}`);
    console.log(`structural_L2,${structural.L2}`);
    console.log(`structural_L3,${structural.L3_enriched}`);
    console.log('');
    console.log('Validated packs:');
    for (const r of Object.values(PACK_MATURITY_REGISTRY)) {
        if (r.conversationMaturity === 'conversation_validated') {
            console.log(`  - ${r.packKey} (${r.validatedAt})`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
