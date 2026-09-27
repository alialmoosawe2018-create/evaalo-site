// ============================================
// scripts/cv-docx-extraction-test.ts
// What the Stage 1 extractor reads from a Word CV — every part, not just the body.
//
// Measured 2026-09-27 (S45, before the legacy form was opened to Word): mammoth's
// raw text — the whole Word branch of extractTextFromCv — never read headers,
// footers or footnotes, and read a text box only through its legacy VML copy, so
// a modern box written without that copy vanished. The SAME CV saved as PDF kept
// all of it. extractTextFromCv now reads those parts itself; this test holds it.
//
// Every file here is SYNTHETIC, built part by part (lib/syntheticDocx.ts).
// Run: npm run test:cv-docx-extraction   — offline, no database, no network.
// ============================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractTextFromCv, MAX_CV_TEXT_CHARS } from '../services/cvTextExtractor.js';
import {
    buildSyntheticDocx,
    cell,
    footnoteReference,
    para,
    partParagraphs,
    run,
    table,
    textBoxAsWordWritesIt,
    textBoxAsWordWritesItRuns,
    textBoxChoiceOnly,
    textBoxChoiceOnlyLines,
    textBoxDirect,
    textBoxVmlOnly,
} from './lib/syntheticDocx.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}
const flat = (s: string) => s.replace(/\s+/g, ' ');
const count = (hay: string, needle: string) => flat(hay).split(needle).length - 1;
const at = (hay: string, needle: string) => flat(hay).indexOf(needle);
const extract = (buf: Buffer, name = 'cv.docx', mime = DOCX) => extractTextFromCv(buf, mime, name);

async function main(): Promise<void> {
    // ── A: every place a CV template puts text ──────────────────────────────
    const layout = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-NAME Synthetic Candidate — HR Officer'])],
        footers: [partParagraphs(['FTR-CONTACT synthetic@example.com +964 7800000005'])],
        footnotes: ['FOOTNOTE-TEXT references available on request'],
        body: [
            para('BODY-START Synthetic Candidate profile'),
            table([
                cell(para('TBL-R1C1 Company')) + cell(para('TBL-R1C2 الشركة', true)) + cell(para('TBL-R1C3 2024')),
                cell(para('TBL-R2-MERGED spans two columns'), '<w:gridSpan w:val="2"/>') + cell(para('TBL-R2C3')),
            ]),
            textBoxAsWordWritesIt('TXBX-WORD modern box with its VML copy'),
            textBoxChoiceOnly('TXBX-CHOICE-ONLY modern box without a copy'),
            textBoxDirect('TXBX-DIRECT bare drawing box'),
            textBoxVmlOnly('TXBX-VML-ONLY legacy box'),
            `<w:p>${run('FOOTNOTE-ANCHOR see note')}${footnoteReference(1)}</w:p>`,
            para('BODY-END last line'),
        ].join(''),
    });
    const a = await extract(layout);

    await test('the header is read, and put first (where templates put the name and title)', () => {
        assert.equal(count(a, 'HDR-NAME'), 1, a);
        assert.ok(at(a, 'HDR-NAME') < at(a, 'BODY-START'), 'header must come before the body');
    });
    await test('the footer is read, after the body', () => {
        assert.equal(count(a, 'FTR-CONTACT synthetic@example.com +964 7800000005'), 1);
        assert.ok(at(a, 'FTR-CONTACT') > at(a, 'BODY-END'));
    });
    await test('the footnote is read', () => assert.equal(count(a, 'FOOTNOTE-TEXT'), 1));
    await test('a text box WITHOUT its VML copy is read (was lost)', () => assert.equal(count(a, 'TXBX-CHOICE-ONLY'), 1));
    await test('a bare drawing text box is read (was lost)', () => assert.equal(count(a, 'TXBX-DIRECT'), 1));
    await test('a text box as Word writes it appears exactly ONCE (its two copies are not doubled)', () =>
        assert.equal(count(a, 'TXBX-WORD'), 1));
    await test('a legacy VML text box appears once', () => assert.equal(count(a, 'TXBX-VML-ONLY'), 1));
    await test('tables are read once, in order, merged cell included', () => {
        for (const m of ['TBL-R1C1', 'TBL-R1C2 الشركة', 'TBL-R1C3', 'TBL-R2-MERGED', 'TBL-R2C3']) assert.equal(count(a, m), 1, m);
        assert.ok(at(a, 'TBL-R1C1') < at(a, 'TBL-R2-MERGED'));
    });
    await test('the body keeps its order and stays between header and footer', () => {
        const order = ['HDR-NAME', 'BODY-START', 'TBL-R1C1', 'TXBX-WORD', 'FOOTNOTE-ANCHOR', 'BODY-END', 'FTR-CONTACT'];
        const pos = order.map((m) => at(a, m));
        assert.deepEqual([...pos].sort((x, y) => x - y), pos, `positions ${pos.join(',')}`);
    });

    // ── B: an all-Arabic CV ────────────────────────────────────────────────
    const arabic = await buildSyntheticDocx({
        rtl: true,
        headers: [partParagraphs(['زهرة اصطناعية — مسؤولة موارد بشرية'], true)],
        footers: [partParagraphs(['بغداد، الكرادة — هاتف ٠٧٨٠٠٠٠٠٠٠٦'], true)],
        body: [
            para('الملف الشخصي: خبرة ٣ سنوات في التوظيف والتدريب لا سيما في قطاع التجزئة', true),
            table([cell(para('الشركة', true)) + cell(para('المسمى الوظيفي', true)) + cell(para('٢٠٢٢ – ٢٠٢٣', true))], true),
            textBoxChoiceOnly('الشهادات: دبلوم إدارة الموارد البشرية', true),
        ].join(''),
    });
    const b = await extract(arabic);
    await test('Arabic header, footer (Arabic-Indic digits) and box text come out character for character', () => {
        for (const s of ['زهرة اصطناعية — مسؤولة موارد بشرية', 'بغداد، الكرادة — هاتف ٠٧٨٠٠٠٠٠٠٠٦', 'الشهادات: دبلوم إدارة الموارد البشرية',
            'الملف الشخصي: خبرة ٣ سنوات في التوظيف والتدريب لا سيما في قطاع التجزئة', 'المسمى الوظيفي', '٢٠٢٢ – ٢٠٢٣']) {
            assert.equal(count(b, s), 1, s);
        }
        assert.equal((b.match(/[\uFB50-\uFDFF\uFE70-\uFEFF\u202A-\u202E]/g) || []).length, 0, 'no presentation forms or bidi controls');
    });

    // ── C: nothing extra to read ⇒ exactly what mammoth read before ─────────
    const plain = await buildSyntheticDocx({ body: para('PLAIN-ONLY a body with nothing else') + para('second line') });
    await test('a plain Word CV comes out exactly as before', async () => {
        const before = (await mammoth.extractRawText({ buffer: plain })).value.trim();
        assert.equal(await extract(plain), before);
    });

    // ── D: repetition and noise are not added ──────────────────────────────
    const repeated = await buildSyntheticDocx({
        headers: [partParagraphs(['Synthetic Candidate HR Officer']), partParagraphs(['Synthetic Candidate HR Officer'])],
        footers: [partParagraphs(['1'])],
        body: para('Synthetic Candidate HR Officer') + para('BODY with the name already in it'),
    });
    const d = await extract(repeated);
    await test('a header already in the body is not repeated', () =>
        assert.equal(count(d, 'Synthetic Candidate HR Officer'), 1, d));
    await test('a page-number footer is layout, not content — not added', () => assert.ok(!/(^|\n)1\s*$/.test(d), d));

    const shortName = await buildSyntheticDocx({
        headers: [partParagraphs(['Zed'])],
        body: para('Zedoary supply chain and HR reporting'),
    });
    await test('a short header is not mistaken for part of a word in the body ("Zed" vs "Zedoary")', async () =>
        assert.ok(/(^|\n)Zed(\n|$)/.test(await extract(shortName))));

    const headerBox = await buildSyntheticDocx({
        headers: [textBoxAsWordWritesIt('HDR-BOX name inside a header text box')],
        body: para('BODY text'),
    });
    await test('a text box inside a header is read once', async () =>
        assert.equal(count(await extract(headerBox), 'HDR-BOX'), 1));

    // ── E: the extra read can never break or bloat extraction ──────────────
    const broken = await buildSyntheticDocx({
        headers: [`<w:p>${'<w:r><w:t>HDR-BROKEN &#x110000; bad entity</w:t></w:r>'}</w:p>`],
        footers: [partParagraphs(['FTR-SURVIVES the footer is fine'])],
        body: para('BODY-SURVIVES the broken header'),
    });
    await test('a header that cannot be decoded costs the header only — body and footer still come out', async () => {
        const out = await extract(broken);
        assert.ok(out.includes('BODY-SURVIVES'), out);
        assert.ok(out.includes('FTR-SURVIVES'), out);
        assert.ok(!out.includes('HDR-BROKEN'));
    });

    const long = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-LONG header line'])],
        body: Array.from({ length: 900 }, (_, i) => para(`LINE-${i} experience text for a long synthetic CV`)).join(''),
    });
    await test(`the ${MAX_CV_TEXT_CHARS}-character cap holds, and a body past it keeps its place (no header pushes it)`, async () => {
        const out = await extract(long);
        assert.ok(out.length <= MAX_CV_TEXT_CHARS, `length ${out.length}`);
        assert.ok(out.startsWith('LINE-0'), 'the body starts the text');
        assert.ok(!out.includes('HDR-LONG'));
    });
    const nearCap = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-NEAR ' + 'header words '.repeat(40)])],
        body: para('BODY-START ' + 'x'.repeat(19_700) + ' BODY-END-KEPT'),
    });
    await test('a body just under the cap loses nothing to the header — the header takes only what is left', async () => {
        const out = await extract(nearCap);
        assert.ok(out.includes('BODY-END-KEPT'), 'the last words of the body survive');
        assert.ok(out.length <= MAX_CV_TEXT_CHARS);
    });
    const fiveParagraphHeader = await buildSyntheticDocx({
        headers: [partParagraphs(Array.from({ length: 5 }, (_, i) => `HDR-P${i} ` + 'w'.repeat(400)))],
        body: para('BODY-FIVE a short body'),
    });
    await test('the 1,000-character header budget holds across several header paragraphs', async () => {
        const out = await extract(fiveParagraphHeader);
        assert.ok(out.indexOf('BODY-FIVE') <= 1_010, `before body: ${out.indexOf('BODY-FIVE')}`);
    });

    // ── G: anyone can upload a Word file without signing in — bounded work ─
    // The attack shape: a header part that is not XML at all — mammoth never reads
    // headers, so nothing else rejects it — made of unclosed tags with NO '>'
    // anywhere after them. A tag pattern that may cross '<' retries every '<'
    // against the rest of the part: measured 608ms at 32k repetitions and
    // quadratic, i.e. ~13s at 150k and minutes near the 2MB part limit.
    // A sentinel paragraph BEFORE the junk proves the part was actually scanned
    // (a skipped part would pass the timing for the wrong reason).
    const trapDocx = async (repetitions: number) => {
        const zip = await JSZip.loadAsync(
            await buildSyntheticDocx({ headers: [partParagraphs(['HDR placeholder'])], body: para('BODY-AFTER-TRAP still read') }),
        );
        zip.file('word/header1.xml', '<w:p><w:r><w:t>HDR-SENTINEL scanned</w:t></w:r></w:p>' + '<a '.repeat(repetitions));
        return zip.generateAsync({ type: 'nodebuffer' });
    };
    const timed = async (buf: Buffer) => {
        let best = Infinity;
        let out = '';
        for (let i = 0; i < 3; i += 1) {
            const started = Date.now();
            out = await extract(buf);
            best = Math.min(best, Date.now() - started);
        }
        return { ms: best, out };
    };
    await test('a header of unclosed tags with no ">" is scanned in one pass, not quadratically', async () => {
        const small = await timed(await trapDocx(40_000));
        const large = await timed(await trapDocx(160_000));
        assert.ok(large.ms < 3000, `took ${large.ms}ms`);
        assert.ok(large.out.includes('HDR-SENTINEL') && large.out.includes('BODY-AFTER-TRAP'), 'the part was read');
        // 4x the input: linear stays near 4x, quadratic near 16x.
        assert.ok(large.ms <= Math.max(8 * small.ms, 150), `40k: ${small.ms}ms, 160k: ${large.ms}ms`);
    });
    const bigHeader = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-BIG ' + 'long header text '.repeat(400)])],
        body: para('BODY-KEPT whole ' + 'experience detail '.repeat(1000)),
    });
    await test('a header cannot push the body out: at most 1,000 characters go before it', async () => {
        const out = await extract(bigHeader);
        const headerPart = out.slice(0, out.indexOf('BODY-KEPT'));
        assert.ok(headerPart.length <= 1_010, `header part ${headerPart.length}`);
        assert.ok(out.includes('BODY-KEPT'));
    });
    const oversized = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-OVERSIZED ' + 'x'.repeat(2_200_000)])],
        body: para('BODY next to an oversized header'),
    });
    await test('a header part over 2MB is skipped, not inflated', async () => assert.ok(!(await extract(oversized)).includes('HDR-OVERSIZED')));
    const manySections = await buildSyntheticDocx({
        sectionHeaders: Array.from({ length: 14 }, (_, i) => partParagraphs([`HDR-SEC-${String(i).padStart(2, '0')} section header`])),
        body: para('BODY of a document with many sections'),
    });
    await test('at most 12 header/footer parts are read', async () => {
        const out = await extract(manySections);
        assert.ok(out.includes('HDR-SEC-00') && out.includes('HDR-SEC-11'), out.slice(0, 400));
        assert.ok(!out.includes('HDR-SEC-12') && !out.includes('HDR-SEC-13'));
    });

    // ── H: only what Word SHOWS, with its characters intact ────────────────
    const firstPage = (titlePage: boolean) =>
        buildSyntheticDocx({
            titlePage,
            headers: [partParagraphs(['HDR-DEFAULT shown on every page']), partParagraphs(['HDR-FIRSTPAGE template first-page header'])],
            orphanHeaders: [partParagraphs(['HDR-ORPHAN template author left over'])],
            body: para('BODY of a template-based CV'),
        });
    await test('a first-page header is read only when "different first page" is on', async () => {
        const off = await extract(await firstPage(false));
        const on = await extract(await firstPage(true));
        assert.ok(off.includes('HDR-DEFAULT') && !off.includes('HDR-FIRSTPAGE'), off);
        assert.ok(on.includes('HDR-FIRSTPAGE'), on);
    });
    await test('a header part no section points to (template leftover) is not read', async () =>
        assert.ok(!(await extract(await firstPage(true))).includes('HDR-ORPHAN')));

    const softBreak = await buildSyntheticDocx({
        body:
            para('BODY-SOFTBR contact box below') +
            textBoxAsWordWritesItRuns(`${run('SOFTBR Email: synthetic@example.com')}<w:r><w:br/></w:r>${run('Phone: 07800000009')}`),
    });
    await test('a Word text box with a soft line break (Shift+Enter) appears once, not twice', async () =>
        assert.equal(count(await extract(softBreak), 'SOFTBR Email'), 1));

    const characters = await buildSyntheticDocx({
        headers: [
            '<w:p><w:r><w:t>HDR-HY Al</w:t><w:noBreakHyphen/><w:t>Synthetic</w:t>' +
                '<w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/><w:t>Testville</w:t></w:r></w:p>' +
                '<w:p><w:r><w:t>HDR-TAB Name</w:t><w:tab/><w:t>Phone</w:t><w:cr/><w:t>Email</w:t></w:r></w:p>' +
                para('HDR-ENT R&D Officer <Senior> "HR"'),
        ],
        endnotes: ['ENDNOTE-TEXT awards and memberships'],
        body: para('BODY with a formatted header'),
    });
    const ch = await extract(characters);
    await test('a non-breaking hyphen, a positional tab, a tab and a carriage return in a header are kept', () => {
        assert.ok(ch.includes('Al-Synthetic'), ch);
        assert.ok(!ch.includes('SyntheticTestville'), 'the positional tab separates the words');
        assert.ok(!ch.includes('NamePhone') && !ch.includes('PhoneEmail'), 'tab and carriage return separate the words');
    });
    await test('XML entities in a header are decoded (&, <, >, ")', () => assert.ok(ch.includes('R&D Officer <Senior> "HR"'), ch));
    await test('endnotes are read', () => assert.equal(count(ch, 'ENDNOTE-TEXT'), 1));

    // ── I: layout is not content, and it cannot fake a CV ──────────────────
    const pageFooters = await buildSyntheticDocx({
        footers: [partParagraphs(['Page 1 of 2', 'صفحة ٢ من ٥', '- 3 -'])],
        body: para('BODY-PAGES a real CV body'),
    });
    await test('page-number footers ("Page 1 of 2", "صفحة ٢ من ٥", "- 3 -") are not added', async () => {
        const out = await extract(pageFooters);
        for (const s of ['Page 1 of 2', 'صفحة ٢ من ٥', '- 3 -']) assert.ok(!out.includes(s), `${s} in ${JSON.stringify(out)}`);
    });
    const imageOnly = await buildSyntheticDocx({
        footers: [partParagraphs(['FTR-ONLY a letterhead under a scanned CV'])],
        body: '<w:p/>',
    });
    await test('a header or footer alone does not turn an empty (scanned) CV into text — still EMPTY_CV', async () => {
        await assert.rejects(extract(imageOnly), (err: { code?: string }) => err.code === 'EMPTY_CV');
    });
    const boxOnly = await buildSyntheticDocx({ body: textBoxChoiceOnly('TXBX-ONLY the whole CV sits in a modern text box') });
    await test('a CV that lives entirely in a modern text box is read, not reported empty', async () =>
        assert.ok((await extract(boxOnly)).includes('TXBX-ONLY')));

    // ── J: second review (2026-09-27) — cost bounded by what is KEPT, not by the upload
    // U+FDFA expands 18-fold under NFKC: comparing the WHOLE body measured 5.1s and
    // 736MB heap on this file, the windowed comparison 166ms and 50MB.
    const hugeBody = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-HUGE header of a huge body'])],
        body: para('BODY-HUGE ' + String.fromCharCode(0xfdfa).repeat(1_400_000)),
    });
    await test('a huge body is compared only where it can survive the cap (fast, bounded memory)', async () => {
        const started = Date.now();
        const out = await extract(hugeBody);
        assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
        assert.ok(out.startsWith('BODY-HUGE') && out.length <= MAX_CV_TEXT_CHARS);
    });
    // The costly shape: a short header line that occurs thousands of times INSIDE
    // other words of the body ("Zed" in "Zedoary"), so every whole-phrase check
    // walks every occurrence — repeated for thousands of header lines.
    const repeatedHeaderLines = await buildSyntheticDocx({
        headers: [partParagraphs(Array.from({ length: 12_000 }, () => 'Zed'))],
        body: para('Zedoary '.repeat(100_000) + 'Zed'),
    });
    await test('thousands of header lines matching inside body words do not each rescan the body (fast)', async () => {
        const started = Date.now();
        await extract(repeatedHeaderLines);
        assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`);
    });
    const bomb = await buildSyntheticDocx({ body: para('BOMB ' + 'z'.repeat(6 * 1024 * 1024)) });
    await test('a document body over 5MB is refused before mammoth reads it', async () => {
        const started = Date.now();
        await assert.rejects(extract(bomb), (err: { code?: string }) => err.code === 'PARSE_FAILED');
        assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`);
    });

    const boxCv = await buildSyntheticDocx({
        body: textBoxChoiceOnlyLines(['Accountant', 'Company A 2016/2019', 'Accountant', 'Company B 2019/2023', 'HR', 'C#', '2015', '07801234567']),
    });
    await test('a CV built in a modern text box keeps every line — dates, short skills, a repeated title', async () => {
        const out = await extract(boxCv);
        for (const s of ['Company A 2016/2019', 'Company B 2019/2023', 'HR', 'C#', '2015', '07801234567']) assert.ok(out.includes(s), `${s} in ${JSON.stringify(out)}`);
        assert.equal(count(out, 'Accountant'), 2, 'both jobs keep their title');
    });
    const symbolBox = await buildSyntheticDocx({
        body:
            para('BODY-SYM contact box below') +
            textBoxAsWordWritesItRuns(`<w:r><w:sym w:font="Wingdings" w:char="F028"/></w:r>${run('SYMBOX Phone 07801234567 Email synthetic@example.com')}`),
    });
    await test('a Word text box with a symbol icon appears once, not twice', async () =>
        assert.equal(count(await extract(symbolBox), 'SYMBOX'), 1));
    const choiceVsFallback = await buildSyntheticDocx({
        headers: [
            '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>' +
                para('HDR-CHOICE the modern copy') +
                '</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>' +
                para('HDR-FALLBACK-ONLY the legacy copy') +
                '</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>',
        ],
        body: para('BODY of a header-box CV'),
    });
    await test('in a header, a box is read from its modern copy only — the VML copy is skipped', async () => {
        const out = await extract(choiceVsFallback);
        assert.ok(out.includes('HDR-CHOICE') && !out.includes('HDR-FALLBACK-ONLY'), out);
    });
    const twoSectionsSameHeader = await buildSyntheticDocx({
        sectionHeaders: [partParagraphs(['HDR-SAME the same line in two sections']), partParagraphs(['HDR-SAME the same line in two sections'])],
        body: para('BODY of a two-section CV'),
    });
    await test('the same header line from two sections appears once', async () =>
        assert.equal(count(await extract(twoSectionsSameHeader), 'HDR-SAME'), 1));
    await test("a drawing's positions and sizes never leak into the text (only w:t is text) — body or header", async () => {
        const header = await extract(headerBox);
        for (const n of ['1143000', '4572001', '2743200', '914400']) {
            assert.ok(!a.includes(n), `${n} leaked from the body`);
            assert.ok(!header.includes(n), `${n} leaked from a header drawing`);
        }
    });
    const noisyFooter = await buildSyntheticDocx({
        footers: [partParagraphs([...Array.from({ length: 3_000 }, (_, i) => String(i + 1)), 'FTR-AFTER-NOISE a real footer line'])],
        body: para('BODY-NOISE'),
    });
    await test('work is capped at 2,000 examined paragraphs — a line after 3,000 noise lines is not reached', async () =>
        assert.ok(!(await extract(noisyFooter)).includes('FTR-AFTER-NOISE')));

    const evenPage = (evenAndOdd: boolean) =>
        buildSyntheticDocx({ evenAndOdd, evenHeader: partParagraphs(['HDR-EVEN even-page header']), headers: [partParagraphs(['HDR-ODD default'])], body: para('BODY') });
    await test('an even-page header is read only when odd/even headers are on', async () => {
        assert.ok(!(await extract(await evenPage(false))).includes('HDR-EVEN'));
        assert.ok((await extract(await evenPage(true))).includes('HDR-EVEN'));
    });
    await test('w:titlePg w:val="0" means "different first page" is OFF', async () => {
        const off = await buildSyntheticDocx({
            titlePageValue: '0',
            headers: [partParagraphs(['HDR-D default']), partParagraphs(['HDR-F-OFF first page, switched off'])],
            body: para('BODY'),
        });
        assert.ok(!(await extract(off)).includes('HDR-F-OFF'));
    });
    for (const targetStyle of ['absolute', 'dot'] as const) {
        await test(`a relationship target written as ${targetStyle === 'absolute' ? '/word/header1.xml' : './header1.xml'} still finds the header`, async () => {
            const doc = await buildSyntheticDocx({ targetStyle, headers: [partParagraphs(['HDR-TARGET found'])], body: para('BODY') });
            assert.ok((await extract(doc)).includes('HDR-TARGET'));
        });
    }
    const refs = '<w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/>';
    const inherited = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-D inherited default']), partParagraphs(['HDR-F-INHERITED first page from an earlier section'])],
        rawSectionsBefore: `<w:p><w:pPr><w:sectPr>${refs}</w:sectPr></w:pPr></w:p>`,
        finalSectPrInner: '<w:titlePg/>',
        body: para('BODY of a two-section CV'),
    });
    await test('a section inherits the previous section’s headers (first page shown once titlePg is on)', async () =>
        assert.ok((await extract(inherited)).includes('HDR-F-INHERITED')));
    const trackedLayout = await buildSyntheticDocx({
        headers: [partParagraphs(['HDR-D default']), partParagraphs(['HDR-F-TRACKED first page only in the OLD layout'])],
        finalSectPrInner: `${refs}<w:sectPrChange w:id="1" w:author="Synthetic"><w:sectPr><w:titlePg/></w:sectPr></w:sectPrChange>`,
        body: para('BODY'),
    });
    await test('a tracked layout change (w:sectPrChange) is the old state — its titlePg does not count', async () =>
        assert.ok(!(await extract(trackedLayout)).includes('HDR-F-TRACKED')));
    const capWithFooter = await buildSyntheticDocx({
        sectionHeaders: Array.from({ length: 14 }, (_, i) => partParagraphs([`HDR-CAP-${i} section header`])),
        footers: [partParagraphs(['FTR-OVER-CAP footer after twelve parts'])],
        body: para('BODY'),
    });
    await test('footers share the 12-part cap with headers', async () =>
        assert.ok(!(await extract(capWithFooter)).includes('FTR-OVER-CAP')));
    const headerOnly = await buildSyntheticDocx({ headers: [partParagraphs(['HDR-LETTERHEAD over a scanned CV'])], body: '<w:p/>' });
    await test('a header alone does not turn an empty (scanned) CV into text — still EMPTY_CV', async () =>
        assert.rejects(extract(headerOnly), (err: { code?: string }) => err.code === 'EMPTY_CV'));
    const phoneFooter = await buildSyntheticDocx({ footers: [partParagraphs(['07801234567'])], body: para('BODY-PHONE') });
    await test('a footer that is only a phone number is kept (a page number is 1-4 digits)', async () =>
        assert.ok((await extract(phoneFooter)).includes('07801234567')));
    const nbHyphen = String.fromCharCode(0x2011);
    const hyphenVariant = await buildSyntheticDocx({
        headers: [partParagraphs([`Al${nbHyphen}Synthetic Recruitment Officer`])],
        body: para('Al-Synthetic Recruitment Officer') + para('BODY-HYPHEN'),
    });
    await test('a header that differs from the body only by a non-breaking hyphen is not repeated', async () =>
        assert.equal(count(await extract(hyphenVariant), 'Synthetic Recruitment Officer'), 1));
    await test('a PDF labelled text/plain is read as a PDF, not as raw bytes (one type rule)', async () => {
        const pdf = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'certificate-good.synthetic.pdf'));
        const out = await extractTextFromCv(pdf, 'text/plain', 'cv.pdf');
        assert.ok(!out.startsWith('%PDF'), out.slice(0, 40));
    });

    // ── F: the file type decides by extension when the browser says nothing ─
    await test('a Word CV sent as application/octet-stream is still read as Word', async () => {
        const out = await extract(layout, 'cv.docx', 'application/octet-stream');
        assert.ok(out.includes('TXBX-CHOICE-ONLY') && out.includes('HDR-NAME'));
    });

    console.log(`\n[cv-docx-extraction] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
