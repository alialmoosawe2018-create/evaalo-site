# Evaalo Career Portal

منصة توظيف ذكية مدعومة بالذكاء الاصطناعي للمقابلات الصوتية والكتابية.

## 📋 نظرة عامة

هذا المشروع هو منصة متكاملة لإدارة عملية التوظيف، تتضمن:
- **مقابلات صوتية ذكية** باستخدام Vapi AI
- **مقابلات كتابية** مع تقييم تلقائي
- **لوحة تحكم** لإدارة المرشحين والوظائف
- **تصميم ديناميكي** للاستمارات والمقابلات

## 🏗️ بنية المشروع

```
cursor-react/
├── apps/
│   ├── frontend/          # تطبيق React (Vite)
│   │   ├── src/
│   │   │   ├── components/    # مكونات React
│   │   │   ├── pages/         # صفحات التطبيق
│   │   │   ├── contexts/      # React Contexts
│   │   │   ├── hooks/         # Custom Hooks
│   │   │   ├── utils/         # Utilities
│   │   │   └── config/        # إعدادات التطبيق
│   │   ├── public/            # ملفات ثابتة
│   │   └── dist/              # ملفات البناء (مولدة)
│   │
│   └── backend/           # تطبيق Node.js/Express (TypeScript)
│       ├── src/
│       │   ├── config/        # إعدادات قاعدة البيانات
│       │   ├── models/        # نماذج MongoDB
│       │   ├── routes/        # مسارات API
│       │   ├── services/      # خدمات (n8n integration)
│       │   └── scripts/       # سكريبتات مساعدة
│       ├── docs/              # توثيق Backend
│       └── uploads/            # ملفات مرفوعة
│
├── docs/                  # توثيق عام للمشروع
└── README.md             # هذا الملف

```

## 🚀 البدء السريع

### المتطلبات الأساسية

- Node.js 18+ 
- npm أو yarn
- MongoDB (محلي أو Atlas)
- Git

### تثبيت المشروع

```bash
# استنساخ المشروع
git clone <repository-url>
cd cursor-react

# تثبيت dependencies للجذر (إن وجدت)
npm install

# تثبيت dependencies للـ Frontend
cd apps/frontend
npm install

# تثبيت dependencies للـ Backend
cd ../backend
npm install
```

### إعداد متغيرات البيئة

#### Backend (.env)

```bash
cd apps/backend
cp env.example .env
```

قم بتعديل `.env` وإضافة:
- `MONGODB_URI` - رابط MongoDB
- `PORT` - منفذ السيرفر (افتراضي: 5000)
- `FRONTEND_URL` - رابط Frontend

#### Frontend

لا يحتاج Frontend إلى ملف `.env` في الوقت الحالي.

### تشغيل المشروع

#### تطوير محلي

**Terminal 1 - Backend:**
```bash
cd apps/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd apps/frontend
npm run dev
```

#### بناء للإنتاج

**Frontend:**
```bash
cd apps/frontend
npm run build
```

**Backend:**
```bash
cd apps/backend
npm run build  # إذا كان متوفراً
```

## 📚 التوثيق

### توثيق عام
- [MONOREPO.md](./docs/MONOREPO.md) - بنية Monorepo
- [N8N_INTEGRATION.md](./docs/N8N_INTEGRATION.md) - تكامل n8n

### توثيق Backend
- [apps/backend/docs/API.md](./apps/backend/docs/API.md) - وثائق API
- [apps/backend/docs/DEPLOYMENT.md](./apps/backend/docs/DEPLOYMENT.md) - نشر Backend
- [apps/backend/docs/QUICKSTART.md](./apps/backend/docs/QUICKSTART.md) - دليل البدء السريع

### توثيق Frontend
- [apps/frontend/README.md](./apps/frontend/README.md) - دليل Frontend
- [apps/frontend/PROJECT_STRUCTURE.md](./apps/frontend/PROJECT_STRUCTURE.md) - بنية المشروع

## 🛠️ التقنيات المستخدمة

### Frontend
- **React 18** - مكتبة UI
- **Vite** - Build tool
- **React Router** - Routing
- **Vapi AI Web SDK** - مقابلات صوتية
- **GSAP** - Animations

### Backend
- **Node.js** - Runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **MongoDB + Mongoose** - قاعدة البيانات
- **Multer** - رفع الملفات

## 📁 الملفات المهمة

### Frontend
- `apps/frontend/src/App.jsx` - المكون الرئيسي
- `apps/frontend/src/components/VapiWidget.jsx` - مكون المساعد الصوتي
- `apps/frontend/src/pages/Interview.jsx` - صفحة المقابلات الصوتية
- `apps/frontend/src/config/vapiAssistants.js` - إعدادات Vapi

### Backend
- `apps/backend/src/server.ts` - السيرفر الرئيسي
- `apps/backend/src/routes/candidates.ts` - مسارات المرشحين
- `apps/backend/src/models/Candidate.ts` - نموذج المرشح

## 🔧 الإعدادات

### Vapi AI Configuration

يتم إعداد Vapi Assistants في:
```
apps/frontend/src/config/vapiAssistants.js
```

### MongoDB Connection

يتم إعداد الاتصال بقاعدة البيانات في:
```
apps/backend/src/config/database.ts
```

## 🚢 النشر

### Frontend (GitHub Pages)
1. بناء المشروع: `npm run build`
2. رفع محتويات `dist/` إلى GitHub Pages

### Backend (Render/Heroku)
1. إعداد متغيرات البيئة
2. رفع الكود إلى المنصة
3. تشغيل `npm start`

## 📝 ملاحظات

- **ملفات حساسة**: لا ترفع ملفات `.env` أو `sendgrid.env` إلى Git
- **Build files**: مجلد `dist/` يتم تجاهله في Git
- **Logs**: ملفات `.log` يتم تجاهلها

## 🤝 المساهمة

1. Fork المشروع
2. إنشاء branch جديد (`git checkout -b feature/AmazingFeature`)
3. Commit التغييرات (`git commit -m 'Add some AmazingFeature'`)
4. Push إلى Branch (`git push origin feature/AmazingFeature`)
5. فتح Pull Request

## 📄 الترخيص

هذا المشروع خاص بـ Evaalo.

## 📞 الدعم

للأسئلة والدعم، يرجى فتح Issue في GitHub.

---

**آخر تحديث**: ديسمبر 2025
