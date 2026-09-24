"""Release 1: a presupposing rejection goes to P4, and ATTEMPTED is not DELIVERED.

``asked_competency_keys`` records every competency the picker planned — it keeps
every picker from serving the same competency twice, but it was never proof the
candidate heard its question: a planned question the reply guard threw away
(bridge, anchor, wrap-up) was counted all the same. ``delivered_competency_keys``
holds only a competency whose own question went to the speech path unreplaced.

A presupposing rejection used to fall straight to a generic bridge, or to the
wrap-up (interview (A): wrap-up with five competencies never asked). It now takes
P4's path — after a fresh anchor, as a duplicate does — and P4 skips any
replacement whose own question would presuppose too.

Every blueprint, question and candidate line here is synthetic.
"""

from __future__ import annotations

import asyncio

import pytest
from p4_replay_sessions import _router

from voice_interview.active_question import MODE_ASK, TurnPlan
from voice_interview.assistant import _WRAP_UP_PROMPT_AR, InterviewAssistant
from voice_interview.entity_policy import DIFFICULTY_FOLLOWUP_POOL
from voice_interview.presupposition_guard import presupposes_unstated_act
from voice_interview.turn_log import TurnLogSink

# c1 and c3 presuppose an act («اللي سويتها», «اللي طبقته»); the rest do not.
_BLUEPRINT = [
    (
        "c1_schedules",
        "تنظيم الجداول الزمنية",
        "critical",
        "اذكرلي موقف رتّبت بيه جدول مزدحم، شنو الخطوات اللي سويتها؟",
    ),
    (
        "c2_clients",
        "التواصل مع العملاء",
        "high",
        "اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟",
    ),
    (
        "c3_reports",
        "إعداد التقارير الدورية",
        "high",
        "اذكرلي تقرير عملته للإدارة، شنو التغيير اللي طبقته بعده؟",
    ),
    (
        "c4_inventory",
        "إدارة المخزون",
        "medium",
        "اذكرلي مرة نظّمت بيها مخزون، وشنو كانت النتيجة؟",
    ),
    (
        "c5_safety",
        "السلامة المهنية",
        "medium",
        "لو صار حادث بالموقع، شنو أول خطوة تسويها؟",
    ),
]
# The same five subjects, every one of them presupposing.
_ALL_PRESUPPOSING = [
    (
        "c1_schedules",
        "تنظيم الجداول الزمنية",
        "critical",
        "شنو الخطوات اللي سويتها لما رتّبت جدول مزدحم؟",
    ),
    ("c2_clients", "التواصل مع العملاء", "high", "شنو الحل اللي سويته ويا عميل زعلان؟"),
    (
        "c3_reports",
        "إعداد التقارير الدورية",
        "high",
        "شنو التغيير اللي طبقته بعد تقرير الإدارة؟",
    ),
    ("c4_inventory", "إدارة المخزون", "medium", "شنو الترتيب اللي سويته للمخزون؟"),
    (
        "c5_safety",
        "السلامة المهنية",
        "medium",
        "شنو أول خطوة اللي سويتها لما صار حادث بالموقع؟",
    ),
]


async def _no_model(_bare: str) -> str:
    """No LLM in tests: an empty rewrite keeps the question as it is."""
    return ""


def _agent(blueprint=_BLUEPRINT, anchors=()) -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Office Coordinator",
        bank_questions=list(anchors),
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "competencyKey": key,
                "title": title,
                "priority": priority,
                "questionObjective": objective,
                "expectedEvidence": ["مثال محدد"],
                "followUpRules": ["شنو صار بعدها؟"],
            }
            for key, title, priority, objective in blueprint
        ],
        career_level="mid",
    )
    agent._turn_log_sink = TurnLogSink(object())
    agent._regenerate_framed_question = _no_model
    return agent


def _plan(
    key: str | None, question: str, source: str = "competency_engine"
) -> TurnPlan:
    return TurnPlan(
        question=question, competency_key=key, source=source, response_mode=MODE_ASK
    )


def _objective(key: str, blueprint=_BLUEPRINT) -> str:
    return next(objective for k, _, _, objective in blueprint if k == key)


def _speak(agent: InterviewAssistant, model_text: str) -> tuple[str, str]:
    """Production order: guard + reframe on the model's text (tts_node), then on
    what was spoken (transcription_node), then the record."""
    first = asyncio.run(
        agent.reframe_bare_question(agent._apply_guard_to_agent_text(model_text))
    )
    second = asyncio.run(
        agent.reframe_bare_question(agent._apply_guard_to_agent_text(first))
    )
    agent.record_agent_reply(second)
    return first, second


def _swap(agent: InterviewAssistant) -> dict:
    return agent._turn_log_sink.records[-1]["guardSwap"] or {}


def test_the_fixture_presupposes_where_it_says_it_does():
    assert presupposes_unstated_act(_objective("c1_schedules"), [])
    assert presupposes_unstated_act(_objective("c3_reports"), [])
    for key in ("c2_clients", "c4_inventory", "c5_safety"):
        assert not presupposes_unstated_act(_objective(key), []), key
    assert all(presupposes_unstated_act(o, []) for *_, o in _ALL_PRESUPPOSING)


# ── The P4 path for a presupposing rejection ─────────────────────────────────


def test_a_presupposing_rejection_moves_to_the_next_uncovered_competency():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    first, second = _speak(agent, _objective("c1_schedules"))

    assert first == second  # both guard passes agree
    swap = _swap(agent)
    assert swap["reason"] == "presupposing"
    assert swap["to"] == "competency"
    assert swap["fromCompetency"] == "c1_schedules"
    assert swap["toCompetency"] == "c2_clients"
    assert not presupposes_unstated_act(first, agent._memory.candidate_turns)
    mem = agent._memory
    assert mem.asked_competency_keys == {"c1_schedules", "c2_clients"}  # attempted
    assert mem.delivered_competency_keys == {"c2_clients"}  # its question was sent


def test_a_replacement_whose_own_question_presupposes_is_skipped():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._memory.asked_competency_keys.add("c2_clients")
    agent._turn_plan = _plan("c4_inventory", _objective("c4_inventory"))

    _speak(agent, "شنو الخطوات اللي سويتها بالمخزون؟")

    # c1 (critical) and c3 (high) come first and both presuppose; c4 was rejected.
    assert agent._turn_plan.competency_key == "c5_safety"
    assert "c1_schedules" not in agent._memory.asked_competency_keys
    assert "c3_reports" not in agent._memory.asked_competency_keys


def test_a_first_person_claim_makes_that_competency_askable_again():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._memory.candidate_turns.append("سويت جدول للفريق كامل.")
    agent._turn_plan = _plan("c2_clients", "شنو الحل اللي طبقته ويا العميل؟")

    _speak(agent, "شنو الحل اللي طبقته ويا العميل؟")

    assert agent._turn_plan.competency_key == "c1_schedules"


def test_a_fresh_anchor_still_comes_before_p4_for_presupposing():
    anchor = "شنو خبرتك بإدارة المواعيد اليومية؟"
    agent = _agent(anchors=[anchor])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    out = agent._apply_guard_to_agent_text(_objective("c1_schedules"))

    assert agent._guard_swap[1]["to"] == "bank_anchor"
    assert agent._guard_swap[1]["reason"] == "presupposing"
    assert agent._turn_plan.competency_key == "c1_schedules"  # no P4 swap
    assert "المواعيد" in out


def test_hybrid_keeps_its_old_path_even_when_it_also_presupposes():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c2_clients", _objective("c2_clients"))

    out = agent._apply_guard_to_agent_text(
        "شنو الشي اللي سويته وmotivatesك بهذا الدور؟"
    )

    assert agent._guard_swap[1]["reason"] == "hybrid"
    assert agent._turn_plan.competency_key == "c2_clients"  # P4 never ran
    assert out in DIFFICULTY_FOLLOWUP_POOL


# ── No reselection loop ───────────────────────────────────────────────────────


def _run_interview(blueprint, turns: int = 16):
    """Picker → the model says the planned question as is → guard → record."""
    agent = _agent(blueprint)
    mem = agent._memory
    planned: list[str] = []
    kinds: list[str] = []
    for turn in range(1, turns + 1):
        mem.turn_index = turn
        recommended = agent._pick_next_competency_question(mem)
        if recommended is None:
            agent._turn_plan = TurnPlan(
                question="", response_mode=MODE_ASK, source="bank"
            )
            text = "شنو الشي اللي سويته بآخر مشروع؟"  # still presupposing
        else:
            planned.append(mem.current_competency_key)
            agent._turn_plan = _plan(mem.current_competency_key, recommended)
            text = recommended
        first, second = _speak(agent, text)
        assert first == second
        if first.strip() == _WRAP_UP_PROMPT_AR.strip():
            kinds.append("wrap_up")
            break
        kinds.append(
            "bridge"
            if first in DIFFICULTY_FOLLOWUP_POOL
            else (agent._turn_plan.competency_key or "?")
        )
        mem.asked_questions.append(f"سؤال سابق رقم {turn}؟")  # reach the wrap-up floor
    return agent, planned, kinds


def test_no_loop_when_every_remaining_competency_also_presupposes():
    agent, planned, kinds = _run_interview(_ALL_PRESUPPOSING)

    assert len(planned) == len(set(planned))  # never planned twice
    assert set(planned) == {k for k, *_ in _ALL_PRESUPPOSING}
    records = agent._turn_log_sink.records
    # P4 never installs a replacement that itself presupposes...
    assert not [
        r for r in records if (r.get("guardSwap") or {}).get("to") == "competency"
    ]
    # ...and nothing the guard threw away counts as delivered. (One question here
    # IS spoken as is: the bridge pool runs out below the wrap-up floor and the
    # guard falls through to the model's text — older behaviour, out of scope.)
    replaced = {
        (r.get("guardSwap") or {}).get("fromCompetency")
        for r in records
        if r.get("guardSwap")
    }
    assert not agent._memory.delivered_competency_keys & replaced
    assert "wrap_up" in kinds  # it ends


def test_no_loop_in_a_mixed_blueprint_and_only_delivered_questions_count():
    agent, planned, kinds = _run_interview(_BLUEPRINT)

    assert len(planned) == len(set(planned))
    mem = agent._memory
    assert mem.delivered_competency_keys == {"c2_clients", "c4_inventory", "c5_safety"}
    assert {k for k, *_ in _BLUEPRINT} <= mem.asked_competency_keys
    assert "wrap_up" in kinds


# ── The second guard pass runs on what was already spoken ────────────────────
#
# tts_node guards the model's text; transcription_node guards the TTS-aligned
# text again. When the first pass leaves the question alone and the reframe
# rewrites it, the second pass sees the REWRITE — and whatever it decides,
# reframe_bare_question returns the cached rewrite: the speech is fixed.

_CLIENTS_REWRITE_PRESUPPOSING = (
    "بخصوص شغلك ويا العملاء، شنو الحل اللي سويته ويا العميل الزعلان؟"
)


def test_a_later_pass_never_swaps_in_a_competency_nobody_hears():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c2_clients", _objective("c2_clients"))

    async def presupposing_rewrite(_bare: str) -> str:
        return _CLIENTS_REWRITE_PRESUPPOSING

    agent._regenerate_framed_question = presupposing_rewrite
    first, second = _speak(agent, _objective("c2_clients"))

    assert first == second == _CLIENTS_REWRITE_PRESUPPOSING  # c2's question, reworded
    mem = agent._memory
    assert agent._turn_plan.competency_key == "c2_clients"  # no P4 swap
    assert mem.current_competency_key == "c2_clients"
    assert mem.asked_competency_keys == {"c2_clients"}
    assert mem.delivered_competency_keys == {"c2_clients"}


def test_after_the_speech_is_fixed_only_the_spoken_competency_is_delivered():
    """A duplicate on that later pass still reaches P4, as it did before this
    release. The competency P4 installs is never spoken, so it is not delivered;
    the planned competency, whose (reworded) question WAS spoken, is."""
    agent = _agent()
    heard = _objective("c2_clients")
    agent._memory.turn_index = 2
    agent._turn_plan = _plan("c2_clients", heard)
    _speak(agent, heard)
    agent._memory.delivered_competency_keys.clear()  # judge turn 3 alone
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c2_clients", "شلون تتصرف ويا زبون منزعج؟")
    rewrite = "بخصوص شغلك ويا الزباين، " + heard  # c2's own question again

    async def reword_into_a_repeat(_bare: str) -> str:
        return rewrite

    agent._regenerate_framed_question = reword_into_a_repeat
    first, second = _speak(agent, "شلون تتصرف ويا زبون منزعج؟")

    assert first == second == rewrite  # what the candidate heard
    swap = _swap(agent)
    assert (swap["to"], swap["reason"]) == ("competency", "duplicate")
    installed = swap["toCompetency"]
    assert installed != "c2_clients"
    assert installed in agent._memory.asked_competency_keys  # as before this release
    assert agent._memory.delivered_competency_keys == {"c2_clients"}


def test_the_final_closing_is_not_the_planned_question():
    """After the wrap-up the guard replaces the next question with the closing
    (no swap is recorded for it); the planned competency was not asked."""
    agent = _agent()
    agent._memory.wrap_up_offered = True
    agent._memory.turn_index = 12
    agent._turn_plan = _plan("c4_inventory", _objective("c4_inventory"))

    first, second = _speak(agent, _objective("c4_inventory"))

    assert first == second
    assert agent._memory.final_closing_sent
    assert "c4_inventory" not in agent._memory.delivered_competency_keys


# ── Only a competency's own question counts ──────────────────────────────────


def test_an_inherited_competency_key_is_never_delivered():
    """Plans without a key of their own inherit the current one
    (``_set_turn_recommendation``): after an anchor replaced c1's question, the
    next bank question carries «c1_schedules» without asking anything of it."""
    agent = _agent(anchors=["شنو خبرتك بإدارة المواعيد اليومية؟"])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))
    _speak(agent, _objective("c1_schedules"))
    assert _swap(agent)["to"] == "bank_anchor"

    agent._memory.turn_index = 4
    agent._set_turn_recommendation("شنو أكثر شي تحبه بشغلك اليومي؟", source="bank")
    assert agent._turn_plan.competency_key == "c1_schedules"  # inherited
    _speak(agent, "شنو أكثر شي تحبه بشغلك اليومي؟")

    assert "c1_schedules" in agent._memory.asked_competency_keys
    assert agent._memory.delivered_competency_keys == set()


def test_a_pack_step_asks_its_own_competency():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._set_turn_recommendation(
        _objective("c5_safety"), source="path_step", competency_key="c5_safety"
    )
    _speak(agent, _objective("c5_safety"))

    assert agent._memory.delivered_competency_keys == {"c5_safety"}


def test_a_pack_jump_asks_its_own_competency():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._set_turn_recommendation(
        _objective("c4_inventory"),
        source="competency_jump",
        competency_key="c4_inventory",
    )
    _speak(agent, _objective("c4_inventory"))

    assert agent._memory.delivered_competency_keys == {"c4_inventory"}


# ── The reword guard ─────────────────────────────────────────────────────────


def test_rewording_cannot_put_the_presupposition_back_on_an_anchor():
    anchor = "شنو خبرتك بإدارة المواعيد اليومية؟"
    agent = _agent(anchors=[anchor])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    async def presupposing_rewrite(_bare: str) -> str:
        return "بخصوص شغلك، شنو الترتيب اللي سويته للمواعيد اليومية؟"

    agent._regenerate_framed_question = presupposing_rewrite
    first, second = _speak(agent, _objective("c1_schedules"))

    assert _swap(agent)["to"] == "bank_anchor"
    assert first == second == anchor  # the safe anchor, as written


def test_the_reword_guard_reads_what_the_candidate_said():
    """A rewrite that points at an act the candidate DID claim is not a
    presupposition, and is kept."""
    agent = _agent()
    agent._memory.turn_index = 3
    agent._memory.candidate_turns.append("سويت جدول للفريق كامل.")
    agent._memory.asked_competency_keys.add("c1_schedules")  # P4 goes to c2
    agent._turn_plan = _plan("c3_reports", _objective("c3_reports"))
    rewrite = "بخصوص شغلك، شلون تعاملت ويا العميل الزعلان بعد الشي اللي سويته؟"

    async def rewrite_with_a_claimed_act(_bare: str) -> str:
        return rewrite

    agent._regenerate_framed_question = rewrite_with_a_claimed_act
    first, _ = _speak(agent, _objective("c3_reports"))

    assert _swap(agent)["toCompetency"] == "c2_clients"
    assert presupposes_unstated_act(rewrite, [])  # would be rejected with nothing said
    assert first == rewrite


def test_rewording_cannot_put_the_presupposition_back():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    async def presupposing_rewrite(_bare: str) -> str:
        return "بخصوص شغلك، شلون تعاملت ويا العميل اللي سويت له الخدمة؟"

    agent._regenerate_framed_question = presupposing_rewrite
    first, second = _speak(agent, _objective("c1_schedules"))

    assert first == second
    assert agent._turn_plan.competency_key == "c2_clients"
    assert not presupposes_unstated_act(first, agent._memory.candidate_turns)
    assert "عميل زعلان" in first  # the safe replacement, as written


def test_a_clean_rewording_of_a_presupposing_swap_is_kept():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    async def clean_rewrite(_bare: str) -> str:
        return "بخصوص شغلك، اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟"

    agent._regenerate_framed_question = clean_rewrite
    first, _ = _speak(agent, _objective("c1_schedules"))

    assert first.startswith("بخصوص شغلك")


def test_a_replacement_that_presupposes_itself_is_not_safe_to_fall_back_to():
    """An anchor is never filtered for presupposition; when it presupposes too,
    speaking it raw is no better than the framed rewrite, which stays."""
    anchor = "شنو الترتيب اللي سويته للجدول المزدحم؟"
    agent = _agent(anchors=[anchor])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    async def presupposing_rewrite(_bare: str) -> str:
        return "بخصوص شغلك، شنو الترتيب اللي سويته للجدول المزدحم؟"

    agent._regenerate_framed_question = presupposing_rewrite
    first, _ = _speak(agent, _objective("c1_schedules"))

    assert _swap(agent)["to"] == "bank_anchor"
    assert first == "بخصوص شغلك، شنو الترتيب اللي سويته للجدول المزدحم؟"


def test_a_replacement_in_the_wrong_language_is_not_safe_to_fall_back_to():
    agent = _agent(anchors=["Describe a time you organised a busy schedule?"])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    async def presupposing_rewrite(_bare: str) -> str:
        return "شنو الخطوات اللي سويتها حتى رتّبت الجدول المزدحم؟"

    agent._regenerate_framed_question = presupposing_rewrite
    first, _ = _speak(agent, _objective("c1_schedules"))

    assert _swap(agent)["to"] == "bank_anchor"
    assert (
        first == "شنو الخطوات اللي سويتها حتى رتّبت الجدول المزدحم؟"
    )  # not raw English


def test_a_duplicate_swap_rewording_is_unchanged():
    """The reword guard is for presupposing swaps only. Here the duplicate's
    replacement (c2) is safe and its rewrite presupposes — exactly the case the
    guard would catch — and the rewrite is still spoken, as before."""
    agent = _agent()
    agent._memory.asked_competency_keys.add("c1_schedules")  # next in line: c2
    heard = _objective("c4_inventory")
    agent._memory.turn_index = 2
    agent._turn_plan = _plan("c4_inventory", heard)
    _speak(agent, heard)
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c4_inventory", heard)

    async def rewrite(_bare: str) -> str:
        return "بخصوص شغلك، شنو الخطوات اللي سويتها ويا العميل؟"

    agent._regenerate_framed_question = rewrite
    first, _ = _speak(agent, heard)  # verbatim repeat → duplicate

    assert _swap(agent)["reason"] == "duplicate"
    assert _swap(agent)["toCompetency"] == "c2_clients"
    assert not presupposes_unstated_act(
        _objective("c2_clients"), []
    )  # a safe replacement
    assert first == "بخصوص شغلك، شنو الخطوات اللي سويتها ويا العميل؟"  # kept, as before


# ── Attempted is not delivered ───────────────────────────────────────────────


def test_an_anchor_replacement_is_not_delivered_coverage():
    anchor = "شنو خبرتك بتنظيم الجداول والمواعيد المزدحمة؟"
    agent = _agent(anchors=[anchor])
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", "شلون رتّبت الجدول المزدحم اللي سويته؟")

    _speak(agent, "شلون رتّبت الجدول المزدحم اللي سويته؟")

    assert _swap(agent)["to"] == "bank_anchor"
    # The anchor shares words with the planned question; it is still not ITS question.
    assert "c1_schedules" in agent._memory.asked_competency_keys
    assert "c1_schedules" not in agent._memory.delivered_competency_keys


def test_a_bridge_replacement_is_not_delivered_coverage():
    agent = _agent()
    agent._memory.asked_competency_keys.update(
        k for k, *_ in _BLUEPRINT if k != "c1_schedules"
    )
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))

    first, _ = _speak(agent, _objective("c1_schedules"))

    assert first in DIFFICULTY_FOLLOWUP_POOL
    assert "c1_schedules" in agent._memory.asked_competency_keys
    assert agent._memory.delivered_competency_keys == set()


def test_closing_a_question_marks_it_attempted_never_delivered():
    agent = _agent()
    mem = agent._memory
    mem.current_competency_key = "c4_inventory"
    agent._update_memory_post_decision({}, "advance")

    assert "c4_inventory" in mem.asked_competency_keys
    assert "c4_inventory" not in mem.delivered_competency_keys


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN LIMITATION (release 1): a model rewording that drifts to another "
    "subject is not detected, so its planned competency still counts as delivered. "
    "Planned-vs-spoken is its own release.",
)
def test_a_drifted_rewording_is_not_delivered():
    agent = _agent()
    agent._memory.turn_index = 3
    agent._turn_plan = _plan("c2_clients", _objective("c2_clients"))

    agent.record_agent_reply("شنو خبرتك ويا الرواتب الشهرية وحساباتها؟")

    assert "c2_clients" not in agent._memory.delivered_competency_keys


# ── Telemetry: attempted and delivered, on the same basis ────────────────────


def test_turn_and_end_records_report_attempted_and_delivered():
    agent = _agent()
    mem = agent._memory

    mem.turn_index = 3  # presupposing c1 → P4 → c2 delivered
    agent._turn_plan = _plan("c1_schedules", _objective("c1_schedules"))
    _speak(agent, _objective("c1_schedules"))
    mem.turn_index = 4  # a pack step key that is not in the blueprint
    agent._turn_plan = _plan(
        "context", "شنو كانت النتيجة بعد ما خلصت الشغلة؟", source="competency_jump"
    )
    _speak(agent, "شنو كانت النتيجة بعد ما خلصت الشغلة؟")
    mem.turn_index = 5
    agent._turn_plan = _plan("c4_inventory", _objective("c4_inventory"))
    _speak(agent, _objective("c4_inventory"))
    agent._emit_end_record("test")

    turns = [r for r in agent._turn_log_sink.records if r.get("kind") != "end"]
    end = agent._turn_log_sink.records[-1]
    # A turn record is emitted BEFORE the turn's own question is marked (as
    # askedCompetencyCount always was). The competency the guard rejected in that
    # same turn is already counted: P4 marks it attempted while swapping.
    counts = [
        (
            r["askedCompetencyCount"],
            r["attemptedCompetencyCount"],
            r["deliveredCompetencyCount"],
        )
        for r in turns
    ]
    assert counts == [
        (1, 1, 0),  # c1 rejected → attempted; c2 not yet marked
        (2, 2, 1),
        (3, 2, 1),  # «context» is attempted, but it is not a blueprint competency
    ]
    assert end["kind"] == "end"
    assert end["askedCompetencyCount"] == 4  # historical: every key, pack steps too
    assert end["attemptedCompetencyCount"] == 3  # c1, c2, c4
    assert end["deliveredCompetencyCount"] == 2  # c2, c4
    assert end["totalCompetencies"] == 5
