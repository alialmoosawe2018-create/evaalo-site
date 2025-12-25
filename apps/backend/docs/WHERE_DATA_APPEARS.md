# أين تظهر البيانات المرسلة من n8n؟

## نظرة عامة

عند إرسال البيانات من n8n إلى السيرفر عبر `/webhook/n8n`، يتم حفظها في **قاعدة البيانات** وتحديث سجل المرشح.

## البيانات التي يتم حفظها:

### 1. **تقييم AI (aiEvaluation)**
- يتم حفظه في حقل `aiEvaluation` في سجل المرشح
- **يظهر في Frontend:**
  - ✅ صفحة **Candidates** (`/candidates`)
  - ✅ صفحة **Reports** (`/reports`)
  - ✅ صفحة **Dashboard** (في Recent Interviews)

### 2. **الحالة (status)**
- يتم تحديث حقل `status` (pending, accepted, rejected)
- **يظهر في Frontend:**
  - ✅ صفحة **Candidates** (عمود Status)
  - ✅ صفحة **Dashboard** (في Recent Interviews)

### 3. **الملاحظات (notes)**
- يتم حفظها في حقل `notes`
- ⚠️ **لا تظهر حالياً في Frontend** (يحتاج إضافة)

### 4. **الملفات (files)**
- يتم حفظها في مجلد `backend/uploads/`
- يتم حفظ معلوماتها في حقل `files` في قاعدة البيانات
- ⚠️ **لا تظهر حالياً في Frontend** (يحتاج إضافة)

## أين يمكنك رؤية البيانات:

### 1. **في قاعدة البيانات (MongoDB)**
- افتح MongoDB Atlas أو MongoDB Compass
- ابحث عن collection `candidates`
- ستجد جميع البيانات المحفوظة

### 2. **في Frontend - صفحة Candidates**
- افتح: `http://localhost:3000/candidates`
- ستجد:
  - ✅ تقييم AI (AI Evaluation column)
  - ✅ الحالة (Status column)
  - ⚠️ الملاحظات والملفات (غير معروضة حالياً)

### 3. **في Frontend - صفحة Reports**
- افتح: `http://localhost:3000/reports`
- ستجد تقييمات AI للمرشحين

### 4. **في Frontend - صفحة Dashboard**
- افتح: `http://localhost:3000/`
- ستجد Recent Interviews مع الحالات

### 5. **عبر API مباشرة**
```bash
# جلب جميع المرشحين
GET http://localhost:5000/api/candidates

# جلب مرشح محدد
GET http://localhost:5000/api/candidates/:id
```

## الوصول إلى الملفات المحفوظة:

### عبر URL مباشر:
```
http://localhost:5000/uploads/filename.ext
```

### عبر API:
```bash
GET http://localhost:5000/api/candidates/:id
# ستحصل على معلومات الملفات في response.files
```

## ملخص:

| البيانات | محفوظة في DB | تظهر في Frontend | ملاحظات |
|---------|-------------|-----------------|---------|
| aiEvaluation | ✅ | ✅ Candidates, Reports | يعمل |
| status | ✅ | ✅ Candidates, Dashboard | يعمل |
| notes | ✅ | ❌ | يحتاج إضافة في Frontend |
| files | ✅ | ❌ | يحتاج إضافة في Frontend |

## للتحقق من البيانات:

### 1. تحقق من قاعدة البيانات:
```bash
# استخدم MongoDB Compass أو
# استخدم API
curl http://localhost:5000/api/candidates
```

### 2. تحقق من الملفات:
```bash
# الملفات محفوظة في
backend/uploads/
```

### 3. تحقق من السجلات:
- افتح Terminal الذي يعمل فيه السيرفر
- ستجد رسائل مثل:
  ```
  ✅ Updating AI evaluation for candidate: 507f1f77bcf86cd799439011
  ✅ 2 file(s) received and saved for candidate: 507f1f77bcf86cd799439011
  ✅ Candidate updated successfully: 507f1f77bcf86cd799439011
  ```

## ملاحظات مهمة:

1. **البيانات تُحدث سجل المرشح الموجود** - لا يتم إنشاء سجل جديد
2. **الملفات تُضاف إلى الملفات الموجودة** - لا تحل محل الملفات السابقة
3. **التقييم AI يُحدث** - إذا كان موجوداً، سيتم تحديثه
4. **الحالة تُحدث** - يمكن تغييرها من pending إلى accepted أو rejected

## الخطوات التالية (اختياري):

إذا أردت عرض الملاحظات والملفات في Frontend:
1. إضافة عرض الملاحظات في صفحة Candidates
2. إضافة عرض الملفات مع إمكانية التحميل
3. إضافة صفحة تفاصيل المرشح لعرض جميع البيانات


