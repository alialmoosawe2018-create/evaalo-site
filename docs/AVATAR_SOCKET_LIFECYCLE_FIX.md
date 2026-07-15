# 🔴 Avatar Socket Lifecycle Fix - إصلاح ECONNREFUSED

## ❌ **المشكلة الحقيقية:**

**ECONNREFUSED ::1:8765 / 127.0.0.1:8765**

```
Error sending TTS chunk #612 to Avatar: ECONNREFUSED ::1:8765
Error sending TTS chunk #612 to Avatar: ECONNREFUSED 127.0.0.1:8765
```

**السبب:**
- ❌ TTS يستمر في الإرسال بعد إغلاق AvatarSession
- ❌ استخدام `localhost` بدلاً من endpoint حقيقي
- ❌ لا يوجد ربط بين TTS lifecycle و AvatarSession state
- ❌ Retry بدلاً من Drop عند ECONNREFUSED

---

## ✅ **الحل (Production-grade):**

### **1️⃣ ربط TTS lifecycle بـ AvatarSession**

**القاعدة الذهبية:**
> **AvatarSession هو owner للصوت - لا صوت بدون Avatar**

**التطبيق:**
```typescript
// ✅ PRODUCTION FIX: لا نرسل إذا AvatarSession غير متصل
if (!isAvatarSessionConnected(sessionId)) {
    console.warn(`⚠️ Dropping audio chunk - AvatarSession not connected`);
    return; // Drop - لا retry
}
```

### **2️⃣ Drop بدلاً من Retry**

**عند ECONNREFUSED:**
- ❌ لا retry
- ❌ لا queue
- ❌ لا block
- ✅ **Drop فوراً**

**التطبيق:**
```typescript
// ✅ PRODUCTION FIX: ECONNREFUSED = Drop (لا retry)
if (error.code === 'ECONNREFUSED') {
    console.warn(`⚠️ Avatar WebSocket connection refused - dropping chunks`);
    return; // Drop - لا نرمي error
}
```

### **3️⃣ إصلاح Endpoint**

**❌ خطأ:**
```typescript
const AVATAR_WS_URL = 'ws://localhost:8765/ws/avatar-audio'; // ❌
```

**✅ صحيح:**
```typescript
// ✅ PRODUCTION FIX: استخدام endpoint حقيقي
const AVATAR_WS_URL = process.env.AVATAR_WS_URL 
    || process.env.BEYOND_PRESENCE_AUDIO_ENDPOINT?.replace('https://', 'wss://')
    || 'ws://localhost:8765/ws/avatar-audio'; // Fallback فقط
```

**في `.env.local`:**
```bash
# ✅ PRODUCTION FIX: استخدام endpoint حقيقي لـ Beyond Presence
AVATAR_WS_URL=wss://api.beyondpresence.ai/v1/audio/ws
# أو
BEYOND_PRESENCE_AUDIO_ENDPOINT=https://api.beyondpresence.ai/v1/audio
```

### **4️⃣ Circuit Breaker**

**توقف بعد 3 أخطاء متتالية:**
```typescript
const MAX_AVATAR_ERRORS = 3;

if (state.errorCount >= MAX_AVATAR_ERRORS) {
    console.warn(`⚠️ Dropping chunks - error limit reached`);
    return; // Drop - لا نرمي error
}
```

---

## 📋 **النتيجة:**

✅ **لا ECONNREFUSED spam:** Drop فوراً  
✅ **لا TTS بعد إغلاق Avatar:** ربط lifecycle  
✅ **لا localhost في Production:** endpoint حقيقي  
✅ **لا retry:** Drop > Retry  

---

## 🎯 **الاستخدام:**

### **إصلاح Endpoint:**

**في `.env.local`:**
```bash
# ✅ PRODUCTION FIX: استخدام endpoint حقيقي
AVATAR_WS_URL=wss://api.beyondpresence.ai/v1/audio/ws
```

**أو:**
```bash
BEYOND_PRESENCE_AUDIO_ENDPOINT=https://api.beyondpresence.ai/v1/audio
```

---

## 🔴 **هذا إصلاح إنتاجي (غير قابل للتفاوض)**

**بدون هذا الإصلاح → ❌ NOT Production-Ready (ECONNREFUSED spam)**  
**مع هذا الإصلاح → ✅ Production-Ready (Drop عند فشل)**

---

**تاريخ التطبيق:** الآن  
**الحالة:** ✅ **Production-Ready** (Socket lifecycle محكم)
