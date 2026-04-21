// ============================================
// ملف: routes/videoInterview.ts
// الوظيفة: Routes للمقابلة بالفيديو
// ============================================

import express from 'express';
import Candidate from '../models/Candidate.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import { transcribeAudio } from '../services/sttService.js';
import { createLiveKitRoom, createUserToken, dispatchAgentToRoom } from '../services/livekitService.js';
import { stopAgent } from '../services/agentService.js';
import { sendVideoTranscriptToN8N } from '../services/n8nService.js';

const router = express.Router();

/**
 * ✅ FIX: منع إنشاء غرفتين لنفس المرشح في نفس الوقت (يسبب أفاتار غير مستقر)
 * يُحذف عند /end أو بعد 5 دقائق
 */
const activeCandidateSessions = new Map<string, {
    roomName: string;
    token: string;
    sessionId: string;
    createdAt: number;
}>();

const ACTIVE_SESSION_TTL_MS = 5 * 60 * 1000; // 5 دقائق

function cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [candidateId, data] of activeCandidateSessions.entries()) {
        if (now - data.createdAt > ACTIVE_SESSION_TTL_MS) {
            activeCandidateSessions.delete(candidateId);
        }
    }
}

/** Stable key for agent question bank — must match JSON keys in voice_interview/data/interview_questions.json */
function slugForJobQuestions(position: string | undefined | null): string {
    if (!position || typeof position !== 'string') return '';
    const t = position.trim();
    if (!t || t.toUpperCase() === 'N/A') return '';
    return t
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9\u0600-\u06ff-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * POST /api/video-interview/prepare
 * إعداد Room و Agent مسبقاً قبل بدء المقابلة
 */
router.post('/prepare', async (req, res) => {
    try {
        const { candidateId, jobId: prepareJobId } = req.body as {
            candidateId?: string;
            jobId?: string;
        };

        if (!candidateId) {
            return res.status(400).json({
                success: false,
                message: 'candidateId is required'
            });
        }

        // إنشاء Room مسبقاً
        const sessionId = `prepared-room-${candidateId}-${Date.now()}`;
        let livekitRoomName = null;
        let livekitToken = null;

        if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
            try {
                livekitRoomName = await createLiveKitRoom(sessionId);
                
                // ✅ FIX: إعداد metadata للـ Agent (أسئلة الوكيل تُحمّل من ملف حسب job_id فقط)
                const metadata: Record<string, string> = {
                    candidate_id: candidateId,
                    session_id: sessionId,
                    position: 'N/A',  // prepare لا يجلب candidate - يُحدد لاحقاً في start
                };
                if (typeof prepareJobId === 'string' && prepareJobId.trim()) {
                    metadata.job_id = prepareJobId.trim();
                }
                
                // ✅ FIX: إضافة Agent dispatch مباشرة في Token
                livekitToken = await createUserToken(livekitRoomName, `user-${candidateId}`, metadata);
                
                if (typeof livekitToken !== 'string') {
                    throw new Error('Invalid LiveKit token: must be a string');
                }

                console.log(`✅ Prepared LiveKit room: ${livekitRoomName}`, {
                    explicitDispatch: true
                });

                // ✅ EXPLICIT DISPATCH: إرسال Agent عبر API (Explicit Dispatch)
                try {
                    console.log(`🚀 Dispatching Agent via API (Explicit Dispatch): ${livekitRoomName}`);
                    await dispatchAgentToRoom(livekitRoomName, metadata);
                } catch (agentError: any) {
                    console.error('❌ Failed to dispatch Agent via API:', agentError.message);
                    // هذا خطأ حرج - Agent لن ينضم للغرفة بدون explicit dispatch
                    throw new Error(`Failed to dispatch agent: ${agentError.message}`);
                }
            } catch (error: any) {
                console.error('⚠️ Failed to prepare LiveKit room:', error.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to prepare LiveKit room',
                    error: error.message
                });
            }
        }

        res.status(200).json({
            success: true,
            sessionId: sessionId,
            livekit: livekitRoomName && livekitToken ? {
                roomName: livekitRoomName,
                url: process.env.LIVEKIT_URL,
                token: livekitToken
            } : null
        });
    } catch (error: any) {
        console.error('Error in /prepare:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to prepare interview',
            error: error.message
        });
    }
});

/**
 * POST /api/video-interview/start
 * بدء مقابلة فيديو جديدة
 * 
 * التدفق:
 * 1. جلب بيانات المرشح من قاعدة البيانات
 * 2. إنشاء session ID
 * 3. إرجاع بيانات المرشح و session ID
 */
router.post('/start', async (req, res) => {
    try {
        const { candidateId, campaignId, jobId: bodyJobId } = req.body as {
            candidateId?: string;
            campaignId?: string;
            jobId?: string;
        };

        if (!candidateId) {
            return res.status(400).json({
                success: false,
                message: 'candidateId is required'
            });
        }

        // للاختبار: إذا كان candidateId يبدأ بـ "test-" نستخدم بيانات وهمية
        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
        
        let candidate;
        if (isTestMode) {
            // بيانات وهمية للاختبار
            candidate = {
                _id: candidateId,
                full_name: 'Test Candidate',
                email: 'test@example.com',
                position_applied_for: 'Software Developer',
                skills: ['JavaScript', 'React', 'Node.js'],
                years_of_experience: '3-5 years'
            };
        } else {
            // جلب بيانات المرشح من قاعدة البيانات
            candidate = await Candidate.findById(candidateId);

            if (!candidate) {
                return res.status(404).json({
                    success: false,
                    message: 'Candidate not found'
                });
            }
        }

        // ✅ FIX: منع إنشاء غرفة ثانية لنفس المرشح خلال 2 دقيقة (يسبب أفاتار غير مستقر)
        cleanupExpiredSessions();
        const existingSession = activeCandidateSessions.get(candidateId);
        if (existingSession && (Date.now() - existingSession.createdAt) < 2 * 60 * 1000) {
            console.log(`ℹ️ Reusing existing session for candidate ${candidateId} (prevents duplicate avatar)`);
            return res.status(200).json({
                success: true,
                sessionId: existingSession.sessionId,
                candidate: {
                    id: candidate._id,
                    full_name: candidate.full_name,
                    email: candidate.email,
                    position_applied_for: candidate.position_applied_for,
                    skills: candidate.skills,
                    years_of_experience: candidate.years_of_experience
                },
                livekit: {
                    roomName: existingSession.roomName,
                    url: process.env.LIVEKIT_URL,
                    token: existingSession.token
                }
            });
        }

        // إنشاء session ID
        const sessionId = `video-interview-${candidateId}-${Date.now()}`;

        // إنشاء session جديد في قاعدة البيانات
        // في وضع الاختبار، نحفظ sessionId فقط بدون candidateId (لأنه وهمي)
        const session = new VideoInterviewSession({
            sessionId: sessionId,
            candidateId: isTestMode ? new (await import('mongoose')).Types.ObjectId() : candidate._id,
            campaignId: campaignId || undefined,
            conversationHistory: [],
            status: 'active',
            startedAt: new Date()
        });

        // في وضع الاختبار، لا نحفظ في DB (أو نحفظ بدون candidateId)
        if (!isTestMode) {
            await session.save();
        }

        // إنشاء LiveKit Room (إذا كان LiveKit مفعّل)
        let livekitRoomName = null;
        let livekitToken = null;
        
        if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
            try {
                livekitRoomName = await createLiveKitRoom(sessionId);
                
                const explicitJobId =
                    typeof bodyJobId === 'string' && bodyJobId.trim() ? bodyJobId.trim() : '';
                const inferredJobId =
                    explicitJobId || slugForJobQuestions(candidate.position_applied_for || '');
                // ✅ FIX: إعداد metadata للـ Agent — job_id يحدد بنك الأسئلة على الوكيل (بدون تمرير الأسئلة)
                const metadata: Record<string, string> = {
                    candidate_id: candidateId,
                    session_id: sessionId,
                    position: candidate.position_applied_for || 'N/A',
                    candidate_name: (candidate.full_name || '').trim() || candidate.email?.split('@')[0] || 'Unknown',
                };
                if (inferredJobId) {
                    metadata.job_id = inferredJobId;
                }
                
                // ✅ EXPLICIT DISPATCH: إنشاء Token (Agent سيتم إرساله عبر API)
                livekitToken = await createUserToken(livekitRoomName, `user-${candidateId}`, metadata);
                
                // التحقق من أن token هو string
                if (typeof livekitToken !== 'string') {
                    console.error('❌ LiveKit token is not a string:', typeof livekitToken, livekitToken);
                    throw new Error('Invalid LiveKit token: must be a string');
                }
                
                console.log(`✅ LiveKit room created for session: ${sessionId.substring(0, 8)}...`, {
                    roomName: livekitRoomName,
                    tokenType: typeof livekitToken,
                    tokenLength: livekitToken.length,
                    tokenPreview: livekitToken.substring(0, 20) + '...',
                    explicitDispatch: true
                });
                
                // ✅ EXPLICIT DISPATCH: إرسال Agent عبر API (Explicit Dispatch)
                // Agent يجب أن يكون مسجلاً بـ agent_name="video-interview-agent" في agent.py
                try {
                    console.log(`🚀 Dispatching Agent via API (Explicit Dispatch): ${livekitRoomName}`);
                    console.log(`   - Agent name: video-interview-agent ✅`);
                    await dispatchAgentToRoom(livekitRoomName, metadata);
                } catch (agentError: any) {
                    console.error('❌ Failed to dispatch Agent via API:', agentError.message);
                    // هذا خطأ حرج - Agent لن ينضم للغرفة بدون explicit dispatch
                    throw new Error(`Failed to dispatch agent: ${agentError.message}`);
                }

                // ✅ حفظ الجلسة النشطة لمنع إنشاء غرفة ثانية لنفس المرشح
                activeCandidateSessions.set(candidateId, {
                    roomName: livekitRoomName,
                    token: livekitToken,
                    sessionId,
                    createdAt: Date.now()
                });
            } catch (error: any) {
                console.warn('⚠️ Failed to create LiveKit room (non-blocking):', error.message);
                // نتابع بدون LiveKit
            }
        }

        // إرجاع البيانات
        res.status(200).json({
            success: true,
            sessionId: sessionId,
            candidate: {
                id: candidate._id,
                full_name: candidate.full_name,
                email: candidate.email,
                position_applied_for: candidate.position_applied_for,
                skills: candidate.skills,
                years_of_experience: candidate.years_of_experience
            },
            livekit: livekitRoomName && livekitToken ? {
                roomName: livekitRoomName,
                url: process.env.LIVEKIT_URL,
                token: typeof livekitToken === 'string' ? livekitToken : String(livekitToken) // تأكد من أنه string
            } : null
        });

    } catch (error: any) {
        console.error('Error in /start:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start video interview',
            error: error.message
        });
    }
});

/**
 * POST /api/video-interview/audio
 * استقبال audio chunks من الواجهة الأمامية
 * 
 * التدفق:
 * 1. استقبال audio chunk (base64)
 * 2. تحويل الصوت إلى نص (STT)
 * 3. LiveKit Agent يتعامل مع المحادثة تلقائياً
 * 4. إرجاع رسالة للمستخدم (LiveKit Agent سيرد فعلياً)
 */
router.post('/audio', async (req, res) => {
    try {
        const { audio, sessionId, candidateId } = req.body;

        // Validation
        if (!audio || !sessionId || !candidateId) {
            return res.status(400).json({
                success: false,
                message: 'audio, sessionId, and candidateId are required'
            });
        }

        // للاختبار: إذا كان candidateId يبدأ بـ "test-" نستخدم بيانات وهمية
        const isTestMode = candidateId.startsWith('test-') || candidateId === '507f1f77bcf86cd799439011';
        
        let candidate;
        if (isTestMode) {
            // بيانات وهمية للاختبار
            candidate = {
                _id: candidateId,
                full_name: 'Test Candidate',
                email: 'test@example.com',
                position_applied_for: 'Software Developer',
                skills: ['JavaScript', 'React', 'Node.js'],
                years_of_experience: '3-5 years'
            };
        } else {
            // جلب بيانات المرشح من قاعدة البيانات
            try {
                candidate = await Candidate.findById(candidateId);
                if (!candidate) {
                    return res.status(404).json({
                        success: false,
                        message: 'Candidate not found'
                    });
                }
            } catch (dbError: any) {
                console.error('❌ Database error fetching candidate:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Database error. Please try again.',
                    userSafeMessage: 'We encountered an issue. Please try again in a moment.'
                });
            }
        }

        // تحويل base64 إلى Buffer مع error handling
        let audioBuffer: Buffer;
        try {
            audioBuffer = Buffer.from(audio, 'base64');
            if (audioBuffer.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid audio data'
                });
            }
        } catch (bufferError: any) {
            console.error('❌ Error decoding audio buffer:', bufferError);
            return res.status(400).json({
                success: false,
                message: 'Invalid audio format',
                userSafeMessage: 'Could you please try speaking again?'
            });
        }

        // Step 1: تحويل الصوت إلى نص (STT)
        // STT service لديه fallback مدمج
        console.log('='.repeat(60));
        console.log('🎤 BACKEND: RECEIVED AUDIO CHUNK');
        console.log('='.repeat(60));
        console.log('   Buffer size:', audioBuffer.length, 'bytes');
        console.log('   Session ID:', sessionId.substring(0, 8) + '...');
        console.log('   Candidate ID:', candidateId.substring(0, 8) + '...');
        console.log('='.repeat(60));
        
        let userText: string;
        try {
            console.log('🔄 BACKEND: Starting STT transcription...');
            userText = await transcribeAudio(audioBuffer, 'webm');
            console.log('='.repeat(60));
            console.log('📝 BACKEND: TRANSCRIPTION RESULT');
            console.log('='.repeat(60));
            console.log('   Text length:', userText?.length || 0, 'characters');
            console.log('   Text:', userText?.substring(0, 100) || '(empty)');
            console.log('='.repeat(60));
        } catch (sttError: any) {
            console.error('❌ STT error:', sttError);
            // Fallback: إرجاع رسالة للمستخدم
            return res.status(200).json({
                success: true,
                reply: "I'm having trouble hearing you. Could you please speak more clearly?",
                transcribedText: '',
                warning: 'STT service temporarily unavailable'
            });
        }

        // إذا كان النص فارغاً، إرجاع fallback response
        if (!userText || userText.trim().length === 0) {
            console.warn('⚠️ Empty transcription - audio may be too short, silent, or unclear');
            return res.status(200).json({
                success: true,
                reply: 'Could you please repeat that? I didn\'t catch what you said.',
                transcribedText: ''
            });
        }

        // Step 2: جلب session من قاعدة البيانات (أو إنشاء وهمي في وضع الاختبار)
        let session;
        if (isTestMode) {
            // في وضع الاختبار، ننشئ session وهمي في الذاكرة
            session = {
                conversationHistory: [],
                addMessage: function(role: string, content: string) {
                    this.conversationHistory.push({
                        role: role as 'user' | 'assistant',
                        content: content,
                        timestamp: new Date()
                    });
                },
                save: async function() {
                    // في وضع الاختبار، لا نحفظ في DB
                    return Promise.resolve();
                }
            };
        } else {
            try {
                session = await VideoInterviewSession.findOne({ sessionId: sessionId });
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        message: 'Session not found',
                        userSafeMessage: 'Your interview session has expired. Please start a new interview.'
                    });
                }
            } catch (sessionError: any) {
                console.error('❌ Database error fetching session:', sessionError);
                return res.status(500).json({
                    success: false,
                    message: 'Database error. Please try again.',
                    userSafeMessage: 'We encountered an issue. Please try again in a moment.'
                });
            }
        }

        // Step 3: إعداد سياق المقابلة مع conversation history
        const conversationHistory = session.conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        const context = {
            candidateProfile: {
                full_name: candidate.full_name,
                email: candidate.email,
                position_applied_for: candidate.position_applied_for,
                skills: candidate.skills,
                experience: candidate.years_of_experience
            },
            conversationHistory: conversationHistory,
            sessionId: sessionId,
            avatarId: process.env.BEYOND_PRESENCE_AVATAR_ID || undefined
        };

        // Step 4: LiveKit Agent يتعامل مع المحادثة
        // لا نعالج المحادثة هنا - LiveKit Agent (Python) سيتعامل معها تلقائياً
        console.log('='.repeat(60));
        console.log('⏭️ BACKEND: LIVEKIT AGENT WILL HANDLE CONVERSATION');
        console.log('='.repeat(60));
        console.log('   User text (for logging only):', `"${userText.substring(0, 50)}..."`);
        console.log('   Note: Agent should receive audio directly from LiveKit');
        console.log('='.repeat(60));
        
        // نُرجع رسالة بسيطة للمستخدم - LiveKit Agent سيرد فعلياً
        const replyText = "Processing your message...";

        // Step 5: حفظ الرسائل في conversation history
        try {
            session.addMessage('user', userText);
            session.addMessage('assistant', replyText);
            await session.save();
        } catch (saveError: any) {
            // Log error لكن لا نوقف التدفق
            console.error('⚠️ Error saving conversation history (non-blocking):', saveError);
            // نتابع - المحادثة ستستمر حتى لو فشل الحفظ
        }

        // Step 6: إرجاع النص للمستخدم
        // حتى لو فشل بعض الخطوات، نُرجع رداً للمستخدم
        res.status(200).json({
            success: true,
            reply: replyText,
            transcribedText: userText
        });

    } catch (error: any) {
        // Catch-all error handler
        console.error('❌ Unexpected error in /audio:', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            sessionId: req.body?.sessionId?.substring(0, 20) + '...'
        });

        // إرجاع user-safe error message
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            userSafeMessage: 'We encountered an issue processing your audio. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/video-interview/end
 * إنهاء مقابلة فيديو
 * 
 * التدفق:
 * 1. جلب session من قاعدة البيانات
 * 2. تحديث status إلى 'completed'
 * 3. حفظ endedAt timestamp
 */
router.post('/end', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'sessionId is required'
            });
        }

        // جلب session من DB (قد لا يوجد في وضع الاختبار - لا نحفظ session)
        const session = await VideoInterviewSession.findOne({ sessionId: sessionId }).catch(() => null) as any;

        // ✅ إيقاف LiveKit Agent دائماً (حتى لو session غير موجود في DB - وضع الاختبار)
        try {
            const roomName = `room-${sessionId}`;
            console.log(`🛑 Stopping LiveKit Agent for room: ${roomName}`);
            stopAgent(roomName);
            console.log(`✅ LiveKit Agent stopped successfully`);
        } catch (agentError: any) {
            console.warn(`⚠️ Error stopping LiveKit Agent (non-blocking): ${agentError.message}`);
        }

        // ✅ إزالة الجلسة النشطة للسماح ببدء مقابلة جديدة لنفس المرشح
        let candidateIdToRemove = session?.candidateId?.toString?.();
        if (!candidateIdToRemove && sessionId) {
            const parts = sessionId.split('-');
            if (parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1])) {
                candidateIdToRemove = parts.slice(2, -1).join('-');
            }
        }
        if (candidateIdToRemove) {
            activeCandidateSessions.delete(candidateIdToRemove);
        }

        // إرسال ترانسكريبت مقابلة الفيديو إلى n8n (مثل الصوت)
        if (session?.conversationHistory?.length) {
            sendVideoTranscriptToN8N({
                sessionId,
                candidateId: session?.candidateId?.toString?.() || candidateIdToRemove || undefined,
                conversationHistory: session.conversationHistory.map((msg: any) => ({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: String(msg.content || ''),
                })),
                language: 'auto',
            }).catch((n8nError: any) => {
                console.warn(`⚠️ Error sending video transcript to n8n (non-blocking): ${n8nError.message}`);
            });
        } else {
            console.log(`ℹ️ Skipping video transcript n8n send for ${sessionId}: no conversation history`);
        }

        // إنهاء الجلسة في DB إن وُجدت
        if (session) {
            try {
                (session as any).endSession();
                await session.save();
            } catch (saveError: any) {
                console.warn(`⚠️ Error saving session end (non-blocking): ${(saveError as Error).message}`);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Interview session ended successfully',
            sessionId: sessionId
        });

    } catch (error: any) {
        console.error('Error in /end:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to end video interview',
            error: error.message
        });
    }
});

/**
 * GET /api/video-interview/status/:sessionId
 * الحصول على حالة المقابلة
 */
router.get('/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await VideoInterviewSession.findOne({ sessionId: sessionId })
            .populate('candidateId', 'full_name email')
            .select('sessionId status startedAt endedAt conversationHistory.length');

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            session: {
                sessionId: session.sessionId,
                status: session.status,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                messageCount: session.conversationHistory.length,
                candidate: session.candidateId
            }
        });

    } catch (error: any) {
        console.error('Error in /status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get session status',
            error: error.message
        });
    }
});

/**
 * GET /api/video-interview/history/:sessionId
 * الحصول على تاريخ المحادثة الكامل
 */
router.get('/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await VideoInterviewSession.findOne({ sessionId: sessionId })
            .select('conversationHistory');

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            conversationHistory: session.conversationHistory
        });

    } catch (error: any) {
        console.error('Error in /history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversation history',
            error: error.message
        });
    }
});

export default router;

