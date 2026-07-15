# كيفية التحقق من اتصال قاعدة البيانات

## ✅ خطوات التحقق السريعة:

### 1. التحقق من Backend يعمل:
افتح Terminal واكتب:
```bash
cd apps/backend
npm run dev
```

**يجب أن ترى:**
```
✅ Connected to MongoDB successfully
📊 Database: sample_mflix
🚀 Server is running on http://localhost:5000
```

### 2. اختبار API من المتصفح:

افتح المتصفح على:
- **Health Check**: `http://localhost:5000/health`
  - يجب أن يعيد: `{"status":"ok","message":"Server is running",...}`

- **Get Candidates**: `http://localhost:5000/api/candidates`
  - يجب أن يعيد: `{"success":true,"count":0,"data":[]}` (فارغ في البداية)

### 3. اختبار من Frontend:

1. افتح `http://localhost:3000/form`
2. املأ الاستمارة
3. اضغط **Submit**
4. اذهب إلى `http://localhost:3000/candidates`
5. **يجب أن ترى البيانات الجديدة!** ✅

### 4. التحقق من MongoDB Atlas:

1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com/)
2. اختر Cluster
3. اضغط **Browse Collections**
4. اختر Database: `sample_mflix`
5. اختر Collection: `candidates`
6. **يجب أن ترى البيانات المحفوظة!** ✅

## 🔧 إذا لم يعمل:

### المشكلة 1: Backend لا يعمل
**الحل:**
- تحقق من أن MongoDB Atlas Network Access يسمح بـ IP Address الخاص بك
- تحقق من كلمة المرور في Connection String

### المشكلة 2: خطأ في المصادقة
**الحل:**
1. اذهب إلى MongoDB Atlas → **Database Access**
2. تحقق من كلمة مرور المستخدم المطابقة لـ `MONGODB_URI` في `.env`
3. تأكد من الصلاحيات: **Read and write to any database**

### المشكلة 3: Network Access
**الحل:**
1. اذهب إلى MongoDB Atlas → **Network Access**
2. اضغط **Add IP Address**
3. اختر **Allow Access from Anywhere** (`0.0.0.0/0`)

## 📝 معلومات الاتصال:

- **MONGODB_URI** في `apps/backend/.env` فقط (رابط كامل من Atlas، مع كلمة مرور **غير** منشورة في Git/وثائق)
- **Database** / **Collection**: حسب إعدادك




























