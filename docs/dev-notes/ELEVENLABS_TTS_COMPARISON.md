# مقارنة بين ElevenLabs TTS (Plugins) و ElevenLabs TTS (Inference)

## الوضع الحالي (الطريقة المستخدمة الآن)

```python
from livekit.plugins import elevenlabs

original_tts = elevenlabs.TTS(
    voice_id=ELEVENLABS_VOICE_ID,
    api_key=ELEVENLABS_API_KEY,
)
```

### المزايا:
- ✅ استخدام حساب ElevenLabs الخاص بك
- ✅ دعم الأصوات المخصصة (Custom Voices) و Voice Cloning
- ✅ تحكم كامل في استخدام API
- ✅ لا تحتاج LiveKit Inference (أرخص في بعض الحالات)

### العيوب:
- ❌ تحتاج API key من ElevenLabs
- ❌ تدفع مباشرة لـ ElevenLabs
- ❌ تحتاج إدارة API key بنفسك

---

## الطريقة الجديدة (LiveKit Inference)

```python
from livekit.agents import inference

original_tts = inference.TTS(
    model="elevenlabs/eleven_turbo_v2_5",
    voice="Xb7hH8MSUJpSbSDYk0k2",  # Voice ID من ElevenLabs
    language="en"
)
```

### المزايا:
- ✅ لا تحتاج API key من ElevenLabs
- ✅ دفع واحد لـ LiveKit Inference (بما في ذلك TTS)
- ✅ إدارة أبسط (لا تحتاج إدارة API keys متعددة)
- ✅ دعم جميع النماذج المتاحة في LiveKit Inference

### العيوب:
- ❌ لا تدعم Custom Voices و Voice Cloning
- ❌ تدعم فقط الأصوات الافتراضية من ElevenLabs
- ❌ تحتاج LiveKit Inference (مدفوع)
- ❌ قد تكون أغلى من الطريقة المباشرة (حسب الاستخدام)

---

## النماذج المتاحة في LiveKit Inference

| Model ID | Languages | الوصف |
| -------- | --------- | ----- |
| `elevenlabs/eleven_flash_v2` | `en` | أسرع نموذج، إنجليزية فقط |
| `elevenlabs/eleven_flash_v2_5` | 33 لغة (منها العربية `ar`) | أسرع نموذج، دعم متعدد اللغات |
| `elevenlabs/eleven_turbo_v2` | `en` | نموذج سريع، إنجليزية فقط |
| `elevenlabs/eleven_turbo_v2_5` | 33 لغة (منها العربية `ar`) | نموذج سريع، دعم متعدد اللغات ⭐ **موصى به** |
| `elevenlabs/eleven_multilingual_v2` | 29 لغة (منها العربية `ar`) | نموذج متعدد اللغات |

---

## الأصوات المتاحة

يمكنك استكشاف الأصوات المتاحة في:
- [ElevenLabs Voice Library](https://elevenlabs.io/app/default-voices) (حساب مجاني مطلوب)

### أمثلة على الأصوات:

| Name | Description | Language | ID |
| -------- | ----------- | -------- | -------- |
| Alice | Clear and engaging, friendly British woman | `en-GB` | `Xb7hH8MSUJpSbSDYk0k2` |
| Chris | Natural and real American male | `en-US` | `iP95p4xoKVk53GoZ742B` |
| Eric | A smooth tenor Mexican male | `es-MX` | `cjVigY5qzO86Huf0OWal` |
| Jessica | Young and popular, playful American female | `en-US` | `cgSgspJ2msm6clMCkdW9` |

---

## التوصية

### استخدم **LiveKit Inference** إذا:
- ✅ تريد إدارة أبسط (لا تريد إدارة API keys متعددة)
- ✅ لا تحتاج Custom Voices أو Voice Cloning
- ✅ تريد دفع واحد لـ LiveKit Inference
- ✅ تستخدم اللغة الإنجليزية أو إحدى اللغات المدعومة

### استخدم **ElevenLabs Plugin** (الطريقة الحالية) إذا:
- ✅ تحتاج Custom Voices أو Voice Cloning
- ✅ تريد استخدام حساب ElevenLabs الخاص بك مباشرة
- ✅ تريد تتبع استخدام API مباشرة
- ✅ تريد التكلفة الأقل (حسب الاستخدام)

---

## كيفية التحويل إلى LiveKit Inference

إذا قررت استخدام LiveKit Inference، يمكن تحديث الكود كالتالي:

```python
# بدلاً من:
from livekit.plugins import elevenlabs

original_tts = elevenlabs.TTS(
    voice_id=ELEVENLABS_VOICE_ID,
    api_key=ELEVENLABS_API_KEY,
)

# استخدم:
from livekit.agents import inference

original_tts = inference.TTS(
    model="elevenlabs/eleven_turbo_v2_5",  # أو أي model آخر
    voice="Xb7hH8MSUJpSbSDYk0k2",  # Voice ID من ElevenLabs
    language="en"  # أو "ar" للعربية
)
```

### ملاحظات مهمة:
1. **لا تحتاج `ELEVENLABS_API_KEY` بعد الآن** - يمكن حذفه من `.env.local`
2. **Voice ID يبقى نفس الشيء** - نفس ID من ElevenLabs
3. **الكود الآخر لا يتغير** - `BeyondPresenceTTS` wrapper يبقى كما هو
4. **تأكد من أن LiveKit Inference مفعل** - قد تحتاج إعدادات إضافية

---

## الأسعار

- **ElevenLabs Plugin**: حسب [أسعار ElevenLabs](https://elevenlabs.io/pricing)
- **LiveKit Inference**: حسب [أسعار LiveKit Inference](https://livekit.io/pricing/inference#tts)

---

## المرجع

- [LiveKit Inference ElevenLabs Documentation](https://docs.livekit.io/agents/models/tts/inference/elevenlabs.md)
- [ElevenLabs Plugin Documentation](https://docs.livekit.io/agents/models/tts/plugins/elevenlabs.md)