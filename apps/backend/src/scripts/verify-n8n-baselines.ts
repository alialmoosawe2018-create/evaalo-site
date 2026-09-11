/**
 * Checks the n8n baselines in docs/n8n-workflows/live — their own integrity,
 * and optionally whether they still match the live workflows.
 *
 * ⚠️ THE NORMALIZATION IS THE WHOLE POINT, and it is measured, not assumed.
 *
 * A naive `sha256(JSON.stringify(nodes))` comparison reports SEVEN of the nine
 * baselines as drifted when in fact all nine are identical (checked
 * 2026-09-11 against the live SQLite). Three things differ for reasons that
 * carry no meaning:
 *
 *   - `credentials` — stripped from the baselines on purpose when they were
 *     exported and secret-scanned. Live workflows carry it.
 *   - `position`    — canvas coordinates; moving a node with the mouse is not
 *     a change to the workflow.
 *   - `id`          — regenerated per node.
 *
 * Key order inside nested objects differs too, so keys are deep-sorted and
 * nodes are sorted by name before hashing. With that, all nine matched exactly.
 *
 * A checker that cries wolf on its first run is worse than no checker: it gets
 * ignored, and then the one real drift is ignored with it.
 *
 * Usage:
 *   npm run verify:n8n-baselines                 # integrity of the files themselves
 *   npm run verify:n8n-baselines -- --live <dir> # also compare against live exports
 *
 * The --live directory holds JSON exports of the live workflows (same shape:
 * an object with `id` and `nodes`). There is no n8n API key in this backend's
 * environment, so the live side cannot be fetched automatically — exporting it
 * stays a deliberate act, and this script is what makes the comparison exact.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, '../../docs/n8n-workflows/live');

/** Fields that differ between an export and the live row without meaning anything. */
const VOLATILE_NODE_FIELDS = ['position', 'id', 'credentials'] as const;

type Json = unknown;

function deepSortKeys(value: Json): Json {
    if (Array.isArray(value)) return value.map(deepSortKeys);
    if (value && typeof value === 'object') {
        const out: Record<string, Json> = {};
        for (const key of Object.keys(value as Record<string, Json>).sort()) {
            out[key] = deepSortKeys((value as Record<string, Json>)[key]);
        }
        return out;
    }
    return value;
}

export function fingerprintNodes(nodes: Array<Record<string, Json>>): string {
    const cleaned = (nodes || [])
        .map((node) => {
            const copy: Record<string, Json> = { ...node };
            for (const field of VOLATILE_NODE_FIELDS) delete copy[field];
            return copy;
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return createHash('sha256').update(JSON.stringify(deepSortKeys(cleaned))).digest('hex').slice(0, 16);
}

/**
 * Things that must never appear in a committed baseline. These files are in the
 * repository, so a leaked key here is a leaked key everywhere.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
    { name: 'openai key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
    { name: 'mongodb uri with credentials', re: /mongodb(\+srv)?:\/\/[^/\s"]*:[^@\s"]*@/ },
    { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
    { name: 'aws key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

interface Baseline {
    file: string;
    id: string;
    name: string;
    nodeCount: number;
    fingerprint: string;
    problems: string[];
}

function loadBaselines(): Baseline[] {
    if (!existsSync(BASELINE_DIR)) {
        console.error(`baseline directory not found: ${BASELINE_DIR}`);
        process.exit(1);
    }
    const files = readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.json')).sort();
    return files.map((file) => {
        const problems: string[] = [];
        const raw = readFileSync(join(BASELINE_DIR, file), 'utf8');
        let doc: Record<string, Json>;
        try {
            doc = JSON.parse(raw) as Record<string, Json>;
        } catch (err) {
            return { file, id: '?', name: '?', nodeCount: 0, fingerprint: '-', problems: [`unparseable: ${(err as Error).message}`] };
        }
        const nodes = (doc.nodes as Array<Record<string, Json>>) || [];
        if (!doc.id) problems.push('no id');
        if (!nodes.length) problems.push('no nodes');
        if (!doc.connections) problems.push('no connections');
        for (const { name, re } of SECRET_PATTERNS) if (re.test(raw)) problems.push(`SECRET-LIKE: ${name}`);
        // The export strips credentials deliberately; a baseline carrying one
        // means the export path changed and may now be committing more than it should.
        if (nodes.some((n) => 'credentials' in n)) problems.push('carries a credentials block (export should strip it)');
        return {
            file,
            id: String(doc.id),
            name: String(doc.name ?? ''),
            nodeCount: nodes.length,
            fingerprint: fingerprintNodes(nodes),
            problems,
        };
    });
}

function loadLive(dir: string): Map<string, { fingerprint: string; nodes: Array<Record<string, Json>> }> {
    const out = new Map<string, { fingerprint: string; nodes: Array<Record<string, Json>> }>();
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        console.error(`--live path is not a directory: ${dir}`);
        process.exit(1);
    }
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        try {
            const doc = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, Json>;
            const nodes = ((doc.nodes as Array<Record<string, Json>>) || (doc as unknown as Array<Record<string, Json>>)) as Array<Record<string, Json>>;
            const id = String(doc.id ?? file.replace(/\.json$/, ''));
            out.set(id, { fingerprint: fingerprintNodes(nodes), nodes });
        } catch (err) {
            console.error(`  could not read live export ${file}: ${(err as Error).message}`);
        }
    }
    return out;
}

function main(): void {
    const argv = process.argv.slice(2);
    const liveIdx = argv.indexOf('--live');
    const liveDir = liveIdx >= 0 ? argv[liveIdx + 1] : undefined;

    const baselines = loadBaselines();
    console.log(`baselines in docs/n8n-workflows/live: ${baselines.length}\n`);

    let bad = 0;
    for (const b of baselines) {
        const flag = b.problems.length ? 'PROBLEM' : 'ok     ';
        console.log(`${flag} ${b.fingerprint}  ${String(b.nodeCount).padStart(2)} nodes  ${b.id.padEnd(38)} ${b.file}`);
        for (const p of b.problems) {
            bad += 1;
            console.log(`        -> ${p}`);
        }
    }

    if (liveDir) {
        const live = loadLive(liveDir);
        console.log(`\ncomparing against live exports in ${liveDir} (${live.size} file(s))\n`);
        for (const b of baselines) {
            const l = live.get(b.id);
            if (!l) {
                console.log(`MISSING  ${b.id.padEnd(38)} no live export supplied — not compared`);
                continue;
            }
            if (l.fingerprint === b.fingerprint) {
                console.log(`match    ${b.id.padEnd(38)} ${b.fingerprint}`);
                continue;
            }
            bad += 1;
            console.log(`DRIFT    ${b.id.padEnd(38)} baseline ${b.fingerprint} != live ${l.fingerprint}`);
            // Say WHICH node, so the next reader does not have to diff 70KB by eye.
            const baseNodes = (JSON.parse(readFileSync(join(BASELINE_DIR, b.file), 'utf8')).nodes || []) as Array<Record<string, Json>>;
            const byName = (arr: Array<Record<string, Json>>) => new Map(arr.map((n) => [String(n.name), fingerprintNodes([n])]));
            const a = byName(baseNodes);
            const c = byName(l.nodes);
            for (const [name, h] of a) {
                if (!c.has(name)) console.log(`        -> node only in the baseline: ${name}`);
                else if (c.get(name) !== h) console.log(`        -> node differs: ${name}`);
            }
            for (const name of c.keys()) if (!a.has(name)) console.log(`        -> node only in live: ${name}`);
        }
    } else {
        console.log('\n(no --live directory given, so only the baseline files themselves were checked)');
    }

    if (bad) {
        console.error(`\n${bad} problem(s) found.`);
        process.exit(1);
    }
    console.log('\nclean.');
}

main();
