import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'voice-interview',
    timestamp: new Date().toISOString(),
  });
});

router.get('/config', (req, res) => {
  const host = req.headers.host || 'localhost:5000';
  const wsPath = process.env.VOICE_WS_PATH || '/ws/voice-interview';
  const wsUrl = `ws://${host}${wsPath}`;
  res.json({
    wsUrl,
    protocol: 'json',
    states: ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'],
    rateLimitPerSecond: Number(process.env.VOICE_RATE_LIMIT_PER_SEC || 20),
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
      ? 'Voice agent is ready'
      : `Missing API keys: ${!hasOpenAI ? 'OPENAI_API_KEY ' : ''}${!hasElevenLabs ? 'ELEVENLABS_API_KEY' : ''}`.trim(),
  });
});

export default router;
