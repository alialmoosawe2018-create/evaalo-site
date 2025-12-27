# دليل Monorepo - Monorepo Guide

## 📖 ما هو Monorepo؟

**Monorepo** هو أسلوب تنظيم المشاريع حيث يتم وضع عدة مشاريع (مثل Frontend و Backend) في مستودع Git واحد، مع إدارة موحدة للتبعيات.

## 🎯 لماذا Monorepo؟

### المزايا:

1. **إدارة موحدة**: تبعيات واحدة وسهولة في الإدارة
2. **سرعة**: مشاركة التبعيات المشتركة (مثل TypeScript types)
3. **وضوح**: بنية واضحة ومنظمة
4. **سهولة التطوير**: تشغيل Backend و Frontend معاً بسهولة
5. **تقليل الأخطاء**: إدارة موحدة للتبعيات والإصدارات
6. **Refactoring أسهل**: تغييرات عبر المشاريع في commit واحد

## 🏗️ بنية المشروع

```
cursor-react/
├── apps/                    # جميع التطبيقات هنا
│   ├── backend/            # Backend API
│   └── frontend/           # Frontend React App
│
├── package.json            # Root package.json (workspaces config)
├── .gitignore
├── README.md
└── MONOREPO.md            # هذا الملف
```

## 🔧 npm Workspaces

المشروع يستخدم **npm workspaces** لإدارة المشاريع المتعددة.

### كيف يعمل؟

في `package.json` الجذر:

```json
{
  "workspaces": [
    "apps/*"
  ]
}
```

هذا يعني أن npm سيتعامل مع جميع المجلدات في `apps/` كـ workspaces منفصلة.

### الأوامر:

```bash
# تثبيت تبعيات جميع workspaces
npm install

# تشغيل أمر في workspace محدد
npm run dev --workspace=apps/backend
npm run dev --workspace=apps/frontend

# تشغيل أمر في جميع workspaces
npm run dev --workspaces
```

## 📝 Scripts في الجذر

تم إضافة scripts مفيدة في `package.json` الجذر:

| Script | الوصف |
|--------|-------|
| `npm run dev` | تشغيل جميع workspaces |
| `npm run dev:frontend` | تشغيل Frontend فقط |
| `npm run dev:backend` | تشغيل Backend فقط |
| `npm run dev:all` | تشغيل Backend و Frontend معاً |
| `npm run build` | بناء جميع المشاريع |
| `npm run build:frontend` | بناء Frontend فقط |
| `npm run build:backend` | بناء Backend فقط |

## 🚀 سير العمل (Workflow)

### 1. التطوير اليومي

```bash
# افتح terminal واحد للـ Backend
npm run dev:backend

# افتح terminal آخر للـ Frontend
npm run dev:frontend
```

أو استخدم `npm run dev:all` لتشغيل كلاهما في terminal واحد.

### 2. إضافة تبعية جديدة

#### للـ Backend:
```bash
cd apps/backend
npm install package-name
```

#### للـ Frontend:
```bash
cd apps/frontend
npm install package-name
```

#### للجذر (dev dependencies مشتركة):
```bash
npm install -D package-name -w .
```

### 3. بناء المشروع

```bash
# بناء جميع المشاريع
npm run build

# أو بناء كل مشروع على حدة
npm run build:backend
npm run build:frontend
```

## 🔄 إدارة التبعيات

### تبعيات مشتركة

إذا كنت تريد مشاركة تبعية بين المشاريع، يمكنك:

1. إضافتها في الجذر (لكن هذا غير موصى به عادة)
2. استخدام workspace protocol (npm 7+)

مثال:
```json
{
  "dependencies": {
    "shared-package": "workspace:*"
  }
}
```

## 📦 هيكل node_modules

مع npm workspaces:
- `node_modules/` في الجذر يحتوي على التبعيات المشتركة
- كل workspace له `node_modules/` خاص به للتبعيات الفريدة

## 🐛 استكشاف الأخطاء

### مشكلة: التبعيات لم تُثبت

```bash
# حذف جميع node_modules
rm -rf node_modules apps/*/node_modules

# إعادة التثبيت
npm install
```

### مشكلة: Workspace غير معروف

تأكد من أن:
1. المجلد موجود في `apps/`
2. يحتوي على `package.json` صالح
3. `workspaces` في الجذر يشير إلى `apps/*`

### مشكلة: Scripts لا تعمل

تأكد من:
1. اسم workspace صحيح: `apps/backend` أو `apps/frontend`
2. الـ script موجود في `package.json` الخاص بالـ workspace

## 📚 موارد إضافية

- [npm workspaces documentation](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [Monorepo tools comparison](https://monorepo.tools/)

## ✅ أفضل الممارسات

1. **استقلالية المشاريع**: كل workspace يجب أن يكون قابلاً للتشغيل بشكل مستقل
2. **تبعيات واضحة**: لا تشارك تبعيات غير ضرورية
3. **Scripts موحدة**: استخدم نفس أسماء scripts في جميع المشاريع (dev, build, start)
4. **وثائق واضحة**: وثق كل workspace في README الخاص به

---

**تم إنشاء هذا الدليل لمساعدتك في فهم واستخدام Monorepo بشكل فعال!**

