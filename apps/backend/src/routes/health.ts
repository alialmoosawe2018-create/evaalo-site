// ============================================
// ملف: routes/health.ts
// الوظيفة: Health check endpoint
// ============================================

import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        res.status(200).json({ 
            status: 'ok', 
            message: 'Backend is healthy',
            database: dbStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(200).json({ 
            status: 'ok', 
            message: 'Backend is healthy',
            database: 'unknown',
            timestamp: new Date().toISOString()
        });
    }
});

export default router;


