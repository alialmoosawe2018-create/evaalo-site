# 🔧 حل مشكلة: Port 5000 مستخدم

## المشكلة
```
❌ Uncaught Exception: Error: listen EADDRINUSE: address already in use 0.0.0.0:5000
```

هذا يعني أن **Backend يعمل بالفعل** على البورت 5000.

---

## ✅ الحل السريع

### 1. إيقاف العملية المستخدمة للبورت 5000

```powershell
# ابحث عن العملية
netstat -ano | findstr :5000

# ستجد شيئاً مثل:
# TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    12345
#                      ↑ هذا هو PID

# أوقف العملية (استبدل 12345 بـ PID الفعلي)
taskkill /PID 12345 /F
```

### 2. أو استخدام Command واحد:

```powershell
# أوقف جميع Node.js processes
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process tsx -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 🎯 المهم: Agent ≠ npm!

### ❌ خطأ شائع:
```powershell
cd apps/avatar-evaalov2
npm run dev  # ❌ خطأ! Agent ليس Node.js
```

### ✅ الصحيح:
```powershell
cd apps/avatar-evaalov2
uv run python src/agent.py dev  # ✅ Python!
```

---

## 📋 الترتيب الصحيح

### 1. Agent (Python) - Terminal 1
```powershell
cd apps/avatar-evaalov2
.\run_agent.ps1
```

### 2. Backend (Node.js) - Terminal 2
```powershell
cd apps/backend
npm run dev
```

### 3. Frontend (Node.js) - Terminal 3
```powershell
cd apps/frontend
npm run dev
```

---

## 🔍 التحقق من الحالة

### Agent (يجب أن يعمل أولاً):
```powershell
# يجب أن ترى:
🚀 Starting LiveKit Agent...
✅ Beyond Presence client initialized
```

### Backend:
```powershell
# يجب أن ترى:
✅ Connected to MongoDB successfully
Server running on port 5000
```

### Frontend:
```powershell
# يجب أن ترى:
VITE ready in ...
Local: http://localhost:3000
```

---

**الآن كل شيء يجب أن يعمل! 🎉**
