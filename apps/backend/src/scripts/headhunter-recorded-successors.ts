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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Edit = { node: string; path?: string; replaceWholeValueFromFile?: string; publishedSha256?: string };
type Patch = { workflowId?: string; publishedVersionId?: string; baseFile?: string; parameterEdits?: Edit[] };

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
