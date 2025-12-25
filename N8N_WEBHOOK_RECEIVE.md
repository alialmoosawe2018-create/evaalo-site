# 📥 استقبال Webhooks من n8n

## ✅ تم إضافة Endpoint لاستقبال Webhooks من n8n!

## 🔗 Endpoint:

```
POST /webhook/n8n
```

### الرابط الكامل (عند النشر):
```
http://localhost:5000/webhook/n8n
```

أو عند النشر:
```
https://your-domain.com/webhook/n8n
```

## 📤 كيفية إرسال البيانات من n8n إلى Backend:

### في n8n Workflow:

1. أضف **HTTP Request** node
2. اضبط الإعدادات:
   - **Method**: `POST`
   - **URL**: `http://localhost:5000/webhook/n8n` (أو رابط النشر)
   - **Body**: JSON

### مثال على البيانات المرسلة:

```json
{
  "candidateId": "65a1b2c3d4e5f6g7h8i9j0k1",
  "aiEvaluation": {
    "score": 85,
    "communication": 90,
    "technical": 80,
    "problemSolving": 85,
    "feedback": "مرشح ممتاز مع خبرة قوية في React و Node.js"
  },
  "status": "accepted",
  "notes": "تم التحليل بنجاح"
}
```

## 📋 البيانات المدعومة:

### 1. `candidateId` (مطلوب):
- معرف المرشح في MongoDB
- يمكن إرساله مباشرة أو داخل `candidate.id`

### 2. `aiEvaluation` (اختياري):
```json
{
  "score": 85,
  "communication": 90,
  "technical": 80,
  "problemSolving": 85,
  "feedback": "تعليق على المرشح"
}
```

### 3. `status` (اختياري):
- `pending`
- `accepted`
- `rejected`
- `in_progress`

### 4. `notes` أو `comments` (اختياري):
- ملاحظات إضافية

## 🔄 مثال Workflow في n8n:

```
1. Webhook (استقبال بيانات المرشح)
   ↓
2. AI Node (تحليل السيرة الذاتية)
   ↓
3. Function Node (معالجة النتائج)
   ↓
4. HTTP Request (إرسال التقييم إلى Backend)
   - URL: http://localhost:5000/webhook/n8n
   - Method: POST
   - Body: {
       "candidateId": "{{ $json.candidate.id }}",
       "aiEvaluation": {
         "score": 85,
         "communication": 90,
         "technical": 80,
         "problemSolving": 85,
         "feedback": "مرشح ممتاز"
       },
       "status": "accepted"
     }
```

## ✅ الاستجابة:

### عند النجاح:
```json
{
  "success": true,
  "message": "Webhook received and processed successfully",
  "candidateId": "65a1b2c3d4e5f6g7h8i9j0k1"
}
```

### عند الخطأ:
```json
{
  "success": false,
  "error": "Candidate not found"
}
```

## 🔍 التحقق من العمل:

### 1. اختبار من n8n:

في n8n workflow:
1. أضف HTTP Request node
2. اضبط URL: `http://localhost:5000/webhook/n8n`
3. أرسل بيانات تجريبية
4. تحقق من Backend console

### 2. اختبار من Terminal:

```bash
curl -X POST http://localhost:5000/webhook/n8n \
  -H "Content-Type: application/json" \
  -d '{
    "candidateId": "YOUR_CANDIDATE_ID",
    "aiEvaluation": {
      "score": 85,
      "communication": 90,
      "technical": 80,
      "problemSolving": 85,
      "feedback": "Test evaluation"
    },
    "status": "accepted"
  }'
```

### 3. في Backend Console:

يجب أن ترى:
```
📥 Received webhook from n8n: {...}
✅ Updating AI evaluation for candidate: ...
✅ Candidate updated successfully: ...
```

## ⚠️ ملاحظات مهمة:

1. **candidateId مطلوب**: يجب إرسال معرف المرشح
2. **البيانات اختيارية**: يمكن إرسال `aiEvaluation` أو `status` أو كليهما
3. **التحديث التلقائي**: يتم تحديث المرشح في MongoDB تلقائياً
4. **Non-blocking**: لا يمنع معالجة الطلبات الأخرى

## 🔄 التدفق الكامل:

```
1. Frontend → Backend (تقديم استمارة)
   ↓
2. Backend → MongoDB (حفظ البيانات)
   ↓
3. Backend → n8n (إرسال للتحليل)
   ↓
4. n8n → AI (تحليل البيانات)
   ↓
5. n8n → Backend (إرسال النتائج)
   ↓
6. Backend → MongoDB (تحديث التقييم)
```

---

**تم الإعداد بنجاح! 🎉**

الآن n8n يمكنه إرسال نتائج التحليل مرة أخرى إلى Backend!



























