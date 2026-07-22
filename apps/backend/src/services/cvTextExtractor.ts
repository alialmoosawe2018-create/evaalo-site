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
