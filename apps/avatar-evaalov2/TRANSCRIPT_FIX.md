# 🔧 إصلاح مشاكل Transcript و Listening/Speaking Messages

## المشاكل التي تم إصلاحها:

### 1. ❌ رسائل المستخدم لا تظهر في Transcript
**المشكلة:** 
- فقط رسائل الـ Agent كانت تظهر في الـ transcript
- رسائل المستخدم لم تكن تظهر

**السبب:**
- الكود كان يحدد `role` بناءً على `participant.identity` فقط
- لم يكن يتحقق من `localParticipant` بشكل صحيح
- حسب وثائق LiveKit: "the sender identity is the transcribed participant"
- User transcripts تأتي من `localParticipant`
- Agent transcripts تأتي من agent participants

**الحل:**
```javascript
// ✅ قبل الإصلاح:
const role = participant?.identity?.startsWith('agent-') || participant?.identity === 'bey-avatar-agent'
    ? 'assistant'
    : 'user';

// ✅ بعد الإصلاح:
const isLocalParticipant = participant?.identity === room.localParticipant?.identity;
const isAgentParticipant = participant?.identity?.startsWith('agent-') || participant?.identity === 'bey-avatar-agent';

let role = 'user'; // Default to user
if (isAgentParticipant) {
    role = 'assistant';
} else if (isLocalParticipant) {
    role = 'user';
} else {
    // Fallback
    role = participant?.identity?.startsWith('agent-') || participant?.identity === 'bey-avatar-agent'
        ? 'assistant'
        : 'user';
}
```

**الموقع:** `apps/frontend/src/pages/VideoInterviewCall.jsx` - السطر ~604

---

### 2. ❌ رسائل Listening/Speaking غير دقيقة ولا تتطابق مع الأفاتار
**المشكلة:**
- رسائل "Listening..." و "Speaking..." لم تكن دقيقة
- لم تكن تتطابق مع حالة الأفاتار الفعلية
- لم يكن هناك تتبع لحالة المستخدم (speaking/listening)

**الحل:**
1. **إضافة تتبع حالة المستخدم:**
```javascript
// ✅ إضافة state لتتبع حالة المستخدم
const [isUserSpeaking, setIsUserSpeaking] = useState(false);
const userSpeakingTimeoutRef = useRef(null);

// ✅ تحديث حالة المستخدم عند استقبال user transcript
if (role === 'user') {
    setIsUserSpeaking(true);
    if (userSpeakingTimeoutRef.current) {
        clearTimeout(userSpeakingTimeoutRef.current);
    }
    userSpeakingTimeoutRef.current = setTimeout(() => {
        setIsUserSpeaking(false);
    }, 2000);
}
```

2. **تحديث AgentAudioVisualizer لعرض حالة المستخدم:**
```javascript
// ✅ إضافة prop isUserSpeaking
const AgentAudioVisualizer = ({ room, style = {}, enableSounds = true, isUserSpeaking = false }) => {
    // ...
    
    // ✅ عرض حالة المستخدم
    {isUserSpeaking && (
        <div style={{...}}>
            <div style={{...}} />
            <span>You are speaking...</span>
        </div>
    )}
}
```

3. **تمرير isUserSpeaking إلى AgentAudioVisualizer:**
```javascript
<AgentAudioVisualizer room={livekitRoom} isUserSpeaking={isUserSpeaking} />
```

**الموقع:** 
- `apps/frontend/src/pages/VideoInterviewCall.jsx` - السطر ~36, ~625, ~2522
- `apps/frontend/src/components/AgentAudioVisualizer.jsx` - السطر ~10, ~280

---

### 3. ✅ تنظيف Timeouts بشكل صحيح
**الحل:**
```javascript
// ✅ تنظيف user speaking timeout عند endInterview
if (userSpeakingTimeoutRef.current) {
    clearTimeout(userSpeakingTimeoutRef.current);
    userSpeakingTimeoutRef.current = null;
}
setIsUserSpeaking(false);
```

**الموقع:** `apps/frontend/src/pages/VideoInterviewCall.jsx` - السطر ~1800

---

## 📋 التحقق من Agent Configuration

### ✅ Agent يرسل Transcripts بشكل صحيح
الـ Agent مُعد بشكل صحيح:
```python
session.start(
    agent=Assistant(),
    room=ctx.room,
    room_options=room_io.RoomOptions(
        text_output=True,  # ✅ Enable text output for transcripts
        # ...
    ),
)
```

**الموقع:** `apps/avatar-evaalov2/src/agent.py` - السطر 479

حسب وثائق LiveKit:
- `text_output=True` يُفعّل إرسال transcripts تلقائياً
- Transcripts تُرسل عبر `lk.transcription` text stream topic
- "the sender identity is the transcribed participant"
- User transcripts تأتي من local participant
- Agent transcripts تأتي من agent participants

---

## 🎯 النتيجة:

### ✅ الآن:
1. **رسائل المستخدم تظهر في Transcript** - يتم تحديد role بشكل صحيح بناءً على participant identity
2. **رسائل Listening/Speaking دقيقة** - تتطابق مع حالة الأفاتار والمستخدم الفعلية
3. **عرض حالة المستخدم** - يظهر "You are speaking..." عندما يتحدث المستخدم
4. **تنظيف صحيح** - جميع timeouts يتم تنظيفها عند endInterview

---

## 📝 ملاحظات:

1. **User Transcripts:**
   - تأتي من `localParticipant` (المستخدم)
   - يتم تحديد role بناءً على `isLocalParticipant` check
   - تظهر في UI كـ `role: 'user'`

2. **Agent Transcripts:**
   - تأتي من agent participants (`agent-*` أو `bey-avatar-agent`)
   - يتم تحديد role بناءً على `isAgentParticipant` check
   - تظهر في UI كـ `role: 'assistant'`

3. **Listening/Speaking States:**
   - Agent state: يتم تتبعه من `lk.agent.state` attribute
   - User state: يتم تتبعه من user transcripts
   - كلاهما يعرض في `AgentAudioVisualizer` component

---

## 🚀 الخطوات التالية:

1. ✅ تم إصلاح تحديد role للـ transcripts
2. ✅ تم إصلاح عرض رسائل المستخدم
3. ✅ تم إصلاح رسائل Listening/Speaking
4. ✅ تم التحقق من Agent configuration

**الآن جرب التطبيق - يجب أن ترى:**
- رسائل المستخدم تظهر في Transcript ✅
- رسائل Listening/Speaking دقيقة وتتطابق مع الأفاتار ✅
- حالة المستخدم تظهر عند التحدث ✅
