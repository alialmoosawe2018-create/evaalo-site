# 🚀 دليل النشر على Render

## إعداد Render

### 1. إعدادات Build

في Render Dashboard، قم بتعيين:

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

### 2. متغيرات البيئة

قم بإضافة المتغيرات التالية في Render Dashboard:

- `NODE_ENV` = `production`
- `PORT` = `10000` (أو المنفذ الذي يحدده Render)
- `MONGODB_URI` = رابط MongoDB Atlas
- `FRONTEND_URL` = رابط Frontend (مثل: `https://your-frontend.com`)
- `SENDGRID_API_KEY` = مفتاح SendGrid (إن وجد)

### 3. استخدام render.yaml (اختياري)

إذا كنت تستخدم `render.yaml`، تأكد من أن الملف موجود في مجلد `apps/backend/`.

### 4. ملاحظات مهمة

- ✅ TypeScript موجود في `dependencies` (ليس `devDependencies`)
- ✅ `postinstall` script يبني المشروع تلقائياً بعد `npm install`
- ✅ الملف المبنى موجود في `dist/server.js`
- ✅ `package.json` يحتوي على `"main": "dist/server.js"`

### 5. استكشاف الأخطاء

**خطأ: Cannot find module '/app/src/server.js'**
- ✅ تأكد من أن Build Command يحتوي على `npm run build`
- ✅ تأكد من أن TypeScript موجود في dependencies
- ✅ تحقق من أن `postinstall` script موجود

**خطأ: Cannot find module في dist/**
- ✅ تأكد من أن `tsconfig.json` يحتوي على `"outDir": "./dist"`
- ✅ تأكد من أن جميع الملفات في `src/` يتم استيرادها بشكل صحيح

## بنية الملفات بعد البناء

```
apps/backend/
├── dist/              # ملفات JavaScript المبنية
│   ├── server.js
│   ├── config/
│   ├── models/
│   └── ...
├── src/               # ملفات TypeScript المصدرية
├── package.json
└── render.yaml
```

## التحقق من النشر

بعد النشر، تحقق من:
- ✅ Health endpoint: `https://your-app.onrender.com/health`
- ✅ API endpoint: `https://your-app.onrender.com/api/candidates`

---

**ملاحظة**: تأكد من رفع جميع الملفات المطلوبة إلى GitHub قبل النشر على Render.


