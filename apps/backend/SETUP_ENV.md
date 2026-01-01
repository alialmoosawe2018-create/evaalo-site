# 🔧 إعداد ملف `.env`

## ⚠️ مهم: يجب إنشاء ملف `.env` يدوياً

ملف `.env` محمي ولا يمكن إنشاؤه تلقائياً. يجب إنشاؤه يدوياً.

---

## 📝 خطوات الإعداد

### 1. إنشاء ملف `.env`

في مجلد `cursor-react/apps/backend/`، أنشئ ملف جديد باسم `.env`

### 2. نسخ المحتوى من `env.example`

انسخ محتوى `env.example` إلى `.env`

### 3. إضافة القيم الفعلية

#### أ) Private API Key
- افتح [Vapi Dashboard](https://dashboard.vapi.ai)
- اذهب إلى Settings → API Keys
- انسخ **Private API Key** (ليس Public)
- الصقه في `.env`:

```env
VAPI_API_KEY=your_actual_private_api_key_here
```

#### ب) Assistant ID
اختر أحد Assistant IDs التالية:

```env
# Option 1:
VAPI_ASSISTANT_ID=9b7dec71-1e4a-49e4-a738-5cedd49e36f5

# Option 2:
VAPI_ASSISTANT_ID=e4ae6fd7-f23c-40e1-a13d-26c1f9329e73
```

---

## ✅ مثال على ملف `.env` النهائي

```env
# ============================================
# Vapi API Configuration
# ============================================
VAPI_API_KEY=vapi_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAPI_ASSISTANT_ID=9b7dec71-1e4a-49e4-a738-5cedd49e36f5

# ============================================
# Server Configuration
# ============================================
PORT=5000
NODE_ENV=development

# ============================================
# Frontend URL (for CORS)
# ============================================
FRONTEND_URL=http://localhost:3000

# ============================================
# n8n Integration (للتحليل)
# ============================================
N8N_WEBHOOK_URL=https://n8ninstance.amtus.org/webhook/4f87a279-ec6b-404f-bc8e-a47ac49d0e2b
```

---

## 🔍 التحقق من الإعداد

بعد إنشاء ملف `.env`:

1. **أعد تشغيل السيرفر:**
   ```bash
   cd cursor-react/apps/backend
   npm run dev
   ```

2. **اختبر الـ Endpoint:**
   ```bash
   node cursor-react/test-start-interview.js
   ```

3. **تحقق من Console:**
   يجب أن ترى:
   ```
   📞 Creating Vapi call with Assistant ID: 9b7dec71-1e...
   ✅ Call created successfully
   ```

---

## ⚠️ ملاحظات أمنية

- **لا تشارك ملف `.env`** في Git
- **لا ترفع ملف `.env`** إلى GitHub
- **استخدم `env.example`** كقالب فقط (بدون قيم حقيقية)
- **Private API Key** يجب أن يبقى سرياً

---

## 🆘 حل المشاكل

### خطأ: "VAPI_API_KEY is not defined"
- تأكد من وجود ملف `.env` في `cursor-react/apps/backend/`
- تأكد من أن الملف يحتوي على `VAPI_API_KEY=...`
- أعد تشغيل السيرفر

### خطأ: "VAPI_ASSISTANT_ID is not defined"
- تأكد من وجود `VAPI_ASSISTANT_ID=...` في ملف `.env`
- استخدم أحد Assistant IDs الصحيحة:
  - `9b7dec71-1e4a-49e4-a738-5cedd49e36f5`
  - `e4ae6fd7-f23c-40e1-a13d-26c1f9329e73`

### خطأ: "Failed to start interview"
- تحقق من أن Private API Key صحيح
- تحقق من أن Assistant ID موجود وصحيح
- تحقق من Console السيرفر لرؤية الخطأ التفصيلي


