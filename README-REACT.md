# Evaalo Career Portal - React Version

تم تحويل الموقع من HTML إلى React بنجاح!

## التثبيت والتشغيل

### 1. تثبيت التبعيات
```bash
npm install
```

### 2. تشغيل المشروع في وضع التطوير
```bash
npm run dev
```

سيتم فتح الموقع تلقائياً على `http://localhost:3000`

### 3. بناء المشروع للإنتاج
```bash
npm run build
```

سيتم إنشاء مجلد `dist` يحتوي على الملفات المُحسّنة للإنتاج.

### 4. معاينة الإنتاج
```bash
npm run preview
```

## البنية الجديدة

```
.
├── public/
│   ├── images/          # الصور
│   └── index.html       # HTML الأساسي
├── src/
│   ├── components/     # مكونات React
│   │   ├── Navigation.jsx
│   │   ├── Hero.jsx
│   │   ├── Features.jsx
│   │   ├── Process.jsx
│   │   ├── CTA.jsx
│   │   ├── Footer.jsx
│   │   └── NeuralNetwork.jsx
│   ├── contexts/        # Context API
│   │   └── LanguageContext.jsx
│   ├── App.jsx          # المكون الرئيسي
│   ├── main.jsx         # نقطة الدخول
│   ├── index.css        # الأنماط
│   └── translations.js  # ملفات الترجمة
├── package.json
├── vite.config.js
└── README-REACT.md
```

## المميزات

- ✅ تحويل كامل من HTML إلى React
- ✅ استخدام Context API لإدارة اللغة
- ✅ مكونات منفصلة ومنظمة
- ✅ دعم متعدد اللغات (English, العربية, کوردی)
- ✅ استخدام Swiper.js للـ carousel
- ✅ الحفاظ على جميع الأنماط والتصميم الأصلي
- ✅ استخدام Vite كأداة بناء سريعة

## الملفات الأصلية

الملفات الأصلية (HTML, CSS, JS) لا تزال موجودة في المجلد الرئيسي ويمكن الرجوع إليها عند الحاجة.

## ملاحظات

- جميع الصور موجودة في `public/images/`
- ملف CSS الأصلي تم نسخه إلى `src/index.css`
- الترجمة تعمل عبر Context API
- جميع الوظائف التفاعلية تم تحويلها إلى React Hooks

