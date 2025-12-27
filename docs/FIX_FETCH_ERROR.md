# إصلاح مشكلة "Failed to fetch"

## ✅ تم إصلاح CORS:

تم تحديث CORS لدعم جميع المنافذ:
- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:3001`
- `http://127.0.0.1:3002`

## 🔧 خطوات التحقق:

### 1. تأكد من أن Backend يعمل:

افتح Terminal واكتب:
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

### 2. اختبار API من المتصفح:

افتح المتصفح على:
- `http://localhost:5000/health` → يجب أن يعيد `{"status":"ok"}`
- `http://localhost:5000/api/candidates` → يجب أن يعيد `{"success":true,"count":0,"data":[]}`

### 3. اختبار من Frontend:

1. افتح `http://localhost:3002/form` (أو 3001)
2. افتح **Developer Console** (F12)
3. اذهب إلى **Network** tab
4. املأ الاستمارة واضغط **Submit**
5. ابحث عن الطلب إلى `http://localhost:5000/api/candidates`
6. تحقق من:
   - **Status**: يجب أن يكون `200` أو `201`
   - **Response**: يجب أن يحتوي على البيانات

### 4. إذا استمرت المشكلة:

#### أ) تحقق من Console Errors:
- افتح Developer Console (F12)
- ابحث عن أخطاء CORS أو Network
- أرسل الخطأ الكامل

#### ب) تحقق من Network Tab:
- افتح Network tab
- ابحث عن الطلب إلى `/api/candidates`
- اضغط عليه
- تحقق من:
  - **Request URL**: يجب أن يكون `http://localhost:5000/api/candidates`
  - **Status Code**: يجب أن يكون `200` أو `201`
  - **CORS Headers**: يجب أن يحتوي على `Access-Control-Allow-Origin`

## 📝 معلومات مهمة:

- **Backend URL**: `http://localhost:5000`
- **Frontend URLs**: `http://localhost:3000` أو `3001` أو `3002`
- **API Endpoint**: `http://localhost:5000/api/candidates`

## ⚠️ ملاحظات:

1. **Backend يجب أن يعمل أولاً** قبل فتح Frontend
2. **CORS محدث** لدعم جميع المنافذ
3. إذا استمرت المشكلة، أرسل:
   - الخطأ من Console
   - الخطأ من Network tab
   - Status Code للطلب



























