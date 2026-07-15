# اختبار Frontend → Backend Connection

## ✅ ما تم التحقق منه:

### 1. Backend Endpoints
- ✅ `/health` - يعمل
- ✅ `/api/video-interview/start` - structure صحيح
- ✅ `/api/video-interview/audio` - موجود وجاهز

### 2. Frontend Code Review

#### ✅ `startInterview()` function:
- يحصل على microphone/camera permissions
- يرسل POST إلى `/api/video-interview/start`
- يحفظ sessionId
- يبدأ audio capture

#### ✅ `startAudioCapture()` function:
- يستخدم MediaRecorder لتسجيل audio
- يحول audio إلى base64
- يرسل chunks كل 2 ثانية

#### ✅ `sendAudioChunkToBackend()` function:
- يرسل POST إلى `/api/video-interview/audio`
- يتضمن: audio, sessionId, candidateId
- يستقبل response مع AI reply
- يحدث conversation history

---

## 🧪 خطوات الاختبار اليدوي:

### الخطوة 1: التحقق من Frontend
1. افتح http://localhost:3000/video-interview-call?candidateId=YOUR_ID
2. تحقق من أن الصفحة تفتح بدون أخطاء
3. تحقق من console للبحث عن أخطاء

### الخطوة 2: اختبار Start Interview
1. انقر على "Start Video Interview"
2. امنح permissions للميكروفون والكاميرا
3. تحقق من:
   - ✅ فيديو المستخدم يظهر
   - ✅ sessionId يتم حفظه
   - ✅ "Connected to Backend" يظهر

### الخطوة 3: اختبار Audio Sending
1. تحدث في الميكروفون
2. افتح Network tab في DevTools
3. تحقق من:
   - ✅ POST requests إلى `/api/video-interview/audio`
   - ✅ Request body يحتوي على audio, sessionId, candidateId
   - ✅ Response يحتوي على reply و transcribedText

### الخطوة 4: اختبار Full Flow
1. تحدث جملة كاملة
2. انتظر response من Backend
3. تحقق من:
   - ✅ STT يعمل (transcribedText موجود)
   - ✅ LLM يعمل (reply موجود)
   - ✅ Conversation history يتم تحديثه

---

## 🔍 ما يجب التحقق منه:

### في Frontend Console:
- ❌ لا توجد أخطاء CORS
- ❌ لا توجد أخطاء network
- ❌ لا توجد أخطاء في audio capture

### في Backend Logs:
- ✅ `/start` endpoint يتم استدعاؤه
- ✅ `/audio` endpoint يتم استدعاؤه
- ✅ STT service يعمل
- ✅ LLM service يعمل (إذا كان API key موجود)
- ✅ TTS service يعمل (إذا كان API key موجود)

---

## ⚠️ المشاكل المحتملة:

1. **CORS Error:**
   - الحل: تحقق من CORS settings في Backend

2. **Audio Permission Denied:**
   - الحل: تأكد من منح permissions للميكروفون

3. **Candidate Not Found:**
   - الحل: استخدم candidateId حقيقي من قاعدة البيانات

4. **API Keys Missing:**
   - الحل: STT و LLM سيعملان، لكن TTS يحتاج ELEVENLABS_API_KEY

---

## 📝 ملاحظات:

- Frontend code يبدو صحيحاً
- Backend endpoints جاهزة
- الاتصال يجب أن يعمل إذا كانت API keys موجودة

**الخطوة التالية:** اختبار يدوي من Frontend


