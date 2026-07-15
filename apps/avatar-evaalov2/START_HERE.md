# 🚀 ابدأ من هنا - تشغيل Agent واختبار من Frontend

## 📋 الخطوات السريعة

### الخطوة 1: التحقق من Environment Variables

```powershell
# افتح Terminal في مجلد avatar-evaalov2
cd apps/avatar-evaalov2

# تحقق من وجود .env.local
Get-Content .env.local
```

**يجب أن يحتوي على:**
```
LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud
LIVEKIT_API_KEY=your_key_here
LIVEKIT_API_SECRET=your_secret_here
OPENAI_API_KEY=your_key_here
BEYOND_PRESENCE_API_KEY=your_key_here
BEYOND_PRESENCE_AVATAR_ID=your_avatar_id_here
```

### الخطوة 2: تثبيت Dependencies (أول مرة فقط)

```powershell
cd apps/avatar-evaalov2
uv sync
```

### الخطوة 3: تحميل Models المطلوبة (أول مرة فقط)

```powershell
uv run python src/agent.py download-files
```

### الخطوة 4: تشغيل Agent

**الطريقة الأسهل (Windows):**
```powershell
.\run_agent.ps1
```

**أو يدوياً:**
```powershell
$env:PYTHONUNBUFFERED = "1"
$env:LOG_LEVEL = "DEBUG"
uv run python src/agent.py dev
```

---

## 🔍 ما تبحث عنه في اللوجز

### ✅ **Agent بدأ بنجاح:**
```
🚀 Starting LiveKit Agent...
✅ Agent started for room: room-...
📊 Session active: 1 participant(s)
```

### ✅ **Beyond Presence تم تهيئته:**
```
Beyond Presence Client initialized (avatar_id: ...)
Beyond Presence client initialized
Video track published to room
Video processing task started
Using Beyond Presence TTS wrapper
```

### ✅ **Audio يُرسل إلى Beyond Presence:**
```
🎤 TTS stream called
Sending audio chunk to Beyond Presence (8192 bytes)
Received video chunk from Beyond Presence (12345 bytes)
Published video frame: 1280x720
```

---

## 🧪 اختبار من Frontend

### Terminal 1: Agent (يجب أن يكون شغالاً أولاً)
```powershell
cd apps/avatar-evaalov2
.\run_agent.ps1
```

### Terminal 2: Backend
```powershell
cd apps/backend
npm run dev
```

### Terminal 3: Frontend
```powershell
cd apps/frontend
npm run dev
```

### Browser:
1. افتح: `http://localhost:3000`
2. اذهب إلى صفحة **Video Interview**
3. اضغط **Start Interview**
4. راقب Terminal 1 (Agent logs)

---

## 📊 مراقبة اللوجز في الوقت الفعلي

### في Terminal Agent، ستجد:

#### عند بدء المقابلة:
```
✅ Agent started for room: room-video-interview-...
📊 Session active: 1 participant(s)
Beyond Presence client initialized
Video track published to room
```

#### عند التحدث:
```
🎤 TTS stream called
Sending audio chunk to Beyond Presence (8192 bytes)
Received video chunk from Beyond Presence (12345 bytes)
Published video frame: 1280x720
```

#### عند انتهاء المقابلة:
```
Beyond Presence client closed
Agent session ended
```

---

## ⚠️ مشاكل شائعة

### Agent لا يبدأ:
```powershell
# تحقق من .env.local
Get-Content .env.local

# تحقق من Dependencies
uv sync
```

### Beyond Presence لا يعمل:
```powershell
# في Agent logs، ابحث عن:
# "BEYOND_PRESENCE_API_KEY is required"
# أو "Beyond Presence API error: 401"
```

### Video لا يظهر في Frontend:
```
# في Agent logs:
# - "Video track published to room" ✅
# - "Published video frame" ✅

# في Browser Console:
# - "Video track subscribed" ✅
# - "Video track attached" ✅
```

---

**جاهز! ابدأ Terminal 1 وافتح Frontend 🚀**
