/**
 * Seed positionLabels.ar.json / .ku.json with labelKey entries from JOB_CATALOG.
 * Copies existing translations when displayTitle matches legacy keys.
 * Usage: npx tsx src/scripts/generate-job-catalog-i18n.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG } from '../shared/jobCatalog/buildCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendConstants = path.resolve(__dirname, '../../../frontend/src/constants');

function loadJson(p: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p: string, data: Record<string, string>) {
    const sorted = Object.fromEntries(
        Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
    );
    fs.writeFileSync(p, `${JSON.stringify(sorted, null, 4)}\n`, 'utf8');
}

const arPath = path.join(frontendConstants, 'positionLabels.ar.json');
const kuPath = path.join(frontendConstants, 'positionLabels.ku.json');

const ar = loadJson(arPath);
const ku = loadJson(kuPath);

let addedAr = 0;
let addedKu = 0;

for (const entry of JOB_CATALOG) {
    const { labelKey, displayTitle } = entry;
    if (!ar[labelKey]) {
        ar[labelKey] = ar[displayTitle] || displayTitle;
        addedAr += 1;
    }
    if (!ku[labelKey]) {
        ku[labelKey] = ku[displayTitle] || displayTitle;
        addedKu += 1;
    }
}

saveJson(arPath, ar);
saveJson(kuPath, ku);
console.log(`✅ i18n seed: +${addedAr} AR, +${addedKu} KU labelKeys (${JOB_CATALOG.length} catalog entries)`);
