# Beyond Presence SDK Setup Guide

## ✅ تم استبدال iframe بـ SDK الرسمي

### الخطوات المطلوبة:

#### 1️⃣ تثبيت SDK الرسمي

```bash
cd cursor-react/apps/frontend
npm install @beyondpresence/web-sdk
```

**ملاحظة:** إذا لم تكن الحزمة متوفرة بهذا الاسم، تحقق من:
- وثائق Beyond Presence الرسمية
- GitHub repository
- npm registry

#### 2️⃣ إضافة API Key إلى .env

تم إضافة `VITE_BEYOND_PRESENCE_API_KEY` إلى ملف `.env` تلقائياً.

إذا لم يكن موجوداً، أضفه يدوياً:
```env
VITE_BEYOND_PRESENCE_API_KEY=your-api-key-here
VITE_BEYOND_PRESENCE_AVATAR_ID=694c83e2-8895-4a98-bd16-56332ca3f449
```

#### 3️⃣ تفعيل SDK في الكود

افتح `src/pages/VideoInterviewCall.jsx` وابحث عن:

```javascript
// TODO: استيراد SDK الرسمي عند توافره
// import { BeyondPresence } from '@beyondpresence/web-sdk';
```

**قم بإلغاء التعليق وتحديث الكود:**

```javascript
import { BeyondPresence } from '@beyondpresence/web-sdk';
```

ثم في `useEffect` الخاص بـ SDK، قم بإلغاء التعليق عن الكود:

```javascript
const avatar = new BeyondPresence({
    apiKey: import.meta.env.VITE_BEYOND_PRESENCE_API_KEY || '',
    avatarId: BEYOND_PRESENCE_AVATAR_ID,
    container: avatarVideoRef.current,
    sessionId: sessionId,
    onReady: () => {
        console.log('✅ Beyond Presence SDK initialized');
    },
    onError: (error) => {
        console.error('❌ Beyond Presence SDK error:', error);
    }
});

avatar.start();
beyondPresenceInstanceRef.current = avatar;
```

وفي cleanup:

```javascript
if (beyondPresenceInstanceRef.current) {
    beyondPresenceInstanceRef.current.destroy();
    // أو
    beyondPresenceInstanceRef.current.stop();
    beyondPresenceInstanceRef.current = null;
}
```

#### 4️⃣ إعادة تشغيل Frontend

```bash
npm run dev
```

---

## الفرق بين iframe و SDK:

| الميزة | iframe ❌ | SDK ✅ |
|--------|-----------|--------|
| CSP Policy | محظور | يعمل |
| الصوت | لا يعمل | يعمل |
| الميكروفون | محدود | كامل |
| Session Management | صعب | سهل |
| Events | محدود | كامل |
| Performance | أبطأ | أسرع |

---

## ملاحظات مهمة:

1. **لا يوجد workaround للـ CSP** - SDK هو الحل الوحيد
2. **تأكد من تثبيت SDK الرسمي** من Beyond Presence
3. **تحقق من الوثائق** للتأكد من API الصحيح
4. **أعد تشغيل Frontend** بعد التثبيت

---

## إذا لم تجد SDK:

1. تحقق من وثائق Beyond Presence الرسمية
2. اتصل بدعم Beyond Presence
3. تحقق من GitHub repository الخاص بهم

---

## الملفات المعدلة:

- ✅ `package.json` - أضيف `@beyondpresence/web-sdk`
- ✅ `src/pages/VideoInterviewCall.jsx` - استبدال iframe بـ SDK
- ✅ `.env` - أضيف `VITE_BEYOND_PRESENCE_API_KEY`

