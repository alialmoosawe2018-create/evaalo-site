// ============================================
// ملف: models/VideoInterviewSession.ts
// الوظيفة: Model لتخزين جلسات المقابلات المرئية
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

// Interface لرسالة في المحادثة
export interface IConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

// Interface لجلسة المقابلة المرئية
export interface IVideoInterviewSession extends Document {
    sessionId: string;
    candidateId: mongoose.Types.ObjectId;
    campaignId?: mongoose.Types.ObjectId;
    conversationHistory: IConversationMessage[];
    status: 'active' | 'completed' | 'cancelled';
    startedAt: Date;
    endedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Schema لجلسة المقابلة المرئية
const VideoInterviewSessionSchema = new Schema<IVideoInterviewSession>(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        candidateId: {
            type: Schema.Types.ObjectId,
            ref: 'Candidate',
            required: true,
            index: true
        },
        campaignId: {
            type: Schema.Types.ObjectId,
            ref: 'RecruitmentCampaign',
            index: true
        },
        conversationHistory: [
            {
                role: {
                    type: String,
                    enum: ['user', 'assistant'],
                    required: true
                },
                content: {
                    type: String,
                    required: true,
                    trim: true
                },
                timestamp: {
                    type: Date,
                    default: Date.now,
                    required: true
                }
            }
        ],
        status: {
            type: String,
            enum: ['active', 'completed', 'cancelled'],
            default: 'active',
            index: true
        },
        startedAt: {
            type: Date,
            default: Date.now,
            required: true
        },
        endedAt: {
            type: Date
        }
    },
    {
        timestamps: true, // يضيف createdAt و updatedAt تلقائياً
        collection: 'video_interview_sessions'
    }
);

// Indexes للأداء
VideoInterviewSessionSchema.index({ candidateId: 1, status: 1 });
// ✅ FIX: إزالة index مكرر على sessionId - unique: true في schema definition (السطر 34) كافٍ
// VideoInterviewSessionSchema.index({ sessionId: 1 }, { unique: true }); // ❌ مكرر - sessionId لديه unique: true بالفعل
VideoInterviewSessionSchema.index({ createdAt: -1 });

// Method لإضافة رسالة للمحادثة
VideoInterviewSessionSchema.methods.addMessage = function(
    role: 'user' | 'assistant',
    content: string
): void {
    this.conversationHistory.push({
        role,
        content,
        timestamp: new Date()
    });
    this.updatedAt = new Date();
};

// Method لإنهاء الجلسة
VideoInterviewSessionSchema.methods.endSession = function(): void {
    this.status = 'completed';
    this.endedAt = new Date();
    this.updatedAt = new Date();
};

// Method لإلغاء الجلسة
VideoInterviewSessionSchema.methods.cancelSession = function(): void {
    this.status = 'cancelled';
    this.endedAt = new Date();
    this.updatedAt = new Date();
};

// Export Model
const VideoInterviewSession = mongoose.model<IVideoInterviewSession>(
    'VideoInterviewSession',
    VideoInterviewSessionSchema
);

export default VideoInterviewSession;

