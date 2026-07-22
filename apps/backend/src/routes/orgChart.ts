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
import { requireAuth } from '@clerk/express';
import OrgChart from '../models/OrgChart.js';
import { getOrgId, getClerkUserId } from '../middleware/auth.js';

const router = express.Router();

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

export default router;
