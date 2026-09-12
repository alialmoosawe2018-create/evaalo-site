/**
 * عقد المرحلة الثانية (v2) — القاعدة تقبل الشكلين قبل أن يُرسل المقيّم الجديد.
 *
 * الخلفية: مقيّمُ المرحلة الثانية الحيّ («stage 2 v.2») يزن سبع كفاءات من مئة
 * ويجمع لكلٍّ منها دليلاً، ثمّ لا يُرسل إلّا خمس كلمات تقدير. وحتى لو أرسل
 * الباقي لضاع: مخطَّطا المرشّح والطلب `strict: true`، فكلّ مسارٍ غير مُعلَن
 * **يُحذف بصمت** بلا خطأ ولا تحذير.
 *
 * فهذا الملفّ يُثبت ثلاثة أشياء بالترتيب الذي يهمّ:
 *   ١. الحذف الصامت حقيقيّ — حقلٌ غير مُعلَن يختفي، وهو ما كان يحدث للأدلّة.
 *   ٢. الحقول الجديدة تنجو الآن في **المخطَّطين معاً** (تباعُدُهما يعني أن يُكتب
 *      الحقل على صفٍّ ويختفي من الآخر — وقد حدث فعلاً مع `status`).
 *   ٣. الالتقاط يعمل على الشكلين: كائنٌ متداخل، ونصوصٌ مسطّحة من multipart —
 *      ولا يكتب شيئاً حين تغيب الحقول، فالاستدعاء القديم يمرّ كما كان.
 *
 * Run: npm run test:stage2-v2-contract
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { buildStage2V2Extras } from '../services/stageWebhookMerge.js';
import {
    getStage2VoicePatchIssues,
    isCompleteStage2VoicePatch,
} from '../services/stage2VoiceEvaluationGate.js';

let failures = 0;
function check(name: string, fn: () => void) {
    try {
        fn();
        console.log(`ok   ${name}`);
    } catch (err: any) {
        failures += 1;
        console.error(`FAIL ${name}: ${err?.message || err}`);
    }
}

/** ما يمرّ عبر المخطَّط فعلاً — بلا قاعدة بيانات؛ Mongoose يصبّ عند الإنشاء. */
function castVoiceEval(Model: any, evaluation: Record<string, unknown>): Record<string, unknown> {
    const doc = new Model({ voiceInterviewEvaluation: evaluation });
    const plain = doc.toObject();
    return (plain.voiceInterviewEvaluation ?? {}) as Record<string, unknown>;
}

const NEW_SHAPE = {
    // الحقول الستّ المسطّحة تبقى مكتوبةً — بركةُ المقارنة تشتقّ منها اكتمال البيانات
    communication: 'Good',
    language_fluency: 'Not Assessed',
    confidence: 'Good',
    problem_solving: 'Excellent',
    digital_skills: 'Good',
    professional_attitude: 'Handles friction calmly and owns outcomes.',
    summary: 'A solid generalist.',
    strengths: ['clear'],
    weaknesses: ['thin on tooling'],
    final_hr_evaluation: 'Advance.',
    overall_score: 69,
    recommendation: 'Consider',
    // ما كان يُحسب ثمّ يُرمى
    status: 'insufficient_data',
    coverage: 85,
    competencyScores: [
        {
            competencyKey: 'relevant_experience_role_fit',
            title: 'Relevant experience and role fit',
            assessed: true,
            rating: 'Excellent',
            evidence: ['I ran the payroll cycle end to end for 40 staff.'],
        },
        {
            competencyKey: 'computer_skills',
            assessed: true,
            rating: 'Good',
            evidence: ['I build the reports in Excel myself.'],
            selfReported: true,
        },
        {
            competencyKey: 'teamwork_and_collaboration',
            assessed: false,
            rating: 'Not Assessed',
        },
    ],
    priors: { communicationSkills: 7, englishFluency: 0, confidenceLevel: 6 },
};

// ── ١. الحذف الصامت — الآلية التي قتلت الأدلّة ────────────────────────────────
check('an undeclared field is dropped silently by the strict schema', () => {
    const out = castVoiceEval(Candidate, { summary: 'x', thisFieldWasNeverDeclared: 'gone' });
    assert.equal(out.summary, 'x', 'a declared field survives');
    assert.equal(
        out.thisFieldWasNeverDeclared,
        undefined,
        'an undeclared field must vanish — this is why competencyScores used to disappear'
    );
});

// ── ٢. الحقول الجديدة تنجو في المخطَّطين معاً ────────────────────────────────
for (const [label, Model] of [
    ['candidate', Candidate],
    ['application', CandidateApplication],
] as const) {
    check(`${label}: the new competency array survives the cast`, () => {
        const out = castVoiceEval(Model, NEW_SHAPE);
        const comp = out.competencyScores as any[];
        assert.ok(Array.isArray(comp), 'competencyScores must persist as an array');
        assert.equal(comp.length, 3);
        assert.equal(comp[0].competencyKey, 'relevant_experience_role_fit');
        assert.equal(comp[0].rating, 'Excellent', 'the rating is a WORD here, not a 1-5 number');
        assert.deepEqual(comp[0].evidence, ['I ran the payroll cycle end to end for 40 staff.']);
        assert.equal(comp[1].selfReported, true, 'the self-reported marker must survive');
        assert.equal(comp[2].assessed, false, '"never came up" must stay distinguishable');
    });

    check(`${label}: status, coverage and priors survive the cast`, () => {
        const out = castVoiceEval(Model, NEW_SHAPE);
        assert.equal(out.status, 'insufficient_data');
        assert.equal(out.coverage, 85);
        const priors = out.priors as any;
        assert.equal(priors.communicationSkills, 7);
        assert.equal(priors.englishFluency, 0, 'a zero prior must persist, not be dropped as falsy');
        assert.equal(priors.confidenceLevel, 6);
    });

    check(`${label}: the six legacy flat fields are untouched`, () => {
        const out = castVoiceEval(Model, NEW_SHAPE);
        assert.equal(out.communication, 'Good');
        assert.equal(out.language_fluency, 'Not Assessed');
        assert.equal(out.confidence, 'Good');
        assert.equal(out.problem_solving, 'Excellent');
        assert.equal(out.digital_skills, 'Good');
        assert.equal(out.overall_score, 69);
        assert.equal(out.recommendation, 'Consider');
    });

    check(`${label}: an old-shape evaluation still casts exactly as before`, () => {
        const old = {
            communication: 'Good',
            language_fluency: 'Bad',
            confidence: 'Good',
            problem_solving: 'Good',
            digital_skills: 'Intermediate',
            professional_attitude: 'Reliable and calm.',
            summary: 's',
            strengths: ['a'],
            weaknesses: ['b'],
            final_hr_evaluation: 'f',
            overall_score: 55,
            recommendation: 'Consider',
        };
        const out = castVoiceEval(Model, old);
        for (const [k, v] of Object.entries(old)) {
            if (Array.isArray(v)) assert.deepEqual(out[k], v, k);
            else assert.equal(out[k], v, k);
        }
        assert.equal(out.competencyScores, undefined, 'no empty array is invented');
        assert.equal(out.coverage, undefined);
        assert.equal(out.priors, undefined);
    });
}

// ── ٣. الالتقاط — الكود نفسه الذي يعمل في الخادم ────────────────────────────
check('absent extras write nothing — the live payload is unaffected', () => {
    const extras = buildStage2V2Extras([{ communication: 'Good', summary: 's' }]);
    assert.deepEqual(extras, {}, 'today the scorer sends none of these; nothing may be written');
});

check('a nested JSON payload is picked up', () => {
    const nested = {
        competencyScores: NEW_SHAPE.competencyScores,
        coverage: 85,
        priors: NEW_SHAPE.priors,
    };
    const extras = buildStage2V2Extras([nested]);
    assert.equal((extras.competencyScores as any[]).length, 3);
    assert.equal(extras.coverage, 85);
    assert.deepEqual(extras.priors, NEW_SHAPE.priors);
});

check('flat multipart strings are parsed — n8n posts form-data, not JSON', () => {
    const flat = {
        competencyScores: JSON.stringify(NEW_SHAPE.competencyScores),
        coverage: '85',
        priors: JSON.stringify(NEW_SHAPE.priors),
    };
    const extras = buildStage2V2Extras([flat]);
    assert.equal((extras.competencyScores as any[]).length, 3, 'a stringified array must be parsed');
    assert.equal(extras.coverage, 85, 'a numeric string must become a number');
    assert.equal((extras.priors as any).englishFluency, 0);
});

check('the snake_case alias is accepted', () => {
    const extras = buildStage2V2Extras([{ competency_scores: JSON.stringify([{ competencyKey: 'x' }]) }]);
    assert.equal((extras.competencyScores as any[]).length, 1);
});

check('malformed JSON is ignored, never thrown — this runs inside a callback handler', () => {
    const extras = buildStage2V2Extras([{ competencyScores: '{not json', priors: 'oops' }]);
    assert.deepEqual(extras, {}, 'garbage must be dropped, not written and not raised');
});

check('an empty array writes nothing', () => {
    assert.deepEqual(buildStage2V2Extras([{ competencyScores: '[]' }]), {});
});

check('coverage is clamped and non-numbers refused', () => {
    assert.equal(buildStage2V2Extras([{ coverage: 140 }]).coverage, 100);
    assert.equal(buildStage2V2Extras([{ coverage: -5 }]).coverage, 0);
    assert.equal(buildStage2V2Extras([{ coverage: 'abc' }]).coverage, undefined);
    assert.equal(buildStage2V2Extras([{ coverage: 0 }]).coverage, 0, 'zero coverage is a real value');
});

check('priors must be an object — an array is refused', () => {
    assert.equal(buildStage2V2Extras([{ priors: '[1,2,3]' }]).priors, undefined);
});

check('the nested source wins over the flat one, as everywhere else', () => {
    const extras = buildStage2V2Extras([{ coverage: 70 }, { coverage: 30 }]);
    assert.equal(extras.coverage, 70);
});

// ── ٣ب. السطر الوحيد الذي لا يبلغه اختبار ───────────────────────────────────
//
// `buildStrictStage2VoicePatch` تعيش في `server.ts`، واستيرادُه يُقلع الخادم،
// فلا اختبارَ يبلغ استدعاءها. وحذفُ سطر الاستدعاء يُفقد كلَّ ما سبق **بصمت**:
// الدالّة سليمة ومُختبَرة، ولا أحد يناديها. فيُثبَّت وجودُه في مصدر الدالّة.
check('the stage 2 patch builder actually calls the picker', () => {
    const src = readFileSync(fileURLToPath(new URL('../server.ts', import.meta.url)), 'utf8');
    const start = src.indexOf('function buildStrictStage2VoicePatch');
    assert.ok(start > 0, 'buildStrictStage2VoicePatch not found in server.ts');
    const body = src.slice(start, src.indexOf('\nfunction ', start + 1));
    assert.ok(
        body.includes('buildStage2V2Extras(sources)'),
        'the picker must be called from inside the stage 2 patch builder'
    );
});

// ── ٤. البوّابة لم تتغيّر ────────────────────────────────────────────────────
check('the gate accepts the new shape', () => {
    assert.deepEqual(getStage2VoicePatchIssues(NEW_SHAPE as any), []);
    assert.equal(isCompleteStage2VoicePatch(NEW_SHAPE as any), true);
});

check('the gate still accepts a payload carrying none of the new fields', () => {
    const { status, coverage, competencyScores, priors, ...legacyOnly } = NEW_SHAPE as any;
    assert.deepEqual(getStage2VoicePatchIssues(legacyOnly), []);
});

check('the gate still rejects a numeric rating, as before', () => {
    const bad = { ...NEW_SHAPE, communication: 7 } as any;
    assert.ok(getStage2VoicePatchIssues(bad).includes('communication'));
});

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nstage2-v2-contract-test: OK');
