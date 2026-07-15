# 🔧 إصلاح: Agent لا يظهر في LiveKit Room

## ❌ المشكلة:

```
⏳ Waiting for Agent or Avatar to connect... (check 60/60)
⚠️ Agent or Avatar not found after 60 checks (30s)
```

## ✅ الحلول:

### 1️⃣ **تأكد أن Agent Server يعمل**

```powershell
cd apps/avatar-evaalov2
.\START_AGENT.ps1
```

**يجب أن ترى:**
```
✅ Connected to LiveKit Room
✅ AgentSession started with STT enabled
```

### 2️⃣ **تأكد أن Agent يستخدم الاسم الصحيح**

**في `agent.py`:**
```python
@server.rtc_session(agent_name="video-interview-agent")
```

**في Backend:**
```typescript
agentName: string = 'video-interview-agent'
```

### 3️⃣ **تحقق من LiveKit Credentials**

**في `apps/avatar-evaalov2/.env.local`:**
```env
LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud
LIVEKIT_API_KEY=APIPfHsukAntKDq
LIVEKIT_API_SECRET=GDCBeJv6X8Tfz7qweeQZF1oBUukejh2JEnFwXOwsrMaA
```

**يجب أن تكون نفس القيم في Backend و Agent!**

### 4️⃣ **تحقق من Backend Logs**

**يجب أن ترى:**
```
🚀 Dispatching Agent to room: room-video-interview-...
   - Agent name: video-interview-agent ✅
✅ Agent dispatched successfully with metadata
```

**إذا رأيت خطأ:**
```
⚠️ Agent Dispatch API failed: 401 Unauthorized
```
**المشكلة:** LiveKit credentials غير صحيحة أو غير متطابقة

### 5️⃣ **تحقق من Agent Logs**

**يجب أن ترى:**
```
🔌 Connecting to LiveKit Room...
✅ Connected to LiveKit Room
🎭 Starting Beyond Presence Avatar Session...
✅ Avatar Session started
```

**إذا رأيت خطأ:**
```
❌ LIVEKIT_API_KEY is not set in .env.local
```
**الحل:** أضف المتغيرات إلى `.env.local`

---

## 🔍 خطوات التشخيص:

### 1. تحقق من Agent Server:
```powershell
# في Terminal منفصل
cd apps/avatar-evaalov2
uv run python src/agent.py dev
```

### 2. تحقق من Backend:
```bash
# في Terminal منفصل
cd apps/backend
npm run dev
```

### 3. تحقق من Frontend Console:
- افتح Developer Tools (F12)
- ابحث عن: `🚀 Dispatching Agent to room`
- ابحث عن: `✅ Agent dispatched successfully`

### 4. تحقق من Agent Logs:
- ابحث عن: `✅ Connected to LiveKit Room`
- ابحث عن: `✅ Avatar Session started`

---

## ⚠️ مشاكل شائعة:

### المشكلة 1: Agent Server غير مشغل
**الحل:** شغّل Agent Server أولاً

### المشكلة 2: Agent name غير متطابق
**الحل:** تأكد أن `agent_name` في `agent.py` يطابق `agentName` في Backend

### المشكلة 3: LiveKit credentials غير متطابقة
**الحل:** تأكد أن نفس القيم في Backend و Agent `.env.local`

### المشكلة 4: Agent يتصل لكن لا يظهر
**الحل:** تحقق من أن AvatarSession بدأ بنجاح

---

## ✅ التحقق من الإصلاح:

بعد إصلاح المشاكل، يجب أن ترى:

**Frontend Console:**
```
✅ Published audio track to LiveKit - Agent can now listen
🤖 Agent participant connected: agent-...
🎥 VIDEO TRACK PUBLISHED FROM AGENT
```

**Agent Logs:**
```
✅ Connected to LiveKit Room
✅ AgentSession started with STT enabled
✅ Avatar Session started
```

**Backend Logs:**
```
✅ Agent dispatched successfully with metadata
```
