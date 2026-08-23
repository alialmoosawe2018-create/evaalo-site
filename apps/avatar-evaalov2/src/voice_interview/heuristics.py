"""Lightweight signal extraction from candidate transcripts.

Used by ``InterviewAssistant.on_user_turn_completed`` to produce a small
diagnostic dict that informs the decision-frame system message we inject
into the LLM context before it generates the next reply.

Design intent:
- Pure Python, no model calls — runs in <1ms after STT final.
- Surface signals only (``is_shallow``, ``is_unsure``, ``is_topic_change_request``).
- The Agent (memory + decision frame builder) decides what to do with them.

Tunable via env:
- ``HEURISTIC_SHALLOW_CHARS`` (default 30) — answers shorter than this are flagged shallow.
- ``HEURISTIC_RICH_ANSWER_CHARS`` (default 80) — longer answers flagged as rich.
- ``HEURISTIC_DISABLE`` (default 0) — when truthy, ``analyze_user_answer`` returns a noop dict.
"""

from __future__ import annotations

import os
import re

# Bilingual cue lists (Arabic + English). Lowercased for matching.
_UNSURE_PATTERNS_AR = (
    "ما اعرف",
    "ما أعرف",
    "ما عندي فكرة",
    "ما عندي فكره",
    "لا اعرف",
    "لا أعرف",
    "ما اتذكر",
    "ما أتذكر",
    "لا اتذكر",
    "لا أتذكر",
    "مش عارف",
    "مش متأكد",
    "غير متأكد",
    "ما متأكد",
)

_UNSURE_PATTERNS_EN = (
    "i don't know",
    "i dont know",
    "i do not know",
    "not sure",
    "i'm not sure",
    "im not sure",
    "no idea",
    "can't remember",
    "cant remember",
    "i forget",
    "i forgot",
)

_TOPIC_CHANGE_PATTERNS_AR = (
    "غير السؤال",
    "غيّر السؤال",
    "غير السوال",
    "غير سؤال",
    "غير سوال",
    "بدّل السؤال",
    "بدل السؤال",
    "بدل سؤال",
    "اعطني سؤال",
    "أعطني سؤال",
    "عطني سؤال",
    "اسألني سؤال",
    "اسالني سؤال",
    "سؤال ثاني",
    "السؤال الثاني",
    "سؤال آخر",
    "سؤال اخر",
    "سؤال غير",
    "سوال ثاني",
    "سوال اخر",
    "تخطى",
    "تخطي",
    "تجاوز",
    "انتقل",
    "السؤال التالي",
    "سؤال جديد",
    "خلينا نغير",
    "خلنا نغير",
    "نغير السؤال",
    "نغير سؤال",
    "غير اكثر",
    "غير أكثر",
    "موضوع ثاني",
    "سؤال مختلف",
    "ما اريد",
    "ما أريد",
    "كفى",
    "خلاص",
    "سؤال اخر ايضا",
    "سؤال آخر أيضا",
    "وكله غير",
    "وكلنا غير",
    "ما فكر بهذا السؤال",
    "ما فكرت بهذا السؤال",
    "ما عندي جواب",
    "ما عندي جواب على",
    "هذا السؤال ما اعرفه",
    "هذا السؤال ما أعرفه",
    "هذا السؤال ما عرفه",
    "ممكن نغير",
    "ممكن غير السؤال",
    "ممكن نغير السؤال",
    "نغير",
    "السؤال ما عاجبني",
    "سؤال ما عاجبني",
    "خلينا نغير السؤال",
    "خلينا نغير سؤال",
    "ما اعرف اجاوب",
    "ما أعرف أجاوب",
    "ما اعرف اجوب",
    "ما أعرف أجوب",
    "ما عرف اجاوب",
    "ما عرف أجاوب",
)

_TOPIC_CHANGE_PATTERNS_EN = (
    "change the question",
    "change question",
    "another question",
    "different question",
    "next question",
    "skip this",
    "skip the question",
    "skip it",
    "skip",
    "move on",
    "move to the next",
    "pass this",
    "change topic",
    "different topic",
)

_INTRO_SELF_PATTERNS_AR = (
    "عن نفسي",
    "تعرفني عن نفسي",
    "عرفني عن نفسي",
    "حچي عن تجربتي",
    "حچي عن خبرتي",
    "خليني اعرفك عن نفسي",
    "خلني اعرفك عن نفسي",
)

_INTRO_SELF_PATTERNS_EN = (
    "about my experience",
    "about my background",
    "tell you about myself",
    "let me introduce myself",
    "talk about my background",
)

# Candidate asks who the interviewer/agent is — NOT the same as intro_self.
# «عرفيني عن نفسك» = introduce YOURself (the agent), not the candidate's CV.
_ASK_INTERVIEWER_PATTERNS_AR = (
    "تعرفيني عليك",
    "تعرفني عليك",
    "عرفيني عليك",
    "عرفني عليك",
    "تعرفينا عليك",
    "تعرفنا عليك",
    "عرفينا عليك",
    "عرفنا عليك",
    "تعرفيني عن نفسك",
    "تعرفني عن نفسك",
    "عرفيني عن نفسك",
    "عرفني عن نفسك",
    "تعرفيني اكثر عن نفسك",
    "تعرفيني أكثر عن نفسك",
    "عرفيني اكثر عن نفسك",
    "حچي عن نفسك",
    "حچي عن نفسچ",
    "عن نفسك",
    "عن نفسچ",
    "تعرفنا على حضرتك",
    "تعرفينا على حضرتك",
    "تعرفرينة على حضرت",
    "عرفينا على حضرتك",
    "عرفينا على حضرتج",
    "تعرفنا عليج",
    "تعرفينا عليج",
    "على چنت",
    "على انت",
    "على انته",
    "على انتي",
    "ما تعرفنا عليك",
    "لسه ما تعرفنا",
    "احنا لسه ما تعرفنا",
    "ما تعرفنا",
    "من انت",
    "منو انت",
    "انت منو",
    "شنو انت",
    "شكون انت",
    "شكو انت",
    "شكو انته",
    "انت مين",
    "مين انت",
    "شنو انتي",
    "حضرتك",
    "حضرتج",
    "انا اللي بنيتك",
    "انا اللي سويتك",
    "انا سويتك",
    "انت جزء من هذا",
    "انت جزء من الاختبار",
    "انا سويت نظام",
    "انا بنيت نظام",
    "انت هسة كنظام",
)

_ASK_INTERVIEWER_PATTERNS_EN = (
    "who are you",
    "who is interviewing",
    "who am i speaking to",
    "who am i talking to",
    "we haven't met you",
    "we have not met you",
    "introduce yourself to me",
    "introduce yourself",
    "tell me about yourself",
    "about yourself",
)

_CLARIFY_PATTERNS_AR = (
    "وضح",
    "وضحي",
    "توضح",
    "توضحي",
    "توضيح",
    "وضحي لي السؤال",
    "وضح لي السؤال",
    "وضحيلي السؤال",
    "السؤال اكثر",
    "السؤال أكثر",
    "شنو تقصد",
    "شنو تقصدين",
    "شنو معنى",
    "شنو معني",
    "ما فهمت",
    "ما فهمت السؤال",
    "اشرح",
    "اشرحي",
    "اشرحيلي",
    "اشرحي لي",
    "توضحي لي",
    "توضحيلي",
    "وضحيلي",
    "وضحي لي",
    "ممكن توضحي",
    "ممكن توضح",
    "شنو تقصد ب",
    "شنو تقصدين ب",
    "شنو معنى",
    "شنو معني",
    "معنى",
    "وضحلي أكثر",
    "وضحي أكثر",
    "وضحي اكثر",
    # MSA / Gulf / Levantine clarify phrasings. The agent speaks light Iraqi,
    # but candidates often ask for clarification in MSA ("ماذا تقصدين…") or
    # Gulf/Levantine ("وش/شو/أيش تقصد"). "ماذا تقصد" also covers "ماذا تقصدين".
    "ماذا تقصد",
    "ماذا تعني",
    "شو تقصد",
    "وش تقصد",
    "أيش تقصد",
    "ايش تقصد",
)

_CLARIFY_PATTERNS_EN = (
    "what do you mean",
    "clarify",
    "explain what you mean",
)

_ROLE_OBJECTION_PATTERNS_AR = (
    "شنو دخل",
    "شنو علاقة",
    "ما له",
    "ماله",
    "ما الها",
    "شنو لها",
    "ما يخص",
    "ما يخصني",
    "ما يخصني هذا",
    "شنو دخل هذا",
)

_ROLE_OBJECTION_PATTERNS_EN = (
    "what does this have to do",
    "not relevant",
    "unrelated to",
    "nothing to do with",
)

# Greeting / readiness only — no interview substance yet.
_GREETING_READY_PATTERNS_AR = (
    "اهلا",
    "أهلا",
    "اهلين",
    "مرحبا",
    "مرحباً",
    "السلام",
    "صباح الخير",
    "مساء الخير",
    "جاهز",
    "جاهزه",
    "جاهزة",
    "تفضل",
    "تفضلي",
    "فضلت",
    "فضلتي",
    "هيا",
    "يلا",
    "تمام",
    "اوكي",
    "أوكي",
    "ok",
    "حسنا",
    "حسناً",
    "نعم",
    "اي",
    "إي",
)

_GREETING_READY_PATTERNS_EN = (
    "hello",
    "hi there",
    "good morning",
    "good afternoon",
    "i am ready",
    "i'm ready",
    "im ready",
    "ready to start",
    "let's go",
    "lets go",
    "yes i am",
)

# Signals the candidate shared real experience (not just greeting / skip).
_EXPERIENCE_MARKERS_AR = (
    "اشتغلت",
    "اشتغل",
    "عملت",
    "سويت",
    "خبرتي",
    "خبرة",
    "مشروع",
    "حقل",
    "شركة",
    "سنوات",
    "سنه",
    "سنة",
    "استخدمت",
    "استخدم",
    "اشتغل على",
    "اشتغلت على",
)

_EXPERIENCE_MARKERS_EN = (
    "i worked",
    "i work",
    "my experience",
    "years of",
    "project",
    "i used",
    "we used",
    "i led",
    "i managed",
)

# Channels / sourcing tools — strong follow-up hooks even in short utterances.
_CHANNEL_HOOK_MARKERS = (
    "linkedin",
    "لينكد",
    "telegram",
    "تيليجرام",
    "تلغرام",
    "تلجرام",
    "whatsapp",
    "واتساب",
    "واتس",
    "إحالة",
    "احالة",
    "إحالات",
    "referral",
    "referrals",
    "boolean",
    "indeed",
    "bayt",
    "ats",
)


def _truthy_env(key: str) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _shallow_threshold() -> int:
    raw = (os.getenv("HEURISTIC_SHALLOW_CHARS") or "").strip()
    if not raw:
        return 30
    try:
        n = int(raw)
    except ValueError:
        return 30
    return max(5, min(500, n))


def _rich_threshold() -> int:
    raw = (os.getenv("HEURISTIC_RICH_ANSWER_CHARS") or "").strip()
    if not raw:
        return 80
    try:
        n = int(raw)
    except ValueError:
        return 80
    return max(40, min(500, n))


_WS_RE = re.compile(r"\s+")
# Punctuation (Latin + Arabic) is turned into spaces so STT output like
# "غير. السؤال. لو سمحت." still matches the pattern "غير السؤال".
_PUNCT_RE = re.compile(r"[.,!?;:؟،؛…«»\"'()\[\]{}\-_/\\]+")


def normalize_text(text: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace + strip Arabic tatweel/diacritics."""
    if not text:
        return ""
    s = text.strip()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).lower().strip()
    s = s.replace("\u0640", "")
    s = re.sub(r"[\u064b-\u065f\u0670]", "", s)
    s = s.replace("ـ", "")
    return s


_QUESTION_FRAMING_STOPWORDS = frozenset(
    {
        # Arabic framing / dialect fillers — shared across most questions so they
        # carry no topical signal.
        "شنو", "شو", "شلون", "وشلون", "شكد", "وشكد", "كيف", "وكيف", "ليش", "وين",
        "متى", "مين", "ماذا", "هل", "اللي", "الي", "عن", "من", "في", "على", "حتى",
        "بين", "هسه", "هسة", "زين", "تمام", "جيد", "طيب", "حلو", "احچيلي", "احجيلي",
        "تحچيلي", "تحجيلي", "حچيلي", "تگدر", "تكدر", "تقدر", "ممكن", "اذكرلي", "خذ",
        "راحتك", "هذا", "هذه", "يوضح", "مثال", "عملي", "بسيط", "اي", "انت", "عندك",
        "وياك", "لما", "لو",
        # English framing
        "what", "how", "why", "when", "where", "which", "who", "tell", "about",
        "me", "your", "you", "can", "could", "would", "the", "an", "of", "in",
        "on", "to", "and", "do", "give", "share", "please", "example",
    }
)


def _content_tokens(text: str) -> list[str]:
    return [
        t
        for t in normalize_text(text).split()
        if len(t) >= 2 and t not in _QUESTION_FRAMING_STOPWORDS
    ]


def is_semantic_duplicate_question(
    text: str, recent: list[str], threshold: float = 0.72
) -> bool:
    """True if ``text`` is verbatim or a near-duplicate of any recent question.

    Compares topical content tokens (framing/dialect fillers dropped) so that
    "شلون تقرر الأولويات..." vs the same line with a "؟", or a question that is a
    subset of a longer earlier one, both count as repeats. The exact-match loop
    guard in InterviewMemory missed these because raw normalized keys differ.
    """
    a = set(_content_tokens(text))
    if len(a) < 2:
        return False
    for r in recent or []:
        b = set(_content_tokens(r))
        if len(b) < 2:
            continue
        overlap = len(a & b)
        if overlap < 2:
            continue
        if overlap / max(len(a), len(b)) >= threshold:
            return True
        if overlap / min(len(a), len(b)) >= 0.8:  # short question fully inside a longer one
            return True
    return False


# Conservative HR / recruiting topic map. Each topic lists DISTINCTIVE keywords
# (normalized, no diacritics). A question is tagged with a topic only when it
# clearly matches — outside these topics the classifier returns None so other
# job domains are never wrongly deduped. This catches paraphrased repeats whose
# wording differs but subject is identical (e.g. "أهداف متعارضة" vs "أولويات
# متنافسة") which pure lexical overlap misses.
_TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "prioritization": ("اولويات", "أولويات", "متعارضة", "متعارضه", "متنافسة", "متنافسه", "عدم اليقين"),
    "data_evidence": ("بيانات", "ادلة", "أدلة", "توصيات", "تحليل", "مؤشرات", "قياس النجاح"),
    "negotiation": ("تفاوض", "راتب", "مرتب", "مزايا", "تعويضات", "العرض الوظيفي"),
    "sourcing": ("قنوات الاستقطاب", "استقطاب", "linkedin", "تليجرام", "تيليجرام", "مصادر التوظيف"),
    "requirements": ("متطلبات الدور", "المواصفات", "المؤهلات", "احتياجات الدور", "وصف الوظيفة"),
    "screening": ("فلترة", "فرز", "المعايير", "سكرين", "سي في", "cv", "تقييم المرشح"),
    "candidate_experience": ("تجربة المرشح", "تجربة المرشحين", "الفيدباك", "feedback", "ملاحظات المرشح"),
    "confidentiality": ("سرية", "سريه", "معلومات حساسة", "حماية المعلومات", "خصوصية"),
}


def classify_interview_topic(text: str) -> str | None:
    """Best-effort single topic for an HR/recruiting question, else None.

    Returns a topic only on a clear, unambiguous match (a strict winner by
    keyword hits); ties or no hits return None so we never over-merge distinct
    questions or touch non-HR domains.
    """
    norm = normalize_text(text)
    if not norm:
        return None
    best: str | None = None
    best_hits = 0
    tie = False
    for topic, kws in _TOPIC_KEYWORDS.items():
        hits = sum(1 for kw in kws if normalize_text(kw) in norm)
        if hits > best_hits:
            best, best_hits, tie = topic, hits, False
        elif hits == best_hits and hits > 0:
            tie = True
    if best_hits == 0 or tie:
        return None
    return best


def is_topic_repeat(text: str, recent: list[str]) -> bool:
    """True if ``text`` maps to the same HR topic as any recent question.

    Catches paraphrased repeats that share subject but not wording. Returns
    False when the topic is unclassifiable (None), so it only fires on clear
    same-topic repeats inside the HR/recruiting domain.
    """
    topic = classify_interview_topic(text)
    if topic is None:
        return False
    for r in recent or []:
        if classify_interview_topic(r) == topic:
            return True
    return False


_CLARIFY_CHALLENGE_PATTERNS_AR = (
    "ما لها علاقة",
    "ما له علاقة",
    "مو متعلق",
    "غير متعلق",
    "هذه المؤشرات",
    "هذي المؤشرات",
    "هالمؤشرات",
    "ما لها دخل",
    "ما له دخل",
    "مو بهندسة",
    "ما يخص النفط",
    "ما يخص البترول",
)

_CLARIFY_CHALLENGE_PATTERNS_EN = (
    "not related",
    "unrelated",
    "nothing to do",
    "doesn't relate",
    "does not relate",
    "wrong metrics",
    "not about oil",
    "not about petroleum",
)

_INCOMPLETE_REQUEST_TIME_AR = (
    "بس دقيقة",
    "بس لحظة",
    "انطيني وقت",
    "أعطيني وقت",
    "اعطيني وقت",
    "خذ راحتك",
    "خلي راحتك",
    "لحظة",
    "دقيقة",
    "اوضح",
    "أوضح",
    "خليني اوضح",
    "خليني أوضح",
    "انتظر",
    "استنى",
    "استني",
)

_INCOMPLETE_REQUEST_TIME_EN = (
    "give me a moment",
    "give me time",
    "one moment",
    "hold on",
    "let me explain",
    "let me finish",
    "wait",
)

_INCOMPLETE_TRAILING_AR = (
    "فـ",
    "يعني",
    "وبعدين",
    "فاحنا",
    "فاحنا",
    "تقصدين إنه",
    "تقصدين انه",
    "أنا أعرف أين",
    "انا اعرف اين",
    "وانا",
    "وأنا",
    "وبعدين",
)

_RESUME_ACTIVE_PATTERNS_AR = (
    "خليني أجاوب",
    "خليني اجاوب",
    "خليني أكمل",
    "خليني اكمل",
    "خليني أكمل الجواب",
    "خليني اكمل الجواب",
    "هذا السؤال جاوبته",
    "جاوبت على سؤالك",
    "رجع للسؤال",
    "ارجع للسؤال",
    "كمل جوابي",
)

_RESUME_ACTIVE_PATTERNS_EN = (
    "let me answer",
    "let me finish",
    "i already answered",
    "back to the question",
)

_EXPLICIT_REJECT_PATTERNS_AR = (
    "رفضت أجاوب",
    "رفضت اجاوب",
    "ما راح أجاوب",
    "ما راح اجاوب",
    "سألتني أكثر من مرة",
    "سألتني اكثر من مرة",
    "ما اريد اجاوب",
    "ما أريد أجاوب",
)

_EXPLICIT_REJECT_PATTERNS_EN = (
    "i refuse to answer",
    "won't answer",
    "asked me that before",
    "already asked me",
)

_STORY_STARTER_PATTERNS_AR = (
    "كان ذو صفات",
    "كان عنده صفات",
    "كان مرشح",
    "كان مدير",
    "كان صعب",
    "كان دور",
)

_AMBIGUOUS_CLARIFY_SNIPPETS = (
    "اي امور ممكن",
    "أي أمور ممكن",
    "اي امور",
    "أي أمور",
    "ممكن",
)

_ASK_GUIDANCE_PATTERNS_AR = (
    "شنو الاجراء",
    "شنو الإجراء",
    "شنو الانسب",
    "شنو الأنسب",
    "شنو الافضل",
    "شنو الأفضل",
    "شنو الصحيح",
    "شنو اسوي",
    "شنو أسوي",
    "شلون اتصرف",
    "شلون أتصرف",
    "علمني",
    "علّمني",
    "اريد نصيحة",
    "أريد نصيحة",
    "نصيحتك",
    "شنو تنصحني",
    "شنو تنصحيني",
    "ما مرت علي",
    "ما مرت عليّ",
    "ما مرت عليه",
    "ما عندي تجربة",
    "ما عندي خبرة",
    "ما صار وياي",
    "ما صار وياي",
    "انا اسال",
    "أنا أسأل",
    "اسال شنو",
    "أسأل شنو",
    "شنو الاجراء الانسب",
    "شنو الإجراء الأنسب",
    "ايش اسوي",
    "شلون اكون",
)

_ASK_GUIDANCE_PATTERNS_EN = (
    "what should i do",
    "what is the best approach",
    "what's the best approach",
    "how should i handle",
    "teach me",
    "your advice",
    "never had this experience",
    "no experience with this",
    "what do you recommend",
)

_ASK_EXAMPLE_PATTERNS_AR = (
    "اعطني مثال",
    "أعطني مثال",
    "مثال عملي",
    "ممكن مثال",
    "تعطيني مثال",
)

_ASK_EXAMPLE_PATTERNS_EN = (
    "give me an example",
    "an example",
    "for example how",
)

def _is_incomplete_turn(norm: str, raw: str) -> bool:
    """Detect interrupted / unfinished candidate speech (distinct from shallow)."""
    if not norm:
        return False
    if _matches_any(norm, _INCOMPLETE_REQUEST_TIME_AR) or _matches_any(
        norm, _INCOMPLETE_REQUEST_TIME_EN
    ):
        return True
    raw_stripped = (raw or "").rstrip()
    if raw_stripped.endswith("…") or raw_stripped.endswith("..."):
        return True
    for ending in _INCOMPLETE_TRAILING_AR:
        e = normalize_text(ending)
        if e and (norm.endswith(e) or norm.rstrip().endswith(e)):
            return True
    return False


def _detect_clarify_challenge(norm: str) -> bool:
    return _matches_any(norm, _CLARIFY_CHALLENGE_PATTERNS_AR) or _matches_any(
        norm, _CLARIFY_CHALLENGE_PATTERNS_EN
    )


def _is_clarify_about_question(norm: str) -> bool:
    """True when the candidate asks what the interviewer meant — not for best practice."""
    if not _matches_any(norm, _CLARIFY_PATTERNS_AR) and not _matches_any(
        norm, _CLARIFY_PATTERNS_EN
    ):
        return False
    if any(k in norm for k in ("اجراء", "إجراء", "انسب", "أنسب", "افضل", "أفضل", "صحيح")):
        return False
    return any(k in norm for k in ("تقصد", "توضح", "معنى", "معني", "فهمت", "السؤال"))


def _detect_candidate_intent(norm: str) -> str | None:
    """Candidate asks for guidance/example — distinct from clarify or topic skip."""
    if _is_clarify_about_question(norm):
        return None
    if _matches_any(norm, _ASK_EXAMPLE_PATTERNS_AR) or _matches_any(
        norm, _ASK_EXAMPLE_PATTERNS_EN
    ):
        return "ask_example"
    if _matches_any(norm, _ASK_GUIDANCE_PATTERNS_AR) or _matches_any(
        norm, _ASK_GUIDANCE_PATTERNS_EN
    ):
        return "ask_guidance"
    return None


def _is_topic_change_request(norm: str) -> bool:
    if _matches_any(norm, _TOPIC_CHANGE_PATTERNS_AR) or _matches_any(
        norm, _TOPIC_CHANGE_PATTERNS_EN
    ):
        return True
    if "نغير" in norm and ("سؤال" in norm or "سوال" in norm):
        return True
    if "غير" in norm and ("سؤال" in norm or "سوال" in norm) and any(
        k in norm for k in ("ممكن", "خلينا", "خلنا", "نبي", "نريد", "اريد", "أريد")
    ):
        return True
    if "ما فكر" in norm and ("سؤال" in norm or "سوال" in norm):
        return True
    if "ما عندي جواب" in norm or ("ما اعرف" in norm and ("سؤال" in norm or "سوال" in norm)):
        return True
    if "السؤال ما عاجبني" in norm or "سؤال ما عاجبني" in norm:
        return True
    return False


def _matches_any(haystack: str, patterns: tuple[str, ...]) -> bool:
    if not haystack:
        return False
    for p in patterns:
        if p and p in haystack:
            return True
    return False


def _detect_meta_request(norm: str) -> str | None:
    """Return meta-request kind or None.

    Priority: clarify_challenge > role_objection > ask_interviewer > clarify_term > intro_self.
    """
    if _detect_clarify_challenge(norm) and (
        _matches_any(norm, _CLARIFY_PATTERNS_AR)
        or _matches_any(norm, _CLARIFY_PATTERNS_EN)
        or "مؤشر" in norm
        or "metric" in norm
    ):
        return "clarify_challenge"
    if _matches_any(norm, _ROLE_OBJECTION_PATTERNS_AR) or _matches_any(
        norm, _ROLE_OBJECTION_PATTERNS_EN
    ):
        return "role_objection"
    if _is_ask_interviewer_request(norm):
        return "ask_interviewer"
    if _matches_any(norm, _CLARIFY_PATTERNS_AR) or _matches_any(norm, _CLARIFY_PATTERNS_EN):
        return "clarify_term"
    if _matches_any(norm, _INTRO_SELF_PATTERNS_AR) or _matches_any(
        norm, _INTRO_SELF_PATTERNS_EN
    ):
        return "intro_self"
    return None


def _is_ask_interviewer_request(norm: str) -> bool:
    """True when the candidate wants the agent to introduce itself."""
    if _matches_any(norm, _ASK_INTERVIEWER_PATTERNS_AR) or _matches_any(
        norm, _ASK_INTERVIEWER_PATTERNS_EN
    ):
        return True
    # Iraqi STT: «نفسك» = yourself (the agent); «نفسي» stays intro_self.
    if ("نفسك" in norm or "نفسچ" in norm) and any(
        k in norm for k in ("عرف", "تعرف", "حچي", "قلي", "قولي", "تعرفنا", "تعرفينا")
    ):
        return True
    if "yourself" in norm and any(
        k in norm for k in ("introduce", "tell", "about", "who")
    ):
        return True
    return False


def _is_greeting_or_ready_only(norm: str) -> bool:
    """True when the utterance is only greetings/readiness with no experience substance."""
    if not norm:
        return False
    if _matches_any(norm, _EXPERIENCE_MARKERS_AR) or _matches_any(norm, _EXPERIENCE_MARKERS_EN):
        return False
    if len(norm) >= 55:
        return False
    return _matches_any(norm, _GREETING_READY_PATTERNS_AR) or _matches_any(
        norm, _GREETING_READY_PATTERNS_EN
    )


def _has_experience_markers(norm: str) -> bool:
    return _matches_any(norm, _EXPERIENCE_MARKERS_AR) or _matches_any(
        norm, _EXPERIENCE_MARKERS_EN
    )


def _has_channel_hook_markers(norm: str) -> bool:
    return _matches_any(norm, _CHANNEL_HOOK_MARKERS)


def strip_topic_change_phrases(text: str) -> str:
    """Remove skip/change-question phrases; return normalized remainder."""
    norm = normalize_text(text or "")
    if not norm:
        return ""
    remainder = norm
    all_patterns = sorted(
        (*_TOPIC_CHANGE_PATTERNS_AR, *_TOPIC_CHANGE_PATTERNS_EN),
        key=len,
        reverse=True,
    )
    for p in all_patterns:
        if p:
            remainder = remainder.replace(p, " ")
    return _WS_RE.sub(" ", remainder).strip()


def _remainder_is_substantive(remainder: str, *, rich_cutoff: int) -> bool:
    if not remainder or len(remainder) < 10:
        return False
    if _has_experience_markers(remainder) or _has_channel_hook_markers(remainder):
        return True
    return len(remainder) >= min(25, rich_cutoff // 2)


def _is_substantive_answer(
    norm: str,
    *,
    is_greeting_or_ready: bool,
    is_topic_change: bool,
    is_unsure: bool,
    length: int,
    rich_cutoff: int,
) -> bool:
    """True when the candidate shared content worth linking a follow-up to."""
    if is_greeting_or_ready or is_unsure or not norm:
        return False
    if _has_experience_markers(norm):
        return True
    if length >= rich_cutoff:
        return True
    # Topic-change + short correction still counts if they name their tool/scope.
    if is_topic_change and length >= 25 and _has_experience_markers(norm):
        return True
    return length >= 45 and not is_topic_change


def _empty_diag() -> dict:
    return {
        "length": 0,
        "is_shallow": False,
        "is_unsure": False,
        "is_topic_change_request": False,
        "is_rich_answer": False,
        "is_greeting_or_ready": False,
        "is_substantive_answer": False,
        "is_incomplete_turn": False,
        "honor_skip_content": False,
        "topic_change_remainder": "",
        "meta_request": None,
        "suggest_followup": False,
        "suggest_clarify": False,
        "suggest_advance": True,
        "resume_active": False,
        "is_ambiguous_clarify": False,
        "is_answer_in_progress": False,
        "explicit_question_reject": False,
        "is_story_starter": False,
        "candidate_intent": None,
        "is_ask_for_guidance": False,
        "disabled": True,
    }


def _is_ambiguous_clarify(
    norm: str,
    *,
    active_question_text: str,
    active_question_status: str,
    meta_request: str | None,
    length: int,
    is_substantive: bool,
) -> bool:
    if not active_question_text or active_question_status not in (
        "awaiting_answer",
        "clarifying",
    ):
        return False
    if is_substantive and length >= 20 and _has_experience_markers(norm):
        return False
    for snippet in _AMBIGUOUS_CLARIFY_SNIPPETS:
        sn = normalize_text(snippet)
        if sn and sn in norm and length < 35:
            return True
    if meta_request == "clarify_term" and length < 25 and not is_substantive:
        return True
    return False


def analyze_user_answer(
    text: str,
    lang: str = "auto",
    *,
    active_question_text: str = "",
    active_question_status: str = "",
) -> dict:
    """Return a small dict of signals about the candidate's last turn.

    Keys (always present):
        length: int
        is_shallow: bool
        is_unsure: bool
        is_topic_change_request: bool
        is_rich_answer: bool
        is_greeting_or_ready: bool
        is_substantive_answer: bool
        meta_request: str | None  — intro_self | clarify_term | role_objection | ask_interviewer
        suggest_followup / suggest_clarify / suggest_advance
        disabled: bool
    """
    del lang  # reserved for future locale-specific logic
    if _truthy_env("HEURISTIC_DISABLE"):
        return _empty_diag()

    norm = normalize_text(text or "")
    length = len(norm)
    shallow_cutoff = _shallow_threshold()
    rich_cutoff = _rich_threshold()

    is_topic_change = _is_topic_change_request(norm)
    is_unsure = _matches_any(norm, _UNSURE_PATTERNS_AR) or _matches_any(
        norm, _UNSURE_PATTERNS_EN
    )
    is_shallow = length > 0 and length < shallow_cutoff
    is_incomplete = False if is_topic_change else _is_incomplete_turn(norm, text or "")
    meta_request = (
        None
        if is_topic_change or is_incomplete
        else _detect_meta_request(norm)
    )
    if meta_request == "clarify_term" and _detect_candidate_intent(norm) == "ask_guidance":
        meta_request = None
    candidate_intent = None
    if not is_topic_change and not is_incomplete:
        candidate_intent = _detect_candidate_intent(norm)
    is_ask_for_guidance = candidate_intent in ("ask_guidance", "ask_example")
    is_greeting = _is_greeting_or_ready_only(norm)
    topic_change_remainder = strip_topic_change_phrases(text) if is_topic_change else ""
    remainder_substantive = (
        _remainder_is_substantive(topic_change_remainder, rich_cutoff=rich_cutoff)
        if is_topic_change
        else False
    )
    is_substantive = _is_substantive_answer(
        norm,
        is_greeting_or_ready=is_greeting,
        is_topic_change=is_topic_change,
        is_unsure=is_unsure,
        length=length,
        rich_cutoff=rich_cutoff,
    )
    if remainder_substantive:
        is_substantive = True
    honor_skip_content = is_topic_change and remainder_substantive
    has_hook_markers = _has_channel_hook_markers(norm)
    is_rich = (
        is_substantive
        and not is_topic_change
        and not is_unsure
        and not is_incomplete
        and (length >= rich_cutoff or has_hook_markers)
    )

    suggest_clarify = is_unsure or meta_request in ("clarify_term", "clarify_challenge")
    suggest_followup = (
        (is_shallow or has_hook_markers)
        and not is_unsure
        and not is_topic_change
        and not is_greeting
        and not is_incomplete
        and is_substantive
    )
    resume_active = False if is_topic_change else (
        _matches_any(norm, _RESUME_ACTIVE_PATTERNS_AR)
        or _matches_any(norm, _RESUME_ACTIVE_PATTERNS_EN)
    )
    explicit_question_reject = _matches_any(
        norm, _EXPLICIT_REJECT_PATTERNS_AR
    ) or _matches_any(norm, _EXPLICIT_REJECT_PATTERNS_EN)
    is_ambiguous_clarify = False if is_topic_change else _is_ambiguous_clarify(
        norm,
        active_question_text=active_question_text,
        active_question_status=active_question_status,
        meta_request=meta_request,
        length=length,
        is_substantive=is_substantive,
    )
    is_answer_in_progress = False if is_topic_change else (
        is_incomplete
        or (
            is_shallow
            and is_substantive
            and not is_greeting
            and (_has_experience_markers(norm) or _matches_any(norm, _INCOMPLETE_TRAILING_AR))
        )
    )
    is_story_starter = (
        is_shallow
        and not is_topic_change
        and not is_greeting
        and _matches_any(norm, _STORY_STARTER_PATTERNS_AR)
    )

    suggest_advance = (
        (not is_shallow)
        and (not is_unsure)
        and (not is_topic_change)
        and not is_incomplete
        and meta_request is None
        and not is_greeting
        and not is_answer_in_progress
        and not is_story_starter
        and not resume_active
        and not is_ask_for_guidance
    )
    if active_question_status in ("awaiting_answer", "answering", "clarifying"):
        suggest_advance = suggest_advance and is_rich

    return {
        "length": length,
        "is_shallow": is_shallow,
        "is_incomplete_turn": is_incomplete,
        "is_unsure": is_unsure,
        "is_topic_change_request": is_topic_change,
        "is_rich_answer": is_rich,
        "is_greeting_or_ready": is_greeting,
        "is_substantive_answer": is_substantive,
        "honor_skip_content": honor_skip_content,
        "topic_change_remainder": topic_change_remainder,
        "meta_request": meta_request,
        "suggest_followup": suggest_followup,
        "suggest_clarify": suggest_clarify,
        "suggest_advance": suggest_advance,
        "resume_active": resume_active,
        "is_ambiguous_clarify": is_ambiguous_clarify,
        "is_answer_in_progress": is_answer_in_progress,
        "explicit_question_reject": explicit_question_reject,
        "is_story_starter": is_story_starter,
        "candidate_intent": candidate_intent,
        "is_ask_for_guidance": is_ask_for_guidance,
        "disabled": False,
    }
