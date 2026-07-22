/**
 * Org chart import helpers: parse spreadsheets (xlsx/csv) into rows, and build a
 * deterministic department→positions tree from a column mapping. Also normalizes
 * an LLM-produced tree into the exact shape the Chart page/model expects.
 *
 * Node shape (matches frontend orgStructure):
 *   department = { id, name, positions: [node] }
 *   node       = { id, name (person), position (title), subordinates: [node] }
 */

import * as XLSX from 'xlsx';

export interface OrgImportNode {
    id: string;
    name: string;
    position: string;
    subordinates: OrgImportNode[];
}

export interface OrgImportDept {
    id: string;
    name: string;
    positions: OrgImportNode[];
}

export interface ColumnMapping {
    department?: string;
    name: string;
    title?: string;
    manager?: string;
}

/** Safety caps so a huge/malicious file can't blow up the chart. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_TREE_DEPTH = 12;

let _idCounter = 0;
function genId(prefix = 'imp'): string {
    _idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function norm(s: unknown): string {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Read the first sheet of an xlsx/csv buffer into ordered headers + object rows. */
export function parseSpreadsheet(buffer: Buffer): {
    headers: string[];
    rows: Record<string, string>[];
} {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { headers: [], rows: [] };
    const sheet = wb.Sheets[sheetName];

    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false });
    const headers = (aoa[0] || []).map((h) => String(h ?? '').trim()).filter(Boolean);

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
    });
    const rows = rawRows.slice(0, MAX_IMPORT_ROWS).map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) out[String(k).trim()] = String(v ?? '').trim();
        return out;
    });
    return { headers, rows };
}

/**
 * Deterministic tree build from tabular rows + a column mapping.
 * Reporting lines come from the Manager column (matched by name within the same
 * department); people whose manager is missing/unmatched become department roots.
 */
export function buildTreeFromRows(
    rows: Record<string, string>[],
    mapping: ColumnMapping,
): OrgImportDept[] {
    const nameCol = mapping.name;
    if (!nameCol) return [];

    const byDept = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
        const person = (row[nameCol] || '').trim();
        if (!person) continue; // skip rows without a person
        const deptName = (mapping.department ? row[mapping.department] : '').trim() || 'General';
        if (!byDept.has(deptName)) byDept.set(deptName, []);
        byDept.get(deptName)!.push(row);
    }

    const departments: OrgImportDept[] = [];
    for (const [deptName, deptRows] of byDept) {
        const nodes: OrgImportNode[] = [];
        const indexByName = new Map<string, OrgImportNode>();
        const managerOf = new Map<OrgImportNode, string>();

        for (const row of deptRows) {
            const node: OrgImportNode = {
                id: genId(),
                name: (row[nameCol] || '').trim(),
                position: (mapping.title ? row[mapping.title] : '').trim(),
                subordinates: [],
            };
            nodes.push(node);
            const key = norm(node.name);
            if (key && !indexByName.has(key)) indexByName.set(key, node);
            if (mapping.manager) managerOf.set(node, norm(row[mapping.manager]));
        }

        // Attach children to managers (same department), with a cycle guard.
        const roots: OrgImportNode[] = [];
        const isAncestor = (candidate: OrgImportNode, of: OrgImportNode): boolean => {
            // Does `candidate` already appear beneath `of`? (prevents cycles)
            const stack = [...of.subordinates];
            while (stack.length) {
                const n = stack.pop()!;
                if (n === candidate) return true;
                stack.push(...n.subordinates);
            }
            return false;
        };
        for (const node of nodes) {
            const mgrName = managerOf.get(node) || '';
            const mgr = mgrName ? indexByName.get(mgrName) : undefined;
            if (mgr && mgr !== node && !isAncestor(node, mgr)) {
                mgr.subordinates.push(node);
            } else {
                roots.push(node);
            }
        }

        departments.push({ id: genId('dept'), name: deptName, positions: roots });
    }
    return departments;
}

/** Coerce an untrusted (LLM) tree into the strict OrgImportDept[] shape. */
export function normalizeImportedTree(raw: unknown): OrgImportDept[] {
    const rawDepts = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { departments?: unknown[] })?.departments)
          ? (raw as { departments: unknown[] }).departments
          : [];

    const normNode = (n: unknown, depth: number): OrgImportNode | null => {
        if (!n || typeof n !== 'object') return null;
        const o = n as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        const position =
            typeof o.position === 'string'
                ? o.position.trim()
                : typeof o.title === 'string'
                  ? (o.title as string).trim()
                  : '';
        if (!name && !position) return null;
        const kids =
            depth < MAX_TREE_DEPTH && Array.isArray(o.subordinates)
                ? o.subordinates.map((k) => normNode(k, depth + 1)).filter((x): x is OrgImportNode => !!x)
                : [];
        return { id: genId(), name, position, subordinates: kids };
    };

    const out: OrgImportDept[] = [];
    for (const d of rawDepts) {
        if (!d || typeof d !== 'object') continue;
        const o = d as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) continue;
        const positions = Array.isArray(o.positions)
            ? o.positions.map((p) => normNode(p, 0)).filter((x): x is OrgImportNode => !!x)
            : [];
        out.push({ id: genId('dept'), name, positions });
    }
    return out;
}
