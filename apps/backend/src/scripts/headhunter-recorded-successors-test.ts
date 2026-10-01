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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveCarriesOrRecordedSuccessor, recordedSuccessors } from './headhunter-recorded-successors.js';

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
    console.log('\n' + '='.repeat(80));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
