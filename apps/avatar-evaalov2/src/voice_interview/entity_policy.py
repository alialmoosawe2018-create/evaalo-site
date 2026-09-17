"""Entity linking policy for interview turns.

Separates role/blueprint knowledge from facts the candidate actually said.
Pure Python — no model calls.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from voice_interview.heuristics import normalize_text
from voice_interview.job_questions import CATEGORY_TERMINOLOGY, INDUSTRY_FAMILY_TERMINOLOGY

# STT / dialect aliases applied when the canonical term is already in the role glossary.
_GLOBAL_ALIAS_HINTS: dict[str, tuple[str, ...]] = {
    "GPS": ("gps", "gnss", "rtk", "جي بي اس", "جي بي إس", "جي بي اس", "جي بي اس"),
    "GNSS": ("gnss", "gps", "جي ان اس", "جي إن إس"),
    "Total Station": (
        "total station",
        "totalstation",
        "تي اس",
        "تيستيشن",
        "ستيشن",
        "محطة شاملة",
    ),
    "ESP": ("esp", "مضخة غاطسة", "مضخه غاطسه"),
    "GOR": ("gor", "نسبة الغاز", "gas oil ratio"),
    "RTK": ("rtk", "real time kinematic"),
    "AutoCAD": ("autocad", "اوتوكاد", "أوتوكاد"),
    "Civil 3D": ("civil 3d", "civil3d", "سيفل"),
    "LinkedIn": ("linkedin", "لينكد ان", "لينكدإن", "لينكد"),
    "Telegram": ("telegram", "تيليجرام", "تلغرام", "تلجرام"),
    "WhatsApp": ("whatsapp", "واتساب", "واتس"),
    "Referrals": ("referral", "referrals", "إحالة", "احالة", "إحالات", "احالات"),
    "Excel": ("excel", "اكسل", "إكسل"),
}

# Cross-role sourcing / comms hooks — extracted even when absent from role glossary.
_SPEECH_HOOK_ENTRIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("LinkedIn", ("linkedin", "لينكد ان", "لينكدإن", "لينكد")),
    ("Telegram", ("telegram", "تيليجرام", "تلغرام", "تلجرام")),
    ("WhatsApp", ("whatsapp", "واتساب", "واتس")),
    ("Referrals", ("referral", "referrals", "إحالة", "احالة", "إحالات", "احالات")),
    ("Boolean search", ("boolean", "بحث بوليني", "بوليني")),
    ("Job boards", ("job board", "job boards", "indeed", "bayt", "منصات توظيف")),
    ("ATS", ("ats", "applicant tracking", "نظام تتبع")),
)

_HOOK_FOLLOWUP_TEMPLATES: dict[str, str] = {
    "LinkedIn": "بخصوص LinkedIn، شنو نوع المرشحين اللي لقيتهم من هالقناة فعلياً؟",
    "Telegram": "بخصوص Telegram، شلون تتواصل وية المرشحين من هالقناة؟",
    "WhatsApp": "بخصوص WhatsApp، شلون استخدمته بمتابعة المرشحين؟",
    "Referrals": "بخصوص الإحالات، شلون تحافظ على علاقة المرشّح بعد ما ينضم؟",
    "Boolean search": "بخصوص البحث Boolean، اذكرلي مثال بسيط لاستعلام نجح ويةك؟",
    "Job boards": "بخصوص منصات التوظيف، أي منصة أعطتك مرشحين أقوى فعلياً؟",
    "ATS": "بخصوص نظام التتبع، شلون تنظم المرشحين من أول تواصل لحد التعيين؟",
}

_CORRECTION_AR = re.compile(
    r"(?:اشتغل(?:ت)?\s+على|استخدم(?:ت)?|اعتم(?:د)?(?:ت)?\s+على|مو\s+على|مش\s+على|مو\s+)"
    r"\s*([^،.؛]+?)\s+مو\s+(?:على\s+)?([^،.؛]+)",
    re.IGNORECASE,
)
_CORRECTION_EN = re.compile(
    r"(?:not|instead of)\s+([^,.;]+?)(?:\s+but|\s*,|\s*;|\s+—|\s+-|\s+instead)",
    re.IGNORECASE,
)
_CORRECTION_EN2 = re.compile(
    r"(?:used|worked with|on)\s+([^,.;]+?)\s+not\s+([^,.;]+)",
    re.IGNORECASE,
)

_PROJECT_IN_RE = re.compile(
    r"(?:مشروع|حقل|field|project)\s+([^\s،.؛]{3,40})",
    re.IGNORECASE,
)
_LOCATION_IN_RE = re.compile(
    r"(?:في|at|in)\s+([^\s،.؛]{3,40})",
    re.IGNORECASE,
)


@dataclass
class RoleGlossaryEntry:
    canonical: str
    aliases: list[str] = field(default_factory=list)


@dataclass
class CandidateCorrection:
    incorrect_assumption: str
    corrected_fact: str


def _canonical_key(label: str) -> str:
    return (label or "").strip()


def split_terms_blob(blob: str) -> list[str]:
    if not blob:
        return []
    parts = re.split(r"[,،;؛|/]+", blob)
    out: list[str] = []
    for p in parts:
        t = p.strip()
        if not t or len(t) < 2:
            continue
        t = re.sub(r"^\(|\)$", "", t).strip()
        if t:
            out.append(t)
    return out


def extract_terms_from_domain_guidance(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    for m in re.finditer(r"terminology\s*:\s*([^\n]+)", text, re.IGNORECASE):
        found.extend(split_terms_blob(m.group(1)))
    for m in re.finditer(r"\(([^)]+)\)", text):
        inner = m.group(1)
        if "," in inner or "،" in inner:
            found.extend(split_terms_blob(inner))
    return found


def _aliases_for_canonical(canonical: str) -> list[str]:
    hints = _GLOBAL_ALIAS_HINTS.get(canonical, ())
    base = [canonical.lower(), normalize_text(canonical)]
    out: list[str] = []
    seen: set[str] = set()
    for a in (*base, *hints):
        n = normalize_text(a)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def build_glossary_entries(term_labels: list[str]) -> list[RoleGlossaryEntry]:
    """Deduplicate labels and attach global STT aliases."""
    entries: list[RoleGlossaryEntry] = []
    seen_canonical: set[str] = set()
    for raw in term_labels:
        canonical = _canonical_key(raw)
        if not canonical or len(canonical) < 2:
            continue
        key = canonical.lower()
        if key in seen_canonical:
            continue
        seen_canonical.add(key)
        entries.append(
            RoleGlossaryEntry(
                canonical=canonical,
                aliases=_aliases_for_canonical(canonical),
            )
        )
    return entries


def extract_candidate_entities(raw_text: str, glossary: list[RoleGlossaryEntry]) -> list[str]:
    """Return canonical glossary labels mentioned in the candidate's message."""
    norm = normalize_text(raw_text or "")
    if not norm or not glossary:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for entry in glossary:
        patterns = [normalize_text(entry.canonical), *entry.aliases]
        matched = False
        for p in patterns:
            if p and len(p) >= 2 and p in norm:
                matched = True
                break
        if matched and entry.canonical not in seen:
            seen.add(entry.canonical)
            found.append(entry.canonical)
    return found


def extract_speech_hooks(raw_text: str) -> list[str]:
    """Return cross-role channel/tool hooks the candidate mentioned (LinkedIn, Telegram, etc.)."""
    norm = normalize_text(raw_text or "")
    if not norm:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for canonical, aliases in _SPEECH_HOOK_ENTRIES:
        patterns = [normalize_text(canonical), *(normalize_text(a) for a in aliases)]
        for p in patterns:
            if p and len(p) >= 2 and p in norm:
                if canonical not in seen:
                    seen.add(canonical)
                    found.append(canonical)
                break
    return found


def pick_hook_followup(canonical: str) -> str:
    """One spoken follow-up tied to a channel/tool the candidate named."""
    key = (canonical or "").strip()
    if not key:
        return "اذكرلي مثال عملي بسيط من خبرتك يوضح هالموضوع؟"
    return _HOOK_FOLLOWUP_TEMPLATES.get(
        key,
        f"بخصوص {key}، اذكرلي مثال عملي بسيط من استخدامك إياه؟",
    )


# ── Varied follow-up phrasing (interview-prep methodology) ───────────────────
# Instead of one fixed "بخصوص {X}، شلون…" template, keep small pools whose
# OPENERS deliberately differ, organised around the two proven question forms:
#   * behavioural (past evidence): "احچيلي عن مرّة…", "خذني بموقف…"
#   * situational (reasoning):     "لو صار…، شنو أول خطوة؟"
# ``pick_varied`` rotates through them while avoiding the opener stems used in
# the last few turns (``mem.recent_opener_stems``) so consecutive fallbacks
# never share a head. "{X}" is filled with the entity the candidate named.

# "How did you actually apply / use {X}" — behavioural + situational mix.
ENTITY_APPLY_POOL: tuple[str, ...] = (
    "احچيلي عن مرّة استخدمت بيها {X} فعلياً؟",
    "خذني بموقف {X} صار فرق حقيقي بشغلك؟",
    "شنو أكبر تحدي واجهته وية {X}؟",
    "لو صار عندك موقف يتعلق بـ{X}، شنو أول خطوة تسويها؟",
    "وين {X} ساعدك توصل نتيجة ملموسة؟",
)

# "How do you ensure quality/accuracy with {X}" — verification angle.
ENTITY_QUALITY_POOL: tuple[str, ...] = (
    "شلون تتأكد من الدقة أو الجودة بـ{X} قبل التسليم؟",
    "لو طلعت نتيجة {X} فيها شك، شلون تتصرّف؟",
    "احچيلي عن مرّة {X} احتاج مراجعة قبل ما تعتمده؟",
    "خذني بالخطوات اللي تسويها حتى تضمن {X} صحيح؟",
)

# Role-neutral "what made this hard" difficulty probe (replaces the HR-only one).
# The ONE budgeted follow-up per competency, spent on the thing the Stage-3
# scorer requires for any score above 4 and that nothing in the interview ever
# asked for: the outcome. Spoken, three words, not «وشنو كانت النتيجة القابلة
# للقياس؟» — the scorer reads meaning, the candidate hears sound.
RESULT_FOLLOWUP_POOL: tuple[str, ...] = (
    "وشصار بالآخر؟",
    "وشنو طلع منها؟",
    "وشلون انتهت؟",
    "طيب وشنو كانت النتيجة؟",
)


# English terms an Iraqi candidate does not reliably parse mid-Arabic. The
# runtime prompt already tells the model to gloss jargon, but the recommendation
# handed to it carried the raw term, so a rushed rephrase left it in the spoken
# question («اذكرلي حالة HR case … من intake للنهاية؟» — heard verbatim).
_SPOKEN_GLOSS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bHR\s+case\b", re.IGNORECASE), "حالة موظف"),
    (re.compile(r"\bintake\b", re.IGNORECASE), "أول ما توصلك"),
    (re.compile(r"\bend[\s-]?to[\s-]?end\b", re.IGNORECASE), "من أولها لآخرها"),
    (re.compile(r"\bpayroll\b", re.IGNORECASE), "الرواتب"),
)

# Nobody speaks brackets. The blueprint writes its examples parenthetically
# because it was authored to be READ by the scorer.
_PAREN_ASIDE_RE = re.compile(r"\s*\(([^()]{1,90})\)")

# «…، شنو كانت الحالة، شنو سويت تحديداً؟» is three asks under one question mark.
# collapse_to_single_question only cuts at a conjunction («، وشنو…»), so a
# comma-stacked ask survived it.
_STACKED_ASK_RE = re.compile(r"[،,]\s*(?:شنو|شلون|كيف|وين|متى|ليش|شكد)\s")

_DOUBLED_WORD_RE = re.compile(r"(?<!\S)(\S+)\s+\1(?!\S)")


# Interchangeable framing openers: each takes a bare noun phrase, so one can be
# swapped for another without touching the grammar after it («خلّينا نحچي عن
# التوافق مع قانون العمل» → «يهمّني أعرف التوافق مع قانون العمل»). Openers that
# need a merged preposition («نجي لـ») are deliberately NOT here.
_FRAMING_OPENERS: tuple[str, ...] = (
    "خلّينا نحچي عن",
    "أريد أفهم",
    "يهمّني أعرف",
    "حچيلي عن",
)
# Spelling variants the model actually produces, mapped onto the canonical form.
_FRAMING_ALIASES: tuple[str, ...] = (
    "خلينا نحچي عن",
    "خلّينا نحكي عن",
    "خلينا نحكي عن",
    "أريد أعرف",
    "اريد افهم",
    "اريد اعرف",
    "يهمني أعرف",
    "يهمني اعرف",
    "احچيلي عن",
)


def rotate_framing_opener(text: str, turn_index: int) -> str:
    """Swap the opening framing phrase for the one assigned to this turn.

    Prompt-level variety failed three times end-to-end: told to vary, given
    rotated examples, and finally handed an assigned opener, the model still
    opened nine or ten of ten questions the same way — «زين، احچيلي عن…», then
    «صار وياك موقف…», then «خلّينا نحچي عن…». It converges on whatever phrase it
    finds comfortable. So the swap is mechanical, and only fires when the reply
    starts with a phrase we recognise as interchangeable; anything else is left
    exactly as the model wrote it.
    """
    raw = (text or "").lstrip()
    if not raw:
        return text
    matched = next(
        (
            p
            for p in sorted((*_FRAMING_OPENERS, *_FRAMING_ALIASES), key=len, reverse=True)
            if raw.startswith(p)
        ),
        "",
    )
    if not matched:
        return text
    target = _FRAMING_OPENERS[max(0, int(turn_index or 0)) % len(_FRAMING_OPENERS)]
    if target == matched:
        return text
    return target + raw[len(matched) :]


def naturalize_spoken_question(text: str) -> str:
    """Strip the written-form tells from a question before it is spoken.

    Mechanical only — glossing, brackets, stacked asks. Turning «موقف تطلب
    تفسير وتطبيق سياسة مكتوبة» into «موقف اضطريت ترجع بيه للسياسة المكتوبة» is a
    rewrite, not string surgery, and belongs to the model (see the STYLE
    EXAMPLES block in assistant.py). This function's job is to stop handing the
    model noise it then faithfully reproduces.
    """
    out = (text or "").strip()
    if not out:
        return ""
    for pattern, replacement in _SPOKEN_GLOSS:
        out = pattern.sub(replacement, out)
    # Glossing can stutter: «اذكرلي حالة HR case» → «اذكرلي حالة حالة موظف».
    out = _DOUBLED_WORD_RE.sub(r"\1", out)
    out = _PAREN_ASIDE_RE.sub(lambda m: f" — {m.group(1).strip()}", out)
    marks = list(_STACKED_ASK_RE.finditer(out))
    if len(marks) >= 2:
        mark = "؟" if "؟" in out else "?"
        out = out[: marks[1].start()].rstrip("،, ").rstrip("؟?").rstrip() + mark
    return collapse_to_single_question(re.sub(r"\s{2,}", " ", out).strip())


DIFFICULTY_FOLLOWUP_POOL: tuple[str, ...] = (
    "شنو أصعب جزء واجهته بهالشغلة؟",
    "احچيلي عن موقف كان تحدي حقيقي إلك بهالدور؟",
    "لو ترجع لهالتجربة، شنو تسوي بشكل مختلف؟",
    "خذني بأكبر عقبة صادفتك وشلون تجاوزتها؟",
)


# Continuation nudges emitted while the candidate is mid-answer (MODE_WAIT).
# STATEMENTS, not questions (no "؟") — they must never record an opener stem or
# read as a new interview question. Distinct opener heads let ``pick_varied``
# rotate them so a run of short answers doesn't repeat the same "خذ راحتك" line.
CONTINUATION_POOL: tuple[str, ...] = (
    "خذ راحتك، كمل فكرتك.",
    "تمام، أكمل لو سمحت.",
    "ماكو مشكلة، عطيني بقية جوابك.",
    "زين، أكمل على راحتك.",
    "أكيد، أكمل متى ما تجهز.",
)


def pick_varied(pool: tuple[str, ...] | list[str], mem: Any, *, key: str = "") -> str:
    """Pick a phrasing from ``pool`` whose opener differs from the last few asked.

    Deterministic round-robin (``mem.template_rotation``) with an opener-stem
    filter (``mem.recent_opener_stems``) so consecutive fallbacks don't reuse
    the same head. ``key`` fills any ``{X}`` placeholder. Falls back to the
    round-robin order when every opener was recently used.
    """
    items = [p for p in (pool or ()) if p and p.strip()]
    if not items:
        return ""
    formatted = [p.format(X=key) if "{X}" in p else p for p in items]
    recent = set(getattr(mem, "recent_opener_stems", None) or ())
    n = len(formatted)
    rot = int(getattr(mem, "template_rotation", 0) or 0) % n
    order = [formatted[(rot + i) % n] for i in range(n)]
    chosen = next(
        (q for q in order if normalize_text(q).split(" ", 1)[0] not in recent),
        order[0],
    )
    mem.template_rotation = (rot + 1) % n
    return chosen


_PACK_CLARIFY_BRANCHES: dict[str, dict[str, str]] = {
    # حزمة محايدة المجال — الاحتياطي لأي دور بلا حزمة خاصة.
    #
    # كان الاحتياطي `hr_recruiter`، فكان كل دور خارج الحزمتين يُعطى أمثلة توظيف.
    # في جلسة 38d54d72 طلب **محاسب** توضيحاً فجاءه: «مثلاً تنسيق موعد أو متابعة
    # مرشّح أو ترتيب مستند» — أمثلة موارد بشرية لمحاسب. توضيحٌ من مهنة أخرى أسوأ
    # من لا توضيح: يُربك المرشح ويوحي بأن الوكيل لا يعرف الدور الذي يُقابل عليه.
    #
    # لا تذكر هذه النصوص مهنةً بعينها: تشرح المقصود وتترك المثال للمرشح نفسه.
    # كل نصّ جملةٌ واحدة بعلامة استفهام واحدة في آخرها، والمثال قبلها: المتصل يمرّر
    # الناتج على `collapse_to_single_question`، فأي مثال بعد «؟» الأولى يُقتطع.
    "generic": {
        "metrics": (
            "أقصد أرقام أو مؤشرات تتابعها بشغلك — مثلاً شي تقيسه أو تراقبه بشكل "
            "دوري، أي واحد أقرب لخبرتك؟"
        ),
        "academic_field": (
            "أقصد بالأكاديمي دراسة أو مشروع تخرج، وبالعملي شغل أو تدريب فعلي — "
            "مثلاً أي نوع منهم أقرب لخبرتك؟"
        ),
        "sourcing": (
            "أقصد منين تجيب المعلومات أو المواد اللي تشتغل عليها — مثلاً مصدر تعتمد "
            "عليه أكثر من غيره؟"
        ),
        "sensitive": "أقصد موقف صار بيه ضغط أو خلاف بشغلك — اذكرلي مثال بسيط من تجربتك؟",
        "challenge": "اذكرلي مثال عملي بسيط: شنو كان التحدي وشنو سويت؟",
        "requirements": (
            "أقصد قبل ما تبدي بمهمة، شلون تعرف المطلوب منك بالضبط — مثلاً من مديرك "
            "أو من مستند؟"
        ),
        # Used only when no question text is available; with one, the default
        # branch restates the ACTUAL question in simpler words (see
        # _restate_question_simply) instead of this — the owner removed the old
        # «أي موقف من شغلك… مثال واحد من تجربتك… قلّي ونمشي لغيره» filler on
        # 2026-09-17: it explained nothing and every unmatched clarify landed on it.
        "default": "أقصد موقف صار وياك فعلاً بهالخصوص — مثال واحد يكفي، شنو سويت بيه؟",
    },
    "petroleum_engineer": {
        "metrics": (
            "أقصد مؤشرات مرتبطة بالمشروع النفطي، مثل معدل الإنتاج أو الضغط أو نسبة الماء "
            "أو GOR أو نتائج المحاكاة — أي بيانات راجعتها فعلاً؟"
        ),
        "academic_field": (
            "أقصد بالمشروع الأكاديمي: بحث، مشروع تخرج، محاكاة CMG، أو دراسة بيانات بالجامعة. "
            "والمشروع الميداني: شغل أو تدريب داخل حقل أو شركة نفط. أي نوع أقرب لخبرتك؟"
        ),
        "sourcing": "مثلاً بيانات إنتاج أو تقارير حقل أو نتائج محاكاة — أي نوع استخدمته أكثر؟",
        "sensitive": "مثلاً موقف وازنت فيه بين السلامة وضغط الإنتاج — اذكرلي مثال بسيط؟",
        "challenge": "اذكرلي مثال عملي بسيط: شنو كان التحدي التقني وشنو سويت؟",
        "requirements": "مثلاً قبل قرار تشغيلي — شنو البيانات أو التقارير اللي راجعتها؟",
        "default": (
            "أقصد أي موقف من خبرتك البترولية بهالخصوص — مثلاً قراءة بيانات إنتاج أو "
            "متابعة ضغط أو نتيجة محاكاة. أي واحد أقرب لك؟"
        ),
    },
    "hr_recruiter": {
        "metrics": "مثلاً Time to Fill أو Offer Acceptance — أي واحد من هذني تتابعه أكثر؟",
        "sourcing": "مثلاً LinkedIn أو إحالات — أي قناة جربتها أكثر فعلياً؟",
        "sensitive": "مثلاً مرشّح رفض العرض أو مدير يبّدي مستعجل — اذكرلي موقف واحد بسيط من هالنوع؟",
        "challenge": "اذكرلي مثال عملي بسيط: شنو كان التحدي وشنو سويت؟",
        "requirements": "مثلاً وظيفة تقنية أو إدارية — شلون تاخذ متطلبات الدور من المدير قبل ما تبدي؟",
        # Every other branch EXPLAINS the question before asking again; this one only
        # demanded an example, so a candidate who said "شنو تقصدين؟" got a re-ask
        # instead of an answer and asked again. It is also where every unmatched
        # clarify lands. Say what is meant, ground it with concrete options, and make
        # "it never came up" an acceptable answer — the candidate kept needing that
        # and had no way to say it.
        "default": (
            "أقصد أي موقف من شغلك بهالخصوص — مثلاً تنسيق موعد أو متابعة مرشّح أو "
            "ترتيب مستند. أي واحد أقرب لخبرتك؟"
        ),
    },
}


def _restate_question_simply(last_question: str) -> str:
    """Clarify by restating the question actually asked, in simpler words.

    The LLM receives this as the recommended question with a rephrase
    instruction, so it simplifies THIS question rather than reciting a generic
    "give me any example from your work" line.
    """
    q = collapse_to_single_question(last_question or "").strip().rstrip("؟?").strip()
    if not q:
        return _PACK_CLARIFY_BRANCHES["generic"]["default"]
    # «مثال واحد يكفي» is the QA-scorecard contract (a clarify must still ask
    # for ONE concrete example) — three words, then the question itself.
    return f"خلّيني أبسّطها، مثال واحد يكفي: {q}؟"


_PACK_CLARIFY_CHALLENGE: dict[str, str] = {
    # Fallback only; with the real question available, clarify_challenge_reply
    # restates it instead (owner request 2026-09-17: no canned "example from your
    # experience" line).
    "generic": (
        "أعتذر إذا كان السؤال غامض. أقصد موقف صار وياك فعلاً بهالخصوص — مثال واحد يكفي، "
        "شنو سويت بيه؟"
    ),
    "petroleum_engineer": (
        "أعتذر، المثال السابق ما كان متعلق بهندسة النفط. أقصد مؤشرات مثل معدل الإنتاج "
        "أو الضغط أو نسبة الماء أو نتائج المحاكاة. هل عندك مثال أكاديمي أو ميداني؟"
    ),
    "hr_recruiter": (
        "أعتذر إذا كان السؤال غامض. أقصد مؤشرات توظيف مثل Time to Fill أو Offer Acceptance. "
        "عندك مثال على وحدة منها؟"
    ),
}


def _classify_clarify_branch(norm: str) -> str:
    if any(k in norm for k in ("مؤشرات", "metrics", "kpi", "مؤشر")):
        return "metrics"
    # Only an EXPLICIT academic cue selects the academic-vs-practical explanation.
    # «مشروع» and "field" used to be triggers, so a clarify request on «اذكرلي قرار
    # أو مشروع قدته في HR» was answered with «أقصد بالأكاديمي دراسة أو مشروع تخرج…»
    # — an explanation of a question nobody asked (2026-09-17). «ميداني»/"field"
    # alone ("in the HR field") are equally ambiguous and fall to the default now.
    if any(
        k in norm
        for k in (
            "أكاديمي", "اكاديمي", "جامعة", "جامعه", "تخرج", "دراستك",
            "academic", "university", "graduation",
        )
    ):
        return "academic_field"
    if any(k in norm for k in ("استراتيجيات", "قنوات", "استقطاب", "sourcing", "channel")):
        return "sourcing"
    if any(k in norm for k in ("حساس", "صعب", "sensitive", "difficult")):
        return "sensitive"
    if any(k in norm for k in ("تحدي", "challenge", "صعوبة")):
        return "challenge"
    if any(k in norm for k in ("متطلبات", "requirement", "brief")):
        return "requirements"
    return "default"


def simplify_clarify_for_pack(
    last_question: str,
    *,
    domain_pack_key: str = "",
    domain_guidance: str = "",
    competencies: list[dict] | None = None,
) -> tuple[str, str]:
    """Pack-aware clarify re-ask. Returns (question, clarify_example_source)."""
    del domain_guidance, competencies  # reserved for evidence-based expansion
    n = normalize_text(last_question or "")
    # الاحتياطي محايد المجال، لا `hr_recruiter`: دورٌ بلا حزمة يجب أن يُوضَّح له
    # بلغة عامة، لا بأمثلة من مهنة أخرى.
    pack = (domain_pack_key or "").strip().lower() or "generic"
    branches = _PACK_CLARIFY_BRANCHES.get(pack) or _PACK_CLARIFY_BRANCHES["generic"]
    branch = _classify_clarify_branch(n)
    source = pack if pack in _PACK_CLARIFY_BRANCHES else "generic"
    # No specific branch and no pack examples: restate the real question. A role
    # without its own pack must not be "clarified" with a sentence that never
    # mentions what was asked.
    if branch == "default" and source == "generic" and (last_question or "").strip():
        return _restate_question_simply(last_question), source
    question = branches.get(branch) or branches["default"]
    return question, source


def clarify_challenge_reply(
    domain_pack_key: str = "", *, last_question: str = ""
) -> tuple[str, str]:
    """Short self-correction when candidate rejects a wrong clarify example."""
    pack = (domain_pack_key or "").strip().lower() or "generic"
    if pack not in _PACK_CLARIFY_CHALLENGE and (last_question or "").strip():
        q = collapse_to_single_question(last_question).strip().rstrip("؟?").strip()
        if q:
            return (
                f"أعتذر إذا كان السؤال غامض. خلّيني أبسّطها، مثال واحد يكفي: {q}؟",
                "generic_challenge",
            )
    # نفس المبدأ: الاعتذار لا يجوز أن يجرّ أمثلة من مهنة غير مهنة المرشح.
    pack = (domain_pack_key or "").strip().lower() or "generic"
    text = _PACK_CLARIFY_CHALLENGE.get(pack) or _PACK_CLARIFY_CHALLENGE["generic"]
    return text, f"{pack}_challenge"


def simplify_clarify_question(last_question: str) -> str:
    """Legacy HR-biased clarify — prefer simplify_clarify_for_pack()."""
    q, _ = simplify_clarify_for_pack(last_question, domain_pack_key="hr_recruiter")
    return q


def _resolve_glossary_label(fragment: str, glossary: list[RoleGlossaryEntry]) -> str | None:
    frag = normalize_text(fragment)
    if not frag:
        return None
    best: str | None = None
    best_len = 0
    for entry in glossary:
        for p in [normalize_text(entry.canonical), *entry.aliases]:
            if p and p in frag and len(p) > best_len:
                best = entry.canonical
                best_len = len(p)
    return best


def detect_tool_correction(
    norm: str,
    raw: str,
    glossary: list[RoleGlossaryEntry],
) -> CandidateCorrection | None:
    """Detect corrections like GPS not Total Station."""
    del raw  # norm is sufficient for pattern matching
    if not norm or not glossary:
        return None

    for pattern in (_CORRECTION_AR, _CORRECTION_EN, _CORRECTION_EN2):
        m = pattern.search(norm)
        if not m:
            continue
        left = m.group(1).strip()
        right = m.group(2).strip() if m.lastindex and m.lastindex >= 2 else ""
        if not left or not right:
            continue
        corrected = _resolve_glossary_label(left, glossary) or left.strip()
        rejected = _resolve_glossary_label(right, glossary) or right.strip()
        if corrected and rejected and corrected.lower() != rejected.lower():
            return CandidateCorrection(
                incorrect_assumption=rejected,
                corrected_fact=corrected,
            )

    # "مو على Y" / "مو Y" after a tool mention on the left side of the sentence
    if "مو" in norm or "مش" in norm:
        parts = re.split(r"\bمو\b|\bمش\b", norm)
        if len(parts) >= 2:
            before = parts[0]
            after = parts[-1]
            corrected = None
            for entry in glossary:
                for p in [normalize_text(entry.canonical), *entry.aliases]:
                    if p and len(p) >= 2 and p in before:
                        corrected = entry.canonical
                        break
                if corrected:
                    break
            rejected = _resolve_glossary_label(after, glossary)
            if corrected and rejected and corrected.lower() != rejected.lower():
                return CandidateCorrection(
                    incorrect_assumption=rejected,
                    corrected_fact=corrected,
                )
    return None


def compute_link_policy(
    *,
    entities_in_message: list[str],
    glossary: list[RoleGlossaryEntry],
    rejected_entities: set[str],
    is_greeting_or_ready: bool,
    is_substantive: bool,
    correction: CandidateCorrection | None = None,
) -> dict[str, Any]:
    """Compute which entities the LLM may attribute to the candidate this turn."""
    all_glossary = [e.canonical for e in glossary]
    rejected = set(rejected_entities)

    if correction:
        rejected.add(correction.incorrect_assumption)
        if correction.corrected_fact not in entities_in_message:
            entities_in_message = [*entities_in_message, correction.corrected_fact]

    if is_greeting_or_ready or not is_substantive:
        allowed: list[str] = []
        in_message: list[str] = []
    else:
        in_message = list(entities_in_message)
        allowed = [e for e in in_message if e not in rejected]

    forbidden = [g for g in all_glossary if g not in allowed]

    return {
        "candidate_entities_in_last_message": in_message,
        "allowed_link_entities": allowed,
        "forbidden_attribution_entities": forbidden,
        "rejected_entities": sorted(rejected),
        "last_correction": (
            {
                "incorrect": correction.incorrect_assumption,
                "corrected": correction.corrected_fact,
            }
            if correction
            else None
        ),
    }


def build_role_glossary(
    meta: dict[str, Any],
    bank_res: Any,
    blueprint: dict[str, Any] | None = None,
) -> list[RoleGlossaryEntry]:
    """Build per-session glossary from metadata — no per-position Python branches."""
    terms: list[str] = []

    profile_terminology = str(meta.get("profile_terminology") or meta.get("terminology") or "").strip()
    if profile_terminology:
        terms.extend(split_terms_blob(profile_terminology))

    raw_glossary = meta.get("role_glossary")
    if raw_glossary:
        try:
            parsed = json.loads(raw_glossary) if isinstance(raw_glossary, str) else raw_glossary
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, str) and item.strip():
                        terms.append(item.strip())
                    elif isinstance(item, dict):
                        label = str(
                            item.get("term") or item.get("canonical") or item.get("label") or ""
                        ).strip()
                        if label:
                            terms.append(label)
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    domain_guidance = str(meta.get("domain_guidance") or "").strip()
    terms.extend(extract_terms_from_domain_guidance(domain_guidance))

    if blueprint and isinstance(blueprint, dict):
        bp_terms = blueprint.get("terminology")
        if isinstance(bp_terms, list):
            for item in bp_terms:
                if isinstance(item, str) and item.strip():
                    terms.append(item.strip())
        elif isinstance(bp_terms, str) and bp_terms.strip():
            terms.extend(split_terms_blob(bp_terms))

        for anchor in blueprint.get("anchorQuestions") or []:
            terms.extend(split_terms_blob(str(anchor)))
        for comp in blueprint.get("competencies") or []:
            if not isinstance(comp, dict):
                continue
            title = str(comp.get("title") or comp.get("key") or "").strip()
            if title:
                terms.append(title)
            for key in ("evidence", "followUps", "redFlags"):
                for item in comp.get(key) or []:
                    terms.extend(split_terms_blob(str(item)))

    cat = getattr(bank_res, "category", "") or ""
    fam = getattr(bank_res, "industry_family", "") or ""
    cat_blob = CATEGORY_TERMINOLOGY.get(cat) or INDUSTRY_FAMILY_TERMINOLOGY.get(fam) or ""
    terms.extend(split_terms_blob(cat_blob))

    return build_glossary_entries(terms)


# «، وشنو …» / «وشلون …» / «وليش …» inside a single-mark question = a second ask.
_TRAILING_CONJ_QUESTION_RE = re.compile(
    r"[،,]?\s+و(?:شنو|شلون|كيف|ليش|وين|متى|هل|شو|ايش|إيش)\s"
)

_COMPOUND_QUESTION_SPLITTERS = (
    "، وكيف",
    "، وشلون",
    "، وما",
    "، واذكر",
    " وكيف ",
    " وشلون ",
    " وما ",
    " واذكرلي ",
    " — ",
    " - ",
)


def collapse_to_single_question(text: str) -> str:
    """Reduce compound blueprint/bank templates to one spoken question."""
    q = " ".join((text or "").split()).strip()
    if not q:
        return q
    for mark in ("؟", "?"):
        if mark in q:
            idx = q.index(mark)
            head = q[: idx + 1].strip()
            # A second question can hide BEFORE the first «؟»: «اذكرلي قرار قدته في
            # HR، وشنو كان تأثيره على الفريق؟» carries one mark but two asks, so the
            # first-mark cut kept both and the candidate was asked a double-barrelled
            # opener (2026-09-17). Cut at a conjunction that starts a new question.
            m = _TRAILING_CONJ_QUESTION_RE.search(head)
            if m and m.start() >= 10:
                head = head[: m.start()].rstrip("،, ") + mark
            return head if head else q
    for sep in _COMPOUND_QUESTION_SPLITTERS:
        if sep in q:
            head = q.split(sep)[0].strip().rstrip("،,")
            if head and len(head) >= 10:
                if not head.endswith(("؟", "?")):
                    head += "؟"
                return head
    return q


def extract_light_context_phrases(raw_text: str) -> list[str]:
    """Light extraction of project/location phrases (no NER)."""
    norm = normalize_text(raw_text or "")
    if not norm:
        return []
    out: list[str] = []
    for pattern in (_PROJECT_IN_RE, _LOCATION_IN_RE):
        for m in pattern.finditer(norm):
            phrase = (m.group(1) or "").strip()
            if phrase and len(phrase) >= 3 and phrase not in out:
                out.append(phrase)
    return out[:3]
