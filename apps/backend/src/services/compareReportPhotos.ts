/**
 * Candidate photos for the emailed compare report, as data URIs.
 *
 * The report is rendered by headless Chromium from an HTML string with no
 * session, so it cannot fetch `/uploads/...` — those are served by the API and a
 * plain <img src> would silently render as a broken box. The bytes therefore
 * have to travel inside the HTML.
 *
 * Everything here is best-effort by design: a missing file, an unreadable one,
 * or a photo too large to embed simply yields no entry, and the card falls back
 * to the candidate's initials. A report must never fail to send over a picture.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Candidate from '../models/Candidate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Same directory server.ts serves at /uploads. */
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/** A face on a card is ~44px; anything above this is bytes nobody sees. */
const MAX_PHOTO_BYTES = 600 * 1024;
/** The whole attachment must stay under the 6MB dispatch cap. */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

/** Person files use `kind`; application attachments use `type`. Accept both. */
function fileKind(f: { kind?: unknown; type?: unknown } | null | undefined): string {
    return String((f?.kind ?? f?.type) ?? '').toLowerCase();
}

function mimeFor(file: { mimeType?: unknown; filename?: unknown }): string | null {
    const declared = String(file.mimeType || '').toLowerCase();
    if (declared.startsWith('image/')) return declared;
    const ext = path.extname(String(file.filename || '')).toLowerCase();
    return MIME_BY_EXT[ext] || null;
}

/**
 * Resolve a stored file to somewhere inside the uploads directory. `path` is
 * whatever was recorded at upload time and may be absolute, stale, or from
 * another machine, so the filename under UPLOADS_DIR is the trusted route and
 * the recorded path is only used when it really points inside that directory.
 */
function resolveOnDisk(file: { filename?: unknown; path?: unknown }): string | null {
    const filename = String(file.filename || '').trim();
    if (filename && !filename.includes('/') && !filename.includes('\\')) {
        return path.join(UPLOADS_DIR, filename);
    }
    const recorded = String(file.path || '').trim();
    if (!recorded) return null;
    const abs = path.resolve(recorded);
    return abs.startsWith(path.resolve(UPLOADS_DIR)) ? abs : null;
}

/**
 * candidateId → `data:image/...;base64,...` for every candidate that has a
 * readable photo small enough to embed.
 */
export async function loadCandidatePhotoDataUris(
    candidateIds: Array<string | undefined | null>
): Promise<Record<string, string>> {
    const ids = [...new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const out: Record<string, string> = {};
    if (ids.length === 0) return out;

    let people: Array<{ _id: unknown; files?: unknown }> = [];
    try {
        people = (await Candidate.find({ _id: { $in: ids } })
            .select('files')
            .lean()) as never;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[compare report] photo lookup failed for ${ids.length} candidate(s): ${message}`);
        return out;
    }

    let total = 0;
    for (const person of people) {
        const files = Array.isArray(person.files) ? person.files : [];
        const photo = files.find((f) => fileKind(f as never) === 'photo') as
            | { filename?: unknown; path?: unknown; mimeType?: unknown; size?: unknown }
            | undefined;
        if (!photo) continue;

        const mime = mimeFor(photo);
        const onDisk = resolveOnDisk(photo);
        if (!mime || !onDisk) continue;

        try {
            const stat = await fs.stat(onDisk);
            if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PHOTO_BYTES) continue;
            if (total + stat.size > MAX_TOTAL_BYTES) break;
            const buf = await fs.readFile(onDisk);
            total += buf.byteLength;
            out[String(person._id)] = `data:${mime};base64,${buf.toString('base64')}`;
        } catch {
            /* unreadable or gone — the card shows initials instead */
        }
    }
    return out;
}
