"""One stateful question pick per candidate turn, and every consumer reads that pick.

``_pick_recommended_question`` is stateful: it can mark a competency's result
probe spent, move the current competency, advance the template rotation and
replace ``_turn_plan``. ``on_user_turn_completed`` called it once to build the
decision frame the model is told — and a SECOND time as an argument of the
``decision_frame`` log line, evaluated eagerly at every log level. The second
call replaced the plan the first had made, so the plan used by the reply guard,
the turn log (``plannedQuestion``, ``competencyKey``), attempted/delivered
coverage, P4's rejected competency, the follow-up budget and
``_update_memory_post_decision`` could all describe a question the model was
never told to ask.

The clearest case: a competency question told to the model after an answer with
no outcome was recorded as that competency's RESULT follow-up (the second call
saw the competency as current and the result still missing). The competency was
never counted as asked, so the next turn offered it again, and the verbatim
re-ask guard turned it into a rewording — turn after turn.

Records made before this change were produced under the double call: every
turn-record field derived from the plan or from the bookkeeping it drives —
``plannedQuestion``, ``competencyKey``, ``planSource``, ``responseMode``, the
follow-up fields, ``guardSwap`` and the competency counts — followed the
second pick there, and is not directly comparable with records made after it.

Synthetic interview: invented role, competencies, anchors and answers.
"""

from __future__ import annotations

import ast
import asyncio
import logging
from pathlib import Path

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from p4_replay_sessions import _router

import voice_interview.assistant as assistant_module
from voice_interview.assistant import _WRAP_UP_PROMPT_AR, InterviewAssistant
from voice_interview.turn_log import TurnLogSink

_COMPETENCIES = [
    ("تنظيم الجداول", "اذكرلي موقف رتّبت بيه جدول مزدحم، شلون نظمته؟"),
    ("التواصل مع العملاء", "اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟"),
    ("إدارة المخزون", "اذكرلي مرة نظّمت بيها مخزون، وشنو كانت النتيجة؟"),
    ("السلامة المهنية", "اذكرلي موقف بيه خطر بالموقع، شلون تصرفت؟"),
    ("إعداد التقارير", "اذكرلي تقرير عملته للإدارة، شنو كان محتواه؟"),
    ("حل النزاعات", "اذكرلي خلاف بين زملاء، شلون ساعدت بحله؟"),
]
_ANCHORS = [
    "شنو خبرتك بترتيب الملفات الورقية بالمكتب؟",
    "شنو خبرتك باستقبال المراجعين والرد على الاستفسارات؟",
    "شنو خبرتك بمتابعة البريد والمراسلات اليومية؟",
]
_GREETING = "حياك الله ألف باء، نبدأ من خبرتك العملية."
_NO_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع ورتبت الأمور ويا الفريق خطوة بخطوة "
    "حسب الأولويات المطلوبة يومياً."
)
_WITH_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع وكانت النتيجة جيدة وتحسن الأداء "
    "بنسبة عشرين بالمية تقريباً."
)
_READY = "هلا. انا جاهز."
_CLARIFY = "شنو تقصد بالسؤال بالضبط؟"
_SKIP = "ممكن نغير السؤال."
_INCOMPLETE = "يعني اول شي سويت. لان."

#: Ready, anchors, competencies with and without outcomes, a clarification, a
#: skip and a trailing «لان.» (the agent waits) — every branch the picker has
#: on an ordinary interview.
_MIXED = [
    _READY,
    _NO_RESULT,
    _WITH_RESULT,
    _NO_RESULT,
    _NO_RESULT,
    _CLARIFY,
    _WITH_RESULT,
    _INCOMPLETE,
    _NO_RESULT,
    _SKIP,
    _NO_RESULT,
    _WITH_RESULT,
]


def _agent(*, anchors: bool) -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Office Coordinator",
        bank_questions=list(_ANCHORS) if anchors else [],
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "competencyKey": f"k{i}",
                "title": title,
                "priority": "high",
                "questionObjective": objective,
                "expectedEvidence": ["مثال محدد"],
                "followUpRules": ["شنو صار بعدها؟"],
            }
            for i, (title, objective) in enumerate(_COMPETENCIES)
        ],
        career_level="mid",
    )
    agent._turn_log_sink = TurnLogSink(object())

    async def keep(_bare: str) -> str:
        return ""

    agent._regenerate_framed_question = keep
    return agent


class _Spy:
    """Every picker call, the frame's recommendation, the log line's, and what
    the post-decision bookkeeping consumed — per candidate turn."""

    def __init__(self, agent: InterviewAssistant):
        self.turns: list[dict] = []
        pick = agent._pick_recommended_question
        wrap = agent._wrap_decision_frame
        update = agent._update_memory_post_decision

        def spy_pick(diag, mem, link_policy):
            out = pick(diag, mem, link_policy)
            self.turns[-1]["calls"].append(
                {
                    "returned": out,
                    "plan": agent._turn_plan,
                    "recommended": agent._turn_recommended,
                    "source": agent._turn_recommended_source,
                }
            )
            return out

        def spy_wrap(body, diag, mem, link_policy, recommended):
            self.turns[-1]["told"] = recommended
            return wrap(body, diag, mem, link_policy, recommended)

        def spy_update(diag, action):
            self.turns[-1]["consumed"] = {
                "recommended": agent._turn_recommended,
                "source": agent._turn_recommended_source,
                "plan": agent._turn_plan,
            }
            return update(diag, action)

        agent._pick_recommended_question = spy_pick
        agent._wrap_decision_frame = spy_wrap
        agent._update_memory_post_decision = spy_update

    def start(self) -> None:
        self.turns.append({"calls": []})

    def emit(self, record: logging.LogRecord) -> None:
        if isinstance(record.msg, str) and record.msg.startswith("decision_frame"):
            self.turns[-1]["logged"] = record.args[3]


class _LogTap(logging.Handler):
    def __init__(self, spy: _Spy):
        super().__init__()
        self.spy = spy

    def emit(self, record: logging.LogRecord) -> None:
        self.spy.emit(record)


def _run(answers: list[str], *, anchors: bool = True, before=None):
    """Drive the real agent; the model says exactly what its frame told it."""
    agent = _agent(anchors=anchors)
    mem = agent._memory
    spy = _Spy(agent)
    tap = _LogTap(spy)
    log = logging.getLogger("agent")
    old_level = log.level
    log.addHandler(tap)
    log.setLevel(logging.INFO)
    agent.mark_verbatim(_GREETING)
    agent.record_agent_reply(_GREETING)
    if before is not None:
        before(agent)
    try:
        for said in answers:
            spy.start()
            turn = spy.turns[-1]
            turn["attempted_before"] = set(mem.asked_competency_keys)
            try:
                asyncio.run(
                    agent.on_user_turn_completed(
                        ChatContext.empty(), ChatMessage(role="user", content=[said])
                    )
                )
            except StopResponse:
                turn["silent"] = True
                continue
            told = turn.get("told")
            plan = agent._turn_plan
            model_text = told or (plan.question if plan else "") or "شنو تحب تضيف؟"
            spoken = asyncio.run(
                agent.reframe_bare_question(
                    agent._apply_guard_to_agent_text(model_text)
                )
            )
            recorded = asyncio.run(
                agent.reframe_bare_question(agent._apply_guard_to_agent_text(spoken))
            )
            agent.record_agent_reply(recorded)
            turn["spoken"] = spoken
            turn["record"] = agent._turn_log_sink.records[-1]
            turn["reply_plan"] = agent._turn_plan
            turn["attempted_after"] = set(mem.asked_competency_keys)
            turn["delivered_after"] = set(mem.delivered_competency_keys)
    finally:
        log.removeHandler(tap)
        log.setLevel(old_level)
        agent._cancel_wait_timeout()
    return agent, spy.turns


def _framed(turns: list[dict]) -> list[dict]:
    return [t for t in turns if t["calls"]]


# ── One pick ─────────────────────────────────────────────────────────────────


def test_the_picker_runs_once_per_candidate_turn():
    _, turns = _run(_MIXED)
    assert len(_framed(turns)) == len(_MIXED)
    for i, turn in enumerate(turns):
        assert len(turn["calls"]) == 1, (i, len(turn["calls"]))
    assert any(t.get("silent") for t in turns)  # the «لان.» turn waited


def test_the_log_line_prints_the_question_the_model_was_told():
    _, turns = _run(_MIXED)
    logged = [t for t in turns if "logged" in t]
    assert len(logged) == len(_MIXED) - 1  # the waiting turn logs no frame
    for turn in logged:
        assert turn["logged"] == turn["told"] == turn["calls"][0]["returned"]


def test_post_decision_bookkeeping_reads_the_same_pick():
    _, turns = _run(_MIXED)
    for turn in _framed(turns):
        first = turn["calls"][0]
        consumed = turn["consumed"]
        assert consumed["plan"] is first["plan"]
        assert consumed["recommended"] == first["recommended"]
        assert consumed["source"] == first["source"]


def test_the_reply_and_its_record_use_the_plan_the_model_was_told():
    _, turns = _run(_MIXED)
    checked = 0
    for turn in _framed(turns):
        if turn.get("silent"):
            continue
        record = turn["record"]
        if record["guardSwap"] is not None:
            continue  # a swap installs its own plan, by design
        plan = turn["calls"][0]["plan"]
        assert turn["reply_plan"] is plan
        assert record["planSource"] == plan.source
        assert record["competencyKey"] == (plan.competency_key or "")
        assert (plan.question or "").startswith(record["plannedQuestion"].rstrip("…"))
        new = turn["attempted_after"] - turn["attempted_before"]
        assert new <= {plan.competency_key}
        checked += 1
    assert checked >= 9


# ── What the double call used to do ──────────────────────────────────────────


def test_a_competency_question_counts_on_the_turn_it_is_told():
    """Answers never state an outcome: each competency gets its question, then
    its one result follow-up, then the next competency."""
    agent, turns = _run([_NO_RESULT] * 6, anchors=False)
    told = [
        (t["calls"][0]["plan"].source, t["calls"][0]["plan"].competency_key)
        for t in turns
    ]
    assert told == [
        ("competency_engine", "k0"),
        ("result_followup", "k0"),
        ("competency_engine", "k1"),
        ("result_followup", "k1"),
        ("competency_engine", "k2"),
        ("result_followup", "k2"),
    ]
    assert "k0" in turns[0]["attempted_after"]
    assert "k0" in turns[0]["delivered_after"]
    assert turns[0]["record"]["planSource"] == "competency_engine"
    assert turns[0]["record"]["competencyKey"] == "k0"
    # Never offered again, so never reworded into a loop.
    assert not any(src == "clarify_pack" for src, _ in told)
    assert agent._memory.asked_competency_keys == {"k0", "k1", "k2"}
    assert agent._memory.delivered_competency_keys == {"k0", "k1", "k2"}


def test_the_hard_cap_turn_logs_the_wrap_up_it_told_and_plans_nothing_else():
    """The hard cap tells the model the wrap-up and makes no plan. A second pick
    used to plan the next competency on that same turn and mark it attempted."""

    def at_cap(agent: InterviewAssistant) -> None:
        agent._memory.asked_questions.extend(f"سؤال سابق رقم {i}؟" for i in range(19))

    _, turns = _run([_WITH_RESULT], anchors=False, before=at_cap)
    turn = turns[0]
    assert turn["told"] == _WRAP_UP_PROMPT_AR
    assert turn["logged"] == _WRAP_UP_PROMPT_AR
    assert len(turn["calls"]) == 1
    assert turn["calls"][0]["plan"] is None
    assert turn["attempted_after"] == turn["attempted_before"]


# ── No log argument may change state ─────────────────────────────────────────

_LOG_LEVELS = {
    "debug",
    "info",
    "warning",
    "warn",
    "error",
    "exception",
    "critical",
    "log",
}
_TELEMETRY_SINKS = {"emit", "emit_end"}
_TELEMETRY_BUILDERS = {"build_turn_log_record", "build_end_record", "build_record"}

#: Every call that may appear inside a logging or telemetry call's arguments, each
#: read by hand and read-only: formatters, getters, pure classifiers and the
#: memory snapshot. Anything else fails the test until someone has read it and
#: added it here. A stateful helper that is not a method — ``pick_varied`` moves
#: the template rotation — is as dangerous there as the picker was.
_READ_ONLY_CALLS = {
    "', '.join",
    "(os.getenv('ELEVENLABS_OUTPUT_FORMAT') or '').strip",
    "_fmt",
    "_question_stem",
    "_summarize_eou",
    "_summarize_llm",
    "_summarize_stt",
    "_summarize_tts",
    "bool",
    "build_end_record",
    "build_turn_log_record",
    "cov.prior_answer",
    "detect_lang_from_text",
    "diag.get",
    "diag.items",
    "getattr",
    "json.dumps",
    "kwargs.get",
    "len",
    "logging.getLevelName",
    "meta.get",
    "os.getenv",
    "record.get",
    "self._memory.snapshot",
    "swap.get",
    "type",
}


def _is_logging_or_telemetry_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id in _TELEMETRY_BUILDERS or func.id == "print"
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in _TELEMETRY_SINKS:
        return True
    receiver = ast.unparse(func.value)
    if (receiver, func.attr) in (
        ("warnings", "warn"),
        ("sys.stdout", "write"),
        ("sys.stderr", "write"),
    ):
        return True
    return func.attr in _LOG_LEVELS and (
        receiver in ("logger", "logging", "log", "LOGGER")
        or receiver.endswith("logger")
        or "getLogger(" in receiver
        or "getChild(" in receiver
    )


def _unreviewed_calls_in_log_arguments(tree: ast.AST) -> list[tuple[int, str]]:
    found = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and _is_logging_or_telemetry_call(node)):
            continue
        for arg in [*node.args, *(k.value for k in node.keywords)]:
            for sub in ast.walk(arg):
                if isinstance(sub, ast.Call):
                    name = ast.unparse(sub.func)
                    if name not in _READ_ONLY_CALLS:
                        found.append((node.lineno, name))
    return found


_SRC = Path(assistant_module.__file__).parents[1]


@pytest.mark.parametrize(
    "path",
    sorted(p for p in _SRC.rglob("*.py") if "__pycache__" not in p.parts),
    ids=lambda p: p.relative_to(_SRC).as_posix(),
)
def test_no_logging_argument_makes_an_unreviewed_call(path):
    """Logging arguments are evaluated at every level: a stateful call there runs
    on every turn, logged or not. That is how the picker ran twice."""
    tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
    assert _unreviewed_calls_in_log_arguments(tree) == []


@pytest.mark.parametrize(
    "snippet",
    [
        "logger.info('%s', self._pick_recommended_question(d, m, lp))",
        "log.info('%s', self._pick_recommended_question(d, m, lp))",
        "self._logger.info('%s', self._pick_recommended_question(d, m, lp))",
        "logging.getLogger('agent').info('%s', pick_varied(POOL, mem))",
        "logger.info(f'{pick_varied(POOL, mem)}')",
        "logger.info('%s', cov.close_on_candidate_claim(q))",
        "sink.emit(build_turn_log_record(plan=self._pick_recommended_question(d)))",
        "logger.getChild('x').info('%s', cov.close_on_candidate_claim(q))",
        "print(pick_varied(POOL, mem))",
        "warnings.warn(str(self._pick_recommended_question(d, m, lp)))",
    ],
)
def test_the_guard_sees_every_shape_of_the_double_call(snippet):
    assert _unreviewed_calls_in_log_arguments(ast.parse(snippet)) != []
