/**
 * Org chart persistence API (Chart page source of truth).
 *
 *   GET  /api/org-chart  -> { ok, departments, updatedAt }
 *   PUT  /api/org-chart  -> body { departments: [...] } ; upserts the org's chart
 *
 * Org-scoped: one document per organization (getOrgId). The PDF export route
 * (orgChartPdf) stays mounted at the same base path for /pdf.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '@clerk/express';
import OrgChart from '../models/OrgChart.js';
import { getOrgId, getClerkUserId } from '../middleware/auth.js';
import { extractTextFromCv, CvExtractionError } from '../services/cvTextExtractor.js';
import { extractOrgChartFromText, CvLlmUnavailableError } from '../services/llmService.js';
import {
    parseSpreadsheet,
    buildTreeFromRows,
    normalizeImportedTree,
    type ColumnMapping,
} from '../services/orgChartImport.js';

const router = express.Router();

// ── CV/file import upload (in-memory; never persisted) ───────────────────────
const MAX_IMPORT_BYTES = 8 * 1024 * 1024; // 8MB
const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
}).single('file');

/** import file classification by extension/mime. */
function classifyImport(mime: string, filename?: string): 'sheet' | 'doc' | null {
    const m = (mime || '').toLowerCase();
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet';
    if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return 'sheet';
    if (ext === 'pdf' || ext === 'docx' || ext === 'txt') return 'doc';
    if (m === 'application/pdf' || m.includes('word') || m === 'text/plain') return 'doc';
    return null;
}

// Lightweight per-user rate limiting (in-memory, best-effort).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10;
const rateBuckets = new Map<string, number[]>();
function isRateLimited(key: string): boolean {
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) {
        rateBuckets.set(key, hits);
        return true;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    return false;
}

/** Guard against unbounded documents (the chart is a small tree). */
const MAX_CHART_JSON_BYTES = 2 * 1024 * 1024; // 2MB

router.get('/', requireAuth(), async (req: Request, res: Response) => {
    try {
        const organizationId = getOrgId(req);
        const doc = await OrgChart.findOne({ organizationId }).lean();
        res.json({
            ok: true,
            departments: Array.isArray(doc?.departments) ? doc!.departments : [],
            updatedAt: doc?.updatedAt ?? null,
        });
    } catch (err) {
        console.error('❌ GET /api/org-chart failed:', err instanceof Error ? err.message : err);
        res.status(500).json({ ok: false, error: 'ORG_CHART_READ_FAILED', message: 'Could not load the org chart.' });
    }
});

router.put('/', requireAuth(), async (req: Request, res: Response) => {
    const departments = req.body?.departments;
    if (!Array.isArray(departments)) {
        return res.status(400).json({
            ok: false,
            error: 'INVALID_DEPARTMENTS',
            message: 'Body must include a "departments" array.',
        });
    }
    if (JSON.stringify(departments).length > MAX_CHART_JSON_BYTES) {
        return res.status(413).json({
            ok: false,
            error: 'CHART_TOO_LARGE',
            message: 'The org chart is too large to save.',
        });
    }

    try {
        const organizationId = getOrgId(req);
        const doc = await OrgChart.findOneAndUpdate(
            { organizationId },
            { $set: { departments, updatedByClerkUserId: getClerkUserId(req) } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
        res.json({
            ok: true,
            departments: Array.isArray(doc?.departments) ? doc!.departments : [],
            updatedAt: doc?.updatedAt ?? null,
        });
    } catch (err) {
        console.error('❌ PUT /api/org-chart failed:', err instanceof Error ? err.message : err);
        res.status(500).json({ ok: false, error: 'ORG_CHART_WRITE_FAILED', message: 'Could not save the org chart.' });
    }
});

/**
 * POST /api/org-chart/parse — parse an uploaded file into a department tree.
 *
 * multipart/form-data:
 *   - file:          PDF / DOCX / TXT (LLM) or XLSX / XLS / CSV (deterministic)
 *   - columnMapping: (spreadsheets only, optional) JSON { department?, name, title?, manager? }
 *
 * Spreadsheet without a mapping -> { ok, mode:'columns', columns, sampleRows }
 * Otherwise -> { ok, mode:'tree', departments }
 * The file is held in memory only and is never persisted or logged.
 */
router.post('/parse', requireAuth(), (req: Request, res: Response) => {
    importUpload(req, res, async (uploadErr: unknown) => {
        if (uploadErr) {
            const msg = uploadErr instanceof Error ? uploadErr.message : 'File upload failed';
            const status = msg.includes('File too large') ? 413 : 400;
            return res.status(status).json({ ok: false, error: 'UPLOAD_FAILED', message: msg });
        }

        const userId = getClerkUserId(req) || req.ip || 'anonymous';
        if (isRateLimited(userId)) {
            return res.status(429).json({
                ok: false,
                error: 'RATE_LIMITED',
                message: 'Too many uploads. Please wait a moment and try again.',
            });
        }

        const file = req.file;
        if (!file || !file.buffer || file.buffer.length === 0) {
            return res.status(400).json({ ok: false, error: 'NO_FILE', message: 'No file was provided.' });
        }

        const kind = classifyImport(file.mimetype, file.originalname);
        if (!kind) {
            return res.status(415).json({
                ok: false,
                error: 'UNSUPPORTED_TYPE',
                message: 'Upload a PDF, DOCX, TXT, XLSX, or CSV file.',
            });
        }

        try {
            if (kind === 'sheet') {
                const { headers, rows } = parseSpreadsheet(file.buffer);
                if (rows.length === 0) {
                    return res.status(422).json({
                        ok: false,
                        error: 'EMPTY_SHEET',
                        message: 'No rows found in the spreadsheet.',
                    });
                }

                let mapping: ColumnMapping | null = null;
                const rawMapping = req.body?.columnMapping;
                if (typeof rawMapping === 'string' && rawMapping.trim()) {
                    try {
                        const parsed = JSON.parse(rawMapping);
                        if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
                            mapping = parsed as ColumnMapping;
                        }
                    } catch {
                        /* invalid mapping -> fall through to columns step */
                    }
                }

                if (!mapping) {
                    // Ask the client to map columns first.
                    return res.json({
                        ok: true,
                        mode: 'columns',
                        columns: headers,
                        sampleRows: rows.slice(0, 5),
                    });
                }

                const departments = buildTreeFromRows(rows, mapping);
                return res.json({ ok: true, mode: 'tree', departments });
            }

            // kind === 'doc'
            const text = await extractTextFromCv(file.buffer, file.mimetype, file.originalname);
            const rawTree = await extractOrgChartFromText(text);
            const departments = normalizeImportedTree(rawTree);
            return res.json({ ok: true, mode: 'tree', departments });
        } catch (err) {
            if (err instanceof CvExtractionError) {
                const status = err.code === 'UNSUPPORTED_TYPE' ? 415 : 422;
                return res.status(status).json({ ok: false, error: err.code, message: err.message });
            }
            if (err instanceof CvLlmUnavailableError) {
                return res.status(503).json({
                    ok: false,
                    error: 'LLM_UNAVAILABLE',
                    message: 'Import is temporarily unavailable. Please try again later.',
                });
            }
            console.error('❌ /api/org-chart/parse failed:', err instanceof Error ? err.message : err);
            return res.status(500).json({
                ok: false,
                error: 'PARSE_ERROR',
                message: 'Could not read the file. Please check the format and try again.',
            });
        }
    });
});

export default router;
