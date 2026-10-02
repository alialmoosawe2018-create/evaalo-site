/**
 * headhunter-position-titles-test
 *
 * THE DEFECT (measured 2026-10-02 on the 14 retained real searches): the position
 * gate in `Map Candidate Fields` searched one text blob made of the headline, the
 * bio, the industry and every job's title, company AND description, and let a
 * profile through on ANY single word of the searched title (as a substring). The
 * people in another job who were delivered got through on "business"/"partner" in
 * a bio, headline or description, on "generalist" in a headline, or on the
 * pass-all: a title made only of level words ("HR Assistant") passed everyone,
 * including a profile with no title at all. ("HR" in a bio and a word in a company
 * name are further paths this fix also closes; neither caused a delivery here.)
 *
 * THE OWNER'S CONSTRAINT: a candidate whose CURRENT title differs but who held the
 * searched title in an EARLIER job must still pass. Under the live code 36 of the
 * 200 profiles reaching this gate held the searched title only in a past job, and
 * 27 of them were delivered (52 of 276 under each run's own, older code). An exact
 * current-title match would have lost all of them.
 *
 * THE FIX: match job TITLES only - current and past experience titles, the
 * headline and the occupation's title part - never descriptions, bio, a company
 * after " at " / "@", or industry; whole words, with a short list of rewrites
 * (HR, admin, sales, plural and abbreviation forms); a generic word ("business",
 * "partner", "generalist") cannot carry a match alone; Arabic words still match
 * inside words; and the gate never passes everyone.
 *
 * Replayed offline on the 200 real profile rows that reached the gate (script kept
 * out of this public repo, real data): 0 rows holding the role now or in the past
 * are lost, 27 rows (about 19 people) with the role in no title at all are dropped
 * (7 had been delivered, the same 7 scored 50+), 0 are newly kept, and every row
 * kept by both versions is byte-identical.
 *
 * This test runs the REAL node code - today's (live/) and the patched one - on
 * synthetic profiles only.
 *
 * Run: npm run test:headhunter-position-titles
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const NODE = 'Map Candidate Fields';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

type Raw = Record<string, unknown>;
type Job = { title: string; current?: boolean; description?: string; company?: string };

const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-position-titles.patch.json'), 'utf8'));
const edit = patch.parameterEdits[0];
const AFTER = readFileSync(join(WF_DIR, 'pending', edit.replaceWholeValueFromFile), 'utf8');

function baseWorkflow(): { versionId: string; nodes: { name: string; parameters: Raw }[] } {
    // Before publishing the base is live/; once published, the archived pre-fix copy.
    const file = patch.publishedVersionId ? patch.baseFile : 'live/headhunter--AI_Head_hunter.json';
    return JSON.parse(readFileSync(join(WF_DIR, file), 'utf8'));
}
const base = baseWorkflow();
const BEFORE = String(base.nodes.find((n) => n.name === NODE)?.parameters.jsCode ?? '');

function runNode(code: string, webhookBody: Raw, profiles: Raw[]): Raw[] {
    const $ = () => ({ first: () => ({ json: { body: webhookBody } }) });
    const $input = { all: () => profiles.map((p) => ({ json: p })) };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', code);
    return (fn($, $input) as { json: Raw }[]).map((o) => o.json);
}

let seq = 0;
/** An Iraqi (country IQ) EnrichLayer-shaped profile, so only the position gate decides. */
function person(o: { occupation?: string; headline?: string; summary?: string; jobs?: Job[] }): Raw {
    seq++;
    return {
        full_name: `Candidate ${seq}`,
        public_identifier: `candidate-${seq}`,
        occupation: o.occupation ?? '',
        headline: o.headline ?? '',
        summary: o.summary ?? '',
        city: 'Baghdad',
        country: 'IQ',
        experiences: (o.jobs ?? []).map((j, i) => ({
            title: j.title,
            company: j.company ?? 'Example Co',
            description: j.description ?? '',
            starts_at: { year: 2015 + i, month: 1 },
            ends_at: j.current ? null : { year: 2016 + i, month: 1 },
        })),
    };
}

function kept(code: string, position: string, p: Raw): boolean {
    const out = runNode(code, { searchId: 'test-pos', position, location: 'Baghdad, Iraq' }, [p]);
    return out.length === 1 && out[0].__skip !== true;
}

function main(): void {
    console.log('='.repeat(94));
    console.log('Head Hunter — position gate: job titles (current AND past), never descriptions or bio');
    console.log('='.repeat(94));

    console.log('\nPATCH');
    check('patch targets the Head Hunter workflow', patch.workflowId === 'GlhDGC23n5tT6jVv');
    check(`base workflow is the recorded base version (${patch.baseVersionId.slice(0, 8)})`,
        base.versionId === patch.baseVersionId, `${base.versionId} — rebase the patch if live/ moved`);
    check(`base has ${patch.baseNodeCount} nodes`, base.nodes.length === patch.baseNodeCount);
    check('one edit, whole jsCode of Map Candidate Fields', patch.parameterEdits.length === 1 && edit.node === NODE && edit.path === 'parameters.jsCode');
    check('the base still holds the old gate', BEFORE.includes(edit.expectBeforeContains));
    check('the patched code holds the new gate', AFTER.includes(edit.expectAfterContains));
    check('no CR in the patched file (published with LF)', !AFTER.includes('\r'));
    if (patch.publishedVersionId) {
        check('the published file still hashes to its recorded publishedSha256',
            createHash('sha256').update(AFTER, 'utf8').digest('hex') === edit.publishedSha256);
        const liveNow = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const liveCode = String(liveNow.nodes.find((n: { name: string }) => n.name === NODE)?.parameters.jsCode ?? '');
        check('the published node is still live (or a recorded successor carries it)',
            liveCarriesOrRecordedSuccessor(WF_DIR, NODE, AFTER, liveCode).ok);
    }
    // Everything outside the gate is byte-identical: cut the old gate (the two old
    // functions and the call) and the new gate block (and its call), compare the rest.
    const cutOld = (s: string) => {
        const a = s.indexOf('function profileTextForPosition(mapped) {');
        const c = s.indexOf('\nconst out = [];');
        return (s.slice(0, a) + s.slice(c)).replace('  const text = profileTextForPosition(mapped);\n  if (!matchesPosition(text)) {', 'CALL');
    };
    const cutNew = (s: string) => {
        const a = s.indexOf('// Position gate: the searched role must appear in a job TITLE');
        const c = s.indexOf('\nconst out = [];');
        return (s.slice(0, a) + s.slice(c)).replace('  if (!matchesPosition(profileTitles(profile, experiences))) {', 'CALL');
    };
    check('outside the gate, the node is byte-identical', cutOld(BEFORE) === cutNew(AFTER));
    check('the old blob builder is gone', !AFTER.includes('profileTextForPosition'));
    check('the new gate reads titles, not the blob', AFTER.includes('matchesPosition(profileTitles(profile, experiences))'));
    const baseLines = new Set(BEFORE.split('\n'));
    const nonAscii = AFTER.split('\n')
        .filter((l) => !baseLines.has(l))
        .filter((l) => /[^\x00-\x7f]/.test(l) && !/'[^']*[؀-ۿ][^']*'/.test(l));
    check('new lines are ASCII except Arabic string literals', nonAscii.length === 0, nonAscii[0] ?? '');

    // ---- behaviour -------------------------------------------------------------
    type Case = { label: string; position: string; p: Raw; want: boolean; old?: boolean };
    const cases: Case[] = [
        // The owner's constraint: a PAST title counts.
        { label: 'HR Business Partner held in an EARLIER job (now Consultant)', position: 'HR Business Partner', want: true, old: true,
            p: person({ occupation: 'Consultant at Example Co', jobs: [{ title: 'Consultant', current: true }, { title: 'HR Business Partner' }] }) },
        { label: 'Store Manager held earlier (now Operations Manager)', position: 'Store Manager', want: true, old: true,
            p: person({ occupation: 'Operations Manager at Example Co', jobs: [{ title: 'Operations Manager', current: true }, { title: 'Store Manager' }] }) },
        { label: 'Sales Manager: Branch Manager now, Sales & Marketing Manager earlier', position: 'Sales Manager', want: true, old: true,
            p: person({ occupation: 'Branch Manager at Example Co', jobs: [{ title: 'Branch Manager', current: true }, { title: 'Sales & Marketing Manager' }] }) },
        { label: 'HR Assistant held earlier, only past title mentions it', position: 'HR Assistant', want: true, old: true,
            p: person({ occupation: 'Office Coordinator', jobs: [{ title: 'Office Coordinator', current: true }, { title: 'HR Assistant' }] }) },
        // Current titles.
        { label: 'exact current title in the occupation', position: 'Sales Manager', want: true, old: true,
            p: person({ occupation: 'Sales Manager at Example Co' }) },
        { label: 'same field, different seniority (Sales Team Lead)', position: 'Sales Manager', want: true, old: true,
            p: person({ occupation: 'Sales Team Lead at Example Co', jobs: [{ title: 'Sales Team Lead', current: true }] }) },
        { label: 'HR family for an HR search (Head of Human Resources)', position: 'HR Business Partner', want: true, old: true,
            p: person({ occupation: 'Head of Human Resources at Example Co' }) },
        { label: 'HR family: Talent Acquisition Specialist for HR Business Partner', position: 'HR Business Partner', want: true,
            p: person({ headline: 'Talent Acquisition Specialist' }) },
        { label: 'headline segment before "@ Company" counts', position: 'Sales Manager', want: true, old: true,
            p: person({ headline: 'Senior Sales Manager @ Example Co | Business Growth' }) },
        // The measured leaks: kept today, dropped now.
        { label: 'LEAK: "Regional Business Partner" (not HR) for HR Business Partner', position: 'HR Business Partner', want: false, old: true,
            p: person({ occupation: 'Regional Business Partner at Example Trading Co', jobs: [{ title: 'Regional Business Partner', current: true }, { title: 'Customer Service Officer' }] }) },
        { label: 'LEAK: a CFO with "Business" in the headline', position: 'HR Business Partner', want: false, old: true,
            p: person({ occupation: 'CFO at Example Holding', headline: 'Finance & Business Advisory, CFO', jobs: [{ title: 'Chief Financial Officer' }] }) },
        { label: 'HR text in a past job DESCRIPTION only does not count (HR Business Partner)', position: 'HR Business Partner', want: false, old: true,
            p: person({ occupation: 'Office Manager at Example Co', jobs: [{ title: 'Office Manager', current: true, description: 'Handled human resources paperwork' }] }) },
        { label: 'LEAK: Assistant Professor for HR Assistant (old pass-all)', position: 'HR Assistant', want: false, old: true,
            p: person({ occupation: 'Assistant Professor at Example University', jobs: [{ title: 'Assistant Lecturer', current: true }] }) },
        { label: 'LEAK: a profile with no title at all for HR Assistant (old pass-all)', position: 'HR Assistant', want: false, old: true,
            p: person({}) },
        { label: 'LEAK: "Management Generalist" for HR Generalist', position: 'HR Generalist', want: false, old: true,
            p: person({ occupation: 'Operations Manager at Example Co', headline: 'Management Generalist', jobs: [{ title: 'Operations Manager' }] }) },
        { label: 'LEAK: "Marketing Generalist" for HR Generalist', position: 'HR Generalist', want: false, old: true,
            p: person({ occupation: 'Marketing Generalist at Example Co' }) },
        { label: 'LEAK: role named only in a job DESCRIPTION', position: 'Sales Manager', want: false, old: true,
            p: person({ occupation: 'Service Manager at Example Co', jobs: [{ title: 'Service Manager', current: true, description: 'Supported the sales team on targets' }] }) },
        { label: 'LEAK: "HR" only in the bio (HR Business Partner: no pass-all)', position: 'HR Business Partner', want: false, old: true,
            p: person({ occupation: 'Accountant at Example Co', summary: 'Worked closely with HR on payroll files' }) },
        { label: 'LEAK: role word only in the COMPANY name ("Engineer at Sales Hub")', position: 'Sales Manager', want: false, old: true,
            p: person({ occupation: 'Engineer at Sales Hub Co', jobs: [{ title: 'Engineer', current: true, company: 'Sales Hub Co' }] }) },
        { label: 'role word only after "@" in a HEADLINE segment does not count', position: 'Sales Manager', want: false,
            p: person({ headline: 'Engineer @ Example Sales Co' }) },
        { label: 'headline split on a bullet: "Driver at Example Co • Sales Supervisor"', position: 'Sales Manager', want: true,
            p: person({ headline: 'Driver at Example Co • Sales Supervisor' }) },
        // Spelling families the old substring caught on titles alone (review round 1).
        { label: 'Admin Assistant: "Administrative Assistant" now', position: 'Admin Assistant', want: true, old: true,
            p: person({ occupation: 'Administrative Assistant at Example Co' }) },
        { label: 'Admin Assistant: "Administrative Assistant" in a PAST job', position: 'Admin Assistant', want: true, old: true,
            p: person({ occupation: 'Receptionist at Example Co', jobs: [{ title: 'Receptionist', current: true }, { title: 'Administrative Assistant' }] }) },
        { label: 'Admin Officer: "Administration Officer"', position: 'Admin Officer', want: true, old: true,
            p: person({ occupation: 'Administration Officer at Example Co' }) },
        { label: 'Admin Officer: an "Office Administrator"', position: 'Admin Officer', want: true, old: true,
            p: person({ occupation: 'Office Administrator at Example Co' }) },
        { label: 'Admin Officer: "HR Administrator" held in a PAST job', position: 'Admin Officer', want: true, old: true,
            p: person({ occupation: 'Sales Coordinator at Example Co', jobs: [{ title: 'Sales Coordinator', current: true }, { title: 'HR Administrator' }] }) },
        { label: 'Admin Officer: a System Administrator is not admin staff', position: 'Admin Officer', want: false, old: true,
            p: person({ occupation: 'System Administrator at Example Co' }) },
        { label: 'plural: Operations Manager for "Operation Manager" search', position: 'Operation Manager', want: true, old: true,
            p: person({ occupation: 'Operations Manager at Example Co' }) },
        { label: 'plural: "Projects Manager" held earlier for Project Manager', position: 'Project Manager', want: true, old: true,
            p: person({ occupation: 'Country Director at Example Co', jobs: [{ title: 'Country Director', current: true }, { title: 'Projects Manager' }] }) },
        { label: 'Public Relations Officer: "Public Relation Officer" spelling', position: 'Public Relations Officer', want: true, old: true,
            p: person({ occupation: 'Public Relation Officer at Example Co' }) },
        { label: 'Public Relations Officer: "Investor Relations" is not it', position: 'Public Relations Officer', want: false, old: true,
            p: person({ occupation: 'Investor Relations Manager at Example Co' }) },
        { label: 'Sales Representative: "Salesman" held earlier (now Driver)', position: 'Sales Representative', want: true, old: true,
            p: person({ occupation: 'Driver at Example Co', jobs: [{ title: 'Driver', current: true }, { title: 'Salesman' }] }) },
        { label: 'Sales Manager: "Salesperson"', position: 'Sales Manager', want: true, old: true,
            p: person({ occupation: 'Salesperson at Example Co' }) },
        { label: 'HSE Officer: "QHSE Engineer"', position: 'HSE Officer', want: true, old: true,
            p: person({ occupation: 'QHSE Engineer at Example Co' }) },
        { label: 'Safety Officer: "Health and Safety Officer" held in a PAST job', position: 'Safety Officer', want: true, old: true,
            p: person({ occupation: 'Site Supervisor at Example Co', jobs: [{ title: 'Site Supervisor', current: true }, { title: 'Health and Safety Officer' }] }) },
        { label: 'Safety Officer: "Health & Safety Manager"', position: 'Safety Officer', want: true, old: true,
            p: person({ occupation: 'Health & Safety Manager at Example Co' }) },
        { label: 'Technology Manager: "Information Technology Manager"', position: 'Technology Manager', want: true, old: true,
            p: person({ occupation: 'Information Technology Manager at Example Co' }) },
        { label: 'Sales Manager: "Telesales Supervisor"', position: 'Sales Manager', want: true, old: true,
            p: person({ occupation: 'Telesales Supervisor at Example Co' }) },
        { label: 'HSE Officer: "Health & Safety Supervisor"', position: 'HSE Officer', want: true,
            p: person({ occupation: 'Health & Safety Supervisor at Example Co' }) },
        { label: 'IT Manager: "Information Technology Manager"', position: 'IT Manager', want: true, old: true,
            p: person({ occupation: 'Information Technology Manager at Example Co' }) },
        { label: 'Audit Manager: "Senior Auditor"', position: 'Audit Manager', want: true, old: true,
            p: person({ occupation: 'Senior Auditor at Example Co' }) },
        { label: 'abbreviated search "Project Mgr" finds Project Manager', position: 'Project Mgr', want: true, old: true,
            p: person({ occupation: 'Project Manager at Example Co' }) },
        { label: 'abbreviated search "Admin Asst" finds Admin Assistant', position: 'Admin Asst', want: true, old: true,
            p: person({ occupation: 'Admin Assistant at Example Co' }) },
        { label: 'Store Keeper search: "Store-Keeper"', position: 'Store Keeper', want: true, old: true,
            p: person({ occupation: 'Store-Keeper at Example Co' }) },
        { label: 'Store Keeper search: "Storekeeper"', position: 'Store Keeper', want: true, old: true,
            p: person({ occupation: 'Storekeeper at Example Co' }) },
        { label: 'M&E Officer: "M&E Officer"', position: 'M&E Officer', want: true, old: true,
            p: person({ occupation: 'M&E Officer at Example Co' }) },
        { label: 'M&E Officer: the word "me" in a headline is not M&E', position: 'M&E Officer', want: false, old: false,
            p: person({ headline: 'Accountant | Hire me' }) },
        { label: 'M&E Officer: an "E-Commerce Specialist" is not it (single letters)', position: 'M&E Officer', want: false, old: false,
            p: person({ occupation: 'E-Commerce Specialist at Example Co' }) },
        { label: 'A/R Accountant: an "R&D Engineer" is not it (single letters)', position: 'A/R Accountant', want: false, old: false,
            p: person({ occupation: 'R&D Engineer at Example Co' }) },
        { label: 'A/R Accountant: an "R Programmer" is not it (one-letter token)', position: 'A/R Accountant', want: false, old: false,
            p: person({ occupation: 'R Programmer at Example Co' }) },
        { label: 'C&B Specialist: "Compensation & Benefits Manager"', position: 'C&B Specialist', want: true,
            p: person({ occupation: 'Compensation & Benefits Manager at Example Co' }) },
        { label: 'HR search: a "Talent Manager" (artists) is not HR', position: 'HR Business Partner', want: false,
            p: person({ occupation: 'Talent Manager at Example Studio' }) },
        // Never pass everyone.
        { label: 'all-level-word title "Manager": a Store Manager passes', position: 'Manager', want: true, old: true,
            p: person({ occupation: 'Store Manager at Example Co' }) },
        { label: 'all-level-word title "Manager": an Accountant does NOT (old: pass-all)', position: 'Manager', want: false, old: true,
            p: person({ occupation: 'Accountant at Example Co' }) },
        { label: 'no position searched: no gate, as before', position: '', want: true, old: true,
            p: person({ occupation: 'Accountant at Example Co' }) },
        // Abbreviations and synonyms.
        { label: 'HRBP abbreviation for HR Business Partner', position: 'HR Business Partner', want: true,
            p: person({ occupation: 'HRBP at Example Co' }) },
        { label: 'BD Manager for Business Development Specialist', position: 'Business Development Specialist', want: true,
            p: person({ occupation: 'BD Manager at Example Co' }) },
        { label: 'Purchasing Officer for Procurement Officer', position: 'Procurement Officer', want: true,
            p: person({ occupation: 'Purchasing Officer at Example Co' }) },
        { label: 'H.R. Officer for HR Assistant', position: 'HR Assistant', want: true,
            p: person({ occupation: 'H.R. Officer at Example Co' }) },
        // Generic-only titles need all their words in ONE title.
        { label: 'Business Development Manager for Business Development Specialist', position: 'Business Development Specialist', want: true, old: true,
            p: person({ occupation: 'Business Development Manager at Example Co' }) },
        { label: 'Software Development Engineer is NOT Business Development', position: 'Business Development Specialist', want: false, old: true,
            p: person({ occupation: 'Software Development Engineer at Example Co' }) },
        // A distinctive word is still enough (no stricter than today for other roles).
        { label: 'Software Developer for Software Engineer (distinctive "software")', position: 'Software Engineer', want: true, old: true,
            p: person({ occupation: 'Software Developer at Example Co' }) },
        { label: 'Piping Engineer for Software Engineer ("engineer" is distinctive, as today)', position: 'Software Engineer', want: true, old: true,
            p: person({ occupation: 'Piping Engineer at Example Co' }) },
        // Whole words, not substrings.
        { label: 'Storekeeper is not Store Manager (old matched the substring)', position: 'Store Manager', want: false, old: true,
            p: person({ occupation: 'Storekeeper at Example Co' }) },
        { label: 'Accountant is not Account Manager (old matched the substring)', position: 'Account Manager', want: false, old: true,
            p: person({ occupation: 'Accountant at Example Co' }) },
        { label: 'Key Account Manager is Account Manager', position: 'Account Manager', want: true, old: true,
            p: person({ occupation: 'Key Account Manager at Example Co' }) },
        // Arabic.
        { label: 'Arabic search, Arabic title', position: 'مدير مبيعات', want: true,
            p: person({ occupation: 'مدير مبيعات' }) },
        { label: 'Arabic title with diacritics on every word still matches', position: 'مدير مبيعات', want: true,
            p: person({ occupation: 'مُدير مُبيعات' }) },
        { label: 'Arabic HR title for an HR search', position: 'HR Assistant', want: true,
            p: person({ occupation: 'مسؤول الموارد البشرية' }) },
        { label: 'Arabic search "مهندس في النفط": the two-letter word "في" is not the role', position: 'مهندس في النفط', want: false, old: false,
            p: person({ occupation: 'محاسب في شركة تجارية' }) },
        { label: 'position-side rewrite: "Human Resources Assistant" search finds an HR Officer', position: 'Human Resources Assistant', want: true, old: true,
            p: person({ occupation: 'HR Officer at Example Co' }) },
        { label: 'Arabic search "محاسب": title with the article "المحاسب الأول"', position: 'محاسب', want: true, old: true,
            p: person({ occupation: 'المحاسب الأول' }) },
        { label: 'Arabic search "محاسب": feminine title "محاسبة" in a PAST job', position: 'محاسب', want: true, old: true,
            p: person({ occupation: 'مدير مالي', jobs: [{ title: 'مدير مالي', current: true }, { title: 'محاسبة' }] }) },
        { label: 'English "Sales Manager": Arabic title "مدير مبيعات" in a PAST job', position: 'Sales Manager', want: true,
            p: person({ occupation: 'Branch Manager at Example Co', jobs: [{ title: 'Branch Manager', current: true }, { title: 'مدير مبيعات' }] }) },
        { label: 'English "Accountant": Arabic feminine title "محاسبة"', position: 'Accountant', want: true,
            p: person({ occupation: 'محاسبة' }) },
        { label: 'English "HR Business Partner": Arabic "شريك أعمال" (not HR) is not it', position: 'HR Business Partner', want: false,
            p: person({ occupation: 'شريك أعمال إقليمي' }) },
        // Existing special families still apply, now to titles.
        { label: 'Field Engineer search: Oilfield Engineer', position: 'Field Engineer', want: true, old: true,
            p: person({ occupation: 'Oilfield Engineer at Example Co' }) },
        { label: 'Field Engineer search: a petroleum title kept by the family alone', position: 'Field Engineer', want: true, old: true,
            p: person({ occupation: 'Petroleum Operations Supervisor at Example Co' }) },
        { label: 'Compensation & Benefits search: Payroll Officer', position: 'Compensation and Benefits Specialist', want: true, old: true,
            p: person({ occupation: 'Payroll Officer at Example Co' }) },
        { label: 'Employee Relations search: Labor Relations Specialist', position: 'Employee Relations Manager', want: true, old: true,
            p: person({ occupation: 'Labor Relations Specialist at Example Co' }) },
        { label: 'Recruiter search: Talent Acquisition Partner', position: 'Recruiter', want: true, old: true,
            p: person({ occupation: 'Talent Acquisition Partner at Example Co' }) },
    ];

    console.log('\nBEHAVIOUR  (new decision; old decision shown where the case documents today)');
    for (const c of cases) {
        const now = kept(AFTER, c.position, c.p);
        const was = kept(BEFORE, c.position, c.p);
        const oldNote = c.old === undefined ? '' : `  [today: ${was ? 'kept' : 'dropped'}]`;
        check(`${c.label} -> ${c.want ? 'kept' : 'dropped'}${oldNote}`, now === c.want, `got ${now ? 'kept' : 'dropped'}`);
        if (c.old !== undefined) check(`   ...and today's gate really does ${c.old ? 'keep' : 'drop'} it`, was === c.old);
    }

    // ---- never throws: a searched word that is an Object.prototype name ----------
    console.log('\nROBUSTNESS');
    for (const position of ['Constructor', 'Road Constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
        let threw = '';
        let result: boolean | null = null;
        try { result = kept(AFTER, position, person({ occupation: 'Civil Engineer at Example Co' })); } catch (e) { threw = (e as Error).message; }
        check(`search "${position}" runs without throwing`, threw === '', threw);
        check(`   ...and does not keep an unrelated Civil Engineer`, result === false);
    }
    let threwOnOddTitles = '';
    try {
        kept(AFTER, 'Sales Manager', { full_name: 'Candidate X', public_identifier: 'candidate-x', country: 'IQ', city: 'Baghdad',
            occupation: 12345, headline: null, experiences: [{ title: null }, { title: 42 }, {}] } as unknown as Raw);
    } catch (e) { threwOnOddTitles = (e as Error).message; }
    check('null / number titles do not throw', threwOnOddTitles === '', threwOnOddTitles);

    // ---- identity: the gate is the ONLY change ----------------------------------
    console.log('\nIDENTITY');
    const batch = cases.filter((c) => c.position === 'Sales Manager').map((c) => c.p);
    const wh = { searchId: 'test-pos', position: 'Sales Manager', location: 'Baghdad, Iraq' };
    const o = runNode(BEFORE, wh, batch);
    const n = runNode(AFTER, wh, batch);
    check('same number of output rows', o.length === n.length);
    const both = o.map((r, i) => [r, n[i]] as const).filter(([a, b]) => !a.__skip && !b.__skip);
    check(`rows kept by both versions are byte-identical (${both.length})`,
        both.length > 0 && both.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b)));
    check('a dropped row is the same skip row as before',
        n.filter((r) => r.__skip).every((r) => JSON.stringify(r) === JSON.stringify({ __skip: true, searchId: 'test-pos', name: '' })));

    console.log('\n' + '='.repeat(94));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
