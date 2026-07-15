# خطة إصلاح الأيجنت والكونسول

## التعديلات المنفذة

### 1. الفرونت إند – مصدر واحد للمايك والصوت (agentState)

**المشكلة:** ثلاثة مصادر كانت تتحكم بالمايك (TrackSubscribed، TrackUnsubscribed، transcript) مما أدى لتعارض وعدم التقاط كلام المستخدم.

**الحل:** الاعتماد على `agentState` فقط:
- `speaking`: تعطيل المايك، تفعيل الصوت
- `listening` / `thinking` / `initializing`: تفعيل المايك

**الملف:** `apps/frontend/src/pages/VideoInterviewCall.jsx`
- إزالة التحكم بالمايك من TrackSubscribed
- إزالة التحكم بالمايك من TrackUnsubscribed
- تبسيط معالج transcript (فقط تفعيل الصوت عند assistant، بدون تغيير المايك)

### 2. الفرونت إند – منع إعادة ربط الفيديو 3 مرات

**المشكلة:** نفس الـ video track كان يُربط من 3 مسارات (ref callback، attachVideoIfAvailable، pendingVideoTrack).

**الحل:** استخدام `videoTrackAttachedRef`:
- تخطي الربط إذا `videoTrackAttachedRef.current === true`
- تعيين `true` بعد الربط الناجح
- إعادة تعيينه عند TrackUnsubscribed (فيديو) وعند endInterview

### 3. الأيجنت – تحسين اللوقز

**الملف:** `apps/avatar-evaalov2/src/agent.py`
- تغيير `Transcript:` إلى `Transcript [user]:` لتمييز transcripts المستخدم

### 4. تنظيف agentSpeakingTimeoutRef

- الإبقاء على تنظيف `agentSpeakingTimeoutRef` في endInterview (للتوافق)
- لم يعد يُستخدم في المنطق الجديد

---

## اللوقز المتوقعة بعد الإصلاح

### كونسول الفرونت إند
```
🎤 [agentState] Mic enabled - Agent listening/thinking
🎤 [agentState] Mic disabled - Agent speaking
🔊 [agentState] Audio enabled - Agent speaking
✅ [Video] Attaching pending track (once)
```

### لوقز الأيجنت
```
Transcript [user]: <نص المستخدم>
```

---

## التحقق

1. تشغيل المقابلة والتحدث بعد التحية
2. التأكد من ظهور `Transcript [user]:` في لوقز الأيجنت
3. التأكد من عدم وميض أو انهيار الأفاتار
4. التأكد من ظهور `🎤 [agentState] Mic enabled` عند listening
