# إصلاح المشاكل خطوة بخطوة

## المشاكل المذكورة:
1. ❌ لا صوت من ElevenLabs يظهر
2. ❌ Avatar (الفيديو) لا يظهر
3. ❌ عند فتح Agent في PowerShell يفشل الاتصال

---

## الخطوة 1: التحقق من البيئة والملفات

### 1.1 تحقق من `.env.local`:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\agent
cat .env.local
```

**يجب أن يحتوي على:**
```
BEYOND_PRESENCE_API_KEY=sk-...
BEYOND_PRESENCE_AVATAR_ID=...
LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
DEEPGRAM_API_KEY=...
```

### 1.2 تحقق من المكتبات:

```powershell
pip list | Select-String "livekit"
```

**يجب أن ترى:**
- `livekit`
- `livekit-agents`
- `livekit-plugins-openai`
- `livekit-plugins-deepgram`
- `livekit-plugins-elevenlabs`

---

## الخطوة 2: تشغيل Agent بشكل صحيح

### 2.1 الطريقة الصحيحة:

```powershell
cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\agent
python src/agent.py dev
```

**⚠️ مهم:** لا تشغل Agent قبل Frontend!

### 2.2 الترتيب الصحيح:

1. ✅ شغّل Backend أولاً (localhost:5000)
2. ✅ شغّل Frontend ثانياً (localhost:3000)
3. ✅ **ثم** شغّل Agent (من PowerShell)

**⚠️ لا تشغل Agent أولاً!**

---

## الخطوة 3: التحقق من المشاكل

### 3.1 إذا Agent لا يبدأ:

**تحقق من:**
- ✅ Environment variables موجودة
- ✅ المكتبات مثبتة
- ✅ `.env.local` موجود

**الأخطاء الشائعة:**
```python
# ❌ خطأ: ModuleNotFoundError
pip install -r requirements.txt

# ❌ خطأ: API key missing
# تأكد من .env.local موجود ويحتوي على جميع المفاتيح
```

### 3.2 إذا Agent يبدأ لكن لا صوت:

**تحقق من:**
- ✅ AgentSession بدأ بشكل صحيح
- ✅ TTS wrapper يعمل
- ✅ Audio track منشور في Room

**في Logs يجب أن ترى:**
```
✅ AgentSession initialized with Beyond Presence TTS
✅ AgentSession started successfully
📊 Published tracks after agent start: 2
  - Track: avatar, kind: video
  - Track: roomio_audio, kind: audio
```

### 3.3 إذا Avatar لا يظهر:

**تحقق من:**
- ✅ Video track منشور في Room
- ✅ Frontend يشترك في video track
- ✅ Video frames يتم إرسالها

**في Logs يجب أن ترى:**
```
✅ Avatar video track published to LiveKit Room
✅ Test frame published to video track
🎬 Processing video from Beyond Presence
✅ Published video frame 1: 1920x1080
```

---

## الخطوة 4: حل المشاكل الشائعة

### المشكلة 1: Agent يفشل عند البدء

**السبب:** Environment variables مفقودة

**الحل:**
1. تحقق من `.env.local` موجود
2. تحقق من جميع المفاتيح موجودة
3. أعد تشغيل Agent

### المشكلة 2: لا صوت يظهر

**السبب:** AgentSession لا يبدأ أو TTS wrapper لا يعمل

**الحل:**
1. تحقق من Logs في Agent
2. تأكد من `AgentSession started successfully`
3. تأكد من `Published tracks after agent start: 2` (audio + video)

### المشكلة 3: Avatar لا يظهر

**السبب:** Video track لا ينشر أو Frontend لا يشترك

**الحل:**
1. تحقق من Logs في Agent: `✅ Avatar video track published`
2. تحقق من Logs في Frontend: `📦 Track subscribed: video`
3. تأكد من `autoSubscribe: true` في Frontend

---

## الخطوة 5: اختبار شامل

### 5.1 تشغيل كل شيء بالترتيب:

```powershell
# Terminal 1: Backend
cd cursor-react/apps/backend
npm run dev

# Terminal 2: Frontend
cd cursor-react/apps/frontend
npm run dev

# Terminal 3: Agent (⚠️ شغله بعد Frontend!)
cd cursor-react/apps/agent
python src/agent.py dev
```

### 5.2 التحقق من Logs:

**في Agent (PowerShell):**
```
✅ Agent started for room: room-...
✅ Connected to LiveKit room
✅ Participant connected
✅ Avatar video track published to LiveKit Room
✅ AgentSession initialized
✅ AgentSession started successfully
```

**في Frontend (Browser Console):**
```
✅ Connected to LiveKit Room
✅ Published audio track to LiveKit
✅ Published video track to LiveKit
📦 Track subscribed: audio from agent-...
📦 Track subscribed: video from agent-...
```

### 5.3 إذا كل شيء يعمل:

- ✅ يجب أن تسمع صوت من Agent
- ✅ يجب أن ترى Avatar في Frontend
- ✅ يجب أن تستطيع التحدث مع Agent

---

## الخطوة 6: إذا لا تزال المشكلة موجودة

### 6.1 أرسل Logs الكاملة:

**من Agent (PowerShell):**
- نسخ كل الـ output من بداية التشغيل

**من Frontend (Browser Console):**
- فتح Developer Tools (F12)
- نسخ كل الـ logs

### 6.2 تحقق من:

- ✅ LiveKit Server يعمل (LIVEKIT_URL)
- ✅ API Keys صحيحة
- ✅ Network connection يعمل
- ✅ Browser permissions (microphone, camera)

---

## الخلاصة السريعة:

1. ✅ **تحقق من البيئة** (.env.local, libraries)
2. ✅ **شغّل بالترتيب الصحيح** (Backend → Frontend → Agent)
3. ✅ **تحقق من Logs** (Agent + Frontend)
4. ✅ **تحقق من Tracks** (audio + video منشورة ومشتركة)
5. ✅ **إذا لا يزال لا يعمل** → أرسل Logs الكاملة
