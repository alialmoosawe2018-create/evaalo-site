# تحليل المشكلة الجذرية

## المشكلة الحالية:

من Logs:
1. ✅ Frontend يتصل بنجاح
2. ✅ Agent ينشر audio track
3. ✅ Frontend يشترك في audio track
4. ❌ **Audio track يُلغى الاشتراك مباشرة** (`Track UNSUBSCRIBED`)
5. ❌ **Agent Session يُغلق** (`session closed, reason: "user_initiated"`)

## السبب الجذري:

### من Logs السابقة من Agent:
```
✅ Agent started for room: room-...
✅ Connected to LiveKit room
✅ Participant connected
✅ Avatar video track published
📊 Published tracks after agent start: 2
  - Track: avatar, kind: video
  - Track: roomio_audio, kind: audio
...
2026-01-11 ... session closed {"reason": "user_initiated"}
✅ Agent finished
```

**السبب:** Agent Session يُغلق مباشرة بعد بدء Frontend، مما يسبب:
1. إلغاء الاشتراك في audio track
2. إغلاق Agent Session
3. Frontend يفقد الاتصال

## لماذا Agent Session يُغلق؟

من الوثائق:
> By default, a room is automatically closed when the last non-agent participant leaves.

**السبب المحتمل:**
- Agent يعتبر أن Frontend لم يتصل بعد
- أو Frontend يتصل لكن Agent Session يُغلق قبل أن يكتمل الاتصال
- أو هناك race condition بين Frontend connection و Agent Session

## الحل:

### 1. Agent يجب أن ينتظر حتى Frontend يكتمل الاتصال

في `agent.py`، يجب:
- انتظار حتى Frontend يتصل بالكامل
- انتظار حتى Frontend ينشر tracks
- عدم إغلاق Session مبكراً

### 2. Frontend يجب أن يتصل قبل Agent

**الترتيب الصحيح:**
1. ✅ Frontend يتصل أولاً
2. ✅ Frontend ينشر tracks
3. ✅ Agent يبدأ Session
4. ✅ Agent ينشر tracks
5. ✅ كل شيء يعمل

**الترتيب الخاطئ (الحالي):**
1. ❌ Agent يبدأ Session أولاً
2. ❌ Agent ينشر tracks
3. ❌ Frontend يتصل بعد ذلك
4. ❌ Agent Session يُغلق (لأن Frontend لم يتصل بعد)
5. ❌ Frontend يفقد الاتصال

## الحل المطلوب:

### في Agent (`agent.py`):
- إضافة logic للانتظار حتى Frontend يكتمل الاتصال
- عدم إغلاق Session مبكراً
- التحقق من أن Frontend متصل قبل بدء Session

### في Frontend:
- التأكد من الاتصال قبل تشغيل Agent
- نشر tracks قبل تشغيل Agent

## الخلاصة:

**المشكلة:** Agent Session يُغلق مباشرة لأن Frontend لم يتصل بعد عندما Agent يبدأ Session.

**الحل:** 
1. شغّل Frontend أولاً
2. ابدأ مقابلة في Frontend
3. انتظر حتى Frontend يتصل بالكامل
4. **بعد ذلك** شغّل Agent

أو:

إضافة logic في Agent للانتظار حتى Frontend يكتمل الاتصال قبل بدء Session.
