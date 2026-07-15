# 🔧 إصلاح خطأ: LIVEKIT_API_KEY is not set

## المشكلة:
```
❌ LIVEKIT_API_KEY is not set in .env.local
ValueError: LIVEKIT_API_KEY is required in .env.local
```

## الحل السريع:

### 1. افتح ملف `.env.local`
الموقع: `apps/avatar-evaalov2/.env.local`

### 2. أضف هذه المتغيرات (إذا لم تكن موجودة):

```env
# ============================================
# LiveKit Configuration (مطلوب)
# ============================================
LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud
LIVEKIT_API_KEY=APIPfHsukAntKDq
LIVEKIT_API_SECRET=GDCBeJv6X8Tfz7qweeQZF1oBUukejh2JEnFwXOwsrMaA

# ============================================
# Beyond Presence Configuration (مطلوب)
# ============================================
BEY_API_KEY=sk-a7Zuo3jPIAqjnw6HLgUOkNVXUPfPtU3soNEN951H0bs
BEYOND_PRESENCE_AVATAR_ID=694c83e2-8895-4a98-bd16-56332ca3f449

# ============================================
# Optional Configuration
# ============================================
AVATAR_WS_PORT=8765
```

### 3. احفظ الملف

### 4. أعد تشغيل Agent:
```powershell
cd apps/avatar-evaalov2
.\START_AGENT.ps1
```

## ✅ التحقق من الإصلاح:

بعد إعادة التشغيل، يجب أن ترى:
- ✅ Loading environment from: .env.local
- ✅ LIVEKIT_URL: ✅ Set
- ✅ LIVEKIT_API_KEY: ✅ Set
- ✅ LIVEKIT_API_SECRET: ✅ Set
- ✅ Environment variables set in os.environ

## 📝 ملاحظات:

1. **إذا كان لديك قيم مختلفة** من Backend:
   - يمكنك نسخ `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` من `apps/backend/.env.local`
   - يجب أن تكون نفس القيم في Agent و Backend

2. **إذا لم يكن لديك LiveKit credentials:**
   - اذهب إلى: https://cloud.livekit.io
   - أنشئ حساب جديد أو سجّل الدخول
   - أنشئ Project جديد
   - احصل على API Keys من Settings

3. **LiveKit Server محلي:**
   - إذا كنت تستخدم LiveKit محلياً، استخدم:
   ```env
   LIVEKIT_URL=ws://localhost:7880
   ```
