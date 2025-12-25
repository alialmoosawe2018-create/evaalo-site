# تكامل n8n مع التطبيق

## 📋 نظرة عامة:

بعد حفظ بيانات المرشح في قاعدة البيانات، يتم إرسالها تلقائياً إلى n8n للتحليل.

## 🔧 الإعداد:

### 1. الحصول على n8n Webhook URL:

1. افتح n8n
2. أنشئ workflow جديد
3. أضف **Webhook** node
4. اضغط **Execute Workflow** أو **Test**
5. انسخ **Webhook URL** (مثال: `http://your-n8n-instance.com/webhook/candidate-analysis`)

### 2. إضافة Webhook URL إلى Backend:

افتح ملف `.env` في `apps/backend/` وأضف:

```env
N8N_WEBHOOK_URL=http://your-n8n-instance.com/webhook/candidate-analysis
```

أو إذا كان n8n محلي:
```env
N8N_WEBHOOK_URL=http://localhost:5678/webhook/candidate-analysis
```

### 3. إعادة تشغيل Backend:

```bash
cd apps/backend
npm run dev
```

## 📤 البيانات المرسلة إلى n8n:

عند تقديم شخص على الاستمارة، يتم إرسال البيانات التالية:

```json
{
  "event": "candidate_submitted",
  "timestamp": "2025-12-14T19:30:00.000Z",
  "candidate": {
    "id": "65a1b2c3d4e5f6g7h8i9j0k1",
    "firstName": "Ahmed",
    "lastName": "Al-Mansouri",
    "email": "ahmed@example.com",
    "phone": "+966501234567",
    "positionAppliedFor": "Software Engineer",
    "yearsOfExperience": "5",
    "skills": ["React", "Node.js", "TypeScript"],
    "languages": ["Arabic", "English"],
    "coverLetter": "Experienced developer...",
    "status": "pending",
    "createdAt": "2025-12-14T19:30:00.000Z"
  }
}
```

## 🔄 الأحداث المرسلة:

### 1. عند تقديم استمارة جديدة:
- **Event**: `candidate_submitted`
- **Trigger**: بعد حفظ البيانات في MongoDB
- **Data**: جميع بيانات المرشح

### 2. عند تحديث حالة المرشح:
- **Event**: `candidate_status_updated`
- **Trigger**: عند تحديث `status` أو `aiEvaluation`
- **Data**: `candidateId`, `status`, `aiEvaluation`

## 🎯 استخدام n8n للتحليل:

يمكنك في n8n:

1. **تحليل البيانات**: استخدام AI nodes لتحليل السيرة الذاتية
2. **إرسال إشعارات**: إرسال email أو Slack عند استلام طلب جديد
3. **تقييم تلقائي**: استخدام AI لتقييم المرشح تلقائياً
4. **ربط مع أنظمة أخرى**: إرسال البيانات إلى CRM أو ATS

## 📝 مثال Workflow في n8n:

```
1. Webhook (استقبال البيانات)
   ↓
2. Function Node (معالجة البيانات)
   ↓
3. AI Node (تحليل السيرة الذاتية)
   ↓
4. HTTP Request (إرسال التقييم إلى Backend)
   ↓
5. Email/Slack (إرسال إشعار)
```

## ⚙️ الإعدادات:

### في ملف `.env`:
```env
# MongoDB
MONGODB_URI=mongodb+srv://...

# n8n Webhook
N8N_WEBHOOK_URL=http://localhost:5678/webhook/candidate-analysis

# Backend
PORT=5000
FRONTEND_URL=http://localhost:3000
```

## 🔍 التحقق من العمل:

1. قدم استمارة جديدة
2. افتح Backend console
3. يجب أن ترى: `✅ Data sent to n8n successfully`
4. تحقق من n8n workflow - يجب أن تستقبل البيانات

## ⚠️ ملاحظات:

1. **Non-blocking**: إذا فشل إرسال n8n، لن يفشل حفظ البيانات في MongoDB
2. **Optional**: إذا لم تضيف `N8N_WEBHOOK_URL`، سيتم تخطي الإرسال
3. **Error Handling**: الأخطاء لا تمنع حفظ البيانات



























