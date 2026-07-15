"""L3 QA scorecard — Wave 1B + Wave 2 automated scenarios."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qa_l3_scenarios import L3_QA_SCENARIOS, _load_fixtures
from voice_interview.qa_scorecard import run_scorecard

_FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "l3_pack_fixtures.json"

WAVE_1B_KEYS = (
    "reservoir_engineer",
    "drilling_engineer",
    "civil_engineer",
    "site_engineer",
    "process_engineer",
)

WAVE_2_KEYS = (
    "frontend_developer",
    "devops_engineer",
    "data_analyst",
    "qa_engineer",
    "customer_support",
    "operations_coordinator",
    "accounts_payable",
    "financial_analyst",
    "internal_auditor",
)

MIN_PASS_RATE = 0.85


@pytest.fixture(scope="module")
def fixtures() -> dict:
    return _load_fixtures()


def test_fixture_pack_count(fixtures: dict) -> None:
    expected = set(WAVE_1B_KEYS) | set(WAVE_2_KEYS)
    assert expected.issubset(fixtures["packs"].keys())
    for key in expected:
        pack = fixtures["packs"][key]
        assert len(pack["supportedExperienceTracks"]) >= 4
        assert len(pack["interviewPaths"]) >= 1
        assert pack["competencyCount"] >= 4


def test_scenario_catalog_shape() -> None:
    assert len(L3_QA_SCENARIOS) == 15 * (len(WAVE_1B_KEYS) + len(WAVE_2_KEYS))
    by_pack: dict[str, int] = {}
    for s in L3_QA_SCENARIOS:
        by_pack[s.pack_key] = by_pack.get(s.pack_key, 0) + 1
    for key in (*WAVE_1B_KEYS, *WAVE_2_KEYS):
        assert by_pack[key] == 15, f"{key} scenario count"
    personas = {s.persona for s in L3_QA_SCENARIOS}
    for required in ("entry_level", "expert", "career_switcher", "stt_noisy"):
        assert required in personas


@pytest.mark.parametrize(
    "scenario_id",
    [s.id for s in L3_QA_SCENARIOS],
    ids=[s.id for s in L3_QA_SCENARIOS],
)
def test_l3_scenario(scenario_id: str) -> None:
    scenario = next(s for s in L3_QA_SCENARIOS if s.id == scenario_id)
    report = run_scorecard([scenario])
    result = report.results[0]
    assert result.passed, f"{scenario_id} failed: {result.errors}"


def test_l3_scorecard_aggregate() -> None:
    report = run_scorecard(L3_QA_SCENARIOS)
    assert report.total == len(L3_QA_SCENARIOS)
    assert report.pass_rate >= MIN_PASS_RATE, (
        f"pass rate {report.pass_rate:.1%} below {MIN_PASS_RATE:.0%}; "
        f"failures: {[r.scenario_id for r in report.results if not r.passed]}"
    )
    for pack_key in (*WAVE_1B_KEYS, *WAVE_2_KEYS):
        row = report.by_pack[pack_key]
        pack_rate = row["passed"] / row["total"] if row["total"] else 0
        assert pack_rate >= MIN_PASS_RATE, f"{pack_key} pass rate {pack_rate:.1%}"


def test_fixtures_file_exists() -> None:
    assert _FIXTURES_PATH.is_file(), "run npm run export:l3-qa-fixtures in backend"
