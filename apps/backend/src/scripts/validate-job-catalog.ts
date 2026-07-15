import { JOB_CATALOG, normalizeTitle } from '../shared/jobCatalog/buildCatalog.js';
import { ROLE_DEFINITIONS } from '../shared/jobCatalog/roleDefinitions.js';

const titles = new Map<string, string>();
const labelKeys = new Map<string, string>();
const dupsTitle: string[] = [];
const dupsLabel: string[] = [];

for (const e of JOB_CATALOG) {
    const nt = normalizeTitle(e.displayTitle);
    if (titles.has(nt)) dupsTitle.push(`${e.displayTitle} (${e.labelKey} vs ${titles.get(nt)})`);
    else titles.set(nt, e.labelKey);
    if (labelKeys.has(e.labelKey)) dupsLabel.push(e.labelKey);
    else labelKeys.set(e.labelKey, e.displayTitle);
}

const roleKeys = ROLE_DEFINITIONS.map((r) => r.roleKey);
const dupRoles = roleKeys.filter((k, i) => roleKeys.indexOf(k) !== i);
const levelDup: string[] = [];
for (const r of ROLE_DEFINITIONS) {
    const levels = r.levels.map((l) => l.careerLevel);
    const d = levels.filter((l, i) => levels.indexOf(l) !== i);
    if (d.length) levelDup.push(`${r.roleKey}: ${d.join(',')}`);
}

console.log(`entries=${JOB_CATALOG.length} roleKeys=${roleKeys.length}`);
if (dupsTitle.length) {
    console.error('DUPLICATE TITLES:', dupsTitle);
    process.exit(1);
}
if (dupsLabel.length) {
    console.error('DUPLICATE LABEL KEYS:', dupsLabel);
    process.exit(1);
}
if (dupRoles.length) {
    console.error('DUPLICATE ROLE KEYS:', dupRoles);
    process.exit(1);
}
if (levelDup.length) {
    console.error('DUPLICATE LEVELS IN ROLE:', levelDup);
    process.exit(1);
}
console.log('✅ catalog integrity ok');
