// ============================================================================
// مراقب حصّة ElevenLabs — يقيس استهلاك دقائق كلام الوكيل مقابل حصّة الخطة.
//
// عنق الزجاجة الأقرب في نظام إيڤالو: TTS (ElevenLabs). كل مقابلة صوتية/فيديو
// تولّد كلامًا يُخصم من حصّة الخطة الشهرية (Creator ≈ 100 دقيقة كلام). بعدها
// يُدفع تجاوز ~$0.30/دقيقة. هذا السكربت يقرأ credit_ledger (VOICE/VIDEO_SECONDS)
// ويحوّلها إلى دقائق كلام مُولَّد = ثواني المقابلة × نسبة كلام الوكيل ÷ 60.
//
// التشغيل:
//   node apps/backend/scripts/elevenlabs-quota-monitor.mjs
//   EL_QUOTA_MIN=600 TALK_RATIO=0.4 node .../elevenlabs-quota-monitor.mjs   (لخطة Pro)
//   node .../elevenlabs-quota-monitor.mjs --month=2026-07                    (شهر محدّد)
//
// يقرأ MONGODB_URI من apps/backend/.env تلقائيًا. للقراءة فقط — لا يكتب شيئًا.
// ============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// --- إعدادات قابلة للتخصيص ---
const MONGO_DB = process.env.MONGO_DB || 'evaalo';              // اسم قاعدة البيانات الفعلية (تجاوز افتراضي URI)
const EL_QUOTA_MIN = Number(process.env.EL_QUOTA_MIN || 100);   // دقائق كلام مشمولة في خطة ElevenLabs الحالية (Creator=100)
const TALK_RATIO = Number(process.env.TALK_RATIO || 0.35);       // نسبة كلام الوكيل من مدة المقابلة
const OVERAGE_PER_MIN = Number(process.env.EL_OVERAGE || 0.30);  // $ لكل دقيقة كلام بعد الحصّة (Creator)

const monthArg = (process.argv.find((a) => a.startsWith('--month=')) || '').split('=')[1];
function monthStart(ym) {
    const now = new Date();
    const [y, m] = ym ? ym.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)), label: `${y}-${String(m).padStart(2, '0')}` };
}

function bar(pct, width = 28) {
    const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
    return '█'.repeat(fill) + '░'.repeat(width - fill);
}

async function main() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        console.error('❌ MONGODB_URI غير مضبوط. أضِفه إلى apps/backend/.env');
        process.exit(1);
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
    const col = mongoose.connection.getClient().db(MONGO_DB).collection('credit_ledger');
    const { start, end, label } = monthStart(monthArg);

    const rows = await col.aggregate([
        { $match: { usageType: { $in: ['VOICE_SECONDS', 'VIDEO_SECONDS'] }, createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$usageType', sec: { $sum: '$units' }, sessions: { $sum: 1 } } },
    ]).toArray();

    const voice = rows.find((r) => r._id === 'VOICE_SECONDS') || { sec: 0, sessions: 0 };
    const video = rows.find((r) => r._id === 'VIDEO_SECONDS') || { sec: 0, sessions: 0 };
    const totalSec = voice.sec + video.sec;
    const totalSessions = voice.sessions + video.sessions;
    const interviewMin = totalSec / 60;
    const speechMin = (interviewMin * TALK_RATIO);
    const pct = EL_QUOTA_MIN > 0 ? (speechMin / EL_QUOTA_MIN) * 100 : 0;
    const remainingSpeech = Math.max(0, EL_QUOTA_MIN - speechMin);
    const avgInterviewMin = totalSessions ? interviewMin / totalSessions : 0;
    const remainingInterviews = avgInterviewMin > 0 ? remainingSpeech / (avgInterviewMin * TALK_RATIO) : Infinity;

    const level = pct >= 85 ? '🔴 حرج' : pct >= 60 ? '🟠 راقب' : '🟢 آمن';

    console.log(`\n  مراقب حصّة ElevenLabs — شهر ${label}`);
    console.log('  ' + '─'.repeat(50));
    console.log(`  المقابلات:        ${totalSessions} جلسة  (صوت ${voice.sessions} · فيديو ${video.sessions})`);
    console.log(`  دقائق المقابلات:  ${interviewMin.toFixed(1)} د   (متوسط ${avgInterviewMin.toFixed(1)} د/جلسة)`);
    console.log(`  كلام مُولَّد (TTS): ${speechMin.toFixed(1)} د  = مقابلات × ${TALK_RATIO}`);
    console.log('  ' + '─'.repeat(50));
    console.log(`  الحصّة:  ${speechMin.toFixed(1)} / ${EL_QUOTA_MIN} دقيقة   ${level}`);
    console.log(`  [${bar(pct)}] ${pct.toFixed(0)}%`);
    if (remainingSpeech > 0) {
        console.log(`  متبقٍّ: ${remainingSpeech.toFixed(1)} د كلام` +
            (Number.isFinite(remainingInterviews) ? ` ≈ ${Math.floor(remainingInterviews)} مقابلة إضافية بالمعدّل الحالي` : ''));
    } else {
        const overSpeech = speechMin - EL_QUOTA_MIN;
        console.log(`  ⚠️ تجاوزتَ الحصّة بـ ${overSpeech.toFixed(1)} د → تكلفة تقديرية $${(overSpeech * OVERAGE_PER_MIN).toFixed(2)} هذا الشهر`);
    }
    console.log('  ' + '─'.repeat(50));
    console.log('  ملاحظة: EL_QUOTA_MIN=100 (Creator). عدّلها عند ترقية الخطة (Pro=600، Scale=1800).\n');

    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error('خطأ:', e.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
});
