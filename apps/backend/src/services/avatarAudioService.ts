// ============================================
// ملف: services/avatarAudioService.ts
// الوظيفة: إرسال الصوت إلى Python Agent (AvatarSession)
// ============================================

import WebSocket from 'ws';

// ✅ PRODUCTION FIX: لا localhost في Production
// Beyond Presence Avatar audio socket - يجب أن يكون endpoint حقيقي
const AVATAR_WS_URL = process.env.AVATAR_WS_URL || process.env.BEYOND_PRESENCE_AUDIO_ENDPOINT?.replace('https://', 'wss://').replace('http://', 'ws://') || 'ws://localhost:8765/ws/avatar-audio';

// Map لتخزين WebSocket connections لكل session
const avatarWsConnections = new Map<string, WebSocket>();

// ✅ PRODUCTION FIX: تتبع حالة AvatarSession لكل session
// AvatarSession هو owner للصوت - لا نرسل إذا كان غير متصل
const avatarSessionStates = new Map<string, {
    isConnected: boolean;
    lastError?: Error;
    errorCount: number;
}>();

// ✅ PRODUCTION FIX: حد أقصى للأخطاء قبل التوقف
const MAX_AVATAR_ERRORS = 3; // 3 أخطاء متتالية = توقف إرسال

/**
 * ✅ PRODUCTION FIX: تعيين حالة AvatarSession (متصل/منقطع)
 * يجب استدعاء هذا من Agent عند بدء/إغلاق AvatarSession
 */
export function setAvatarSessionState(sessionId: string, isConnected: boolean): void {
    const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
    state.isConnected = isConnected;
    if (isConnected) {
        state.errorCount = 0; // إعادة تعيين عند الاتصال
        state.lastError = undefined;
    }
    avatarSessionStates.set(sessionId, state);
    console.log(`ℹ️ AvatarSession state updated for ${sessionId.substring(0, 8)}...: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
}

/**
 * ✅ PRODUCTION FIX: التحقق من حالة AvatarSession
 */
function isAvatarSessionConnected(sessionId: string): boolean {
    const state = avatarSessionStates.get(sessionId);
    return state?.isConnected === true;
}

/**
 * إرسال الصوت إلى Python Agent (AvatarSession)
 * 
 * ✅ PRODUCTION FIX: لا نرسل إذا AvatarSession غير متصل
 * ✅ PRODUCTION FIX: Drop chunks بدلاً من retry عند ECONNREFUSED
 * 
 * @param sessionId - Session ID
 * @param audioBuffer - Audio buffer (MP3 from TTS)
 */
export async function sendAudioToAvatar(
    sessionId: string,
    audioBuffer: Buffer
): Promise<void> {
    // ✅ PRODUCTION FIX: لا نرسل إذا AvatarSession غير متصل
    // ملاحظة: عند أول استدعاء، قد تكون الحالة غير محددة - نسمح بالمحاولة الأولى
    const state = avatarSessionStates.get(sessionId);
    
    // ✅ PRODUCTION FIX: Circuit Breaker - توقف بعد 3 أخطاء متتالية
    if (state && state.errorCount >= MAX_AVATAR_ERRORS) {
        console.warn(`⚠️ PRODUCTION FIX: Dropping audio chunk - AvatarSession error limit reached (${state.errorCount}/${MAX_AVATAR_ERRORS}) for session: ${sessionId.substring(0, 8)}...`);
        return; // Drop - لا نرمي error
    }
    
    if (state && !state.isConnected && state.errorCount > 0) {
        // Drop chunk فوراً - لا retry (AvatarSession غير متصل بعد أخطاء سابقة)
        // ✅ PRODUCTION FIX: Log مرة واحدة فقط (لا spam)
        if (state.errorCount === MAX_AVATAR_ERRORS) {
            console.warn(`⚠️ PRODUCTION FIX: Dropping audio chunks - AvatarSession not connected (error limit reached) for session: ${sessionId.substring(0, 8)}...`);
        }
        return; // Drop - لا نرمي error
    }

    try {
        // الحصول على أو إنشاء WebSocket connection
        let ws = avatarWsConnections.get(sessionId);
        
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            // ✅ PRODUCTION FIX: لا localhost في Production
            if (AVATAR_WS_URL.includes('localhost') || AVATAR_WS_URL.includes('127.0.0.1') || AVATAR_WS_URL.includes('::1')) {
                console.warn(`⚠️ PRODUCTION FIX: AVATAR_WS_URL uses localhost (${AVATAR_WS_URL}) - should use real Beyond Presence endpoint`);
            }
            
            // إنشاء WebSocket connection جديد
            console.log(`🔌 Connecting to Avatar WebSocket for session: ${sessionId.substring(0, 8)}... (URL: ${AVATAR_WS_URL})`);
            
            ws = new WebSocket(AVATAR_WS_URL);
            
            ws.on('open', () => {
                console.log(`✅ Avatar WebSocket connected for session: ${sessionId.substring(0, 8)}...`);
                // ✅ PRODUCTION FIX: تحديث الحالة عند الاتصال الناجح
                const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
                state.isConnected = true;
                state.errorCount = 0;
                state.lastError = undefined;
                avatarSessionStates.set(sessionId, state);
                console.log(`✅ PRODUCTION FIX: AvatarSession marked as CONNECTED for session: ${sessionId.substring(0, 8)}...`);
            });
            
            ws.on('error', (error) => {
                console.error(`❌ Avatar WebSocket error for session ${sessionId.substring(0, 8)}...:`, error);
                // ✅ PRODUCTION FIX: تحديث الحالة عند الخطأ
                const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
                state.isConnected = false;
                state.lastError = error as Error;
                state.errorCount++;
                avatarSessionStates.set(sessionId, state);
                avatarWsConnections.delete(sessionId);
            });
            
            ws.on('close', () => {
                console.log(`🔌 Avatar WebSocket closed for session: ${sessionId.substring(0, 8)}...`);
                // ✅ PRODUCTION FIX: تحديث الحالة عند الإغلاق
                const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
                state.isConnected = false;
                avatarSessionStates.set(sessionId, state);
                avatarWsConnections.delete(sessionId);
            });
            
            // انتظار الاتصال
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                }, 5000);
                
                ws!.on('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                ws!.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
            
            avatarWsConnections.set(sessionId, ws);
        }
        
        // إرسال الصوت
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(audioBuffer, { binary: true });
            // ✅ PRODUCTION FIX: Log أقل (كل 50 chunk فقط)
            const state = avatarSessionStates.get(sessionId);
            if (!state || (state.errorCount === 0 && Math.random() < 0.02)) { // 2% من الوقت
                console.log(`✅ Audio sent to Avatar (${audioBuffer.length} bytes) for session: ${sessionId.substring(0, 8)}...`);
            }
            // ✅ PRODUCTION FIX: إعادة تعيين error count عند نجاح
            if (state) {
                state.errorCount = 0;
            }
        } else {
            throw new Error('WebSocket is not open');
        }
    } catch (error: any) {
        // ✅ PRODUCTION FIX: ECONNREFUSED = Drop (لا retry)
        if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
            const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
            state.isConnected = false;
            state.errorCount++;
            state.lastError = error;
            avatarSessionStates.set(sessionId, state);
            
            // ✅ PRODUCTION FIX: Log مرة واحدة فقط (لا spam)
            if (state.errorCount === 1) {
                console.error(`❌ PRODUCTION FIX: Avatar WebSocket connection refused (ECONNREFUSED) - dropping chunks for session: ${sessionId.substring(0, 8)}...`);
                console.error(`   URL: ${AVATAR_WS_URL}`);
                console.error(`   Reason: AvatarSession not listening or endpoint incorrect`);
            }
            
            // Drop chunk - لا نرمي error (لا retry)
            avatarWsConnections.delete(sessionId);
            return; // Drop - لا نرمي error
        }
        
        // ✅ PRODUCTION FIX: أخطاء أخرى - تحديث الحالة و drop
        console.error(`❌ Error sending audio to Avatar:`, error);
        const state = avatarSessionStates.get(sessionId) || { isConnected: false, errorCount: 0 };
        state.isConnected = false;
        state.errorCount++;
        state.lastError = error;
        avatarSessionStates.set(sessionId, state);
        
        // إزالة connection من Map في حالة الخطأ
        avatarWsConnections.delete(sessionId);
        
        // ✅ PRODUCTION FIX: Drop بدلاً من throw (لا retry)
        return; // Drop - لا نرمي error
    }
}

/**
 * إغلاق WebSocket connection لـ session معين
 * ✅ PRODUCTION FIX: تحديث الحالة عند الإغلاق
 */
export function closeAvatarConnection(sessionId: string): void {
    const ws = avatarWsConnections.get(sessionId);
    if (ws) {
        ws.close();
        avatarWsConnections.delete(sessionId);
        console.log(`🔌 Avatar WebSocket closed for session: ${sessionId.substring(0, 8)}...`);
    }
    
    // ✅ PRODUCTION FIX: تحديث الحالة عند الإغلاق
    setAvatarSessionState(sessionId, false);
    avatarSessionStates.delete(sessionId);
}

/**
 * ✅ PRODUCTION FIX: التحقق من وجود AvatarSession connection
 */
export function hasAvatarConnection(sessionId: string): boolean {
    return isAvatarSessionConnected(sessionId);
}
