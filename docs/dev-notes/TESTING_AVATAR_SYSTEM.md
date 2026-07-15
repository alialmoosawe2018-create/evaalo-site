# دليل اختبار نظام Video Interview Agent

## البنية الحالية:
```
Mic → LiveKit Room → Agent (STT: Speechmatics ar_en)
Agent → LLM (OpenAI) → TTS (ElevenLabs)
TTS → AvatarSession (Beyond Presence)
AvatarSession → LiveKit Room → User (Audio + Video)
```

## خطوات الاختبار:

### 1. تشغيل Video Interview Agent (agent.py):
```bash
cd apps/avatar-evaalov2
uv run python src/agent.py dev
```

**المتوقع:**
- ✅ Agent started: video-interview-agent
- ✅ Connected to LiveKit Room
- ✅ STT initialized (Speechmatics ar_en - Arabic & English)
- ✅ LLM initialized (OpenAI GPT-4.1-mini)
- ✅ TTS initialized (ElevenLabs - Arabic + English)
- ✅ AvatarSession started (Beyond Presence)

### 2. تشغيل Backend:
```bash
cd apps/backend
npm run dev
```

**المتوقع:**
- ✅ Server running on port 5000
- ✅ LiveKit service ready
- ✅ Agent dispatch service ready

### 3. تشغيل Frontend:
```bash
cd apps/frontend
npm run dev
```

**المتوقع:**
- ✅ Frontend running on port 3000
- ✅ LiveKit Room connection ready
- ✅ يستقبل Audio + Video من LiveKit فقط

### 4. اختبار المقابلة:

1. افتح المتصفح: `http://localhost:3000/video-interview-call?candidateId=507f1f77bcf86cd799439011`
2. ابدأ المقابلة
3. تحدث بالعربية أو الإنجليزية

**المتوقع:**
- ✅ Frontend ينشر الصوت إلى LiveKit Room
- ✅ Agent يستمع إلى الصوت من LiveKit Room
- ✅ Agent يستخدم STT (Speechmatics للعربية، Deepgram للإنجليزية)
- ✅ Agent يستخدم LLM (OpenAI) للحصول على الرد
- ✅ Agent يستخدم TTS (ElevenLabs) لتحويل الرد إلى صوت
- ✅ Agent يرسل الصوت إلى AvatarSession (Beyond Presence)
- ✅ AvatarSession ينشر Audio + Video عبر LiveKit Room
- ✅ Frontend يستقبل Audio + Video من LiveKit Room

## متغيرات البيئة المطلوبة:

### Backend (.env):
```
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

### Python Agent (.env.local):
```
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
OPENAI_API_KEY=...
ELEVEN_API_KEY=...
ELEVENLABS_VOICE_ID=...
DEEPGRAM_API_KEY=...
SPEECHMATICS_API_KEY=...
BEYOND_PRESENCE_API_KEY=...
BEYOND_PRESENCE_AVATAR_ID=694c83e2-8895-4a98-bd16-56332ca3f449
```

## المشاكل المحتملة:

### 1. Agent لا يستمع إلى الصوت:
- ✅ تحقق من أن Agent متصل بـ LiveKit Room
- ✅ تحقق من أن Frontend ينشر audio track إلى Room
- ✅ تحقق من STT initialization في Agent logs

### 2. Avatar لا يظهر:
- ✅ تحقق من `BEYOND_PRESENCE_API_KEY` و `BEYOND_PRESENCE_AVATAR_ID`
- ✅ تحقق من LiveKit credentials
- ✅ تحقق من أن AvatarSession بدأ بنجاح في Agent logs

### 3. لا يوجد صوت:
- ✅ تحقق من أن TTS (ElevenLabs) يعمل في Agent
- ✅ تحقق من أن Agent ينشر audio track إلى LiveKit Room
- ✅ تحقق من أن Frontend يشترك في audio track من Avatar

## Logs للتحقق:

### Backend:
```
✅ Agent dispatched to room: room-...
   - Agent name: video-interview-agent ✅
```

### Python Agent:
```
✅ Agent started for room: room-...
✅ STT initialized (Speechmatics ar_en - Arabic & English)
✅ LLM initialized (OpenAI GPT-4.1-mini)
✅ TTS initialized (ElevenLabs)
✅ AvatarSession started
🎤 Received user transcript: ...
💬 Generating response...
🔊 TTS synthesized: ...
📤 Audio track published to LiveKit Room
📹 Video track published to LiveKit Room
```

### Frontend:
```
✅ Audio track attached and playing
✅ Video track attached to avatar container
```
