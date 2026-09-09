"""Block a question that treats an act of the candidate's as already established.

The model invents these. Observed twice in production with the same fabricated
frame — «وقت اتخاذ القرار اللي اتخذته» — asked of two different candidates,
neither of whom had described a decision, one of whom had just said «صراحة ما
عندي خبرة قوية بالهندسه النفط». It is not a bank template; "bottomhole" does not
occur in `data/interview_questions.json` at all.

`assistant.py` already instructs the model never to attribute anything to the
candidate that they did not say. The model ignores it — the same way it ignores
the opener-variety rule and still opens 70-87% of turns with «زين». Prompt text
is not enforcement here, so this guard is deterministic and sits beside the
cross-domain and repetition guards.

The rule is narrow on purpose: a question may refer to a *specific past act* of
the candidate's only when the candidate used that same verb about themselves, in
the first person. Anything broader would start rejecting legitimate follow-ups,
which is worse than the defect — a follow-up that digs into what someone really
said is the whole point of the stage.

Pure Python, no model calls.
"""

from __future__ import annotations

import re

from voice_interview.heuristics import normalize_text

# Verb roots that name an act a candidate performs. Each entry maps the form as it
# appears addressed TO the candidate (2nd person past) to the form they would use
# about THEMSELVES (1st person past). Arabic first person past is invariant in
# gender, so one form covers everyone.
#
# Keyed by the shared stem so both «اتخذته» and «اتخاذ القرار» resolve to «اتخذت».
_ACT_STEMS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    # stem in the question,      extra question spellings,        first-person proof
    ("اتخذت", ("اتخاذ القرار", "اتخذتها", "اتخذته"), "اتخذت"),
    ("سويت", ("سويتها", "سويته"), "سويت"),
    ("قررت", ("قررتها", "قررته"), "قررت"),
    ("عملت", ("عملتها", "عملته"), "عملت"),
    ("نفذت", ("نفذتها", "نفذته"), "نفذت"),
    ("طبقت", ("طبقتها", "طبقته"), "طبقت"),
    ("حللت", ("حللتها", "حللته"), "حللت"),
    ("راجعت", ("راجعتها", "راجعته"), "راجعت"),
    ("صممت", ("صممتها", "صممته"), "صممت"),
    ("اشتغلت", ("اشتغلت عليه", "اشتغلت عليها"), "اشتغلت"),
    ("واجهت", ("واجهتها", "واجهته"), "واجهت"),
    ("اخترت", ("اخترتها", "اخترته"), "اخترت"),
)

# A question is only presupposing when it points at ONE definite past act. These
# are the definite frames; an indefinite ask («اذكرلي موقف…») invents nothing.
_DEFINITE_FRAMES = ("اللي", "الذي", "التي", "وقت اتخاذ القرار", "وقت القرار")

# Conditional framing is the correct way to ask when nothing is grounded, so it
# must never be blocked — otherwise the guard would punish the fix.
_HYPOTHETICAL_MARKERS = ("لو ", "إذا ", "اذا ", "افترض", "لو صار", "لو مر", "لو مرّ")


def _has_token(haystack: str, needle: str) -> bool:
    """Substring match on normalized text.

    Arabic words take clitic prefixes (بـ، وـ، الـ) and suffixes freely, so a
    word-boundary match would miss «واتخذت» and «فسويت». Substring is the right
    granularity here — and `\\b` is meaningless next to Arabic in any case.
    """
    return needle in haystack


def presupposes_unstated_act(question: str, candidate_turns) -> bool:
    """True when `question` refers to a definite past act the candidate never claimed.

    `candidate_turns` is everything the candidate has said so far this session.
    """
    q = normalize_text(question or "")
    if not q:
        return False

    # A hypothetical asks the candidate to imagine; it asserts nothing about them.
    if any(m in (question or "") for m in _HYPOTHETICAL_MARKERS):
        return False

    if not any(_has_token(q, f) for f in map(normalize_text, _DEFINITE_FRAMES)):
        return False

    said = normalize_text(" ".join(str(t or "") for t in (candidate_turns or [])))

    for stem, extra_forms, proof in _ACT_STEMS:
        forms = (stem,) + extra_forms
        if not any(_has_token(q, normalize_text(f)) for f in forms):
            continue
        # The candidate must have used this verb about THEMSELVES. «يتم اتخاذ
        # القرار من فريق كامل» names the act but attributes it to a team, and is
        # exactly the case that produced the fabricated follow-up — so matching
        # the bare noun is not enough; only the first-person form counts.
        if _has_token(said, normalize_text(proof)):
            return False
        return True

    return False
