/**
 * headhunter-recorded-successors — shared by the Head Hunter patch tests.
 *
 * A published patch test checks that its code is STILL live. Once a later patch
 * replaces the same node, that check must accept the successor - but only a
 * RECORDED one: a patch in pending/ that was published (publishedVersionId set),
 * whose archived base (under archive/) held exactly the code being replaced, and -
 * when the record carries it - whose replacement file still hashes to the
 * publishedSha256 recorded at publish time. Following that chain
 * (page2-off -> page2-off-tier40 -> enrich-cap-phase2 ...) means an old test no
 * longer needs editing every time the node changes again, while any change that
 * did not go through a recorded patch still fails.
 *
 * "live" here is the repo's live/ snapshot, refreshed from production after each
 * publish - not production itself.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPatch, type Wf } from './lib/headhunterWorkflowEngine.js';

type Edit = { node: string; path?: string; replaceWholeValueFromFile?: string; publishedSha256?: string };
type Patch = {
    workflowId?: string; baseVersionId?: string; publishedVersionId?: string; baseFile?: string; parameterEdits?: Edit[];
    addNodes?: { name: string }[]; removeNodes?: string[]; connections?: unknown; parameterSets?: unknown[];
    publishedStructureSha256?: string;
};

const HEADHUNTER_WORKFLOW_ID = 'GlhDGC23n5tT6jVv';

function readJson<T>(file: string): T {
    let text: string;
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        throw new Error(`recorded-successors: cannot read ${file}: ${(e as Error).message}`);
    }
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        throw new Error(`recorded-successors: ${file} is not valid JSON: ${(e as Error).message}`);
    }
}

/**
 * Every published replacement reachable from `code` in `node`: each hop is a published patch whose
 * archived base held exactly the code of the hop before. All branches are followed (a publish that was
 * rolled back and replaced by another leaves two patches with the same base).
 */
export function recordedSuccessors(wfDir: string, node: string, code: string): { patch: string; code: string }[] {
    const pending = join(wfDir, 'pending');
    const patches = readdirSync(pending)
        .filter((f) => f.endsWith('.patch.json'))
        .map((f) => ({ f, p: readJson<Patch>(join(pending, f)) }))
        .filter(({ p }) => p.workflowId === HEADHUNTER_WORKFLOW_ID && Boolean(p.publishedVersionId)
            && typeof p.baseFile === 'string' && p.baseFile.startsWith('archive/'))
        .map(({ f, p }) => {
            const e = (p.parameterEdits ?? []).find((x) => x.node === node);
            if (!e || !e.replaceWholeValueFromFile || e.path !== 'parameters.jsCode') return null;
            const base = readJson<{ nodes: { name: string; parameters?: { jsCode?: unknown } }[] }>(join(wfDir, String(p.baseFile)));
            const before = base.nodes.find((n) => n.name === node)?.parameters?.jsCode;
            if (typeof before !== 'string') return null;
            const after = readFileSync(join(pending, e.replaceWholeValueFromFile), 'utf8');
            // A recorded hash pins the hop to what was published: a replacement file edited afterwards is no successor.
            if (e.publishedSha256 && createHash('sha256').update(after, 'utf8').digest('hex') !== e.publishedSha256) return null;
            return { patch: f, before, code: after };
        })
        .filter((x): x is { patch: string; before: string; code: string } => x !== null);
    const found: { patch: string; code: string }[] = [];
    const used = new Set<string>();
    const walk = (current: string) => {
        for (const x of patches) {
            if (used.has(x.patch) || x.before !== current) continue;
            used.add(x.patch);
            found.push({ patch: x.patch, code: x.code });
            walk(x.code);
        }
    };
    walk(code);
    return found;
}

/** True when live carries `code` itself or one of its recorded successors, byte for byte. */
export function liveCarriesOrRecordedSuccessor(wfDir: string, node: string, code: string, liveCode: string): { ok: boolean; via: string } {
    if (liveCode === code) return { ok: true, via: 'this code' };
    const hit = recordedSuccessors(wfDir, node, code).find((s) => s.code === liveCode);
    return hit ? { ok: true, via: hit.patch } : { ok: false, via: 'neither this code nor a recorded successor' };
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.keys(v).sort().reduce((a: Record<string, unknown>, k) => { a[k] = v[k]; return a; }, {}) : v);

/**
 * sha256 of what a record does to the graph besides its replacement files: the nodes it adds and removes,
 * its connections and its parameter sets. Recorded at publish as publishedStructureSha256, so an edit to
 * that part of a published record is caught the way publishedSha256 catches an edited replacement file.
 */
export function structureSha256(patch: Patch): string {
    return sha256(canon({ addNodes: patch.addNodes ?? [], removeNodes: patch.removeNodes ?? [], connections: patch.connections ?? {}, parameterSets: patch.parameterSets ?? [] }));
}

/** The recorded publishes of this workflow: a publishedVersionId and an archived base. */
function publishedRecords(wfDir: string): { file: string; patch: Patch }[] {
    const pending = join(wfDir, 'pending');
    return readdirSync(pending)
        .filter((f) => f.endsWith('.patch.json'))
        .map((f) => ({ file: f, patch: readJson<Patch>(join(pending, f)) }))
        .filter(({ patch: p }) => p.workflowId === HEADHUNTER_WORKFLOW_ID && Boolean(p.publishedVersionId)
            && typeof p.baseFile === 'string' && p.baseFile.startsWith('archive/'));
}

/**
 * The recorded publishes that came AFTER version `fromVersionId`, in publish order: each one's base is the
 * previous one's published version. The chain stops at a record that is no longer what was published - a
 * replacement file or its graph section no longer hashes to what was recorded, or its archived base is
 * missing - so a comparison against live/ then fails.
 * Two records published from the same version (a rollback replaced by another) is an error: say which.
 */
export function recordedPublishesAfter(wfDir: string, fromVersionId: string): { file: string; patch: Patch }[] {
    const all = publishedRecords(wfDir);
    const chain: { file: string; patch: Patch }[] = [];
    let at = fromVersionId;
    for (;;) {
        const next = all.filter((r) => r.patch.baseVersionId === at);
        if (next.length === 0) return chain;
        if (next.length > 1) throw new Error(`recorded-successors: ${next.length} published records start from ${at}: ${next.map((n) => n.file).join(', ')}`);
        const r = next[0];
        const intact = (r.patch.parameterEdits ?? []).every((e) => !e.replaceWholeValueFromFile || !e.publishedSha256
            || sha256(readFileSync(join(wfDir, 'pending', e.replaceWholeValueFromFile), 'utf8')) === e.publishedSha256)
            && (!r.patch.publishedStructureSha256 || structureSha256(r.patch) === r.patch.publishedStructureSha256)
            && existsSync(join(wfDir, String(r.patch.baseFile)));
        if (!intact) return chain;
        chain.push(r);
        at = String(r.patch.publishedVersionId);
        if (chain.length > 100) throw new Error('recorded-successors: the publish chain loops');
    }
}

/**
 * `wf` — the graph a record published as `fromVersionId` — carried forward through every recorded publish
 * after it. live/ must equal this: a later change that did not go through a recorded patch still fails.
 * `added` names the nodes those later records added (n8n generates their ids).
 */
export function withRecordedPublishesAfter(wfDir: string, fromVersionId: string, wf: Wf): { wf: Wf; via: string[]; added: Set<string> } {
    let current = wf;
    const added = new Set<string>();
    const chain = recordedPublishesAfter(wfDir, fromVersionId);
    for (const r of chain) {
        current = applyPatch(current, r.patch, join(wfDir, 'pending'));
        for (const a of r.patch.addNodes ?? []) added.add(a.name);
    }
    return { wf: current, via: chain.map((c) => c.file), added };
}

/** The recorded publish AFTER `fromVersionId` (in its intact chain) that removed `nodeName`, or null. */
export function removedByRecordedPublish(wfDir: string, nodeName: string, fromVersionId: string): string | null {
    return recordedPublishesAfter(wfDir, fromVersionId).find((r) => (r.patch.removeNodes ?? []).includes(nodeName))?.file ?? null;
}
