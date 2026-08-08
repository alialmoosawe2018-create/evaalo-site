/**
 * Cursor-pagination primitives shared by repositories.
 *
 * Cursors are opaque base64url tokens encoding the last row's (createdAt, _id) so
 * paging is stable even when many rows share a createdAt. Ordering is always
 * (createdAt desc, _id desc); the cursor filter is strictly "older than" that pair.
 */

export type CursorPage<T> = {
    rows: T[];
    /** Token to fetch the next page; null when there are no more rows. */
    nextCursor: string | null;
    hasMore: boolean;
};

export type DecodedCursor = { c: string; i: string };

export function encodeCursor(createdAt: Date | string | number, id: string): string {
    const iso = new Date(createdAt).toISOString();
    const payload = JSON.stringify({ c: iso, i: String(id) });
    return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor | null {
    try {
        const json = Buffer.from(cursor, 'base64url').toString('utf8');
        const obj = JSON.parse(json) as unknown;
        if (
            obj &&
            typeof obj === 'object' &&
            typeof (obj as DecodedCursor).c === 'string' &&
            typeof (obj as DecodedCursor).i === 'string'
        ) {
            return obj as DecodedCursor;
        }
    } catch {
        /* malformed cursor → treated as no cursor */
    }
    return null;
}

/** Clamp a caller-supplied page size to a safe range. */
export function clampLimit(raw: unknown, def = 50, max = 200): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(Math.floor(n), max);
}
