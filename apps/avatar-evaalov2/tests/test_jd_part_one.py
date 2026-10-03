"""Part one: the interview opens with three questions written from the job description.

What the owner decided (2026-10-03), and what these tests hold the agent to:
  * the three questions REPLACE the three anchors and open every interview of the
    campaign, in order, whatever the career level — the senior/entry tracks
    otherwise swap anchors for universal openers;
  * at most one follow-up per question — written for the candidate's answer by
    a small model call that sees the question and the answer only (never the
    next question), kept in the situation and the future tense; when there is
    nothing worth probing, the next question instead of a generic probe (owner,
    2026-10-04); a safety net of eight utterances for the whole part;
  * no competency key is set or spent during part one;
  * the greeting asks question 1, and it is not asked again;
  * «شنو تقصد؟» gets the question's own clarification first;
  * «خلّينا نغيّر السؤال» moves to the next question, not into the competencies;
  * one fixed transition sentence, without «؟», before the first question after
    part one — deferred by a clarification, dropped by a closing;
  * without description questions nothing changes.

Each turn runs the real picker (on_user_turn_completed), both guard passes and
record_agent_reply; the model is replaced by "it says the recommended question".
Synthetic job, questions and answers.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from p4_replay_sessions import _router

from voice_interview import worker
from voice_interview.active_question import MODE_CLARIFY, MODE_FOLLOW_UP
from voice_interview.assistant import InterviewAssistant
from voice_interview.entity_policy import collapse_to_single_question
from voice_interview.heuristics import normalize_text
from voice_interview.jd_part_one import (
    JdQuestion,
    build_jd_followup_messages,
    clean_jd_followup,
    jd_clarification,
    jd_greeting_lead,
    jd_transition_line,
    parse_jd_questions,
)

JD = [
    JdQuestion(
        "q1",
        "صرف الرواتب، إذا اكتشفت قبل يوم الصرف إن ساعات الإضافي لقسم كامل محسوبة غلط، شلون راح تتصرف؟",
        "مثلاً جهاز البصمة سجّل الإضافي مرتين لنفس الموظفين",
        "payroll run",
    ),
    JdQuestion(
        "q2",
        "مراجعة الحضور، إذا لگيت إجازات مسجلة بدون موافقة المدير، شنو أول شي راح تتأكد منه؟",
        "مثلاً موظف عنده ثلاث أيام إجازة بالنظام وما أكو ورقة موقعة",
        "attendance review",
    ),
    JdQuestion(
        "q3",
        "استفسارات الموظفين، إذا موظف اعترض على خصم براتبه، شنو راح تگله أول؟",
        "مثلاً خصم سلفة الموظف ما يتذكرها",
        "employee questions",
    ),
]
_COMPS = [
    {
        "competencyKey": f"c{i}",
        "title": title,
        "priority": "high",
        "questionObjective": f"احچيلي عن موقف حقيقي يبيّن {title}، شنو سويت؟",
        "expectedEvidence": ["موقف محدد"],
        "followUpRules": ["شنو صار بعدها؟"],
    }
    for i, title in enumerate(["دقة الرواتب", "الحضور والإضافي", "التواصل ويا الموظفين"])
]
RICH = (
    "أول شي أوقف الصرف لهذا القسم وأراجع سجلات البصمة ويا مسؤول القسم، بعدين أصحح الساعات "
    "وأبلغ المدير المالي وأوثق كل خطوة حتى ما يتكرر الخطأ."
)
#: Rich, and names a channel → the hook follow-up fires.
RICH_WITH_HOOK = (
    "أتواصل ويا مسؤول القسم بالواتساب وأراجع سجلات البصمة وأصحح الساعات قبل الصرف "
    "وأبلغ المدير المالي بالفرق حتى ما يتكرر"
)
#: Shallow story start → the difficulty probe on the active question fires.
STORY = "كان صعب شوية"
CLARIFY = "شنو تقصد بالسؤال؟ ما فهمت"
SKIP = "خلينا نغير السؤال"
TRANSITION = jd_transition_line("ar")
#: A follow-up the writer could produce for RICH (the owner's own example).
FOLLOW = "وإذا السجلين مختلفين، شلون راح تحدد الصحيح؟"


def _agent(
    level: str = "mid",
    jd: list[JdQuestion] | None = JD,
    bank: list[str] | None = None,
    pack: str = "",
    followups: list[str] | None = None,
    gender: str = "",
) -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Payroll Specialist",
        bank_questions=bank if bank is not None else ["anchor one?", "anchor two?", "anchor three?"],
        bank_key="jd_questions" if jd else "blueprint",
        has_domain_guidance=True,
        blueprint_competencies=_COMPS,
        career_level=level,
        jd_questions=jd,
        jd_language="ar" if jd else None,
        domain_pack_key=pack,
        candidate_gender=gender or None,
    )

    async def keep(_bare: str) -> str:
        return ""

    agent._regenerate_framed_question = keep
    # The follow-up writer (a model call in production): replies from `followups`
    # in order, then "NONE". Every prompt it is shown is kept for the assertions.
    queue = list(followups or [])
    agent._jd_calls = []

    async def write(messages):
        agent._jd_calls.append(messages)
        return queue.pop(0) if queue else "NONE"

    agent._generate_jd_followup_text = write
    return agent


def _turn(agent: InterviewAssistant, said: str, model_says: str | None = None) -> dict:
    """One candidate turn; the model says the recommended question as given
    (or ``model_says``, to play a model that ignored it)."""
    ctx = ChatContext.empty()
    try:
        asyncio.run(agent.on_user_turn_completed(ctx, ChatMessage(role="user", content=[said])))
    except StopResponse:
        return {"silent": True, "plan": None, "spoken": "", "frame": ""}
    plan = agent._turn_plan
    raw = model_says or (plan.question if plan and plan.question else "") or "شنو تحب تضيف؟"
    # tts_node and transcription_node each guard the model's raw text.
    first = asyncio.run(agent.reframe_bare_question(agent._apply_guard_to_agent_text(raw)))
    second = asyncio.run(agent.reframe_bare_question(agent._apply_guard_to_agent_text(raw)))
    assert first == second, "both guard passes must say the same thing"
    agent.record_agent_reply(first)
    frame = " | ".join(
        str(it.text_content() if callable(it.text_content) else it.text_content)
        for it in ctx.items
        if getattr(it, "role", "") in ("system", "developer")
    )
    return {"silent": False, "plan": plan, "spoken": first, "frame": frame}


def _jd_id(agent: InterviewAssistant, text: str | None) -> str:
    q = agent._jd_question_for(text)
    return q.id if q else ""


def _greet(agent: InterviewAssistant) -> str:
    """What the worker does: the greeting carries question 1, noted, then recorded."""
    greeting = worker._canned_initial_greeting(
        {"candidate_name": "Test", "language": "ar"}, first_question=JD[0].question
    )
    assert greeting.endswith(JD[0].question)
    agent.mark_verbatim(greeting)
    assert agent.note_opening_question(JD[0].question)
    agent.record_agent_reply(greeting)
    return greeting


def _run_until_competency(agent: InterviewAssistant, answers: list[str], limit: int = 14) -> list[dict]:
    rows = []
    for i in range(limit):
        row = _turn(agent, answers[min(i, len(answers) - 1)])
        rows.append(row)
        if row["plan"] is not None and row["plan"].source == "competency_engine":
            break
    return rows


# ── parsing (fail-open) ──────────────────────────────────────────────────────


def _meta(items) -> dict:
    return {"jd_questions": json.dumps(items, ensure_ascii=False)}


def _items() -> list[dict]:
    return [{"id": q.id, "question": q.question, "clarifyHint": q.clarify_hint, "duty": q.duty} for q in JD]


def test_parse_accepts_three_valid_questions_from_a_json_string() -> None:
    qs = parse_jd_questions(_meta(_items()), "ar")
    assert [q.id for q in qs] == ["q1", "q2", "q3"]
    assert [q.question for q in qs] == [q.question for q in JD]
    assert parse_jd_questions({"jd_questions": _items()}, "ar") == qs  # a list works too


@pytest.mark.parametrize(
    "broken",
    [
        lambda xs: xs[:2],  # two questions: never two for one candidate, three for another
        lambda xs: xs + xs[:1],
        lambda xs: [dict(xs[0], question="صرف الرواتب بدون سؤال"), *xs[1:]],
        lambda xs: [dict(xs[0], clarifyHint=""), *xs[1:]],
        lambda xs: [dict(xs[0], question="x" * 590 + "؟؟؟؟؟؟؟؟؟؟؟"), *xs[1:]],
        lambda xs: [xs[0], xs[0], xs[2]],
        lambda xs: [dict(xs[0], question="How would you fix a payroll error found before payday?"), *xs[1:]],
        lambda xs: ["not an object", *xs[1:]],
    ],
)
def test_parse_refuses_anything_but_a_clean_set(broken) -> None:
    assert parse_jd_questions(_meta(broken(_items())), "ar") == []


def test_parse_refuses_questions_in_another_language_than_the_interview() -> None:
    assert parse_jd_questions(_meta(_items()), "en") == []


@pytest.mark.parametrize("raw", [None, "", "{not json", "[]", json.dumps({"a": 1})])
def test_parse_of_missing_or_garbled_metadata_is_a_no_op(raw) -> None:
    assert parse_jd_questions({"jd_questions": raw} if raw is not None else {}, "ar") == []


def test_worker_resolver_is_off_without_the_switch_or_a_blueprint(monkeypatch) -> None:
    meta = dict(_meta(_items()), language="ar")
    blueprint = {"anchorQuestions": ["a?"], "competencies": _COMPS}
    monkeypatch.delenv("INTERVIEW_JD_PART1", raising=False)
    assert worker.resolve_jd_part_one(meta, blueprint) == []
    monkeypatch.setenv("INTERVIEW_JD_PART1", "true")
    assert worker.resolve_jd_part_one(meta, None) == []
    assert [q.id for q in worker.resolve_jd_part_one(meta, blueprint)] == ["q1", "q2", "q3"]
    monkeypatch.setenv("INTERVIEW_JD_PART1", "off")
    assert worker.resolve_jd_part_one(meta, blueprint) == []


# ── the prompt and the greeting ──────────────────────────────────────────────


def test_prompt_lists_no_anchors_and_no_three_plus_two_in_part_one_mode() -> None:
    bp = {"anchorQuestions": ["ANCHOR_ONE_TEXT?", "ANCHOR_TWO_TEXT?"], "competencies": _COMPS}
    on = worker._format_blueprint_block(bp, "", "", jd_part_one=True)
    off = worker._format_blueprint_block(bp, "", "")
    assert "ANCHOR_ONE_TEXT" not in on and "CORE QUESTIONS" not in on and "3+2" not in on
    assert "QUESTIONS FROM THE JOB DESCRIPTION" in on and "At most ONE short follow-up" in on
    assert "دقة الرواتب" in on, "the competencies are still listed"
    for q in JD:
        assert q.question not in on, "the questions reach the model per turn, never as a list"
    assert "ANCHOR_ONE_TEXT" in off and "CORE QUESTIONS" in off and "3+2" in off


def test_greeting_carries_question_one_and_the_bank_greeting_is_unchanged() -> None:
    meta = {"candidate_name": "Test", "language": "ar"}
    jd_greeting = worker._canned_initial_greeting(meta, first_question=JD[0].question)
    # The owner's wording (2026-10-04), then the question as the recruiter approved it.
    assert jd_greeting == f"حياك الله Test، {jd_greeting_lead('ar')} {JD[0].question}"
    assert jd_greeting_lead("ar") == "خلّينا نبدأ بموقف بسيط من الشغل."
    bank_greeting = worker._canned_initial_greeting(meta)
    assert bank_greeting == worker._canned_initial_greeting(meta, first_question=None)
    assert jd_greeting_lead("ar") not in bank_greeting and "نبدأ من خبرتك العملية" in bank_greeting


# ── the opening part ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("level", ["mid", "senior", "entry", "intern", ""])
def test_the_three_questions_open_every_level_in_order(level) -> None:
    agent = _agent(level)
    _greet(agent)
    rows = _run_until_competency(agent, [RICH])
    asked = [_jd_id(agent, r["plan"].question) for r in rows if r["plan"] and r["plan"].source in ("bank", "track_anchor")]
    assert asked == ["q2", "q3"], f"{level}: {asked}"
    assert rows[-1]["plan"].source == "competency_engine"


def test_the_greeting_question_is_not_asked_again() -> None:
    agent = _agent()
    _greet(agent)
    row = _turn(agent, RICH)
    assert _jd_id(agent, row["plan"].question) == "q2"
    assert agent._memory.anchor_questions_sent == 2


def test_without_the_greeting_question_one_is_asked_first() -> None:
    agent = _agent("senior")
    row = _turn(agent, "هلا، جاهز نبدي.")
    assert _jd_id(agent, row["plan"].question) == "q1"


def test_one_written_follow_up_per_question_then_the_next_one() -> None:
    agent = _agent(followups=[FOLLOW, FOLLOW, FOLLOW, FOLLOW])
    _greet(agent)
    order: list[str] = []
    for _ in range(8):
        row = _turn(agent, RICH)
        plan = row["plan"]
        order.append(_jd_id(agent, plan.question) if plan.source == "track_anchor" else plan.source)
        if plan.source == "competency_engine":
            break
    assert order == [
        "jd_followup", "q2", "jd_followup", "q3", "jd_followup", "competency_engine",
    ], order
    # The writer is asked once per question — never for the answer to its follow-up.
    assert len(agent._jd_calls) == 3


def test_the_follow_up_is_written_for_the_answer_and_said_as_written() -> None:
    agent = _agent(followups=[FOLLOW])
    _greet(agent)
    row = _turn(agent, RICH)
    assert row["plan"].source == "jd_followup"
    assert row["plan"].response_mode == MODE_FOLLOW_UP
    assert row["plan"].question == FOLLOW == row["spoken"]
    assert not row["plan"].competency_key
    assert "Say it exactly as written" in row["frame"]
    system, user = agent._jd_calls[0]
    assert JD[0].question in user[1] and RICH in user[1], "the question and the answer"
    for later in JD[1:]:
        assert later.question not in system[1] + user[1], "never the next question"
    assert "راح" in system[1] and "NONE" in system[1]


@pytest.mark.parametrize(
    "written",
    [
        "NONE",
        "",
        "شلون سويتها بشغلك السابق؟",  # the past
        "مثل ما سويت بشغلك السابق، شلون راح تحدد الصحيح؟",  # the past, even with «راح»
        "مثل ما سويت بشغلك السابق، شلون راح تراجع سجلات البصمة؟",  # the past, tied to the answer
        "هل راح تبلغ المدير المالي؟",  # yes/no
        "شلون راح تتصرف وشنو راح تسوي بعدين؟",  # two asks
        "شلون تحدد الصحيح؟",  # not the future
        "وإذا السجلين مختلفين، شلون راح تحدد الصحيح؟ وليش؟",  # two question marks
        JD[1].question,  # the next question recited
        JD[0].question,  # the question restated
    ],
)
def test_nothing_usable_means_the_next_question_not_a_generic_probe(written) -> None:
    agent = _agent(followups=[written])
    _greet(agent)
    row = _turn(agent, RICH)
    assert _jd_id(agent, row["plan"].question) == "q2", row["plan"].source


def test_a_slow_or_failing_writer_means_the_next_question(monkeypatch) -> None:
    monkeypatch.setenv("INTERVIEW_JD_FOLLOWUP_TIMEOUT_S", "1")
    for behaviour in ("slow", "error"):
        agent = _agent()

        async def write(messages, behaviour=behaviour):
            if behaviour == "slow":
                await asyncio.sleep(2)
                return FOLLOW
            raise RuntimeError("model down")

        agent._generate_jd_followup_text = write
        _greet(agent)
        row = _turn(agent, RICH)
        assert _jd_id(agent, row["plan"].question) == "q2", behaviour


@pytest.mark.parametrize("answer", [STORY, RICH_WITH_HOOK])
def test_no_generic_follow_up_in_part_one(answer) -> None:
    """The answers that used to fire the difficulty probe or a tool hook."""
    agent = _agent()  # the writer finds nothing
    _greet(agent)
    row = _turn(agent, answer)
    assert _jd_id(agent, row["plan"].question) == "q2", row["plan"].source


@pytest.mark.parametrize("said", [CLARIFY, SKIP, "هلا، جاهز نبدي."])
def test_a_non_answer_never_asks_the_writer(said) -> None:
    agent = _agent(followups=[FOLLOW])
    _greet(agent)
    _turn(agent, said)
    assert agent._jd_calls == []


def test_after_part_one_the_writer_is_never_asked_and_competencies_follow_up_as_before() -> None:
    agent = _agent()
    mem = agent._memory
    _greet(agent)
    _run_until_competency(agent, [RICH])
    calls = len(agent._jd_calls)
    for _ in range(3):
        _turn(agent, STORY)
    assert len(agent._jd_calls) == calls
    assert agent._jd_active(mem) is None
    mem.current_competency_key = "c0"
    mem.competency_followup_counts.pop("c0", None)
    assert agent._competency_followup_budget_left(mem), "the competency budget is back in force"


def test_follow_up_cleaning_rules() -> None:
    qs = [q.question for q in JD]
    assert clean_jd_followup("«وإذا المدير رفض، شنو راح تسوي؟»", "ar", qs) == "وإذا المدير رفض، شنو راح تسوي؟"
    assert clean_jd_followup(FOLLOW, "ar", qs) == FOLLOW
    assert clean_jd_followup("none", "ar", qs) == ""
    en = ["Payroll, if overtime was counted twice for a team, how would you handle it?"]
    assert clean_jd_followup("If the two records disagree, which would you trust first?", "en", en)
    assert clean_jd_followup("How did you handle it in your last job?", "en", en) == ""
    assert clean_jd_followup("Would you tell the manager?", "en", en) == ""
    messages = build_jd_followup_messages(JD[0].question, RICH, "ar")
    assert [role for role, _ in messages] == ["system", "user"]


@pytest.mark.parametrize(
    "raw",
    [
        # Real model, 2026-10-04: two asks joined by a Levantine «وشو».
        "شلون راح توثق كل خطوة، وشو راح تتأكد من دقتها؟",
        "شنو راح تسوي إذا المدير رفض، وشلون راح تبلغه؟",
        "شلون راح تبدي، وشگد وقت راح تحتاج؟",
        "شو راح تسوي إذا المدير رفض؟",
        "كيف راح تتعامل ويا الموقف؟",
        # Real model, 2026-10-04: MSA inside an otherwise Iraqi follow-up.
        "شلون راح تحل الموضوع إذا كان هناك اختلاف كبير بالساعات؟",
        "شلون راح توثق كل خطوة قمت بيها خلال هالعملية؟",
        "شنو الخطوات التي راح تتبعها؟",
        "شنو راح تسوي إذا ما لگيت أحد هناك؟",
    ],
)
def test_a_second_ask_or_a_non_iraqi_follow_up_is_dropped(raw) -> None:
    assert clean_jd_followup(raw, "ar", [q.question for q in JD]) == ""


def test_a_follow_up_must_pick_up_something_the_candidate_said() -> None:
    qs = [q.question for q in JD]
    platitude = "أتعامل ويا الموضوع باحترافية وأحاول أحله بأحسن طريقة ممكنة."
    twist = "شنو راح تسوي إذا الموظف كان متوتر أو عصباني؟"
    assert clean_jd_followup(twist, "ar", qs, platitude) == ""
    assert clean_jd_followup(FOLLOW, "ar", qs, RICH) == FOLLOW


def test_an_invented_follow_up_moves_to_the_next_question() -> None:
    agent = _agent(followups=["شنو راح تسوي إذا الموظف كان متوتر أو عصباني؟"])
    _greet(agent)
    row = _turn(agent, RICH)
    assert len(agent._jd_calls) == 1, "the writer was asked"
    assert _jd_id(agent, row["plan"].question) == "q2", row["plan"].source


@pytest.mark.parametrize(
    "kept",
    ["شلون راح ترتب الشغل إذا الوقت شوية؟", "شلون راح توزع الشغل وهلگد طلبات واصلة؟"],
)
def test_a_word_that_only_starts_like_a_question_word_is_not_a_second_ask(kept) -> None:
    assert clean_jd_followup(kept, "ar", [q.question for q in JD]) == kept


@pytest.mark.parametrize(("gender", "form"), [("", "masculine"), ("male", "masculine"), ("female", "feminine")])
def test_the_writer_addresses_the_candidate_as_the_interview_does(gender, form) -> None:
    """The follow-up is said as written. Real model, 2026-10-04: one in 36 used a
    feminine verb for a candidate of unknown gender."""
    agent = _agent(followups=[FOLLOW], gender=gender)
    _greet(agent)
    _turn(agent, RICH)
    system = agent._jd_calls[0][0][1]
    assert f"{form} second-person forms" in system
    assert ("feminine" in system) == (form == "feminine")


def test_the_transition_wording_and_no_echo_of_its_own_opener() -> None:
    assert TRANSITION == "هسه خلّينا نحچي عن خبرتك وطريقة شغلك بشكل عام."
    agent = _agent()
    mem = agent._memory
    mem.jd_asked_ids.update({"q1", "q2", "q3"})
    out = agent._apply_jd_transition("خلّينا نحچي عن دقة الرواتب، شلون تتأكد من الأرقام؟")
    assert out == f"{TRANSITION} حچيلي عن دقة الرواتب، شلون تتأكد من الأرقام؟"
    assert out.count("نحچي عن") == 1


def test_a_follow_up_turn_does_not_advertise_the_next_question() -> None:
    """Real model, 2026-10-04, 12 of 12 runs: shown «Suggested next bank anchor: q3»
    on a follow-up turn, it asked q3 instead — and the plan then asked q3 again."""
    agent = _agent(followups=[FOLLOW])
    _greet(agent)
    row = _turn(agent, RICH)
    assert row["plan"].source == "jd_followup"
    assert JD[1].question[:40] not in row["frame"], "q2 must not be in front of the model yet"
    assert "Suggested next bank anchor" not in row["frame"]


def test_a_description_question_the_model_says_on_its_own_counts_as_asked() -> None:
    agent = _agent(followups=["NONE", FOLLOW])
    mem = agent._memory
    _greet(agent)
    _turn(agent, RICH)  # nothing to probe → q2
    row = _turn(agent, RICH, model_says=JD[2].question)  # planned: a follow-up; said: q3
    assert row["plan"].response_mode == MODE_FOLLOW_UP
    assert mem.jd_asked_ids == {"q1", "q2", "q3"} and mem.jd_active_id == "q3"
    nxt = _run_until_competency(agent, [RICH])
    assert all(_jd_id(agent, r["plan"].question) != "q3" for r in nxt if r["plan"]), "never asked twice"
    assert nxt[-1]["plan"].source == "competency_engine"
    assert nxt[-1]["spoken"].startswith(TRANSITION)


def test_no_competency_is_set_or_spent_during_part_one() -> None:
    agent = _agent(followups=[FOLLOW, FOLLOW, FOLLOW])
    mem = agent._memory
    _greet(agent)
    for answer in [STORY, RICH, RICH_WITH_HOOK, RICH, RICH, RICH, RICH]:
        row = _turn(agent, answer)
        if row["plan"] and row["plan"].source == "competency_engine":
            break
        assert not mem.asked_competency_keys
        assert not mem.competency_followup_counts
        assert not mem.current_competency_key
        assert not (row["plan"].competency_key if row["plan"] else "")


def test_the_transition_is_spoken_once_before_the_first_competency_question() -> None:
    agent = _agent()
    _greet(agent)
    rows = _run_until_competency(agent, [RICH])
    assert rows[-1]["spoken"].startswith(TRANSITION + " "), rows[-1]["spoken"]
    assert "؟" not in TRANSITION
    assert all(TRANSITION not in r["spoken"] for r in rows[:-1])
    later = [_turn(agent, RICH) for _ in range(3)]
    assert all(TRANSITION not in r["spoken"] for r in later)
    assert agent._memory.jd_part_closed and agent._memory.jd_transition_sent


def test_a_clarification_defers_the_transition() -> None:
    agent = _agent()
    mem = agent._memory
    _greet(agent)
    _turn(agent, RICH)  # → q2
    _turn(agent, RICH)  # → q3
    assert mem.anchor_questions_sent == 3
    row = _turn(agent, CLARIFY)
    assert row["plan"].response_mode == MODE_CLARIFY
    assert TRANSITION not in row["spoken"]
    rows = _run_until_competency(agent, [RICH])
    assert rows[-1]["spoken"].startswith(TRANSITION)


def test_part_one_closes_on_the_first_fresh_question_even_without_a_transition() -> None:
    """The bookkeeping closes part one by itself — not only the transition does."""
    agent = _agent()
    mem = agent._memory
    _greet(agent)
    _turn(agent, RICH)  # → q2
    _turn(agent, RICH)  # → q3
    mem.jd_transition_sent = True  # e.g. cancelled earlier: no transition will close it
    rows = _run_until_competency(agent, [RICH])
    assert rows[-1]["plan"].source == "competency_engine"
    assert mem.jd_part_closed
    assert not mem.jd_active_id


def test_a_closing_cancels_the_transition() -> None:
    agent = _agent()
    mem = agent._memory
    mem.anchor_questions_sent = 3
    agent._winddown_turn = mem.turn_index
    agent._winddown_line = "شكراً، أكو شي تحب تضيفه؟"
    assert agent._apply_jd_transition("شكراً، أكو شي تحب تضيفه؟") == "شكراً، أكو شي تحب تضيفه؟"
    assert mem.jd_transition_sent
    agent._winddown_turn = -1
    assert agent._apply_jd_transition("احچيلي عن دقة الرواتب؟") == "احچيلي عن دقة الرواتب؟"


def test_the_first_clarification_uses_the_question_s_own_example() -> None:
    agent = _agent()
    _greet(agent)
    first = _turn(agent, CLARIFY)
    assert first["plan"].response_mode == MODE_CLARIFY
    assert first["plan"].question == collapse_to_single_question(jd_clarification(JD[0], "ar"))
    assert JD[0].clarify_hint in first["plan"].question
    assert first["plan"].question.endswith("شلون راح تتصرف؟")
    second = _turn(agent, CLARIFY)
    assert second["plan"].response_mode == MODE_CLARIFY
    assert JD[0].clarify_hint not in (second["plan"].question or ""), "the second one must differ"


def test_clarification_sentence_shapes() -> None:
    ar = jd_clarification(JD[2], "ar")
    assert ar == f"يعني {JD[2].clarify_hint}، شنو راح تگله أول؟"
    en_q = JdQuestion("q1", "Payroll, if overtime was counted twice for a team, how would you handle it?", "For instance the clock logged it twice", "")
    assert jd_clarification(en_q, "en") == "For instance the clock logged it twice. How would you handle it?"


def test_a_skip_moves_to_the_next_question_not_into_the_competencies() -> None:
    # A pack with its own competency steps: there a skip otherwise JUMPS into them.
    agent = _agent(pack="hr_recruiter")
    _greet(agent)
    row = _turn(agent, SKIP)
    assert _jd_id(agent, row["plan"].question) == "q2"
    assert not row["plan"].competency_key


def test_the_safety_net_hands_over_to_the_competencies(monkeypatch) -> None:
    monkeypatch.setenv("INTERVIEW_JD_PART1_MAX_TURNS", "4")
    agent = _agent()
    mem = agent._memory
    _greet(agent)  # utterance 1
    _turn(agent, CLARIFY)  # 2
    _turn(agent, CLARIFY)  # 3
    _turn(agent, CLARIFY)  # 4 → part one closes
    assert mem.jd_part_closed
    row = _turn(agent, RICH)
    assert row["plan"].source == "competency_engine"
    assert row["spoken"].startswith(TRANSITION)
    # Long enough to exhaust the competencies and reach the fallback anchor.
    later = [_turn(agent, RICH)["plan"] for _ in range(12)]
    assert all(_jd_id(agent, p.question) == "" for p in later if p), "a skipped question never comes back"


def test_turn_log_marks_the_part_and_the_question() -> None:
    agent = _agent()
    records: list[dict] = []

    class _Sink:
        def emit(self, record):
            records.append(record)

    agent._turn_log_sink = _Sink()
    _greet(agent)
    _run_until_competency(agent, [RICH])
    parts = [(r.get("part"), r.get("jdQuestionId")) for r in records]
    assert parts[0] == ("jd", "q1")
    assert ("jd", "q2") in parts and ("jd", "q3") in parts
    assert parts[-1] == ("competencies", "")


def test_forget_opening_question_undoes_the_note() -> None:
    agent = _agent()
    mem = agent._memory
    assert agent.note_opening_question(JD[0].question)
    agent.forget_opening_question(JD[0].question)
    assert mem.anchor_questions_sent == 0 and not mem.jd_active_id
    assert normalize_text(JD[0].question) not in mem.asked_question_keys
    row = _turn(agent, "هلا، جاهز نبدي.")
    assert _jd_id(agent, row["plan"].question) == "q1"


def test_a_question_is_never_dropped_because_its_subject_looks_covered() -> None:
    """Every candidate hears all three — the ledger may not skip one for overlap."""
    agent = _agent()
    mem = agent._memory
    _greet(agent)
    for _ in range(3):  # "asked and still thin" — the ledger's own reason to move on
        mem.subject_coverage.record_asked(JD[1].question)
        mem.subject_coverage.record_answer("ما أدري", question=JD[1].question)
    assert mem.subject_coverage.should_skip(JD[1].question), "precondition: the ledger would skip q2"
    row = _turn(agent, RICH)
    assert _jd_id(agent, row["plan"].question) == "q2"


def test_a_pack_path_step_does_not_cut_in_during_part_one() -> None:
    from voice_interview.active_question import STATUS_ANSWERED

    paths = [
        {
            "pathKey": "survey_default",
            "steps": [
                {"stepKey": "project_type", "topicLabel": "Project", "sampleQuestion": "PATH_STEP_QUESTION?"},
            ],
        }
    ]
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Payroll Specialist",
        bank_questions=[],
        bank_key="jd_questions",
        has_domain_guidance=True,
        blueprint_competencies=_COMPS,
        interview_paths=paths,
        career_level="mid",
        jd_questions=JD,
        jd_language="ar",
    )
    mem = agent._memory
    assert agent.note_opening_question(JD[0].question)
    mem.active_question_status = STATUS_ANSWERED  # closed, the only state a path step is offered in
    picked = agent._pick_recommended_question({"is_substantive_answer": True}, mem, {})
    assert picked != "PATH_STEP_QUESTION?"
    assert _jd_id(agent, picked) == "q2"


# ── nothing changes without description questions ───────────────────────────


def test_without_description_questions_the_senior_track_keeps_its_own_openers() -> None:
    agent = _agent("senior", jd=None, bank=["BANK_ANCHOR_ONE?", "BANK_ANCHOR_TWO?", "BANK_ANCHOR_THREE?"])
    row = _turn(agent, "هلا، جاهز نبدي.")
    assert row["plan"].question not in ("BANK_ANCHOR_ONE?",), "senior track: universal opener, as before"
    assert agent._apply_jd_transition("x؟") == "x؟"
    assert not agent.note_opening_question("BANK_ANCHOR_ONE?")


def test_without_description_questions_the_turn_log_has_no_part_fields() -> None:
    agent = _agent(jd=None, bank=["BANK_ANCHOR_ONE?", "BANK_ANCHOR_TWO?", "BANK_ANCHOR_THREE?"])
    records: list[dict] = []

    class _Sink:
        def emit(self, record):
            records.append(record)

    agent._turn_log_sink = _Sink()
    _turn(agent, "هلا، جاهز نبدي.")
    _turn(agent, RICH)
    assert records and all("part" not in r and "jdQuestionId" not in r for r in records)


def test_the_assistant_drops_the_anchors_when_given_description_questions() -> None:
    agent = _agent(bank=["ANCHOR_ONE?", "ANCHOR_TWO?", "ANCHOR_THREE?"])
    assert agent._bank_questions == [q.question for q in JD]
