// ============================================
// ملف: services/voiceOrchestrator.ts
// الوظيفة: تنسيق بين STT → LLM → TTS (فقط تنسيق - لا منطق STT/TTS)
// ============================================

import { getLLMResponse } from './llmService.js';
import { streamTextToSpeech } from './ttsService.js';
import type { WebSocket } from 'ws';

interface VoiceOrchestratorConfig {
  ws: WebSocket;
  sessionId: string;
  candidateId?: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  onStateChange: (state: 'SPEAKING' | 'LISTENING') => void;
  onStopSTT: () => void;
  onStartSTT: () => void;
  onSendMessage: (msg: any) => void;
}

/**
 * تنسيق المحادثة الصوتية: STT → LLM → TTS
 * 
 * عند وصول transcript من STT:
 * 1) state = SPEAKING
 * 2) أوقف STT
 * 3) استدع generateInterviewReply()
 * 4) مرر النص إلى streamTextToSpeech()
 * 5) أرسل chunks للـ ws (يتم داخل streamTextToSpeech)
 * 6) بعد انتهاء TTS: state = LISTENING + أعد تشغيل STT
 * 
 * الشروط:
 * - لا تشغّل STT أثناء TTS
 * - لا تشغّل الاثنين معًا
 * - فقط تنسيق - لا منطق STT أو TTS
 * 
 * @param transcript - النص من STT
 * @param config - إعدادات التنسيق
 */
export async function handleVoiceConversation(
  transcript: string,
  config: VoiceOrchestratorConfig
): Promise<void> {
  const { ws, sessionId, candidateId, conversationHistory, onStateChange, onStopSTT, onStartSTT, onSendMessage } = config;

  const trimmed = transcript.trim();
  if (!trimmed || trimmed.length < 4) return; // تجاهل نصوص قصيرة جداً

  // 1) state = SPEAKING
  onStateChange('SPEAKING');

  // 2) أوقف STT (لا تشغّل STT أثناء TTS)
  onStopSTT();

  // إرسال transcript للعميل
  onSendMessage({ type: 'transcript', text: trimmed, isFinal: true });

  try {
    // 3) استدع generateInterviewReply()
    let candidateProfile: {
      full_name?: string;
      email?: string;
      position_applied_for?: string;
      skills?: string[];
      experience?: string;
    } | undefined;

    if (candidateId && typeof candidateId === 'string' && candidateId.length === 24 && /^[a-fA-F0-9]{24}$/.test(candidateId)) {
      try {
        const Candidate = (await import('../models/Candidate.js')).default;
        const c = await Candidate.findById(candidateId).lean();
        if (c) {
          candidateProfile = {
            full_name: c.full_name,
            email: c.email,
            position_applied_for: c.position_applied_for,
            skills: c.skills,
            experience: c.years_of_experience,
          };
        }
      } catch {
        // ignore
      }
    }

    const llmReply = await getLLMResponse(trimmed, {
      sessionId,
      candidateProfile,
      position: candidateProfile?.position_applied_for,
      conversationHistory,
    });

    // تحديث conversation history
    conversationHistory.push({ role: 'user', content: trimmed });
    conversationHistory.push({ role: 'assistant', content: llmReply });

    // 4) مرر النص إلى streamTextToSpeech()
    // 5) أرسل chunks للـ ws (يتم داخل streamTextToSpeech)
    await streamTextToSpeech(llmReply, ws, 'en'); // يمكن اكتشاف اللغة لاحقاً

    // 6) بعد انتهاء TTS: state = LISTENING + أعد تشغيل STT
    if (ws.readyState === 1) {
      await new Promise((r) => setTimeout(r, 1500)); // cooldown
      if (ws.readyState === 1) {
        onStateChange('LISTENING');
        onStartSTT();
      }
    }
  } catch (err: any) {
    console.error('Voice orchestrator error:', err?.message || err);
    // في حالة الخطأ: العودة إلى LISTENING
    if (ws.readyState === 1) {
      onStateChange('LISTENING');
      onStartSTT();
    }
  }
}
