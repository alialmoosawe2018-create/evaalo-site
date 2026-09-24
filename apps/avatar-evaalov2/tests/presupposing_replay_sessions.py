"""Decision-point replays of K, (A) and M for release 1 (not a test module).

Release 1 sends a PRESUPPOSING rejection to P4, like a duplicate, and keeps what
was ATTEMPTED apart from what was DELIVERED. These replays use the method of
``p4_replay_sessions.py`` (whose K session and helpers they reuse): each turn's
PLAN comes from the production turn log, and everything the guard and P4 read
runs through the real agent. Three additions:

* Candidate turns. On this path the only reader of what the candidate said is
  ``presupposes_unstated_act``, and it only looks for a first-person act verb.
  So every candidate line here is synthetic and carries exactly the verbs its
  original did: one «واجهت» in K, none in (A) or M. Turn order stands in for
  timestamps.
* Presupposing decision points. Where production did not keep the rejected model
  text, the stand-in is a question the guard rejects for presupposing and for
  nothing else.
* Gating. ``gate=True`` switches off P4's presupposing branch — the behaviour
  production ran — so one replay shows both "before" and "after".
  ``target=turn`` isolates one decision: every earlier decision is gated, so the
  target sees production's own history.

Agent lines that repeated what a candidate said were replaced with neutral
synthetic lines; the replays' decisions and state are identical either way
(checked when the fixture was made). Blueprint objectives and anchors are job
text and are kept as they were.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from p4_replay_sessions import SESSION_K, Rec, build_agent

from voice_interview.active_question import (
    MODE_ASK,
    MODE_CLARIFY,
    MODE_FOLLOW_UP,
    TurnPlan,
)
from voice_interview.assistant import _WRAP_UP_PROMPT_AR, InterviewAssistant
from voice_interview.entity_policy import DIFFICULTY_FOLLOWUP_POOL
from voice_interview.heuristics import normalize_text

__all__ = ["SESSION_A", "SESSION_K5", "SESSION_M", "PDecision", "PSession", "replay"]


@dataclass
class PDecision:
    """A turn where production's guard rejected the model's question."""

    turn: int
    plan: TurnPlan
    reason: str  # what production's guard logged: "duplicate" or "presupposing"
    production_pick: str
    production_spoken: str
    # The rejected model text. None: the previous question verbatim (a duplicate).
    stand_in: str | None = None


@dataclass
class PSession:
    name: str
    position: str
    greeting: str
    anchors: list[str]
    competencies: list[tuple[str, str, str, str]]  # key, title, priority, objective
    records: list[Rec]
    decisions: dict[int, PDecision]
    # turn → what the candidate said before it (synthetic).
    candidate_lines: dict[int, tuple[str, ...]]
    # turn → anchors (0-based) already spent before it, where production's own
    # choices prove it but the replay cannot re-derive it (see M).
    spend_anchors_before: dict[int, tuple[int, ...]] = field(default_factory=dict)

    def keys(self) -> set[str]:
        return {k for k, _, _, _ in self.competencies}

    def titles(self) -> dict[str, str]:
        return {k: t for k, t, _, _ in self.competencies}


def classify(
    agent: InterviewAssistant, line: str, decision_plan: TurnPlan, anchors: list[str]
) -> str:
    if line.strip() == _WRAP_UP_PROMPT_AR.strip():
        return "wrap_up"
    if line in DIFFICULTY_FOLLOWUP_POOL:
        return "bridge"
    plan = agent._turn_plan
    if plan is not decision_plan and plan is not None and plan.competency_key:
        return plan.competency_key
    said = normalize_text(line)
    for i, anchor in enumerate(anchors):
        key = normalize_text(anchor).rstrip("؟? ")
        if key and key in said:
            return f"anchor#{i + 1}"
    return "unchanged"


def state(agent: InterviewAssistant, keys: set[str]) -> dict[str, Any]:
    """What P4 and the pickers read, plus the two coverage sets."""
    mem = agent._memory
    return {
        "attempted": sorted(mem.asked_competency_keys & keys),
        "attempted_all": sorted(mem.asked_competency_keys),
        "delivered": sorted(getattr(mem, "delivered_competency_keys", set()) & keys),
        "evidence": list(mem.coverage_evidence),
        "recent": list(mem.asked_questions[-12:]),
        "asked_question_keys": sorted(mem.asked_question_keys),
        "ledger": dict(sorted(mem.subject_coverage.states.items())),
        "current_competency_key": mem.current_competency_key,
        "wrap_up_offered": mem.wrap_up_offered,
    }


async def _no_model(_bare: str) -> str:
    """No LLM here: an empty rewrite keeps the question as it is."""
    return ""


def replay(
    session: PSession, *, gate: bool = False, target: int | None = None
) -> tuple[InterviewAssistant, dict[int, dict[str, Any]]]:
    """Run the session; return the agent and, per decision turn, what happened.

    Each decision runs production's two passes — guard + reframe on the model's
    text (tts_node), then on what was spoken (transcription_node). After a
    decision whose pick matches production, production's spoken line is
    recorded; after one that differs, the guard's own line is — the corrected
    interview from then on.
    """
    agent = build_agent(session)
    agent._regenerate_framed_question = _no_model
    mem = agent._memory
    keys = session.keys()
    gated = {"on": gate}
    live_p4 = agent._swap_duplicate_for_uncovered_competency

    def p4(turn: int, recent: list[str], *args: Any, **kwargs: Any) -> str | None:
        reason = kwargs.get("reason", args[0] if args else "duplicate")
        if reason == "presupposing" and gated["on"]:
            return None
        return live_p4(turn, recent, *args, **kwargs)

    agent._swap_duplicate_for_uncovered_competency = p4
    agent.mark_verbatim(session.greeting)
    # The worker pre-seeds the first anchor as the current topic.
    mem.current_topic = session.anchors[0]
    mem.last_sample = session.anchors[0]
    outcomes: dict[int, dict[str, Any]] = {}
    opened = False
    for rec in session.records:
        mem.candidate_turns.extend(session.candidate_lines.get(rec.turn, ()))
        if rec.turn != 0 and not opened:
            # The first candidate turn "advances", which marks the pre-seeded
            # anchor asked (see p4_replay_sessions.replay).
            opened = True
            first = None if rec.turn in session.decisions else rec
            agent._turn_recommended = first.planned if first else ""
            agent._turn_recommended_source = first.source if first else ""
            agent._update_memory_post_decision({}, "advance")
        for i in session.spend_anchors_before.get(rec.turn, ()):
            mem.asked_question_keys.add(normalize_text(session.anchors[i]))
        mem.turn_index = rec.turn
        decision = session.decisions.get(rec.turn)
        if decision is not None:
            gated["on"] = gate or (target is not None and rec.turn != target)
            agent._turn_plan = decision.plan
            model_text = (
                decision.stand_in
                if decision.stand_in is not None
                else mem.asked_questions[-1]
            )
            before = state(agent, keys)
            line = asyncio.run(
                agent.reframe_bare_question(
                    agent._apply_guard_to_agent_text(model_text)
                )
            )
            second = asyncio.run(
                agent.reframe_bare_question(agent._apply_guard_to_agent_text(line))
            )
            pick = classify(agent, line, decision.plan, session.anchors)
            swap = agent._guard_swap
            outcomes[rec.turn] = {
                "pick": pick,
                "production": decision.production_pick,
                "reason": decision.reason,
                "model_text": model_text,
                "line": line,
                "second_pass": second,
                "swap": dict(swap[1])
                if swap is not None and swap[0] == rec.turn
                else None,
                "before": before,
            }
            same = pick == decision.production_pick
            agent.record_agent_reply(decision.production_spoken if same else line)
            outcomes[rec.turn]["after"] = state(agent, keys)
            if rec.turn == target:
                break
            continue
        agent._turn_plan = (
            None
            if rec.turn == 0
            else TurnPlan(
                question=rec.planned or None,
                competency_key=rec.competency or None,
                source=rec.source,
                response_mode=rec.mode or MODE_ASK,
            )
        )
        if rec.anchor_swap:
            agent._apply_guard_to_agent_text(rec.spoken)
        agent.record_agent_reply(rec.spoken)
    return agent, outcomes


# ── (A) — HR Business Partner ────────────────────────────────────────────────

SESSION_A = PSession(
    name="A",
    position="HR Business Partner",
    greeting="حياك الله ألف ياء، نبدأ من خبرتك العملية؟",
    anchors=[
        "شنو خبرتك بتنسيق المقابلات على ATS مثل Greenhouse أو Workable؟",
        "شنو خبرتك بالتعامل ويا المديرين على قضايا الأداء باستخدام KPIs؟",
        "شنو خبرتك بإدارة بيانات الموظفين في HRIS مثل SAP HR أو BambooHR؟",
    ],
    competencies=[
        (
            "stakeholder_management",
            "إدارة أصحاب المصلحة",
            "critical",
            "اذكرلي موقف واقعي وين احتجيت تتعامل ويا مدير قسم بسبب قرار توظيف أو قضية أداء، شنو سويت بالترتيب وشنو كانت النتيجة الملموسة؟",
        ),
        (
            "recruitment_and_talent_acquisition",
            "التوظيف وإدارة المرشّحين",
            "high",
            "اذكرلي حالة صعبة لتعيين موقف أو تخصص ونفّذتها: شنو قمت به من sourcing لحد العرض وشلون أثّر ذلك على الtime-to-fill أو pipeline؟",  # noqa: RUF001 — verbatim
        ),
        (
            "performance_management",
            "إدارة الأداء وتقييم الكفاءات",
            "high",
            "اذكرلي مثال وين دعمت مدير بقضية أداء (PIP أو مراجعة)، شنو حددت من KPIs وشلون تابعت النتيجة؟",
        ),
        (
            "employee_relations_and_investigations",
            "علاقات الموظفين والتحقيقات",
            "high",
            "اذكرلي حالة شكوى أو نزاع داخلي ولي تمت تحقيق أولي، شنو الخطوات اللي سويتها للحقيقة وكيف انتهت المسألة؟",
        ),
        (
            "hr_data_and_metrics",
            "بيانات الموارد البشرية والتحليلات",
            "high",
            "ذكرلي موقف استخدمت فيه بيانات HR (Excel أو HRIS) لصنع توصية تشغيلية، شنو البيانات اللي جمعتها وشنو أثر التوصية؟",
        ),
        (
            "compliance_and_record_accuracy",
            "الامتثال ودقّة سجلات الموظفين",
            "critical",
            "اذكرلي مرة اكتشفت عدم توافق بسجلات الموظفين أو عقد مع payroll/GL، شنو الخطوات اللي سويتها للتصحيح وشنو النتيجة؟",
        ),
        (
            "process_improvement_and_execution",
            "تحسين العمليات وتنفيذها",
            "medium",
            "اذكرلي مثال حسّنت بيه عملية HR (مثلاً onboarding أو offboarding)، شنو التغيير اللي طبّقته وشلون قست الفرق؟",
        ),
        (
            "compensation_and_offer_management",
            "التعويضات وإدارة العروض",
            "medium",
            "اذكرلي مرة حضرت فيها عرض توظيف أو عدّلت تعويض، شنو أساس التغيير وشلون نسقته ويا المدير وPayroll؟",
        ),
        (
            "learning_and_development_coordination",
            "التدريب وتنسيق التطوير",
            "medium",
            "اذكرلي مشروع تدريب نسّقته عشان حاجة عمل، شنو تحليل الاحتياج، كيف نُفّذ، وشنو نتيجة قيستها؟",
        ),
        (
            "change_advising_and_implementation",
            "استشارة وتنفيذ التغيير التنظيمي",
            "medium",
            "اذكرلي مرة دعمت تغيير تنظيمي أو تعديل سياسة، شنو نصحت، كيف نُفّذ التغيير، وشنو أثره على الموظفين؟",
        ),
    ],
    records=[
        Rec(0, "", "", "", "", "حياك الله ألف ياء، نبدأ من خبرتك العملية؟"),
        Rec(
            2,
            "track_anchor",
            MODE_ASK,
            "",
            "شنو خبرتك بالتعامل ويا المديرين على قضايا الأداء باستخدام KPIs؟",
            "يهمّني أعرف قضايا الأداء.  أقصد كيف تتعامل ويا المديرين لما يكون عندهم قضايا تتعلق بأداء الموظفين، مثل استخدام KPIs لتقييم الأداء وتحسينه.  شنو كانت تجربتك في هذا المجال، وشنو الخطوات اللي اتبعتها؟",
        ),
        Rec(
            4,
            "track_anchor",
            MODE_ASK,
            "",
            "شنو خبرتك بإدارة بيانات الموظفين في HRIS مثل SAP HR أو BambooHR؟",
            "خلّينا نحچي عن خبرتك بإدارة بيانات الموظفين.  أقصد كيف تتعامل ويا نظام معلومات الموارد البشرية (HRIS) مثل SAP HR أو BambooHR، وشلون تستخدمه لتحديث سجلات الموظفين أو متابعة الأداء.  شنو كانت تجربتك مع هالأنظمة؟",
        ),
        Rec(
            6,
            "bank",
            MODE_ASK,
            "",
            "",
            "بخصوص شغلك كـ HR Business Partner، شنو خبرتك بتحديث سجلات الموظفين؟",
        ),
        Rec(
            8,
            "competency_engine",
            MODE_ASK,
            "stakeholder_management",
            "اذكرلي موقف واقعي وين احتجيت تتعامل ويا مدير قسم بسبب قرار توظيف أو قضية أداء، شنو سويت بالترتيب؟",
            "بخصوص دورك كـ HR Business Partner، شنو سويت بعدها بالخطوة الثانية؟",
        ),
        Rec(
            9,
            "result_followup",
            MODE_FOLLOW_UP,
            "compliance_and_record_accuracy",
            "وشنو طلع منها؟",
            "أريد أفهم عن دقة سجلات الموظفين.  أقصد إذا صادفت حالة اكتشفت فيها عدم توافق بسجلات الموظفين أو عقد مع قسم الرواتب، شنو كانت الخطوات اللي اتبعتها لتصحيح هذا الخطأ؟",
        ),
        Rec(10, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            11,
            "competency_engine",
            MODE_ASK,
            "performance_management",
            "اذكرلي مثال وين دعمت مدير بقضية أداء — PIP أو مراجعة، شنو حددت من KPIs؟",
            "بخصوص دعمك للمديرين بقضايا الأداء، أريد أفهم عن موقف ساعدت فيه مدير بقضية أداء، مثل خطة تحسين الأداء (PIP) أو مراجعة.  شنو كانت KPIs اللي حددتها، وشلون تابعت النتيجة؟",
        ),
        Rec(13, "", MODE_ASK, "", "", ""),  # decision
        Rec(16, "", MODE_ASK, "", "", ""),  # decision
        Rec(17, "", MODE_ASK, "", "", ""),  # decision
    ],
    decisions={
        10: PDecision(
            10,
            TurnPlan(
                question="اذكرلي مرة اكتشفت عدم توافق بسجلات الموظفين أو عقد مع الرواتب/GL، شنو الخطوات اللي سويتها للتصحيح؟",
                competency_key="compliance_and_record_accuracy",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "duplicate",
            "recruitment_and_talent_acquisition",
            "بخصوص شغلك كـ HR Business Partner، اذكرلي موقف صعب واجهته وانت تسوي sourcing للموظفين، شنو الخطوات اللي اتبعتها لحد ما وصلت للعرض؟",
            stand_in=None,
        ),
        13: PDecision(
            13,
            TurnPlan(
                question="اذكرلي حالة شكوى أو نزاع داخلي ولي تمت تحقيق أولي، شنو الخطوات اللي سويتها للحقيقة؟",
                competency_key="employee_relations_and_investigations",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "presupposing",
            "bridge",
            "بخصوص دورك كـ HR Business Partner، شنو الشي اللي تحس لازم تسوي بشكل مختلف إذا ترجع لموقف صعب مر عليك؟",
            stand_in="اذكرلي حالة شكوى أو نزاع داخلي ولي تمت تحقيق أولي، شنو الخطوات اللي سويتها للحقيقة؟",
        ),
        16: PDecision(
            16,
            TurnPlan(
                question="اذكرلي مثال حسّنت بيه عملية HR — مثلاً onboarding أو offboarding، شنو التغيير اللي طبّقته؟",
                competency_key="process_improvement_and_execution",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "presupposing",
            "bridge",
            "شنو، شلون واجهت تحدي صعب كـ HR Business Partner، وشنو سويت حتى تحلّه؟",
            stand_in="اذكرلي مثال حسّنت بيه عملية HR — مثلاً onboarding أو offboarding، شنو التغيير اللي طبّقته؟",
        ),
        17: PDecision(
            17,
            TurnPlan(
                question="",
                competency_key="process_improvement_and_execution",
                source="bank",
                response_mode=MODE_ASK,
            ),
            "presupposing",
            "wrap_up",
            "شكراً على وقتك وإجاباتك. أعتقد غطّينا المحاور الأساسية — أكو شي تحب تضيفه قبل ما نختم المقابلة؟",
            stand_in="شنو النتيجة بعد التغيير اللي طبّقته؟",
        ),
    },
    candidate_lines={
        2: ("جواب اصطناعي.",),
        4: ("جواب اصطناعي.", "جواب اصطناعي."),
        6: ("جواب اصطناعي.",),
        8: ("جواب اصطناعي.", "جواب اصطناعي."),
        9: ("جواب اصطناعي.",),
        10: ("جواب اصطناعي.",),
        11: ("جواب اصطناعي.",),
        13: ("جواب اصطناعي.",),
        16: ("جواب اصطناعي.",),
        17: ("جواب اصطناعي.",),
    },
)


# ── M — Senior Recruiter ─────────────────────────────────────────────────────

SESSION_M = PSession(
    name="M",
    position="Senior Recruiter",
    greeting="حياك الله سين صاد، نبدأ من خبرتك العملية.  اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
    anchors=[
        "شنو خبرتك بدور كان صعب الاستقطاب، مثل Senior Backend او مهندس شبكات؟",
        "شنو خبرتك بأخذ متطلبات الدور من المدير قبل ما تبدأ البحث؟",
        "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي عادةً؟",
    ],
    competencies=[
        (
            "role_intake_manager_alignment",
            "مطابقة متطلبات الدور وطلب المدير",
            "critical",
            "اذكرلي موقف كان لازم تترجم احتياجات مدير توظيف إلى مواصفات دور قابلة للتنفيذ، اشرح شنو سويت بالتحديد وشنو النتيجة اللي حصلت عليها على الـpipeline أو على جودة المرشحين؟",  # noqa: RUF001 — verbatim
        ),
        (
            "sourcing_strategy_channels",
            "استراتيجية الاستقطاب واختيار القنوات",
            "critical",
            "اذكرلي موقف حطّيت استراتيجية sourcing لدور Senior، شنو القنوات اللي اخترتها وليش، وشنو أثر هالاختيارات على عدد المرشحين المؤهلين خلال أول أسبوعين؟",
        ),
        (
            "pipeline_and_ats_management",
            "إدارة المسار والـATS",  # noqa: RUF001 — verbatim
            "high",
            "اذكرلي موقف كان لازم تنظّم الـpipeline في ATS لعدة مرشحين وتتابع تقدمهم، شنو الإجراءات اللي طبقتها وكيف أثّر هالشي على دقة التنبؤ بالتوظيف؟",  # noqa: RUF001 — verbatim
        ),
        (
            "structured_interview_evaluation",
            "المقابلات المهيكلة وتقييم المرشحين",
            "high",
            "اذكرلي موقف استخدمت فيه structured interview او scorecard لتقييم مرشحين، اشرح شنو كانت المعايير، كيف درّبت المقابلين، وشنو أثر هالنهج على قرارات العرض؟",
        ),
        (
            "recruiting_metrics_reporting",
            "قياس أداء التوظيف والتقارير",
            "high",
            "اذكرلي مثال لما استخدمت metrics زي time-to-fill أو offer acceptance لتحسين عملية توظيف، اش رحّلت وشنو القرار اللي اتخذته بناءً على هالبيانات؟",
        ),
        (
            "candidate_experience_ownership",
            "تجربة المرشح وامتلاك رحلة التوظيف",
            "high",
            "اذكرلي موقف حسّنت به تجربة المرشحين (الاستجابة، التواصل، أو مراحل المقابلة)، شنو الخطوات اللي سويتها وشنو أثرها على نسبة الاستمرار أو الانسحاب؟",
        ),
        (
            "hard_to_fill_recruitment",
            "التعامل مع أدوار صعبة الاستقطاب",
            "high",
            "اذكرلي مثال دور صعب تعبّيه، شنو takedowns اللي جرّبتها (قنوات، عروض، sourcing techniques) وشنو النتيجة النهائية من ناحية time-to-fill أو جودة المرشح؟",
        ),
        (
            "boolean_search_and_advanced_sourcing",
            "بحث Boolean وتكنيكات الاستقطاب المتقدّمة",
            "medium",
            "اذكرلي موقف استخدمت فيه Boolean search أو تقنيات sourcing متقدمة للعثور على مرشح نادر، اشرح الشروط والنتيجة (عدد اتصالات ناجحة أو مرشحين مؤهلين)?",
        ),
        (
            "offer_management_and_negotiation",
            "إدارة العروض والتفاوض",
            "medium",
            "اذكرلي موقف اضطريت تفاوض عليه بخصوص عرض لوظيفة Senior، شنو كانت نقطة الخلاف، شنو الاقتراحات اللي قدمتها، وشنو كانت نتيجة التفاوض؟",
        ),
        (
            "stakeholder_influence_and_hiring_coaching",
            "التأثير على أصحاب المصلحة وتدريب المديرين",
            "medium",
            "اذكر موقف كان لازم تقنع مدير بتغيير التوقعات أو طريقة التقييم، اشرح شنو قدمت من بيانات او أمثلة وكيف تغيّر سلوك المدير والنتيجة على عملية التوظيف؟",
        ),
    ],
    records=[
        Rec(
            0,
            "",
            "",
            "",
            "",
            "حياك الله سين صاد، نبدأ من خبرتك العملية.  اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
        ),
        Rec(
            7,
            "path_step",
            MODE_ASK,
            "role_intake_alignment",
            "شلون تتفق وية المدير على المتطلبات الضرورية مقابل المفضّلة؟",
            "حچيلي عن شلون تتفق وية المدير على المتطلبات الضرورية للدور مقابل المتطلبات المفضلة.  أقصد، مثلاً، كيف تحدد شنو الأشياء الأساسية اللي لازم تتوفر بالمرشح، وشنو الأشياء اللي ممكن تكون مرنة أو قابلة للتعديل؟",
        ),
        Rec(12, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            17,
            "path_step",
            MODE_ASK,
            "recruiting_metrics",
            "شنو مؤشر واحد تتابعه دايماً بخط المرشحين؟",
            "نجي لمؤشرات الأداء. أقصد، شنو مؤشر واحد تتابعه دائماً بخط المرشحين، مثل الوقت اللي ياخذه ملء الشاغر أو فعالية قنوات الاستقطاب؟",
        ),
        Rec(
            18,
            "clarify_pack",
            MODE_CLARIFY,
            "recruiting_metrics",
            "مثلاً Time to Fill أو Offer Acceptance — أي واحد من هذني تتابعه أكثر؟",
            "عندنا مؤشرات مثل الوقت اللي يحتاجه ملء الشاغر أو نسبة قبول العروض.  هالمؤشرات تساعدنا نفهم شلون تسير عملية التوظيف.  مثلاً، شنو من هالمؤشرات تتابعه أكثر؟",
        ),
        Rec(
            19,
            "bank",
            MODE_ASK,
            "recruiting_metrics",
            "",
            "بخصوص شغل Senior Recruiter، إذا واجهت صعوبة بتوظيف شخص معين، شنو الطرق اللي جربتها حتى تحل هالمشكلة؟",
        ),
        Rec(
            24,
            "bank",
            MODE_ASK,
            "recruiting_metrics",
            "",
            "شنو تجربتك بخصوص تقييم المرشحين باستخدام المقابلات المهيكلة أو scorecards؟ اذكرلي شلون سويتها إذا مرّ عليك.",
        ),
        Rec(
            25,
            "clarify_pack",
            MODE_CLARIFY,
            "recruiting_metrics",
            "أوضّحها بشكل أبسط: شنو تجربتك بخصوص تقييم المرشحين باستخدام المقابلات المهيكلة أو scorecards؟",
            "أوضّحها بشكل أبسط: شنو تجربتك بخصوص تقييم المرشحين باستخدام المقابلات المهيكلة أو بطاقة تقييم؟",
        ),
        Rec(
            27,
            "bank",
            MODE_ASK,
            "recruiting_metrics",
            "",
            "بخصوص دورك كـ Senior Recruiter، اذكرلي شلون تنظّم وقتك بين أكثر من طلب توظيف؟",
        ),
        Rec(
            30,
            "competency_engine",
            MODE_ASK,
            "role_intake_manager_alignment",
            "اذكرلي موقف كان لازم تترجم احتياجات مدير توظيف إلى مواصفات دور قابلة للتنفيذ، اشرح شنو سويت بالتحديد؟",
            "خذني بموقف كان لازم تترجم احتياجات المدير إلى مواصفات دور واضحة وقابلة للتنفيذ.  مثلاً، كيف حددت المهارات والخبرات المطلوبة، وشنو الخطوات اللي اتبعتها لتوثيق هالمتطلبات؟",
        ),
        Rec(
            31,
            "clarify_pack",
            MODE_CLARIFY,
            "role_intake_manager_alignment",
            "مثلاً وظيفة تقنية أو إدارية — شلون تاخذ متطلبات الدور من المدير قبل ما تبدي؟",
            "مثلاً وظيفة تقنية أو إدارية -- شلون تاخذ متطلبات الدور من المدير قبل ما تبدي؟",
        ),
        Rec(
            33,
            "competency_engine",
            MODE_ASK,
            "sourcing_strategy_channels",
            "اذكرلي موقف حطّيت استراتيجية sourcing لدور Senior، شنو القنوات اللي اخترتها وليش؟",
            "بخصوص شغل الـ Senior Recruiter، اذكرلي تجربة سابقة لك بعملية اختيار المرشحين، شلون كنت تتعامل وياهم؟",
        ),
        Rec(
            34,
            "clarify_pack",
            MODE_CLARIFY,
            "sourcing_strategy_channels",
            "أقصد ببساطة: بخصوص شغل الـ Senior Recruiter، اذكرلي تجربة سابقة لك بعملية اختيار المرشحين، شلون كنت تتعامل وياهم؟",
            "أقصد ببساطة: بخصوص شغل الـ Senior Recruiter، اذكرلي تجربة سابقة لك بعملية اختيار المرشحين، شلون كنت تتعامل وياهم؟",
        ),
        Rec(35, "", MODE_ASK, "", "", ""),  # decision
        Rec(
            36,
            "competency_engine",
            MODE_ASK,
            "structured_interview_evaluation",
            "اذكرلي موقف استخدمت فيه structured interview او scorecard لتقييم مرشحين، اشرح شنو كانت المعايير، كيف درّبت المقابلين؟",
            "بخصوص شغلك كـ Senior Recruiter، شنو الطرق اللي تستخدمها لتنظيم عملية التوظيف والمرشحين؟",
        ),
        Rec(
            38,
            "hook_followup",
            MODE_ASK,
            "sourcing",
            "احچيلي عن مرّة استخدمت بيها أداة معيّنة فعلياً؟",
            "بخصوص شغلك كـ Senior Recruiter، اذكرلي موقف كان عندك فيه تحدي بالتوظيف، شنو سويت وشنو كانت النتيجة؟",
        ),
        Rec(
            39,
            "",
            "",
            "",
            "",
            "بخصوص دورك كـ Senior Recruiter، شنو التحديات اللي تواجه أي مسؤول توظيف؟",
        ),
        Rec(40, "", MODE_ASK, "", "", ""),  # decision
    ],
    decisions={
        12: PDecision(
            12,
            TurnPlan(
                question="اذكرلي دور ما لقيت له مرشح بسرعة — شنو سويت؟",
                competency_key="hard_to_fill_roles",
                source="path_step",
                response_mode=MODE_ASK,
            ),
            "presupposing",
            "anchor#3",
            "شنو القنوات اللي تستخدمها عادةً حتى تجيب مرشحين للوظايف؟",
            stand_in="اذكرلي الدور اللي ما لقيت له مرشح بسرعة، شنو سويت؟",
        ),
        35: PDecision(
            35,
            TurnPlan(
                question="الأفضل تبدأ بخطوة واضحة وقصيرة حسب السياسة عندكم، ثم تكيّف الخطة حسب النتيجة. لو واجهت هالموقف، شنو أول إجراء تفكر تسويه؟",
                competency_key="sourcing_strategy_channels",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "duplicate",
            "pipeline_and_ats_management",
            "شنو، شلون نظمت الـpipeline في نظام تتبّع المتقدّمين لمرشحين عدة؟ اذكرلي الإجراءات اللي اتبعتها.",  # noqa: RUF001 — verbatim
            stand_in=None,
        ),
        40: PDecision(
            40,
            TurnPlan(
                question="شنو المؤشرات اللي تتابعها بشكل دوري بعملية التوظيف؟",
                competency_key="metrics",
                source="competency_engine",
                response_mode=MODE_ASK,
            ),
            "duplicate",
            "recruiting_metrics_reporting",
            "شنو، بخصوص شغلك كـ Senior Recruiter، اذكرلي موقف استخدمت بيه metrics مثل time-to-fill أو offer acceptance حتى تحسن عملية التوظيف. شنو سويت؟",
            stand_in=None,
        ),
    },
    candidate_lines={
        7: ("جواب اصطناعي.",),
        12: ("جواب اصطناعي.",),
        17: ("جواب اصطناعي.",),
        18: ("جواب اصطناعي.",),
        19: ("جواب اصطناعي.",),
        24: ("جواب اصطناعي.", "جواب اصطناعي."),
        25: ("جواب اصطناعي.",),
        27: ("جواب اصطناعي.",),
        30: ("جواب اصطناعي.", "جواب اصطناعي."),
        31: ("جواب اصطناعي.",),
        33: ("جواب اصطناعي.",),
        34: ("جواب اصطناعي.",),
        35: ("جواب اصطناعي.",),
        36: ("جواب اصطناعي.",),
        38: ("جواب اصطناعي.", "جواب اصطناعي."),
        39: ("جواب اصطناعي.",),
    },
    # Production-implied: turns 1-6 were silent (no agent message between the
    # greeting and turn 7), and at turn 12 the guard delivered anchor 3 — so
    # anchor 2 was already spent; and at turn 40 it found no fresh anchor —
    # so anchor 3 was spent too (the bank turns that most likely spent it
    # logged no planned text). The replay does not run those turns.
    spend_anchors_before={7: (1,), 17: (2,)},
)


K_CANDIDATE_LINES = {
    1: ("جواب اصطناعي.",),
    3: ("جواب اصطناعي.",),
    4: ("جواب اصطناعي.",),
    5: ("جواب اصطناعي.",),
    10: ("واجهت هالشي بالشغل.", "جواب اصطناعي."),
    11: ("جواب اصطناعي.",),
    13: ("جواب اصطناعي.",),
    14: ("جواب اصطناعي.",),
    16: ("جواب اصطناعي.", "جواب اصطناعي."),
}


# ── K — Senior HR Specialist, with its turn-5 presupposing decision ──────────
#
# SESSION_K (p4_replay_sessions.py) records turn 5 as the bridge production
# spoke. Here it is a decision: the plan was «شلون نفّذت؟» (a pack step) and the
# model's rejected wording was not stored.

SESSION_K5 = PSession(
    name="K",
    position=SESSION_K.position,
    greeting=SESSION_K.greeting,
    anchors=SESSION_K.anchors,
    competencies=SESSION_K.competencies,
    records=[
        Rec(5, "", MODE_ASK, "", "", "") if r.turn == 5 else r
        for r in SESSION_K.records
    ],
    decisions={
        5: PDecision(
            5,
            TurnPlan(
                question="شلون نفّذت؟",
                competency_key="policy_execution",
                source="competency_jump",
                response_mode=MODE_ASK,
            ),
            "presupposing",
            "bridge",
            next(r.spoken for r in SESSION_K.records if r.turn == 5),
            stand_in="شلون نفّذت القرار اللي طبّقته وياه؟",
        ),
        **{
            turn: PDecision(
                turn,
                d.plan,
                "duplicate",
                d.production_pick,
                d.production_spoken,
                stand_in=None,
            )
            for turn, d in SESSION_K.decisions.items()
        },
    },
    candidate_lines=K_CANDIDATE_LINES,
)
