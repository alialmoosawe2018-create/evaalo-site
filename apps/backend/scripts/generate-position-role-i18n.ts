/**
 * Generate positionRole_{roleKey} i18n entries from existing {roleKey}.mid labels.
 * Usage: npx tsx apps/backend/scripts/generate-position-role-i18n.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLE_DEFINITIONS } from '../../shared/jobCatalog/roleDefinitions.js';
import {
    getRolePositionLabelKey,
    getRolePositionTitle,
} from '../../shared/jobCatalog/positionTitle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoApps = path.resolve(__dirname, '..', '..');
const arPath = path.join(repoApps, 'frontend', 'src', 'constants', 'positionLabels.ar.json');
const kuPath = path.join(repoApps, 'frontend', 'src', 'constants', 'positionLabels.ku.json');

function mergePositionRoleKeys(filePath: string): number {
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
    let added = 0;
    for (const def of ROLE_DEFINITIONS) {
        const key = getRolePositionLabelKey(def.roleKey);
        if (data[key]) continue;
        const midKey = `${def.roleKey}.mid`;
        const managerKey = `${def.roleKey}.manager`;
        const enTitle = getRolePositionTitle(def.roleKey);
        if (data[midKey]) {
            data[key] = data[midKey];
            added++;
        } else if (data[managerKey]) {
            data[key] = data[managerKey];
            added++;
        } else if (data[enTitle]) {
            data[key] = data[enTitle];
            added++;
        }
    }
    const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]!]));
    writeFileSync(filePath, `${JSON.stringify(sorted, null, 4)}\n`, 'utf8');
    return added;
}

const arAdded = mergePositionRoleKeys(arPath);
const kuAdded = mergePositionRoleKeys(kuPath);
console.log(`positionRole i18n: ar +${arAdded}, ku +${kuAdded}`);
