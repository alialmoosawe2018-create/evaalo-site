"""A question that arrives bare is a question the candidate has to decode.

⚠️ 2026-09-10, reported from real interviews: the video agent's question was
sometimes unclear enough that the candidate had to ask «شنو تقصدين؟».

The instruction was never missing. `assistant.py` already demands a framing
sentence "so the candidate never has to ask شنو تقصدين؟", and
`active_question.py` was already patched once to STOP stripping that framing.
What was missing is enforcement in the other direction: nothing checked that the
framing EXISTS. Two paths deliver a bare question today —

  1. the model simply skips the lead-in, and a single-question turn passes
     through `enforce_single_question_response` untouched; and
  2. the reply-guard replaces a duplicate/presupposing question with a raw bank
     anchor, and the bank is a list of context-free one-liners like
     "How do you decide what to prioritize when goals conflict?" — delivered
     without ever passing the model's framing instruction.

This detector is the missing check. It is deliberately narrow: it fires only on
a SINGLE interrogative sentence with no sentence before it, which is exactly the
shape the prompt calls "not acceptable". A comma-separated list inside one
question is still one bare sentence and still fires — the prompt's bar is "two or
three short sentences", not "one long one".

Run: uv run pytest tests/test_framing_guard.py
"""

from voice_interview.framing_guard import needs_framing


# ── fires: the shapes the prompt forbids ───────────────────────────────────────

def test_bare_arabic_question_fires():
    assert needs_framing("شلون تستخدم البيانات؟")


def test_bare_english_bank_question_fires():
    # Verbatim from src/voice_interview/data/interview_questions.json — this is
    # what the reply-guard hands the candidate when it replaces a question.
    assert needs_framing("How do you decide what to prioritize when goals conflict?")


def test_bare_question_with_an_internal_list_still_fires():
    # Commas here are a list, not framing. One sentence is still one sentence.
    assert needs_framing(
        "How do you balance price, quality, delivery time, payment terms, and supplier reliability?"
    )


def test_bare_question_with_leading_acknowledgment_only_still_fires():
    # "تمام" is an acknowledgment, not framing: it names nothing concrete.
    assert needs_framing("تمام، شنو أكثر تحدي واجهك؟")


# ── does not fire: a real framing sentence precedes the question ───────────────

def test_framing_sentence_then_question_passes():
    assert not needs_framing(
        "حاب أفهم أكثر عن شغلك بالفرز. شنو أكثر موقف صعب مرّ عليك بيه؟"
    )


def test_two_framing_sentences_then_question_passes():
    assert not needs_framing(
        "ذكرت إنك اشتغلت على ملفات التوظيف. أريد مثال محدد منها. شنو الموقف اللي اضطريت تغيّر فيه قرارك؟"
    )


def test_english_framing_then_question_passes():
    assert not needs_framing(
        "You mentioned you shipped an Android release last quarter. Walk me through one trade-off you made there?"
    )


# ── nothing to frame ──────────────────────────────────────────────────────────

def test_no_question_does_not_fire():
    assert not needs_framing("شكراً على وقتك.")


def test_empty_does_not_fire():
    assert not needs_framing("")
    assert not needs_framing("   ")
    assert not needs_framing(None)


def test_statement_ending_without_question_mark_does_not_fire():
    assert not needs_framing("خلينا ننتقل لموضوع ثاني")


# ── the guard must not undo the previous fix ──────────────────────────────────

def test_long_multi_sentence_turn_passes():
    """The shape assistant.py actually asks for: frame, ground, then ask once."""
    assert not needs_framing(
        "بخصوص تجربتك بإدارة الفريق، أريد مثال ملموس مو وصف عام. "
        "مثلاً موقف اضطريت توازن بين ضغط الوقت وجودة الشغل. "
        "شنو اللي سويته بالضبط وشلون طلعت النتيجة؟"
    )
