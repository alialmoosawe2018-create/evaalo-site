# Vapi Voice Agent - مشروع الوكيل الصوتي بالذكاء الاصطناعي

## 📋 نظرة عامة
مشروع متكامل لبناء وكيل صوتي ذكي باستخدام Vapi AI، يتكون من:
- **Frontend**: واجهة مستخدم React
- **Backend**: سيرفر Node.js مع Vapi SDK

## 📁 بنية المشروع

```
cursor-react/
├── frontend/          # Frontend (React + Vite)
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend/           # Backend (Node.js + Express + Vapi)
│   ├── src/
│   └── package.json
│
└── README.md          # هذا الملف
```

## 🚀 البدء السريع

### 1. Backend
```bash
cd backend
npm install
copy .env.example .env
# أضف VAPI_API_KEY في ملف .env
npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📝 ملاحظات

- Backend يعمل على: `http://localhost:5000`
- Frontend يعمل على: `http://localhost:3000`
- يجب إضافة `VAPI_API_KEY` في ملف `backend/.env`

## 🔗 روابط مفيدة

- [Vapi Documentation](https://docs.vapi.ai)
- [Vapi TypeScript SDK](https://github.com/VapiAI/server-sdk-typescript)
