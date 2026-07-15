# قائمة خطوات تحسين الصوت والأفتار وسرعة الاستجابة

تم تنفيذ جزء منها في الكود؛ الباقي للمتابعة اليدوية (بنية، إنتاج).

---

## ✅ تم تنفيذه (Backend)

| الخطوة | الوصف |
|--------|--------|
| 1 | **تخفيف مسار STT batch:** تعطيل LID + التوجيه الثلاثي افتراضياً. تفعيله فقط بـ `STT_ENABLE_BATCH_LID_ROUTING=1`. |
| 2 | **مسار batch خفيف:** بدون LID يُجرَّب Speechmatics ثم Deepgram ثم Whisper (بدون طلب Whisper لكشف اللغة أولاً). |
| 3 | **مؤقتات الصوت قابلة للضبط** عبر `.env` — الملف `src/voice/voiceTimingEnv.ts` يقرأ القيم. |
| 4 | **تسريع اختياري لـ TTS:** `VOICE_TTS_USE_TIMESTAMPS=0` يستخدم طلب ElevenLabs عادي (أخف) بدون محاذاة أحرف. |
| 5 | **مزامنة `voiceSessionCore.ts` مع `voiceWs.ts`** (نفس المؤقتات + TTS خفيف). |
| 6 | **`attachVoiceSession`** مُصدَّر من `voiceSessionCore.ts` ليتوافق مع `voiceInterviewWs.ts` (كان مفقوداً). |
| 7 | **`env.example`** يدمج إعدادات Voice + متغيرات STT/TTS بدون تكرار القسم. |

---

## 🔧 متغيرات البيئة (انسخ إلى `.env` حسب الحاجة)

```env
# STT: إعادة تفعيل المسار القديم (LID + Deepgram + Speechmatics) — أثقل
# STT_ENABLE_BATCH_LID_ROUTING=1

# سرعة الشعور بالاستجابة (milliseconds) — خفّض تدريجياً واختبر التداخل مع الصوت
VOICE_USER_STOPPED_MS=1400
VOICE_USER_STOPPED_PUNCT_MS=1200
VOICE_SPEECH_SILENCE_MS=1000
VOICE_TTS_TO_STT_DELAY_MS=600
VOICE_POST_AUDIO_PADDING_MS=250
VOICE_POST_TTS_PADDING_MS=200
VOICE_PLAYBACK_ENDED_TIMEOUT_MS=30000
VOICE_PLAYBACK_FALLBACK_MS=15000
VOICE_POST_PLAYBACK_RESUME_MS=600

# TTS: تعطيل timestamps / المحاذاة لتخفيف الحمل (أسرع؛ قد يؤثر على مزامنة الكلمات في الواجهة)
# VOICE_TTS_USE_TIMESTAMPS=0
```

---

## 📋 متابعة يدوية — استقرار الأفتار (LiveKit)

مراجع رسمية مفيدة:

- [LiveKit — Connectivity](https://docs.livekit.io/home/client/connect/)
- [LiveKit — Region / deployment](https://docs.livekit.io/home/cloud/region/)
- [WebRTC — Managing bandwidth](https://docs.livekit.io/home/client/tracks/subscribe/) (من خلال وثائق LiveKit للجلسات)

| الخطوة | الإجراء |
|--------|---------|
| A | استخدم أقرب **منطقة (region)** لخادم LiveKit والعملاء (تقليل latency وتقطيع الفيديو). |
| B | راقب **Bitrate / Simulcast** في لوحة LiveKit؛ جرّب降低 جودة الفيديو للاختبار. |
| C | تأكد أن **ميك واحد فقط** يُغذي مسار STT (تجنب تغذية مزدوجة: عميل + Agent). |
| D | على العميل: إغلاق تبويبات ثقيلة، VPN قد يزيد jitter. |
| E | راجع `PLAYBACK_ENDED` من الواجهة — يجب إرساله بعد انتهاء الصوت حتى يستأنف الاستماع بدون race. |

---

## 📋 متابعة يدوية — تخفيف الوكيل (LLM)

| الخطوة | الإجراء |
|--------|---------|
| F | اختصار الـ prompt في `llmService.ts` (إزالة أمثلة طويلة غير ضرورية لكل طلب). |
| G | الإبقاء على «2–3 جمل كحد أقصى» في تعليمات الـ LLM لتقليل أجزاء TTS. |
| H | إبقاء مفاتيح API غير المستخدمة معطّلة في `.env` لتجنب فروع كود غير لازمة. |

---

## 🔄 مراجعة دورية

- [ ] بعد كل تغيير: مقابلة صوت نقية ثم مقابلة فيديو.
- [ ] قياس زمن: STT final → أول بايت TTS (من سجلات السيرفر `[LLM TIME]` / `[TTS TIME]`).
