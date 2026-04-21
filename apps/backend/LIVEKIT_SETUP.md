# LiveKit Setup Guide

## الخطوة 1: الحصول على LiveKit API Keys

### الخيار A: استخدام LiveKit Cloud (موصى به للبداية)
1. اذهب إلى: https://cloud.livekit.io
2. سجّل حساب جديد أو سجّل الدخول
3. أنشئ Project جديد
4. احصل على:
   - **LiveKit URL**: `wss://your-project.livekit.cloud`
   - **API Key**: من صفحة Settings
   - **API Secret**: من صفحة Settings

### الخيار B: تشغيل LiveKit Server محلياً
```bash
# باستخدام Docker
docker run --rm \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/udp \
  -e LIVEKIT_KEYS="your-api-key: your-api-secret" \
  livekit/livekit-server
```

## الخطوة 2: إضافة المتغيرات إلى .env

أضف هذه المتغيرات إلى ملف `.env` في Backend:

```env
# LiveKit Configuration
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key-here
LIVEKIT_API_SECRET=your-api-secret-here
```

## الخطوة 3: التحقق من الإعداد

بعد إضافة المتغيرات، أعد تشغيل Backend وتحقق من:
- ✅ LiveKit connection successful
- ✅ Agent can connect to LiveKit

## مواءمة مع وثائق LiveKit (قيم مُستحسنة لهذا المشروع)

مراجع: [الاتصال والموثوقية](https://docs.livekit.io/intro/basics/connect/)، [Adaptive stream + simulcast](https://docs.livekit.io/transport/media/subscribe/)، [دورة حياة الوظيفة (Agents)](https://docs.livekit.io/agents/server/job/).

| المنطقة | التوصية | السبب |
|--------|---------|--------|
| **Frontend `Room`** | `adaptiveStream`: **معطّل افتراضياً** للأفاتار بملء الشاشة؛ إن فُعّل استخدم **`pixelDensity: 'screen'`** (مطبّق في `VideoInterviewCall` عبر `livekitAdaptiveStreamRoomOption`) | الوثائق: adaptive يختار أقل bitrate مناسب لحجم العنصر؛ للفيديو البطل نفضّل عدم خفض الطبقة تلقائياً إلا عند ضعف الشبكة. |
| | `dynacast`: **معطّل افتراضياً**؛ فعّله فقط لجلسات كبيرة / VP9-SVC | يقلّل حمل الناشر لكن قد يزيد تقطيع الفيديو في سيناريو مقابلة 1:1. |
| | `track.attach()` على `<video>` | الوثائق: **لازم** ليعمل adaptive stream بشكل صحيح عند تفعيله. |
| | `disconnectOnPageLeave`: **false** في SPA | المقابلة تُنهى يدوياً؛ يتفادى قطعاً خاطئاً عند تنقل داخل التطبيق. |
| **اشتراك فيديو الأفاتار** | `setVideoQuality(HIGH)` + `setVideoDimensions` بحجم دنيا (مثل 1280×720) | يطابق قسم **Simulcast controls** في نفس صفحة الاشتراك. |
| **Connect (JS)** | `peerConnectionTimeout` أطول على شبكات بطيئة (المشروع يستخدم ~45s)، `autoSubscribe` للصوت/الصورة | مطابق لخيارات `RoomConnectOptions` في مرجع SDK. |
| **شبكة** | LiveKit Cloud يوفّر TURN (UDP/TCP/TLS) — لا تعطّل UDP إلا إن اضطررت | ترتيب المحاولة في الوثائق: ICE/UDP → TURN/UDP → TCP → TURN/TLS. |
| **Agents** | `job_ctx.connect` مبكراً + `AutoSubscribe` ليشمل فيديو الأفاتار إن لزم | [Job lifecycle](https://docs.livekit.io/agents/server/job.md). |

متغيرات الواجهة (`.env`): راجع تعليقات `VideoInterviewCall.jsx` حول `VITE_LIVEKIT_*` و`VITE_AVATAR_*`.

## ملاحظات مهمة

1. **LiveKit Cloud**: مجاني للبداية مع حدود معينة
2. **LiveKit Server محلي**: يحتاج إلى إعداد أكثر لكنه مجاني تماماً
3. **API Keys**: احفظها بشكل آمن ولا تشاركها

## الخطوات التالية

بعد إعداد LiveKit:
- ✅ إنشاء LiveKit Agent في Backend
- ✅ ربط Beyond Presence مع LiveKit
- ✅ تحديث Frontend لاستخدام LiveKit WebRTC
