# الحل البسيط - جعل الصوت يعمل فقط

## المشكلة:

من Logs:
```
session closed {"reason": "user_initiated"}
```

**Session يُغلق مباشرة بعد 2-3 ثوان.**

## الحل البسيط:

### الطريقة الصحيحة للتشغيل:

1. **شغّل Backend:**
```powershell
cd cursor-react/apps/backend
npm run dev
```

2. **شغّل Frontend:**
```powershell
cd cursor-react/apps/frontend
npm run dev
```

3. **شغّل Agent (قبل فتح Frontend في المتصفح!):**
```powershell
cd cursor-react/apps/agent
python src/agent.py dev
```

**انتظر حتى ترى:**
```
INFO livekit.agents - registered worker
```

4. **افتح Frontend في المتصفح:**
- اذهب إلى: `http://localhost:3000`
- اضغط على "Start Interview"

**الآن يجب أن يعمل الصوت من ElevenLabs!**

---

## إذا لا يزال لا يعمل:

### تحقق من:

1. **Agent يجب أن يكون في standby قبل Frontend يتصل:**
   - شغّل Agent أولاً
   - انتظر حتى ترى: `registered worker`
   - ثم افتح Frontend

2. **Agent يجب أن يبدأ job:**
   - يجب أن ترى: `Agent started for room: room-...`
   - يجب أن ترى: `AgentSession started successfully`

3. **Frontend يجب أن يشترك في audio track:**
   - في Browser Console
   - يجب أن ترى: `Track subscribed: audio from agent-...`

---

## الخلاصة:

**الترتيب الصحيح:**
1. Backend
2. Frontend (server)
3. **Agent (قبل فتح Frontend!)**
4. Frontend (browser) → Start Interview

**الآن يجب أن يعمل الصوت!** ✅
