"""Wave 1B + Wave 2 QA scorecard scenarios via L3 factory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from qa_l3_scenario_factory import PackScenarioConfig, build_standard_l3_scenarios, load_pack_base
from qa_wave1b_scenarios import WAVE_1B_CONFIGS
from qa_wave2_scenarios import WAVE_2_CONFIGS

_FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "l3_pack_fixtures.json"


def _load_fixtures() -> dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def all_l3_scenarios():
    from voice_interview.qa_scorecard import QAScenario

    fixtures = _load_fixtures()
    configs: dict[str, PackScenarioConfig] = {**WAVE_1B_CONFIGS, **WAVE_2_CONFIGS}
    out: list[QAScenario] = []
    for pack_key, cfg in configs.items():
        base = load_pack_base(fixtures, pack_key)
        out.extend(build_standard_l3_scenarios(base, cfg))
    return out


L3_QA_SCENARIOS = all_l3_scenarios()
