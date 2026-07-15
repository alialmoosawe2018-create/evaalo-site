"""Unit tests for ``reception.lang`` — code-switching aware AR/EN classifier.

Run with: ``pytest tests/test_lang.py``

The recruitment/HR motivating example: a candidate replying with
``"عندي مهارة recruitment"`` is **Arabic**, not English. The same goes for
``"شكراً لك"`` (pure Arabic, short) and ``"can we change the question"``
(pure English, ≥8 latin chars). Anything ambiguous (e.g. ``"ok"``) returns
``None`` so callers keep the previous language and don't flip the TTS voice.
"""

from __future__ import annotations

import pytest

from reception.lang import (
    detect_lang_from_text,
    detect_lang_reply_fallback,
    detect_language_switch_intent,
)


@pytest.fixture(autouse=True)
def _stable_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin tunables to defaults so tests don't depend on a developer's shell env."""
    for var in (
        "LANG_DETECT_AR_SHARE_FLOOR",
        "LANG_DETECT_EN_MIN_LATIN_CHARS",
        "LANG_DETECT_DEBUG",
    ):
        monkeypatch.delenv(var, raising=False)


class TestDetectLangFromText:
    @pytest.mark.parametrize(
        "text",
        [
            "ما اسمك؟",
            "أهلاً، شكراً لك على الفرصة",
            "هواية حلو إنك تشوف أهمية بيئة العمل",
            "خلني أفكر شوية",
        ],
    )
    def test_pure_arabic_is_arabic(self, text: str) -> None:
        assert detect_lang_from_text(text) == "ar"

    @pytest.mark.parametrize(
        "text",
        [
            "Can we speak in English please",
            "I have five years of HR recruitment experience",
            "Tell me more about the role",
        ],
    )
    def test_pure_english_is_english(self, text: str) -> None:
        assert detect_lang_from_text(text) == "en"

    @pytest.mark.parametrize(
        "text",
        [
            "عندي مهارة recruitment",
            "اشتغلت على HR Excel وSharePoint",
            "نستخدم نظام HRIS هواية بالشغل",
            "ممكن تسمحي لي عندي خبرة في recruitment manager",
        ],
    )
    def test_arabic_with_english_loanwords_is_arabic(self, text: str) -> None:
        """The recruitment/HR motivating example: code-switching ≠ language switch."""
        assert detect_lang_from_text(text) == "ar"

    @pytest.mark.parametrize("text", ["", "  ", "\n\t"])
    def test_empty_or_whitespace_returns_none(self, text: str) -> None:
        assert detect_lang_from_text(text) is None

    @pytest.mark.parametrize("text", ["12345", "...", "??!", "—"])
    def test_no_letters_returns_none(self, text: str) -> None:
        assert detect_lang_from_text(text) is None

    @pytest.mark.parametrize("text", ["ok", "yes", "no", "hi"])
    def test_short_english_is_ambiguous(self, text: str) -> None:
        """Short EN replies don't meet the latin-min threshold; caller keeps prior lang."""
        assert detect_lang_from_text(text) is None

    def test_single_arabic_letter_yields_ambiguous(self) -> None:
        """Single Arabic letter (likely a typo / STT artifact) doesn't reach the
        ar floor (needs ≥2) AND blocks the pure-EN path (needs ar==0). Caller
        should keep the previous language hint instead of forcing a switch."""
        text = "Tell me about your previous role ا"
        assert detect_lang_from_text(text) is None

    def test_two_arabic_letters_with_high_share_is_arabic(self) -> None:
        assert detect_lang_from_text("نعم") == "ar"

    def test_topic_change_request_arabic(self) -> None:
        assert detect_lang_from_text("ممكن نغير السؤال") == "ar"

    def test_topic_change_request_english(self) -> None:
        assert detect_lang_from_text("can we change the question") == "en"

    def test_brand_name_in_arabic_stays_arabic(self) -> None:
        assert detect_lang_from_text("قدمت على شركة EVAALO قبل شهر") == "ar"


class TestDetectLangReplyFallback:
    @pytest.mark.parametrize("text", ["ok", "yes", "thanks"])
    def test_short_pure_latin_is_english(self, text: str) -> None:
        assert detect_lang_reply_fallback(text) == "en"

    @pytest.mark.parametrize("text", ["تمام", "نعم", "لا"])
    def test_short_pure_arabic_is_arabic(self, text: str) -> None:
        assert detect_lang_reply_fallback(text) == "ar"

    def test_mixed_returns_none(self) -> None:
        """Code-switching short reply: fallback abstains, primary detector decides."""
        assert detect_lang_reply_fallback("ok recruitment تمام") is None

    @pytest.mark.parametrize("text", ["", "  ", "12345", "..."])
    def test_empty_or_no_letters_returns_none(self, text: str) -> None:
        assert detect_lang_reply_fallback(text) is None


class TestDetectLanguageSwitchIntent:
    """Detect explicit language-switch requests regardless of carrier language."""

    @pytest.mark.parametrize(
        "text",
        [
            "can we speak in english",
            "let's continue in English",
            "switch to english please",
            "please speak english",
            "english please",
            "talk in English",
            "use english from now on",
        ],
    )
    def test_english_intent_in_english_carrier(self, text: str) -> None:
        assert detect_language_switch_intent(text) == "en"

    @pytest.mark.parametrize(
        "text",
        [
            "ممكن نتكلم بالإنجليزي",
            "بالإنجليزية لو سمحت",
            "تكلم معي بالإنجليزي",
            "حكي بالانكليزي",
            "بالانجليزي please",
            "نحكي إنجليزي",
        ],
    )
    def test_english_intent_in_arabic_carrier(self, text: str) -> None:
        assert detect_language_switch_intent(text) == "en"

    @pytest.mark.parametrize(
        "text",
        [
            "can we speak in arabic",
            "let's continue in Arabic",
            "switch back to arabic",
            "speak Arabic please",
            "back to arabic",
            "use arabic from now on",
        ],
    )
    def test_arabic_intent_in_english_carrier(self, text: str) -> None:
        assert detect_language_switch_intent(text) == "ar"

    @pytest.mark.parametrize(
        "text",
        [
            "بالعربي لو سمحت",
            "بالعربية please",
            "نرجع للعربية",
            "عربي فقط",
        ],
    )
    def test_arabic_intent_in_arabic_carrier(self, text: str) -> None:
        assert detect_language_switch_intent(text) == "ar"

    @pytest.mark.parametrize(
        "text",
        [
            "نعم",
            "ok",
            "عندي مهارة recruitment",
            "Tell me about your role",
            "ممكن نغير السؤال",
            "what is your name",
            "هواية حلو",
            "",
            "   ",
        ],
    )
    def test_no_intent_returns_none(self, text: str) -> None:
        assert detect_language_switch_intent(text) is None


class TestEnvKnobs:
    def test_lower_ar_share_floor_makes_ar_classification_easier(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Edge case: with default 0.35, this would be ambiguous; with 0.15 → ar."""
        text = "I have خبرة in human resources management for many years"
        assert detect_lang_from_text(text) is None

        monkeypatch.setenv("LANG_DETECT_AR_SHARE_FLOOR", "0.05")
        assert detect_lang_from_text(text) == "ar"

    def test_higher_en_min_latin_chars_makes_en_harder(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Default min is 8; raise to 50 → 'recruitment manager' (≈18) goes ambiguous."""
        text = "recruitment manager"
        assert detect_lang_from_text(text) == "en"

        monkeypatch.setenv("LANG_DETECT_EN_MIN_LATIN_CHARS", "50")
        assert detect_lang_from_text(text) is None
