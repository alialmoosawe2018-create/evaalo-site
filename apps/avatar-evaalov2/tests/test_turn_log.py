"""Turn telemetry: it must capture intent, and it must never change behaviour.

The 2026-09-23 interview was undiagnosable for two reasons these tests pin down:
the competency the picker INTENDED was never recorded anywhere durable, and the
five early-exits of ``_pick_result_followup`` were indistinguishable after the
fact. Each test below fails if either property regresses.
"""

from __future__ import annotations

import pytest

from voice_interview.turn_log import (
    END_RECORD_TURN_INDEX,
    TURN_LOG_TOPIC,
    TurnLogSink,
    build_end_record,
    build_record,
    turn_log_enabled,
)


class _Plan:
    def __init__(self, **kw):
        self.source = kw.get("source", "competency_engine")
        self.competency_key = kw.get("competency_key", "risk_assessment")
        self.response_mode = kw.get("response_mode", "ask")
        self.followup_type = kw.get("followup_type")
        self.question = kw.get("question", "احچيلي عن موقف حقيقي يبيّن تقييم المخاطر؟")


def _record(**over):
    kw = {
        "turn_index": 3,
        "plan": _Plan(),
        "spoken_text": "أريد أفهم شلون تعاملت وية JSA؟",
        "question_text": "أريد أفهم شلون تعاملت وية JSA؟",
        "opener_assigned": "أريد أفهم",
        "opener_used": "أريد أفهم",
        "diag": {"is_substantive_answer": True},
        "followup_skip_reason": "",
        "competency_budget": {},
        "asked_competency_keys": set(),
    }
    kw.update(over)
    return build_record(**kw)


def test_records_the_intended_competency_not_the_spoken_words():
    """The whole point: intent is kept even when the model rephrased it away.

    This is the exact failure it exists to catch — a competency marked "asked"
    while the candidate heard a generic question with the subject dropped.
    """
    rec = _record(
        plan=_Plan(competency_key="team_supervision"),
        question_text="بخصوص دورك كمهندس HSE، شنو كان موقف صعب واجهته؟",
    )
    assert rec["competencyKey"] == "team_supervision"
    assert "team_supervision" not in rec["spokenQuestion"]
    # Both sides of the divergence must be preserved, or it cannot be measured.
    assert rec["plannedQuestion"] and rec["spokenQuestion"]
    assert rec["plannedQuestion"] != rec["spokenQuestion"]


def test_opener_divergence_is_visible():
    rec = _record(opener_assigned="يهمّني أعرف", opener_used="بخصوص")
    assert rec["openerAssigned"] == "يهمّني أعرف"
    assert rec["openerUsed"] == "بخصوص"


@pytest.mark.parametrize(
    "reason",
    [
        "no_competency",
        "already_probed",
        "not_substantive",
        "mentions_result",
        "budget_spent",
    ],
)
def test_every_followup_skip_reason_survives(reason):
    """Five exits, five distinguishable records — that is what decides F2."""
    rec = _record(followup_skip_reason=reason)
    assert rec["followupSkipReason"] == reason
    assert rec["followupFired"] is False


def test_followup_fired_is_derived_from_the_plan_source():
    rec = _record(plan=_Plan(source="result_followup", followup_type="result"))
    assert rec["followupFired"] is True


def test_record_is_json_serializable_with_arabic_intact():
    import json

    rec = _record(asked_competency_keys={"a", "b"})
    blob = json.dumps(rec, ensure_ascii=False)
    assert "أريد أفهم" in blob
    assert rec["askedCompetencyCount"] == 2


def test_long_text_is_clipped_so_a_packet_cannot_blow_the_channel():
    rec = _record(plan=_Plan(question="س" * 5000))
    assert len(rec["plannedQuestion"]) <= 601


def test_missing_plan_still_produces_a_record():
    """An unplanned turn is the most interesting kind — it must not vanish."""
    rec = _record(plan=None)
    assert rec["competencyKey"] == ""
    assert rec["planSource"] == ""
    assert rec["turnIndex"] == 3


def test_sink_dedupes_the_double_emit_per_turn():
    """The reply guard runs twice per turn; the log must update, not duplicate."""
    sink = TurnLogSink(object())
    sink.emit(_record(turn_index=1, question_text="first"))
    sink.emit(_record(turn_index=1, question_text="second"))
    sink.emit(_record(turn_index=2))
    assert [r["turnIndex"] for r in sink.records] == [1, 2]
    assert sink.records[0]["spokenQuestion"] == "second"


def test_sink_never_raises_when_the_room_is_absent_or_broken():
    class Broken:
        @property
        def room(self):
            raise RuntimeError("room gone")

    sink = TurnLogSink(Broken())
    sink.emit(_record())  # must not raise — telemetry cannot break an interview
    assert len(sink.records) == 1


def test_topic_cannot_be_mistaken_for_a_transcript_topic():
    """The browser ignores topics containing these substrings; ours must not."""
    for ignored in ("transcript", "user", "agent"):
        assert ignored not in TURN_LOG_TOPIC


def test_disabled_by_env(monkeypatch):
    monkeypatch.setenv("INTERVIEW_TURN_LOG", "false")
    assert turn_log_enabled() is False
    monkeypatch.setenv("INTERVIEW_TURN_LOG", "true")
    assert turn_log_enabled() is True


# ── End-of-interview record (plan §5.3) ──────────────────────────────────────


def _end(**over):
    kw = {
        "trigger": "agent_tool",
        "wrap_up_trigger": "hard_question_cap",
        "questions_asked": 20,
        "asked_competency_keys": {"a", "b"},
        "total_competencies": 10,
        "final_closing_sent": True,
        "wrap_up_offered": True,
        "turn_index": 21,
    }
    kw.update(over)
    return build_end_record(**kw)


def test_end_record_names_who_stopped_and_on_which_rule():
    """`endedBy` says what the BROWSER did; this says what the AGENT decided."""
    rec = _end(trigger="wrap_up_guard", wrap_up_trigger="no_fresh_anchor")
    assert rec["kind"] == "end"
    assert rec["endTrigger"] == "wrap_up_guard"
    assert rec["wrapUpTrigger"] == "no_fresh_anchor"


def test_end_record_carries_the_coverage_at_the_moment_of_stopping():
    """Stopping at question 11 of 20 with 7 of 10 competencies is the finding."""
    rec = _end(questions_asked=11, asked_competency_keys={"a"}, total_competencies=10)
    assert rec["questionsAsked"] == 11
    assert rec["askedCompetencyCount"] == 1
    assert rec["totalCompetencies"] == 10


def test_end_record_uses_a_sentinel_index_so_it_cannot_shadow_a_turn():
    assert _end()["turnIndex"] == END_RECORD_TURN_INDEX
    assert END_RECORD_TURN_INDEX < 0


def test_end_and_turn_records_coexist_and_each_dedupes_against_itself():
    sink = TurnLogSink(object())
    sink.emit(_record(turn_index=0))
    sink.emit(_record(turn_index=1))
    sink.emit_end(_end(trigger="agent_tool"))
    sink.emit_end(_end(trigger="wrap_up_guard"))  # a second teardown route

    kinds = [r.get("kind") for r in sink.records]
    assert kinds.count("end") == 1, (
        "two teardown routes must not produce two end records"
    )
    assert kinds.count("turn") == 2
    # Last writer wins, so the record reflects the route that actually ran.
    end = next(r for r in sink.records if r["kind"] == "end")
    assert end["endTrigger"] == "wrap_up_guard"


def test_an_end_record_never_collides_with_a_real_turn():
    """A turn at the sentinel index must not be overwritten by the end record."""
    sink = TurnLogSink(object())
    sink.emit(_record(turn_index=END_RECORD_TURN_INDEX))
    sink.emit_end(_end())
    assert len(sink.records) == 2
