/**
 * Sync apps/shared/jobCatalog → apps/backend/src/shared/jobCatalog
 * Run on predev/prebuild so backend tsc compiles the same catalog (zero manual drift).
 */
const { cpSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = path.join(repoRoot, 'shared', 'jobCatalog');
const target = path.join(repoRoot, 'backend', 'src', 'shared', 'jobCatalog');

rmSync(target, { recursive: true, force: true });
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`✅ sync-job-catalog: ${source} → ${target}`);
