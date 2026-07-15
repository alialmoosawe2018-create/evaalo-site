# إصلاح مشكلة Video Interview Evaluation

## المشكلة

صفحة Video Interview Evaluations (Stage 3) لا تعرض أي بيانات، وتظهر رسالة "No video interview evaluations".

## السبب

1. **Candidate Model لا يدعم `videoInterviewEvaluation`**: الـ model كان يدعم فقط `writtenInterviewEvaluation` و `aiEvaluation`.
2. **Webhook Handler لا يعالج `videoInterviewEvaluation`**: الـ webhook handler في `server.ts` كان يعالج فقط `writtenInterviewEvaluation` و `aiEvaluation`.

## الحل المطبق

### 1. تحديث Candidate Model

تم إضافة `voiceInterviewEvaluation` و `videoInterviewEvaluation` إلى:
- Interface (`ICandidate`)
- Schema (`CandidateSchema`)

**الحقول المضافة:**

#### voiceInterviewEvaluation:
- `communication` (0-10)
- `language_fluency` (string)
- `confidence` (string)
- `problem_solving` (0-10)
- `digital_skills` (string)
- `overall_fit` (string)
- `professional_attitude` (string)
- `overall_score` (0-100)
- `recommendation` ('Hire' | 'Consider' | 'Reject')
- `summary` (string)

#### videoInterviewEvaluation:
- `role_understanding` (0-10)
- `professional_depth` (0-10)
- `problem_handling` (0-10)
- `decision_making` (0-10)
- `prioritization` (0-10)
- `process_thinking` (0-10)
- `responsibility` (0-10)
- `learning_ability` (0-10)
- `job_readiness` (0-10)
- `final_role_fit` (0-10)
- `overall_score` (0-100)
- `recommendation` ('Hire' | 'Consider' | 'Reject')
- `summary` (string)

### 2. تحديث Webhook Handler

تم تحديث `/webhook/n8n` في `server.ts` لمعالجة:
- `voiceInterviewEvaluation`
- `videoInterviewEvaluation`

**الطريقة 1: إرسال كائن كامل**
```json
{
  "candidateId": "...",
  "videoInterviewEvaluation": {
    "role_understanding": 8,
    "professional_depth": 7,
    "problem_handling": 9,
    "decision_making": 8,
    "prioritization": 7,
    "process_thinking": 8,
    "responsibility": 9,
    "learning_ability": 8,
    "job_readiness": 8,
    "final_role_fit": 8,
    "overall_score": 80,
    "recommendation": "Hire",
    "summary": "..."
  }
}
```

**الطريقة 2: إرسال الحقول مباشرة**
```json
{
  "candidateId": "...",
  "role_understanding": 8,
  "professional_depth": 7,
  "problem_handling": 9,
  "decision_making": 8,
  "prioritization": 7,
  "process_thinking": 8,
  "responsibility": 9,
  "learning_ability": 8,
  "job_readiness": 8,
  "final_role_fit": 8,
  "overall_score": 80,
  "recommendation": "Hire",
  "summary": "..."
}
```

## كيفية الاستخدام

### من n8n

1. **استخدم HTTP Request node:**
   - Method: `POST`
   - URL: `http://localhost:5000/webhook/n8n` (أو IP الشبكة المحلية)
   - Body: JSON مع `candidateId` و `videoInterviewEvaluation`

2. **مثال على البيانات:**
```json
{
  "candidateId": "507f1f77bcf86cd799439011",
  "videoInterviewEvaluation": {
    "role_understanding": 8.5,
    "professional_depth": 7.5,
    "problem_handling": 9.0,
    "decision_making": 8.0,
    "prioritization": 7.5,
    "process_thinking": 8.5,
    "responsibility": 9.0,
    "learning_ability": 8.0,
    "job_readiness": 8.5,
    "final_role_fit": 8.5,
    "overall_score": 85,
    "recommendation": "Hire",
    "summary": "Candidate demonstrates strong understanding of the role and excellent problem-solving skills. Shows high responsibility and learning ability. Recommended for hire."
  }
}
```

## التحقق من الإصلاح

### 1. تحقق من Backend Logs

عند إرسال webhook من n8n، يجب أن ترى:
```
✅ Updating Video Interview evaluation for candidate: ...
📋 Video Interview Data: {...}
✅ Candidate updated successfully: ...
```

### 2. تحقق من Frontend

بعد إرسال البيانات من n8n:
1. اضغط على زر "Refresh" في صفحة Video Interview Evaluations
2. يجب أن تظهر البيانات في الجدول

### 3. تحقق من Database

يمكنك التحقق مباشرة من قاعدة البيانات:
```javascript
// في MongoDB
db.candidates.findOne({ 
  videoInterviewEvaluation: { $exists: true } 
})
```

## الملفات المعدلة

1. `apps/backend/src/models/Candidate.ts`
   - إضافة `voiceInterviewEvaluation` interface و schema
   - إضافة `videoInterviewEvaluation` interface و schema

2. `apps/backend/src/server.ts`
   - إضافة معالجة `voiceInterviewEvaluation` في webhook handler
   - إضافة معالجة `videoInterviewEvaluation` في webhook handler
   - إضافة دعم لإرسال الحقول مباشرة (direct format)

## ملاحظات

- البيانات القديمة لن تتأثر (backward compatible)
- يمكن إرسال البيانات بطريقتين: كائن كامل أو حقول مباشرة
- النظام يحدد نوع التقييم تلقائياً بناءً على الحقول المرسلة
