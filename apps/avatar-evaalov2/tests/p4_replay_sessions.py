"""Decision-point replays of the 2026-09-23 interviews K and L (not a test module).

J is replayed end to end in ``test_duplicate_swap_uncovered_competency.py``: its
blueprint had no domain-pack tracks or paths, so the real picker reproduces
production from the candidate's words alone. K and L did — their plans came from
the hr_officer / hr_generalist packs (steps such as «شلون نفّذت؟»), which the agent
receives in job metadata and which do not exist offline. So these replays take
each turn's PLAN from the production turn log instead of re-deriving it, and run
everything P4 depends on through the real agent:

* every agent utterance is recorded with ``record_agent_reply`` under the plan
  production logged, so the asked keys, the dedup memory and what the candidate
  heard are built by the same code as in production;
* where the guard swapped in an anchor (K turns 1 and 3), the real guard runs on
  the spoken text — the anchor it picks is the one the candidate heard;
* at each decision point the real guard runs on a duplicate (the previous
  question verbatim — production logged a duplicate verdict there, and the
  rejected wording itself was never stored).

After a decision whose pick matches production, production's spoken question is
recorded; after one that differs, the guard's own question is — that is the
corrected interview from then on. Only APIs that also exist in the previous
release are used, so the same replay runs against it to show the "before".
"""

from __future__ import annotations

from dataclasses import dataclass, field

from voice_interview.active_question import (
    MODE_ASK,
    MODE_CLARIFY,
    MODE_FOLLOW_UP,
    TurnPlan,
)
from voice_interview.assistant import (
    _WRAP_UP_PROMPT_AR,
    InterviewAssistant,
    TtsRouteContext,
)
from voice_interview.entity_policy import DIFFICULTY_FOLLOWUP_POOL


@dataclass
class Rec:
    """One agent utterance from the production turn log."""

    turn: int
    source: str
    mode: str
    competency: str
    planned: str
    spoken: str
    anchor_swap: bool = False


@dataclass
class Decision:
    """A turn where production's guard rejected a duplicate."""

    turn: int
    plan: TurnPlan
    production_pick: str
    production_spoken: str


@dataclass
class Session:
    name: str
    position: str
    greeting: str
    anchors: list[str]
    competencies: list[tuple[str, str, str, str]]  # key, title, priority, objective
    records: list[Rec]
    decisions: dict[int, Decision]
    # turn → what production's agent said AFTER the decision, only replayed when
    # the corrected pick equals production's (else it is regenerated).
    after_decision: dict[int, Rec] = field(default_factory=dict)

    def titles(self) -> list[str]:
        return [t for _, t, _, _ in self.competencies]


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _router() -> TtsRouteContext:
    return TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )


def build_agent(session: Session) -> InterviewAssistant:
    return InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position=session.position,
        bank_questions=list(session.anchors),
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "competencyKey": k,
                "title": t,
                "priority": p,
                "questionObjective": o,
                "expectedEvidence": ["مثال محدد"],
                "followUpRules": ["شنو صار بعدها؟"],
            }
            for k, t, p, o in session.competencies
        ],
        career_level="senior",
    )


def _plan(rec: Rec) -> TurnPlan:
    return TurnPlan(
        question=rec.planned or None,
        competency_key=rec.competency or None,
        source=rec.source,
        response_mode=rec.mode or MODE_ASK,
    )


def classify(agent: InterviewAssistant, line: str, decision_plan: TurnPlan) -> str:
    if line.strip() == _WRAP_UP_PROMPT_AR.strip():
        return "wrap_up"
    if line in DIFFICULTY_FOLLOWUP_POOL:
        return "bridge"
    plan = agent._turn_plan
    if plan is not decision_plan and plan is not None and plan.competency_key:
        return plan.competency_key
    return "unchanged"


def replay(session: Session) -> tuple[InterviewAssistant, dict[int, dict]]:
    """Run the session; return the agent and, per decision turn, what happened."""
    agent = build_agent(session)
    mem = agent._memory
    agent.mark_verbatim(session.greeting)
    # The worker pre-seeds the first anchor as the current topic
    # (worker.py "Hybrid memory pre-seed").
    mem.current_topic = session.anchors[0]
    mem.last_sample = session.anchors[0]
    outcomes: dict[int, dict] = {}
    diverged = False
    pending_clarify = False
    for rec in session.records:
        if rec.turn == 1:
            # Turn 1's decision is "advance", which marks the pre-seeded anchor
            # asked BEFORE the guard runs — why K's guard skipped anchor 1. As in
            # on_user_turn_completed, the picker's recommendation is set first;
            # without it "advance" assigns (and marks) the NEXT topic too.
            agent._turn_recommended = rec.planned
            agent._turn_recommended_source = rec.source
            agent._update_memory_post_decision({}, "advance")
        mem.turn_index = rec.turn
        if rec.turn in session.decisions:
            d = session.decisions[rec.turn]
            agent._turn_plan = d.plan
            stand_in = mem.asked_questions[-1]
            line = agent._apply_guard_to_agent_text(stand_in)
            second = agent._apply_guard_to_agent_text(line)
            pick = classify(agent, line, d.plan)
            outcomes[rec.turn] = {
                "pick": pick,
                "production": d.production_pick,
                "line": line,
                "second_pass": second,
                "evidence": list(getattr(mem, "coverage_evidence", [])),
                "asked": set(mem.asked_competency_keys),
                "wrap_up_offered": mem.wrap_up_offered,
            }
            same = pick == d.production_pick
            delivered = d.production_spoken if same else line
            agent.record_agent_reply(delivered)
            diverged = diverged or not same
            pending_clarify = not same
            continue
        agent._turn_plan = None if rec.turn == 0 else _plan(rec)
        if rec.anchor_swap:
            agent._apply_guard_to_agent_text(rec.spoken)
        if diverged and pending_clarify and rec.mode == MODE_CLARIFY:
            # The candidate asked to clarify the question the CORRECTED agent had
            # just asked; the real clarification path produces it.
            text, _src = agent._clarify_for_current_pack(mem.active_question_text or "")
            agent._turn_plan = TurnPlan(
                question=text,
                competency_key=mem.current_competency_key or None,
                source="clarify_pack",
                response_mode=MODE_CLARIFY,
            )
            agent.record_agent_reply(text)
            pending_clarify = False
            continue
        agent.record_agent_reply(rec.spoken)
    return agent, outcomes


# ── K — Senior HR Specialist, 2026-09-23 20:25 ───────────────────────────────

_K_ANCHORS = [
    "اذكرلي طلب موظف أو مدير، مثل طلب إجازة أو خطاب HR، عالجته بسرعة ودقة؟",
    "شلون تتأكد ان كل employee file وHRIS عندنا محدّثة وصحيحة داخل نظام HRIS؟",
    "اذكرلي موقف اضطررت تطبّق فيه سياسة مثل attendance أو تأخير بحزم، شنو كانت النتيجة؟",
]

SESSION_K = Session(
    name="K",
    position="Senior HR Specialist",
    greeting="حياك الله سيد هاء  واو، نبدأ من خبرتك العملية.",
    anchors=_K_ANCHORS,
    competencies=[
        (
            "employee_records",
            "دقة سجلات الموظفين",
            "critical",
            "اذكرلي موقف لقيت employee file ناقص أو بياناته متضاربة، شلون اكتشفت المشكلة، شنو "
            "سويت علشان تصلّح الملف، وشلون أثّر التصحيح على payroll أو القسم؟",
        ),
        (
            "policy_execution",
            "تطبيق السياسات والإجراءات",
            "critical",
            "اذكرلي موقف اضطريت تطبّق سياسة HR على حالة حضور أو تأخير، شنو كانت خطواتك وكيف "
            "وثّقت القرار، وشصار بالموظف أو الفريق؟",
        ),
        (
            "hr_service_delivery",
            "تقديم خدمات الموارد البشرية",
            "high",
            "اذكرلي حالة طلب خدمة HR (مثل طلب خطاب، تصحيح حضور، أو استفسار مزايا)، شنو الخطوات "
            "اللي سويتها من الاستلام للنهاية، وشلون ضمنت الالتزام بالـ SLA؟",
        ),
        (
            "employee_requests",
            "معالجة طلبات الموظفين",
            "high",
            "اذكرلي مثال على request موظف صَعّب (مثل تعديل رصيد إجازة أو طلب HR letter مستعجل)، "
            "شنو كان دورك، شنو الموافقات اللي حصلت، وشصار بالنهاية؟",
        ),
        (
            "onboarding_support",
            "دعم عملية الانضمام (Onboarding)",
            "high",
            "اذكرلي مرة اشرفت على onboarding لموظف جديد، شنو خطوات الchecklist اللي طبقتها، وكيف "  # noqa: RUF001 — verbatim
            "ضمنت وجود كل المستندات وHRIS entry قبل أول يوم؟",
        ),
        (
            "offboarding_process",
            "تنفيذ إجراءات الخروج (Offboarding)",
            "medium",
            "اذكرلي حالة offboarding اشتغلت عليها، شنو خطواتك لضمان استلام المستندات، إنهاء "
            "الوصولات، وتحديث employee file وHRIS قبل انتهاء الخدمة؟",
        ),
        (
            "confidentiality_data_protection",
            "السرية وحماية بيانات الموظف",
            "high",
            "اذكرلي موقف احتوى على معلومات حساسة (medical note، تأديب، أو بيانات مالية)، شلون "
            "تعاملت وياها لضمان السرية ومنو خليته يوصل للمعلومة؟",
        ),
        (
            "hris_administration",
            "إدارة نظام HRIS وبياناته",
            "high",
            "اذكرلي حالة عدّلت بيانات موظفين في HRIS (مثل job title، bank details، أو leave "
            "balance)، شنو خطوات التحقق والتوثيق قبل وبعد التعديل؟",
        ),
        (
            "compliance_reporting",
            "الامتثال والتقارير الإدارية",
            "medium",
            "اذكرلي مرة أعددت تقرير امتثال أو سجل للتدقيق (مثلاً ملفات كاملة لسنة معينة)، شنو "
            "البيانات اللي جمعتها، وكيف ضمّنت الدقّة والتقديم بالوقت؟",
        ),
        (
            "process_improvement",
            "تحسين الإجراءات وتوحيدها",
            "medium",
            "اذكرلي مبادرة صغيرة سويتها لتحسّن عملية HR (مثل قالب طلب، قوقعات approval، أو "
            "checklist)، شنو المشكلة اللي حليتها، وشنو كانت النتيجة القابلة للقياس؟",
        ),
    ],
    records=[
        Rec(
            0,
            "",
            "",
            "",
            "",
            "شنو خبرتك بموضوع الـ payroll، وياه شنو التحديات اللي واجهتها إذا مرّ عليك؟",
        ),
        Rec(
            1,
            "track_anchor",
            MODE_ASK,
            "",
            _K_ANCHORS[0],
            "شنو، شلون تتابع وتضمن ان كل ملف موظف وHRIS عندنا محدث وصحيح؟",
            anchor_swap=True,
        ),
        Rec(
            3,
            "track_anchor",
            MODE_ASK,
            "",
            _K_ANCHORS[1],
            "شلون تضمن ان كل ملفات الموظفين وHRIS عندنا محدثة وصحيحة؟",
            anchor_swap=True,
        ),
        Rec(
            4,
            "competency_jump",
            MODE_ASK,
            "records_accuracy",
            "شنو خطتك أو إجراءك؟",
            "ماكو مشكلة. حچيلي عن موقف اضطررت تطبّق فيه سياسة مثل attendance أو تأخير بحزم، "
            "شنو كانت النتيجة؟",
        ),
        Rec(
            5,
            "competency_jump",
            MODE_ASK,
            "policy_execution",
            "شلون نفّذت؟",
            "بخصوص دورك كـ Senior HR Specialist، اذكرلي موقف واجهته كان صعب عليك وحاولت تحله؟",
        ),
        Rec(
            10,
            "track_anchor",
            MODE_ASK,
            "context",
            _K_ANCHORS[2],
            "شنو كانت النتيجة بعد ما طبّقت سياسة معينة في قسم الـ HR؟",
        ),
        Rec(
            11,
            "competency_engine",
            MODE_ASK,
            "employee_records",
            "اذكرلي موقف لقيت employee file ناقص أو بياناته متضاربة، شلون اكتشفت المشكلة؟",
            "ماكو مشكلة، نجي لموضوع سجلات الموظفين.  اذكرلي موقف لقيت فيه ملف موظف ناقص أو "
            "بياناته متضاربة، شلون اكتشفت المشكلة وشنو سويت لحلها؟",
        ),
        Rec(13, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            14,
            "competency_engine",
            MODE_ASK,
            "onboarding_support",
            "اذكرلي مرة اشرفت على onboarding لموظف جديد، شنو خطوات الchecklist اللي طبقتها؟",  # noqa: RUF001 — verbatim
            "بخصوص شغل Senior HR Specialist، اذكرلي شنو خبرتك مع نظام الـ payroll وكيف تعاملت "
            "ويه المشاكل اللي ممكن تطلع بيه؟",
        ),
        Rec(16, "", MODE_ASK, "", "", ""),  # decision
    ],
    decisions={
        13: Decision(
            13,
            TurnPlan(
                question="اذكرلي حالة طلب خدمة HR — مثل طلب خطاب، تصحيح حضور، أو استفسار مزايا، "
                "شنو الخطوات اللي سويتها من الاستلام للنهاية؟",
                competency_key="hr_service_delivery",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "employee_requests",
            "شنو، إذا مرّ عليك موقف صعب من موظف بخصوص طلب HR letter أو تعديل رصيد إجازة، "
            "شنو سويت؟",
        ),
        16: Decision(
            16,
            # Source not recorded (a pack step); it does not enter the decision.
            TurnPlan(
                question="شلون ضمنت الجودة أو الدقة؟",
                competency_key="employee_requests",
                source="path_step",
                response_mode=MODE_ASK,
            ),
            "offboarding_process",
            "شنو، شلون تعاملت مع حالة offboarding، وياه شنو الخطوات اللي سويتها حتى تأكدت من "
            "استلام المستندات وإنهاء الوصولات وتحديث الملف وHRIS قبل ما ينتهي عمل الموظف؟",
        ),
    },
)


# ── L — Senior HR Generalist, 2026-09-23 21:44 ───────────────────────────────

_L_ANCHORS = [
    "شنو خبرتك بإدارة قضية employee relations من فتح الملف لحد القرار؟",
    "شنو خبرتك بتطبيق سياسات الإجازات أو attendance لما المدير يطلب استثناء؟",
    "شنو خبرتك بتنفيذ onboarding أو offboarding على HRIS مثل Workday أو BambooHR؟",
]

SESSION_L = Session(
    name="L",
    position="Senior HR Generalist",
    greeting="حياك الله زاي حاء، نبدأ من خبرتك العملية.",
    anchors=_L_ANCHORS,
    competencies=[
        (
            "hr_case_management",
            "إدارة قضايا الموظفين (Employee Relations)",
            "critical",
            "اذكرلي مثال على قضية employee relations اللي تابعتها من intake لحد القرار، وشرح شنو "
            "فعلت والنتيجة الموثقة؟",
        ),
        (
            "hr_compliance",
            "الامتثال وقانون العمل",
            "critical",
            "اذكرلي موقف اضطريت تتخذ قرار HR يتأثر بقانون العمل العراقي، وشنو كانت خطواتك "
            "والنتيجة؟",
        ),
        (
            "hr_policy_application",
            "تطبيق سياسات HR",
            "high",
            "اذكرلي موقف طلب فيه المدير استثناء من سياسة HR، وشنو كان قرارك وشلون وثقت التطبيق؟",
        ),
        (
            "hr_operations_and_transactions",
            "عمليات HR والـ HRIS",
            "high",
            "اذكرلي مثال عملي عدّلت أو نفذت تغيير بيانات على HRIS لموظف واحد أو دفعة، وشنو كانت "
            "النتيجة؟",
        ),
        (
            "employee_lifecycle_management",
            "إدارة دورة حياة الموظف",
            "high",
            "اذكرلي حالة أثّرت بيها على تجربة موظف من التعيين لحد الخروج، وشنو التحسينات اللي "
            "طبّقتها؟",
        ),
        (
            "documentation_and_audit_readiness",
            "التوثيق وجاهزية التدقيق",
            "medium",
            "اذكرلي موقف انتبهت بيه لنقص بالتوثيق وشنو سويت حتى تكون الملفات جاهزة لتدقيق HR؟",
        ),
        (
            "hr_analytics_reporting",
            "تحليلات و تقارير HR",
            "medium",
            "اذكرلي تقرير HR عملته استخدمت بيه بيانات HRIS لاتخاذ قرار محلي، وشنو أثر القرار؟",
        ),
        (
            "hr_business_partnering",
            "الشراكة مع المدراء وتأثير الأعمال",
            "high",
            "اذكرلي مرة نصحت بيها مدير بخيار HR خلاه يغير قراره، وشنو الحجة والطريقة اللي "
            "استعملتها؟",
        ),
        (
            "policy_design_and_process_improvement",
            "تصميم السياسة وتحسين العمليات",
            "high",
            "اذكرلي مشروع سوّيت بيه تعديل أو سياسة HR جديدة، وشنو التحسين اللي حققته والقياس "
            "المستخدم؟",
        ),
        (
            "onboarding_offboarding_design",
            "تصميم وتحسين onboarding/offboarding",
            "medium",
            "اذكرلي مثال عدلت بيه عملية onboarding أو offboarding، وشنو الخطوات الحاسمة اللي "
            "ضمنت اكتمالها؟",
        ),
    ],
    records=[
        Rec(0, "", "", "", "", "حياك الله زاي حاء، نبدأ من خبرتك العملية."),
        Rec(
            1,
            "track_anchor",
            MODE_ASK,
            "",
            _L_ANCHORS[0],
            "أريد أفهم شلون تتعامل وية قضايا الموظفين.  أقصد مثلاً حالة شكوى أو تظلم، تبدأ من "
            "أول ما توصلك لحد ما توصل لقرار نهائي.  شنو أقرب حالة مرّت عليك وشلون تعاملت وياها؟",
        ),
        Rec(
            2,
            "clarify_pack",
            MODE_CLARIFY,
            "",
            "",
            "خلّيني أبسّطها، مثال واحد يكفي: أريد أفهم شلون تتعامل وية قضايا الموظفين.  أقصد "
            "مثلاً حالة شكوى أو تظلم، تبدأ من أول ما توصلك لحد ما توصل لقرار نهائي.  شنو أقرب "
            "حالة مرّت عليك؟",
        ),
        Rec(
            3,
            "track_anchor",
            MODE_ASK,
            "",
            _L_ANCHORS[1],
            "حچيلي عن شلون تتعامل وية سياسات الإجازات أو الحضور بشغلك.  أقصد مثلاً لما المدير "
            "يطلب استثناء من سياسة معينة، شنو الخطوات اللي تتبعها لتطبيق هذا الاستثناء؟",
        ),
        Rec(
            4,
            "track_anchor",
            MODE_ASK,
            "",
            _L_ANCHORS[2],
            "خلّينا نحچي عن خبرتك بتنفيذ عمليات onboarding أو offboarding.  أقصد إذا اشتغلت على "
            "نظام معلومات الموارد البشرية (HRIS) مثل Workday أو BambooHR، شنو الخطوات اللي "
            "اتبعتها لضمان إن العملية تمت بشكل سليم؟",
        ),
        Rec(
            5,
            "result_followup",
            MODE_FOLLOW_UP,
            "hr_case_management",
            "وشصار بالآخر؟",
            "نجي لقضايا الموظفين.  أقصد مثلاً حالة تظلم أو شكوى، تبدأ من أول ما توصلك لحد ما "
            "توصل لقرار نهائي.  اذكرلي مثال على قضية تابعتها، وشنو الخطوات اللي اتبعتها "
            "والنتيجة اللي وصلت لها؟",
        ),
        Rec(
            6,
            "result_followup",
            MODE_FOLLOW_UP,
            "hr_compliance",
            "وشنو طلع منها؟",
            "نجي لموقف قانون العمل.  أقصد حالة اضطريت تتخذ فيها قرار HR تأثر بقانون العمل "
            "العراقي، مثل موقف كان يحتاج منك تفسير أو تطبيق قانون معين.  اذكرلي مثال على "
            "هالموقف وشنو كانت خطواتك والنتيجة اللي وصلت لها؟",
        ),
        Rec(
            10,
            "hook_followup",
            MODE_ASK,
            "context",
            "شنو الوثيقة الرئيسية اللي استخدمتها لتثبت ادعاءات القضية؟",
            "يهمّني أعرف الوثيقة الرئيسية اللي استخدمتها لتثبت ادعاءات القضية اللي ذكرتها.  "
            "يعني شنو كانت المستندات أو الأدلة اللي اعتمدت عليها حتى تدعم قرارك؟",
        ),
        Rec(
            11,
            "competency_engine",
            MODE_ASK,
            "hr_compliance",
            "اذكرلي موقف اضطريت تتخذ قرار HR يتأثر بقانون العمل العراقي؟",
            "نجي لموقف قانون العمل.  أريد أفهم خبرتك بقرار HR تأثر بقانون العمل العراقي.  يعني "
            "مثلاً، إذا كان عندك موقف احتجت فيه تطبق قانون معين أو تفسر سياسة، شنو كانت الحالة "
            "وشنو سويت؟",
        ),
        Rec(
            12,
            "result_followup",
            MODE_FOLLOW_UP,
            "hr_policy_application",
            "وشلون انتهت؟",
            "نجي لموقف طلب فيه المدير استثناء من سياسة HR.  أقصد مثلاً، إذا كان عندك حالة طلب "
            "فيها المدير استثناء من سياسة معينة، شنو كانت الحالة، وشنو كان قرارك، وشلون وثقت "
            "التطبيق؟",
        ),
        Rec(15, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            16,
            "clarify_pack",
            MODE_CLARIFY,
            "employee_lifecycle_management",
            "",
            "أوضّحها بشكل أبسط: شنو، إذا مرّ عليك موقف أثر على تجربة موظف من يوم ما انقبل لحد "
            "ما طلع من الشركة؟",
        ),
        Rec(17, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            18,
            "clarify_pack",
            MODE_CLARIFY,
            "documentation_and_audit_readiness",
            "",
            "خلّي أعيد صياغتها، مثال واحد يكفي: أقصد موقف من هالنوع -- مثلاً اجتياز تدقيق أو "
            "تقليل ملاحظات المدقق.  شنو أقرب حالة مرّت عليك؟",
        ),
        Rec(20, "", MODE_ASK, "", "", ""),  # decision
    ],
    decisions={
        15: Decision(
            15,
            # The reply after the silent-wait timeout: no planned question.
            TurnPlan(question="", response_mode=MODE_ASK, source="wait_timeout"),
            "employee_lifecycle_management",
            "شنو، إذا مرّ عليك موقف أثر على تجربة موظف من يوم ما انقبل لحد ما طلع من الشركة؟",
        ),
        17: Decision(
            17,
            TurnPlan(
                question="شلون نفّذت؟",
                competency_key="employee_lifecycle",
                source="competency_jump",
                response_mode=MODE_ASK,
            ),
            "documentation_and_audit_readiness",
            "شنو، بخصوص شغلك كـ Senior HR Generalist، اذكرلي موقف مرّ عليك حسيت بيه إنه "
            "التوثيق مو كافي؟",
        ),
        20: Decision(
            20,
            TurnPlan(
                question="اذكرلي موقف طلب فيه المدير استثناء من سياسة HR؟",
                competency_key="hr_policy_application",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "wrap_up",
            "شكراً على وقتك وإجاباتك. أعتقد غطّينا المحاور الأساسية — أكو شي تحب تضيفه قبل ما "
            "نختم المقابلة؟",
        ),
    },
)
