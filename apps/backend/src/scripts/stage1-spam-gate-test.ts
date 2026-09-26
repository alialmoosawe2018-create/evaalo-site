/**
 * The Stage 1 anti-spam gate patch (offline: no n8n, no network, no LLM).
 * Run: npm run test:stage1-spam-gate
 *
 * Why the patch exists: once the typed form fields reach n8n (S0), the gate
 * (node "Basic LLM Chain", followed by "If" → "Reject Application", which stores
 * score 0 / Reject) rejected 3 of 28 real applicants in a replay — 15 of 140 runs,
 * against 0 of 140 with the fields empty. It labelled the job line `position:`
 * and read "0-1 years" on a "Senior" job as the applicant contradicting
 * themselves; it treated a reused cover letter as a contradiction; and its
 * "Fields clearly contradict each other" rule had no limits.
 *
 * The patch (docs/n8n-workflows/pending/stage1-spam-gate.patch.json) touches
 * that one node. This test proves it: applied to the base it names, it changes
 * nothing else — not "If", not the evaluator, not the claim guard, not the
 * scorer, not a connection, not the error workflow — and the gate keeps its
 * email rule, its reject list and its JSON-only answer format.
 *
 * Base: while the patch is unpublished the base is live/ (= fade64a7). After it
 * is published, archive fade64a7 and point BASE_FILE at the archive, as the
 * claim-guard test does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../../docs/n8n-workflows');
const BASE_FILE = path.join(DOCS, 'live/stage1-screening--Stage_1_v2.json');
const PATCH_FILE = path.join(DOCS, 'pending/stage1-spam-gate.patch.json');
const GATE = 'Basic LLM Chain';

type Json = Record<string, unknown>;
type Edit = { node: string; path: string; find: string; replace: string };

const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) as Json & { nodes: Json[] };
const patch = JSON.parse(fs.readFileSync(PATCH_FILE, 'utf8')) as { baseVersionId: string; workflowId: string; parameterEdits: Edit[] };

function getPath(obj: unknown, dotted: string): unknown {
    return dotted.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function setPath(obj: unknown, dotted: string, value: unknown): void {
    const keys = dotted.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as Record<string, unknown>;
    parent[last] = value;
}

/** base + patch, exactly as the server-side publish will apply it (each anchor must occur once). */
export function buildPatched(): Json & { nodes: Json[] } {
    const wf = JSON.parse(JSON.stringify(base)) as Json & { nodes: Json[] };
    for (const e of patch.parameterEdits) {
        const node = wf.nodes.find((n) => n.name === e.node);
        assert.ok(node, `node ${e.node} missing`);
        const current = getPath(node.parameters, e.path);
        assert.equal(typeof current, 'string', `${e.node}.${e.path} is not a string`);
        const s = current as string;
        assert.equal(s.split(e.find).length, 2, `anchor not unique or missing in ${e.node}.${e.path}: ${JSON.stringify(e.find.slice(0, 60))}`);
        setPath(node.parameters, e.path, s.replace(e.find, () => e.replace));
    }
    return wf;
}

const gateOf = (wf: Json & { nodes: Json[] }) => wf.nodes.find((n) => n.name === GATE) as Json & { parameters: Json };
const textOf = (wf: Json & { nodes: Json[] }) => String(gateOf(wf).parameters.text);
const systemOf = (wf: Json & { nodes: Json[] }) => String(getPath(gateOf(wf).parameters, 'messages.messageValues.0.message'));

function testPatchTargetsThisBase() {
    assert.equal(patch.workflowId, base.id, 'patch is for this workflow');
    assert.equal(patch.baseVersionId, base.versionId, 'patch base = the version it is applied to');
    assert.ok(patch.parameterEdits.length > 0);
    assert.ok(patch.parameterEdits.every((e) => e.node === GATE), 'every edit targets the gate node only');
}

function testNothingElseChanges() {
    const patched = buildPatched();
    assert.equal(patched.nodes.length, base.nodes.length, 'no node added or removed');
    for (const n of base.nodes) {
        const p = patched.nodes.find((x) => x.name === n.name)!;
        if (n.name === GATE) continue;
        assert.equal(JSON.stringify(p), JSON.stringify(n), `${String(n.name)} must be byte-identical`);
    }
    // Inside the gate, only text and the system message may change.
    const g0 = gateOf(base), g1 = gateOf(patched);
    const strip = (g: Json) => {
        const c = JSON.parse(JSON.stringify(g)) as Json & { parameters: Json };
        delete c.parameters.text;
        (getPath(c.parameters, 'messages.messageValues.0') as Json).message = '';
        return JSON.stringify(c);
    };
    assert.equal(strip(g1), strip(g0), 'the gate keeps its id, type, version, model wiring and options');
    assert.equal(JSON.stringify(patched.connections), JSON.stringify(base.connections), 'connections unchanged');
    assert.equal(JSON.stringify(patched.settings), JSON.stringify(base.settings), 'settings (errorWorkflow) unchanged');
    assert.equal((patched.settings as Json).errorWorkflow, 'kVGT46meJL5BUQP2', 'the failure alert stays wired');
}

function testTemplate() {
    const before = textOf(base), after = textOf(buildPatched());
    assert.ok(before.includes('cover letter:'), 'fixture sanity: the base gate saw the cover letter');
    assert.ok(!/cover letter/i.test(after), 'the gate no longer sees the cover letter (owner decision)');
    assert.ok(!after.includes('\nposition: '), 'the job line is no longer labelled as the applicant\'s position');
    assert.ok(after.includes("job selected on the form (the employer's vacancy or the applicant's own pick"), 'neutral job label');
    for (const line of ['Full_Name: ', '\nemail: ', '\nphone: ', '\nlocation: ', '\nexperience: ', '\ncurrent company: ', '\neducation: ', '\nlinkedin: ', '\nskills: ', '\nlanguages: ', '\ncertifications: ', '\navailability: ', '\nsalary: ']) {
        assert.ok(after.includes(line), `field line kept: ${JSON.stringify(line)}`);
    }
    assert.ok(after.startsWith('='), 'still an n8n expression');
    assert.equal((after.match(/\{\{/g) || []).length, (after.match(/\}\}/g) || []).length, 'expression braces balanced');
    assert.equal((after.match(/\{\{/g) || []).length, (before.match(/\{\{/g) || []).length - 1, 'exactly one expression removed (the cover letter)');
}

function testSystemMessage() {
    const before = systemOf(base), after = systemOf(buildPatched());
    // Kept, byte for byte.
    for (const kept of [
        'You are a strict anti-spam validator for job applications.',
        'The email address is NOT yours to judge.',
        'NEVER return valid:false because of the email, and never mention the email address in your reason.',
        'REJECT (valid: false) if ANY apply:',
        '- Name is gibberish, keyboard mash, or not a real person name',
        '- Phone is fake, too short, or all same digits',
        '- Content looks automated, bot-generated, or test data (asdf, 123456, test test)',
        'Return JSON only: {"valid": boolean, "reason": "short explanation"}',
    ]) {
        assert.ok(before.includes(kept), `fixture sanity: ${kept}`);
        assert.ok(after.includes(kept), `kept: ${kept}`);
    }
    assert.ok(after.trimEnd().endsWith('Return JSON only: {"valid": boolean, "reason": "short explanation"}'), 'the answer format is still the last instruction');
    // Removed.
    assert.ok(!after.includes('- Fields clearly contradict each other'), 'the open-ended contradiction rule is gone');
    assert.ok(!/cover letter/i.test(after), 'no cover-letter rule left (the gate no longer sees it)');
    // Added.
    assert.ok(after.includes("The applicant's OWN fields contradict each other in a way no genuine applicant's could"), 'contradictions limited to the applicant\'s own fields');
    for (const never of ['a junior applying to a senior job', 'a location, city or country different from the job\'s', 'education marked "(in progress)"', 'any salary amount or any currency', 'polished, formal or AI-assisted wording', 'Arabic or Kurdish names']) {
        assert.ok(after.includes(never), `never-a-reason listed: ${never}`);
    }
    assert.ok(after.includes('You judge only whether this is spam, never whether the applicant fits the job.'));
    // Spam in ANY field stays a reject. A first draft listed only some fields, and spam placed only in
    // location / current company / LinkedIn slipped to 3-4 of 5 rejections in the replay (G4).
    const rule = after.split('\n').find((l) => l.includes('contains nonsense, lorem ipsum, advertising')) || '';
    for (const field of ['name', 'job', 'experience', 'current company', 'location', 'education', 'LinkedIn', 'skills', 'languages', 'certifications', 'availability', 'salary']) {
        assert.ok(rule.includes(field), `the spam rule covers the ${field} field`);
    }
    assert.ok(after.startsWith('='), 'still an n8n expression field');
    assert.ok(!after.includes('{{'), 'the system message stays literal (no expressions)');
}

testPatchTargetsThisBase();
console.log('✓ the patch targets this workflow at fade64a7 and edits only "Basic LLM Chain"');
testNothingElseChanges();
console.log('✓ every other node (If, evaluator, claim guard, scorer…), every connection and the error workflow are byte-identical');
testTemplate();
console.log('✓ template: neutral job label, no cover letter, every other field line kept');
testSystemMessage();
console.log('✓ system message: email rule, reject list and JSON-only format kept; contradiction rule limited; never-reasons added');
console.log('\nstage1-spam-gate-test: all passed');
