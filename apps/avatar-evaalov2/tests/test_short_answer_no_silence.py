"""A short answer that names experience is an ANSWER, not a preamble.

From the founder's 2026-09-17 video interview: «العملي. أقرب لخبرتي. اني.» is 22
normalised characters and contains «خبرتي» — `analyze_user_answer` classified it
"answer in progress", the agent raised StopResponse, and there was no timer to end
the silence. These pin the new rule: in-progress == the turn ends unfinished.
"""

from __future__ import annotations

from voice_interview.heuristics import _is_incomplete_turn, analyze_user_answer, normalize_text


def _diag(text: str) -> dict:
    return analyze_user_answer(
        text, active_question_text="q", active_question_status="awaiting_answer"
    )


def _incomplete(text: str) -> bool:
    return _is_incomplete_turn(normalize_text(text), text)


def test_short_answer_naming_experience_is_an_answer():
    d = _diag("العملي. أقرب لخبرتي. اني.")
    assert d["is_incomplete_turn"] is False
    assert d["is_answer_in_progress"] is False


def test_three_years_of_experience_is_complete():
    d = _diag("عندي ثلاث سنوات خبرة.")
    assert d["is_answer_in_progress"] is False


def test_short_english_experience_answer_is_complete():
    d = _diag("I have three years of experience.")
    assert d["is_answer_in_progress"] is False


def test_trailing_preposition_still_waits():
    d = _diag("اشتغلت في.")
    assert d["is_incomplete_turn"] is True
    assert d["is_answer_in_progress"] is True


def test_real_cuts_from_2026_09_15_now_wait():
    # Verbatim tails that were spoken over on 2026-09-15 (plan: root cause 2).
    assert _incomplete("والنصف. في.") is True
    assert _incomplete("اشتغلت وياهم من.") is True
    assert _incomplete("كان الموضوع على.") is True
    assert _incomplete("هذا الشي و.") is True


def test_function_word_matches_whole_words_only():
    # «كافي» ends with the letters «في» but is a complete word.
    assert _incomplete("الراتب كافي.") is False
    # «منّي» / «عليه» are not «من» / «على».
    assert _incomplete("هذا الشي مطلوب منّي.") is False
    assert _incomplete("اعتمدت عليه.") is False


def test_words_that_can_close_a_sentence_do_not_wait():
    assert _incomplete("سويت هذا.") is False
    assert _incomplete("ما شفته بعد.") is False
    assert _incomplete("خلاص بس.") is False


def test_existing_phrase_list_still_works():
    assert _incomplete("يعني.") is True
    assert _incomplete("وبعدين.") is True


def test_english_dangling_tail_waits():
    assert _incomplete("I worked in the.") is True
    assert _incomplete("And throughout my journey I.") is True
    assert _incomplete("That is what it is.") is False
