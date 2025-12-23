# خطوات تشغيل المشروع React

## المتطلبات الأساسية
- Node.js (الإصدار 16 أو أحدث)
- npm أو yarn

## الخطوات

### 1. تثبيت الحزم (Dependencies)
افتح Terminal في مجلد `cursor-react` وقم بتشغيل:

```bash
npm install
```

أو إذا كنت تستخدم yarn:

```bash
yarn install
```

### 2. تشغيل المشروع في وضع التطوير (Development Mode)
بعد تثبيت الحزم، قم بتشغيل:

```bash
npm run dev
```

أو:

```bash
yarn dev
```

### 3. فتح المتصفح
بعد تشغيل الأمر، سيتم فتح المتصفح تلقائياً على العنوان:
- **http://localhost:3000**

إذا لم يفتح تلقائياً، افتح المتصفح يدوياً واذهب إلى:
- http://localhost:3000

### 4. الصفحات المتاحة
- **الصفحة الرئيسية**: http://localhost:3000/
- **صفحة Design**: http://localhost:3000/design
- **صفحة Form**: http://localhost:3000/form

## أوامر إضافية

### بناء المشروع للإنتاج (Build)
```bash
npm run build
```

### معاينة البناء (Preview Build)
```bash
npm run preview
```

## ملاحظات
- المشروع يستخدم Vite كأداة بناء
- المنفذ الافتراضي: 3000
- جميع التغييرات في الكود يتم تحديثها تلقائياً (Hot Reload)



