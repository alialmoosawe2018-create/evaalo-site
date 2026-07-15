# 🚀 كيفية تشغيل Agent ومراقبة اللوجز

## الطريقة 1: استخدام PowerShell Script (Windows)

```powershell
cd apps/avatar-evaalov2
.\run_agent.ps1
```

## الطريقة 2: استخدام Bash Script (Linux/Mac)

```bash
cd apps/avatar-evaalov2
chmod +x run_agent.sh
./run_agent.sh
```

## الطريقة 3: تشغيل يدوي

### الخطوة 1: التحقق من Environment Variables
```powershell
# Windows PowerShell
cd apps/avatar-evaalov2
Get-Content .env.local | Select-String -Pattern "BEYOND_PRESENCE|LIVEKIT|OPENAI"
```

```bash
# Linux/Mac
cd apps/avatar-evaalov2
grep -E "BEYOND_PRESENCE|LIVEKIT|OPENAI" .env.local
```

### الخطوة 2: تثبيت Dependencies (إذا لزم الأمر)
```bash
uv sync
```

### الخطوة 3: تحميل Models المطلوبة
```bash
uv run python src/agent.py download-files
```

### الخطوة 4: تشغيل Agent مع Logging مفصل
```bash
# Set environment variables for better logging
$env:PYTHONUNBUFFERED = "1"  # Windows PowerShell
export PYTHONUNBUFFERED=1    # Linux/Mac

# Run agent
uv run python src/agent.py dev
```

---

## 📊 مراقبة اللوجز

### ما تبحث عنه في اللوجز:

#### ✅ **Agent Started Successfully:**
```
✅ Agent started for room: room-...
📊 Session active: 1 participant(s)
```

#### ✅ **Beyond Presence Initialized:**
```
Beyond Presence client initialized (avatar_id: ...)
Video track published to room
Video processing task started
Using Beyond Presence TTS wrapper
```

#### ✅ **TTS Audio Being Sent:**
```
Sending audio chunk to Beyond Presence (8192 bytes)
Received video chunk from Beyond Presence (12345 bytes)
Published video frame: 1280x720
```

#### ⚠️ **Errors to Watch For:**
```
❌ ERROR: BEYOND_PRESENCE_API_KEY is required
❌ ERROR: Beyond Presence API error: 401 - Unauthorized
❌ ERROR: Error processing video data
```

---

## 🔍 فحص اللوجز بالتفصيل

### 1. فحص Agent Connection:
```
✅ Agent started for room: room-video-interview-...
📊 Session active: 1 participant(s)
```

### 2. فحص Beyond Presence:
```
Beyond Presence Client initialized (avatar_id: 694c83e2...)
Beyond Presence client initialized
Video track published to room
Video processing task started
Using Beyond Presence TTS wrapper
```

### 3. فحص Audio Flow:
```
🎤 TTS stream called
Sending audio chunk to Beyond Presence (8192 bytes)
Received video chunk from Beyond Presence (12345 bytes)
```

### 4. فحص Video Publishing:
```
Published video frame: 1280x720
Published video frame: 1280x720
```

---

## 🧪 اختبار من Frontend

### الخطوة 1: تشغيل Backend
```bash
cd apps/backend
npm install
npm run dev
```

### الخطوة 2: تشغيل Frontend
```bash
cd apps/frontend
npm install
npm run dev
```

### الخطوة 3: فتح صفحة المقابلة
1. افتح المتصفح: `http://localhost:3000`
2. اذهب إلى صفحة Video Interview
3. ابدأ مقابلة جديدة

### الخطوة 4: مراقبة Agent Logs
بينما Frontend يعمل، راقب Agent logs في Terminal:
- ✅ Agent يدخل Room
- ✅ Agent ينشر video track
- ✅ Agent يرسل audio إلى Beyond Presence
- ✅ Agent يستقبل video من Beyond Presence

---

## 🐛 Troubleshooting

### مشكلة: Agent لا يبدأ
```bash
# تحقق من .env.local
cat .env.local  # Linux/Mac
Get-Content .env.local  # Windows

# تحقق من Dependencies
uv sync
```

### مشكلة: Beyond Presence لا يعمل
```bash
# تحقق من API Key في logs
# ابحث عن: "BEYOND_PRESENCE_API_KEY is required"

# تحقق من API Key في .env.local
grep BEYOND_PRESENCE_API_KEY .env.local
```

### مشكلة: Video لا يظهر في Frontend
```bash
# تحقق من Agent logs:
# - "Video track published to room"
# - "Published video frame"

# تحقق من Frontend Console:
# - "Video track subscribed"
# - "Video track attached"
```

---

## 📝 ملاحظات مهمة

1. **Agent يجب أن يعمل قبل Frontend:**
   - Agent يحتاج أن يكون جاهز قبل أن يبدأ Frontend المقابلة

2. **Room Name يجب أن يتطابق:**
   - Agent يستخدم Room Name من LiveKit
   - Frontend يجب أن يستخدم نفس Room Name

3. **Environment Variables:**
   - جميع API keys يجب أن تكون صحيحة
   - LiveKit credentials يجب أن تكون صحيحة

---

## 🎯 الخطوات الكاملة للاختبار

### Terminal 1: Agent
```bash
cd apps/avatar-evaalov2
uv run python src/agent.py dev
```

### Terminal 2: Backend
```bash
cd apps/backend
npm run dev
```

### Terminal 3: Frontend
```bash
cd apps/frontend
npm run dev
```

### Browser:
1. افتح `http://localhost:3000`
2. اذهب إلى Video Interview
3. ابدأ مقابلة
4. راقب Agent logs في Terminal 1

---

**جاهز للاختبار! 🚀**
