# 📋 ملخص روابط Webhook في التطبيق

## 🔢 العدد الإجمالي: **3 Webhooks**

---

## 1️⃣ n8n Webhook (إرسال البيانات إلى n8n)

### النوع: **Outgoing Webhook** (إرسال)
### الحالة: ✅ **مفعل**

### الرابط:
```
https://n8ninstance.amtus.org/webhook/4f87a279-ec6b-404f-bc8e-a47ac49d0e2b
```

### الموقع في الكود:
- **ملف الإعدادات**: `apps/backend/.env`
- **متغير البيئة**: `N8N_WEBHOOK_URL`
- **الخدمة**: `apps/backend/src/services/n8nService.ts`

### الوظيفة:
- إرسال بيانات المرشحين إلى n8n للتحليل
- يتم الإرسال تلقائياً بعد حفظ البيانات في MongoDB
- Event: `candidate_submitted`
- Event: `candidate_status_updated`

### متى يتم استخدامه:
- ✅ عند تقديم استمارة جديدة
- ✅ عند تحديث حالة المرشح

---

## 2️⃣ n8n Webhook (استقبال النتائج من n8n)

### النوع: **Incoming Webhook** (استقبال)
### الحالة: ✅ **مفعل**

### Endpoint:
```
POST /webhook/n8n
```

### الرابط الكامل (عند النشر):
```
https://your-domain.com/webhook/n8n
```

### الموقع في الكود:
- **الملف**: `apps/backend/src/server.ts`
- **السطر**: بعد Vapi webhook

### الوظيفة:
- استقبال نتائج التحليل من n8n
- تحديث بيانات المرشح في MongoDB:
  - `aiEvaluation`: تقييم AI
  - `status`: حالة المرشح
  - `notes`: ملاحظات

### متى يتم استخدامه:
- عند إرسال نتائج التحليل من n8n workflow
- بعد معالجة البيانات في n8n

---

## 3️⃣ Vapi Webhook (استقبال البيانات من Vapi)

### النوع: **Incoming Webhook** (استقبال)
### الحالة: ✅ **مفعل**

### Endpoint:
```
POST /webhook/vapi
```

### الرابط الكامل (عند النشر):
```
https://your-domain.com/webhook/vapi
```

### الموقع في الكود:
- **الملف**: `apps/backend/src/server.ts`
- **السطر**: 89

### الوظيفة:
- استقبال أحداث من Vapi (مكالمات صوتية)
- معالجة:
  - `status-update`: تحديثات حالة المكالمة
  - `transcript`: نصوص المحادثة
  - `function-call`: استدعاءات الدوال

### متى يتم استخدامه:
- عند استقبال أحداث من Vapi Voice Agent

---

## 📊 ملخص:

| # | النوع | الاتجاه | الحالة | الرابط/Endpoint |
|---|-------|---------|--------|------------------|
| 1 | n8n (إرسال) | Outgoing | ✅ مفعل | `https://n8ninstance.amtus.org/webhook/...` |
| 2 | n8n (استقبال) | Incoming | ✅ مفعل | `POST /webhook/n8n` |
| 3 | Vapi | Incoming | ✅ مفعل | `POST /webhook/vapi` |

---

## 🔍 تفاصيل إضافية:

### n8n Webhook:
- **الغرض**: إرسال بيانات المرشحين للتحليل
- **التكرار**: عند كل تقديم استمارة أو تحديث حالة
- **Non-blocking**: لا يمنع حفظ البيانات إذا فشل

### n8n Webhook (استقبال):
- **الغرض**: استقبال نتائج التحليل من n8n
- **التكرار**: عند إرسال نتائج من n8n workflow
- **التحديث**: يحدث بيانات المرشح في MongoDB تلقائياً

### Vapi Webhook:
- **الغرض**: استقبال أحداث المكالمات الصوتية
- **التكرار**: عند كل حدث من Vapi
- **الاستجابة**: فورية (200 OK)

---

## 📝 ملاحظات:

1. **n8n Webhook** موجود في `.env` ويمكن تغييره
2. **Vapi Webhook** endpoint ثابت في الكود
3. كلا Webhook مفعلان ويعملان بشكل صحيح

---

**آخر تحديث**: 2025-12-14



























