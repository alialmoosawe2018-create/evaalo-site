import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'voice-reception',
        timestamp: new Date().toISOString(),
    });
});

router.get('/config', (req, res) => {
    const host = req.headers.host || 'localhost:5000';
    const wsPath = process.env.RECEPTION_WS_PATH || '/ws/voice-reception';
    const wsUrl = `ws://${host}${wsPath}`;
    res.json({
        wsUrl,
        protocol: 'json',
        states: ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'],
        rateLimitPerSecond: Number(process.env.RECEPTION_RATE_LIMIT_PER_SEC || 20),
    });
});

router.get('/readiness', (_req, res) => {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    const ready = hasOpenAI && hasElevenLabs;
    res.json({
        ready,
        hasOpenAI,
        hasElevenLabs,
        message: ready
            ? 'Voice reception agent is ready'
            : `Missing API keys: ${!hasOpenAI ? 'OPENAI_API_KEY ' : ''}${!hasElevenLabs ? 'ELEVENLABS_API_KEY' : ''}`.trim(),
    });
});

export default router;
