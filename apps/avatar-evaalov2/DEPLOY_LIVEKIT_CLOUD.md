# نشر وكيل المقابلات على LiveKit Cloud

الوكيل `video-interview-agent` يُنشر على **LiveKit Cloud** (توسع تلقائي). المصدر
جاهز ومحصّن (صوت آمن + انتظار المرشح + سقف جلسة). هذه خطوات النشر — تُنفَّذ من
جهازك لأنها تحتاج تسجيل دخول `lk` CLI (لا يمكن تنفيذها بالنيابة).

## المتطلبات
- LiveKit CLI مثبّت: https://docs.livekit.io/home/cli/cli-setup
- من داخل مجلد `cursor-react/apps/avatar-evaalov2`

## 1) تسجيل الدخول
```bash
lk cloud auth
```

## 2) ضبط الأسرار (env) للوكيل على LiveKit Cloud
اضبط القيم التالية بقيمك الفعلية (نفس القيم المستخدمة على السيرفر). الطريقة الأسهل:
لوحة LiveKit Cloud → Agents → (الوكيل) → Environment/Secrets، أو عبر `lk agent`
أثناء الإنشاء.

| المتغير | القيمة |
|---------|--------|
| `LIVEKIT_URL` | `wss://evaalo-qk1twe6k.livekit.cloud` |
| `LIVEKIT_API_KEY` | (مفتاحك) |
| `LIVEKIT_API_SECRET` | (سرّك) |
| `OPENAI_API_KEY` | (مفتاحك) |
| `SPEECHMATICS_API_KEY` | (مفتاحك) |
| `ELEVENLABS_API_KEY` | (مفتاحك) |
| `ELEVENLABS_VOICE_ID` | `a0K946lDZEyNuRXJc7sI` ← الصوت العراقي الجديد |
| `BEYOND_PRESENCE_API_KEY` | (مفتاحك) |
| `BEYOND_PRESENCE_AVATAR_ID` | (معرّف الأفتار) |
| `TURN_DETECTOR_MODEL` | `multilingual` (موصى به للعربي/الإنجليزي) |

اختياري (للضبط الدقيق — لها قيم افتراضية آمنة بالكود):
`INTERVIEW_GREETING_WAIT_TIMEOUT=60` · `INTERVIEW_MAX_SESSION_SECONDS=1800` ·
`INTERVIEW_TTS_ERROR_LIMIT=3` · `ELEVENLABS_FALLBACK_VOICE_IDS=EXAVITQu4vr4xnSDxMaL,Xb7hH8MSUJpSbSDYk0k2`

## 3) النشر
أول مرة (إن لم يُنشأ بعد):
```bash
lk agent create
```
التحديثات اللاحقة (وبعد كل تعديل):
```bash
lk agent deploy
```

## 4) التحقق
```bash
lk agent status          # يجب أن يظهر الوكيل running
lk agent logs            # ابحث عن: registered worker ... agent_name=video-interview-agent
```
ثم **مقابلة فيديو حقيقية** من evaalo.com: الوكيل ينضم → يرحّب بعد ظهور الأفتار
(لا صمت) → بالصوت العراقي الجديد → حوار كامل → إنهاء طبيعي.

## ملاحظات
- الصوت الجديد مخصص؛ إن اختفى مستقبلاً فالوكيل يتحول تلقائياً لصوت premade
  احتياطي (fail-safe) ولا يخرس.
- التقييم (المرحلة 3) يتم في n8n؛ إن فشل، مراقب الباك يرسل تنبيهاً للمالك خلال ~15 دقيقة.
- البديل (إن تعذّر LiveKit Cloud): النشر على VPS بنمط الرسبشن — راجع
  `evaalo-reception-agent` كمرجع.
