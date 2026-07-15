/**
 * Beyond Presence SDK Wrapper
 * 
 * ⚠️ DEPRECATED - هذا الملف لم يعد مستخدماً
 * 
 * تم استبداله بـ LiveKit Agent (apps/agent/src/agent.py)
 * LiveKit Agent يتعامل مع Beyond Presence مباشرة
 * 
 * تم الاحتفاظ بهذا الملف فقط للتوثيق
 * يمكن حذفه بأمان إذا لم يكن مستخدماً في أي مكان آخر
 */

class BeyondPresenceSDK {
    constructor(config) {
        console.warn('⚠️ BeyondPresenceSDK is deprecated - use LiveKit Agent instead');
        throw new Error('BeyondPresenceSDK is deprecated. Use LiveKit Agent (apps/agent/src/agent.py) instead.');
    }

    async start() {
        throw new Error('BeyondPresenceSDK is deprecated. Use LiveKit Agent instead.');
    }

    async stop() {
        throw new Error('BeyondPresenceSDK is deprecated. Use LiveKit Agent instead.');
    }

    sendAudio(audioData) {
        throw new Error('BeyondPresenceSDK is deprecated. Use LiveKit Agent instead.');
    }
}

export default BeyondPresenceSDK;
