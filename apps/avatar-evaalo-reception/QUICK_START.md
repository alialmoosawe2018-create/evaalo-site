# ⚡ Quick Start - تشغيل Agent

## ⚠️ ملاحظة مهمة

**Agent هو Python application، ليس Node.js!**
- ❌ **لا تستخدم:** `npm run dev`
- ✅ **استخدم:** `uv run python src/agent.py dev`

---

## 🚀 الخطوات الصحيحة

### الخطوة 1: توقف عن استخدام npm

```powershell
# توقف عن npm - Agent ليس Node.js application
# npm run dev  ❌ خطأ!
```

### الخطوة 2: تشغيل Agent (Python)

```powershell
cd apps/avatar-evaalov2

# تحميل models (أول مرة فقط)
uv run python src/agent.py download-files

# تشغيل Agent
$env:PYTHONUNBUFFERED = "1"
uv run python src/agent.py dev
```

### أو استخدام Script:

```powershell
cd apps/avatar-evaalov2
.\run_agent.ps1
```

---

## 📋 الترتيب الصحيح للتشغيل

### Terminal 1: Agent (Python) ⭐ ابدأ هنا
```powershell
cd apps/avatar-evaalov2
.\run_agent.ps1
```

### Terminal 2: Backend (Node.js)
```powershell
cd apps/backend
npm run dev
```

### Terminal 3: Frontend (Node.js)
```powershell
cd apps/frontend
npm run dev
```

---

## 🔍 حل مشكلة البورت 5000 مستخدم

إذا ظهرت رسالة `EADDRINUSE: address already in use 0.0.0.0:5000`:

### الطريقة 1: إيقاف العملية المستخدمة للبورت

```powershell
# ابحث عن العملية
netstat -ano | findstr :5000

# أوقف العملية (استبدل PID برقم العملية)
taskkill /PID <PID> /F
```

### الطريقة 2: تغيير بورت Backend (اختياري)

في `apps/backend/.env`:
```env
PORT=5001
```

---

## ✅ التأكد من أن كل شيء صحيح

### Agent (Python):
- ✅ يجب أن يظهر: `🚀 Starting LiveKit Agent...`
- ✅ يجب أن يظهر: `✅ Beyond Presence client initialized`

### Backend (Node.js):
- ✅ يجب أن يظهر: `✅ Connected to MongoDB successfully`
- ✅ يجب أن يظهر: `Server running on port 5000`

### Frontend (Node.js):
- ✅ يجب أن يظهر: `VITE ready in ...`
- ✅ افتح: `http://localhost:3000`

---

**تذكر: Agent = Python، Backend/Frontend = Node.js! 🎯**
