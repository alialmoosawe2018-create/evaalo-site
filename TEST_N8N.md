# 🧪 اختبار تكامل n8n

## ✅ الخطوات:

### 1. تأكد من أن Backend يعمل:

```bash
cd apps/backend
npm run dev
```

يجب أن ترى:
```
✅ Connected to MongoDB successfully
📊 Database: sample_mflix
🚀 Server is running on http://localhost:5000
```

### 2. تأكد من أن n8n Webhook URL موجود:

افتح `apps/backend/.env` وتأكد من وجود:
```env
N8N_WEBHOOK_URL=https://n8ninstance.amtus.org/webhook/2eabd499-cbaa-4dc9-90c0-59d9e4565d52
```

### 3. افتح n8n Workflow:

1. افتح n8n
2. تأكد من أن Workflow نشط
3. تأكد من أن Webhook node جاهز لاستقبال البيانات

### 4. اختبر من Frontend:

1. افتح `http://localhost:3000/form` (أو 3001/3002)
2. املأ الاستمارة:
   - الاسم الأول
   - الاسم الأخير
   - البريد الإلكتروني
   - الهاتف
   - المنصب المطلوب
   - سنوات الخبرة
   - المهارات
   - اللغات
3. اضغط **Submit**

### 5. تحقق من النتائج:

#### في Backend Console:
يجب أن ترى:
```
✅ Data sent to n8n successfully
```

أو إذا فشل:
```
❌ Error sending data to n8n: [error message]
```

#### في n8n:
1. افتح n8n workflow
2. تحقق من أن Webhook node استقبل البيانات
3. يجب أن ترى البيانات في n8n

## 📤 البيانات المرسلة:

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

## 🐛 حل المشاكل:

### إذا لم ترى "✅ Data sent to n8n successfully":

1. **تحقق من `.env`**: تأكد من وجود `N8N_WEBHOOK_URL`
2. **تحقق من Backend**: تأكد من أن Backend يعمل
3. **تحقق من Console**: ابحث عن أخطاء في Backend console
4. **تحقق من n8n**: تأكد من أن workflow نشط

### إذا ظهر خطأ "Failed to fetch" أو "Network error":

1. **تحقق من الاتصال**: تأكد من أن n8n متاح على الإنترنت
2. **تحقق من URL**: تأكد من أن Webhook URL صحيح
3. **تحقق من HTTPS**: تأكد من أن n8n يستقبل طلبات HTTPS

### إذا لم تصل البيانات إلى n8n:

1. **تحقق من Webhook**: تأكد من أن Webhook node نشط في n8n
2. **تحقق من Workflow**: تأكد من أن Workflow نشط
3. **تحقق من Logs**: ابحث عن أخطاء في n8n logs

## ✅ علامات النجاح:

- ✅ Backend console يظهر: `✅ Data sent to n8n successfully`
- ✅ البيانات تظهر في n8n workflow
- ✅ لا توجد أخطاء في Backend console
- ✅ الاستمارة تُحفظ بنجاح في MongoDB

---

**جاهز للاختبار! 🚀**



























