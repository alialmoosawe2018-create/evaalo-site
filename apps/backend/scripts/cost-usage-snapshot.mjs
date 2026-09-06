// ============================================================================
// لقطة التكاليف والاستهلاك الشهرية — النصف الداخلي من نموذج التسعير.
//
// يقرأ credit_ledger + credit_balances ويُخرج ما لا نستطيع تخمينه:
//   • الاستهلاك الفعلي لكل خدمة (صوت/فيديو/بحث/فرز/CV)
//   • مدد المقابلات الحقيقية (لا تقديرات)
//   • نسبة الاستهلاك (utilization) لكل منظمة وخطة  ← أهم رقم للتسعير
//   • دقائق الكلام المُولَّد مقابل حصّة ElevenLabs، ودقائق الفيديو مقابل حصّة الأفتار
//   • تقدير التكلفة المتغيرة الجارية (بافتراضات قابلة للاستبدال)
//
// يوم الـ30: أضِف فواتير المزوّدين فوق هذا الإخراج → تكلفة حقيقية لكل وحدة →
// هوامش حقيقية → التسعير النهائي المعتمد.
//
// التشغيل:
//   node apps/backend/scripts/cost-usage-snapshot.mjs
//   node apps/backend/scripts/cost-usage-snapshot.mjs --month=2026-09
//
// للقراءة فقط — لا يكتب أي شيء. يقرأ MONGODB_URI من apps/backend/.env
// ويستهدف قاعدة evaalo صراحةً (تجاوز افتراضي الـURI).
// ============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MONGO_DB = process.env.MONGO_DB || 'evaalo';
const MICRO = 1_000_000;

// --- افتراضات التكلفة (استبدلها بأرقام الفواتير الحقيقية يوم الـ30) ---
const A = {
    talkRatio: Number(process.env.TALK_RATIO || 0.35),        // نسبة كلام الوكيل من مدة المقابلة
    sttPerMin: Number(process.env.COST_STT_MIN || 0.00215),
    llmPerMin: Number(process.env.COST_LLM_MIN || 0.0012),
    ttsPerSpeechMin: Number(process.env.COST_TTS_MIN || 0.30), // تجاوز ElevenLabs Creator
    avatarPerMin: Number(process.env.COST_AVATAR_MIN || 0.1925), // تجاوز BP Starter (€0.175)
    searchPerCand: Number(process.env.COST_SEARCH || 0.05),
    textPerOp: Number(process.env.COST_TEXT_OP || 0.005),
    elQuotaMin: Number(process.env.EL_QUOTA_MIN || 100),       // دقائق كلام مشمولة
    bpQuotaMin: Number(process.env.BP_QUOTA_MIN || 280),       // دقائق فيديو مشمولة
};

const monthArg = (process.argv.find((a) => a.startsWith('--month=')) || '').split('=')[1];
function period(ym) {
    const n = new Date();
    const [y, m] = ym ? ym.split('-').map(Number) : [n.getUTCFullYear(), n.getUTCMonth() + 1];
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)), label: `${y}-${String(m).padStart(2, '0')}` };
}
const n2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

async function main() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) { console.error('❌ MONGODB_URI غير مضبوط في apps/backend/.env'); process.exit(1); }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
    const db = mongoose.connection.getClient().db(MONGO_DB);
    const ledger = db.collection('credit_ledger');
    const { start, end, label } = period(monthArg);
    const inPeriod = { createdAt: { $gte: start, $lt: end } };

    // 1) الاستهلاك لكل خدمة
    const byType = await ledger.aggregate([
        { $match: { ...inPeriod, usageType: { $ne: null }, amountMicro: { $lt: 0 } } },
        { $group: { _id: '$usageType', ops: { $sum: 1 }, units: { $sum: '$units' }, credits: { $sum: { $abs: '$amountMicro' } } } },
        { $sort: { credits: -1 } },
    ]).toArray();

    // 2) جلسات المقابلات (مدد حقيقية)
    const sessions = await ledger.aggregate([
        { $match: { ...inPeriod, usageType: { $in: ['VOICE_SECONDS', 'VIDEO_SECONDS'] } } },
        { $group: { _id: { t: '$usageType', s: '$sourceId' }, sec: { $sum: '$units' } } },
        { $group: {
            _id: '$_id.t', n: { $sum: 1 }, totalSec: { $sum: '$sec' },
            avgSec: { $avg: '$sec' }, maxSec: { $max: '$sec' },
            real: { $sum: { $cond: [{ $gte: ['$sec', 120] }, 1, 0] } },
            realSec: { $sum: { $cond: [{ $gte: ['$sec', 120] }, '$sec', 0] } },
        } },
    ]).toArray();
    const S = (t) => sessions.find((x) => x._id === t) || { n: 0, totalSec: 0, avgSec: 0, maxSec: 0, real: 0, realSec: 0 };
    const voice = S('VOICE_SECONDS'), video = S('VIDEO_SECONDS');
    const voiceMin = voice.totalSec / 60, videoMin = video.totalSec / 60;

    // 3) نسبة الاستهلاك لكل منظمة
    const consumedByOrg = await ledger.aggregate([
        { $match: { ...inPeriod, amountMicro: { $lt: 0 } } },
        { $group: { _id: '$organizationId', consumed: { $sum: { $abs: '$amountMicro' } } } },
    ]).toArray();
    const planByOrg = await ledger.aggregate([
        { $match: { 'metadata.planSnapshot.planId': { $ne: null } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$organizationId', planId: { $first: '$metadata.planSnapshot.planId' }, granted: { $first: '$metadata.planSnapshot.monthlyCredits' } } },
    ]).toArray();
    const planMap = new Map(planByOrg.map((p) => [p._id, p]));

    console.log(`\n  لقطة التكاليف والاستهلاك — ${label}   (قاعدة: ${MONGO_DB})`);
    console.log('  ' + '═'.repeat(66));

    console.log('\n  ▸ الاستهلاك لكل خدمة');
    console.log('    ' + pad('الخدمة', 20) + padL('عمليات', 9) + padL('وحدات', 10) + padL('بطاقات', 10));
    let totalCredits = 0;
    for (const r of byType) {
        totalCredits += r.credits / MICRO;
        console.log('    ' + pad(r._id, 20) + padL(r.ops, 9) + padL(r.units ?? 0, 10) + padL(n2(r.credits / MICRO), 10));
    }
    console.log('    ' + pad('— الإجمالي —', 20) + padL('', 9) + padL('', 10) + padL(n2(totalCredits), 10));

    console.log('\n  ▸ المقابلات الحقيقية');
    for (const [nm, v] of [['صوت', voice], ['فيديو', video]]) {
        const avgM = v.n ? v.avgSec / 60 : 0;
        const realAvgM = v.real ? v.realSec / v.real / 60 : 0;
        console.log(`    ${pad(nm, 8)} جلسات=${padL(v.n, 4)}  إجمالي=${padL(n2(v.totalSec / 60), 8)}د  متوسط=${padL(n2(avgM), 6)}د  جوهرية(≥2د)=${padL(v.real, 4)} بمتوسط ${n2(realAvgM)}د  أطول=${n2(v.maxSec / 60)}د`);
    }

    // 4) الحصص
    const ttsMin = (voiceMin + videoMin) * A.talkRatio;
    const ttsPct = A.elQuotaMin ? (ttsMin / A.elQuotaMin) * 100 : 0;
    const bpPct = A.bpQuotaMin ? (videoMin / A.bpQuotaMin) * 100 : 0;
    const flag = (p) => (p >= 85 ? '🔴' : p >= 60 ? '🟠' : '🟢');
    console.log('\n  ▸ الحصص المشتركة');
    console.log(`    ElevenLabs (كلام مُولَّد): ${n2(ttsMin)} / ${A.elQuotaMin} د  = ${ttsPct.toFixed(0)}% ${flag(ttsPct)}`);
    console.log(`    Beyond Presence (فيديو):  ${n2(videoMin)} / ${A.bpQuotaMin} د  = ${bpPct.toFixed(0)}% ${flag(bpPct)}`);

    // 5) نسبة الاستهلاك (أهم رقم)
    console.log('\n  ▸ نسبة الاستهلاك لكل منظمة  ← الرقم الحاسم للتسعير');
    console.log('    ' + pad('المنظمة', 26) + pad('الخطة', 14) + padL('ممنوح', 8) + padL('مستهلك', 9) + padL('%', 7));
    const byPlan = new Map();
    for (const o of consumedByOrg.sort((a, b) => b.consumed - a.consumed)) {
        const p = planMap.get(o._id) || {};
        const used = o.consumed / MICRO;
        const granted = p.granted || 0;
        const pct = granted ? (used / granted) * 100 : 0;
        if (granted) {
            const acc = byPlan.get(p.planId) || { used: 0, granted: 0, n: 0 };
            acc.used += used; acc.granted += granted; acc.n += 1; byPlan.set(p.planId, acc);
        }
        console.log('    ' + pad(String(o._id).slice(0, 24), 26) + pad(p.planId || '—', 14) + padL(granted || '—', 8) + padL(n2(used), 9) + padL(granted ? pct.toFixed(0) + '%' : '—', 7));
    }
    if (byPlan.size) {
        console.log('\n    متوسط الاستهلاك حسب الخطة:');
        for (const [plan, a] of byPlan) {
            console.log(`      ${pad(plan, 14)} منظمات=${padL(a.n, 3)}  استهلاك=${padL((a.used / a.granted * 100).toFixed(0) + '%', 6)}`);
        }
    }

    // 6) تقدير التكلفة المتغيرة
    const searches = (byType.find((r) => r._id === 'SEARCH_CANDIDATE')?.units) || 0;
    const textOps = byType.filter((r) => ['SCREENING', 'CV_ANALYSIS', 'JOB_AD', 'COMPARE_EMAIL', 'CRITERIA_SUGGESTION', 'CONTACT_REVEAL'].includes(r._id))
        .reduce((s, r) => s + (r.units || r.ops), 0);
    const sttLlm = (voiceMin + videoMin) * (A.sttPerMin + A.llmPerMin);
    const ttsCost = Math.max(0, ttsMin - A.elQuotaMin) * A.ttsPerSpeechMin;
    const avatarCost = Math.max(0, videoMin - A.bpQuotaMin) * A.avatarPerMin;
    const searchCost = searches * A.searchPerCand;
    const textCost = textOps * A.textPerOp;
    const varTotal = sttLlm + ttsCost + avatarCost + searchCost + textCost;
    console.log('\n  ▸ تقدير التكلفة المتغيرة (افتراضات — تُستبدل بالفواتير)');
    console.log(`    STT+LLM: $${n2(sttLlm)}   TTS تجاوز: $${n2(ttsCost)}   أفتار تجاوز: $${n2(avatarCost)}`);
    console.log(`    بحث(${searches}): $${n2(searchCost)}   نصّي(${textOps}): $${n2(textCost)}`);
    console.log(`    الإجمالي المتغيّر التقديري: $${n2(varTotal)}`);

    console.log('\n  ' + '═'.repeat(66));
    console.log('  يوم الـ30 — أضِف هذه الفواتير فوق الأرقام أعلاه:');
    console.log('    ElevenLabs · Beyond Presence · Speechmatics · OpenAI · Unipile');
    console.log('    LiveKit · MongoDB · Cloudflare/R2 · رسوم Stripe · عدد العملاء وتوزيع الخطط');
    console.log('  ثم: تكلفة حقيقية/وحدة ← هوامش حقيقية ← التسعير النهائي.\n');

    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error('خطأ:', e.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
});
