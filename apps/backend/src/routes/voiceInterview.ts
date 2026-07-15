import { Router } from 'express';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';

const router = Router();

function rejectIfStageCallbackSecurityMisconfigured(res: import('express').Response): boolean {
    try {
        assertStageOutboundSecurityForTrigger();
        return false;
    } catch (err) {
        if (err instanceof StageCallbackConfigurationError) {
            res.status(503).json({
                success: false,
                error: 'Stage callback security is not configured',
            });
            return true;
        }
        throw err;
    }
}

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'voice-interview',
    timestamp: new Date().toISOString(),
  });
});

router.get('/config', (req, res) => {
  if (rejectIfStageCallbackSecurityMisconfigured(res)) return;
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
  if (rejectIfStageCallbackSecurityMisconfigured(res)) return;
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
