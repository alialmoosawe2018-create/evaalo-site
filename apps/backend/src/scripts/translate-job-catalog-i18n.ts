/**
 * Fill AR/KU translations for catalog labelKeys using pattern engine + existing seeds.
 * Usage: npx tsx src/scripts/translate-job-catalog-i18n.ts [--force-all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG } from '../shared/jobCatalog/buildCatalog.js';
import {
    buildEnMemory,
    hasEnglishRemnants,
    isTranslated,
    MANUAL_BY_LABEL_KEY,
    translateDisplayTitle,
    type Lang,
} from './jobCatalogI18nEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendConstants = path.resolve(__dirname, '../../../frontend/src/constants');
const FORCE_ALL = process.argv.includes('--force-all');

function loadJson(p: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p: string, data: Record<string, string>) {
    const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(p, `${JSON.stringify(sorted, null, 4)}\n`, 'utf8');
}

function fillLang(
    labels: Record<string, string>,
    lang: Lang,
    memory: Map<string, string>
): number {
    let updated = 0;
    for (const entry of JOB_CATALOG) {
        const { labelKey, displayTitle } = entry;
        const manual = MANUAL_BY_LABEL_KEY[labelKey];
        if (manual) {
            const next = lang === 'ar' ? manual.ar : manual.ku;
            if (labels[labelKey] !== next) {
                labels[labelKey] = next;
                updated += 1;
            }
            memory.set(`${lang}:${displayTitle}`, next);
            continue;
        }

        const current = labels[labelKey];
        const needsUpdate =
            FORCE_ALL ||
            !current ||
            !isTranslated(current, lang) ||
            current === displayTitle ||
            hasEnglishRemnants(current);

        if (!needsUpdate) continue;

        const translated = translateDisplayTitle(displayTitle, lang, memory);

        if (translated && translated !== displayTitle) {
            labels[labelKey] = translated;
            updated += 1;
        } else if (!labels[labelKey]) {
            labels[labelKey] = displayTitle;
        }
    }
    return updated;
}

const arPath = path.join(frontendConstants, 'positionLabels.ar.json');
const kuPath = path.join(frontendConstants, 'positionLabels.ku.json');

const ar = loadJson(arPath);
const ku = loadJson(kuPath);

const arMemory = FORCE_ALL ? new Map<string, string>() : buildEnMemory(ar, 'ar');
const kuMemory = FORCE_ALL ? new Map<string, string>() : buildEnMemory(ku, 'ku');

if (!FORCE_ALL) {
    for (const entry of JOB_CATALOG) {
        const arVal = ar[entry.labelKey];
        const kuVal = ku[entry.labelKey];
        if (arVal && isTranslated(arVal, 'ar') && !hasEnglishRemnants(arVal)) {
            arMemory.set(`ar:${entry.displayTitle}`, arVal);
        }
        if (kuVal && isTranslated(kuVal, 'ku') && !hasEnglishRemnants(kuVal)) {
            kuMemory.set(`ku:${entry.displayTitle}`, kuVal);
        }
    }
}

const updatedAr = fillLang(ar, 'ar', arMemory);
const updatedKu = fillLang(ku, 'ku', kuMemory);

saveJson(arPath, ar);
saveJson(kuPath, ku);

try {
    execSync('node scripts/apply-ku-polish.cjs', {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe',
    });
    Object.assign(ku, loadJson(kuPath));
} catch {
    /* optional post-pass */
}

let latinAr = 0;
let latinKu = 0;
for (const entry of JOB_CATALOG) {
    if (hasEnglishRemnants(ar[entry.labelKey] || '')) latinAr++;
    if (hasEnglishRemnants(ku[entry.labelKey] || '')) latinKu++;
}

console.log(`✅ Translated: +${updatedAr} AR, +${updatedKu} KU${FORCE_ALL ? ' (force-all)' : ''}`);
console.log(`Remaining Latin tokens: AR ${latinAr}, KU ${latinKu} / ${JOB_CATALOG.length}`);
