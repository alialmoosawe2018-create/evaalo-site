/**
 * headhunter-recorded-successors-test
 *
 * The Head Hunter patch tests accept a later patch's code as "still live" only
 * through headhunter-recorded-successors.ts. That helper must accept a published
 * patch whose archived base held exactly the code it replaced - and nothing else.
 * Checked here on synthetic patch records in a temporary directory (no real data).
 *
 * Run: npm run test:headhunter-recorded-successors
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    liveCarriesOrRecordedSuccessor, recordedPublishesAfter, recordedSuccessors, removedByRecordedPublish, structureSha256, withRecordedPublishesAfter,
} from './headhunter-recorded-successors.js';
import { applyPatch, type Wf } from './lib/headhunterWorkflowEngine.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const WF_ID = 'GlhDGC23n5tT6jVv';
const NODE = 'Expand Phase 2 Queries';

function main(): void {
    console.log('='.repeat(80));
    console.log('Head Hunter — recorded-successor chain (synthetic)');
    console.log('='.repeat(80));
    const dir = mkdtempSync(join(tmpdir(), 'hh-successors-'));
    try {
        mkdirSync(join(dir, 'pending'));
        mkdirSync(join(dir, 'archive'));
        // Every archive also holds a second node with the SAME code, so a successor matched on the wrong node shows.
        const archive = (name: string, code: string) =>
            writeFileSync(join(dir, 'archive', name), JSON.stringify({ nodes: [
                { name: 'Filter New URLs', parameters: { jsCode: code } },
                { name: NODE, parameters: { jsCode: code } },
            ] }));
        const patch = (name: string, base: string, code: string, extra: Record<string, unknown> = {}) => {
            writeFileSync(join(dir, 'pending', `${name}.node.js`), code);
            writeFileSync(join(dir, 'pending', `${name}.patch.json`), JSON.stringify({
                workflowId: WF_ID, publishedVersionId: `v-${name}`, baseFile: `archive/${base}`,
                parameterEdits: [{ node: NODE, path: 'parameters.jsCode', replaceWholeValueFromFile: `${name}.node.js` }],
                ...extra,
            }));
        };
        archive('a0.json', 'v0');
        archive('a1.json', 'v1');
        archive('ax.json', 'vX');
        archive('a2.json', 'v2');
        patch('p1', 'a0.json', 'v1');                                      // v0 -> v1
        patch('p2', 'a1.json', 'v2');                                      // v1 -> v2
        patch('p2alt', 'a1.json', 'v2alt');                                // v1 -> v2alt (a rolled-back branch)
        patch('forged', 'ax.json', 'forged');                              // claims to replace vX, never live
        patch('unpublished', 'a1.json', 'v2b', { publishedVersionId: undefined });
        patch('other', 'a1.json', 'v2c', { workflowId: 'another' });
        patch('loop', 'a2.json', 'v0');                                    // v2 -> v0 (cycle must terminate)
        patch('wrongnode', 'a1.json', 'vN', { parameterEdits: [{ node: 'Filter New URLs', path: 'parameters.jsCode', replaceWholeValueFromFile: 'wrongnode.node.js' }] });
        patch('wrongpath', 'a1.json', 'vP', { parameterEdits: [{ node: NODE, path: 'parameters.options', replaceWholeValueFromFile: 'wrongpath.node.js' }] });
        patch('notarchive', 'a1.json', 'vA', { baseFile: 'a1.json' }); // exists (written below), just not under archive/
        writeFileSync(join(dir, 'a1.json'), JSON.stringify({ nodes: [{ name: NODE, parameters: { jsCode: 'v1' } }] }));
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        patch('hashed', 'a1.json', 'vH', { parameterEdits: [{ node: NODE, path: 'parameters.jsCode', replaceWholeValueFromFile: 'hashed.node.js', publishedSha256: sha('vH') }] });
        patch('edited', 'a1.json', 'vE-edited-after-publish', { parameterEdits: [{ node: NODE, path: 'parameters.jsCode', replaceWholeValueFromFile: 'edited.node.js', publishedSha256: sha('vE') }] });

        const live = (from: string, liveCode: string) => liveCarriesOrRecordedSuccessor(dir, NODE, from, liveCode);
        check('live carries the code itself', live('v0', 'v0').ok);
        check('one recorded hop is accepted (v0 -> v1)', live('v0', 'v1').ok);
        check('two recorded hops are accepted (v0 -> v1 -> v2)', live('v0', 'v2').ok);
        check('a branch from the same base is accepted (v0 -> v1 -> v2alt)', live('v0', 'v2alt').ok);
        check('🔴 a published patch whose base did NOT hold the code is rejected', !live('v0', 'forged').ok);
        check('an unpublished patch is not a successor', !live('v0', 'v2b').ok);
        check("another workflow's patch is not a successor", !live('v0', 'v2c').ok);
        check('no going backwards (from v2alt, which nothing replaced, live v1 is rejected)', !live('v2alt', 'v1').ok);
        check('a code nobody recorded is rejected', !live('v0', 'v9').ok);
        check('a patch that replaced a DIFFERENT node is not a successor', !live('v0', 'vN').ok);
        check('a patch that edited a non-jsCode path is not a successor', !live('v0', 'vP').ok);
        check('a base outside archive/ is not trusted', !live('v0', 'vA').ok);
        check('a hop whose file still hashes to its recorded publishedSha256 is accepted', live('v0', 'vH').ok);
        check('🔴 a hop whose file was edited after publishing (hash mismatch) is rejected', !live('v0', 'vE-edited-after-publish').ok);
        const chain = recordedSuccessors(dir, NODE, 'v0').map((s) => s.patch).sort();
        check('a cycle terminates and every hop is listed once',
            JSON.stringify(chain) === JSON.stringify(['hashed.patch.json', 'loop.patch.json', 'p1.patch.json', 'p2.patch.json', 'p2alt.patch.json']), chain.join(','));
        check("on the other node only that node's patch is followed",
            JSON.stringify(recordedSuccessors(dir, 'Filter New URLs', 'v1').map((s) => s.patch)) === JSON.stringify(['wrongnode.patch.json']));
        writeFileSync(join(dir, 'pending', 'broken.patch.json'), '{ "workflowId": ');
        let named = '';
        try { recordedSuccessors(dir, NODE, 'v0'); } catch (e) { named = (e as Error).message; }
        check('an unreadable patch record fails loudly and names the file', named.includes('broken.patch.json'), named.slice(0, 120));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    publishChain();
    console.log('\n' + '='.repeat(80));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

/**
 * The whole-graph chain (withRecordedPublishesAfter / removedByRecordedPublish): a test that published version
 * vN accepts live/ only as its own rebuild carried through the RECORDED publishes after vN, in order.
 */
function publishChain(): void {
    console.log('\nPUBLISH CHAIN — the whole graph carried through the recorded publishes');
    const dir = mkdtempSync(join(tmpdir(), 'hh-chain-'));
    try {
        mkdirSync(join(dir, 'pending'));
        mkdirSync(join(dir, 'archive'));
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        const rec = (name: string, body: Record<string, unknown>, files: Record<string, string> = {}, archived = true) => {
            for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, 'pending', f), c);
            if (archived) writeFileSync(join(dir, 'archive', `${name}-base.json`), '{}');
            const record: Record<string, unknown> = { workflowId: WF_ID, baseFile: `archive/${name}-base.json`, ...body };
            if (record.pinStructure) { delete record.pinStructure; record.publishedStructureSha256 = structureSha256(record); }
            writeFileSync(join(dir, 'pending', `${name}.patch.json`), JSON.stringify(record));
        };
        // v0 -> v1: replace A's code.  v1 -> v2: add N (between A and B), remove R (and its connections).
        rec('c1', { baseVersionId: 'v0', publishedVersionId: 'v1', parameterEdits: [{ node: 'A', path: 'parameters.jsCode', replaceWholeValueFromFile: 'c1.js', publishedSha256: sha('a1') }] }, { 'c1.js': 'a1' });
        rec('c2', {
            baseVersionId: 'v1', publishedVersionId: 'v2', pinStructure: true,
            addNodes: [{ name: 'N', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [10, 0], parameters: {} }],
            removeNodes: ['R'],
            connections: { remove: [['A', 0, 'R', 0]], add: [['A', 0, 'N', 0], ['N', 1, 'B', 0]] },
        });
        rec('unpub', { baseVersionId: 'v2', removeNodes: ['B'] });                                        // never published
        rec('elsewhere', { workflowId: 'another', baseVersionId: 'v2', publishedVersionId: 'v3x', removeNodes: ['B'] });
        rec('edited', { baseVersionId: 'v2', publishedVersionId: 'v3', parameterEdits: [{ node: 'A', path: 'parameters.jsCode', replaceWholeValueFromFile: 'edited.js', publishedSha256: sha('a3') }] }, { 'edited.js': 'a3-changed-after-publish' });
        const base: Wf = {
            versionId: 'v0',
            nodes: [{ name: 'A', parameters: { jsCode: 'a0' } }, { name: 'R', parameters: {} }, { name: 'B', parameters: {} }],
            connections: { A: { main: [[{ node: 'R', type: 'main', index: 0 }]] }, R: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
        };
        const chain = recordedPublishesAfter(dir, 'v0').map((c) => c.file);
        check('the chain follows base -> published in order, skipping unpublished records and other workflows', JSON.stringify(chain) === JSON.stringify(['c1.patch.json', 'c2.patch.json']), chain.join(','));
        check('🔴 it stops at a record whose file no longer hashes to what was published', !chain.includes('edited.patch.json'));
        const carried = withRecordedPublishesAfter(dir, 'v0', base);
        const names = carried.wf.nodes.map((n) => n.name).sort().join(',');
        check('the carried graph: A has the published code, N added, R removed', names === 'A,B,N' && carried.wf.nodes.find((n) => n.name === 'A')?.parameters.jsCode === 'a1', names);
        const edges = Object.entries(carried.wf.connections).flatMap(([f, v]: [string, any]) => (v.main || []).flatMap((arr: any[], o: number) => (arr || []).map((x) => `${f}[${o}]->${x.node}`))).sort().join(' ');
        check("the removed node's connections go with it; the record's connections are added", edges === 'A[0]->N N[1]->B', edges);
        check('it names the nodes later records added (their ids are n8n\'s)', [...carried.added].join() === 'N');
        check('from a version nothing followed, the chain is empty and the graph unchanged', recordedPublishesAfter(dir, 'v9').length === 0 && withRecordedPublishesAfter(dir, 'v9', base).wf === base);
        check('removedByRecordedPublish names the record after the given version that removed a node', removedByRecordedPublish(dir, 'R', 'v0') === 'c2.patch.json');
        check('…not one from before that version', removedByRecordedPublish(dir, 'R', 'v2') === null);
        check('…and does not count an unpublished or another workflow\'s removal', removedByRecordedPublish(dir, 'B', 'v0') === null);
        // c2's graph section was pinned at publish: editing it afterwards (here, a moved node) breaks the chain there.
        const c2 = JSON.parse(readFileSync(join(dir, 'pending', 'c2.patch.json'), 'utf8'));
        writeFileSync(join(dir, 'pending', 'c2.patch.json'), JSON.stringify({ ...c2, addNodes: [{ ...c2.addNodes[0], position: [10, -400] }] }));
        check('🔴 a record whose graph section was edited after publishing ends the chain (publishedStructureSha256)', JSON.stringify(recordedPublishesAfter(dir, 'v0').map((c) => c.file)) === JSON.stringify(['c1.patch.json']));
        check('…and its removal no longer counts', removedByRecordedPublish(dir, 'R', 'v0') === null);
        writeFileSync(join(dir, 'pending', 'c2.patch.json'), JSON.stringify(c2));
        rmSync(join(dir, 'archive', 'c1-base.json'));
        check('🔴 a record whose archived base is missing ends the chain', recordedPublishesAfter(dir, 'v0').length === 0);
        writeFileSync(join(dir, 'archive', 'c1-base.json'), '{}');
        let unmodelled = '';
        try { applyPatch(base, { parameterReplace: [] }, join(dir, 'pending')); } catch (e) { unmodelled = (e as Error).message; }
        check('a record shape applyPatch does not model fails loudly instead of being skipped', unmodelled.includes('parameterReplace'), unmodelled);
        rec('fork', { baseVersionId: 'v1', publishedVersionId: 'v2b' });
        let named = '';
        try { recordedPublishesAfter(dir, 'v0'); } catch (e) { named = (e as Error).message; }
        check('two records published from the same version fail loudly and name both', named.includes('c2.patch.json') && named.includes('fork.patch.json'), named.slice(0, 120));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

main();
