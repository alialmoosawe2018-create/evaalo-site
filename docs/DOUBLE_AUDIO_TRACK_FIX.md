# 🔴 Double Audio Track (Echo) - إصلاح حرج

## ❌ **المشكلة الحقيقية:**

**المسار الخفي (القاتل):**

```
ElevenLabs TTS
 ├─▶ AgentSession audio output
 │    └─▶ LiveKit audio track (agent-*) ← تسمعه أنت
 └─▶ AvatarSession audio input
      └─▶ AvatarSession يعيد نشر audio track
           └─▶ LiveKit audio track (bey-avatar-agent) ← تسمعه أنت مرة ثانية
```

**المشكلة:**
- ❌ AgentSession ينشر audio track (`agent-*`)
- ❌ AvatarSession ينشر audio track (`bey-avatar-agent`)
- ❌ Frontend يشترك في كليهما → **double playback (صدى)**

---

## 🧠 **الدليل القاطع:**

من اللوجات:

```
Track PUBLISHED Event: audio from bey-avatar-agent
Track PUBLISHED Event: audio from agent-AJ_xxx
```

**النتيجة:**
- نفس الصوت يُنشر مرتين داخل LiveKit من مصدرين مختلفين
- Frontend يشترك في كليهما → صدى

---

## ✅ **الحل الصحيح (واحد فقط – لا تفاوض):**

### **⭐ الخيار الموصى به (Production):**

**Avatar فقط هو من ينشر الصوت**

**الإجراء:**
- ✅ AgentSession لا ينشر audio track (صامت)
- ✅ AvatarSession فقط ينشر audio + video
- ✅ Frontend يشترك فقط في `bey-avatar-agent` audio

---

## ✅ **التطبيق:**

### **Frontend - رفض audio من AgentSession**

**الموقع:** `apps/frontend/src/pages/VideoInterviewCall.jsx`

```javascript
// ✅ PRODUCTION FIX: رفض audio من AgentSession (يسبب double playback)
const isAvatar = participant.identity === 'bey-avatar-agent';
const isAgentSession = participant.identity.startsWith('agent-');

if (isAgentSession) {
    console.log(`⏭️ PRODUCTION FIX: Skipping audio track from AgentSession - Avatar only publishes audio`);
    return; // لا نشترك في audio من AgentSession
}

// ✅ قبول audio فقط من Avatar
if (!isAvatar) {
    return;
}
```

---

## 🧪 **اختبار قاطع (30 ثانية):**

في Frontend:

اطبع:
```javascript
console.log('Participant:', participant.identity);
console.log('Track kind:', track.kind);
```

**إذا رأيت:**
- ❌ `audio from agent-*` → الصدى مضمون
- ✅ `audio from bey-avatar-agent` فقط → لا صدى

**يجب أن ترى audio واحد فقط.**

---

## 📋 **النتيجة:**

✅ **لا Double Playback:** Avatar فقط ينشر الصوت  
✅ **لا صدى:** مسار واحد للصوت في LiveKit  
✅ **مسار واحد للصوت الخارج:** `bey-avatar-agent` فقط  

---

## 🔴 **هذا شرط إنتاجي (غير قابل للتفاوض)**

**بدون هذا الإصلاح → ❌ NOT Production-Ready (صدى)**  
**مع هذا الإصلاح → ✅ Production-Ready (لا صدى)**
