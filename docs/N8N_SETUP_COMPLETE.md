# ✅ تم إعداد n8n Integration بنجاح!

## 🔗 رابط n8n Webhook:
```
https://n8n.amtus.org/webhook/cc4f6e33-27c8-444e-bd55-e21963bb7e56
```

## ✅ ما تم إنجازه:

1. ✅ تم إضافة رابط n8n webhook إلى `env.example`
2. ✅ تم إضافة رابط n8n webhook إلى `.env` (إذا لم يضف تلقائياً، أضفه يدوياً)
3. ✅ الكود جاهز لإرسال البيانات إلى n8n

## 🔧 التحقق من الإعداد:

### 1. تأكد من وجود المتغير في `.env`:

افتح ملف `apps/backend/.env` وتأكد من وجود:
```env
N8N_WEBHOOK_URL=https://n8n.amtus.org/webhook/cc4f6e33-27c8-444e-bd55-e21963bb7e56
```

### 2. إعادة تشغيل Backend:

```bash
cd apps/backend
npm run dev
```

يجب أن ترى في Console:
```
✅ Connected to MongoDB successfully
📊 Database: sample_mflix
🚀 Server is running on http://localhost:5000
```

## 🧪 اختبار التكامل:

### 1. اختبار من Frontend:

1. افتح `http://localhost:3000/form` (أو 3001/3002)
2. املأ الاستمارة واضغط **Submit**
3. افتح Backend console
4. يجب أن ترى: `✅ Data sent to n8n successfully`

### 2. التحقق من n8n:

1. افتح n8n workflow
2. تحقق من أن Webhook node يستقبل البيانات
3. يجب أن ترى البيانات في n8n

## 📤 البيانات المرسلة إلى n8n:

عند تقديم استمارة جديدة، سيتم إرسال:

```json
{
  "event": "candidate_submitted",
  "timestamp": "2025-12-14T19:30:00.000Z",
  "candidate": {
    "id": "...",
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "...",
    "positionAppliedFor": "...",
    "yearsOfExperience": "...",
    "skills": [...],
    "languages": [...],
    "coverLetter": "...",
    "status": "pending",
    "createdAt": "..."
  }
}
```

## 🔄 الأحداث المرسلة:

### 1. عند تقديم استمارة جديدة:
- **Event**: `candidate_submitted`
- **Trigger**: بعد حفظ البيانات في MongoDB
- **URL**: `https://n8n.amtus.org/webhook/cc4f6e33-27c8-444e-bd55-e21963bb7e56`

### 2. عند تحديث حالة المرشح:
- **Event**: `candidate_status_updated`
- **Trigger**: عند تحديث `status` أو `aiEvaluation`
- **URL**: نفس الرابط أعلاه

## ⚠️ ملاحظات مهمة:

1. **Non-blocking**: إذا فشل إرسال n8n، لن يفشل حفظ البيانات في MongoDB
2. **HTTPS**: الرابط يستخدم HTTPS، تأكد من أن n8n يستقبل طلبات HTTPS
3. **CORS**: n8n يجب أن يسمح بطلبات من Backend (localhost:5000)

## 🐛 حل المشاكل:

### إذا لم ترى "✅ Data sent to n8n successfully":

1. تحقق من أن `N8N_WEBHOOK_URL` موجود في `.env`
2. تحقق من أن Backend يعمل
3. تحقق من Console للأخطاء
4. تأكد من أن n8n workflow نشط ويستقبل الطلبات

### إذا ظهر خطأ "Failed to fetch":

- تحقق من أن n8n متاح على الإنترنت
- تحقق من أن Webhook URL صحيح
- تحقق من Network tab في Browser DevTools

## 📝 الخطوات التالية:

1. ✅ تأكد من أن n8n workflow جاهز لاستقبال البيانات
2. ✅ اختبر بإرسال استمارة جديدة
3. ✅ تحقق من أن البيانات تصل إلى n8n
4. ✅ قم بإعداد workflow في n8n للتحليل

---

**تم الإعداد بنجاح! 🎉**



























