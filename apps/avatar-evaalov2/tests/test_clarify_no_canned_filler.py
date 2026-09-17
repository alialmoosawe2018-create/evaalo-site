"""Clarification restates the question that was asked — no canned filler.

Owner request 2026-09-17: remove «اذكر شي من خبرتك العملية … وإذا ما مرّ عليك
قلّي ونمشي لغيره». That line was the generic `default` clarify branch (every
unmatched clarify landed on it) and the generic challenge reply. Both now restate
the real question; the pack defaults keep their concrete examples but lose the
tail. The QA-scorecard contract (a clarify still asks for ONE concrete example,
«مثال»/«مثلاً») is kept on purpose — see qa_l3_scenario_factory.py.
"""

from __future__ import annotations

from voice_interview.entity_policy import (
    _PACK_CLARIFY_BRANCHES,
    _PACK_CLARIFY_CHALLENGE,
    clarify_challenge_reply,
    collapse_to_single_question,
    simplify_clarify_for_pack,
)

FOUNDER_Q = (
    "شنو، اذكرلي قرار أو مشروع انت قادته في HR، وشنو كان تأثيره على الفريق أو الشركة؟"
)
BANNED = ("ونمشي لغير", "من تجربتك", "من شغلك أنت", "خبرتك العملية")


def _has_banned(text: str) -> bool:
    return any(b in text for b in BANNED)


def _has_example_cue(text: str) -> bool:
    return any(w in text for w in ("مثلاً", "مثال"))


def test_generic_default_restates_the_real_question():
    text, src = simplify_clarify_for_pack(FOUNDER_Q, domain_pack_key="hr_generalist")
    assert src == "generic"
    assert not _has_banned(text)
    assert text.startswith("خلّيني أبسّطها")
    assert "قرار" in text and "قادته" in text  # the question itself is in there
    assert text.count("؟") == 1
    assert _has_example_cue(collapse_to_single_question(text))  # scorecard contract


def test_generic_default_without_a_question_has_no_filler():
    text, _ = simplify_clarify_for_pack("", domain_pack_key="")
    assert not _has_banned(text)
    assert text.count("؟") == 1
    assert _has_example_cue(text)


def test_no_branch_text_anywhere_carries_the_deleted_tail():
    for pack, branches in _PACK_CLARIFY_BRANCHES.items():
        for name, text in branches.items():
            assert "ونمشي لغير" not in text, (pack, name)
            assert text.count("؟") == 1, (pack, name)
    for pack, text in _PACK_CLARIFY_CHALLENGE.items():
        assert not _has_banned(text), pack
        assert _has_example_cue(text), pack


def test_pack_defaults_keep_their_concrete_examples():
    assert "مثلاً" in _PACK_CLARIFY_BRANCHES["hr_recruiter"]["default"]
    assert "مثلاً" in _PACK_CLARIFY_BRANCHES["petroleum_engineer"]["default"]


def test_generic_challenge_reply_restates_the_question():
    text, src = clarify_challenge_reply("hr_generalist", last_question=FOUNDER_Q)
    assert src == "generic_challenge"
    assert text.startswith("أعتذر")
    assert "خلّيني أبسّطها" in text
    assert "قرار" in text
    assert not _has_banned(text)
    assert text.count("؟") == 1
    assert _has_example_cue(text)


def test_pack_challenge_reply_unchanged_by_the_question():
    text, src = clarify_challenge_reply("petroleum_engineer", last_question=FOUNDER_Q)
    assert src == "petroleum_engineer_challenge"
    assert "خلّيني أبسّطها" not in text
