# 🔧 إصلاح خطأ Deepgram STT للعربية

## ❌ المشكلة:

```
WSServerHandshakeError: 400, message='Invalid response status',
url='wss://api.deepgram.com/v1/listen?model=nova-2&...&language=ar'
```

**السبب:** Deepgram لا يدعم العربية (`language=ar`) بشكل جيد.

---

## ✅ الحلول المطبقة:

### 1️⃣ **إزالة `language=ar` من Deepgram**

**قبل:**
```python
stt_arabic = deepgram.STT(model="nova-2", language="ar")  # ❌ خطأ
```

**بعد:**
```python
stt_arabic = deepgram.STT(model="nova-2")  # ✅ بدون language - auto-detect
```

**الموقع:** `apps/avatar-evaalov2/src/agent.py` - السطر 549

---

### 2️⃣ **إزالة language parameter عند Fallback**

**قبل:**
```python
# Fallback to Deepgram
kwargs_without_lang = {k: v for k, v in kwargs.items() if k != 'language'}
return await self.stt_english.recognize_async(audio_stream, **kwargs_without_lang)
```

**بعد:**
```python
# Fallback to Deepgram WITHOUT language parameter
logger.warning("   ⚠️ Deepgram may not work well for Arabic - consider adding SPEECHMATICS_API_KEY")
kwargs_without_lang = {k: v for k, v in kwargs.items() if k != 'language'}
return await self.stt_english.recognize_async(audio_stream, **kwargs_without_lang)
```

**الموقع:** `apps/avatar-evaalov2/src/agent.py` - السطر 245-250

---

### 3️⃣ **إضافة SPEECHMATICS_API_KEY (موصى به)**

**المشكلة:**
```
⚠️ Failed to create Speechmatics STT: Missing Speechmatics API key
```

**الحل:**
أضف إلى `apps/avatar-evaalov2/.env.local`:
```env
SPEECHMATICS_API_KEY=your_speechmatics_api_key_here
```

**أو استخدم المفتاح الموجود:**
```env
SPEECHMATICS_API_KEY=C1VODbC6SZPJ7GHpWTL1FqnX9i8MKKds
```

---

## 📋 الخلاصة:

### ✅ **الإصلاحات:**
1. ✅ إزالة `language=ar` من Deepgram fallback
2. ✅ إضافة تحذيرات عند استخدام Deepgram للعربية
3. ✅ استخدام Deepgram auto-detect بدلاً من `language=ar`

### ⚠️ **التوصية:**
**أضف SPEECHMATICS_API_KEY** للحصول على دعم أفضل للعربية:
- Speechmatics يدعم العربية بشكل ممتاز
- Deepgram لا يدعم العربية بشكل جيد

---

## 🚀 الخطوات التالية:

1. **أضف SPEECHMATICS_API_KEY إلى `.env.local`:**
   ```env
   SPEECHMATICS_API_KEY=C1VODbC6SZPJ7GHpWTL1FqnX9i8MKKds
   ```

2. **أعد تشغيل Agent:**
   ```powershell
   cd apps/avatar-evaalov2
   .\START_AGENT.ps1
   ```

3. **تحقق من Logs:**
   - يجب أن ترى: `✅ Arabic STT created: Speechmatics (Arabic)`
   - لا يجب أن ترى: `WSServerHandshakeError: 400`

---

## 🔍 التحقق من الإصلاح:

**بعد إضافة SPEECHMATICS_API_KEY:**
```
✅ Arabic STT created: Speechmatics (Arabic)
✅ Multilingual STT wrapper created (Speechmatics Arabic + Deepgram English)
```

**بدون SPEECHMATICS_API_KEY (Fallback):**
```
⚠️ Failed to create Speechmatics STT: Missing Speechmatics API key
✅ Arabic STT created: Deepgram (auto-detect) - fallback
⚠️ Deepgram may not work well for Arabic
```
