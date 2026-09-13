"""Preemptive generation is OFF for interviews (2026-09-12).

Measured on a real session: ``on_user_turn_completed`` rewrites the chat context
every turn, so LiveKit discarded the preemptive result 15 times out of 15 and once
synthesised a reply mid-answer. The env overrides still work as documented.

Run: uv run pytest tests/test_preemptive_default.py
"""

from __future__ import annotations

from voice_interview.config import env_preemptive_generation

_KEYS = (
    "PREEMPTIVE_GENERATION",
    "INTERVIEW_FORCE_PREEMPTIVE_GENERATION",
    "AVATAR_STABILITY_MODE",
    "INTERVIEW_PROFILE",
    "SPEECHMATICS_INTERVIEW_DEFAULTS",
)


def _clear(monkeypatch) -> None:
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)


def test_interview_default_is_off(monkeypatch):
    _clear(monkeypatch)
    assert env_preemptive_generation() is False


def test_latency_profile_no_longer_turns_it_on(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("INTERVIEW_PROFILE", "latency")
    assert env_preemptive_generation() is False


def test_explicit_env_wins(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("PREEMPTIVE_GENERATION", "true")
    assert env_preemptive_generation() is True
    monkeypatch.setenv("PREEMPTIVE_GENERATION", "false")
    assert env_preemptive_generation() is False


def test_force_flag_wins(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("INTERVIEW_FORCE_PREEMPTIVE_GENERATION", "true")
    assert env_preemptive_generation() is True


def test_non_interview_profile_keeps_the_livekit_default(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("SPEECHMATICS_INTERVIEW_DEFAULTS", "false")
    assert env_preemptive_generation() is True
