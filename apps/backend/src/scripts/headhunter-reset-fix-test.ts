/**
 * Head Hunter — Split In Batches `reset` patch test (offline: no n8n, no network).
 *
 * Rebuilds the patched workflow in memory from
 *   docs/n8n-workflows/live/headhunter--AI_Head_hunter.json  (live baseline, 44 nodes)
 * + docs/n8n-workflows/pending/headhunter-splitinbatches-reset.patch.json
 *
 * This asserts the patch is well-formed, lands where it should, and that rebuilding
 * archive + patch reproduces the PUBLISHED workflow by fingerprint. It deliberately does
 * NOT simulate splitInBatches: that node is built-in and stateful, so an offline model
 * would only test my assumptions. The behaviour was proven against real n8n in the repro
 * workflow U34sixGqSibf6xeJ (execs 2018–2023) — see `_provenIn` in the patch file.
 *
 * Run: npm run test:headhunter-reset-fix
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');

interface N8nNode { id: string; name: string; type: string; typeVersion: number; parameters?: Record<string, unknown> }
interface Wf { versionId: string; nodes: N8nNode[]; connections: Record<string, { main: { node: string }[][] }> }

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  PASS  ${name}`); return; }
    failures++;
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys.slice(0, -1)) {
        if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
}

function main(): void {
    console.log('='.repeat(92));
    console.log('Split In Batches `reset` — offline patch test');
    console.log('='.repeat(92));

    const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-splitinbatches-reset.patch.json'), 'utf8'));
    // Base is the ARCHIVED pre-fix version; live/ now holds the published result.
    const wf: Wf = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    // What THIS patch published was 191c06f9. `live/` has since moved on (the completion
    // guard shipped on top), so the fingerprint is checked against the archived snapshot
    // of the version this patch actually produced — not against today's live.
    const published: Wf = JSON.parse(readFileSync(join(WF_DIR, 'archive', 'headhunter--AI_Head_hunter--191c06f9-before-completion-guard.json'), 'utf8'));
    const liveNow: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));

    console.log('\nBASE');
    check('patch targets the archived pre-fix version', wf.versionId === patch.baseVersionId, `${wf.versionId} vs ${patch.baseVersionId}`);
    check('archived base node count matches the patch', wf.nodes.length === patch.baseNodeCount, `${wf.nodes.length} vs ${patch.baseNodeCount}`);
    check('the version this patch published is archived', published.versionId === patch.publishedVersionId, `${published.versionId} vs ${patch.publishedVersionId}`);
    check('and the reset fix is STILL live today, on top of later changes',
        JSON.stringify(liveNow.nodes.find((n) => n.name === 'Split In Batches')?.parameters?.options) === '{"reset":"={{ $json.batchDone !== true }}"}',
        JSON.stringify(liveNow.nodes.find((n) => n.name === 'Split In Batches')?.parameters?.options));

    console.log('\nTARGET NODE');
    const targets = wf.nodes.filter((n) => n.name === patch.parameterSets[0].node);
    check('exactly one node named "Split In Batches"', targets.length === 1, `found ${targets.length}`);
    const sib = targets[0];
    check('it is splitInBatches v3', sib.type === 'n8n-nodes-base.splitInBatches' && sib.typeVersion === 3, `${sib.type} v${sib.typeVersion}`);
    check('batchSize is the live expression (not hardcoded by us)',
        String(sib.parameters?.batchSize).includes("Resolve Search Tier") && String(sib.parameters?.batchSize).includes('streamBatchSize'),
        String(sib.parameters?.batchSize));

    console.log('\nWIRING the fix depends on');
    const feeders = Object.entries(wf.connections)
        .filter(([, c]) => (c.main || []).flat().some((t) => t && t.node === 'Split In Batches'))
        .map(([from]) => from).sort();
    check('fed by exactly Limit Candidates + Stream Batch Done',
        feeders.length === 2 && feeders[0] === 'Limit Candidates' && feeders[1] === 'Stream Batch Done', feeders.join(', '));
    const sibOut = wf.connections['Split In Batches'].main;
    check('branch 0 (done) -> Is Phase 2?', sibOut[0]?.[0]?.node === 'Is Phase 2?', sibOut[0]?.[0]?.node);
    check('branch 1 (loop) -> Enrichlayer Profile Fetch', sibOut[1]?.[0]?.node === 'Enrichlayer Profile Fetch', sibOut[1]?.[0]?.node);

    // The expression reads $json.batchDone, which only exists because Stream Batch Done emits it.
    const sbd = wf.nodes.find((n) => n.name === 'Stream Batch Done');
    const sbdCode = String(sbd?.parameters?.jsCode ?? '');
    check('Stream Batch Done really emits batchDone: true (the expression depends on it)',
        /batchDone\s*:\s*true/.test(sbdCode));

    console.log('\nAPPLY');
    const edit = patch.parameterSets[0];
    const before = getPath(sib.parameters as Record<string, unknown>, edit.path);
    check(`"${edit.path}" is absent before the patch (expectBefore=${edit.expectBefore})`,
        edit.expectBefore === 'absent' ? before === undefined : before !== undefined, `before = ${JSON.stringify(before)}`);

    setPath(sib.parameters as Record<string, unknown>, edit.path, edit.set);
    const after = getPath(sib.parameters as Record<string, unknown>, edit.path);
    check('after the patch it holds the fix expression', after === '={{ $json.batchDone !== true }}', String(after));

    console.log('\nTHE TRAP');
    check('the fix is an EXPRESSION, not a constant true', typeof after === 'string' && String(after).startsWith('={{'), String(after));
    check('it is false for a loop-back item (batchDone true)', !evalReset(String(after), { batchDone: true }));
    check('it is true for a new-wave item (no batchDone)', evalReset(String(after), { link: 'https://x/in/y' }));

    console.log('\nBLAST RADIUS');
    check('the patch touches exactly one parameter', patch.parameterSets.length === 1);
    check('no node is added or removed', !('addNode' in patch) && !('connections' in patch));
    const otherSib = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.splitInBatches');
    check('there is only one splitInBatches in the whole workflow', otherSib.length === 1, `found ${otherSib.length}`);

    console.log('\nFINGERPRINT — archive + patch must equal what is PUBLISHED');
    const fp = (w: Wf) => ({
        nodes: JSON.stringify(w.nodes.map((n) => [n.name, n.type, n.typeVersion, n.parameters]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
        conns: JSON.stringify(Object.keys(w.connections).sort().map((k) => [k, w.connections[k]])),
    });
    const rebuilt = fp(wf);
    const live = fp(published);
    check('node fingerprint matches the version this patch published', rebuilt.nodes === live.nodes,
        rebuilt.nodes === live.nodes ? '' : 'rebuilt from archive+patch differs from the archived 191c06f9');
    check('connection fingerprint matches that version', rebuilt.conns === live.conns);
    const pubSib = published.nodes.find((n) => n.name === 'Split In Batches');
    check('that version carries the fix',
        getPath(pubSib?.parameters as Record<string, unknown>, 'options.reset') === '={{ $json.batchDone !== true }}',
        String(getPath(pubSib?.parameters as Record<string, unknown>, 'options.reset')));

    console.log('\n' + '='.repeat(92));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED — archive + patch reproduces 191c06f9, and the fix is still live today.');
    console.log('Runtime behaviour proven against real n8n: repro U34sixGqSibf6xeJ, execs 2018-2023.');
    console.log('PUBLISHED 2026-09-28 as version 191c06f9; rollback = re-publish 0a338184 (kept in archive/).');
}

/** Evaluate the n8n expression body against a fake $json, the way n8n would. */
function evalReset(expression: string, json: Record<string, unknown>): boolean {
    const body = expression.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    // eslint-disable-next-line no-new-func
    return Boolean(new Function('$json', `return (${body});`)(json));
}

main();
