# 📋 تحليل لوجات الـ Agent

## مصدر اللوجات

اللوجات من **Agent (LiveKit)**:
- STT: **Deepgram** (مباشر من LiveKit)
- LLM: OpenAI GPT-4.1-mini
- TTS: ElevenLabs
- Avatar: Beyond Presence (bey-avatar-agent)

---

## 1️⃣ Fragments وتفتت الـ Transcript

### ما يظهر في اللوج

```
received user transcript: "So"
received user transcript: "Can you"
received user transcript: "My name"
received user transcript: "I told"
received user transcript: "I have"
received user transcript: "experience as an"
received user transcript: "Tell you more about"
```

### السبب

- الـ **Agent** يعتمد على **Deepgram** من LiveKit (ميكروفون → LiveKit → Agent → Deepgram).
- Deepgram يرسل **interim/final** chunks بشكل متكرر.
- **Transcript Aggregation** الموجود في **Backend** (Whisper path) **لا يطبَّق** على مسار الـ Agent.
- الـ Agent يرسل كل fragment للـ LLM → ردود متكررة، TTS متعدد، Avatar غير مستقر.

### الإجراء

- Aggregation في الـ Backend يعمل فقط لمسار **Whisper**.
- لتقليل التفتت في مسار **Agent/Deepgram** يلزم إما:
  - **تجميع transcripts** داخل الـ Agent قبل إرسالها للـ LLM، أو
  - استخدام **Turn Detection** (مع تعارضه مع العربية حالياً)، أو
  - التأكد من **preemptive_generation=False** وتقليل التحفيز على الرد السريع للـ fragments.

---

## 2️⃣ "using preemptive generation"

### ما يظهر في اللوج

```
using preemptive generation
preemptive_lead_time: 0.05s
```

### الحالة في الكود

- في `agent.py`: `preemptive_generation=False` داخل `AgentSession(...)`.
- اللوج "using preemptive generation" صادر من **مكتبة LiveKit agents**، وليس من تطبيقنا.

### الاحتمالات

1. السلوك الافتراضي الداخلي للمكتبة يختلف عن إعدادنا.
2. وجود مسار آخر (مثلاً TranscriptSynchronizer / Avatar) يفعّل منطقاً مشابهاً ويُسجّل نفس العبارة.
3. إصدار المكتبة أو تغيير في الـ API.

### الإجراء

- تم التأكيد أننا نمرّر `preemptive_generation=False`.
- تمت إضافة log صريح في الـ Agent عند الإنشاء: **"preemptive_generation=False (PRODUCTION GATE 1)"** للتحقق من أن إعدادنا يُستدعى.
- إن استمر ظهور "using preemptive generation" فالأمر غالباً من المكتبة؛ يفضّل مراجعة **LiveKit agents** (الإصدار، الـ changelog، أو issues).

---

## 3️⃣ Playback وقطع الصوت

### ما يظهر في اللوج

```
didn't receive playback finished event after clear buffer, marking playout as done arbitrarily
playback_finished called more times than playback segments were captured
speech not done in time after interruption, cancelling the speech arbitrarily
flush audio emitter due to slow audio generation
```

### السبب

- تفتت الـ transcripts → ردود LLM متعددة → TTS متعددة.
- تزامن الـ playback مع الـ Avatar (TranscriptSynchronizer) يتأثر:
  - عدد مقاطع التشغيل لا يطابق الأحداث.
  - انقطاع المستخدم (interrupt) أو التأخير يُحدث "speech not done in time" و "clear buffer".

### الإجراء

- تخفيف التفتت (بالتجميع أو بتحسين الـ turn-taking) يقلّل تعدد الـ TTS ويحسّن تزامن الـ playback.
- معالجة "clear buffer" و "flush audio" تحتاج فهم سلوك **TranscriptSynchronizer** و **AvatarSession** (وفق وثائق LiveKit/Beyond Presence).

---

## 4️⃣ Silero VAD أبطأ من realtime

### ما يظهر في اللوج

```
silero inference is slower than realtime
delay: 0.27s (وأحياناً 2–4s)
```

### المعنى

- VAD يتأخر عن الزمن الحقيقي للصوت.
- قد يؤخر **فصل الأدوار** (turn-taking) ويزيد احتمال التفتت والـ preemptive الخاطئ.

### الإجراء

- تحذير أداء وليس عطباً صريحاً.
- التجميع (Aggregation) يعوّض جزئياً عن تأخر الـ VAD.
- تحسينات مستقبلية: خيارات VAD أسرع أو ضبط عتبات الـ Silero إن وُجدت.

---

## 5️⃣ أخطاء لا ترتبط بالـ Agent مباشرة

| الرسالة | التفسير |
|--------|----------|
| `failed to send usage report: http status: 401` | إرسال إحصائيات استخدام؛ 401 = مصادقة. **ضجيج** ولا يؤثر على المقابلة. |
| `getaddrinfo failed` / `ClientConnectorDNSError` | فشل DNS أو شبكة عند الاتصال بـ LiveKit Cloud. |
| `ClientConnectionResetError` / `DuplexClosed` | انقطاع اتصال (شبكة، إعادة تشغيل، إغلاق من الطرف الآخر). |
| `Task was destroyed but it is pending!` | مهمة asyncio أُلغي تنفيذها قبل الاكتمال (غالباً عند إغلاق Worker أو إعادة التشغيل). |
| `job executor is unresponsive` | الـ job runner لم يرد في الوقت المحدد (عبء CPU، انتظار I/O، إلخ). |
| `RpcError: Connection timeout` / `Ack received for unexpected RPC request` | مهلة RPC أو تزامن الطلبات مع Avatar/LiveKit أثناء الإغلاق أو إعادة الاتصال. |

---

## 6️⃣ خلاصة سريعة

| المشكلة | المصدر | الإجراء |
|---------|--------|---------|
| **Fragments** | Agent ← Deepgram (بدون تجميع) | تطبيق Aggregation في مسار Agent أو تحسين turn-taking. |
| **"using preemptive generation"** | مكتبة LiveKit agents | نحن نضع `preemptive_generation=False`؛ تمت إضافة log للتأكيد. مراجعة إصدار المكتبة إن استمر. |
| **Playback / flush / interrupt** | تفتت + تزامن Avatar | تخفيف التفتت أولاً؛ ثم ضبط إعدادات الـ playback إن لزم. |
| **Silero أبطأ من realtime** | VAD | تحذير أداء؛ التعويض عبر Aggregation. |
| **401 / DNS / Connection reset / RPC** | شبكة، إغلاق، استخدام | معالجة كـ أخطاء شبكة أو إدارة جلسات، وليس منطق Agent. |

---

## 7️⃣ ما هو مضبوط بالفعل

- **Backend (Whisper path):**
  - إزالة `language: 'auto'` ومنع Infinite STT Loop.
  - Circuit Breaker (إيقاف STT بعد 3 أخطاء 400 متتالية).
  - حد أقصى لطول الـ buffer (مثلاً 10 ثوانٍ).
- **Agent:**
  - `preemptive_generation=False` في `AgentSession`.
  - تعليق في الكود + log صريح للتأكيد.

---

**تاريخ التحليل:** بناءً على اللوجات المرفوعة.  
**الحالة:** تحليل للوجات وتوثيق للإجراءات الحالية والمقترحة.
