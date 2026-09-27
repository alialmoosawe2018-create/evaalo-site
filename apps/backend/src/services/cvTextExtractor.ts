/**
 * Extracts plain text from an uploaded CV buffer (PDF / DOCX / TXT).
 *
 * Intentionally does NOT persist the file — the buffer stays in memory and the
 * extracted text is returned to the caller, which passes it to the LLM and drops
 * it. CVs are personal data; we avoid writing them to disk or logs.
 */

// pdf-parse ships a debug harness in its index; import the library entry directly.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import path from 'node:path';
import JSZip from 'jszip';
import { classifyCvUpload } from '../shared/formTemplates/types.js';

export class CvExtractionError extends Error {
    readonly code: 'UNSUPPORTED_TYPE' | 'EMPTY_CV' | 'PARSE_FAILED';

    constructor(code: CvExtractionError['code'], message: string) {
        super(message);
        this.name = 'CvExtractionError';
        this.code = code;
    }
}

/** Upper bound on characters sent downstream — keeps LLM cost/latency bounded. */
export const MAX_CV_TEXT_CHARS = 20000;

/**
 * The extractor reads what the upload check accepted — the one CV rule
 * (classifyCvUpload): the type decides, the extension decides when the browser
 * said nothing (octet-stream, no type), and "text/plain" does not turn a .pdf or
 * .docx into text.
 */
export function isSupportedCvMime(mime: string, filename?: string): boolean {
    return classifyCvUpload(mime, filename) !== null;
}

function classify(mime: string, filename?: string): 'pdf' | 'docx' | 'txt' | null {
    return classifyCvUpload(mime, filename);
}

/** Collapse excessive whitespace and cap length. */
function normalize(text: string): string {
    const cleaned = (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return cleaned.length > MAX_CV_TEXT_CHARS ? cleaned.slice(0, MAX_CV_TEXT_CHARS) : cleaned;
}

// ── What mammoth's raw text never reads in a .docx ─────────────────────────────
//
// Measured 2026-09-27 on a real CV and on synthetic files built the way Word
// writes them (mammoth 1.12.2 in production and 1.12.0 in this repo's lock behave
// the same on every case below):
//   1. headers, footers and footnotes are never read — while the SAME CV saved as
//      PDF keeps them, because pdf-parse reads the whole page;
//   2. a text box is read only through its legacy VML copy (mc:Fallback). A text
//      box written without that copy — modern-only, or a bare drawing — is lost.
// Both are read here from the file itself and added around mammoth's text:
// headers first (where templates put the name and title), everything else after
// the body. A text already present in the body is not repeated.
//
// This runs on files anyone can upload without signing in (the public CV parse),
// on the server's only thread, so every step is bounded by the size of what can
// survive the 20,000-character cap — never by the size of the upload: linear
// scanning, a size cap per part, a cap on header/footer parts and on paragraphs
// examined, and comparisons against the part of the body that is actually kept.

/** An oversized part is skipped, never inflated. */
const DOCX_EXTRA_PART_MAX_BYTES = 2 * 1024 * 1024;
/**
 * word/document.xml above this is refused before mammoth reads it: mammoth has no
 * limit of its own, and a few KB of compressed upload can inflate to hundreds of
 * MB. A real CV's document.xml is well under 1MB (pictures live elsewhere).
 */
const DOCX_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
/** A CV has a handful of sections; more header/footer parts than this is not a CV. */
const DOCX_MAX_HEADER_FOOTER_PARTS = 12;
/** Paragraphs and boxes examined across all extra parts — a real CV has dozens. */
const DOCX_MAX_EXTRA_CANDIDATES = 2000;
/** What goes BEFORE the body: a real header is a name, a title and a contact line. */
const DOCX_HEADER_MAX_CHARS = 1000;

/** jszip's own record of a part's inflated size (it refuses a part that lies about it). */
function declaredSize(file: JSZip.JSZipObject | null): number {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize;
    return typeof size === 'number' ? size : 0;
}

function decodeXmlText(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
        .replace(/&amp;/g, '&');
}

/** Self-closing run elements that stand for a character. */
const DOCX_CHARACTER_ELEMENTS: Record<string, string> = {
    'w:tab': '\t',
    'w:ptab': '\t',
    'w:br': '\n',
    'w:cr': '\n',
    'w:noBreakHyphen': '-',
};

interface DocxParagraph {
    text: string;
    /** Index of the outermost text box it sits in, or -1 outside any box. */
    box: number;
}

/**
 * Every paragraph of a WordprocessingML part, in document order. The VML copy
 * inside mc:Fallback is skipped: its DrawingML twin in mc:Choice carries the same
 * text. Only w:t content is text — never a drawing's positions or sizes.
 *
 * The tag pattern can never cross a '<' — a part made of unclosed '<' is scanned
 * in one linear pass instead of trying every '<' against the rest of the part.
 */
function docxParagraphs(xml: string): DocxParagraph[] {
    const token = /<(\/?)([A-Za-z0-9_]+:[A-Za-z0-9_]+|[A-Za-z0-9_]+)(?:\s[^<>]*?)?(\/?)>|([^<]+)/g;
    const open: Array<{ text: string; box: number; inFallback: boolean }> = [];
    const out: DocxParagraph[] = [];
    let boxDepth = 0;
    let boxIndex = -1;
    let fallbackDepth = 0;
    let inText = false;
    let m: RegExpExecArray | null;
    while ((m = token.exec(xml))) {
        if (m[4] !== undefined) {
            if (inText && open.length) open[open.length - 1].text += decodeXmlText(m[4]);
            continue;
        }
        const closing = m[1] === '/';
        const name = m[2];
        const selfClosing = m[3] === '/';
        if (name === 'w:p') {
            if (selfClosing) continue;
            if (!closing) {
                open.push({ text: '', box: boxDepth > 0 ? boxIndex : -1, inFallback: fallbackDepth > 0 });
            } else {
                const p = open.pop();
                if (p && !p.inFallback && p.text.trim()) out.push({ text: p.text.trim(), box: p.box });
            }
            continue;
        }
        if (selfClosing) {
            const ch = DOCX_CHARACTER_ELEMENTS[name];
            if (ch !== undefined && open.length) open[open.length - 1].text += ch;
            continue;
        }
        if (name === 'w:txbxContent') {
            if (!closing && boxDepth === 0 && fallbackDepth === 0) boxIndex += 1;
            boxDepth += closing ? -1 : 1;
        } else if (name === 'mc:Fallback') fallbackDepth += closing ? -1 : 1;
        else if (name === 'w:t') inText = !closing;
    }
    return out;
}

/** The texts outside any text box (headers, footers, notes are read whole). */
const paragraphTexts = (ps: DocxParagraph[]) => ps.map((p) => p.text);

/** One text per text box, its lines kept together — a box is compared and kept whole. */
function textBoxTexts(ps: DocxParagraph[]): string[] {
    const boxes = new Map<number, string[]>();
    for (const p of ps) {
        if (p.box < 0) continue;
        const lines = boxes.get(p.box) ?? [];
        lines.push(p.text);
        boxes.set(p.box, lines);
    }
    return [...boxes.values()].map((lines) => lines.join('\n'));
}

/** Comparison form: case, spacing, hyphen variants and direction marks do not make a text new. */
function comparable(s: string): string {
    return s
        .normalize('NFKC')
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00ad]/g, '')
        .replace(/[\u2010\u2011]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Letters and digits only — what survives line breaks, symbol icons and punctuation. */
function lettersAndDigits(s: string): string {
    return s.replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whole-phrase containment: a header "Zed" is not already in a body that says "Zedoary". */
function containsPhrase(haystack: string, phrase: string): boolean {
    const wordChar = /[\p{L}\p{N}]/u;
    for (let at = haystack.indexOf(phrase); at !== -1; at = haystack.indexOf(phrase, at + 1)) {
        const before = at > 0 ? haystack[at - 1] : '';
        const after = haystack[at + phrase.length] ?? '';
        if (!wordChar.test(before) && !wordChar.test(after)) return true;
    }
    return false;
}

/**
 * Is this text already in mammoth's body? Also true when only the line breaks,
 * symbol icons or punctuation differ — mammoth writes a text box's soft break
 * (Shift+Enter) as nothing and a Wingdings icon as a character, this reader the
 * other way round, and the box must not come out twice. The letters-only match is
 * used only for texts long enough not to match inside an unrelated word.
 */
function alreadyInBody(body: { spaced: string; letters: string }, k: string): boolean {
    if (containsPhrase(body.spaced, k)) return true;
    const letters = lettersAndDigits(k);
    return letters.length >= 12 && body.letters.includes(letters);
}

/** "Page 3", "Page 1 of 2", "صفحة ٢ من ٥", "- 4 -" — layout, not content. A phone number is not a page number. */
const PAGE_NUMBER_LINE = /^[\s\-–—]*((page|pg\.?|p\.|صفحة|الصفحة|لاپەڕە)\s*)?[\p{Nd}]{1,4}(\s*(of|\/|من|لە)\s*[\p{Nd}]{1,4})?[\s\-–—]*$/iu;

/** Header/footer noise filter: a page number or a lone character is layout, not content. */
function isHeaderFooterContent(s: string): boolean {
    return (s.match(/[\p{L}\p{N}]/gu) || []).length >= 3 && !PAGE_NUMBER_LINE.test(s.trim());
}

async function readDocxPart(zip: JSZip, name: string, maxBytes = DOCX_EXTRA_PART_MAX_BYTES): Promise<string> {
    const file = zip.file(name);
    if (!file || declaredSize(file) > maxBytes) return '';
    return file.async('string');
}

/** Where the tag <tag …> (exactly that name, not <tagSomething>) next opens, or -1. */
function indexOfTag(xml: string, tag: string, from: number): number {
    for (let at = xml.indexOf(`<${tag}`, from); at !== -1; at = xml.indexOf(`<${tag}`, at + 1)) {
        const next = xml[at + tag.length + 1];
        if (next !== undefined && /[\s>/]/.test(next)) return at;
    }
    return -1;
}

/** Remove every <tag …>…</tag> block by indexOf — linear even when openings never close. */
function withoutBlocks(xml: string, tag: string): string {
    let out = '';
    let from = 0;
    for (let at = indexOfTag(xml, tag, from); at !== -1; at = indexOfTag(xml, tag, from)) {
        const end = xml.indexOf(`</${tag}>`, at);
        if (end === -1) break;
        out += xml.slice(from, at);
        from = end + tag.length + 3;
    }
    return out + xml.slice(from);
}

/**
 * The header and footer parts Word actually SHOWS, in document order.
 *  - A part no section points to is a template leftover.
 *  - A section without its own reference inherits the previous section's (per
 *    kind and type), as Word does.
 *  - A first-page header shows only in a section that sets w:titlePg; an
 *    even-page one only when the document turns on different odd/even headers.
 *  - A tracked change to the section layout (w:sectPrChange) is the OLD state, not
 *    what is shown.
 */
async function displayedHeaderFooterParts(zip: JSZip, documentXml: string): Promise<{ headers: string[]; footers: string[] }> {
    const byLowerName = new Map(Object.keys(zip.files).map((n) => [n.toLowerCase(), n]));
    const resolve = (target: string): string | undefined => {
        const joined = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('word', target));
        return byLowerName.get(joined.toLowerCase());
    };
    const rels = await readDocxPart(zip, 'word/_rels/document.xml.rels');
    const targetById = new Map<string, string>();
    for (const rel of rels.match(/<Relationship\b[^<>]*>/g) || []) {
        const id = rel.match(/\bId="([^"]+)"/)?.[1];
        const target = rel.match(/\bTarget="([^"]+)"/)?.[1];
        const name = target ? resolve(target) : undefined;
        if (id && name && /\/(header|footer)"/.test(rel)) targetById.set(id, name);
    }
    const settings = await readDocxPart(zip, 'word/settings.xml');
    const turnedOn = (tag: string, xml: string) => new RegExp(`<w:${tag}(?![^<>]*w:val="(0|false|off)")[^<>]*/?>`).test(xml);
    const evenAndOdd = turnedOn('evenAndOddHeaders', settings);

    // A tracked change to the section layout carries the OLD state inside its own
    // <w:sectPr> — drop those blocks before finding the sections themselves.
    const layout = withoutBlocks(documentXml, 'w:sectPrChange');
    const sections: string[] = [];
    for (let at = indexOfTag(layout, 'w:sectPr', 0); at !== -1; ) {
        const openEnd = layout.indexOf('>', at);
        if (openEnd === -1) break;
        if (layout[openEnd - 1] === '/') {
            at = indexOfTag(layout, 'w:sectPr', openEnd); // an empty <w:sectPr/>
            continue;
        }
        const end = layout.indexOf('</w:sectPr>', openEnd);
        if (end === -1) break;
        sections.push(layout.slice(openEnd + 1, end));
        at = indexOfTag(layout, 'w:sectPr', end);
    }
    const current: Record<string, string | undefined> = {};
    const shown = { headers: [] as string[], footers: [] as string[] };
    for (const section of sections) {
        for (const ref of section.match(/<w:(header|footer)Reference\b[^<>]*\/?>/g) || []) {
            const kind = ref.startsWith('<w:header') ? 'header' : 'footer';
            const type = ref.match(/\bw:type="([^"]+)"/)?.[1] ?? 'default';
            current[`${kind}:${type}`] = targetById.get(ref.match(/\br:id="([^"]+)"/)?.[1] ?? '');
        }
        const titlePage = turnedOn('titlePg', section);
        for (const kind of ['header', 'footer'] as const) {
            const types = ['default', ...(titlePage ? ['first'] : []), ...(evenAndOdd ? ['even'] : [])];
            const list = kind === 'header' ? shown.headers : shown.footers;
            for (const type of types) {
                const part = current[`${kind}:${type}`];
                if (part && !list.includes(part)) list.push(part);
            }
        }
    }
    return shown;
}

/** mammoth's text with the parts it skips put back. Never throws. */
async function withDocxExtras(zip: JSZip, bodyText: string): Promise<string> {
    try {
        const documentXml = await readDocxPart(zip, 'word/document.xml', DOCX_DOCUMENT_MAX_BYTES);

        // Only the part of the body that can survive the cap is ever compared — the
        // cost stays bounded however large the upload makes the body.
        const kept = comparable(bodyText.slice(0, MAX_CV_TEXT_CHARS + 2000));
        const body = { spaced: kept, letters: lettersAndDigits(kept) };
        const seen = new Set<string>();
        let examined = 0;
        /** New texts that pass `keep`, within `budget` characters (the last one cut to fit). */
        const take = (texts: string[], budget: number, keep: (t: string) => boolean): string[] => {
            const out: string[] = [];
            for (const raw of texts) {
                if (budget <= 0 || examined >= DOCX_MAX_EXTRA_CANDIDATES) break;
                examined += 1;
                const t = raw.length > MAX_CV_TEXT_CHARS ? raw.slice(0, MAX_CV_TEXT_CHARS) : raw;
                const k = comparable(t);
                if (!k || seen.has(k) || !keep(t)) continue;
                seen.add(k);
                if (alreadyInBody(body, k)) continue;
                out.push(t.length > budget ? t.slice(0, budget) : t);
                budget -= t.length + 1;
            }
            return out;
        };

        // Each part on its own: a footer that cannot be decoded costs the footer,
        // not the header or the text boxes.
        const read = async (part: string): Promise<DocxParagraph[]> => {
            try {
                return docxParagraphs(part === 'word/document.xml' ? documentXml : await readDocxPart(zip, part));
            } catch {
                return [];
            }
        };
        const shown = await displayedHeaderFooterParts(zip, documentXml);
        const headerParts = shown.headers.slice(0, DOCX_MAX_HEADER_FOOTER_PARTS);
        const footerParts = shown.footers.slice(0, Math.max(0, DOCX_MAX_HEADER_FOOTER_PARTS - headerParts.length));

        const header: string[] = [];
        for (const part of headerParts) header.push(...paragraphTexts(await read(part)));
        const textBoxes = textBoxTexts(await read('word/document.xml'));
        const footer: string[] = [];
        for (const part of footerParts) footer.push(...paragraphTexts(await read(part)));
        const notes: string[] = [];
        for (const part of ['word/footnotes.xml', 'word/endnotes.xml']) notes.push(...paragraphTexts(await read(part)));

        // The body never loses text to what is added around it: the header gets at
        // most 1,000 characters and only what the body leaves free under the cap,
        // and what follows the body takes only the room left after that.
        const bodyLength = bodyText.trim().length;
        const any = (t: string) => t.trim().length > 0;
        const before = take(header, Math.min(DOCX_HEADER_MAX_CHARS, Math.max(0, MAX_CV_TEXT_CHARS - bodyLength - 2)), isHeaderFooterContent);
        let room = Math.max(0, MAX_CV_TEXT_CHARS - bodyLength - before.join('\n').length - 4);
        const takeRoom = (texts: string[], keep: (t: string) => boolean): string[] => {
            const out = take(texts, room, keep);
            room -= out.reduce((n, t) => n + t.length + 1, 0);
            return out;
        };
        // A text box is content (a CV can live entirely in boxes): kept whole, with
        // no header/footer noise filter — its "2016/2019" or "HR" is not a page number.
        const boxes = takeRoom(textBoxes, any);
        // A document whose body and text boxes hold nothing stays empty: a header or
        // a footer alone ("Page 1", a template's letterhead) is not a CV, and must not
        // turn a scanned-image CV into one that quietly scores on its footer.
        if (!bodyText.trim() && boxes.length === 0) return bodyText;
        const after = [...boxes, ...takeRoom(footer, isHeaderFooterContent), ...takeRoom(notes, any)];
        return [before.join('\n'), bodyText, after.join('\n')].filter((s) => s.trim()).join('\n\n');
    } catch {
        // The body alone is still a complete read of what mammoth understood.
        return bodyText;
    }
}

/**
 * @throws {CvExtractionError} for unsupported types, unreadable files, or CVs
 * that contain no extractable text (e.g. scanned images — OCR is out of scope).
 */
export async function extractTextFromCv(
    buffer: Buffer,
    mimetype: string,
    filename?: string
): Promise<string> {
    const kind = classify(mimetype, filename);
    if (!kind) {
        throw new CvExtractionError(
            'UNSUPPORTED_TYPE',
            'Unsupported file type. Please upload a PDF, DOCX, or TXT file.'
        );
    }

    let raw = '';
    try {
        if (kind === 'pdf') {
            const result = await pdfParse(buffer);
            raw = result?.text || '';
        } else if (kind === 'docx') {
            const zip = await JSZip.loadAsync(buffer);
            if (declaredSize(zip.file('word/document.xml')) > DOCX_DOCUMENT_MAX_BYTES) {
                throw new Error('This Word file is too large to read. Please save it as PDF and upload it again.');
            }
            const result = await mammoth.extractRawText({ buffer });
            raw = await withDocxExtras(zip, result?.value || '');
        } else {
            raw = buffer.toString('utf8');
        }
    } catch (err) {
        throw new CvExtractionError(
            'PARSE_FAILED',
            err instanceof Error ? err.message : 'Failed to read the file.'
        );
    }

    const text = normalize(raw);
    if (!text) {
        throw new CvExtractionError(
            'EMPTY_CV',
            'No readable text found. If this is a scanned/image CV, please fill the fields manually.'
        );
    }
    return text;
}

// ── Optional headshot extraction (DOCX only) ────────────────────────────────
//
// `pdf-parse` gives us text only, so a PDF CV never yields a photo — the
// candidate uploads one manually. DOCX embeds its images, and mammoth is
// already a dependency, so we can pull them out with no new packages.
//
// There is no reliable way to know which embedded image *is* the headshot, so
// we use the one heuristic that holds in practice: the largest image that is
// big enough to be a photo rather than a logo or an icon.

/** Below this a picture is a logo/icon/bullet, not a headshot. */
const MIN_PHOTO_BYTES = 20 * 1024;
/** Above this we would be embedding a huge data URL into the form response. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const PHOTO_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * Best-effort headshot from a DOCX CV, as a `data:` URL.
 *
 * Never throws: a CV with no usable image (and any DOCX that mammoth cannot
 * walk) simply returns `null` and the caller falls back to manual upload.
 */
export async function extractPhotoDataUrlFromDocx(
    buffer: Buffer,
    mimetype: string,
    filename?: string
): Promise<string | null> {
    if (classify(mimetype, filename) !== 'docx') return null;

    try {
        const zip = await JSZip.loadAsync(buffer);
        if (declaredSize(zip.file('word/document.xml')) > DOCX_DOCUMENT_MAX_BYTES) return null;
    } catch {
        return null;
    }
    const candidates: Array<{ size: number; dataUrl: string }> = [];
    try {
        await mammoth.convertToHtml(
            { buffer },
            {
                convertImage: mammoth.images.imgElement(async (image) => {
                    try {
                        const contentType = String(image.contentType || '').toLowerCase();
                        if (PHOTO_MIMES.has(contentType)) {
                            const base64 = await image.readAsBase64String();
                            // base64 inflates by 4/3; close enough to compare sizes.
                            const size = Math.floor((base64.length * 3) / 4);
                            if (size >= MIN_PHOTO_BYTES && size <= MAX_PHOTO_BYTES) {
                                candidates.push({
                                    size,
                                    dataUrl: `data:${contentType};base64,${base64}`,
                                });
                            }
                        }
                    } catch {
                        /* skip this image, keep walking the document */
                    }
                    // We only want the bytes; the generated HTML is discarded.
                    return { src: '' };
                }),
            }
        );
    } catch {
        return null;
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.size - a.size);
    return candidates[0].dataUrl;
}
