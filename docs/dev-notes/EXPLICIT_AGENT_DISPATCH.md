# التوزيع الصريح للوكيل (Explicit Agent Dispatch)

## نظرة عامة

تم تطبيق **Explicit Agent Dispatch** في نظام المقابلات بالفيديو لتحسين التحكم في الوكلاء وإرسال البيانات.

## الفوائد الرئيسية

### 1. إرسال Metadata مباشرة للـ Agent
- يمكن إرسال `candidate_id`, `session_id`, `position`, وغيرها مباشرة للـ Agent
- الـ Agent يمكنه الوصول لهذه البيانات من `ctx.job.metadata`

### 2. تحكم أفضل في التوقيت
- لا حاجة لانتظار 2 ثانية للتأكد من بدء الـ Agent
- الـ Agent ينضم للغرفة فوراً عند الطلب

### 3. إدارة أفضل
- Agent واحد يعمل كخدمة (service) بدلاً من عمليات متعددة
- لا حاجة لـ `spawn` أو إدارة عمليات منفصلة

### 4. أداء أفضل
- لا حاجة لإنشاء process جديد لكل room
- Agent server واحد يدير جميع الـ rooms

## التغييرات المطبقة

### 1. تحديث `agent.py`
```python
@server.rtc_session(agent_name="video-interview-agent")
async def my_agent(ctx: JobContext):
    # Parse metadata
    metadata = {}
    if ctx.job and ctx.job.metadata:
        import json
        metadata = json.loads(ctx.job.metadata)
```

### 2. إضافة `dispatchAgentToRoom` في `livekitService.ts`
```typescript
export async function dispatchAgentToRoom(
    roomName: string,
    metadata?: Record<string, any>,
    agentName: string = 'video-interview-agent'
): Promise<void>
```

### 3. تحديث `videoInterview.ts`
- استبدال `startAgent()` بـ `dispatchAgentToRoom()`
- إرسال metadata مع كل dispatch

## كيفية الاستخدام

### 1. تشغيل Agent Server

يجب تشغيل Agent Server **مرة واحدة** كخدمة:

```bash
cd apps/avatar-evaalov2
uv run python src/agent.py dev
```

**ملاحظة مهمة**: Agent Server يجب أن يعمل **قبل** إنشاء أي room. لا حاجة لتشغيل agent منفصل لكل room.

### 2. إرسال Agent إلى Room

عند إنشاء room جديد، يتم إرسال Agent تلقائياً:

```typescript
await dispatchAgentToRoom(roomName, {
    candidate_id: candidateId,
    session_id: sessionId,
    position: candidate.positionAppliedFor,
    candidate_name: candidateName,
});
```

### 3. الوصول إلى Metadata في Agent

في `agent.py`، يمكن الوصول للـ metadata:

```python
metadata = {}
if ctx.job and ctx.job.metadata:
    import json
    metadata = json.loads(ctx.job.metadata)
    
# استخدام metadata
candidate_id = metadata.get('candidate_id')
session_id = metadata.get('session_id')
position = metadata.get('position')
```

## الفرق بين الطريقة القديمة والجديدة

### الطريقة القديمة (Automatic Dispatch)
- ❌ تشغيل process منفصل لكل room
- ❌ انتظار 2 ثانية للتأكد من البدء
- ❌ لا يمكن إرسال metadata
- ❌ إدارة معقدة للعمليات

### الطريقة الجديدة (Explicit Dispatch)
- ✅ Agent server واحد يدير جميع الـ rooms
- ✅ إرسال فوري بدون انتظار
- ✅ إرسال metadata مباشرة
- ✅ إدارة بسيطة ومركزية

## ملاحظات مهمة

1. **Agent Server يجب أن يعمل دائماً**: Agent Server يجب أن يكون قيد التشغيل قبل إنشاء أي room.

2. **agent_name ثابت**: اسم الـ Agent هو `"video-interview-agent"` ويجب أن يطابق الاسم في `@server.rtc_session(agent_name="...")`.

3. **Metadata هو JSON string**: LiveKit يتوقع metadata كـ JSON string، لكن الدالة `dispatchAgentToRoom` تأخذ object وتحوله تلقائياً.

4. **Room يتم إنشاؤه تلقائياً**: إذا لم يكن Room موجوداً، LiveKit ينشئه تلقائياً عند dispatch.

## استكشاف الأخطاء

### Agent لا ينضم للغرفة
- تأكد من أن Agent Server يعمل: `cd apps/avatar-evaalov2 && uv run python src/agent.py dev`
- تحقق من أن `agent_name` في `agent.py` يطابق الاسم المستخدم في `dispatchAgentToRoom`

### Metadata غير متاحة
- تأكد من أن `ctx.job.metadata` موجود
- تحقق من أن metadata هو JSON string صحيح

### خطأ في API
- تحقق من `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- تأكد من أن LiveKit Server يدعم Agent Dispatch API

## الملفات المعدلة

1. `apps/avatar-evaalov2/src/agent.py` - إضافة `agent_name` وقراءة metadata
2. `apps/backend/src/services/livekitService.ts` - إضافة `dispatchAgentToRoom`
3. `apps/backend/src/routes/videoInterview.ts` - استخدام `dispatchAgentToRoom` بدلاً من `startAgent`
