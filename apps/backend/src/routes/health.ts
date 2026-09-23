// ============================================
// ملف: routes/health.ts
// الوظيفة: Health check endpoint
// ============================================

import express from 'express';
import mongoose from 'mongoose';
import { liveInterviewSnapshot, startLiveInterviewCounter } from '../services/liveInterviewCount.js';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint.
 *
 * `activeInterviews` is read by the VPS auto-deployer: no deploy while an
 * interview is live (owner's rule since launch, 2026-09-23), so it postpones
 * while this is non-zero — voice live + voice parked in its resume window +
 * video live. `activeVoiceInterviews` is what the deployer read before that
 * field existed; the first deploy of this code is gated by a container that
 * only has it. Keep every field name and shape stable.
 */
router.get('/', (req, res) => {
    startLiveInterviewCounter();
    const live = liveInterviewSnapshot();
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        res.status(200).json({
            status: 'ok',
            message: 'Backend is healthy',
            database: dbStatus,
            ...live,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(200).json({
            status: 'ok',
            message: 'Backend is healthy',
            database: 'unknown',
            ...live,
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
    startLiveInterviewCounter();
    res.status(connected ? 200 : 503).json({
        status: connected ? 'ready' : 'not_ready',
        database: connected ? 'connected' : 'disconnected',
        ...liveInterviewSnapshot(),
        timestamp: new Date().toISOString(),
    });
});

export default router;


