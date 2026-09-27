/**
 * The CV files an applicant may upload — ONE rule for BOTH application forms.
 *
 * S45 (2026-09-27): on 2026-09-15 the platform learned to read Word and text CVs,
 * and the hint shared by both forms changed to "PDF, DOCX or TXT". The public
 * form (?pub=) followed; the legacy form (pages/Form.jsx, the link most applicants
 * actually get) kept its own PDF-only check — it promised Word and refused it, in
 * the browser, where nothing reached the server to show it happening. Two lists
 * drifted; now there is one.
 *
 * Judged by type OR extension: phones and some browsers report a Word file as
 * application/octet-stream, and a real PDF can arrive with no type at all.
 *
 * MUST agree with the backend rule (classifyCvUpload in
 * apps/backend/src/shared/formTemplates/types.ts): `npm run test:cv-file-types`
 * in apps/backend loads this file and compares the two case by case.
 */
import { fillI18nTemplate } from './i18nTemplate.js';

export const CV_FILE_TYPES = [
    // `mimeKeyword` keeps the tolerance for vendor aliases such as application/x-pdf.
    { extension: 'pdf', mimeType: 'application/pdf', mimeKeyword: 'pdf' },
    {
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        mimeKeyword: 'vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    { extension: 'txt', mimeType: 'text/plain', mimeKeyword: 'plain' },
];

export const CV_MAX_BYTES = 5 * 1024 * 1024;

/** For <input type="file" accept=…>: extensions AND types, so every picker shows Word files. */
export const CV_ACCEPT_ATTRIBUTE = [
    ...CV_FILE_TYPES.map((t) => `.${t.extension}`),
    ...CV_FILE_TYPES.map((t) => t.mimeType),
].join(',');

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function cvFileExtension(fileName) {
    const name = String(fileName ?? '').trim().toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
}

/** 'pdf' | 'docx' | 'txt', or null when the platform cannot read the file. */
export function classifyCvFile(mimeType, fileName) {
    const mime = String(mimeType ?? '').trim().toLowerCase();
    const ext = cvFileExtension(fileName);
    const byExtension = CV_FILE_TYPES.find((t) => t.extension === ext)?.extension ?? null;
    if (GENERIC_MIME_TYPES.has(mime)) return byExtension;
    const byType = CV_FILE_TYPES.find((t) => mime === t.mimeType || mime.includes(t.mimeKeyword))?.extension ?? null;
    // "text/plain" does not overrule a file that names itself as another CV format (same as the backend).
    if (byType === 'txt' && byExtension && byExtension !== 'txt') return byExtension;
    return byType;
}

/** For a browser File: can the platform read this CV? */
export function isAcceptedCvFile(file) {
    if (!file) return false;
    return classifyCvFile(file.type, file.name) !== null;
}

/**
 * What the applicant is told when a CV pick is refused — the same words on both
 * forms. It names what IS accepted (the old "upload a valid file" never said), and
 * when an earlier file is still attached it says so: a refused pick does not
 * remove it, and that file is what gets sent.
 *
 * @param {(key: string) => string} t
 * @param {{ reason: 'type' | 'size', hasPreviousFile: boolean, maxLabel?: string }} why
 */
export function cvRejectionMessage(t, { reason, hasPreviousFile, maxLabel = '5MB' }) {
    const base =
        reason === 'size'
            ? fillI18nTemplate(t('formValidation_maxFileSize'), { max: maxLabel })
            : t('formValidation_cvType');
    return hasPreviousFile ? `${base} ${t('formUpload_cvKeptPrevious')}` : base;
}
