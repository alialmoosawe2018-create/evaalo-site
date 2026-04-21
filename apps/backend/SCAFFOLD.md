# هيكل الباكند (Skeleton)

هذا الباكند مبني على الهيكل الموحد التالي:

```
backend/
├── src/
│   ├── server.ts          # نقطة الدخول — Express + WebSocket
│   ├── loadEnv.ts         # تحميل .env
│   ├── routes/            # مسارات API
│   ├── services/          # منطق الأعمال (STT, LLM, TTS, …)
│   ├── controllers/       # (هيكل فقط — جاهز لاستخدام لاحقاً)
│   ├── models/            # نماذج قاعدة البيانات
│   ├── config/            # إعدادات (DB, …)
│   └── voice/             # WebSocket الصوت + بروتوكول
├── package.json
├── env.example            # OPENAI_API_KEY= ، ELEVENLABS_API_KEY= ، …
└── .env                   # (نسخ من env.example وتعبئة القيم)
```

## التحقق من أن السيرفر واقف (Skeleton check)

- **GET /health** → يرجع نصاً فقط: `OK`  
- **GET /api/health** → يرجع JSON تفصيلي (حالة DB، timestamp، …)

```bash
npm install
npm run dev
# ثم: curl http://localhost:5000/health  → OK
```

كل الطلبات (صوت، API) تمر عبر هذا الباكند؛ لا اتصال مباشر من الواجهة بمزودي الخدمة.
