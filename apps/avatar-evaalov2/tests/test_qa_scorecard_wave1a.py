"""Wave 1A L3 QA scorecard — 39 automated scenarios (13 × 3 packs)."""

from __future__ import annotations

import pytest

from voice_interview.qa_scorecard import run_scorecard
from qa_wave1a_scenarios import WAVE1A_QA_SCENARIOS, _load_fixtures


MIN_PASS_RATE = 0.85  # plan target 85%+ on quality metrics


@pytest.fixture(scope="module")
def fixtures() -> dict:
    return _load_fixtures()


def test_fixture_pack_count(fixtures: dict) -> None:
    assert len(fixtures["packs"]) == 3
    for key in ("hr_recruiter", "petroleum_engineer", "survey_engineer"):
        pack = fixtures["packs"][key]
        assert len(pack["supportedExperienceTracks"]) >= 4
        assert len(pack["interviewPaths"]) >= 1
        assert pack["competencyCount"] >= 4


def test_scenario_catalog_shape() -> None:
    assert len(WAVE1A_QA_SCENARIOS) == 39
    by_pack: dict[str, int] = {}
    for s in WAVE1A_QA_SCENARIOS:
        by_pack[s.pack_key] = by_pack.get(s.pack_key, 0) + 1
    assert by_pack == {
        "hr_recruiter": 13,
        "petroleum_engineer": 13,
        "survey_engineer": 13,
    }
    personas = {s.persona for s in WAVE1A_QA_SCENARIOS}
    for required in ("entry_level", "expert", "career_switcher", "stt_noisy"):
        assert required in personas
    categories = {s.category for s in WAVE1A_QA_SCENARIOS}
    for required in ("greeting", "skip", "clarify", "identity", "track", "stt"):
        assert required in categories


@pytest.mark.parametrize(
    "scenario_id",
    [s.id for s in WAVE1A_QA_SCENARIOS],
    ids=[s.id for s in WAVE1A_QA_SCENARIOS],
)
def test_wave1a_scenario(scenario_id: str) -> None:
    scenario = next(s for s in WAVE1A_QA_SCENARIOS if s.id == scenario_id)
    report = run_scorecard([scenario])
    result = report.results[0]
    assert result.passed, f"{scenario_id} failed: {result.errors}"


def test_wave1a_scorecard_aggregate() -> None:
    report = run_scorecard(WAVE1A_QA_SCENARIOS)
    assert report.total == 39
    assert report.pass_rate >= MIN_PASS_RATE, (
        f"pass rate {report.pass_rate:.1%} below {MIN_PASS_RATE:.0%}; "
        f"failures: {[r.scenario_id for r in report.results if not r.passed]}"
    )
    for pack_key, row in report.by_pack.items():
        pack_rate = row["passed"] / row["total"] if row["total"] else 0
        assert pack_rate >= MIN_PASS_RATE, f"{pack_key} pass rate {pack_rate:.1%}"
