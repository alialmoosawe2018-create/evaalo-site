"""`collapse_to_single_question` must also catch a second ask hiding BEFORE the first «؟».

The 2026-09-17 opener «اذكرلي قرار أو مشروع انت قادته في HR، وشنو كان تأثيره على
الفريق أو الشركة؟» carries one question mark but two questions; cutting at the
first mark kept both, and the SINGLE-QUESTION RULE handed to the model was already
violated by its own input.
"""

from __future__ import annotations

from voice_interview.entity_policy import collapse_to_single_question as collapse


def test_second_question_before_first_mark_is_cut():
    q = "اذكرلي قرار أو مشروع انت قادته في HR، وشنو كان تأثيره على الفريق أو الشركة؟"
    out = collapse(q)
    assert out == "اذكرلي قرار أو مشروع انت قادته في HR؟"
    assert out.count("؟") == 1


def test_conjunction_without_comma_is_cut():
    assert collapse("شنو خبرتك بالتقارير وشلون تسويها؟") == "شنو خبرتك بالتقارير؟"


def test_first_mark_cut_unchanged():
    q = "شنو خبرتك بالـ onboarding؟ وشنو الأدوات اللي استخدمتها؟"
    assert collapse(q) == "شنو خبرتك بالـ onboarding؟"


def test_single_question_untouched():
    q = "اذكرلي مثال عن موقف طبقت فيه سياسة مكتوبة؟"
    assert collapse(q) == q


def test_conjunction_that_is_not_a_question_word_untouched():
    q = "اذكرلي مثال عن سياسة وتطبيقها بشغلك؟"
    assert collapse(q) == q


def test_very_short_head_is_not_cut():
    q = "شنو وشلون سويتها؟"
    assert collapse(q) == q
