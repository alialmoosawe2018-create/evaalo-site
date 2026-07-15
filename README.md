# Evaalo Career Portal - Monorepo

## 📁 بنية المشروع (Monorepo Structure)

المشروع منظم كـ **Monorepo** باستخدام **npm workspaces** لسهولة إدارة الباك اند والفرونت اند معاً.

```
cursor-react/
├── apps/
│   ├── backend/          # Backend API (Node.js + Express + TypeScript)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── ...
│   │
│   └── frontend/         # Frontend (React + Vite)
│       ├── src/
│       ├── public/
│       ├── package.json
│       └── ...
│
├── package.json          # Root package.json (workspaces config)
├── .gitignore
└── README.md
```

## 🚀 البدء السريع

### 1. تثبيت جميع التبعيات

```bash
# من المجلد الجذر
npm install
```

سيقوم هذا الأمر بتثبيت تبعيات جميع المشاريع (backend + frontend) تلقائياً.

### 2. إعداد Backend

```bash
# الانتقال إلى مجلد backend
cd apps/backend

# نسخ ملف البيئة
copy env.example .env
# أو في Linux/Mac:
# cp env.example .env

# تعديل ملف .env وإضافة:
# - VAPI_API_KEY=your_api_key
# - PORT=5000
# - FRONTEND_URL=http://localhost:3000
```

### 3. تشغيل المشاريع

#### الطريقة الأولى: تشغيل كل مشروع على حدة

```bash
# من المجلد الجذر

# تشغيل Backend فقط
npm run dev:backend

# تشغيل Frontend فقط
npm run dev:frontend
```

#### الطريقة الثانية: تشغيل كل المشاريع معاً

```bash
# من المجلد الجذر
npm run dev:all
```

#### الطريقة الثالثة: تشغيل كل workspaces

```bash
# من المجلد الجذر
npm run dev
```

## 📝 الأوامر المتاحة

### من المجلد الجذر:

| الأمر | الوصف |
|------|-------|
| `npm install` | تثبيت تبعيات جميع المشاريع |
| `npm run dev` | تشغيل جميع المشاريع في وضع التطوير |
| `npm run dev:frontend` | تشغيل Frontend فقط |
| `npm run dev:backend` | تشغيل Backend فقط |
| `npm run dev:all` | تشغيل Backend و Frontend معاً |
| `npm run build` | بناء جميع المشاريع |
| `npm run build:frontend` | بناء Frontend فقط |
| `npm run build:backend` | بناء Backend فقط |
| `npm run type-check` | فحص أنواع TypeScript في Backend |

### من مجلدات المشاريع:

#### Backend (`apps/backend/`):
```bash
npm run dev      # تشغيل في وضع التطوير
npm run build    # بناء المشروع
npm start        # تشغيل في وضع الإنتاج
npm run type-check  # فحص أنواع TypeScript
```

#### Frontend (`apps/frontend/`):
```bash
npm run dev      # تشغيل في وضع التطوير
npm run build    # بناء المشروع
npm run preview  # معاينة الإنتاج
```

## 🏗️ البنية التفصيلية

### Backend (`apps/backend/`)

```
apps/backend/
├── src/
│   └── server.ts        # السيرفر الرئيسي
├── docs/                # الوثائق
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── QUICKSTART.md
│   └── FRONTEND_INTEGRATION.md
├── package.json
├── tsconfig.json
├── env.example
├── Dockerfile
└── docker-compose.yml
```

**المميزات:**
- ✅ TypeScript
- ✅ Express.js
- ✅ تكامل مع Vapi AI
- ✅ CORS محدد
- ✅ جاهز للنشر

### Frontend (`apps/frontend/`)

```
apps/frontend/
├── src/
│   ├── components/      # مكونات React
│   ├── pages/          # الصفحات
│   ├── contexts/       # Context API
│   ├── hooks/          # Custom Hooks
│   └── utils/          # Utilities
├── public/
│   └── images/         # الصور
├── package.json
├── vite.config.js
└── index.html
```

**المميزات:**
- ✅ React 18
- ✅ Vite (بناء سريع)
- ✅ React Router
- ✅ دعم متعدد اللغات
- ✅ تكامل مع Vapi Widget

## 🔧 المتطلبات

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0

## 📦 Workspaces

المشروع يستخدم **npm workspaces** لإدارة المشاريع المتعددة:

- `apps/backend` - Backend API
- `apps/frontend` - Frontend React App

## 🎯 مزايا Monorepo

✅ **إدارة موحدة**: تبعيات واحدة وسهولة في الإدارة  
✅ **سرعة**: مشاركة التبعيات المشتركة  
✅ **وضوح**: بنية واضحة ومنظمة  
✅ **سهولة التطوير**: تشغيل Backend و Frontend معاً بسهولة  
✅ **تقليل الأخطاء**: إدارة موحدة للتبعيات والإصدارات  

## 🔗 الروابط

- **Backend API**: http://localhost:5000
- **Frontend**: http://localhost:3000
- **Backend Health Check**: http://localhost:5000/health

## 📚 الوثائق

- [Backend API Documentation](./apps/backend/docs/API.md)
- [Deployment Guide](./apps/backend/docs/DEPLOYMENT.md)
- [Quick Start Guide](./apps/backend/docs/QUICKSTART.md)
- [Frontend Integration](./apps/backend/docs/FRONTEND_INTEGRATION.md)

## 🐛 استكشاف الأخطاء

### مشكلة: التبعيات لم تُثبت بشكل صحيح

```bash
# حذف node_modules وإعادة التثبيت
npm run clean
npm install
```

### مشكلة: Backend لا يعمل

1. تأكد من وجود ملف `.env` في `apps/backend/`
2. تأكد من أن المنفذ 5000 غير مستخدم
3. تحقق من `VAPI_API_KEY` في ملف `.env`

### مشكلة: Frontend لا يتصل مع Backend

1. تأكد من أن Backend يعمل على `http://localhost:5000`
2. تحقق من `FRONTEND_URL` في `apps/backend/.env`
3. تأكد من إعدادات CORS في Backend

## 📝 ملاحظات

- جميع ملفات `.env` غير موجودة في Git (موجودة في `.gitignore`)
- استخدم `env.example` كقالب لإنشاء ملف `.env`
- في التطوير، يمكن تشغيل Backend و Frontend في نوافذ منفصلة

## 🚀 النشر

راجع [دليل النشر](./apps/backend/docs/DEPLOYMENT.md) للتفاصيل الكاملة.

---

**تم البناء باستخدام:**
- npm workspaces
- React + Vite
- Node.js + Express + TypeScript
- Vapi AI
