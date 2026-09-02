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


def test_interview_default_is_half_duplex(monkeypatch):
    # interview defaults on by default → no barge-in.
    assert env_allow_interruption() is False


def test_interview_barge_in_opt_in(monkeypatch):
    monkeypatch.setenv("INTERVIEW_ALLOW_BARGE_IN", "true")
    assert env_allow_interruption() is True


def test_interview_ignores_legacy_force(monkeypatch):
    # The old force-on flag must NOT re-enable barge-in on the interview path.
    monkeypatch.setenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION", "true")
    monkeypatch.setenv("ALLOW_INTERRUPTION", "true")
    assert env_allow_interruption() is False


def test_non_interview_path_unchanged(monkeypatch):
    # With interview defaults off, the legacy behavior applies (force wins).
    monkeypatch.setenv("SPEECHMATICS_INTERVIEW_DEFAULTS", "false")
    monkeypatch.setenv("INTERVIEW_FORCE_ALLOW_INTERRUPTION", "true")
    assert env_allow_interruption() is True
