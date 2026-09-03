// ============================================
// ملف: routes/health.ts
// الوظيفة: Health check endpoint
// ============================================

import express from 'express';
import mongoose from 'mongoose';
import { countLiveSessions } from '../evaalo-only-voice/sessionStore.js';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint.
 *
 * `activeVoiceInterviews` is read by the VPS auto-deployer: replacing the
 * container kills live voice calls outright, so it postpones while this is
 * non-zero. Keep the field name and shape stable.
 */
router.get('/', (req, res) => {
    let activeVoiceInterviews = 0;
    try {
        activeVoiceInterviews = countLiveSessions();
    } catch {
        /* never let the health check fail over a counter */
    }
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        res.status(200).json({ 
            status: 'ok', 
            message: 'Backend is healthy',
            database: dbStatus,
            activeVoiceInterviews,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(200).json({ 
            status: 'ok', 
            message: 'Backend is healthy',
            database: 'unknown',
            activeVoiceInterviews,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /health/ready — READINESS (strict).
 *
 * `/health` above is liveness: it must stay 200 whenever the process is up, because
 * the container healthcheck uses it — flipping it to 503 during a Mongo outage would
 * make Docker restart a perfectly good process in a loop it cannot fix.
 *
 * Readiness is the honest gate: 503 while Mongo is not connected. The VPS deployer
 * should probe THIS before promoting a build, so a container that cannot reach the
 * database is never promoted (today the gate reads `/health`, which returns 200 even
 * with `database: "disconnected"`).
 */
router.get('/ready', (req, res) => {
    const connected = mongoose.connection.readyState === 1;
    let activeVoiceInterviews = 0;
    try {
        activeVoiceInterviews = countLiveSessions();
    } catch {
        /* never let readiness fail over a counter */
    }
    res.status(connected ? 200 : 503).json({
        status: connected ? 'ready' : 'not_ready',
        database: connected ? 'connected' : 'disconnected',
        activeVoiceInterviews,
        timestamp: new Date().toISOString(),
    });
});

export default router;


