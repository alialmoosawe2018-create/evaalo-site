/**
 * Promote pack conversation maturity after Live QA pass.
 * Usage: npx tsx src/scripts/promote-pack-maturity.ts --pack hr_recruiter --status conversation_validated --scenarios p05_resume_active,p05_ambiguous_clarify
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '../services/expertise/packMaturityRegistry.ts');

function parseArgs(): { pack: string; status: string; scenarios: string[] } {
    const args = process.argv.slice(2);
    let pack = '';
    let status = 'qa_passed';
    let scenarios: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--pack') pack = args[++i] ?? '';
        if (args[i] === '--status') status = args[++i] ?? status;
        if (args[i] === '--scenarios') {
            scenarios = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        }
    }
    if (!pack) throw new Error('Missing --pack');
    return { pack, status, scenarios };
}

function main(): void {
    const { pack, status, scenarios } = parseArgs();
    const text = readFileSync(REGISTRY_PATH, 'utf8');
    const overrideRe = /const CONVERSATION_OVERRIDES[\s\S]*?};/;
    const metaRe = /const VALIDATED_META[\s\S]*?};/;

    const overrides: Record<string, string> = {};
    const meta: Record<string, { validatedAt: string; scenarioIds: string[] }> = {};

    const overrideMatch = text.match(/const CONVERSATION_OVERRIDES[^=]*=\s*({[\s\S]*?});/);
    if (overrideMatch) {
        const block = overrideMatch[1]
            .replace(/(\w+):/g, '"$1":')
            .replace(/'/g, '"');
        try {
            Object.assign(overrides, JSON.parse(block));
        } catch {
            // keep empty — manual file format
        }
    }

    overrides[pack] = status;
    if (status === 'conversation_validated') {
        meta[pack] = {
            validatedAt: new Date().toISOString().slice(0, 10),
            scenarioIds: scenarios.length ? scenarios : [`live_qa_${pack}`],
        };
    }

    const overridesBody = Object.entries(overrides)
        .map(([k, v]) => `    ${k}: '${v}',`)
        .join('\n');
    const metaBody = Object.entries(meta)
        .map(([k, v]) => `    ${k}: {\n        validatedAt: '${v.validatedAt}',\n        scenarioIds: [${v.scenarioIds.map((s) => `'${s}'`).join(', ')}],\n    },`)
        .join('\n');

    let updated = text.replace(
        overrideRe,
        `const CONVERSATION_OVERRIDES: Partial<Record<string, ConversationMaturity>> = {\n${overridesBody}\n};`
    );
    updated = updated.replace(
        metaRe,
        `const VALIDATED_META: Partial<Record<string, { validatedAt: string; scenarioIds: string[] }>> = {\n${metaBody}\n};`
    );

    writeFileSync(REGISTRY_PATH, updated, 'utf8');
    console.log(`✅ promoted ${pack} → ${status}`);
}

main();
