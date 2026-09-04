/**
 * CV parsing endpoints.
 *
 * POST /api/cv/parse         — authenticated (campaign-creation flow).
 * POST /api/cv/public-parse  — unauthenticated, used by the public interview
 *                              links so a candidate can auto-fill the intake
 *                              form from their CV. Same extraction, tighter
 *                              per-IP rate limit, and a best-effort headshot.
 *
 *   multipart/form-data:
 *     - cv:     the resume file (PDF / DOCX / TXT, <= 8MB)
 *     - fields: (optional) JSON array or comma-separated list of field ids to
 *               extract; defaults to the full candidate-field registry.
 *
 * Returns { ok: true, fields: { <id>: <string> , ... } } — every requested field
 * present, empty string when not found in the CV.
 *
 * Privacy: the uploaded file is held in memory only (never written to disk), and
 * neither the file bytes nor the extracted text are logged.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '@clerk/express';
import { getClerkUserId } from '../middleware/auth.js';
import {
    extractCandidateFieldsFromCv,
    CvLlmUnavailableError,
} from '../services/llmService.js';
import {
    extractTextFromCv,
    extractPhotoDataUrlFromDocx,
    isSupportedCvMime,
    CvExtractionError,
} from '../services/cvTextExtractor.js';
import { isCvFieldId } from '../shared/candidateCvFields.js';

const router = express.Router();

const MAX_CV_BYTES = 8 * 1024 * 1024; // 8MB

const cvMemoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_CV_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (isSupportedCvMime(file.mimetype, file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error('UNSUPPORTED_TYPE'));
        }
    },
}).single('cv');

// ── Lightweight per-user rate limiting (in-memory, best-effort) ──────────────
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10; // parses per authenticated user per minute
const PUBLIC_RATE_MAX = 5; // parses per IP per minute — the route has no auth
const rateBuckets = new Map<string, number[]>();

function isRateLimited(key: string, max: number = RATE_MAX): boolean {
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= max) {
        rateBuckets.set(key, hits);
        return true;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    return false;
}

/**
 * Best-effort client IP. The app does not set `trust proxy`, so `req.ip` is the
 * reverse proxy behind which we run — read the forwarded header first. This only
 * feeds an in-memory rate limit, so a spoofed value costs nothing but a bucket.
 */
function clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = String(first || '').split(',')[0].trim();
    return ip || req.ip || 'unknown';
}

/** Parse the optional `fields` form value (JSON array or comma-separated). */
function parseRequestedFields(raw: unknown): string[] | undefined {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const value = raw.trim();
    let list: unknown[] = [];
    if (value.startsWith('[')) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) list = parsed;
        } catch {
            /* fall through to comma split */
        }
    }
    if (list.length === 0) {
        list = value.split(',').map((s) => s.trim());
    }
    const ids = list.filter(isCvFieldId);
    return ids.length > 0 ? ids : undefined;
}

interface CvParseRouteOptions {
    /** Rate-limit bucket key — the user id when authenticated, the client IP when not. */
    rateKey: (req: Request) => string;
    /** Parses allowed per key per minute. */
    rateMax: number;
    /**
     * Public callers also get a best-effort headshot (DOCX only) so the intake
     * form can prefill its photo field. The authenticated flow has no photo
     * field, so it skips the extra pass over the document.
     */
    includePhoto: boolean;
    /** Route name, used in error logs. */
    label: string;
}

/**
 * The shared parse pipeline. The two routes differ only in who may call them,
 * how hard they are rate limited, and whether a photo comes back.
 */
function cvParseRoute(options: CvParseRouteOptions) {
    return (req: Request, res: Response) => {
        cvMemoryUpload(req, res, async (uploadErr: unknown) => {
            if (uploadErr) {
                const msg = uploadErr instanceof Error ? uploadErr.message : 'File upload failed';
                if (msg === 'UNSUPPORTED_TYPE') {
                    return res.status(415).json({
                        ok: false,
                        error: 'UNSUPPORTED_TYPE',
                        message: 'Please upload a PDF, DOCX, or TXT file.',
                    });
                }
                if (msg.includes('File too large')) {
                    return res.status(413).json({
                        ok: false,
                        error: 'FILE_TOO_LARGE',
                        message: 'The file is too large (max 8MB).',
                    });
                }
                return res.status(400).json({ ok: false, error: 'UPLOAD_FAILED', message: msg });
            }

            if (isRateLimited(options.rateKey(req), options.rateMax)) {
                return res.status(429).json({
                    ok: false,
                    error: 'RATE_LIMITED',
                    message: 'Too many CV uploads. Please wait a moment and try again.',
                });
            }

            const file = req.file;
            if (!file || !file.buffer || file.buffer.length === 0) {
                return res.status(400).json({
                    ok: false,
                    error: 'NO_FILE',
                    message: 'No CV file was provided.',
                });
            }

            const requestedFields = parseRequestedFields(req.body?.fields);

            try {
                const text = await extractTextFromCv(file.buffer, file.mimetype, file.originalname);
                const fields = await extractCandidateFieldsFromCv(text, requestedFields);
                if (!options.includePhoto) {
                    return res.json({ ok: true, fields });
                }
                // A missing or unreadable image must never cost the caller the
                // fields we already parsed — the photo is a bonus, not a result.
                const photo = await extractPhotoDataUrlFromDocx(
                    file.buffer,
                    file.mimetype,
                    file.originalname
                ).catch(() => null);
                return res.json(photo ? { ok: true, fields, photo } : { ok: true, fields });
            } catch (err) {
                if (err instanceof CvExtractionError) {
                    const status = err.code === 'UNSUPPORTED_TYPE' ? 415 : 422;
                    return res
                        .status(status)
                        .json({ ok: false, error: err.code, message: err.message });
                }
                if (err instanceof CvLlmUnavailableError) {
                    return res.status(503).json({
                        ok: false,
                        error: 'LLM_UNAVAILABLE',
                        message:
                            'CV parsing is temporarily unavailable. Please fill the fields manually.',
                    });
                }
                console.error(
                    `❌ ${options.label} failed:`,
                    err instanceof Error ? err.message : err
                );
                return res.status(500).json({
                    ok: false,
                    error: 'PARSE_ERROR',
                    message: 'Could not read the CV. Please fill the fields manually.',
                });
            }
        });
    };
}

router.post(
    '/parse',
    requireAuth(),
    cvParseRoute({
        rateKey: (req) => getClerkUserId(req) || clientIp(req),
        rateMax: RATE_MAX,
        includePhoto: false,
        label: '/api/cv/parse',
    })
);

// Deliberately unauthenticated: the candidate filling a public interview form
// has no account. Guarded by the per-IP budget above plus multer's 8MB /
// single-file / type limits, and the buffer is never written to disk.
router.post(
    '/public-parse',
    cvParseRoute({
        rateKey: (req) => `ip:${clientIp(req)}`,
        rateMax: PUBLIC_RATE_MAX,
        includePhoto: true,
        label: '/api/cv/public-parse',
    })
);

export default router;
