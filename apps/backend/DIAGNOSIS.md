# 🔍 تشخيص المشاكل المحتملة

## المشاكل المبلغ عنها:
1. ❌ Transcript لا يظهر
2. ❌ AI Voice لا يظهر  
3. ❌ Avatar لا يظهر

## 🔍 التشخيص التفصيلي:

### 1. مشكلة Transcript (Deepgram)

**الأسباب المحتملة:**
- ❌ Deepgram لا يستقبل audio chunks (format مشكلة)
- ❌ Deepgram WebSocket غير متصل
- ❌ Audio chunks فارغة أو format خاطئ
- ❌ Deepgram API key غير صحيح

**Logs للتحقق:**
```
🔌 Connecting to Deepgram...
✅ Deepgram WebSocket connected
📤 Sent audio chunk to Deepgram
📨 Deepgram raw message received
📝 Deepgram transcript (PARTIAL/FINAL)
```

**الحل:**
- تحقق من Deepgram API key في `.env`
- تحقق من format audio (يجب أن يكون opus)
- تحقق من أن audio chunks تُرسل بشكل صحيح

---

### 2. مشكلة AI Voice (TTS + Beyond Presence)

**الأسباب المحتملة:**
- ❌ ElevenLabs API key غير موجود أو خاطئ
- ❌ TTS لا يعمل (network issue)
- ❌ Audio format غير متوافق مع Beyond Presence
- ❌ Beyond Presence API key غير موجود

**Logs للتحقق:**
```
🤖 Calling handleInterviewTurn...
✅ Got AI reply
🎤 Starting TTS for text...
✅ TTS request successful
🎵 TTS audio chunk received
🎬 Sending audio to Beyond Presence...
✅ Beyond Presence request successful
```

**الحل:**
- تحقق من ElevenLabs API key في `.env`
- تحقق من Beyond Presence API key في `.env`
- تحقق من network connectivity

---

### 3. مشكلة Avatar (Video Stream)

**الأسباب المحتملة:**
- ❌ Beyond Presence لا يرسل video stream
- ❌ Video stream لا يُرسل إلى Frontend
- ❌ Frontend لا يعرض video stream
- ❌ WebSocket video connection غير متصل

**Logs للتحقق:**
```
🎥 Beyond Presence video chunk received
📹 Video chunk sent to frontend
🔌 Video stream WebSocket connected
```

**الحل:**
- تحقق من Beyond Presence API key
- تحقق من video WebSocket connection
- تحقق من Frontend video element

---

## 📋 Checklist للتحقق:

### Environment Variables:
- [ ] `DEEPGRAM_API_KEY` موجود وصحيح
- [ ] `ELEVENLABS_API_KEY` موجود وصحيح
- [ ] `BEYOND_PRESENCE_API_KEY` موجود وصحيح
- [ ] `BEYOND_PRESENCE_AVATAR_ID` موجود وصحيح

### Network:
- [ ] Deepgram API accessible
- [ ] ElevenLabs API accessible
- [ ] Beyond Presence API accessible

### Backend Logs:
- [ ] Deepgram connection successful
- [ ] Audio chunks sent to Deepgram
- [ ] Transcripts received from Deepgram
- [ ] TTS audio generated
- [ ] Audio sent to Beyond Presence
- [ ] Video chunks received from Beyond Presence
- [ ] Video chunks sent to Frontend

---

## 🚀 الخطوات التالية:

1. **أعد تشغيل Backend** مع logs مرئية
2. **راقب logs** أثناء الاختبار
3. **حدد المشكلة** من خلال logs
4. **أصلح المشكلة** بناءً على التشخيص
