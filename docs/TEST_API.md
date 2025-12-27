# اختبار API والاتصال بقاعدة البيانات

## ✅ التحقق من الاتصال:

### 1. Backend يعمل:
- **المنفذ**: `5000`
- **الحالة**: ✅ يعمل (LISTENING)

### 2. Frontend يعمل:
- **المنفذ**: `3002` (أو `3000`)
- **URL**: `http://localhost:3002`

### 3. اختبار API من المتصفح:

افتح المتصفح على:
- **Health Check**: `http://localhost:5000/health`
  - يجب أن يعيد: `{"status":"ok","message":"Server is running"}`

- **Get Candidates**: `http://localhost:5000/api/candidates`
  - يجب أن يعيد: `{"success":true,"count":0,"data":[]}`

### 4. اختبار من Frontend:

1. افتح `http://localhost:3002/form`
2. املأ الاستمارة
3. اضغط **Submit**
4. افتح Developer Console (F12) → Network tab
5. تحقق من أن الطلب إلى `http://localhost:5000/api/candidates` نجح
6. اذهب إلى `http://localhost:3002/candidates`
7. **يجب أن ترى البيانات الجديدة!** ✅

## 🔧 إذا فشل Fetch:

### المشكلة 1: CORS Error
**الحل**: تم تحديث CORS لدعم `localhost:3002`

### المشكلة 2: Backend لا يعمل
**الحل**: 
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

### المشكلة 3: Connection Refused
**الحل**: 
- تحقق من أن Backend يعمل على المنفذ 5000
- تحقق من Firewall
- تأكد من أن MongoDB Atlas Network Access يسمح بـ IP Address

## 📝 معلومات الاتصال:

- **Backend URL**: `http://localhost:5000`
- **Frontend URL**: `http://localhost:3002` (أو `3000`)
- **MongoDB**: `sample_mflix` / `candidates`
- **API Endpoints**:
  - `GET /api/candidates` - جلب جميع المرشحين
  - `POST /api/candidates` - إضافة مرشح جديد



























