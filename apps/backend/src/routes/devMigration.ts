/**
 * Dev-only route: one-time migration org_default → dev_org_<userId>.
 */

import { Router } from 'express';
import { getAuthContext } from '../middleware/auth.js';
import { migrateOrgDefaultToDevOrg } from '../services/devOrgMigrationService.js';

const router = Router();

router.post('/migrate-legacy-org', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ ok: false, message: 'Not found' });
    }

    const { userId } = getAuthContext(req);
    if (!userId || userId === 'system') {
        return res.status(401).json({ ok: false, message: 'Sign in required' });
    }

    try {
        const result = await migrateOrgDefaultToDevOrg(userId);
        if (result.skipped) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (err) {
        console.error('[dev/migrate-legacy-org]', err);
        return res.status(500).json({ ok: false, message: 'Migration failed' });
    }
});

export default router;
