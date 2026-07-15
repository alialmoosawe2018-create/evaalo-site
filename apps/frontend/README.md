# Evaalo Career Portal — الواجهة الأمامية

## نظرة عامة

تطبيق **React + Vite** لبوابة التوظيف والمقابلات (كتبة، صوت، فيديو).

- **Frontend**: واجهة المستخدم الحالية (`apps/frontend`)
- **Backend**: واجهة API في `apps/backend`

## بنية المشروع (مختصر)

```
cursor-react/
├── apps/frontend/     # هذا المشروع
├── apps/backend/      # API
└── README.md
```

## البدء السريع

### Backend

```bash
cd ../backend
npm install
# انسخ .env.example إلى .env واضبط المتغيرات
npm run dev
```

### Frontend

```bash
npm install
npm run dev
```

## ملاحظات

- Backend افتراضياً: `http://localhost:5000`
- Frontend افتراضياً: `http://localhost:3000` (انظر `vite.config.js`)
