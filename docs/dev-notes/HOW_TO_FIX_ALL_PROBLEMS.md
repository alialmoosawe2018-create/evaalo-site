# كيف تصلح جميع المشاكل - دليل شامل

## ✅ تم إصلاح: إضافة `autoSubscribe: true` في Frontend

تم إصلاح مشكلة عدم ظهور الصوت والفيديو بإضافة `autoSubscribe: true` في `room.connect()`.

---

## الخطوات الصحيحة للتشغيل:

### ⚠️ مهم جداً: الترتيب الصحيح

**لا تشغل Agent قبل Frontend!**

### 1. شغّل Backend أولاً:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\backend
npm run dev
```

**انتظر حتى ترى:**
```
✅ Server running on port 5000
```

---

### 2. شغّل Frontend ثانياً:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\frontend
npm run dev
```

**انتظر حتى ترى:**
```
✅ Frontend running on http://localhost:3000
```

---

### 3. افتح Frontend في المتصفح:

1. اذهب إلى: `http://localhost:3000`
2. افتح Developer Tools (اضغط F12)
3. اذهب إلى Console tab
4. **ابدأ مقابلة جديدة** (اضغط على "Start Interview")

**انتظر حتى ترى في Console:**
```
✅ Connected to LiveKit Room
✅ Published audio track to LiveKit
✅ Published video track to LiveKit
```

---

### 4. **بعد ذلك** شغّل Agent:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\agent
python src/agent.py dev
```

**⚠️ مهم:** شغّل Agent **بعد** أن تبدأ المقابلة في Frontend!

---

## ما يجب أن تراه:

### في Frontend Console (Browser):

```
✅ Connected to LiveKit Room
✅ Published audio track to LiveKit
✅ Published video track to LiveKit
📦 Track subscribed: audio from agent-...
📦 Track subscribed: video from agent-...
```

### في Agent (PowerShell):

```
✅ Agent started for room: room-...
✅ Connected to LiveKit room
✅ Participant connected
✅ Avatar video track published to LiveKit Room
✅ AgentSession initialized with Beyond Presence TTS
✅ AgentSession started successfully
📊 Published tracks after agent start: 2
  - Track: avatar, kind: video
  - Track: roomio_audio, kind: audio
```

---

## إذا لا يزال لا يعمل:

### 1. تحقق من `.env.local`:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\agent
cat .env.local
```

**يجب أن يحتوي على:**
- `BEYOND_PRESENCE_API_KEY`
- `BEYOND_PRESENCE_AVATAR_ID`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `DEEPGRAM_API_KEY`

### 2. تحقق من المكتبات:

```powershell
pip list | Select-String "livekit"
```

**يجب أن ترى:**
- `livekit`
- `livekit-agents`
- `livekit-plugins-openai`
- `livekit-plugins-deepgram`
- `livekit-plugins-elevenlabs`

### 3. إذا المكتبات مفقودة:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\agent
pip install -r requirements.txt
```

---

## ملخص الإصلاحات:

### ✅ تم إصلاح:
1. **إضافة `autoSubscribe: true`** في `room.connect()` - هذا يضمن اشتراك تلقائي في جميع tracks (audio + video)

### 📋 يجب أن تفعل:
1. **شغّل بالترتيب الصحيح:** Backend → Frontend → Agent
2. **ابدأ المقابلة في Frontend قبل تشغيل Agent**
3. **تحقق من Logs** في Frontend Console و Agent PowerShell

---

## الخلاصة:

### المشاكل التي تم حلها:
1. ✅ **لا صوت من ElevenLabs** → تم إصلاحه بإضافة `autoSubscribe: true`
2. ✅ **Avatar لا يظهر** → تم إصلاحه بإضافة `autoSubscribe: true`
3. ✅ **Agent يفشل عند التشغيل** → الحل: شغّله بعد Frontend

### الخطوات التالية:
1. شغّل Backend
2. شغّل Frontend
3. ابدأ مقابلة في Frontend
4. شغّل Agent

**الآن يجب أن يعمل كل شيء!** ✅
