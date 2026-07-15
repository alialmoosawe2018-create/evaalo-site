# تقرير فحص Agent - Evalo Avatar v2

**التاريخ:** 2026-01-12  
**المسار:** `apps/avatar-evaalov2`

---

## ✅ ما تم فحصه

### 1. **البنية الأساسية**
- ✅ Agent موجود في `src/agent.py`
- ✅ يستخدم LiveKit Agents Framework الرسمي
- ✅ يحتوي على `AgentServer` و `AgentSession`
- ✅ Config موجود في `livekit.toml`

### 2. **المكونات الحالية**
- ✅ **STT:** AssemblyAI Universal Streaming
- ✅ **LLM:** OpenAI GPT-4.1-mini
- ✅ **TTS:** Cartesia Sonic-3
- ✅ **VAD:** Silero
- ✅ **Turn Detection:** MultilingualModel
- ✅ **Noise Cancellation:** BVC

### 3. **الملفات المطلوبة**
- ✅ `.env.local` موجود
- ✅ `pyproject.toml` موجود
- ✅ `uv.lock` موجود
- ✅ `Dockerfile` موجود

---

## ⚠️ المشاكل المكتشفة

### 1. **مشكلة إصدار Python**
- **المشكلة:** Python 3.14 مثبت، لكن `pyproject.toml` يحدد `requires-python = ">=3.10, <3.14"`
- **التأثير:** Agent قد لا يعمل بشكل صحيح مع Python 3.14
- **الحل:** 
  - استخدام Python 3.13 أو أقل
  - أو تحديث `pyproject.toml` لدعم Python 3.14

### 2. **عدم وجود Beyond Presence Integration**
- **المشكلة:** Agent لا يحتوي على تكامل Beyond Presence للأفاتار
- **التأثير:** لا يوجد فيديو أفاتار متحرك
- **الحل:** إضافة Beyond Presence integration (انظر أدناه)

### 3. **Avatar Integration معطل**
- **المشكلة:** كود Avatar في `agent.py` معطل (معلق)
- **الموقع:** السطور 100-106
- **الحل:** إضافة Beyond Presence بدلاً من Hedra

---

## 📋 ما يحتاج إلى إصلاح

### 1. **إصلاح إصدار Python**
```toml
# في pyproject.toml
requires-python = ">=3.10, <3.15"  # أو استخدام Python 3.13
```

### 2. **إضافة Beyond Presence Integration**
- إضافة dependency للـ HTTP client (aiohttp)
- إنشاء wrapper لـ Beyond Presence API
- ربط TTS audio مع Beyond Presence
- نشر video frames من Beyond Presence إلى LiveKit Room

### 3. **تحديث Agent Instructions**
- تعديل instructions لتكون مناسبة لمقابلات الفيديو
- إضافة context عن المقابلة

---

## 🔧 الخطوات المطلوبة لإضافة Beyond Presence

### الخطوة 1: إضافة Dependencies
```toml
# في pyproject.toml
dependencies = [
    "livekit-agents[silero,turn-detector]~=1.3",
    "livekit-plugins-noise-cancellation~=0.2",
    "python-dotenv",
    "aiohttp",  # للاتصال بـ Beyond Presence API
    "av",       # لمعالجة video frames
]
```

### الخطوة 2: إنشاء Beyond Presence Wrapper
- إنشاء ملف `src/beyond_presence.py`
- إضافة functions لإرسال audio واستقبال video
- ربط video frames مع LiveKit `VideoSource`

### الخطوة 3: تعديل Agent
- إضافة Beyond Presence integration في `my_agent` function
- ربط TTS audio stream مع Beyond Presence
- نشر video track إلى LiveKit Room

---

## ✅ ما يعمل بشكل صحيح

1. ✅ **البنية الأساسية:** Agent من LiveKit الرسمي
2. ✅ **LiveKit Config:** `livekit.toml` موجود ومضبوط
3. ✅ **Dependencies:** جميع الحزم المطلوبة موجودة في `pyproject.toml`
4. ✅ **UV Package Manager:** مثبت ويعمل
5. ✅ **Tests:** ملفات test موجودة

---

## 🎯 التوصيات

### قصيرة المدى:
1. **إصلاح إصدار Python** - استخدام Python 3.13
2. **اختبار Agent الأساسي** - التأكد من أن STT/LLM/TTS يعملون
3. **إضافة Beyond Presence** - تكامل الأفاتار

### طويلة المدى:
1. **تحسين Instructions** - جعل Agent مناسب لمقابلات الفيديو
2. **إضافة Error Handling** - معالجة أخطاء Beyond Presence
3. **إضافة Logging** - تتبع تدفق البيانات

---

## 📝 ملاحظات إضافية

- Agent يستخدم `inference` models من LiveKit Cloud
- يحتاج إلى `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` في `.env.local`
- Agent جاهز للعمل مع Frontend أو Telephony
- يمكن تشغيله بـ `uv run python src/agent.py dev`

---

**الحالة العامة:** ✅ Agent صحيح من ناحية البنية، لكن يحتاج إلى:
1. إصلاح إصدار Python
2. إضافة Beyond Presence integration
3. اختبار شامل
