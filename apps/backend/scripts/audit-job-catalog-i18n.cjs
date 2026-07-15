/**
 * Audit untranslated labelKeys (value equals English displayTitle).
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const catalogPath = path.join(repoRoot, 'backend', 'src', 'shared', 'jobCatalog', 'buildCatalog.ts');
const rolePath = path.join(repoRoot, 'shared', 'jobCatalog', 'roleDefinitions.ts');

const ar = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'constants', 'positionLabels.ar.json'), 'utf8'));
const ku = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'constants', 'positionLabels.ku.json'), 'utf8'));

const roleSrc = fs.readFileSync(rolePath, 'utf8');
const entries = [];
const roleBlocks = roleSrc.split(/role\(/).slice(1);
for (const block of roleBlocks) {
    const roleKeyMatch = block.match(/^'([a-z0-9_]+)'/);
    if (!roleKeyMatch) continue;
    const roleKey = roleKeyMatch[1];
    const titleMatches = [...block.matchAll(/displayTitle:\s*'([^']+)'/g)];
    const levelMatches = [...block.matchAll(/careerLevel:\s*'([a-z]+)'/g)];
    for (let i = 0; i < levelMatches.length; i++) {
        const careerLevel = levelMatches[i][1];
        const displayTitle = titleMatches[i] ? titleMatches[i][1] : null;
        if (!displayTitle) continue;
        entries.push({ labelKey: `${roleKey}.${careerLevel}`, displayTitle });
    }
}

let untranslatedAr = 0;
let untranslatedKu = 0;
const samples = [];
for (const e of entries) {
    const arVal = ar[e.labelKey];
    const kuVal = ku[e.labelKey];
    const arBad = !arVal || arVal === e.displayTitle;
    const kuBad = !kuVal || kuVal === e.displayTitle;
    if (arBad) untranslatedAr++;
    if (kuBad) untranslatedKu++;
    if ((arBad || kuBad) && samples.length < 20) samples.push(e.displayTitle);
}

console.log('Catalog entries:', entries.length);
console.log('Untranslated AR:', untranslatedAr);
console.log('Untranslated KU:', untranslatedKu);
console.log('Samples:', samples.join(' | '));
