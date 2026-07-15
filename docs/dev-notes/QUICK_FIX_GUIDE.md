# دليل الإصلاح السريع - المشاكل الثلاثة

## المشكلة 1: لا صوت من ElevenLabs ❌

### السبب المحتمل:
- AgentSession لا يبدأ بشكل صحيح
- Audio track لا ينشر في Room
- Frontend لا يشترك في audio track

### الحل:

**1. تحقق من Logs في Agent:**
```
✅ AgentSession initialized with Beyond Presence TTS
✅ AgentSession started successfully
📊 Published tracks after agent start: 2
  - Track: roomio_audio, kind: audio ✅
```

**2. تحقق من Logs في Frontend:**
```
📦 Track subscribed: audio from agent-...
```

**3. إذا audio track لا يظهر:**
- تحقق من `room.connect()` في Frontend
- تأكد من `autoSubscribe: true` (سيتم إضافته)

---

## المشكلة 2: Avatar (الفيديو) لا يظهر ❌

### السبب المحتمل:
- Video track لا ينشر في Room
- Frontend لا يشترك في video track
- Video frames لا يتم إرسالها

### الحل:

**1. تحقق من Logs في Agent:**
```
✅ Avatar video track published to LiveKit Room
✅ Test frame published to video track
🎬 Processing video from Beyond Presence
✅ Published video frame 1: 1920x1080
```

**2. تحقق من Logs في Frontend:**
```
📦 Track subscribed: video from agent-...
```

**3. إذا video track لا يظهر:**
- تحقق من `room.connect()` في Frontend
- تأكد من `autoSubscribe: true` (سيتم إضافته)

---

## المشكلة 3: Agent يفشل عند التشغيل من PowerShell ❌

### السبب المحتمل:
- Agent يُشغل قبل Frontend
- Environment variables مفقودة
- الترتيب الخاطئ للتشغيل

### الحل:

**الترتيب الصحيح:**
1. ✅ Backend أولاً (localhost:5000)
2. ✅ Frontend ثانياً (localhost:3000)
3. ✅ **Agent أخيراً** (من PowerShell)

**⚠️ مهم:** لا تشغل Agent قبل Frontend!

**الطريقة الصحيحة:**
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

---

## الإصلاحات المطلوبة في الكود:

### 1. إضافة `autoSubscribe: true` في Frontend

في `VideoInterviewCall.jsx`، يجب تغيير:
```javascript
await room.connect(livekitUrl, livekitToken);
```

إلى:
```javascript
await room.connect(livekitUrl, livekitToken, {
    autoSubscribe: true  // ✅ هذا سيضمن اشتراك تلقائي في جميع tracks
});
```

---

## خطوات التشخيص:

### 1. شغّل Backend:
```powershell
cd cursor-react/apps/backend
npm run dev
```

### 2. شغّل Frontend:
```powershell
cd cursor-react/apps/frontend
npm run dev
```

### 3. افتح Frontend في المتصفح:
- اذهب إلى `http://localhost:3000`
- افتح Developer Tools (F12)
- اذهب إلى Console tab

### 4. ابدأ مقابلة جديدة:
- اضغط على "Start Interview"
- راقب Console logs

### 5. شغّل Agent (بعد بدء المقابلة):
```powershell
cd cursor-react/apps/agent
python src/agent.py dev
```

### 6. تحقق من Logs:

**في Frontend Console:**
- يجب أن ترى: `✅ Connected to LiveKit Room`
- يجب أن ترى: `📦 Track subscribed: audio`
- يجب أن ترى: `📦 Track subscribed: video`

**في Agent PowerShell:**
- يجب أن ترى: `✅ Agent started for room: room-...`
- يجب أن ترى: `✅ AgentSession started successfully`
- يجب أن ترى: `📊 Published tracks after agent start: 2`

---

## إذا لا يزال لا يعمل:

### أرسل هذه المعلومات:

1. **Logs من Agent (PowerShell):**
   - نسخ كل الـ output من بداية `python src/agent.py dev`

2. **Logs من Frontend (Browser Console):**
   - فتح Developer Tools (F12)
   - Console tab
   - نسخ كل الـ logs

3. **ملف `.env.local`:**
   - تحقق من وجوده في `cursor-react/apps/agent/`
   - (لا تنسخ المفاتيح - فقط تأكد من وجودها)
