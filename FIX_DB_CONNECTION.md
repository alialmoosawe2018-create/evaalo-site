# إصلاح مشكلة الاتصال بقاعدة البيانات

## ❌ المشكلة الحالية:
**خطأ في المصادقة (authentication failed)**

## ✅ خطوات الإصلاح:

### 1. التحقق من Database User في MongoDB Atlas:

1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com/)
2. اضغط **Database Access** (في القائمة الجانبية)
3. ابحث عن المستخدم: `alialmoosawe2018`
4. اضغط على **Edit** بجانب المستخدم
5. **تحقق من كلمة المرور:**
   - إذا نسيت كلمة المرور، اضغط **Edit** → **Edit Password**
   - أدخل كلمة المرور الجديدة: `A07820782M`
   - أو استخدم كلمة المرور الصحيحة إذا كانت مختلفة

### 2. التحقق من Network Access:

1. اذهب إلى **Network Access** (في القائمة الجانبية)
2. تأكد من وجود IP Address: `77.237.234.153`
3. إذا لم يكن موجوداً:
   - اضغط **Add IP Address**
   - أدخل: `77.237.234.153`
   - أو اختر **Allow Access from Anywhere** (`0.0.0.0/0`)
4. **انتظر دقيقة** بعد إضافة IP Address

### 3. اختبار الاتصال:

بعد التأكد من الخطوات أعلاه، شغّل:
```bash
cd apps/backend
node test-connection.js
```

يجب أن ترى:
```
✅ Connected to MongoDB successfully!
📊 Database: sample_mflix
📈 Total candidates in database: 0
✅✅✅ الاتصال يعمل بنجاح! ✅✅✅
```

### 4. إذا استمرت المشكلة:

#### أ) إنشاء Database User جديد:

1. اذهب إلى **Database Access**
2. اضغط **Add New Database User**
3. Username: `alialmoosawe2018` (أو اسم جديد)
4. Password: `A07820782M` (أو كلمة مرور جديدة)
5. Database User Privileges: **Read and write to any database**
6. اضغط **Add User**

#### ب) تحديث Connection String:

بعد إنشاء مستخدم جديد، حدّث Connection String في:
- `apps/backend/src/config/database.ts`
- استبدل Username و Password بالجديد

## 📝 معلومات الاتصال الحالية:

- **Connection String**: `mongodb+srv://alialmoosawe2018:A07820782M@cluster0.35tnfqd.mongodb.net/sample_mflix?retryWrites=true&w=majority&appName=Cluster0`
- **Database**: `sample_mflix`
- **Collection**: `candidates`
- **Username**: `alialmoosawe2018`
- **Password**: `A07820782M`
- **IP Address**: `77.237.234.153`

## ⚠️ ملاحظات مهمة:

1. **Network Access**: بعد إضافة IP Address، قد يحتاج 1-2 دقيقة للتفعيل
2. **كلمة المرور**: تأكد من أن كلمة المرور في Connection String مطابقة لكلمة المرور في MongoDB Atlas
3. **الصلاحيات**: تأكد من أن المستخدم لديه صلاحيات **Read and write to any database**



























