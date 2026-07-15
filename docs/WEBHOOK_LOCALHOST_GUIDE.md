# 🔄 استقبال وإرسال Webhooks من/إلى localhost

## ✅ الوضع الحالي:

### 1. **إرسال إلى n8n** (يعمل ✅):
- Backend يرسل إلى: `https://n8n.amtus.org/webhook/cc4f6e33-27c8-444e-bd55-e21963bb7e56`
- ✅ **يعمل** لأن n8n على VPS متاح من الإنترنت

### 2. **استقبال من n8n** (مشكلة ⚠️):
- Backend يستقبل على: `http://localhost:5000/webhook/n8n`
- ⚠️ **لا يعمل** لأن n8n على VPS لا يمكنه الوصول إلى localhost

## 🔍 المشكلة:

n8n يعمل على VPS (`n8n.amtus.org`) ولا يمكنه الوصول إلى `localhost:5000` على جهازك المحلي.

## 💡 الحلول:

### الحل 1: استخدام ngrok (الأسهل للتطوير)

#### 1. تثبيت ngrok:
```bash
# تحميل من: https://ngrok.com/download
# أو باستخدام Chocolatey:
choco install ngrok
```

#### 2. تشغيل ngrok:
```bash
ngrok http 5000
```

#### 3. ستحصل على رابط مثل:
```
https://abc123.ngrok.io
```

#### 4. في n8n، استخدم:
```
https://abc123.ngrok.io/webhook/n8n
```

#### 5. تحديث CORS في Backend:
```typescript
// في server.ts
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'https://abc123.ngrok.io', // أضف ngrok URL
        // ...
    ],
    // ...
}));
```

### الحل 2: نشر Backend على VPS (للإنتاج)

#### 1. نشر Backend على نفس VPS أو VPS آخر
#### 2. استخدام رابط مثل:
```
https://your-backend-domain.com/webhook/n8n
```

### الحل 3: تشغيل n8n محلياً (للتطوير)

#### 1. تثبيت n8n محلياً:
```bash
npm install -g n8n
n8n start
```

#### 2. n8n سيعمل على: `http://localhost:5678`
#### 3. في n8n، استخدم: `http://localhost:5000/webhook/n8n`

## 📋 ملخص:

| الحل | الإرسال إلى n8n | الاستقبال من n8n | الاستخدام |
|------|----------------|-------------------|-----------|
| **ngrok** | ✅ يعمل | ✅ يعمل | تطوير |
| **نشر على VPS** | ✅ يعمل | ✅ يعمل | إنتاج |
| **n8n محلي** | ✅ يعمل | ✅ يعمل | تطوير |

## 🚀 الخطوات السريعة (ngrok):

### 1. تثبيت ngrok:
```bash
# Windows: تحميل من ngrok.com
# أو:
winget install ngrok
```

### 2. تشغيل ngrok:
```bash
ngrok http 5000
```

### 3. نسخ الرابط (مثل: `https://abc123.ngrok.io`)

### 4. في n8n HTTP Request node:
- **URL**: `https://abc123.ngrok.io/webhook/n8n`
- **Method**: `POST`

### 5. تحديث CORS في Backend (اختياري):
أضف ngrok URL إلى CORS origins

## ⚠️ ملاحظات مهمة:

1. **ngrok مجاني** لكن الرابط يتغير في كل مرة (ما لم تدفع)
2. **للإنتاج**: استخدم نشر Backend على VPS
3. **CORS**: تأكد من إضافة ngrok URL إلى CORS إذا لزم الأمر

---

**الخلاصة**: الكود جاهز، لكن تحتاج ngrok أو نشر Backend على VPS لاستقبال webhooks من n8n!


























