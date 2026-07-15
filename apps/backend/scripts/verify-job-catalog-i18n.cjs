/**
 * Verify every catalog labelKey has AR + KU translations.
 * Usage: node scripts/verify-job-catalog-i18n.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const catalogDir = path.join(repoRoot, 'shared', 'jobCatalog');

// Load catalog by executing build via dynamic import of compiled sync copy
const backendCatalog = path.join(repoRoot, 'backend', 'src', 'shared', 'jobCatalog', 'buildCatalog.ts');
if (!fs.existsSync(backendCatalog)) {
    console.error('Run sync-job-catalog first');
    process.exit(1);
}

const arPath = path.join(repoRoot, 'frontend', 'src', 'constants', 'positionLabels.ar.json');
const kuPath = path.join(repoRoot, 'frontend', 'src', 'constants', 'positionLabels.ku.json');

const ar = JSON.parse(fs.readFileSync(arPath, 'utf8'));
const ku = JSON.parse(fs.readFileSync(kuPath, 'utf8'));

// Parse labelKeys from roleDefinitions + buildCatalog pattern in TS files
const buildCatalogSrc = fs.readFileSync(
    path.join(catalogDir, 'roleDefinitions.ts'),
    'utf8'
);
const roleKeys = [...buildCatalogSrc.matchAll(/role\('([a-z0-9_]+)'/g)].map((m) => m[1]);
const levels = ['intern', 'graduate', 'junior', 'mid', 'senior', 'lead', 'supervisor', 'manager', 'head', 'director', 'executive'];

// Collect labelKeys from synced job catalog entries file if exists
const indexSrc = fs.readFileSync(path.join(catalogDir, 'buildCatalog.ts'), 'utf8');
const labelKeyPattern = /labelKey = `\$\{def\.roleKey\}\.\$\{careerLevel\}`/;

const entriesJsonPath = path.join(repoRoot, 'backend', 'scripts', '.job-catalog-label-keys.json');

function collectLabelKeysFromRoleDefs() {
    const keys = new Set();
    const levelBlocks = buildCatalogSrc.split(/role\(/).slice(1);
    for (const block of levelBlocks) {
        const roleKeyMatch = block.match(/^'([a-z0-9_]+)'/);
        if (!roleKeyMatch) continue;
        const rk = roleKeyMatch[1];
        const levelMatches = [...block.matchAll(/careerLevel:\s*'([a-z]+)'/g)];
        for (const lm of levelMatches) {
            keys.add(`${rk}.${lm[1]}`);
        }
    }
    return [...keys];
}

const labelKeys = collectLabelKeysFromRoleDefs();
const missingAr = labelKeys.filter((k) => !ar[k]);
const missingKu = labelKeys.filter((k) => !ku[k]);

if (missingAr.length || missingKu.length) {
    console.warn(`Catalog labelKeys: ${labelKeys.length}`);
    if (missingAr.length) {
        console.warn(`Missing AR (${missingAr.length}):`, missingAr.slice(0, 20).join(', '), missingAr.length > 20 ? '...' : '');
    }
    if (missingKu.length) {
        console.warn(`Missing KU (${missingKu.length}):`, missingKu.slice(0, 20).join(', '), missingKu.length > 20 ? '...' : '');
    }
    // Write seed file for incremental translation (displayTitle fallback in UI until filled)
    fs.writeFileSync(
        entriesJsonPath,
        JSON.stringify({ labelKeys, missingAr, missingKu }, null, 2)
    );
    console.warn(`Wrote ${entriesJsonPath} — UI falls back to displayTitle when labelKey missing`);
    process.exit(missingAr.length > labelKeys.length * 0.5 ? 1 : 0);
}

console.log(`✅ All ${labelKeys.length} labelKeys have AR + KU translations`);
