# Vapi → ElevenLabs → Beyond Presence Integration Guide

## 📋 نظرة عامة

هذا الدليل يشرح كيفية ربط Vapi مع ElevenLabs و Beyond Presence.

---

## 🔄 التدفق الكامل

```
Vapi (العقل)
  ↓ (يدير الحوار)
ElevenLabs (TTS)
  ↓ (يولد الصوت)
Backend Webhook (يستقبل audio)
  ↓ (يرسل audio chunks)
Beyond Presence (الأفاتار)
  ↓ (يعرض الفيديو)
Frontend (iframe)
```

---

## ⚙️ إعداد Vapi Assistant

### 1. في Vapi Dashboard:

1. افتح Assistant Configuration
2. اذهب إلى **Voice Settings**
3. اختر **ElevenLabs** كـ Voice Provider
4. أدخل:
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID` (مثال: `21m00Tzpb8gXv3hC`)

### 2. إعداد Webhook:

1. في Assistant Configuration، اذهب إلى **Webhooks**
2. أضف Webhook URL:
   ```
   http://your-backend-url/api/video-interview/vapi-webhook
   ```
3. اختر Events:
   - ✅ `audio` - لاستقبال audio chunks
   - ✅ `transcript` - لاستقبال النصوص
   - ✅ `status-update` - لتحديثات الحالة

### 3. Interview Framework:

- Interview Framework **ثابت** داخل Vapi Assistant
- لا يُرسل في Dynamic Prompt
- موجود في Assistant System Prompt (في Vapi Dashboard)

---

## 🔧 Backend Configuration

### Webhook Endpoint:

```typescript
POST /api/video-interview/vapi-webhook
```

**يستقبل:**
```json
{
  "message": {
    "type": "audio",
    "audio": "base64_audio_data",
    "sessionId": "video-interview-123-1234567890",
    "call": {
      "id": "call-id"
    }
  }
}
```

**يرسل إلى Beyond Presence:**
- Audio chunks (base64)
- Session ID
- Format: `pcm_24000`

---

## 🎭 Frontend Configuration

### Beyond Presence iframe:

```jsx
<iframe
  src={`https://beyondpresence.ai/embed/${avatarId}?autoplay=1&mute=0`}
  allow="camera; microphone; autoplay; fullscreen"
  style={{
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '12px'
  }}
/>
```

### VapiWidget:

```jsx
<VapiWidget
  apiKey={vapiAssistants.videoInterview.apiKey}
  assistantId={vapiAssistants.videoInterview.assistantId}
  config={{
    ...vapiAssistants.videoInterview.config,
    callOptions: {
      systemMessage: dynamicSystemPrompt // من Backend
    }
  }}
/>
```

---

## 📝 Environment Variables

```env
# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=21m00Tzpb8gXv3hC

# Beyond Presence
BEYOND_PRESENCE_API_KEY=your_beyond_presence_api_key
BEYOND_PRESENCE_AUDIO_ENDPOINT=https://api.beyondpresence.ai/v1/audio
BEYOND_PRESENCE_AVATAR_ID=your_avatar_id

# Vapi
VAPI_API_KEY=7c4dacd3-c0fe-4a6c-bf4f-d9601585f155
```

---

## ✅ Checklist

- [ ] Vapi Assistant مُكوّن لاستخدام ElevenLabs
- [ ] Webhook URL مُضاف في Vapi Dashboard
- [ ] Backend webhook endpoint يعمل (`/api/video-interview/vapi-webhook`)
- [ ] Beyond Presence API key موجود في `.env`
- [ ] Frontend يعرض Beyond Presence iframe
- [ ] VapiWidget يبدأ يدوياً من المستخدم

---

## 🐛 Troubleshooting

### المشكلة: Audio لا يصل إلى Beyond Presence

**الحل:**
1. تحقق من أن webhook URL صحيح في Vapi Dashboard
2. تحقق من أن `BEYOND_PRESENCE_API_KEY` موجود في `.env`
3. تحقق من logs في Backend

### المشكلة: Vapi لا يستخدم ElevenLabs

**الحل:**
1. تحقق من Voice Settings في Vapi Dashboard
2. تأكد من أن `ELEVENLABS_API_KEY` صحيح
3. تحقق من أن Voice Provider = ElevenLabs

### المشكلة: Beyond Presence iframe لا يعرض الأفاتار

**الحل:**
1. تحقق من `BEYOND_PRESENCE_AVATAR_ID`
2. تحقق من أن iframe URL صحيح
3. تحقق من console للأخطاء

---

## 📚 المراجع

- [Vapi Documentation](https://docs.vapi.ai/)
- [ElevenLabs API](https://elevenlabs.io/docs/api-reference)
- [Beyond Presence API](https://beyondpresence.ai/docs)

