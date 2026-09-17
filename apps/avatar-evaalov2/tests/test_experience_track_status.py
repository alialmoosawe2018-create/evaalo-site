"""A stated status outranks the ambient vocabulary of the job.

These are the 16 QA-scorecard `track` scenarios that had been failing (the 17th
failure was the aggregate threshold they dragged under 85% for three packs).
`score_track` counts substring hits and the highest count wins, but a pack's
"experienced" track carries the role's own tool words as detect signals — so a
trainee naming what they LEARNED outscored the trainee signals.
"""

from __future__ import annotations

from voice_interview.experience_tracks import (
    detect_experience_track,
    explicit_status_hits,
)

# The "experienced" track as a real pack ships it: the role's own vocabulary.
DATA_ANALYST_TRACKS = [
    {
        "trackKey": "experienced",
        "detectSignals": ["SQL", "dashboard", "بيانات", "تحليل", "الفريق", "تعلمت"],
    },
    {"trackKey": "trainee", "detectSignals": []},
    {"trackKey": "entry_level", "detectSignals": []},
    {"trackKey": "career_switcher", "detectSignals": []},
    {"trackKey": "academic_only", "detectSignals": []},
]


def test_trainee_naming_the_tools_they_learned_is_still_a_trainee():
    # Verbatim from scenario da_trainee, which resolved to "experienced".
    text = "فترة تدريب محلل بيانات تعلمت SQL و dashboard basics مع الفريق"
    assert detect_experience_track(text, DATA_ANALYST_TRACKS) == "trainee"


def test_fresh_graduate_describing_real_work_is_still_entry_level():
    # Verbatim from scenario qa_entry.
    text = "انا خريج حديث وأول مهمة QA اشتغلتها على release تحت إشراف"
    assert detect_experience_track(text, DATA_ANALYST_TRACKS) == "entry_level"


def test_career_switcher_is_not_read_as_academic_only():
    # Verbatim from scenario ops_career_switch.
    text = "غيرت مجالي من إدارة مشاريع لتنسيق العمليات قبل سنتين"
    assert detect_experience_track(text, DATA_ANALYST_TRACKS) == "career_switcher"


def test_trainee_who_also_did_a_graduation_project_is_a_trainee():
    """Tie between two asserted statuses goes to the more specific claim."""
    text = "سويت مشروع تخرج وبعدها فترة تدريب بالشركة"
    assert detect_experience_track(text, DATA_ANALYST_TRACKS) == "trainee"


def test_a_veterans_first_project_does_not_flip_the_track():
    """The weight is 3, not a short-circuit — deliberately, so ONE incidental
    phrase inside a long experienced answer cannot reclassify the candidate.
    This is the claim the weighting makes; it is asserted here, not assumed."""
    text = (
        "اشتغلت عشر سنوات بالموقع وبالحقل، أول مشروع كان قبل سنوات، "
        "وبعدها قادت فريق وأدرت عمليات بالميدان"
    )
    assert detect_experience_track(text, DATA_ANALYST_TRACKS) != "entry_level"


def test_status_hits_are_counted_not_guessed():
    assert explicit_status_hits("انا خريج حديث وأول مهمة تحت إشراف", "entry_level") == 3
    assert explicit_status_hits("فترة تدريب بالشركة", "trainee") == 1
    assert explicit_status_hits("اشتغلت عشر سنوات بالحقل", "trainee") == 0
    assert explicit_status_hits("", "trainee") == 0


def test_stickiness_is_preserved_when_nothing_is_asserted():
    assert (
        detect_experience_track("اي تمام", DATA_ANALYST_TRACKS, current_track="senior")
        == "senior"
    )
