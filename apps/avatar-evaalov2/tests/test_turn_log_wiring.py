"""The telemetry WIRING inside InterviewAssistant, not just the record builder.

Separate from ``test_turn_log.py`` on purpose. Those tests exercise the module
in isolation and stayed green when the skip-reason assignments were deleted from
``assistant.py`` — a fix that is dead code with a green suite. These drive the
real assistant, so every capture point has a test that goes red without it.

They also pin the property the whole Phase-0 change rests on: telemetry must
observe, never steer. If attaching a sink changes which question is asked, the
measurement round is worthless.
"""

from __future__ import annotations

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.turn_log import TurnLogSink


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _competencies() -> list[dict]:
    return [
        {
            "competencyKey": "risk_assessment",
            "title": "تقييم المخاطر وJSA",
            "priority": "critical",
            "questionObjective": "قياس قدرة المرشح على تقييم المخاطر.",
            "expectedEvidence": ["نموذج JSA موقّع"],
            "followUpRules": ["شنو المنهجية اللي استخدمتوها؟"],
        },
        {
            "competencyKey": "permit_to_work",
            "title": "إدارة وأنظمة PTW",
            "priority": "critical",
            "followUpRules": ["منو وقّع التصريح؟"],
        },
    ]


def _make_agent() -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=["اذكرلي أهم موقع اشتغلت بيه؟"],
        bank_key="blueprint",
        position="HSE Engineer",
        has_domain_guidance=True,
        blueprint_competencies=_competencies(),
    )


def _with_sink() -> tuple[InterviewAssistant, TurnLogSink]:
    agent = _make_agent()
    sink = TurnLogSink(object())
    agent._turn_log_sink = sink
    return agent, sink


# ── The capture points ───────────────────────────────────────────────────────


def test_emits_one_record_per_agent_turn_carrying_the_intended_competency():
    agent, sink = _with_sink()
    mem = agent._memory

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)

    assert len(sink.records) == 1
    rec = sink.records[0]
    # The competency the PICKER chose, regardless of the spoken wording.
    assert rec["competencyKey"] == "risk_assessment"
    assert rec["planSource"] == "competency_engine"


def test_result_followup_skip_reason_reaches_the_record():
    """Deleting any ``_last_followup_skip`` assignment must fail here.

    ``mentions_result`` is the exit hypothesis F2 accuses of swallowing every
    probe in the 2026-09-23 interview, so it is the one pinned by name.
    """
    agent, sink = _with_sink()
    mem = agent._memory

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)

    # A substantive answer that DOES state an outcome → the probe must decline,
    # and it must say why.
    diag = {"is_substantive_answer": True, "mentions_result": True}
    assert agent._pick_result_followup(diag, mem) is None
    assert agent._last_followup_skip == "mentions_result"

    agent.record_agent_reply("وبعدين شنو صار بالموقع؟")
    assert sink.records[-1]["followupSkipReason"] == "mentions_result"


def test_each_early_exit_reports_a_distinct_reason():
    agent, _ = _with_sink()
    mem = agent._memory

    # No competency on the table yet.
    assert agent._pick_result_followup({"is_substantive_answer": True}, mem) is None
    assert agent._last_followup_skip == "no_competency"

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)

    # Answered, but with nothing substantive in it.
    assert agent._pick_result_followup({"is_substantive_answer": False}, mem) is None
    assert agent._last_followup_skip == "not_substantive"

    # Substantive, no outcome → the probe FIRES (control flow unchanged).
    assert agent._pick_result_followup({"is_substantive_answer": True}, mem) is not None

    # Second time on the same competency → already probed.
    assert agent._pick_result_followup({"is_substantive_answer": True}, mem) is None
    assert agent._last_followup_skip == "already_probed"


def test_assigned_opener_is_captured_from_the_real_directive():
    agent, sink = _with_sink()
    mem = agent._memory

    agent._opener_directive(mem)
    assigned = agent._last_opener_assigned
    assert assigned

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)
    assert sink.records[-1]["openerAssigned"] == assigned


def test_diag_snapshot_is_reset_between_turns():
    """A stale skip reason attributed to the wrong turn is a false finding.

    Driven down the wrap-up path on purpose: it returns BEFORE
    ``_pick_result_followup``, so only the explicit reset at the top of the
    dispatcher can clear the previous turn's reason. Any path that reaches the
    probe would overwrite the value anyway and test nothing.
    """
    agent, _ = _with_sink()
    mem = agent._memory
    agent._last_followup_skip = "mentions_result"
    mem.asked_questions = [f"سؤال {i}؟" for i in range(50)]

    agent._pick_recommended_question({"is_substantive_answer": True}, mem, {})
    assert agent._last_followup_skip == ""
    # And the new turn's decision inputs were snapshotted.
    assert agent._last_diag.get("is_substantive_answer") is True


# ── The property that makes the measurement round trustworthy ────────────────


def test_telemetry_does_not_change_a_single_question():
    """Same interview with and without a sink → identical questions.

    Phase 0 is allowed to observe and nothing else. This is that contract.
    """
    without = _make_agent()
    with_sink, _ = _with_sink()

    def run(agent: InterviewAssistant) -> list[str]:
        out: list[str] = []
        mem = agent._memory
        for _ in range(len(_competencies())):
            q = agent._pick_next_competency_question(mem)
            if q is None:
                break
            out.append(q)
            agent.record_agent_reply(q)
        return out

    assert run(without) == run(with_sink)


def test_a_broken_sink_cannot_break_a_turn():
    class Exploding:
        def emit(self, record):
            raise RuntimeError("telemetry is down")

    agent = _make_agent()
    agent._turn_log_sink = Exploding()
    mem = agent._memory

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)  # must not raise
    assert "risk_assessment" in mem.asked_competency_keys


# ── End-of-interview wiring (plan §5.3) ──────────────────────────────────────


def test_wrap_up_trigger_records_which_guard_offered_the_wrap_up():
    """Two guards offer the wrap-up on different rules; the record must say which."""
    agent, _ = _with_sink()
    mem = agent._memory

    # The 20-question hard cap, reached at the top of the dispatcher.
    mem.asked_questions = [f"س{i}؟" for i in range(50)]
    agent._pick_recommended_question({"is_substantive_answer": True}, mem, {})
    assert agent._wrap_up_trigger == "hard_question_cap"


def test_end_record_is_emitted_with_the_route_that_concluded():
    agent, sink = _with_sink()
    agent._emit_end_record("wrap_up_guard")

    ends = [r for r in sink.records if r.get("kind") == "end"]
    assert len(ends) == 1
    assert ends[0]["endTrigger"] == "wrap_up_guard"


def test_the_end_record_is_one_shot_across_both_teardown_routes():
    """The model can call end_interview while the guard already scheduled one."""
    agent, sink = _with_sink()
    agent._emit_end_record("wrap_up_guard")
    agent._emit_end_record("agent_tool")
    agent._emit_end_record("worker:session_time_limit")

    ends = [r for r in sink.records if r.get("kind") == "end"]
    assert len(ends) == 1
    assert ends[0]["endTrigger"] == "wrap_up_guard", "the FIRST route is the true one"


def test_end_record_reports_real_coverage_at_the_moment_of_stopping():
    agent, sink = _with_sink()
    mem = agent._memory

    q = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(q)
    agent._emit_end_record("agent_tool")

    end = next(r for r in sink.records if r.get("kind") == "end")
    # One of two blueprint competencies asked — the under-coverage is visible.
    assert end["askedCompetencyCount"] == 1
    assert end["totalCompetencies"] == 2
    assert end["questionsAsked"] >= 1


def test_no_sink_means_no_crash_when_concluding():
    agent = _make_agent()  # deliberately no sink
    agent._emit_end_record("agent_tool")  # must not raise


async def test_conclude_interview_itself_emits_the_end_record(monkeypatch):
    """Drives the REAL teardown entry point, not ``_emit_end_record`` directly.

    Without this, deleting the emit call from ``_conclude_interview`` leaves the
    whole suite green — the exact dead-fix shape these files exist to prevent.
    Teardown then no-ops safely: there is no job context in a test, so the
    method logs and returns after the emit has already happened.
    """
    monkeypatch.setenv("INTERVIEW_END_PLAYOUT_GRACE_MS", "0")
    agent, sink = _with_sink()

    await agent._conclude_interview()  # the guard route passes ctx=None

    ends = [r for r in sink.records if r.get("kind") == "end"]
    assert len(ends) == 1
    assert ends[0]["endTrigger"] == "wrap_up_guard"


async def test_conclude_via_the_tool_route_is_labelled_agent_tool(monkeypatch):
    """A non-None ctx means the model called ``end_interview`` itself."""
    monkeypatch.setenv("INTERVIEW_END_PLAYOUT_GRACE_MS", "0")
    agent, sink = _with_sink()

    class _Ctx:
        speech_handle = None
        session = None

    await agent._conclude_interview(_Ctx(), trigger="agent_tool")

    end = next(r for r in sink.records if r.get("kind") == "end")
    assert end["endTrigger"] == "agent_tool"


def test_the_other_wrap_up_guard_is_labelled_no_fresh_anchor():
    """The second, quieter route to a wrap-up — the one that fired at Q11.

    Reached by the reply-guard when a fresh ASK turn repeats a question, the
    bank has nothing new, and at least `_wrap_up_min_questions()` have been
    asked. It must be distinguishable from the 20-question hard cap, because the
    two say completely different things about why an interview stopped early.
    """
    agent, _ = _with_sink()
    mem = agent._memory

    # Every competency covered and the bank spent → no fresh anchor is left.
    for _ in range(len(_competencies())):
        q = agent._pick_next_competency_question(mem)
        if q is None:
            break
        agent.record_agent_reply(q)
    agent._bank_questions = []

    # Past the wrap-up floor, but nowhere near the 20-question hard cap.
    repeated = "شنو خبرتك بتقييم المخاطر؟"
    mem.asked_questions = [f"س{i}؟" for i in range(12)] + [repeated]
    mem.last_sent_question_norm = ""
    mem.wrap_up_offered = False
    agent._winddown_turn = -1
    agent._winddown_line = None
    agent._wrap_up_trigger = ""

    # A verbatim repeat of a question already asked, on a fresh ASK turn.
    agent._guard_repetition_and_language(repeated)

    if mem.wrap_up_offered:
        assert agent._wrap_up_trigger == "no_fresh_anchor"
    else:
        # The guard did not reach the wrap-up branch in this configuration.
        # Fail loudly rather than pass silently on a test that proved nothing.
        raise AssertionError(
            "the no_fresh_anchor wrap-up branch was not reached — "
            f"wrap_up_offered={mem.wrap_up_offered}, trigger={agent._wrap_up_trigger!r}"
        )
