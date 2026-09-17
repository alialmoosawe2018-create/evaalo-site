"""Interview interruption policy: the video interview is half-duplex by default.

While the avatar speaks the candidate's speech must not overlap it (matches the
voice interview). `env_allow_interruption()` therefore returns False on the
interview path unless `INTERVIEW_ALLOW_BARGE_IN=true`, and it ignores the legacy
`INTERVIEW_FORCE_ALLOW_INTERRUPTION` there.
"""

import pytest

from voice_interview.config import env_allow_interruption

# Env keys the function reads — cleared before each case so tests don't leak.
_KEYS = (
    "SPEECHMATICS_INTERVIEW_DEFAULTS",
    "INTERVIEW_ALLOW_BARGE_IN",
    "INTERVIEW_FORCE_ALLOW_INTERRUPTION",
    "INTERVIEW_HARD_NO_INTERRUPT",
    "ALLOW_INTERRUPTION",
)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)


def test_interview_default_is_barge_in(monkeypatch):
    """DELIBERATELY INVERTED 2026-09-17 on the owner's decision — do not restore
    the half-duplex assertion.

    Half-duplex did not merely keep the candidate from overlapping the agent:
    LiveKit DISCARDED the turn they spoke. The founder's own interview logged
    «skipping reply to user input, current speech generation cannot be
    interrupted» four times, with his words attached, including «نغير السؤال».
    """
    assert env_allow_interruption() is True


def test_interview_half_duplex_opt_out(monkeypatch):
    monkeypatch.setenv("INTERVIEW_BARGE_IN_V2", "false")
    assert env_allow_interruption() is False


def test_interview_ignores_legacy_force(monkeypatch):
    # The legacy force/allow flags are still not the control on the interview
    # path; INTERVIEW_BARGE_IN_V2 is. Barge-in is on here because it is the
    # default now, not because the legacy force flag was honoured.
    monkeypatch.setenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION", "true")
    monkeypatch.setenv("ALLOW_INTERRUPTION", "true")
    monkeypatch.setenv("INTERVIEW_BARGE_IN_V2", "false")
    assert env_allow_interruption() is False


def test_non_interview_path_unchanged(monkeypatch):
    # With interview defaults off, the legacy behavior applies (force wins).
    monkeypatch.setenv("SPEECHMATICS_INTERVIEW_DEFAULTS", "false")
    monkeypatch.setenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION", "true")
    assert env_allow_interruption() is True
