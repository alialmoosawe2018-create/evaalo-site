// ============================================
// ملف: services/videoEvaluationHealthService.ts
// الوظيفة: كشف فشل تقييم مقابلة الفيديو (المرحلة 3).
//
// السيناريو الخطر: المقابلة تنتهي بنجاح (status='completed') لكن ورك فلو n8n
// «المرحلة الثالثة» يفشل أو لا يرجع callback → المرشح قُوبل بلا نتيجة، ولا أحد
// يعلم. هذا الفحص يرصد الجلسات المكتملة التي تجاوزت مهلة معقولة دون أن يظهر
// videoInterviewEvaluation على المرشح، ويرسل تنبيهاً واحداً للمالك عبر نفس
// ورك فلو n8n «Evaalo Log Alerts».
// ============================================

import VideoInterviewSession from '../models/VideoInterviewSession.js';
import Candidate from '../models/Candidate.js';

/** المهلة قبل اعتبار التقييم متأخراً (دقائق). n8n المرحلة 3 عادة تنجز خلال دقائق. */
function evalDeadlineMs(): number {
    const raw = Number.parseInt((process.env.VIDEO_EVAL_ALERT_DEADLINE_MIN || '15').trim(), 10);
    return (Number.isFinite(raw) && raw > 0 ? raw : 15) * 60 * 1000;
}

function alertWebhookUrl(): string {
    return (
        process.env.ALERT_WEBHOOK_URL ||
        'https://n8n.evaalo.com/webhook/evaalo-log-alerts'
    ).trim();
}

/** هل يحمل المرشح تقييم فيديو فعلي (أي درجة كفاءة رقمية)؟ */
function hasVideoEvaluation(candidate: unknown): boolean {
    const evalObj = (candidate as { videoInterviewEvaluation?: Record<string, unknown> } | null)
        ?.videoInterviewEvaluation;
    if (!evalObj || typeof evalObj !== 'object') return false;
    return Object.values(evalObj).some((v) => typeof v === 'number' && Number.isFinite(v));
}

async function postAlert(summary: string, details: string): Promise<void> {
    try {
        await fetch(alertWebhookUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                host: 'evaalo-api',
                checkedAt: new Date().toISOString(),
                summary,
                details,
            }),
            signal: AbortSignal.timeout(10000),
        });
    } catch (e) {
        console.warn('⚠️ [video-eval-health] alert POST failed:', (e as Error)?.message || e);
    }
}

/**
 * Sweep: مقابلات فيديو مكتملة تجاوزت المهلة بلا تقييم → تنبيه واحد لكل جلسة.
 * fail-open: أي خطأ لا يوقف بقية المجدولات.
 */
export async function sweepStalledVideoEvaluations(): Promise<void> {
    const cutoff = new Date(Date.now() - evalDeadlineMs());
    const stalled = await VideoInterviewSession.find({
        status: 'completed',
        interviewMode: { $in: ['video', 'screen'] },
        endedAt: { $lt: cutoff },
        evaluationAlertSentAt: { $exists: false },
    })
        // System health sweep: intentionally cross-org (scans every org for
        // stalled evaluations to alert). Bypass the tenant guard.
        .setOptions({ skipTenantGuard: true })
        .sort({ endedAt: 1 })
        .limit(20)
        .lean();

    if (stalled.length === 0) return;

    for (const session of stalled) {
        try {
            const candidate = await Candidate.findById(session.candidateId)
                .select('videoInterviewEvaluation fullName')
                .lean();

            if (candidate && hasVideoEvaluation(candidate)) {
                // التقييم وصل — علّم الجلسة كي لا نعيد فحصها.
                await VideoInterviewSession.updateOne(
                    { _id: session._id },
                    { $set: { evaluationAlertSentAt: new Date() } }
                );
                continue;
            }

            const name =
                (candidate as { fullName?: string } | null)?.fullName || String(session.candidateId);
            const minsLate = Math.round((Date.now() - new Date(session.endedAt as Date).getTime()) / 60000);
            await postAlert(
                `Video interview evaluation missing (${minsLate}m late)`,
                `Candidate "${name}" completed a video interview (session ${session.sessionId}, ` +
                    `campaign ${session.campaignId || '-'}) but no Stage 3 evaluation has been recorded ` +
                    `${minsLate} minutes later. The n8n Stage 3 workflow may have failed — the candidate ` +
                    `was interviewed with no result. Check n8n "المرحلة الثالثة" executions and the ` +
                    `stage3 callback.`
            );
            await VideoInterviewSession.updateOne(
                { _id: session._id },
                { $set: { evaluationAlertSentAt: new Date() } }
            );
            console.warn(
                `⚠️ [video-eval-health] alerted: session=${session.sessionId} candidate=${name} late=${minsLate}m`
            );
        } catch (e) {
            console.warn(
                `⚠️ [video-eval-health] session ${session.sessionId} check failed:`,
                (e as Error)?.message || e
            );
        }
    }
}
