# بنية المشروع - Project Structure

## 📁 البنية المقترحة (Monorepo)

```
cursor-react/
├── frontend/              # Frontend (React + Vite)
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.js
│   └── ...
│
├── backend/               # Backend (Node.js + Express)
│   ├── src/
│   │   ├── server.ts
│   │   ├── assistant.ts
│   │   ├── webhook.ts
│   │   └── routes/
│   ├── package.json
│   ├── .env
│   └── tsconfig.json
│
└── README.md              # الملف الرئيسي
```

## 🔄 خطوات إعادة التنظيم

### الخطوة 1: نقل Frontend
انقل جميع ملفات Frontend الحالية إلى مجلد `frontend/`:
- src/
- public/
- package.json
- vite.config.js
- index.html
- node_modules/ (سيتم إعادة تثبيتها)

### الخطوة 2: إنشاء Backend
سيتم إنشاء مجلد `backend/` جديد مع البنية الأساسية.

### الخطوة 3: ملفات الجذر
- README.md (رئيسي)
- .gitignore
- PROJECT_NOTES.md (ملاحظات المشروع)

## 📝 ملاحظات

- كل مشروع له `package.json` منفصل
- Backend يعمل على port 5000 (أو حسب التكوين)
- Frontend يعمل على port 3000
- يمكن تشغيلهما معاً

