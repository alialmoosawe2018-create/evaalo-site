# ✅ Avatar Timeout Fix - حل Race Condition

## ❌ **المشكلة:**

**Race Condition:**
- Frontend timeout صارم (30 ثانية)
- Avatar يتأخر في join + publish video
- Frontend ينفذ `endInterview()` قبل أن يظهر Avatar
- لكن Avatar يعمل لاحقاً

**الدليل:**
```
⚠️ Agent or Avatar not found after 60 checks (30s)
...
VIDEO TRACK SUBSCRIBED FROM AGENT (بعد timeout)
```

---

## ✅ **الحل:**

### 1️⃣ **زيادة Timeout**
```typescript
// ❌ Old: 60 checks × 0.5s = 30 seconds
const maxChecks = 60;

// ✅ New: 120 checks × 0.5s = 60 seconds
const maxChecks = 120;
```

### 2️⃣ **Event Listeners (أسرع من Polling)**
```typescript
// ✅ FIX: Event listener للـ TrackPublished (أسرع من polling)
room.on(RoomEvent.TrackPublished, handleTrackPublished);

// ✅ FIX: Event listener للـ ParticipantConnected
room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
```

### 3️⃣ **لا endInterview() عند Timeout**
```typescript
// ❌ Old: استدعاء endInterview() عند timeout
if (checkCount >= maxChecks) {
    endInterview(); // ❌ خطأ - Avatar قد يأتي لاحقاً
}

// ✅ New: warning فقط - ننتظر event listeners
if (checkCount >= maxChecks) {
    console.warn('⚠️ Video track not found - but waiting for event listeners');
    // لا endInterview() - ننتظر event listeners
}
```

---

## 📊 **المعمارية الجديدة:**

```
1. Event Listeners (أولوية)
   ✅ TrackPublished → subscribe فوراً
   ✅ ParticipantConnected → check فوراً

2. Polling (fallback)
   ✅ Check every 0.5s
   ✅ Timeout: 60 seconds (بدلاً من 30)
   ✅ Warning فقط - لا endInterview()

3. Cleanup
   ✅ Clear interval عند disconnect
   ✅ Remove event listeners
```

---

## 🎯 **النتيجة:**

✅ **Timeout أطول:** 60 ثانية (بدلاً من 30)  
✅ **Event Listeners:** استجابة فورية عند publish  
✅ **لا endInterview():** عند timeout - ننتظر event listeners  
✅ **Race Condition:** محلول - Avatar يأتي متأخراً لكن يعمل  

---

## 📋 **الإعدادات:**

- `maxChecks = 120` (60 ثانية)
- `checkInterval = 500ms` (0.5 ثانية)
- Event listeners: `TrackPublished`, `ParticipantConnected`

---

## 🔍 **Debugging:**

**Logs المتوقعة:**
```
⏳ Waiting for Agent/Avatar video track... (check 1/120, 0.5s)
✅ Agent/Avatar participant connected: bey-avatar-agent
🎥🎥🎥 VIDEO TRACK PUBLISHED EVENT - SUBSCRIBING NOW 🎥🎥🎥
✅ Video track check interval cleared
```

**إذا لم يظهر Avatar:**
- تحقق من Agent logs
- تحقق من LiveKit Server logs
- تحقق من network connectivity
- لكن **لا endInterview()** - ننتظر event listeners
