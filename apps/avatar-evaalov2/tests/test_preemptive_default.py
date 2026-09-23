"""Preemptive generation is OFF for the video interview agent, and only one key can change that.

History, because it is the reason this file was rewritten (2026-09-24):
  * 2026-09-12: measured useless and harmful (the draft is discarded on every turn),
    so the default became OFF — but ``PREEMPTIVE_GENERATION`` still won when set.
  * The LiveKit Cloud agent has carried ``PREEMPTIVE_GENERATION`` and
    ``INTERVIEW_FORCE_PREEMPTIVE_GENERATION`` as secrets since 2026-07-18, so the
    09-12 default never applied: every turn of the 2026-09-23 interviews logged
    "preemptive generation enabled but chat context … changed", and one discarded
    draft offered the wrap-up that the candidate never heard.
  * The old version of this file PINNED that failure: ``test_explicit_env_wins``
    asserted the legacy key beats the default.

The rule now: ``EVAALO_INTERVIEW_PREEMPTIVE_GENERATION`` decides; unset means OFF;
the legacy keys are not read at all.

Run: uv run pytest tests/test_preemptive_default.py
"""

from __future__ import annotations

import ast
import logging
from pathlib import Path

import pytest

from voice_interview.config import (
    LEGACY_PREEMPTIVE_ENVS,
    PREEMPTIVE_OVERRIDE_ENV,
    interview_preemptive_generation,
)

_KEYS = (
    PREEMPTIVE_OVERRIDE_ENV,
    *LEGACY_PREEMPTIVE_ENVS,
    "AVATAR_STABILITY_MODE",
    "INTERVIEW_PROFILE",
    "SPEECHMATICS_INTERVIEW_DEFAULTS",
)

#: What the deployed agent's legacy settings ask for: preemptive ON, by every route
#: the old resolver honoured. (The secret values cannot be read back; the logs prove
#: the result was ON, and these are the settings that produce it.)
_PRODUCTION_LEGACY = {
    "PREEMPTIVE_GENERATION": "true",
    "INTERVIEW_FORCE_PREEMPTIVE_GENERATION": "true",
    "INTERVIEW_PROFILE": "latency",
}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)


def _set(monkeypatch, env: dict[str, str]) -> None:
    for k, v in env.items():
        monkeypatch.setenv(k, v)


# ── The default ──────────────────────────────────────────────────────────────


def test_off_when_nothing_is_set():
    assert interview_preemptive_generation() is False


def test_legacy_production_settings_cannot_turn_it_on(monkeypatch):
    """The regression itself: the July secrets must no longer win."""
    _set(monkeypatch, _PRODUCTION_LEGACY)
    assert interview_preemptive_generation() is False


@pytest.mark.parametrize("key", LEGACY_PREEMPTIVE_ENVS)
def test_each_legacy_key_alone_is_ignored(monkeypatch, key):
    monkeypatch.setenv(key, "true")
    assert interview_preemptive_generation() is False


def test_the_old_non_interview_route_is_gone_too(monkeypatch):
    """The old resolver turned it ON whenever interview defaults were off."""
    _set(
        monkeypatch, {**_PRODUCTION_LEGACY, "SPEECHMATICS_INTERVIEW_DEFAULTS": "false"}
    )
    assert interview_preemptive_generation() is False


# ── The Evaalo override ──────────────────────────────────────────────────────


def test_evaalo_override_turns_it_on_deliberately(monkeypatch):
    monkeypatch.setenv(PREEMPTIVE_OVERRIDE_ENV, "true")
    assert interview_preemptive_generation() is True


def test_evaalo_override_on_wins_over_legacy_off(monkeypatch):
    _set(
        monkeypatch, {"PREEMPTIVE_GENERATION": "false", PREEMPTIVE_OVERRIDE_ENV: "true"}
    )
    assert interview_preemptive_generation() is True


def test_evaalo_override_off_wins_over_legacy_on(monkeypatch):
    _set(monkeypatch, {**_PRODUCTION_LEGACY, PREEMPTIVE_OVERRIDE_ENV: "false"})
    assert interview_preemptive_generation() is False


@pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on", " true "])
def test_override_spellings_that_mean_on(monkeypatch, value):
    monkeypatch.setenv(PREEMPTIVE_OVERRIDE_ENV, value)
    assert interview_preemptive_generation() is True


@pytest.mark.parametrize("value", ["false", "0", "no", "off", "", "maybe", "enabled"])
def test_anything_else_means_off(monkeypatch, value):
    _set(monkeypatch, {**_PRODUCTION_LEGACY, PREEMPTIVE_OVERRIDE_ENV: value})
    assert interview_preemptive_generation() is False


# ── Visible in production ────────────────────────────────────────────────────


def test_decision_is_logged_with_the_legacy_keys_it_ignored(monkeypatch, caplog):
    """The old AgentSession line is DEBUG, which is why nobody saw it was ON."""
    _set(monkeypatch, _PRODUCTION_LEGACY)
    with caplog.at_level(logging.INFO, logger="agent"):
        interview_preemptive_generation()
    line = next(
        r.getMessage()
        for r in caplog.records
        if "preemptive generation=" in r.getMessage()
    )
    assert "preemptive generation=False" in line
    assert f"{PREEMPTIVE_OVERRIDE_ENV}=unset" in line
    assert "PREEMPTIVE_GENERATION" in line and "not read" in line


# ── Wiring: the video worker really uses this resolver ───────────────────────

_WORKER = Path(__file__).resolve().parents[1] / "src" / "voice_interview" / "worker.py"


def _agent_session_preemptive_source() -> str:
    """Name of the call that feeds ``AgentSession(preemptive_generation=…)`` in the worker."""
    tree = ast.parse(_WORKER.read_text(encoding="utf-8"))
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        assigns: dict[str, ast.AST] = {}
        for node in ast.walk(fn):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        assigns[target.id] = node.value
        for node in ast.walk(fn):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "AgentSession"
            ):
                continue
            kw = next(
                (k for k in node.keywords if k.arg == "preemptive_generation"), None
            )
            assert kw is not None, "AgentSession is built without preemptive_generation"
            value = kw.value
            if isinstance(value, ast.Name):
                value = assigns.get(value.id, value)
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Name):
                return value.func.id
            return ast.dump(value)
    raise AssertionError("no AgentSession(...) call found in worker.py")


def test_video_worker_feeds_agent_session_from_this_resolver():
    assert _agent_session_preemptive_source() == "interview_preemptive_generation"


def test_video_worker_reads_no_legacy_preemptive_key():
    source = _WORKER.read_text(encoding="utf-8")
    for key in LEGACY_PREEMPTIVE_ENVS:
        assert key not in source, key
    assert "env_preemptive_generation" not in source
