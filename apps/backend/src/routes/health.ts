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

export default router;


