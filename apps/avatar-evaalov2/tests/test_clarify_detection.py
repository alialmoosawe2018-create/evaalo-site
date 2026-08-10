"""Regression tests for clarify-request detection across dialects.

The interview agent speaks light Iraqi, but candidates often ask for
clarification in MSA / Gulf / Levantine ("ماذا تقصدين…", "وش تقصد…").
Before this fix only the Iraqi "شنو تقصد" was recognised, so the agent
ignored the request and jumped to the next anchor (seen in a real
``video_interview_sessions`` transcript).
"""

from __future__ import annotations

import pytest

from voice_interview.heuristics import analyze_user_answer


@pytest.mark.parametrize(
    "text",
    [
        "ماذا تقصدين ببرنامج مزايا الجديد؟",  # real transcript line (MSA)
        "ماذا تقصد بهذا؟",
        "ماذا تعني بهالكلمة؟",
        "شو تقصد بالضبط؟",
        "وش تقصد؟",
        "أيش تقصد بهالسؤال؟",
        "ايش تقصد بهالسؤال؟",
    ],
)
def test_msa_gulf_levantine_clarify_detected(text: str) -> None:
    diag = analyze_user_answer(text)
    assert diag["meta_request"] == "clarify_term"


def test_iraqi_clarify_still_detected() -> None:
    # Existing Iraqi phrasing must not regress.
    diag = analyze_user_answer("شنو تقصد بهالسؤال؟")
    assert diag["meta_request"] == "clarify_term"
