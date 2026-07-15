# كيفية التحقق من اتصال قاعدة البيانات

## المشكلة الحالية:
❌ **خطأ في المصادقة (authentication failed)**

## خطوات التحقق:

### 1. التحقق من MongoDB Atlas:

#### أ) التحقق من Network Access:
1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com/)
2. اختر Cluster الخاص بك
3. اذهب إلى **Network Access** (في القائمة الجانبية)
4. تأكد من إضافة IP Address الخاص بك:
   - اضغط **Add IP Address**
   - اختر **Allow Access from Anywhere** (0.0.0.0/0) للتطوير
   - أو أضف IP Address الخاص بك

#### ب) التحقق من Database User:
1. اذهب إلى **Database Access**
2. تأكد من وجود مستخدم قاعدة البيانات الذي تستخدمه في `MONGODB_URI`
3. تأكد أن كلمة المرور في Atlas تطابق ما في `apps/backend/.env`
4. تأكد من أن المستخدم لديه صلاحيات **Read and write to any database**

### 2. اختبار الاتصال:

#### الطريقة 1: من MongoDB Atlas:
1. اذهب إلى Cluster
2. اضغط **Connect**
3. اختر **Connect your application**
4. انسخ Connection String
5. تأكد من أن كلمة المرور في Connection String صحيحة

#### الطريقة 2: من التطبيق:
```bash
cd apps/backend
npm run dev
```

يجب أن ترى:
```
✅ Connected to MongoDB successfully
📊 Database: sample_mflix
```

### 3. اختبار API:

بعد تشغيل Backend، افتح المتصفح على:
- `http://localhost:5000/health` - يجب أن يعيد `{"status":"ok"}`
- `http://localhost:5000/api/candidates` - يجب أن يعيد قائمة المرشحين (قد تكون فارغة في البداية)

### 4. اختبار من Frontend:

1. افتح `http://localhost:3000/form`
2. املأ الاستمارة
3. اضغط Submit
4. اذهب إلى `http://localhost:3000/candidates`
5. يجب أن ترى البيانات الجديدة

## معلومات الاتصال:

- **MONGODB_URI**: يُضبط في `apps/backend/.env` فقط (لا تلصق الأسرار في الوثائق)
- **Database** / **Collection**: حسب إعدادك (مثلاً `sample_mflix` / `candidates`)

## إذا استمرت المشكلة:

1. تحقق من أن كلمة المرور صحيحة في MongoDB Atlas
2. تحقق من Network Access (يجب أن يكون IP Address مسموح)
3. جرب إنشاء Database User جديد
4. تأكد من أن Database Name صحيح (`sample_mflix`)



























