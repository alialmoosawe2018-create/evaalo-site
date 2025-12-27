# 🚀 كيفية تشغيل Backend

## 📍 الخطوات:

### 1. افتح Terminal:

#### في VS Code / Cursor:
- اضغط `Ctrl + ~` (أو `Ctrl + ``) لفتح Terminal
- أو من القائمة: **Terminal** → **New Terminal**

#### في Windows PowerShell:
- اضغط `Win + X` ثم اختر **Windows PowerShell**
- أو ابحث عن "PowerShell" في قائمة Start

### 2. انتقل إلى مجلد Backend:

اكتب في Terminal:
```bash
cd apps/backend
```

أو إذا كنت في المجلد الرئيسي للمشروع:
```bash
cd c:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\backend
```

### 3. شغّل Backend:

```bash
npm run dev
```

---

## ✅ النتيجة المتوقعة:

بعد تشغيل `npm run dev`، يجب أن ترى:

```
✅ Connected to MongoDB successfully
📊 Database: sample_mflix
🚀 Server is running on http://localhost:5000
📡 Frontend URL: http://localhost:3000
🌍 Environment: development
```

---

## 📝 مثال كامل:

```bash
# 1. افتح Terminal
# 2. انتقل إلى مجلد المشروع
cd c:\Users\Alnaji-AliMD\.cursor\cursor-react

# 3. انتقل إلى Backend
cd apps/backend

# 4. شغّل Backend
npm run dev
```

---

## 🔍 التحقق من أن Backend يعمل:

بعد تشغيل Backend، افتح المتصفح على:
```
http://localhost:5000/health
```

يجب أن ترى:
```json
{"status":"ok","message":"Server is running","timestamp":"..."}
```

---

## ⚠️ ملاحظات:

1. **Terminal يجب أن يبقى مفتوحاً** - إذا أغلقت Terminal، سيتوقف Backend
2. **Port 5000** - تأكد من أن Port 5000 غير مستخدم
3. **MongoDB** - تأكد من أن MongoDB متصل (يجب أن ترى "✅ Connected to MongoDB successfully")

---

## 🛑 إيقاف Backend:

في Terminal، اضغط:
```
Ctrl + C
```

---

## 📂 المسار الكامل:

```
c:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\backend
```

---

**جاهز للبدء! 🎉**
