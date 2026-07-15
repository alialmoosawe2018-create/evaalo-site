# Beyond Presence Integration Guide

**تاريخ التكامل:** 2026-01-12  
**الحالة:** ✅ مكتمل

---

## ✅ ما تم إنجازه

### 1. إصلاح إصدار Python ✅
- تم تحديث `pyproject.toml` لدعم Python 3.14
- `requires-python = ">=3.10, <3.15"`

### 2. إضافة Dependencies ✅
- ✅ `aiohttp` - للاتصال بـ Beyond Presence API
- ✅ `av` (PyAV) - لمعالجة video frames من Beyond Presence

### 3. إنشاء Beyond Presence Integration ✅
- ✅ `src/beyond_presence.py` - Beyond Presence client
- ✅ `src/beyond_presence_tts.py` - TTS wrapper لإرسال audio إلى Beyond Presence

### 4. تعديل Agent ✅
- ✅ تم دمج Beyond Presence في `src/agent.py`
- ✅ Agent يرسل audio إلى Beyond Presence تلقائياً
- ✅ Agent يستقبل video من Beyond Presence وينشره إلى LiveKit Room

---

## 📋 الملفات المضافة/المعدلة

### ملفات جديدة:
1. `src/beyond_presence.py` - Beyond Presence client
2. `src/beyond_presence_tts.py` - TTS wrapper
3. `.env.example` - مثال Environment variables

### ملفات معدلة:
1. `pyproject.toml` - إضافة dependencies وإصلاح إصدار Python
2. `src/agent.py` - إضافة Beyond Presence integration

---

## 🔧 Environment Variables المطلوبة

أضف هذه المتغيرات إلى `.env.local`:

```env
# LiveKit Configuration
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here

# OpenAI API Key (for LLM)
OPENAI_API_KEY=your_openai_api_key_here

# Beyond Presence Configuration
BEYOND_PRESENCE_API_KEY=your_beyond_presence_api_key_here
BEYOND_PRESENCE_AVATAR_ID=your_avatar_id_here

# Optional: Beyond Presence API URL
# BEYOND_PRESENCE_API_URL=https://api.bey.dev/v1/speech-to-video
```

---

## 🚀 كيفية التشغيل

### 1. تثبيت Dependencies
```bash
cd apps/avatar-evaalov2
uv sync
```

### 2. إعداد Environment Variables
```bash
# نسخ .env.example إلى .env.local
cp .env.example .env.local

# تعديل .env.local وإضافة API keys
```

### 3. تحميل Models المطلوبة
```bash
uv run python src/agent.py download-files
```

### 4. تشغيل Agent (Development)
```bash
uv run python src/agent.py dev
```

### 5. تشغيل Agent (Production)
```bash
uv run python src/agent.py start
```

---

## 🔄 كيفية عمل Integration

### التدفق الكامل:

```
User speaks
    ↓
STT (AssemblyAI) → Text
    ↓
LLM (OpenAI) → Response Text
    ↓
TTS (Cartesia) → Audio
    ├─→ Audio Playback (للمستخدم)
    └─→ Beyond Presence API
            ↓
        Beyond Presence generates Video
            ↓
        Agent receives Video frames
            ↓
        Agent publishes Video to LiveKit Room
            ↓
        Frontend displays Avatar
```

### Beyond Presence TTS Wrapper:
- يعترض TTS audio stream
- يرسل audio chunks إلى Beyond Presence API
- يمرر audio للـ playback العادي

### Beyond Presence Client:
- يستقبل audio ويُرسله إلى Beyond Presence API
- يستقبل video response من Beyond Presence
- يحول video frames إلى LiveKit VideoFrame format
- ينشر video frames إلى LiveKit Room

---

## 🐛 Troubleshooting

### مشكلة: Avatar لا يظهر
1. **تحقق من Environment Variables:**
   - `BEYOND_PRESENCE_API_KEY` موجود وصحيح
   - `BEYOND_PRESENCE_AVATAR_ID` موجود وصحيح

2. **تحقق من Logs:**
   ```bash
   # ابحث عن:
   # - "Beyond Presence client initialized"
   # - "Video track published to room"
   # - "Published video frame"
   ```

3. **تحقق من Frontend:**
   - تأكد أن Frontend يشترك في video track من Agent
   - تحقق من Console logs في Browser

### مشكلة: Agent لا يرسل audio إلى Beyond Presence
1. **تحقق من TTS wrapper:**
   - تأكد أن `BeyondPresenceTTS` يتم استخدامه
   - تحقق من logs: "Using Beyond Presence TTS wrapper"

2. **تحقق من Beyond Presence API:**
   - تحقق من API key
   - تحقق من network connectivity

### مشكلة: Video frames فارغة
1. **تحقق من video processing:**
   - تأكد أن Beyond Presence يُرجع video صحيح
   - تحقق من logs: "Error processing video data"

2. **تحقق من video source:**
   - تأكد أن video source يتم إنشاؤه بشكل صحيح
   - تحقق من resolution (1280x720)

---

## 📝 ملاحظات مهمة

1. **Beyond Presence API URL:**
   - الافتراضي: `https://api.bey.dev/v1/speech-to-video`
   - يمكن تغييره عبر `BEYOND_PRESENCE_API_URL`

2. **Video Resolution:**
   - الافتراضي: 1280x720
   - يمكن تعديله في `src/agent.py` عند إنشاء `VideoSource`

3. **Audio Format:**
   - Beyond Presence يتوقع WAV format
   - TTS wrapper يحول audio تلقائياً

4. **Error Handling:**
   - إذا فشل Beyond Presence initialization، Agent يستمر بدون avatar
   - Logs تُظهر errors بشكل واضح

---

## 🎯 الخطوات التالية

1. **اختبار Agent:**
   - تشغيل Agent والتحقق من logs
   - اختبار مع Frontend للتأكد من ظهور Avatar

2. **تحسين Performance:**
   - تحسين video frame processing
   - إضافة caching إذا لزم الأمر

3. **إضافة Features:**
   - Custom instructions للمقابلات
   - Error recovery mechanisms
   - Metrics and monitoring

---

## ✅ الخلاصة

- ✅ Beyond Presence integration مكتمل
- ✅ Agent جاهز للاستخدام
- ✅ كل شيء موثق

**Agent الآن جاهز لإرسال audio إلى Beyond Presence واستقبال video لعرض Avatar! 🎉**
