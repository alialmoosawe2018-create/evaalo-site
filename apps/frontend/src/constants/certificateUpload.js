/**
 * Certificates upload — shared between the legacy application form and the
 * dynamic (public link) form. Must stay in sync with the `certificates` entry in
 * `apps/backend/src/shared/formTemplates/fieldRegistry.ts`.
 */
export const CERTIFICATES_MAX_FILES = 5;
export const CERTIFICATES_MAX_BYTES = 5 * 1024 * 1024;
export const CERTIFICATES_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
];
export const CERTIFICATES_ACCEPT =
    '.pdf,application/pdf,image/jpeg,image/jpg,image/png,image/webp';

const fileIdentity = (file) => `${file.name}:${file.size}:${file.lastModified}`;

/**
 * Merge a new FileList into the already-selected certificates.
 * Returns the accepted list plus a reason code for the first rejection, so the
 * caller can render a localized message.
 */
export function mergeCertificateSelection(existing, incoming, options = {}) {
    const mimeTypes = options.mimeTypes?.length ? options.mimeTypes : CERTIFICATES_MIME_TYPES;
    const maxBytes = options.maxBytes ?? CERTIFICATES_MAX_BYTES;
    const maxFiles = options.maxFiles ?? CERTIFICATES_MAX_FILES;
    const allowed = mimeTypes.map((m) => m.toLowerCase());
    const accepted = [...existing];
    const seen = new Set(accepted.map(fileIdentity));
    let reason = null;

    for (const file of Array.from(incoming || [])) {
        if (seen.has(fileIdentity(file))) continue;
        if (!allowed.includes((file.type || '').toLowerCase())) {
            reason = reason || 'type';
            continue;
        }
        if (file.size > maxBytes) {
            reason = reason || 'size';
            continue;
        }
        if (accepted.length >= maxFiles) {
            reason = reason || 'count';
            continue;
        }
        seen.add(fileIdentity(file));
        accepted.push(file);
    }

    return { files: accepted, reason };
}

export function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
