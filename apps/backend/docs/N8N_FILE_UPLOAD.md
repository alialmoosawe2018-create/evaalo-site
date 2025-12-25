# دليل إرسال الملفات من n8n إلى السيرفر

## نظرة عامة

السيرفر الآن يدعم استقبال الملفات من n8n عبر webhook endpoint `/webhook/n8n`.

## كيفية الإعداد في n8n

### 1. إعداد HTTP Request Node في n8n

1. أضف **HTTP Request** node في workflow الخاص بك
2. اضبط الإعدادات التالية:
   - **Method**: `POST`
   - **URL**: `http://your-server-url:5000/webhook/n8n`
   - **Authentication**: None (أو حسب الحاجة)
   - **Send Body**: Yes
   - **Body Content Type**: `multipart/form-data`

### 2. إعداد البيانات المرسلة

في **HTTP Request** node، أضف البيانات التالية:

#### الحقول المطلوبة:
- `candidateId`: معرف المرشح (مطلوب)
- `files`: الملفات المراد إرسالها (اختياري)

#### الحقول الاختيارية:
- `status`: حالة المرشح (`pending`, `accepted`, `rejected`)
- `aiEvaluation`: تقييم AI (كائن JSON)
- `notes`: ملاحظات نصية
- `comments`: تعليقات

### 3. إرسال الملفات

#### طريقة 1: استخدام Binary Data في n8n

1. في **HTTP Request** node:
   - اختر **Body Content Type**: `multipart/form-data`
   - أضف حقل `files` من نوع **File**
   - يمكن إرسال ملف واحد أو عدة ملفات

#### طريقة 2: استخدام Binary Data من Node سابق

إذا كان لديك ملف من node سابق (مثل **Read Binary File**):

1. في **HTTP Request** node:
   - أضف حقل `files` من نوع **Binary Data**
   - اختر البيانات من Node السابق

### 4. مثال على البيانات المرسلة

```json
{
  "candidateId": "507f1f77bcf86cd799439011",
  "status": "accepted",
  "notes": "تم تحليل الملفات بنجاح",
  "aiEvaluation": {
    "score": 85,
    "communication": 90,
    "technical": 80,
    "problemSolving": 85,
    "confidence": 90,
    "feedback": "مرشح ممتاز"
  }
}
```

## مثال على Workflow في n8n

```
[Trigger] → [Get Candidate Data] → [Process Files] → [HTTP Request]
                                                      ↓
                                              [Send to Backend]
```

## الاستجابة من السيرفر

عند نجاح العملية، ستحصل على:

```json
{
  "success": true,
  "message": "Webhook received and processed successfully",
  "candidateId": "507f1f77bcf86cd799439011",
  "filesReceived": 2
}
```

## الوصول إلى الملفات المحفوظة

بعد حفظ الملفات، يمكن الوصول إليها عبر:

```
http://your-server-url:5000/uploads/filename.ext
```

## ملاحظات مهمة

1. **حجم الملف**: الحد الأقصى لحجم الملف الواحد هو 10MB
2. **عدد الملفات**: يمكن إرسال حتى 10 ملفات في طلب واحد
3. **أنواع الملفات**: جميع أنواع الملفات مقبولة (يمكنك تحديد أنواع معينة في الكود)
4. **أسماء الملفات**: يتم حفظ الملفات بأسماء فريدة لتجنب التضارب

## استكشاف الأخطاء

### خطأ: "Candidate ID is required"
- تأكد من إرسال `candidateId` في البيانات

### خطأ: "Candidate not found"
- تحقق من أن معرف المرشح صحيح وموجود في قاعدة البيانات

### خطأ: "File too large"
- تأكد من أن حجم الملف أقل من 10MB

### خطأ: "Too many files"
- الحد الأقصى هو 10 ملفات في طلب واحد

## مثال كامل على HTTP Request في n8n

### Parameters:
```
candidateId: {{ $json.candidateId }}
status: accepted
notes: تم تحليل السيرة الذاتية
```

### Files:
```
files: {{ $binary.data }}  (من Read Binary File node)
```

## اختبار الإرسال

يمكنك اختبار الإرسال باستخدام curl:

```bash
curl -X POST http://localhost:5000/webhook/n8n \
  -F "candidateId=507f1f77bcf86cd799439011" \
  -F "status=accepted" \
  -F "files=@/path/to/file.pdf" \
  -F "files=@/path/to/file2.docx"
```


