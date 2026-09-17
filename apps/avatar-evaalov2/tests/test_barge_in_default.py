"""Barge-in is on, and a stale July secret cannot turn it back off.

Half-duplex did not merely talk over the candidate: LiveKit DISCARDED the turn
they spoke. The founder's 2026-09-17 interview logged it four times — «skipping
reply to user input, current speech generation cannot be interrupted» — with his
own words attached, including «نغير السؤال», a request to change the question
that was simply dropped. He reported it as «قاطعني كثيراً» and chose barge-in.
"""

from __future__ import annotations

import pytest

from voice_interview.config import env_allow_interruption


@pytest.fixture(autouse=True)
def _interview_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_DEFAULTS", "true")
    monkeypatch.delenv("INTERVIEW_BARGE_IN_V2", raising=False)
    monkeypatch.delenv("INTERVIEW_ALLOW_BARGE_IN", raising=False)


def test_barge_in_is_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    assert env_allow_interruption() is True


def test_the_legacy_secret_cannot_silence_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """`INTERVIEW_ALLOW_BARGE_IN` may already sit in the 71 secrets set in July,
    which cannot be read back or edited in place. Consulting it would put a stale
    `false` back in charge — the exact failure that silenced the greeting."""
    monkeypatch.setenv("INTERVIEW_ALLOW_BARGE_IN", "false")
    assert env_allow_interruption() is True


@pytest.mark.parametrize("value,expected", [("false", False), ("0", False), ("true", True)])
def test_the_new_key_is_the_control(
    monkeypatch: pytest.MonkeyPatch, value: str, expected: bool
) -> None:
    monkeypatch.setenv("INTERVIEW_ALLOW_BARGE_IN", "false")
    monkeypatch.setenv("INTERVIEW_BARGE_IN_V2", value)
    assert env_allow_interruption() is expected
