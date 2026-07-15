/**
 * Regenerates all three Campaign Compare secure n8n drafts (inactive).
 * Run: node scripts/build-campaign-compare-drafts.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const stages = [
    'build-campaign-compare-stage1-draft.mjs',
    'build-campaign-compare-stage2-draft.mjs',
    'build-campaign-compare-stage3-draft.mjs',
];

for (const script of stages) {
    console.log('\n---', script, '---');
    const result = spawnSync(process.execPath, [join(scriptsDir, script)], {
        stdio: 'inherit',
        cwd: join(scriptsDir, '..'),
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log('\nAll Campaign Compare secure drafts generated under docs/n8n-workflows/');
