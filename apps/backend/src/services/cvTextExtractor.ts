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

const PDF_MIMES = new Set(['application/pdf']);
const DOCX_MIMES = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const TXT_MIMES = new Set(['text/plain']);

export function isSupportedCvMime(mime: string, filename?: string): boolean {
    const m = (mime || '').toLowerCase();
    if (PDF_MIMES.has(m) || DOCX_MIMES.has(m) || TXT_MIMES.has(m)) return true;
    // Some browsers send octet-stream; fall back to the extension.
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    return ext === 'pdf' || ext === 'docx' || ext === 'txt';
}

function classify(mime: string, filename?: string): 'pdf' | 'docx' | 'txt' | null {
    const m = (mime || '').toLowerCase();
    if (PDF_MIMES.has(m)) return 'pdf';
    if (DOCX_MIMES.has(m)) return 'docx';
    if (TXT_MIMES.has(m)) return 'txt';
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'docx';
    if (ext === 'txt') return 'txt';
    return null;
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
            const result = await mammoth.extractRawText({ buffer });
            raw = result?.value || '';
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
