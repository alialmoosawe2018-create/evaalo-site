"""Release 1 on the replayed interviews K, (A) and M.

``gate=True`` runs the presupposing branch switched off — what production ran —
and must reproduce production's decisions; without the gate, the presupposing
decisions move to a competency and every duplicate decision stays as it was.
M is kept here for good: it is the only replay in which applying the new
presupposition filter to DUPLICATE swaps changes a decision (turns 35 and 40).

Fixtures and method: ``presupposing_replay_sessions.py``.
"""

from __future__ import annotations

import pytest
from presupposing_replay_sessions import (
    SESSION_A,
    SESSION_K5,
    SESSION_M,
    PSession,
    replay,
)

from voice_interview.heuristics import normalize_text
from voice_interview.presupposition_guard import _ACT_STEMS, presupposes_unstated_act
from voice_interview.subject_coverage import subject_already_asked

SESSIONS = {"K": SESSION_K5, "A": SESSION_A, "M": SESSION_M}


@pytest.fixture(scope="module")
def runs():
    out = {}
    for name, session in SESSIONS.items():
        out[name, "gated"] = replay(session, gate=True)
        out[name, "fixed"] = replay(session)
        out[name, "isolated"] = {
            t: replay(session, target=t)[1][t] for t in session.decisions
        }
    return out


def _decisions(reason: str) -> list[tuple[str, int]]:
    return [
        (name, turn)
        for name, session in SESSIONS.items()
        for turn, d in session.decisions.items()
        if d.reason == reason
    ]


def _said_before(session: PSession, turn: int) -> list[str]:
    return [
        line
        for t, lines in session.candidate_lines.items()
        if t <= turn
        for line in lines
    ]


# ── Before: the gated replay is production ───────────────────────────────────


@pytest.mark.parametrize(
    ("name", "turn"),
    # K turn 16 is left out: production ran the agent before the P4 coverage fix
    # (offboarding_process); the approved pick is asserted further down.
    [(n, t) for n, s in SESSIONS.items() for t in s.decisions if (n, t) != ("K", 16)],
)
def test_the_gated_replay_reproduces_production(runs, name, turn):
    _, outcomes = runs[name, "gated"]
    assert outcomes[turn]["pick"] == outcomes[turn]["production"]


@pytest.mark.parametrize(("name", "turn"), _decisions("presupposing"))
def test_each_stand_in_is_rejected_for_presupposing_and_nothing_else(runs, name, turn):
    """The guard ranks duplicate > hybrid > presupposing, so a swap reason of
    «presupposing» proves the rejected text was neither of the others."""
    _, outcomes = runs[name, "gated"]
    assert outcomes[turn]["swap"]["reason"] == "presupposing"
    assert presupposes_unstated_act(
        outcomes[turn]["model_text"], _said_before(SESSIONS[name], turn)
    )


# ── After: presupposing decisions ────────────────────────────────────────────

_PRESUPPOSING_AFTER = {
    ("K", 5): "employee_records",
    ("A", 13): "compensation_and_offer_management",
    ("A", 16): "learning_and_development_coordination",
    ("A", 17): "change_advising_and_implementation",  # was the wrap-up
    ("M", 12): "anchor#3",  # a fresh anchor still comes first
}


@pytest.mark.parametrize(("name", "turn"), list(_PRESUPPOSING_AFTER))
def test_presupposing_decisions_with_the_fix(runs, name, turn):
    _, outcomes = runs[name, "fixed"]
    outcome = outcomes[turn]
    assert outcome["pick"] == _PRESUPPOSING_AFTER[name, turn]
    assert outcome["swap"]["reason"] == "presupposing"
    assert outcome["swap"]["to"] == (
        "bank_anchor" if (name, turn) == ("M", 12) else "competency"
    )


@pytest.mark.parametrize(
    ("name", "turn", "pick"),
    [
        ("K", 5, "employee_records"),
        ("A", 13, "compensation_and_offer_management"),
        # From production's own state (the earlier decisions gated), (A)'s 16 and
        # 17 each pick the first competency left, as 13 would have.
        ("A", 16, "compensation_and_offer_management"),
        ("A", 17, "compensation_and_offer_management"),
        ("M", 12, "anchor#3"),
    ],
)
def test_each_presupposing_decision_from_production_state(runs, name, turn, pick):
    assert runs[name, "isolated"][turn]["pick"] == pick


@pytest.mark.parametrize(("name", "turn"), _decisions("presupposing"))
def test_no_replacement_presupposes_itself(runs, name, turn):
    _, outcomes = runs[name, "fixed"]
    outcome = outcomes[turn]
    assert not presupposes_unstated_act(
        outcome["line"], _said_before(SESSIONS[name], turn)
    )


# ── After: duplicate decisions are unchanged ─────────────────────────────────

_DUPLICATE_PICKS = {
    ("K", 13): "employee_requests",
    ("K", 16): "confidentiality_data_protection",  # the approved P4 coverage fix
    ("A", 10): "recruitment_and_talent_acquisition",
    ("M", 35): "pipeline_and_ats_management",
    ("M", 40): "recruiting_metrics_reporting",
}


@pytest.mark.parametrize(("name", "turn"), list(_DUPLICATE_PICKS))
def test_duplicate_decisions_keep_their_picks(runs, name, turn):
    """Also after an earlier presupposing decision changed (K turn 5)."""
    for mode in ("gated", "fixed"):
        outcome = runs[name, mode][1][turn]
        assert outcome["pick"] == _DUPLICATE_PICKS[name, turn], mode
        assert outcome["swap"]["reason"] == "duplicate"
        assert outcome["swap"]["to"] == "competency"


def test_the_recorded_line_is_the_spoken_line_at_every_decision(runs):
    """What pins this is the reframe cache: once the first pass decides a turn's
    line, the second pass returns it whatever its guard does. The second guard
    pass itself is exercised in the unit tests (the «speech is fixed» cases)."""
    for name in SESSIONS:
        for mode in ("gated", "fixed"):
            for turn, outcome in runs[name, mode][1].items():
                assert outcome["second_pass"] == outcome["line"], (name, mode, turn)


# ── Attempted is not delivered ───────────────────────────────────────────────


def test_a_rejected_competency_is_attempted_never_delivered(runs):
    agent, _ = runs["A", "fixed"]
    mem = agent._memory
    rejected = {
        "employee_relations_and_investigations",
        "process_improvement_and_execution",
    }
    installed = {
        "compensation_and_offer_management",
        "learning_and_development_coordination",
        "change_advising_and_implementation",
    }
    assert rejected <= mem.asked_competency_keys
    assert not rejected & mem.delivered_competency_keys
    assert installed <= mem.delivered_competency_keys

    agent_k, _ = runs["K", "fixed"]
    assert "policy_execution" in agent_k._memory.asked_competency_keys
    assert "policy_execution" not in agent_k._memory.delivered_competency_keys


@pytest.mark.parametrize(
    ("name", "mode", "attempted", "delivered"),
    [
        ("A", "gated", 6, 3),
        ("A", "fixed", 9, 6),
        ("K", "gated", 6, 4),
        ("K", "fixed", 6, 4),
        ("M", "fixed", 5, 5),
    ],
)
def test_attempted_and_delivered_counts(runs, name, mode, attempted, delivered):
    agent, _ = runs[name, mode]
    assert agent._blueprint_competency_counts() == (attempted, delivered)


# ── Known limitations, accepted for release 1 ────────────────────────────────


def test_known_limitation_k5_matcher_false_negative(runs):
    """employee_records was covered by the delivered anchor («…employee file وHRIS
    … محدّثة وصحيحة…», turns 1 and 3) in the approved coverage table, but shares
    no distinctive word with its title («دقة سجلات الموظفين») — so P4 picks it.
    Accepted: no synonym list in this release."""
    _, outcomes = runs["K", "fixed"]
    titles = SESSION_K5.titles()
    others = [t for k, t in titles.items() if k != "employee_records"]
    evidence = outcomes[5]["before"]["evidence"]
    assert not subject_already_asked(
        titles["employee_records"], evidence, other_subjects=others
    )
    assert outcomes[5]["pick"] == "employee_records"


def test_known_limitation_a13_matcher_false_positive(runs):
    """hr_data_and_metrics is skipped as covered because the HRIS question spelled
    out «نظام معلومات الموارد البشرية» — though it asked about managing records,
    not HR analytics. Accepted: no threshold tuning in this release."""
    agent, outcomes = runs["A", "fixed"]
    titles = SESSION_A.titles()
    others = [t for k, t in titles.items() if k != "hr_data_and_metrics"]
    evidence = outcomes[13]["before"]["evidence"]
    assert subject_already_asked(
        titles["hr_data_and_metrics"], evidence, other_subjects=others
    )
    assert "hr_data_and_metrics" not in agent._memory.asked_competency_keys


def test_known_limitation_drift_still_counts_as_delivered(runs):
    """Planned-vs-spoken drift is its own release: K turn 14 planned onboarding and
    spoke about payroll; M turn 33 planned sourcing strategy and spoke about
    candidate selection. Both count as delivered today."""
    assert (
        "onboarding_support" in runs["K", "fixed"][0]._memory.delivered_competency_keys
    )
    assert (
        "sourcing_strategy_channels"
        in runs["M", "fixed"][0]._memory.delivered_competency_keys
    )


# ── The fixture itself ───────────────────────────────────────────────────────


def test_synthetic_candidate_lines_carry_exactly_the_original_act_verbs():
    """The only property of a candidate line any decision here reads."""
    proofs = [normalize_text(p) for _, _, p in _ACT_STEMS]

    def verbs(line: str) -> list[str]:
        said = normalize_text(line[:400])
        return [p for p in proofs if p in said]

    found = {
        (name, turn, i): verbs(line)
        for name, session in SESSIONS.items()
        for turn, lines in session.candidate_lines.items()
        for i, line in enumerate(lines)
        if verbs(line)
    }
    assert found == {("K", 10, 0): [normalize_text("واجهت")]}
