/**
 * headhunter-neutral-half-credit-test
 *
 * THE DEFECT (in the scorer shipped as 458db74f): a criterion the recruiter SET
 * but the profile says nothing about (`neutral`) was dropped from the sum exactly
 * like one the recruiter never set. A profile that confirmed only the position
 * scored 100. In exec 2039, 10 of 20 evaluations (7 different people) scored 100,
 * and only one of those people had position, location, years and age verified.
 *
 * THE RULE: a criterion the recruiter set earns the share of positive among the
 * judgements that took a side, and 0.5 when the profile is silent on it (all
 * neutral, or not judged at all); a criterion the recruiter did not set is not
 * scored, whatever the model wrote. What was set is read from the search request
 * (the Webhook body), never inferred from which insights the model wrote — and
 * only filters the prompt actually asks the model to judge are scored.
 *
 * Measured on the final code (offline replay of all 19 retained runs, 426 real
 * evaluations, the LIVE node code read from n8n vs this node): 120 scores change
 * and 0 cross the 50 shortlist line in either direction, and every one of the 19
 * searches has candidates at 50 or above both before and after — so the last-
 * resort 45/40 cascade never engages, and the phase-1 shortlist and the NUMBER
 * delivered do not move. What moves is the score the
 * recruiter sees and the order — and phase 2 fills its shortfall in score order,
 * so WHO fills it can change. That is the point: a verified candidate now ranks
 * above one the profile is silent about.
 *
 * This runs the REAL replacement node against real per-criterion judgements
 * (execs 2039 and 2032, plus the 2035/2036 fixture of the previous fix). The
 * fixtures are anonymised — this repository is public — and carry the search's
 * role, city, years and age, the criterion and competency labels the model wrote
 * (competency titles come from Evaalo's own role model), kinds, scores and
 * sequential person numbers: no names, URLs or insight text. The older 2035/2036
 * fixture also carries a coarse in-Iraq / in-Baghdad flag per candidate.
 *
 * Run: npm run test:headhunter-neutral-half-credit
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const NODE_FILE = join(WF_DIR, 'pending', 'headhunter-neutral-half-credit.node.js');
const PATCH_FILE = join(WF_DIR, 'pending', 'headhunter-neutral-half-credit.patch.json');
/** The node this replaces — published as 458db74f. */
const PREVIOUS_NODE_FILE = join(WF_DIR, 'pending', 'headhunter-criteria-scoring.node.js');
const FIXTURE_NEW = join(HERE, 'fixtures', 'headhunter-real-evaluator-criteria-set.json');
const FIXTURE_OLD = join(HERE, 'fixtures', 'headhunter-real-evaluator-output.json');

const THRESHOLD = 50; // `Finalize Top N Send` shortlists at >= 50

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

type Insight = { label: string; kind: string };
type Body = Record<string, unknown>;
type Out = Record<string, unknown>;

/** Run a REAL node file with the two node reads it is allowed to make. */
function runNode(code: string, answers: string[], body: Body): Out[] {
    const mapped = answers.map((_, i) => ({ json: { name: `c${i}`, __skip: false } }));
    const $ = (name: string) => {
        if (name === 'Webhook') return { first: () => ({ json: { body } }) };
        if (name === 'Map Candidate Fields') return { all: () => mapped };
        throw new Error(`the node read an unexpected node: ${name}`);
    };
    const $input = { all: () => answers.map((text) => ({ json: { text } })) };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', code);
    return (fn($, $input) as { json: Out }[]).map((o) => o.json);
}

/** Rebuild the model's raw answer from recorded judgements. */
function answer(llm: number | null, insights: Insight[]): string {
    return JSON.stringify({
        match_score: llm,
        match_insights: insights.map((i) => ({
            kind: i.kind,
            text: i.label === '(no colon)' ? 'recorded judgement without a label' : `${i.label}: recorded judgement`,
        })),
    });
}

type CompactFixture = {
    labels: string[];
    execs: Record<string, {
        meta: { position: string; location: string; yearsOfExperience: string | null; ageRange: string | null; otherSet: string[] };
        candidates: { p: number; llm: number; stored: number; i: string }[];
    }>;
};
type OldFixture = Record<string, {
    meta: { position: string; location: string; years: string };
    candidates: { id: string; llmScore: number; insights: Insight[] }[];
}>;

const KIND: Record<string, string> = { p: 'positive', w: 'warning', n: 'neutral' };

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — a criterion the recruiter set and the profile is silent on earns half, not full');
    console.log('='.repeat(96));

    const code = readFileSync(NODE_FILE, 'utf8');
    const previous = readFileSync(PREVIOUS_NODE_FILE, 'utf8');
    const patch = JSON.parse(readFileSync(PATCH_FILE, 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const edit = patch.parameterEdits[0];
    const liveNode = live.nodes.find((n: { name: string }) => n.name === edit.node);
    const liveCode = String(liveNode?.parameters?.jsCode ?? '');

    // ---- the patch is what it says it is -----------------------------------
    console.log('\nPATCH');
    check('only one node is touched', patch.parameterEdits.length === 1);
    // Published: the pre-fix node lives in the archived base; live/ must carry the new code.
    const archived = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const baseCode = String(archived.nodes.find((n: { name: string }) => n.name === edit.node)?.parameters?.jsCode ?? '');
    check('patch base is the archived pre-fix version', archived.versionId === patch.baseVersionId, `${archived.versionId} vs ${patch.baseVersionId}`);
    check('that base has the node count the patch expects', archived.nodes.length === patch.baseNodeCount, String(archived.nodes.length));
    check('the base node had the neutral-drop this replaces', baseCode.includes(edit.expectBeforeContains));
    check('the base node IS the previous fix, byte for byte (so the replay compares against what production ran)',
        baseCode === previous);
    // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
    // Superseded 2026-10-02 by completion-hardening (the same node, paired with Has Match?'s output):
    // live/ must carry this code or a RECORDED successor (a published patch whose archived base held it).
    const carried = liveCarriesOrRecordedSuccessor(WF_DIR, edit.node, code, liveCode);
    check(`the published node or a recorded successor is STILL live, byte for byte (${carried.via})`, carried.ok);
    check('and the neutral-drop is gone from live', !liveCode.includes(edit.expectBeforeContains));
    check('the replacement carries the silent-half credit', code.includes(edit.expectAfterContains));
    check('the replacement no longer drops neutral criteria', !code.includes(edit.expectBeforeContains));
    check('the model’s own number is still kept for comparison', code.includes('llm_match_score'));

    // ---- it reads exactly what the backend sends -----------------------------
    console.log('\nCONTRACT WITH THE BACKEND AND THE PROMPT');
    const codeOnly = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const read = new Set([...codeOnly.matchAll(/\bwh\.([A-Za-z]+)/g)].map((m) => m[1]));
    // The payload is built in routes/headHunter.ts from a PRIVATE optional-criteria
    // map — not the exported one in utils/optionalSearchCriteria.ts, which belongs
    // to CV Comparison and still has `company`. Read the route itself.
    const route = readFileSync(join(HERE, '..', 'routes', 'headHunter.ts'), 'utf8');
    const labelsBlock = route.match(/const OPTIONAL_CRITERION_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
    const optionalKeys = [...labelsBlock.matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]);
    check('the route’s optional-criteria map was found', optionalKeys.length >= 5, optionalKeys.join(','));
    for (const spread of [
        '...(yearsOfExperience ? { yearsOfExperience } : {})',
        '...(ageRange ? { ageRange } : {})',
        '...(rawQuery ? { query: rawQuery } : {})',
        '...optionalCriteria,',
    ]) check(`the webhook payload still carries ${spread}`, route.includes(spread));
    const sent = new Set(['position', 'location', 'yearsOfExperience', 'ageRange', 'query', ...optionalKeys]);
    // Sent by the backend but deliberately not scored, with the reason.
    const NOT_SCORED: Record<string, string> = {
        industryType: 'the prompt never asks the model to judge industry',
    };
    const missing = [...sent].filter((k) => !read.has(k) && !NOT_SCORED[k]);
    const unknown = [...read].filter((k) => !sent.has(k));
    check('every criterion the backend sends is scored or listed as deliberately not scored (a new filter fails here)',
        missing.length === 0, `not read: ${missing.join(', ')}`);
    check('nothing is read that the backend does not send', unknown.length === 0, `unknown: ${unknown.join(', ')}`);
    for (const k of Object.keys(NOT_SCORED)) check(`${k} is not read (${NOT_SCORED[k]})`, !read.has(k));

    const prompt = JSON.stringify(live.nodes.find((n: { name: string }) => n.name === 'AI Analyze Candidate')?.parameters ?? {});
    check('the prompt still states the weights this node uses',
        prompt.includes('Position 35%, Location 30%, Years of experience 15%, other active criteria 20% combined'));
    check('the prompt still promises that an unset criterion is no penalty',
        prompt.includes('Unspecified criteria = neutral, no penalty'));
    // Scoring a filter the model is never asked about hands every candidate a
    // silent half on it. Every scored field must have its own prompt line.
    const unasked = [...read].filter((k) => !prompt.includes(`json.body.${k}`));
    check('every field this node scores is put in front of the model by the prompt', unasked.length === 0,
        `scored but never asked: ${unasked.join(', ')}`);
    check('industryType still has no prompt line — once it gets one, score it here',
        !prompt.includes('json.body.industryType'));
    check('the prompt still renders an empty field as "not specified" / "none" (isSet treats those as unset)',
        prompt.includes("yearsOfExperience || 'not specified'") && prompt.includes("query || 'none'"));

    // ---- fidelity: the fixture reproduces production -------------------------
    const fx = JSON.parse(readFileSync(FIXTURE_NEW, 'utf8')) as CompactFixture;
    const decode = (s: string): Insight[] => s.split(' ').filter(Boolean).map((tok) => ({
        label: fx.labels[Number(tok.slice(0, -1))],
        kind: KIND[tok.slice(-1)],
    }));
    const bodyOf = (m: CompactFixture['execs'][string]['meta']): Body => {
        const b: Body = { position: m.position, location: m.location };
        if (m.yearsOfExperience) b.yearsOfExperience = m.yearsOfExperience;
        if (m.ageRange) b.ageRange = m.ageRange;
        for (const k of m.otherSet) b[k] = 'set';
        return b;
    };

    console.log('\nFIDELITY — the published node, fed the recorded judgements, gives what production stored');
    {
        const ex = fx.execs['2039'];
        const answers = ex.candidates.map((c) => answer(c.llm, decode(c.i)));
        const out = runNode(previous, answers, bodyOf(ex.meta));
        const same = ex.candidates.filter((c, i) => Number(out[i].match_score) === c.stored).length;
        check(`exec 2039: ${same}/${ex.candidates.length} stored scores reproduced exactly`, same === ex.candidates.length);
    }

    // ---- replay on real searches --------------------------------------------
    console.log('\nREPLAY — real per-criterion judgements, previous node vs this node');
    type Run = { id: string; body: Body; answers: string[]; people: number[]; insights: Insight[][] };
    const runs: Run[] = [];
    for (const [id, ex] of Object.entries(fx.execs)) {
        runs.push({
            id, body: bodyOf(ex.meta),
            answers: ex.candidates.map((c) => answer(c.llm, decode(c.i))),
            people: ex.candidates.map((c) => c.p),
            insights: ex.candidates.map((c) => decode(c.i)),
        });
    }
    const old = JSON.parse(readFileSync(FIXTURE_OLD, 'utf8')) as OldFixture;
    for (const [id, ex] of Object.entries(old)) {
        runs.push({
            id, body: { position: ex.meta.position, location: ex.meta.location, yearsOfExperience: ex.meta.years },
            answers: ex.candidates.map((c) => answer(c.llmScore, c.insights)),
            people: ex.candidates.map((_, i) => i + 1),
            insights: ex.candidates.map((c) => c.insights),
        });
    }

    let totalChanged = 0;
    let totalEval = 0;
    for (const r of runs) {
        const before = runNode(previous, r.answers, r.body);
        const after = runNode(code, r.answers, r.body);
        const b = before.map((o) => Number(o.match_score));
        const a = after.map((o) => Number(o.match_score));
        const changed = a.filter((x, i) => x !== b[i]).length;
        const down = a.filter((x, i) => b[i] >= THRESHOLD && x < THRESHOLD).length;
        const up = a.filter((x, i) => b[i] < THRESHOLD && x >= THRESHOLD).length;
        totalChanged += changed;
        totalEval += a.length;
        const set = Object.keys(r.body).filter((k) => r.body[k]).join(', ');
        console.log(`\n  exec ${r.id}  (set: ${set})`);
        console.log(`    ${a.length} evaluations · ${changed} scores changed · at 100: ${b.filter((x) => x === 100).length} -> ${a.filter((x) => x === 100).length}`);
        console.log(`    >= ${THRESHOLD}: ${b.filter((x) => x >= THRESHOLD).length} -> ${a.filter((x) => x >= THRESHOLD).length}`);
        check(`exec ${r.id}: nobody crosses the ${THRESHOLD} shortlist line (down ${down}, up ${up})`, down === 0 && up === 0);
        const fb = (o: Out[]) => o.filter((x) => x.score_source !== 'computed').length;
        check(`exec ${r.id}: no new fallbacks (${fb(before)} -> ${fb(after)})`, fb(after) === fb(before));

        if (r.id === '2039') {
            const at100 = a.map((x, i) => ({ x, i })).filter((z) => z.x === 100);
            const verified = at100.every((z) => {
                const ins = r.insights[z.i];
                const kinds = (re: RegExp) => ins.filter((q) => re.test(q.label.replace(/[^A-Za-z]/g, ''))).map((q) => q.kind);
                const allPositive = (ks: string[]) => ks.length > 0 && ks.every((k) => k === 'positive');
                return allPositive(kinds(/^position/i)) && allPositive(kinds(/^location/i))
                    && allPositive(kinds(/^years/i)) && allPositive(kinds(/^age(range)?$/i));
            });
            check('exec 2039: before, 10 evaluations (7 people) sat at 100',
                b.filter((x) => x === 100).length === 10
                && new Set(b.map((x, i) => (x === 100 ? r.people[i] : 0)).filter(Boolean)).size === 7);
            check('exec 2039: now exactly one person is at 100 …', new Set(at100.map((z) => r.people[z.i])).size === 1,
                at100.map((z) => `P${r.people[z.i]}`).join(' '));
            check('… and it is the one with position, location, years AND age all positive', at100.length > 0 && verified);
        }
        if (r.id === '2032') {
            // Only position and location were set. A candidate judged on both, with
            // no neutral among those judgements, must keep the exact same score.
            const keeps = r.insights.map((ins, i) => ({ ins, i })).filter(({ ins }) => {
                const on = ins.filter((q) => /^(position|location)/i.test(q.label.replace(/[^A-Za-z]/g, '')));
                return ['position', 'location'].every((c) => on.some((q) => q.label.toLowerCase().startsWith(c)))
                    && on.every((q) => q.kind !== 'neutral');
            });
            const moved = keeps.filter(({ i }) => a[i] !== b[i]);
            check(`exec 2032: all ${keeps.length} candidates judged on both set criteria keep their exact score`,
                keeps.length > 0 && moved.length === 0, moved.map(({ i }) => `#${i} ${b[i]}->${a[i]}`).join(' '));
        }
    }
    console.log(`\n  TOTAL: ${totalChanged} of ${totalEval} scores changed; none crossed the shortlist line.`);

    // ---- the rules, one at a time ------------------------------------------
    console.log('\nRULES');
    const base: Body = { position: 'HR Business Partner', location: 'Baghdad, Iraq' };
    const run1 = (ins: [string, string][], body: Body = base, llm: number | null = 1) =>
        runNode(code, [answer(llm, ins.map(([label, kind]) => ({ label, kind })))], body)[0];
    const score = (ins: [string, string][], body: Body = base) => Number(run1(ins, body).match_score);
    const is = (label: string, got: number, want: number) => check(`${label}  (= ${want})`, got === want, `got ${got}`);
    const PL: [string, string][] = [['position', 'positive'], ['location', 'positive']];

    // Weights: position 35, location 30, years 15, other 20.
    is('neutral on a set criterion earns half: position+, location silent -> (35+15)/65',
        score([['position', 'positive'], ['location', 'neutral']]), 77);
    is('neutral on position earns half too: (17.5+30)/65',
        score([['position', 'neutral'], ['location', 'positive']]), 73);
    const yrs = { ...base, yearsOfExperience: '5-10' };
    is('a set criterion the model never mentioned counts as silent: years set, no years insight -> 72.5/80',
        score(PL, yrs), 91);
    is('… exactly the same as an explicit neutral', score([...PL, ['Years of Experience', 'neutral']], yrs), 91);
    is('a silent remark next to a real judgement adds nothing: location+ and location silent -> full',
        score([['position', 'positive'], ['Location', 'positive'], ['Location (final cap)', 'neutral']]), 100);
    is('two opposite judgements on one criterion share it: location+ and location warning -> 0.5',
        score([['position', 'positive'], ['Location', 'positive'], ['Location rule', 'warning']]), 77);
    is('an unknown kind is read as silent', score([['position', 'positive'], ['location', 'strong']]), 77);

    console.log('\nRULES — only what the recruiter set is scored');
    is('an UNSET criterion is not scored even when the model judged it: years warning, no years filter',
        score([...PL, ['years of experience', 'warning']]), 100);
    is('an unset optional filter is not scored either: skills warning, no skills filter',
        score([...PL, ['requiredSkills', 'warning']]), 100);
    is('a blank filter value is not "set"', score([...PL, ['requiredSkills', 'warning']], { ...base, requiredSkills: '   ' }), 100);
    is('a value equal to the prompt’s own unset marker is not "set": years "Not Specified "',
        score([...PL, ['years of experience', 'warning']], { ...base, yearsOfExperience: 'Not Specified ' }), 100);
    is('… nor is notes "None"', score([...PL, ['notes', 'warning']], { ...base, query: 'None' }), 100);
    is('a "company" line is neither scored (no company filter any more) nor mistaken for a competency (that would be 70)',
        score([...PL, ['company', 'warning']], { ...base, company: 'Zain' }), 100);
    is('an "industry" line is recognised but NOT scored — the prompt never asks about industry',
        score([...PL, ['Industry type', 'warning']], { ...base, industryType: 'Oil & Gas' }), 100);
    is('… also with a bracketed qualifier that contains "&"',
        score([...PL, ['Industry Type (Oil & Gas)', 'warning']], { ...base, industryType: 'Oil & Gas' }), 100);
    // Read as a competency, each of these would cost 30% (score 70).
    for (const l of ['Industry', 'Industry type', 'Company', 'Company preference']) {
        is(`"${l}" is recognised as an unscored filter, never a competency`,
            score([...PL, [l, 'warning']], { ...base, industryType: 'Oil & Gas', company: 'Zain' }), 100);
    }

    console.log('\nRULES — the "other" 20%');
    const skills = { ...base, requiredSkills: 'Excel' };
    is('a set optional filter, positive -> full', score([...PL, ['Required Skills', 'positive']], skills), 100);
    is('a set optional filter, silent -> half of 20: 75/85', score([...PL, ['Required Skills', 'neutral']], skills), 88);
    is('a set optional filter, never mentioned -> half as well', score(PL, skills), 88);
    is('a set optional filter, warning -> none: 65/85', score([...PL, ['Required Skills', 'warning']], skills), 76);
    is('two opposite judgements on one optional filter share it', score([...PL, ['Required Skills', 'positive'], ['Skills', 'warning']], skills), 88);
    is('"other" is the mean over the SET sub-filters: languages+ and skills warning -> 0.5',
        score([...PL, ['requiredLanguages', 'positive'], ['requiredSkills', 'warning']], { ...skills, requiredLanguages: 'English' }), 88);
    // Every spelling of every scored optional filter must land on it: a warning
    // on the filter costs its whole share (65/85 = 76). Read as a competency it
    // would score 62; read as "not mentioned" it would score 88.
    const spellings: [string, Body, string[]][] = [
        ['languages', { requiredLanguages: 'English' }, ['requiredLanguages', 'RequiredLanguages', 'Required Languages', 'Required Language', 'Required Languages (English)', 'Languages', 'Language', 'Language proficiency']],
        ['skills', { requiredSkills: 'Excel' }, ['requiredSkills', 'Required skills', 'Required Skill', 'Skills', 'Skills (Excel)', 'Skill', 'Required Skills (e.g.: Excel)']],
        ['certifications', { certifications: 'SHRM' }, ['certifications', 'Certifications', 'Certification', 'Certificates', 'Certificate', 'Required certifications', 'Required Certification', 'Required Certificates', 'Required certificate']],
        ['gender', { gender: 'Female' }, ['gender', 'Gender', 'Gender (Female)', 'Gender preference']],
        ['age', { ageRange: '35-44' }, ['age', 'Age', 'ageRange', 'Age Range (35-44)', 'Age (range: 35-44)', 'Age (estimated)', 'Estimated age']],
        ['notes', { query: 'banking background' }, ['notes', 'Notes', 'Notes (banking background)', 'Note', 'Additional notes']],
    ];
    for (const [filter, set, labels] of spellings) {
        const wrong = labels.filter((l) => score([...PL, [l, 'warning']], { ...base, ...set }) !== 76);
        check(`every spelling of the ${filter} filter is read as ${filter} (${labels.length} spellings)`, wrong.length === 0,
            wrong.map((l) => `${l}=${score([...PL, [l, 'warning']], { ...base, ...set })}`).join(' '));
    }

    console.log('\nRULES — combined and look-alike labels');
    const ga = { ...base, ageRange: '35-44', gender: 'Female' };
    is('a verdict on a combined label applies to every set filter it names: warning -> both fail, 65/85',
        score([...PL, ['Gender and Age', 'warning']], ga), 76);
    is('… positive -> both match', score([...PL, ['Gender and Age', 'positive']], ga), 100);
    is('"Gender and Age" with only age set is a verdict on age', score([...PL, ['Gender and Age', 'warning']], { ...base, ageRange: '35-44' }), 76);
    is('a combined unset list is ignored', score([...PL, ['Required skills, certifications, company, gender', 'warning']]), 100);
    is('… but applies to the one filter in it that was set', score([...PL, ['Required skills, certifications, company, gender', 'warning']], skills), 76);
    is('"Years and Location: warning" next to a separate location+ shares location: (35+15+0)/80 = 62.5, an exact half, rounds up',
        score([...PL, ['Years and Location', 'warning']], yrs), 63);
    is('… and alone fails both: 35/80', score([['position', 'positive'], ['Years and Location', 'warning']], yrs), 44);
    is('"Position and Location: positive" alone is a full judgement, not a fallback',
        score([['Position and Location', 'positive']]), 100);
    is('"Position and seniority" is still position (whole-label reading): 30/65',
        score([['Position and seniority', 'warning'], ['location', 'positive']]), 46);
    is('"Seniority and position" is a competency (not every part is a criterion): 0.7×100 + 0.3×0',
        score([...PL, ['Seniority and position', 'warning']]), 70);
    is('"Territory & Location Planning" is a competency, not location', score([...PL, ['Territory & Location Planning', 'warning']]), 70);
    is('"Positioning & Messaging" is a competency, not position', score([...PL, ['Positioning & Messaging', 'warning']]), 70);
    is('"Change Management & Adoption" is a competency', score([...PL, ['Change Management & Adoption', 'warning']]), 70);

    console.log('\nCOMPETENCIES — unchanged');
    is('a silent competency is still skipped', score([...PL, ['Stakeholder Management', 'neutral']]), 100);
    is('a failed competency still costs 30%', score([...PL, ['Stakeholder Management', 'warning']]), 70);
    is('an exact half rounds up even when floating point says .4999: 0.7×85 + 0.3×0 = 59.5',
        score([...PL, ['years of experience', 'warning'], ['Required Skills', 'positive'], ['Stakeholder Management', 'warning']],
            { ...base, yearsOfExperience: '5-10', requiredSkills: 'Excel' }), 60);
    is('the mixed score is rounded, not ceiled: 0.7×73.08 + 0.3×50 = 66.15',
        score([['position', 'neutral'], ['location', 'positive'], ['Stakeholder Management', 'positive'], ['Budget Ownership', 'warning']]), 66);

    console.log('\nFALLBACK — never a bare 50');
    const fb = (ins: [string, string][], llm: number, body: Body = base) => {
        const o = run1(ins, body, llm);
        return `${o.match_score}/${o.score_source}`;
    };
    const silentPL: [string, string][] = [['position', 'neutral'], ['location', 'neutral']];
    check('all set criteria silent -> the model’s number, labelled (not a computed 50)',
        fb(silentPL, 77) === '77/llm-fallback', fb(silentPL, 77));
    check('a judgement on an UNSET criterion does not count as "judged"',
        fb([...silentPL, ['years of experience', 'positive']], 64) === '64/llm-fallback');
    check('… nor does one on an unset OPTIONAL filter (else it would come out at a computed 50 and be delivered)',
        fb([...silentPL, ['requiredSkills', 'positive']], 64) === '64/llm-fallback');
    check('… nor does a judged COMPETENCY',
        fb([...silentPL, ['Stakeholder Management', 'positive']], 61) === '61/llm-fallback', fb([...silentPL, ['Stakeholder Management', 'positive']], 61));
    check('a verdict on a combined label IS a judgement: 17.5/80',
        fb([...silentPL, ['Years and Location', 'warning']], 58, yrs) === '22/computed', fb([...silentPL, ['Years and Location', 'warning']], 58, yrs));
    check('a judgement on a SET optional filter alone is enough to compute: (17.5+15+20)/85 (458db74f gave 100)',
        fb([...silentPL, ['Required Skills', 'positive']], 33, skills) === '62/computed', fb([...silentPL, ['Required Skills', 'positive']], 33, skills));
    check('the model’s number is clamped: 140 -> 100', fb(silentPL, 140) === '100/llm-fallback');
    check('… and -5 -> 0', fb(silentPL, -5) === '0/llm-fallback');
    const noJson = runNode(code, ['not json at all'], base)[0];
    check('an unparseable answer is 0 and labelled, not 50', noJson.match_score === 0 && noJson.score_source === 'none',
        `${noJson.match_score}/${noJson.score_source}`);

    console.log('\nOUTPUT SHAPE');
    const sample = answer(66, [{ label: 'position', kind: 'positive' }, { label: 'location', kind: 'warning' }]);
    const keysNew = Object.keys(runNode(code, [sample], base)[0]).sort().join(',');
    const keysOld = Object.keys(runNode(previous, [sample], base)[0]).sort().join(',');
    check('the node emits exactly the same fields as the one it replaces', keysNew === keysOld, `${keysNew} vs ${keysOld}`);
    check('llm_match_score is the model’s own number', runNode(code, [sample], base)[0].llm_match_score === 66);

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
    console.log('\nMUTATIONS that must turn this red:');
    console.log('  M1  silent credit 0.5 -> 1 (close to the old drop-it rule) or -> 0 -> the half-credit rules + "exactly one person at 100"');
    console.log('  M2  score criteria the recruiter did not set                -> "an UNSET criterion is not scored" + the fallbacks');
    console.log('  M3  exclude a set criterion the model never mentioned       -> "counts as silent"');
    console.log('  M4  drop any spelling from OTHER_LABELS                     -> "every spelling of the … filter"');
    console.log('  M5  remove the judged guard, or let competencies count      -> the FALLBACK block');
    console.log('  M6  split combined labels even when a part is not a criterion -> "Seniority and position", "Territory & Location Planning"');
    console.log('  M7  score industryType, or read company again               -> the backend/prompt contract');
    console.log('  M8  average a neutral into a judged criterion               -> "a silent remark next to a real judgement adds nothing"');
    console.log('  M9  treat a combined verdict as silent                      -> the combined-label rules');
    console.log('  M10 cut the label at the colon before removing brackets     -> "Required Skills (e.g.: Excel)"');
    console.log('  M11 plain Math.round                                        -> "an exact half rounds up"');
}

main();
