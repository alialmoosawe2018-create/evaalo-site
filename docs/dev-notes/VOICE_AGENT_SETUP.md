# إعداد وكيل المقابلة الصوتية

## نظرة عامة

وكيل المقابلة الصوتية (Voice Agent) يعمل في صفحة **مقابلة صوتية ذكية** (`/interview`) ويستخدم:

- **STT:** OpenAI Whisper (تحويل الصوت إلى نص)
- **LLM:** OpenAI GPT (التفكير والرد)
- **TTS:** ElevenLabs (تحويل النص إلى صوت)

## المفاتيح المطلوبة

### الحد الأدنى (Whisper فقط)
```env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
```

### وضع Auto (LID → Deepgram إنجليزي | Speechmatics عربي)
```env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
DEEPGRAM_API_KEY=...
SPEECHMATICS_API_KEY=...
```

### أين تحصل على المفاتيح

- **OpenAI:** https://platform.openai.com/api-keys
- **ElevenLabs:** https://elevenlabs.io/app/settings/api-keys
- **Deepgram:** https://console.deepgram.com/
- **Speechmatics:** https://portal.speechmatics.com/api-keys

## خطوات الإعداد

1. انسخ ملف المثال:
   ```bash
   cd apps/backend
   copy env.example .env
   ```

2. افتح `.env` وأضف قيم المفاتيح:
   ```
   OPENAI_API_KEY=sk-proj-xxxxx
   ELEVENLABS_API_KEY=xxxxx
   ```

3. شغّل الـ Backend:
   ```bash
   cd apps/backend
   npm install
   npm run dev
   ```

4. شغّل الـ Frontend:
   ```bash
   cd apps/frontend
   npm install
   npm run dev
   ```

5. افتح صفحة المقابلة الصوتية:
   - من Dashboard: اختر مرشحًا واضغط "مقابلة صوتية"
   - أو مباشرة: `http://localhost:3000/interview?candidateId=xxx`

## التحقق من الجاهزية

- **API:** `GET http://localhost:5000/api/voice-interview/readiness`
  - إذا `ready: true` → المفاتيح مضبوطة
  - إذا `ready: false` → راجع المفاتيح في `.env`

- **الواجهة:** عند الاتصال، إذا ظهر تحذير أحمر "مفاتيح API غير موجودة" → أضف المفاتيح في الـ Backend

## البنية التقنية

```
Frontend (Interview.jsx)
    ↓ WebSocket /ws/voice-interview
Backend (voiceSessionCore.ts)
    ├─ STT Router (sttRouterService.ts)
    │     ├─ LID (languageDetection.ts)  → Whisper على عينة قصيرة
    │     ├─ English → Deepgram (deepgramPreRecordedService.ts)
    │     ├─ Arabic  → Speechmatics (speechmaticsBatchService.ts)
    │     └─ Fallback → Whisper (openaiSTTService logic)
    ├─ LLM (llmService.ts)  → OpenAI GPT
    └─ TTS (ttsService.ts)  → ElevenLabs
```

## الملفات ذات الصلة

- `apps/frontend/src/pages/Interview.jsx` — صفحة المقابلة الصوتية
- `apps/backend/src/evaalo-only-voice/voiceSessionCore.ts` — معالج جلسة الصوت (نقطة الدخول: `voiceInterviewWs.ts`)
- `apps/backend/src/services/sttRouterService.ts` — توجيه STT حسب اللغة
- `apps/backend/src/services/languageDetection.ts` — كشف اللغة (Whisper LID)
- `apps/backend/src/services/deepgramPreRecordedService.ts` — STT للإنجليزية
- `apps/backend/src/services/speechmaticsBatchService.ts` — STT للعربية
- `apps/backend/src/services/llmService.ts` — خدمة LLM
- `apps/backend/src/services/ttsService.ts` — خدمة TTS
