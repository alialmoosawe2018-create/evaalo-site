"""Tests for reception reply text normalization."""

from reception.reply_normalizer import CANONICAL_AR_BRAND, normalize_reception_reply


def test_fixes_latin_v_in_arabic_brand() -> None:
    assert normalize_reception_reply("مرحبًا بك في ایvالو") == f"مرحبًا بك في {CANONICAL_AR_BRAND}"


def test_fixes_hamza_variants() -> None:
    assert normalize_reception_reply("منصة إيفالو") == f"منصة {CANONICAL_AR_BRAND}"
    assert normalize_reception_reply("منصة ايفالو") == f"منصة {CANONICAL_AR_BRAND}"


def test_keeps_evaalo_in_english_reply() -> None:
    text = "Welcome to Evaalo today."
    assert normalize_reception_reply(text) == text


def test_replaces_evaalo_when_arabic_present() -> None:
    assert (
        normalize_reception_reply("Evaalo تساعدك بالتوظيف")
        == f"{CANONICAL_AR_BRAND} تساعدك بالتوظيف"
    )


def test_collapses_extra_spaces() -> None:
    assert normalize_reception_reply("أهلًا   بك") == "أهلًا بك"
