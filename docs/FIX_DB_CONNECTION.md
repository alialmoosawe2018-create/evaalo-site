# إصلاح مشكلة الاتصال بقاعدة البيانات

## ❌ المشكلة الحالية:
**خطأ في المصادقة (authentication failed)**

## ✅ خطوات الإصلاح:

### 1. التحقق من Database User في MongoDB Atlas:

1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com/)
2. اضغط **Database Access** (في القائمة الجانبية)
3. ابحث عن مستخدم قاعدة البيانات الخاص بك
4. اضغط على **Edit** بجانب المستخدم
5. **تحقق من كلمة المرور:**
   - إذا نسيتها: **Edit** → **Edit Password** → عيّن كلمة مرور جديدة واحفظها
   - انسخ نفس القيمة في `MONGODB_URI` داخل `apps/backend/.env`

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
3. Username: (اسم تختاره أنت)
4. Password: (قوية؛ ثم انسخها إلى `MONGODB_URI` في `.env`)
5. Database User Privileges: **Read and write to any database**
6. اضغط **Add User**

#### ب) تحديث Connection String:

بعد إنشاء مستخدم جديد، حدّث **`MONGODB_URI`** فقط في **`apps/backend/.env`** (لا تضع أسراراً في `database.ts`).

## 📝 معلومات الاتصال (ضع القيم الفعلية في `.env` فقط):

- **MONGODB_URI**: `mongodb://…` أو `mongodb+srv://…` من Atlas → **Connect** (بدون لصق الأسرار في الوثائق أو Git)
- **Database**: عادةً `sample_mflix` أو ما عرّفته أنت
- **Collection**: مثلاً `candidates`
- **Network Access**: أضف IP الحالي أو `0.0.0.0/0` للتجربة فقط

## ⚠️ ملاحظات مهمة:

1. **Network Access**: بعد إضافة IP Address، قد يحتاج 1-2 دقيقة للتفعيل
2. **كلمة المرور**: تأكد من أن كلمة المرور في Connection String مطابقة لكلمة المرور في MongoDB Atlas
3. **الصلاحيات**: تأكد من أن المستخدم لديه صلاحيات **Read and write to any database**



























