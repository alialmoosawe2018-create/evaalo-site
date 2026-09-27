// ============================================
// scripts/lib/syntheticDocx.ts
// Builds SYNTHETIC .docx files for tests — the XML in the shape Microsoft Word
// writes it, so a test can put text exactly where real CVs put it: tables, the
// four kinds of text box, headers, footers, footnotes, right-to-left Arabic.
//
// Why hand-built: the question is what the extractor reads from each PART of a
// Word file, and a generator library would hide which part a text landed in.
// Every file is synthetic; no real CV is ever used in a test.
// ============================================
import JSZip from 'jszip';

const NS = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
    'xmlns:v="urn:schemas-microsoft-com:vml"',
    'xmlns:o="urn:schemas-microsoft-com:office:office"',
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
    'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"',
    'mc:Ignorable="w14 wp14"',
].join(' ');

export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const run = (text: string, rtl = false): string =>
    `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

export const para = (text: string, rtl = false): string =>
    `<w:p>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}${run(text, rtl)}</w:p>`;

export const cell = (inner: string, extraProps = ''): string =>
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${extraProps}</w:tcPr>${inner}</w:tc>`;

export const table = (rows: string[], rtl = false): string =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${rtl ? '<w:bidiVisual/>' : ''}</w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    rows.map((r) => `<w:tr>${r}</w:tr>`).join('') +
    '</w:tbl>';

let shapeCounter = 0;
const txbxContent = (text: string, rtl: boolean) => `<w:txbxContent>${para(text, rtl)}</w:txbxContent>`;

const drawingTextBox = (text: string, rtl: boolean): string => {
    shapeCounter += 1;
    const id = shapeCounter;
    return (
        `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
        // Real positions and sizes, as Word writes them: numbers that must never
        // leak into the CV text (only w:t is text).
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>1143000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>-4572001</wp:posOffset></wp:positionV><wp:extent cx="2743200" cy="914400"/>' +
        `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${id}" name="Text Box ${id}"/><wp:cNvGraphicFramePr/>` +
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/>' +
        '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
        `<wps:txbx>${txbxContent(text, rtl)}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
    );
};

const vmlTextBox = (text: string, rtl: boolean): string => {
    shapeCounter += 1;
    return (
        `<w:pict><v:shape id="Text Box ${shapeCounter}" o:spid="_x0000_s10${shapeCounter}" type="#_x0000_t202" style="position:absolute;width:157pt;height:39pt">` +
        `<v:textbox>${txbxContent(text, rtl)}</v:textbox></v:shape></w:pict>`
    );
};

/** What Word 2010+ writes: the DrawingML box in mc:Choice and a VML copy in mc:Fallback. */
export const textBoxAsWordWritesIt = (text: string, rtl = false): string =>
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawingTextBox(text, rtl)}</mc:Choice>` +
    `<mc:Fallback>${vmlTextBox(text, rtl)}</mc:Fallback></mc:AlternateContent></w:r></w:p>`;

/**
 * The same Word-style box (Choice + VML copy) around a paragraph given as raw
 * runs — for soft line breaks (<w:br/>), tabs and the like inside a box.
 */
export const textBoxAsWordWritesItRuns = (runsXml: string): string => {
    shapeCounter += 1;
    const id = shapeCounter;
    const content = `<w:txbxContent><w:p>${runsXml}</w:p></w:txbxContent>`;
    return (
        `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="2000000" cy="500000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${id}" name="Text Box ${id}"/><wp:cNvGraphicFramePr/>` +
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr/>' +
        `<wps:txbx>${content}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
        `<mc:Fallback><w:pict><v:shape id="Text Box ${id}" type="#_x0000_t202"><v:textbox>${content}</v:textbox></v:shape></w:pict></mc:Fallback>` +
        '</mc:AlternateContent></w:r></w:p>'
    );
};

/** A modern box with no VML copy holding several lines (paragraphs) — a CV built in boxes. */
export const textBoxChoiceOnlyLines = (lines: string[]): string => {
    shapeCounter += 1;
    const id = shapeCounter;
    return (
        `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="2000000" cy="500000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${id}" name="Text Box ${id}"/><wp:cNvGraphicFramePr/>` +
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr/>' +
        `<wps:txbx><w:txbxContent>${lines.map((l) => para(l)).join('')}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
        '</mc:AlternateContent></w:r></w:p>'
    );
};

/** A modern box with no VML copy — mammoth alone loses it. */
export const textBoxChoiceOnly = (text: string, rtl = false): string =>
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawingTextBox(text, rtl)}</mc:Choice></mc:AlternateContent></w:r></w:p>`;

/** A bare drawing with no compatibility wrapper — mammoth alone loses it. */
export const textBoxDirect = (text: string, rtl = false): string => `<w:p><w:r>${drawingTextBox(text, rtl)}</w:r></w:p>`;

/** The legacy VML box only (old Word). */
export const textBoxVmlOnly = (text: string, rtl = false): string => `<w:p><w:r>${vmlTextBox(text, rtl)}</w:r></w:p>`;

export interface SyntheticDocxSpec {
    /** Raw WordprocessingML for <w:body> (use the helpers above). */
    body: string;
    /**
     * Raw XML for each header part (word/header1.xml, header2.xml, …). The first
     * is the section's default header, the second its first-page header — shown
     * by Word only when `titlePage` is set.
     */
    headers?: string[];
    footers?: string[];
    /** Word's "different first page" switch (w:titlePg) on the final section. */
    titlePage?: boolean;
    /** Header parts that exist in the file but no section points to (template leftovers). */
    orphanHeaders?: string[];
    /** Extra sections before the final one, each with its own default header. */
    sectionHeaders?: string[];
    /** Footnote paragraphs' text, one footnote each. */
    footnotes?: string[];
    endnotes?: string[];
    /** An even-page header part, referenced from the final section. */
    evenHeader?: string;
    /** settings.xml turns on different odd/even headers. */
    evenAndOdd?: boolean;
    /** Write <w:titlePg w:val="…"/> instead of <w:titlePg/> (e.g. "0" = off). */
    titlePageValue?: string;
    /** How relationship targets are written: header1.xml | ./header1.xml | /word/header1.xml. */
    targetStyle?: 'relative' | 'dot' | 'absolute';
    /** Raw section-break paragraphs placed before the body (each carries a <w:sectPr>). */
    rawSectionsBefore?: string;
    /** Replaces the final section's references entirely (the page size is kept). */
    finalSectPrInner?: string;
    rtl?: boolean;
}

/** Paragraph markup for a header/footer made of plain lines. */
export const partParagraphs = (lines: string[], rtl = false): string => lines.map((l) => para(l, rtl)).join('');

export async function buildSyntheticDocx(spec: SyntheticDocxSpec): Promise<Buffer> {
    const zip = new JSZip();
    const shown = spec.headers ?? [];
    const orphans = spec.orphanHeaders ?? [];
    const sectionHeaders = spec.sectionHeaders ?? [];
    // One numbering for every header part: shown ones, leftovers, per-section ones, the even one.
    const headers = [...shown, ...orphans, ...sectionHeaders, ...(spec.evenHeader ? [spec.evenHeader] : [])];
    const evenHeaderId = spec.evenHeader ? headers.length : 0;
    const target = (name: string) =>
        spec.targetStyle === 'absolute' ? `/word/${name}` : spec.targetStyle === 'dot' ? `./${name}` : name;
    const footers = spec.footers ?? [];
    const footnotes = spec.footnotes ?? [];
    const endnotes = spec.endnotes ?? [];
    const overrides = [
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        ...headers.map((_, i) => `<Override PartName="/word/header${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`),
        ...footers.map((_, i) => `<Override PartName="/word/footer${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`),
        ...(footnotes.length ? ['<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'] : []),
        ...(endnotes.length ? ['<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'] : []),
    ];
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            overrides.join('') +
            '</Types>',
    );
    zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    const rels = [
        ...headers.map((_, i) => `<Relationship Id="rIdH${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="${target(`header${i + 1}.xml`)}"/>`),
        ...footers.map((_, i) => `<Relationship Id="rIdF${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="${target(`footer${i + 1}.xml`)}"/>`),
        ...(footnotes.length ? ['<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'] : []),
        ...(endnotes.length ? ['<Relationship Id="rIdE" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>'] : []),
    ];
    zip.file(
        'word/_rels/document.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    );
    headers.forEach((xml, i) => zip.file(`word/header${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${xml}</w:hdr>`));
    footers.forEach((xml, i) => zip.file(`word/footer${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${xml}</w:ftr>`));
    const notesPart = (kind: 'footnote' | 'endnote', texts: string[]) =>
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s ${NS}>` +
        `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
        `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
        texts.map((t, i) => `<w:${kind} w:id="${i + 1}"><w:p><w:r><w:${kind}Ref/></w:r>${run(' ' + t, spec.rtl)}</w:p></w:${kind}>`).join('') +
        `</w:${kind}s>`;
    if (footnotes.length) zip.file('word/footnotes.xml', notesPart('footnote', footnotes));
    if (endnotes.length) zip.file('word/endnotes.xml', notesPart('endnote', endnotes));
    if (spec.evenAndOdd) {
        zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:evenAndOddHeaders/></w:settings>`);
    }
    // Earlier sections: a section-break paragraph carrying that section's own sectPr.
    const sectionBreaks = sectionHeaders
        .map((_, i) => {
            const id = shown.length + orphans.length + i + 1;
            return `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdH${id}"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p>`;
        })
        .join('');
    // The final section: the first shown header is the default, the second the
    // first-page one (Word shows it only with w:titlePg). Orphans get no reference.
    const refs =
        shown.map((_, i) => `<w:headerReference w:type="${i === 0 ? 'default' : 'first'}" r:id="rIdH${i + 1}"/>`).join('') +
        (evenHeaderId ? `<w:headerReference w:type="even" r:id="rIdH${evenHeaderId}"/>` : '') +
        footers.map((_, i) => `<w:footerReference w:type="${i === 0 ? 'default' : 'first'}" r:id="rIdF${i + 1}"/>`).join('');
    const titlePg =
        spec.titlePageValue !== undefined ? `<w:titlePg w:val="${spec.titlePageValue}"/>` : spec.titlePage ? '<w:titlePg/>' : '';
    const finalInner = spec.finalSectPrInner ?? `${refs}${titlePg}`;
    zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${spec.rawSectionsBefore ?? ''}${sectionBreaks}${spec.body}` +
            `<w:sectPr>${finalInner}<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    );
    return zip.generateAsync({ type: 'nodebuffer' });
}

/** Footnote reference run for a body paragraph. */
export const footnoteReference = (id: number): string => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
