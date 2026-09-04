// ============================================
// ملف: models/VideoPrewarmSession.ts
// الوظيفة: سجلّ غرفة الإحماء بين /prepare و /start — يصمد أمام إعادة تشغيل الخادم.
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

/**
 * The /prepare → /start handoff used to live in a per-process `Map`. That works
 * until the process restarts or a second instance answers /start: the record is
 * gone, /start builds a NEW room, and the agent is still holding the prewarmed one
 * — and the interview worker takes one job at a time, so the real dispatch is
 * refused and the candidate meets an empty room.
 *
 * Persisting the handoff makes reuse survive both. `deleteOtherCandidateRooms` in
 * /start remains the safety net for the cases this cannot cover (a room created by
 * an instance that never wrote here, say).
 *
 * The LiveKit access token is deliberately NOT stored: it is derived from
 * roomName + identity, so /start regenerates it instead of us keeping a credential
 * at rest.
 */
export interface IVideoPrewarmSession extends Document {
    candidateId: string;
    roomName: string;
    sessionId: string;
    campaignId?: string;
    createdAt: Date;
}

const VideoPrewarmSessionSchema = new Schema<IVideoPrewarmSession>({
    candidateId: { type: String, required: true, unique: true, index: true },
    roomName: { type: String, required: true },
    sessionId: { type: String, required: true },
    campaignId: { type: String },
    // Mongo removes the row on its own once the handoff window has passed, so a
    // stale prewarm can never be reused for a later interview.
    createdAt: { type: Date, default: Date.now, expires: 300 },
});

export default mongoose.model<IVideoPrewarmSession>(
    'VideoPrewarmSession',
    VideoPrewarmSessionSchema,
    'video_prewarm_sessions'
);
