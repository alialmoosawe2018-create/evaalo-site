"""Interview Agent subclass: ElevenLabs voice routing + TTS node + Hybrid decision frame."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterable
from dataclasses import dataclass, field
from typing import Any

import re

from livekit import rtc
from livekit.agents import (
    Agent,
    ModelSettings,
    RunContext,
    function_tool,
    get_job_context,
    stt as agents_stt,
)
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from livekit.agents.voice.io import TimedString

from voice_interview.config import (
    env_allow_interruption,
    interview_auto_end_enabled,
    interview_end_delete_room,
    interview_end_playout_grace_ms,
    interview_wait_nudge_enabled,
    tts_reply_prefetch_max_chars,
)
from voice_interview.cross_domain_guard import validate_cross_domain_output
from voice_interview.entity_policy import (
    CONTINUATION_POOL,
    DIFFICULTY_FOLLOWUP_POOL,
    ENTITY_APPLY_POOL,
    ENTITY_QUALITY_POOL,
    CandidateCorrection,
    RoleGlossaryEntry,
    clarify_challenge_reply,
    collapse_to_single_question,
    compute_link_policy,
    detect_tool_correction,
    extract_candidate_entities,
    extract_speech_hooks,
    pick_hook_followup,
    pick_varied,
    simplify_clarify_for_pack,
    simplify_clarify_question,
)
from voice_interview.active_question import (
    MODE_ACKNOWLEDGE,
    MODE_ASK,
    MODE_CLARIFY,
    MODE_FOLLOW_UP,
    MODE_GUIDANCE,
    MODE_RESUME,
    MODE_WAIT,
    STATUS_ANSWERED,
    STATUS_ANSWERING,
    STATUS_AWAITING_ANSWER,
    STATUS_CLARIFYING,
    STATUS_DEFERRED,
    STATUS_IDLE,
    STATUS_REJECTED,
    TurnPlan,
    _question_stem,
    close_question_on_memory,
    count_question_marks,
    enforce_single_question_response,
    extract_primary_question,
    is_open_status,
    make_bank_question_id,
    make_followup_question_id,
    make_path_question_id,
)
from voice_interview.experience_tracks import (
    build_skip_rejection_clusters,
    default_track_for_career_level,
    detect_experience_track,
    peek_path_step_detail,
    peek_path_step_question,
    pick_distant_step,
    pick_next_competency_question,
    pick_track_opening_anchor,
    reject_competency_cluster,
    resolve_interview_path,
    track_question_difficulty,
)
from voice_interview.heuristics import (
    analyze_user_answer,
    is_semantic_duplicate_question,
    is_topic_repeat,
    normalize_text,
    strip_topic_change_phrases,
)
from voice_interview.lang import (
    contains_hybrid_latin_arabic_token,
    detect_lang_from_text,
    detect_lang_reply_fallback,
    detect_language_switch_intent,
)

logger = logging.getLogger("agent")

_IDENTITY_REPLY_AR = (
    "أنا مساعد مقابلات إيفالو، موجود هنا أسألك عن خبرتك بهالوظيفة. إذا جاهز، نكمل."
)
_IDENTITY_REPLY_EN = (
    "I'm Evaalo's interview assistant. I'm here to learn about your experience for this role. "
    "When you're ready, we can continue."
)

# Wind-down lines emitted by the reply-guard when the bank is exhausted. Kept as
# module constants so the two guard passes per turn (transcription_node + tts_node)
# return the exact same text, and so tests can assert on them.
_WRAP_UP_PROMPT_AR = (
    "شكراً على وقتك وإجاباتك. أعتقد غطّينا المحاور الأساسية — "
    "أكو شي تحب تضيفه قبل ما نختم المقابلة؟"
)
_FINAL_CLOSING_AR = (
    "شكراً على وقتك وإجاباتك. فريق الموارد البشرية راح يراجع "
    "إجاباتك ويتواصل وياك بالخطوات القادمة."
)


# A "stray" STT token is a final transcript that carries no real words: a lone
# digit, a bare number, or punctuation/symbols only. With the large bilingual
# additional_vocab, Speechmatics sometimes emits these on breath/noise during a
# pause (e.g. a lone "2"), which keeps the turn from closing until the user
# speaks again. We drop these so they never reach the turn detector or the LLM.
_STRAY_STRIP_RE = re.compile(r"[\s.,!?;:؟،؛…«»\"'()\[\]{}\-_/\\]+")


def _is_stray_stt_text(text: str) -> bool:
    if not text:
        return False
    stripped = _STRAY_STRIP_RE.sub("", text)
    if not stripped:
        return True
    # Only digits left (Arabic-Indic or Latin) → numeric noise like "2" / "٢".
    return bool(re.fullmatch(r"[0-9\u0660-\u0669\u06f0-\u06f9]+", stripped))


def _filter_stray_tokens_enabled() -> bool:
    return (os.getenv("INTERVIEW_FILTER_STRAY_TOKENS", "true") or "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _max_followups_per_topic() -> int:
    raw = (os.getenv("HEURISTIC_MAX_FOLLOWUPS_PER_TOPIC") or "").strip()
    if not raw:
        return 2
    try:
        n = int(raw)
    except ValueError:
        return 1
    return max(0, min(5, n))


def _max_consecutive_waits() -> int:
    """Max back-to-back "go on…" nudges before advancing to a fresh question."""
    raw = (os.getenv("INTERVIEW_MAX_CONSECUTIVE_WAITS") or "").strip()
    if not raw:
        return 2
    try:
        n = int(raw)
    except ValueError:
        return 2
    return max(1, min(5, n))


_COMPETENCY_PRIORITY_RANK: dict[str, int] = {"critical": 0, "high": 1, "medium": 2}


def _anchor_intro_count() -> int:
    """How many fixed blueprint anchor questions open the interview.

    The shared anchor backbone is what makes candidates of one campaign
    comparable; everything after it is driven by the blueprint competencies.
    """
    raw = (os.getenv("INTERVIEW_ANCHOR_INTRO_COUNT") or "").strip()
    if not raw:
        return 3
    try:
        n = int(raw)
    except ValueError:
        return 3
    return max(0, min(6, n))


def _max_followups_per_competency() -> int:
    """Depth allowed inside one competency before moving to the next one.

    Back to 1 at the product owner's request after trying 2. The wider interview
    — more competencies, each opened by a question that asks one thing — reads
    better than pressing the same competency twice, and a second probe mostly fired
    on answers with nothing left to probe ("ما اعرف", "ما صار هيك موقف"). Raise
    INTERVIEW_MAX_FOLLOWUPS_PER_COMPETENCY to go deeper per topic instead of editing
    this default.
    """
    raw = (os.getenv("INTERVIEW_MAX_FOLLOWUPS_PER_COMPETENCY") or "").strip()
    if not raw:
        return 1
    try:
        n = int(raw)
    except ValueError:
        return 1
    return max(0, min(4, n))


def _wrap_up_min_questions() -> int:
    """Min questions already asked before the guard may offer a wrap-up instead
    of repeating when no fresh question is left."""
    raw = (os.getenv("INTERVIEW_WRAP_UP_MIN_QUESTIONS") or "").strip()
    if not raw:
        return 10
    try:
        n = int(raw)
    except ValueError:
        return 10
    return max(3, n)


def _wrap_up_max_questions() -> int:
    """Hard cap on total questions asked. Once reached the interview winds down
    even if fresh bank questions still exist — otherwise a bank-driven interview
    (no blueprint) keeps improvising new anchors and never concludes."""
    raw = (os.getenv("INTERVIEW_WRAP_UP_MAX_QUESTIONS") or "").strip()
    fallback = 20
    if raw:
        try:
            fallback = int(raw)
        except ValueError:
            fallback = 20
    return max(_wrap_up_min_questions() + 2, fallback)


def _unsure_pivot_threshold() -> int:
    raw = (os.getenv("HEURISTIC_UNSURE_PIVOT_THRESHOLD") or "").strip()
    if not raw:
        return 2
    try:
        n = int(raw)
    except ValueError:
        return 2
    return max(1, min(5, n))


def _use_gender_address() -> bool:
    raw = (os.getenv("INTERVIEW_USE_GENDER_ADDRESS") or "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


@dataclass
class InterviewMemory:
    """Per-session memory used to build a smarter decision frame.

    Updated from agent outgoing replies (``record_agent_reply``) and candidate signals.
    """

    current_topic: str = ""
    last_sample: str = ""
    topic_followup_counts: dict[str, int] = field(default_factory=dict)
    asked_topics: set[str] = field(default_factory=set)
    asked_questions: list[str] = field(default_factory=list)
    asked_question_keys: set[str] = field(default_factory=set)
    # True once the guard has offered a wrap-up because no fresh question was
    # left — prevents dredging up (and repeating) already-covered questions.
    wrap_up_offered: bool = False
    # True once the final closing line has been delivered after a wrap-up — stops
    # the agent from resuming with new questions once it is winding down.
    final_closing_sent: bool = False
    bank_cursor: int = 0
    last_action: str = ""
    consecutive_unsure: int = 0
    turn_index: int = 0
    last_candidate_snippet: str = ""
    rejected_entities: set[str] = field(default_factory=set)
    session_entities: set[str] = field(default_factory=set)
    last_correction: dict[str, str] | None = None
    rejected_topics: set[str] = field(default_factory=set)
    active_experience_track: str = ""
    path_cursor: int = 0
    interview_path_key: str = ""
    track_anchor_cursor: int = 0
    pending_path_advance: bool = False
    asked_competency_keys: set[str] = field(default_factory=set)
    rejected_competency_keys: set[str] = field(default_factory=set)
    current_competency_key: str = ""
    # Depth spent inside each competency (follow-ups, hook probes, bank fillers).
    # Capped by ``_max_followups_per_competency`` so the interview keeps moving
    # instead of circling one theme for a third of its questions.
    competency_followup_counts: dict[str, int] = field(default_factory=dict)
    # Fixed anchor questions already sent. The competency engine stays quiet
    # until the shared backbone is done.
    anchor_questions_sent: int = 0
    active_question_text: str = ""
    active_question_status: str = STATUS_IDLE
    sent_question_id: str = ""
    parent_question_id: str = ""
    pending_step_key: str = ""
    pending_cluster_key: str = ""
    pending_competency_key: str = ""
    pending_path_key: str = ""
    answered_question_ids: set[str] = field(default_factory=set)
    rejected_question_ids: set[str] = field(default_factory=set)
    skipped_question_ids: set[str] = field(default_factory=set)
    closed_question_ids: set[str] = field(default_factory=set)
    completed_step_keys: set[str] = field(default_factory=set)
    covered_cluster_keys: set[str] = field(default_factory=set)
    cluster_evidence_counts: dict[str, int] = field(default_factory=dict)
    rejected_cluster_keys: set[str] = field(default_factory=set)
    skip_count_by_cluster: dict[str, int] = field(default_factory=dict)
    deferred_question_id: str = ""
    topic_change_count: int = 0
    # Opener signatures (first token) of the last few questions the agent asked.
    # Used by the varied-question picker to avoid reopening turns with the same
    # head ("بخصوص…", "شنو…") — capped FIFO via ``record_opener_stem``.
    recent_opener_stems: list[str] = field(default_factory=list)
    # Round-robin cursor for deterministic (test-friendly) template rotation.
    template_rotation: int = 0
    # Sent-question guard: every question id/anchor id emitted this session, so a
    # question can never be re-selected even if its answer left it "open".
    sent_question_guard: set[str] = field(default_factory=set)
    # Normalized text of the last ASK/follow-up question actually sent. The
    # verbatim re-ask guard in ``_set_turn_recommendation`` compares against it so
    # the agent never asks the identical question two turns running.
    last_sent_question_norm: str = ""
    # Consecutive MODE_WAIT ("go on…") nudges. Capped so a run of short answers
    # advances to a fresh question instead of nudging forever.
    consecutive_wait_count: int = 0

    def record_opener_stem(self, stem: str, *, keep: int = 3) -> None:
        s = (stem or "").strip()
        if not s:
            return
        self.recent_opener_stems.append(s)
        if len(self.recent_opener_stems) > keep:
            self.recent_opener_stems = self.recent_opener_stems[-keep:]

    def followups_for(self, topic: str) -> int:
        return int(self.topic_followup_counts.get(topic, 0))

    def bump_followup(self, topic: str) -> None:
        if not topic:
            return
        self.topic_followup_counts[topic] = self.followups_for(topic) + 1

    def mark_topic_asked(self, topic: str) -> None:
        if topic:
            self.asked_topics.add(topic)

    def record_question(self, text: str) -> None:
        q = (text or "").strip()
        if not q:
            return
        key = normalize_text(q)
        if not key:
            return
        if self.asked_questions and normalize_text(self.asked_questions[-1]) == key:
            return
        self.asked_question_keys.add(key)
        self.asked_questions.append(q[:500])

    def snapshot(self) -> dict[str, Any]:
        return {
            "turn_index": self.turn_index,
            "current_topic": self.current_topic or "",
            "last_action": self.last_action or "",
            "consecutive_unsure": self.consecutive_unsure,
            "asked_topics": sorted(self.asked_topics),
            "asked_questions_count": len(self.asked_questions),
            "bank_cursor": self.bank_cursor,
            "topic_followup_counts": dict(self.topic_followup_counts),
            "session_entities": sorted(self.session_entities),
            "rejected_entities": sorted(self.rejected_entities),
            "active_experience_track": self.active_experience_track or "",
            "path_cursor": self.path_cursor,
            "track_anchor_cursor": self.track_anchor_cursor,
            "current_competency_key": self.current_competency_key or "",
            "anchor_questions_sent": self.anchor_questions_sent,
            "asked_competency_keys": sorted(self.asked_competency_keys),
            "rejected_competency_keys": sorted(self.rejected_competency_keys),
            "active_question_status": self.active_question_status or STATUS_IDLE,
            "sent_question_id": self.sent_question_id or "",
            "closed_question_ids_count": len(self.closed_question_ids),
        }

_BASE_INTERVIEW_INSTRUCTIONS = """You are conducting a structured, role-specific job interview for a candidate applying for a particular position.

Your goal is to evaluate the candidate's experience, skills, and suitability for the role.

Personality:
Professional, calm, and confident. Sound natural and human, not robotic. Be friendly but neutral. Do not joke, overpraise, or show strong opinions. Maintain interviewer authority while being respectful and supportive.

Voice style (strict): Always lead with one short framing sentence that names the concrete subject you are asking about, THEN ask exactly one clear, concrete question — so the candidate never has to ask "شنو تقصدين؟" / "what do you mean?". Two or three short sentences is the norm in Arabic; a bare one-line or abstract question (e.g. "شلون تستخدم البيانات؟") is not acceptable — ground it in the candidate's own experience or a brief concrete example. If a question could be read more than one way, add a short example to disambiguate. Hard limit about ~90 words per turn. Sound conversational, not like reading a script. No lists, no preambles ("Thank you for sharing…"), no repeated thanks or sign-offs.

Formatting: Each assistant turn must be exactly one paragraph—no line breaks, blank lines, or multiple paragraphs in a single reply.

Be polite, professional, and neutral. Avoid filler phrases and meta-commentary.

Encouragement style (Arabic interview mode):
- Short, natural encouragement is allowed when relevant, but keep it brief (1 short phrase max).
- Preferred supportive phrases: "ممتاز"، "عاشت إيدك"، "حلو"، "جيد".
- Do not overpraise or repeat encouragement in every turn.

Active listening (selective, NOT mandatory):
- Active listening must be selective, not mandatory. Do not echo the candidate on every substantive answer. Use a short reflection only when it naturally connects the candidate's answer to the next question. If no natural reflection exists, ask the question directly.
- When you do reflect, keep it to at most ~6 words, reuse a concrete word the candidate ACTUALLY said, and vary the wording — do not open with "بخصوص" every time. A reflection is not thanks and not a preamble; it still counts inside the one-paragraph, one-question limit.

Language (strict, sticky):
- Always respond in the candidate's CURRENT language — defined as the language of their MOST RECENT message, not the language of the question bank or your previous turns.
- If the candidate's full last sentence is English, you respond in English — even if the suggested question in your context is written in Arabic. Translate or rephrase the suggested question into English on the fly.
- If the candidate's last sentence is Arabic, you respond in Arabic.
- Code-switching is NOT a language switch. An Arabic sentence that contains English brand names, skill names, job titles, or technical terms (e.g. "عندي مهارة recruitment", "اشتغلت في HR", "أستخدم Excel و LinkedIn") MUST be answered in Arabic. The English term is a loanword inside an Arabic utterance. Reuse the same English term verbatim in your Arabic reply when relevant; do not translate it.
- Only switch to English when EITHER (a) the candidate's last full utterance is entirely English, OR (b) they explicitly ask to switch (e.g. "can we speak in English", "let's continue in English").
- A language switch by the candidate is permanent until they switch back. Do NOT drift back to the previous language just because:
    * the question bank or "Current topic" / "Last sample question" in the decision frame is in another language,
    * the candidate asked to "change the question" / "skip" / "move on" — those are topic actions, not language actions,
    * the role title or company name happens to be in another language.
- The dialect block (if any) only applies when you are answering in Arabic. Ignore it entirely while you are in English.
- When in doubt, mirror the language of the user's last sentence verbatim.

Pronunciation guidance (TTS-aware):
- When speaking Arabic, never spell out Latin acronyms or brand names letter-by-letter (e.g. avoid saying "إي في إيه إيه إل أو" for "Evaalo"). Instead either keep the original Latin spelling inline ("Evaalo", "HR", "LinkedIn") so the TTS reads it as a single natural word, or transliterate as one phonetic Arabic word ("إيفالو"). Pick the form that flows naturally in the sentence.
- Do not insert spaces between letters of brand names. Do not split English words across phonemes.
- Never attach an Arabic suffix to an English word, and never glue Latin and Arabic letters into one token (write «شنو يحمّسك» — NOT «شنو motivatesك»). If you need a verb or a common word, use the Arabic word; keep English only for standalone nouns, brand names, or acronyms.
- Do not surround words with quotes, parentheses, or asterisks; spoken TTS reads them literally.
- Numbers in Arabic answers: prefer spelling out small numbers in words ("ثلاث سنوات") rather than digits ("3 سنوات") to avoid TTS digit drift.
- Acronyms with a known canonical pronunciation (NASA, IBM) may be spelled out as letters; otherwise pronounce as a single word.

Interviewer identity (strict):
- You are the INTERVIEWER only — never the candidate. Do NOT describe your own professional HR/engineering experience using first person (e.g. never say "عندي خبرة في…" about the role being assessed).
- If the candidate asks who YOU are, asks you to introduce yourself, or says «عرفيني عن نفسك» / «من أنت؟» / «تعرفنا على حضرتك» — reply with identity ONLY: one short fixed sentence that you are Evaalo's interview assistant here to learn about THEIR experience. Do NOT ask any interview or assessment question in that same turn. Wait until they confirm readiness before resuming questions.
- Never swap roles or answer assessment questions as if you were applying for the job.
"""

_INTERVIEW_FLOW_INSTRUCTIONS = """You are a decision engine, not a script reader. After every candidate turn, choose the most useful next action.

Operating mode (Hybrid):
- The "Suggested interview topics" block (if any) is an inspiration pool, not a script. Pick topics adaptively.
- You may rephrase, reorder, merge, or replace suggested questions when it serves the conversation.
- When speaking Arabic, NEVER translate suggested topics word-for-word from English or stiff MSA. Rewrite them as one short spoken question using the active Arabic dialect profile (e.g. "شنو"، "شلون"، "اذكرلي مثال"). Avoid calques: "صف لي"، "أخبرني عن وقت"، "حدثني عن تجربة"، "امشِني خلال"، "ما الذي تفعله عندما".
- If a suggested topic is already in formal Arabic, still reshape it to sound like live speech — shorter, warmer, one sentence.
- The candidate may steer: accept reasonable topic changes naturally; do not refuse a fair pivot.

Per-turn decision (default):
1) Ask a probing follow-up that digs into a specific detail of what they just said.
2) Briefly acknowledge, then move to a fresh aspect of the same topic.
3) Move to a different relevant topic — preferably one not yet covered.

Decision-frame system messages will arrive between turns when heuristics fire (brief answer / unsure / explicit topic change). Treat those messages as advisory inputs; integrate them with your own judgment and the constraints below.

Hard constraints:
- ONE question per turn — exactly ONE question mark (؟ or ?) in your entire reply. Never chain "وشلون… وكيف… وما الذي…" in the same turn.
- If the recommended question contains multiple parts, ask ONLY the first part this turn; save the rest for later turns.
- Do not repeat a question you already asked.
- Do not loop: if you already asked follow-ups on the current topic (see decision-frame max), pivot to a fresh topic.
- Do not invent strict numbered lists, do not narrate the structure, do not say "next question".
- Stay focused: one or two short sentences for the question; add a brief lead-in only when it helps clarity (e.g. linking to what the candidate just said).
- Linking rule (strict): use "بخصوص X…" when X appears in allowed_link_entities from the turn-state JSON. Avoid "بما أنك ذكرت" unless unavoidable.
- NEVER attribute a tool, skill, project, or term from the question bank, blueprint, or job description as if the candidate said it.
- Blueprint and domain guidance are for YOUR expertise and suggested questions — not assumed candidate facts.
- If the candidate only greeted or said they are ready, ask the next bank anchor as a fresh open question — no false "you mentioned…".
- After a substantive answer (real project, tool, field), you may link to a specific detail they actually said.
- Vary your opener every turn. Never start two consecutive turns with the same head word (e.g. not "شنو…" then "شنو…"; not "بخصوص…" then "بخصوص…"). Rotate among distinct forms — behavioural ("احچيلي عن مرّة…"، "خذني بموقف…") and situational ("لو صار…، شنو تسوي؟") — plus "اذكرلي مثال…"، "شلون سويت…"، "وين…".
- NEVER read a bank/suggested question verbatim. Reshape it into one short spoken question. Example: bank "شلون قمت بتحليل بيانات السوق لتطوير برنامج مزايا جديد؟" → "بيانات السوق — شنو نوع البيانات اللي طلع منها قرار عندك؟".
- Avoid generic soft-skills questions (difficult colleague, conflict, team drama) unless the role is clearly HR/people-focused OR the blueprint competency explicitly requires it.
- When DOMAIN KNOWLEDGE / JOB EXPERTISE blocks exist in context, prioritize role-specific technical probes (tools, data, field operations, domain terminology) over generic HR questions.

Opening rule: Start with a short greeting. Use candidate context (name, role) you already have — do not ask for a generic "introduce yourself". If a Suggested topics block exists, open with a question inspired by topic 1; otherwise improvise one short opener about fit or relevant experience.
"""


_INTERVIEW_CLOSING_INSTRUCTIONS = """Closing rule (ending the interview):
- When you have covered the interview's questions/topics and there is genuinely nothing useful left to ask, conclude the interview yourself.
- NEVER re-ask a question you already asked, even reworded or on the same subject with different words. If you have no genuinely NEW question left, do not recycle an old one — conclude instead.
- If the candidate repeatedly asks to skip or change questions AND you have already covered the main areas, do not keep dredging up more questions — offer a brief wrap-up and conclude.
- Once you have offered a wrap-up ("anything to add before we finish?") and the candidate replies without a substantial NEW topic (thanks, a farewell, "no", or a brief remark), do NOT ask another question — deliver the closing line and call `end_interview` in the same turn.
- To conclude: say ONE short closing turn — thank the candidate for their time, tell them the HR team will review their answers and follow up with the next steps — then call the `end_interview` tool in the SAME turn.
- Always speak the closing sentence BEFORE calling the tool, so the candidate hears it.
- Do NOT call `end_interview` early: not while genuinely new topics remain, not just because an answer was short, and not if the candidate still has questions. If the candidate asks something at the end, answer briefly first.
- Never mention the tool or that you are "closing the connection"; just deliver a natural human closing."""


# ────────────────────────────────────────────────────────────────────────────
# Arabic dialect profiles
# ────────────────────────────────────────────────────────────────────────────
# Three profiles control how the LLM phrases Arabic answers:
#   * "msa"          → Modern Standard Arabic only (formal, neutral)
#   * "iraqi_light"  → MSA-leaning with a light Iraqi sprinkle in everyday
#                      connectors and pronouns; keeps the interview professional.
#   * "iraqi"        → Full Iraqi colloquial. Use only for casual contexts.
#
# Why "iraqi_light" is the default: this is a real job interview. Heavy
# colloquial Arabic feels unprofessional to many candidates and reads poorly
# in transcripts. A light Iraqi flavor keeps it warm and local without
# losing interviewer authority. Override per-deployment via INTERVIEW_DIALECT.
#
# IMPORTANT (audio): ElevenLabs voices are not trained on Iraqi accent. These
# profiles only change the *words* the LLM produces; the *accent* you hear
# still depends on the voice model. To get a true Iraqi accent you must clone
# an Iraqi speaker via ElevenLabs Voice Lab and set ELEVENLABS_VOICE_ID_AR.

_DIALECT_MSA = """Arabic style: Modern Standard Arabic (الفصحى) only. Avoid colloquial words. Examples: "ماذا"، "كيف"، "الآن"، "هل"، "أنا"، "نحن". Keep verbs in MSA conjugation."""

_DIALECT_IRAQI_LIGHT = """Arabic style: MSA-leaning Iraqi (لهجة عراقية مهنية خفيفة). Stay professional but warm. Use this targeted set sparingly:
- Question words: "شنو" instead of "ماذا"; "شلون" instead of "كيف"; "وين" instead of "أين"; "ليش" instead of "لماذا".
- Pronouns: "آني" / "إحنا" / "انته" / "انتي" are acceptable.
- Connectors: "هسه" (الآن) ، "كلش" (very) ، "ماكو" (لا يوجد) ، "اكو" (يوجد) — use 1–2 per turn, not in every sentence.
- Prefer "كلش" over "هواية", especially at the start of the sentence. Avoid opening replies with "هواية".
- Verbs: keep core verbs in MSA-Iraqi mix ("اشتغلت"، "گلت"، "گال"، "چنت") when natural.
- Prefer Iraqi pronouns + MSA syntax over full colloquial. Avoid heavy slang ("بَلكَت"، "هيچ"، "جذي") — they feel too casual for an interview.
- Gender agreement (when candidate gender is known): address female candidates with feminine second-person forms (واجهتِ، تعاملتِ، خبرتج، شلونج) and وياها (never ويها for a challenge/situation); address male candidates with masculine forms (واجهت، تعاملت، خبرتك، شلونك).
- Examples (good): "شنو هي خبرتك بإدارة الموظفين؟"، "شلون تتعامل وية موظف صعب؟"، "كلش تشتغل بفريق ولا لحالك؟".
- Examples (avoid): "هيچ يعني چنت گاعد تشتغل بَلكَت؟" — too colloquial, unprofessional."""

_DIALECT_IRAQI_FULL = """Arabic style: Iraqi colloquial (لهجة عراقية بغدادية كاملة). Use natural everyday Iraqi: شنو، شلون، وين، ليش، هسه، كلش، ماكو، اكو، جذي، هيچ، بَلكَت، چنت، چان، گال، گلت، آني، إحنا. Prefer "كلش" over "هواية" as the default intensifier, especially at sentence start. Conjugate verbs colloquially. Avoid stiff MSA. Stay polite. When candidate gender is known: feminine address for female (واجهتِ، تعاملتِ وياها، خبرتج) and masculine for male (واجهت، تعاملت، خبرتك)."""

_DIALECT_PROFILES = {
    "msa": _DIALECT_MSA,
    "iraqi_light": _DIALECT_IRAQI_LIGHT,
    "iraqi": _DIALECT_IRAQI_FULL,
}


def _resolve_dialect_block() -> str:
    """Build the dialect-aware instruction block based on INTERVIEW_DIALECT env."""
    raw = (os.getenv("INTERVIEW_DIALECT") or "iraqi_light").strip().lower()
    profile = _DIALECT_PROFILES.get(raw)
    if profile is None:
        logger.warning(
            "Unknown INTERVIEW_DIALECT=%r — falling back to iraqi_light. Valid: msa|iraqi_light|iraqi",
            raw,
        )
        profile = _DIALECT_IRAQI_LIGHT
    return f"""═══════════════════════════════════════════════════════════════
ARABIC DIALECT PROMPT (active profile: {raw})
═══════════════════════════════════════════════════════════════
{profile}

This dialect block applies ONLY when responding in Arabic. When responding in
English, ignore it entirely and use natural professional English."""


def _default_interview_instructions() -> str:
    """Layered prompt format (Base + Dialect + Flow), aligned with voice-agent structure."""
    return f"""═══════════════════════════════════════════════════════════════
BASE PROMPT (Persona, Voice rules, Language rules)
═══════════════════════════════════════════════════════════════
{_BASE_INTERVIEW_INSTRUCTIONS}

{_resolve_dialect_block()}

═══════════════════════════════════════════════════════════════
INTERVIEW FLOW PROMPT (Question order and opening behavior)
═══════════════════════════════════════════════════════════════
{_INTERVIEW_FLOW_INSTRUCTIONS}"""


def _build_candidate_gender_block(gender: str) -> str:
    g = (gender or "").strip().lower()
    if g == "female":
        return (
            "CANDIDATE GENDER: female.\n"
            "When addressing the candidate in Arabic use feminine second-person forms: "
            "تفضلي، خبرتج، شلونج، واجهتِ، تعاملتِ، سويتِ.\n"
            "Never use masculine تفضل/خبرتك for this candidate."
        )
    if g == "male":
        return (
            "CANDIDATE GENDER: male.\n"
            "When addressing the candidate in Arabic use masculine second-person forms: "
            "تفضل، خبرتك، شلونك، واجهت، تعاملت، سويت.\n"
            "Never use feminine تفضلي/خبرتج for this candidate."
        )
    return ""


def _role_is_people_focused(position: str) -> bool:
    p = (position or "").lower()
    if not p:
        return False
    cues = (
        "hr",
        "human resources",
        "recruit",
        "talent",
        "people",
        "موارد بشرية",
        "توظيف",
        "استقطاب",
    )
    return any(c in p for c in cues)


class TtsRouteContext:
    """Shared ElevenLabs voice/language routing for user transcripts and agent TTS."""

    def __init__(
        self,
        tts: Any,
        *,
        arabic_voice_id: str,
        english_voice_id: str,
        supports_override: bool,
        cooldown_ms: float,
        initial_voice_id: str,
        initial_language: str,
    ) -> None:
        self.tts = tts
        self.arabic_voice_id = arabic_voice_id
        self.english_voice_id = english_voice_id
        self.supports_override = supports_override
        self.cooldown_ms = cooldown_ms
        self.current_voice_id = initial_voice_id
        self.current_language = initial_language
        self.last_route_ts = 0.0
        # Last language we applied to ElevenLabs (ar/en); cooldown only dedupes same lang, never blocks switches.
        self._last_applied_detected: str | None = (
            initial_language if initial_language in ("ar", "en") else None
        )
        # Last user utterance language hint — lets tts_node route before LLM prefetch (less ~1s avatar glitch).
        self.last_user_lang: str | None = None

    def apply(self, detected: str, *, force: bool = False, source: str = "user") -> None:
        target_vid = self.arabic_voice_id if detected == "ar" else self.english_voice_id
        need_update = (target_vid != self.current_voice_id) or (
            self.supports_override and detected != self.current_language
        )
        if not need_update:
            return
        now = time.monotonic() * 1000.0
        # Cooldown must not block Arabic↔English switches (that caused wrong voice + ~1s catch-up).
        # Only skip redundant update_options for the same target language within the window.
        if (
            not force
            and (now - self.last_route_ts) < self.cooldown_ms
            and detected == self._last_applied_detected
        ):
            logger.debug(
                "TTS routing skipped (cooldown %.0fms, duplicate lang=%s)",
                self.cooldown_ms,
                detected,
            )
            return
        try:
            uk: dict[str, Any] = {"voice_id": target_vid}
            if self.supports_override:
                uk["language"] = detected
            self.tts.update_options(**uk)
            self.current_voice_id = target_vid
            if self.supports_override:
                self.current_language = detected
            self.last_route_ts = now
            self._last_applied_detected = detected
            logger.debug("TTS routing [%s] -> lang=%s voice=%s", source, detected, target_vid)
        except Exception as ex:
            logger.warning("TTS routing failed: %s", ex)


def tts_router_aligned_with_stream(r: TtsRouteContext) -> bool:
    """True when voice/lang already match stream — skip prefetch for lower avatar jitter."""
    if r.current_voice_id == r.english_voice_id:
        return (not r.supports_override) or (r.current_language == "en")
    if r.current_voice_id == r.arabic_voice_id:
        return (not r.supports_override) or (r.current_language == "ar")
    return False


class InterviewAssistant(Agent):
    """Routes ElevenLabs voice by agent reply text before TTS (not only user transcript)."""

    def __init__(
        self,
        *,
        tts_router: TtsRouteContext,
        session_language: str | None = None,
        allow_interruptions: bool | None = None,
        interview_state: str | None = None,
        interview_context: str | None = None,
        position: str | None = None,
        bank_questions: list[str] | None = None,
        bank_key: str | None = None,
        candidate_gender: str | None = None,
        has_domain_guidance: bool = False,
        role_glossary: list[RoleGlossaryEntry] | None = None,
        blueprint_competencies: list[dict[str, Any]] | None = None,
        experience_tracks: list[dict[str, Any]] | None = None,
        interview_paths: list[dict[str, Any]] | None = None,
        career_level: str | None = None,
        domain_pack_key: str | None = None,
        domain_guidance: str | None = None,
        pack_version: str | None = None,
        knowledge_depth: str | None = None,
        pack_match_confidence: str | None = None,
        role_key: str | None = None,
    ) -> None:
        ai = (
            allow_interruptions
            if allow_interruptions is not None
            else env_allow_interruption()
        )
        self._tts_router = tts_router
        self._position = (position or "").strip()
        self._bank_questions: list[str] = list(bank_questions or [])
        self._bank_key = (bank_key or "").strip()
        self._candidate_gender = (candidate_gender or "").strip().lower()
        self._has_domain_guidance = has_domain_guidance
        self._role_glossary: list[RoleGlossaryEntry] = list(role_glossary or [])
        self._blueprint_competencies: list[dict[str, Any]] = list(blueprint_competencies or [])
        self._experience_tracks: list[dict[str, Any]] = list(experience_tracks or [])
        self._interview_paths: list[dict[str, Any]] = list(interview_paths or [])
        self._career_level = (career_level or "").strip()
        self._domain_pack_key = (domain_pack_key or "").strip()
        self._domain_guidance = (domain_guidance or "").strip()
        self._pack_version = (pack_version or "").strip()
        self._knowledge_depth = (knowledge_depth or "").strip()
        self._pack_match_confidence = (pack_match_confidence or "").strip()
        self._role_key = (role_key or "").strip()
        self._turn_recommended: str | None = None
        self._turn_recommended_source: str = ""
        self._turn_clarify_fallback: str | None = None
        self._turn_clarify_source: str = ""
        self._turn_plan: TurnPlan | None = None
        self._turn_cross_domain_guard: str = "pass"
        # Wind-down state machine (offer wrap-up → final closing → conclude). The
        # reply-guard runs twice per turn (transcription_node + tts_node), so it
        # only advances once per ``turn_index`` and memoizes the line it emitted;
        # ``_conclude_after_reply`` is a one-shot set when the deterministic final
        # closing is emitted, so the session is actually torn down after it plays.
        self._winddown_turn: int = -1
        self._winddown_line: str | None = None
        self._conclude_after_reply: bool = False
        # Hold a reference to the fire-and-forget conclude task so it is not
        # garbage-collected before it tears the room down.
        self._conclude_task: asyncio.Task[None] | None = None
        self._role_is_people_focused = _role_is_people_focused(self._position)
        self._memory = InterviewMemory()
        if self._career_level and not self._memory.active_experience_track:
            self._memory.active_experience_track = default_track_for_career_level(
                self._career_level
            )
        self._heuristics_disabled = (
            (os.getenv("HEURISTIC_DISABLE") or "").strip().lower() in ("1", "true", "yes", "on")
        )
        # Sticky reply-language lock. Seeded from the share-link language when the
        # backend sent one, then overridden by an explicit user request ("speak in
        # English", "بالعربي لو سمحت") and cleared only by an opposite explicit
        # request — so a single short confirmation in the other language ("نعم",
        # "ok") cannot regress the language. ``None`` = follow last_user_lang.
        self._locked_lang: str | None = (
            session_language if session_language in ("ar", "en") else None
        )
        raw = (os.getenv("INTERVIEW_AGENT_INSTRUCTIONS") or "").strip()
        instructions = raw if raw else _default_interview_instructions()
        extra = (os.getenv("INTERVIEW_AGENT_INSTRUCTIONS_EXTRA") or "").strip()
        if extra:
            instructions = f"{instructions}\n{extra}"
        state = (interview_state or "").strip()
        if state:
            instructions = (
                f"{instructions}\n\n═══════════════════════════════════════════════════════════════\n"
                f"INTERVIEW STATE (advisory — runtime decision-frame messages take precedence)\n"
                f"═══════════════════════════════════════════════════════════════\n"
                f"{state}"
            )
        ctx = (interview_context or "").strip()
        if ctx:
            instructions = (
                f"{instructions}\n\n═══════════════════════════════════════════════════════════════\n"
                f"RUNTIME CONTEXT (From this session — use when relevant)\n"
                f"═══════════════════════════════════════════════════════════════\n"
                f"{ctx}"
            )
        gender_block = _build_candidate_gender_block(self._candidate_gender)
        if gender_block and _use_gender_address():
            instructions = (
                f"{instructions}\n\n═══════════════════════════════════════════════════════════════\n"
                f"CANDIDATE GENDER (address forms)\n"
                f"═══════════════════════════════════════════════════════════════\n"
                f"{gender_block}"
            )
        self._auto_end_enabled = interview_auto_end_enabled()
        if self._auto_end_enabled:
            instructions = (
                f"{instructions}\n\n═══════════════════════════════════════════════════════════════\n"
                f"CLOSING (Ending the interview)\n"
                f"═══════════════════════════════════════════════════════════════\n"
                f"{_INTERVIEW_CLOSING_INSTRUCTIONS}"
            )
        super().__init__(
            instructions=instructions,
            allow_interruptions=ai,
            tools=[self._end_interview_tool()] if self._auto_end_enabled else [],
        )

    def _end_interview_tool(self) -> Any:
        """Build the agent-initiated ``end_interview`` tool (gated by INTERVIEW_AUTO_END)."""

        async def end_interview(ctx: RunContext) -> str:
            """End the interview when it is genuinely complete.

            Call this only after all interview questions/topics have been covered and there is
            nothing useful left to ask. Speak your short closing sentence (thank the candidate
            and mention the HR team will review their answers and follow up) in the SAME turn,
            BEFORE this tool closes the session. Do not call it early or while topics remain.
            """
            await self._conclude_interview(ctx)
            return "Interview concluded; the session is closing now."

        return function_tool(end_interview, name="end_interview")

    def _schedule_conclude_after_reply(self) -> None:
        """Close the session after a guard-emitted final closing plays.

        When the reply-guard substitutes the deterministic final closing for a new
        question, it replaces the LLM's turn — so the model never calls the
        ``end_interview`` tool and the room is never torn down. This one-shot hook,
        called from the reply pipeline (tts_node), performs the same teardown as the
        tool so the interview actually concludes instead of lingering until the
        candidate leaves. Gated by ``INTERVIEW_AUTO_END`` (same gate as the tool).
        """
        if not self._conclude_after_reply:
            return
        self._conclude_after_reply = False  # one-shot
        if not self._auto_end_enabled:
            logger.info("[reply-guard] final closing emitted but auto-end disabled; room kept open")
            return
        try:
            self._conclude_task = asyncio.create_task(self._conclude_interview())
            logger.info("[reply-guard] final closing → agent-initiated conclude scheduled")
        except Exception as ex:
            logger.warning("[reply-guard] schedule conclude failed: %s", ex)

    async def _conclude_interview(self, ctx: RunContext | None = None) -> None:
        """Wait for the closing remark to finish, then close the session from the agent side.

        ``ctx`` is provided when called from the ``end_interview`` tool; the
        guard-triggered path passes ``None`` and derives the current speech from the
        live session instead.
        """
        # Let the goodbye the agent just spoke play out fully before tearing down.
        try:
            speech = None
            if ctx is not None:
                speech = getattr(ctx, "speech_handle", None) or getattr(
                    ctx.session, "current_speech", None
                )
            else:
                try:
                    sess = self.session
                except Exception:
                    sess = None
                speech = getattr(sess, "current_speech", None) if sess is not None else None
            if speech is not None:
                await speech.wait_for_playout()
        except Exception as ex:
            logger.debug("end_interview: wait_for_playout skipped: %s", ex)

        # wait_for_playout returns when the agent finishes STREAMING the closing to
        # the avatar worker, not when the avatar finishes PLAYING it. Without this
        # grace the room is deleted mid-goodbye and the avatar vanishes on the
        # candidate before they hear the closing (observed: closing was 7.4s audio,
        # room deleted ~1.3s after it was scheduled).
        grace_ms = interview_end_playout_grace_ms()
        if grace_ms > 0:
            try:
                await asyncio.sleep(grace_ms / 1000)
            except Exception as ex:
                logger.debug("end_interview: playout grace skipped: %s", ex)

        try:
            job_ctx = get_job_context()
        except Exception as ex:
            logger.warning("end_interview: no job context (%s); cannot close", ex)
            return
        if job_ctx is None:
            logger.warning("end_interview: job context is None; cannot close")
            return

        if interview_end_delete_room():
            try:
                await job_ctx.delete_room()
                logger.info("interview complete → room deleted (agent-initiated close)")
                return
            except Exception as ex:
                logger.warning(
                    "end_interview delete_room failed (%s); falling back to ctx.shutdown", ex
                )
        try:
            job_ctx.shutdown(reason="interview_complete")
            logger.info("interview complete → job shutdown (agent-initiated close)")
        except Exception as ex:
            logger.warning("end_interview shutdown failed: %s", ex)

    def _reply_language_directive(self) -> str:
        """Build an explicit language directive for the LLM.

        Priority order:
          1. ``_locked_lang`` — set by an explicit user request to switch (e.g.
             "let's speak in English", "بالعربي لو سمحت"). Stays in force until
             an opposite explicit request is received.
          2. ``tts_router.last_user_lang`` — language of the candidate's last
             utterance; used only when no explicit lock is active.
          3. Generic mirror-the-last-sentence fallback.

        This avoids the "single Arabic confirmation flips back to Arabic" bug
        by treating explicit switch requests as sticky.
        """
        if self._locked_lang == "en":
            return (
                "REPLY LANGUAGE: English. This interview is being conducted in English. "
                "Stay in English for every turn until the candidate explicitly asks to switch to Arabic. "
                "If they answer in Arabic, you still reply in English — never mirror their language. "
                "Do NOT switch on a short Arabic confirmation like 'نعم', 'تمام', or 'ok'."
            )
        if self._locked_lang == "ar":
            return (
                "REPLY LANGUAGE: Arabic. This interview is being conducted in Arabic. "
                "Answer in Arabic and apply the active dialect profile from the system prompt. "
                "Reuse any English terms the candidate used (brand names, tools, skills) verbatim. "
                "Do NOT switch to English on a stray English word or short confirmation."
            )

        lang = (self._tts_router.last_user_lang or "").strip().lower() or None
        if lang == "en":
            return (
                "REPLY LANGUAGE: English ONLY IF the candidate's last full sentence was English. "
                "If their last sentence was Arabic that merely contained English loanwords, brand "
                "names, or skill names (e.g. 'recruitment', 'HR', 'Excel'), reply in Arabic and "
                "reuse those English terms verbatim. Do not switch to English on a single English "
                "word inside an Arabic sentence."
            )
        if lang == "ar":
            return (
                "REPLY LANGUAGE: Arabic. The candidate's most recent message is in Arabic. "
                "Answer in Arabic, applying the active dialect profile from the system prompt. "
                "Reuse any English terms the candidate used (brand names, tools, skills) verbatim."
            )
        return (
            "REPLY LANGUAGE: mirror the candidate's most recent FULL sentence language exactly. "
            "Do not infer language from the bank, from earlier turns, or from a single foreign "
            "loanword embedded in an otherwise Arabic sentence."
        )

    def _format_asked_questions_line(self) -> str:
        mem = self._memory
        if not mem.asked_questions:
            return "Questions already asked: (none yet)."
        recent = mem.asked_questions[-6:]
        bullets = "; ".join(f'"{q[:120]}"' for q in recent)
        return (
            f"Questions already asked (NEVER repeat verbatim or semantically): {bullets}. "
            "Pick a genuinely different angle or anchor."
        )

    def _suggest_next_anchor_line(self) -> str:
        nxt = self._pick_next_bank_anchor()
        if nxt:
            return f"Suggested next bank anchor (rephrase naturally, do not read verbatim): \"{nxt[:200]}\""
        if self._has_domain_guidance:
            return (
                "All bank anchors appear used — improvise a NEW role-specific question "
                "from DOMAIN KNOWLEDGE / JOB EXPERTISE in session instructions. "
                "Do not recycle earlier questions."
            )
        return (
            "All bank anchors appear used — improvise a fresh role-relevant question. "
            "Do not recycle earlier questions."
        )

    def _format_turn_state(self, diag: dict[str, Any], mem: InterviewMemory) -> str:
        link = diag.get("link_policy") or {}
        payload = {
            "is_greeting_or_ready": bool(diag.get("is_greeting_or_ready")),
            "is_substantive_answer": bool(diag.get("is_substantive_answer")),
            "candidate_entities_in_last_message": link.get(
                "candidate_entities_in_last_message", []
            ),
            "allowed_link_entities": link.get("allowed_link_entities", []),
            "rejected_entities": link.get(
                "rejected_entities", sorted(mem.rejected_entities)
            ),
            "last_correction": link.get("last_correction") or mem.last_correction,
            "speech_hooks": diag.get("speech_hooks") or [],
            "honor_skip_content": bool(diag.get("honor_skip_content")),
            "asked_questions_count": len(mem.asked_questions),
            "active_experience_track": mem.active_experience_track or "",
            "question_difficulty": track_question_difficulty(
                mem.active_experience_track,
                self._experience_tracks or None,
            ),
            "path_cursor": mem.path_cursor,
            "domain_pack_key": self._domain_pack_key or "",
            "pack_version": self._pack_version or "",
            "knowledge_depth": self._knowledge_depth or "",
            "role_key": self._role_key or "",
            "match_confidence": self._pack_match_confidence or "",
            "recommended_source": self._turn_recommended_source or "",
            "clarify_example_source": self._turn_clarify_source or "",
            "current_competency_key": mem.current_competency_key or "",
            "rejected_competency_keys": sorted(mem.rejected_competency_keys),
            "cross_domain_guard": self._turn_cross_domain_guard or "pass",
        }
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def _link_policy_instructions(self, link_policy: dict[str, Any]) -> str:
        allowed = link_policy.get("allowed_link_entities") or []
        forbidden = link_policy.get("forbidden_attribution_entities") or []
        lines = [
            "LINK POLICY (mandatory):",
            "- Blueprint/domain terms are for ASKING ABOUT tools, not assuming the candidate used them.",
        ]
        if not allowed:
            lines.extend(
                [
                    "- allowed_link_entities is EMPTY → FORBIDDEN: \"بما أنك ذكرت\", "
                    "\"since you mentioned\", attributing ANY blueprint tool to the candidate.",
                ]
            )
        else:
            labels = ", ".join(allowed)
            lines.extend(
                [
                    f"- allowed_link_entities is NON-EMPTY → you MAY reference ONLY: {labels}.",
                    "- Prefer \"بخصوص X\" over \"بما أنك ذكرت X\".",
                ]
            )
        if forbidden:
            sample = ", ".join(str(x) for x in forbidden[:8])
            lines.append(
                f"- Do NOT attribute these role terms unless the candidate said them: {sample}."
            )
        return "\n".join(lines)

    def _find_competency_followup(self, entity: str) -> str | None:
        entity_norm = normalize_text(entity)
        if not entity_norm or not self._blueprint_competencies:
            return None
        for comp in self._blueprint_competencies:
            title = str(comp.get("title") or comp.get("key") or "")
            evidence = [str(e) for e in (comp.get("evidence") or [])]
            follow_ups = [str(f).strip() for f in (comp.get("followUps") or []) if str(f).strip()]
            haystacks = [title, *evidence, *follow_ups]
            matched = any(
                entity_norm in normalize_text(h) or normalize_text(h) in entity_norm
                for h in haystacks
                if h
            )
            if matched and follow_ups:
                return collapse_to_single_question(follow_ups[0])
        return None

    def _pick_hook_or_entity_followup(
        self,
        diag: dict[str, Any],
        link_policy: dict[str, Any],
    ) -> str | None:
        pack = self._domain_pack_key.lower()
        hooks = diag.get("speech_hooks") or []
        if hooks and pack in ("", "hr_recruiter"):
            return collapse_to_single_question(pick_hook_followup(hooks[0]))
        allowed = link_policy.get("allowed_link_entities") or []
        if allowed:
            follow = self._find_competency_followup(allowed[0])
            if follow:
                return collapse_to_single_question(follow)
            return collapse_to_single_question(
                pick_varied(ENTITY_APPLY_POOL, self._memory, key=allowed[0])
            )
        return None

    def _set_turn_recommendation(
        self,
        question: str | None,
        *,
        source: str,
        clarify_fallback: str | None = None,
        clarify_source: str = "",
        response_mode: str | None = None,
        step_key: str | None = None,
        path_key: str | None = None,
        competency_key: str | None = None,
        cluster_key: str | None = None,
        question_id: str | None = None,
        parent_question_id: str | None = None,
        followup_type: str | None = None,
        advance_path_on_send: bool | None = None,
    ) -> str | None:
        mem = self._memory
        mode = response_mode
        if mode is None:
            if source == "wait_for_completion":
                mode = MODE_WAIT
            elif source in ("clarify_pack", "clarify_challenge"):
                mode = MODE_CLARIFY
            elif source == "follow_up_on_active":
                mode = MODE_FOLLOW_UP
            elif source == "offer_guidance":
                mode = MODE_GUIDANCE
            elif source == "resume_active":
                mode = MODE_RESUME
            else:
                mode = MODE_ASK

        # ── Verbatim re-ask guard ────────────────────────────────────────────
        # Never emit the same ASK/follow-up question two turns running (the
        # candidate hears a literal repeat). Prefer the next unused bank anchor;
        # otherwise rephrase it. CLARIFY / WAIT / RESUME intentionally re-touch
        # the active question, so they are exempt.
        if question and mode in (MODE_ASK, MODE_FOLLOW_UP):
            _q_norm = normalize_text(question)
            if _q_norm and _q_norm == mem.last_sent_question_norm:
                _alt = self._pick_next_bank_anchor()
                if _alt and normalize_text(_alt) != _q_norm:
                    question = _alt
                    source = "bank"
                    mode = MODE_ASK
                    question_id = None
                    parent_question_id = None
                    followup_type = None
                else:
                    _rephrased, _ = simplify_clarify_for_pack(
                        question, domain_pack_key=self._domain_pack_key
                    )
                    _rephrased = collapse_to_single_question(_rephrased).strip()
                    if _rephrased and normalize_text(_rephrased) != _q_norm:
                        question = _rephrased
                        source = "clarify_pack"
                        mode = MODE_CLARIFY

        resolved_path = path_key or mem.pending_path_key or self._resolve_path_key(mem)
        resolved_step = step_key or mem.pending_step_key or None
        resolved_cluster = cluster_key or mem.pending_cluster_key or None
        resolved_comp = competency_key or mem.pending_competency_key or mem.current_competency_key or None
        resolved_qid = question_id
        pack = (self._domain_pack_key or "default").strip()

        if not resolved_qid and mode == MODE_FOLLOW_UP and parent_question_id:
            resolved_qid = make_followup_question_id(
                pack, parent_question_id, followup_type or "story_detail"
            )
        elif not resolved_qid and resolved_step and resolved_path:
            resolved_qid = make_path_question_id(pack, resolved_path, resolved_step)
        elif not resolved_qid and source in ("bank", "track_anchor") and question:
            resolved_qid = make_bank_question_id(pack, normalize_text(question)[:80])

        advance = advance_path_on_send
        if advance is None:
            advance = (
                source == "path_step"
                and mem.active_question_status in (STATUS_ANSWERED, STATUS_REJECTED)
            )

        self._turn_recommended = question
        self._turn_recommended_source = source
        self._turn_clarify_fallback = clarify_fallback
        self._turn_clarify_source = clarify_source or source
        self._turn_plan = TurnPlan(
            question=question,
            question_id=resolved_qid,
            parent_question_id=parent_question_id or mem.parent_question_id or None,
            step_key=resolved_step,
            path_key=resolved_path,
            competency_key=resolved_comp,
            cluster_key=resolved_cluster,
            source=source,
            response_mode=mode or MODE_ASK,
            clarify_fallback=clarify_fallback,
            clarify_source=clarify_source or source,
            advance_path_on_send=bool(advance),
            followup_type=followup_type,
        )
        return question

    def _resolve_path_key(self, mem: InterviewMemory) -> str:
        if mem.interview_path_key:
            return mem.interview_path_key
        track = (mem.active_experience_track or "").strip() or default_track_for_career_level(
            self._career_level
        )
        path = resolve_interview_path(self._interview_paths or None, track)
        if path:
            pk = str(path.get("pathKey") or "").strip()
            if pk:
                mem.interview_path_key = pk
                return pk
        return ""

    def _reject_active_question(self, mem: InterviewMemory) -> None:
        qid = (mem.parent_question_id or mem.sent_question_id or "").strip()
        if qid:
            close_question_on_memory(
                mem,
                qid,
                "rejected",
                step_key=mem.pending_step_key,
                cluster_key=mem.pending_cluster_key,
            )
        cluster = (mem.pending_cluster_key or "").strip()
        if cluster:
            mem.rejected_cluster_keys.add(cluster)
        mem.active_question_status = STATUS_REJECTED
        mem.deferred_question_id = ""

    def _close_active_answered(self, mem: InterviewMemory, *, rich: bool = False) -> None:
        qid = (mem.parent_question_id or mem.sent_question_id or "").strip()
        if not qid:
            mem.active_question_status = STATUS_ANSWERED
            return
        close_question_on_memory(
            mem,
            qid,
            "answered",
            step_key=mem.pending_step_key,
            cluster_key=mem.pending_cluster_key,
            increment_evidence=rich,
        )
        if rich and mem.pending_cluster_key:
            if mem.cluster_evidence_counts.get(mem.pending_cluster_key, 0) >= 1:
                mem.covered_cluster_keys.add(mem.pending_cluster_key)
        mem.active_question_status = STATUS_ANSWERED

    def _apply_active_question_user_signals(
        self, mem: InterviewMemory, diag: dict[str, Any]
    ) -> None:
        if not is_open_status(mem.active_question_status):
            return
        if diag.get("resume_active"):
            mem.active_question_status = STATUS_AWAITING_ANSWER
            mem.deferred_question_id = ""
            return
        if diag.get("is_incomplete_turn") or diag.get("is_answer_in_progress"):
            mem.active_question_status = STATUS_ANSWERING
            return
        meta = diag.get("meta_request")
        if meta == "clarify_term" or diag.get("is_ambiguous_clarify"):
            mem.active_question_status = STATUS_CLARIFYING
            return
        if diag.get("explicit_question_reject"):
            self._reject_active_question(mem)

    def _active_question_locked_pick(
        self,
        diag: dict[str, Any],
        mem: InterviewMemory,
        link_policy: dict[str, Any],
    ) -> str | None:
        """When a question is open, only clarify / wait / resume / follow-up are allowed."""
        if diag.get("is_topic_change_request") or diag.get("explicit_question_reject"):
            return None

        if diag.get("resume_active"):
            text = (mem.active_question_text or mem.last_sample or "").strip()
            return self._set_turn_recommendation(
                text or "كمل جوابك على السؤال السابق.",
                source="resume_active",
                response_mode=MODE_RESUME,
                question_id=mem.sent_question_id or None,
            )

        if diag.get("is_ask_for_guidance"):
            guided = self._pick_guidance_recommendation(diag, mem)
            if guided is not None:
                return guided

        if diag.get("is_incomplete_turn") or diag.get("is_answer_in_progress"):
            if not interview_wait_nudge_enabled():
                return None  # nudges disabled — the turn gate keeps us silent
            if mem.consecutive_wait_count >= _max_consecutive_waits():
                return None  # too many nudges — advance to a fresh question
            return self._set_turn_recommendation(
                pick_varied(CONTINUATION_POOL, mem),
                source="wait_for_completion",
                response_mode=MODE_WAIT,
                question_id=mem.sent_question_id or None,
            )

        meta = diag.get("meta_request")
        if meta == "clarify_term" or diag.get("is_ambiguous_clarify"):
            same = (mem.active_question_text or mem.last_sample or mem.current_topic or "").strip()
            if same:
                clarified, src = self._clarify_for_current_pack(same)
                return self._set_turn_recommendation(
                    collapse_to_single_question(clarified),
                    source="clarify_pack",
                    clarify_fallback=clarified,
                    clarify_source=src,
                    response_mode=MODE_CLARIFY,
                    question_id=mem.sent_question_id or None,
                )

        if self._competency_followup_budget_left(mem) and (
            diag.get("is_story_starter")
            or (
                diag.get("is_shallow")
                and diag.get("is_substantive_answer")
                and not diag.get("is_rich_answer")
                and mem.active_question_status in (STATUS_AWAITING_ANSWER, STATUS_ANSWERING)
            )
        ):
            parent = mem.parent_question_id or mem.sent_question_id or ""
            # Role-neutral difficulty probe, varied opener (was HR-specific).
            follow = pick_varied(DIFFICULTY_FOLLOWUP_POOL, mem)
            return self._set_turn_recommendation(
                collapse_to_single_question(follow),
                source="follow_up_on_active",
                response_mode=MODE_FOLLOW_UP,
                parent_question_id=parent or None,
                followup_type="difficulty_reason",
                step_key=mem.pending_step_key or None,
                cluster_key=mem.pending_cluster_key or None,
                competency_key=mem.pending_competency_key or None,
                path_key=mem.pending_path_key or None,
            )

        if diag.get("is_rich_answer"):
            return None

        # Continuation nudges ("خذ راحتك…") fire on a pause and talk OVER the
        # candidate. When they are disabled this path must yield instead of
        # broadcasting one: the turn gate only silences replies whose inferred
        # action is wait_for_completion, and this path is also reached with
        # other actions (unsure / shallow), which is how the nudges kept leaking.
        if not interview_wait_nudge_enabled():
            return None
        if mem.consecutive_wait_count >= _max_consecutive_waits():
            return None  # too many nudges — advance to a fresh question
        return self._set_turn_recommendation(
            pick_varied(CONTINUATION_POOL, mem),
            source="wait_for_completion",
            response_mode=MODE_WAIT,
            question_id=mem.sent_question_id or None,
        )

    def _clarify_for_current_pack(self, last_question: str) -> tuple[str, str]:
        return simplify_clarify_for_pack(
            last_question,
            domain_pack_key=self._domain_pack_key,
            domain_guidance=self._domain_guidance,
            competencies=self._blueprint_competencies,
        )

    def _has_recent_question_context(self, mem: InterviewMemory) -> bool:
        return bool(
            (mem.active_question_text or mem.last_sample or mem.current_topic or "").strip()
        )

    def _guidance_lines_for_context(self, mem: InterviewMemory) -> tuple[str, str]:
        cluster = (mem.pending_cluster_key or "").strip().lower()
        step = (mem.pending_step_key or "").strip().lower()
        topic = (mem.active_question_text or mem.last_sample or "").lower()

        if (
            cluster in ("manager_intake", "manager_alignment")
            or "requirement" in step
            or "manager" in step
            or "متطلبات" in topic
        ):
            guidance = (
                "الإجراء المعتاد هو عقد اجتماع سريع مع المدير أولاً لتحديد شنو تغيّر بالضبط، "
                "بعدها مراجعة قائمة المرشحين الحاليين قبل فتح بحث جديد."
            )
            bridge = "لو صار وياك موقف مشابه، شنو أول خطوة تتوقع تسويها؟"
        elif cluster == "sourcing" or "channel" in step or "قناة" in topic:
            guidance = (
                "عادة نراجع مع المدير هدف القناة ونقيس جودة المرشحين مو بس عددهم، "
                "وبعدين نكيّف الخطة حسب النتائج."
            )
            bridge = "بناءً على خبرتك، شنو أول معيار تستخدمه لتقييم قناة الاستقطاب؟"
        elif "feedback" in step or "تغذية" in topic or "مرفوض" in topic:
            guidance = (
                "الأفضل إبلاغ المرشح باحترام وباختصار، مع توضيح سبب عام إذا السياسة تسمح، "
                "وترك باب مفتوح لفرص مستقبلية إذا كان مناسباً."
            )
            bridge = "لو ما عندك تجربة مباشرة، شنو أول خطوة تتوقع تسويها بهالموقف؟"
        else:
            guidance = (
                "الأفضل تبدأ بخطوة واضحة وقصيرة حسب السياسة عندكم، "
                "ثم تكيّف الخطة حسب النتيجة."
            )
            bridge = "لو واجهت هالموقف، شنو أول إجراء تفكر تسويه؟"
        return guidance, bridge

    def _pick_guidance_recommendation(
        self, diag: dict[str, Any], mem: InterviewMemory
    ) -> str | None:
        if not diag.get("is_ask_for_guidance"):
            return None
        guidance, bridge = self._guidance_lines_for_context(mem)
        combined = collapse_to_single_question(f"{guidance} {bridge}")
        return self._set_turn_recommendation(
            combined,
            source="offer_guidance",
            response_mode=MODE_GUIDANCE,
            question_id=mem.sent_question_id or None,
            clarify_fallback=bridge,
            step_key=mem.pending_step_key or None,
            cluster_key=mem.pending_cluster_key or None,
            competency_key=mem.pending_competency_key or None,
            path_key=mem.pending_path_key or None,
        )

    def _pick_clarify_recommendation(
        self, diag: dict[str, Any], mem: InterviewMemory
    ) -> str | None:
        meta = diag.get("meta_request")
        if meta not in ("clarify_term", "clarify_challenge") and not diag.get(
            "is_ambiguous_clarify"
        ):
            return None
        same = (
            mem.active_question_text or mem.last_sample or mem.current_topic or ""
        ).strip()
        if not same:
            return None
        if meta == "clarify_challenge":
            text, src = clarify_challenge_reply(self._domain_pack_key)
            return self._set_turn_recommendation(
                collapse_to_single_question(text),
                source="clarify_challenge",
                clarify_fallback=text,
                clarify_source=src,
                response_mode=MODE_CLARIFY,
                question_id=mem.sent_question_id or None,
            )
        clarified, src = self._clarify_for_current_pack(same)
        return self._set_turn_recommendation(
            collapse_to_single_question(clarified),
            source="clarify_pack",
            clarify_fallback=clarified,
            clarify_source=src,
            response_mode=MODE_CLARIFY,
            question_id=mem.sent_question_id or None,
        )

    def _apply_guard_to_agent_text(self, agent_text: str) -> str:
        single = enforce_single_question_response(agent_text, self._turn_plan)
        result = validate_cross_domain_output(
            single,
            domain_pack_key=self._domain_pack_key,
            recommended_question=self._turn_recommended,
            clarify_fallback=self._turn_clarify_fallback,
        )
        if result.safe:
            self._turn_cross_domain_guard = "pass"
            guarded = single
        else:
            self._turn_cross_domain_guard = "blocked"
            logger.info(
                "[cross-domain-guard] blocked pack=%s term=%s fallback_source=%s",
                self._domain_pack_key or "n/a",
                result.blocked_term or "?",
                result.fallback_source or "n/a",
            )
            fallback = (result.fallback_text or single).strip()
            guarded = enforce_single_question_response(fallback, self._turn_plan)
        return self._guard_repetition_and_language(guarded)

    def _guard_repetition_and_language(self, text: str) -> str:
        """On a fresh ASK turn, block a question that is a near-duplicate of a
        recent one or that carries a malformed hybrid Latin+Arabic token (e.g.
        "motivatesك"): replace it with the next unused bank anchor so the agent
        moves forward with a clean, new question instead of repeating/garbling.

        Skipped for clarify/follow-up/wait/resume — those intentionally revisit
        the active question. No-op when no fresh bank anchor is available.
        """
        mode = self._turn_plan.response_mode if self._turn_plan else MODE_ASK
        # Wait/acknowledge carry no question to guard.
        if mode in (MODE_WAIT, MODE_ACKNOWLEDGE):
            return text
        # Once a wrap-up was offered, the interview is winding down: do NOT start a
        # NEW question (ask / topic-resume). Deliver the final closing once instead
        # of resuming — the candidate had already been asked "anything to add?".
        # (Guidance/clarify/follow-up still pass so the candidate can finish their
        # last thought.)
        mem = self._memory
        # This guard runs twice per turn (transcription_node + tts_node). The
        # wind-down state machine must advance at most once per turn and return
        # the same line both times, so chat and audio agree and we never collapse
        # the wrap-up offer and the final closing into a single turn.
        turn = mem.turn_index
        if self._winddown_turn == turn and self._winddown_line is not None:
            return self._winddown_line
        if mem.wrap_up_offered and not mem.final_closing_sent and mode in (MODE_ASK, MODE_RESUME):
            mem.final_closing_sent = True
            # The guard replaced the LLM's turn, so the model never calls
            # end_interview. Trigger the same teardown ourselves after the closing
            # plays, otherwise the session lingers and the agent keeps replying
            # until the candidate leaves (the "interview never concluded" bug).
            self._conclude_after_reply = True
            self._winddown_turn = turn
            self._winddown_line = _FINAL_CLOSING_AR
            logger.info(
                "[reply-guard] post-wrap-up: final closing + agent-initiated conclude scheduled"
            )
            return _FINAL_CLOSING_AR
        recent = self._memory.asked_questions[-12:]
        is_hybrid = contains_hybrid_latin_arabic_token(text)
        # Duplicate check applies to turns that ask a NEW question (ask / topic
        # resume / guidance). Clarify restates the active question and follow-up
        # deepens it, so both are meant to echo it — never dedup those.
        is_dup = mode not in (MODE_CLARIFY, MODE_FOLLOW_UP) and (
            is_semantic_duplicate_question(text, recent)
            or is_topic_repeat(text, recent)  # paraphrased same-topic repeat
        )
        if not (is_dup or is_hybrid):
            return text
        anchor = self._pick_next_bank_anchor(recent)
        if anchor:
            logger.info(
                "[reply-guard] replaced %s (dup=%s hybrid=%s) with fresh bank anchor",
                mode,
                is_dup,
                is_hybrid,
            )
            return enforce_single_question_response(anchor, self._turn_plan)
        # No fresh question is left, so a replacement would just recycle a covered
        # one. Offer a single graceful wrap-up instead of repeating; the closing
        # (and teardown) follows on a LATER turn, so the candidate gets a real
        # chance to answer "anything to add?" first.
        if not mem.wrap_up_offered and len(mem.asked_questions) >= _wrap_up_min_questions():
            mem.wrap_up_offered = True
            self._winddown_turn = turn
            self._winddown_line = _WRAP_UP_PROMPT_AR
            logger.info("[reply-guard] no fresh anchor for %s; offering wrap-up", mode)
            return _WRAP_UP_PROMPT_AR
        return text

    def _update_experience_track(self, text: str) -> None:
        mem = self._memory
        prev = mem.active_experience_track
        snippets = [mem.last_candidate_snippet] if mem.last_candidate_snippet else None
        new_track = detect_experience_track(
            text,
            self._experience_tracks or None,
            current_track=prev,
            career_level=self._career_level,
            session_snippets=snippets,
        )
        if new_track and new_track != prev:
            mem.active_experience_track = new_track
            mem.track_anchor_cursor = 0
            logger.info("experience track updated: %s -> %s", prev or "(none)", new_track)

    def _pick_track_aware_anchor(self, mem: InterviewMemory) -> str | None:
        track = (mem.active_experience_track or "").strip()
        if not track or track == "experienced":
            return self._pick_next_bank_anchor()
        q, new_cursor = pick_track_opening_anchor(
            track,
            self._experience_tracks or None,
            cursor=mem.track_anchor_cursor,
            asked_keys=mem.asked_question_keys,
        )
        if q:
            mem.track_anchor_cursor = new_cursor
            return q
        return self._pick_next_bank_anchor()

    def _should_offer_path_step(self, diag: dict[str, Any]) -> bool:
        if not self._interview_paths:
            return False
        if diag.get("is_greeting_or_ready"):
            return False
        if diag.get("is_shallow") or diag.get("is_incomplete_turn"):
            return False
        meta = diag.get("meta_request")
        if meta in ("clarify_term", "clarify_challenge", "ask_interviewer", "intro_self"):
            return False
        if diag.get("is_rich_answer") or diag.get("suggest_followup"):
            return False
        if diag.get("is_topic_change_request"):
            return False
        return True

    def _pick_path_step_recommendation(self, mem: InterviewMemory) -> str | None:
        track = (mem.active_experience_track or "").strip()
        if not track:
            track = default_track_for_career_level(self._career_level)
        q, step_key, comp_key, cluster_key = peek_path_step_detail(
            self._interview_paths or None,
            track,
            mem.path_cursor,
            mem.asked_question_keys,
            closed_question_ids=mem.closed_question_ids,
            completed_step_keys=mem.completed_step_keys,
            rejected_cluster_keys=mem.rejected_cluster_keys,
            covered_cluster_keys=mem.covered_cluster_keys,
            pack_key=self._domain_pack_key,
        )
        if step_key:
            mem.pending_step_key = step_key
        if cluster_key:
            mem.pending_cluster_key = cluster_key
        if comp_key:
            mem.current_competency_key = comp_key
            mem.pending_competency_key = comp_key
        path_key = self._resolve_path_key(mem)
        if path_key:
            mem.pending_path_key = path_key
        if q and step_key and path_key:
            qid = make_path_question_id(self._domain_pack_key or "default", path_key, step_key)
            if qid in mem.closed_question_ids:
                return None
        return q

    def _forbidden_domain_hint(self) -> str:
        pack = self._domain_pack_key.lower()
        if pack and pack != "hr_recruiter":
            return (
                " FORBIDDEN in your reply: Time to Fill, Offer Acceptance, candidate pipeline, "
                "Boolean search, LinkedIn sourcing, ATS tracking — these are HR-only terms."
            )
        return ""

    def _pick_competency_jump(self, mem: InterviewMemory, diag: dict[str, Any] | None = None) -> str | None:
        reject_competency_cluster(
            self._domain_pack_key,
            mem.current_competency_key or None,
            mem.rejected_competency_keys,
        )
        cluster = (mem.pending_cluster_key or "").strip()
        skip_reject = set(mem.rejected_cluster_keys)
        if diag and diag.get("is_topic_change_request") and cluster:
            mem.skip_count_by_cluster[cluster] = mem.skip_count_by_cluster.get(cluster, 0) + 1
            skip_reject.update(
                build_skip_rejection_clusters(
                    self._domain_pack_key,
                    cluster,
                    mem.skip_count_by_cluster[cluster],
                )
            )
        if mem.topic_change_count >= 3:
            skip_reject.update(
                {
                    "sourcing",
                    "screening",
                    "manager_intake",
                    "difficult_role",
                    "metrics",
                    "experience",
                    "candidate_experience",
                }
            )
            skip_reject.update(mem.covered_cluster_keys)
        track = (mem.active_experience_track or "").strip() or default_track_for_career_level(
            self._career_level
        )
        path_key = self._resolve_path_key(mem)
        distant_q, step_key, comp_key, cluster_key = pick_distant_step(
            self._domain_pack_key,
            self._interview_paths or None,
            track,
            rejected_step_keys={
                mem.pending_step_key,
                *mem.completed_step_keys,
            }
            if mem.pending_step_key
            else set(mem.completed_step_keys),
            rejected_cluster_keys=skip_reject,
            completed_step_keys=mem.completed_step_keys,
            asked_competency_keys=mem.asked_competency_keys,
            current_cluster_key=cluster or None,
            asked_question_keys=mem.asked_question_keys,
            closed_question_ids=mem.closed_question_ids,
            pack_key_for_ids=self._domain_pack_key,
            path_key_for_ids=path_key,
        )
        if distant_q and comp_key:
            mem.current_competency_key = comp_key
            mem.pending_competency_key = comp_key
            if step_key:
                mem.pending_step_key = step_key
            if cluster_key:
                mem.pending_cluster_key = cluster_key
            mem.pending_path_advance = False
            return self._set_turn_recommendation(
                collapse_to_single_question(distant_q),
                source="competency_jump",
                step_key=step_key,
                cluster_key=cluster_key,
                competency_key=comp_key,
                path_key=path_key,
            )
        q, comp_key = pick_next_competency_question(
            self._domain_pack_key,
            interview_paths=self._interview_paths or None,
            asked_competency_keys=mem.asked_competency_keys,
            rejected_competency_keys=mem.rejected_competency_keys,
            asked_question_keys=mem.asked_question_keys,
            track_key=track,
            rejected_step_keys=mem.completed_step_keys,
            rejected_cluster_keys=skip_reject,
            completed_step_keys=mem.completed_step_keys,
            current_cluster_key=cluster or None,
        )
        if q and comp_key:
            mem.current_competency_key = comp_key
            mem.pending_competency_key = comp_key
            mem.pending_path_advance = False
            return self._set_turn_recommendation(
                collapse_to_single_question(q),
                source="competency_jump",
                competency_key=comp_key,
            )
        return None

    def _pick_recommended_question(
        self,
        diag: dict[str, Any],
        mem: InterviewMemory,
        link_policy: dict[str, Any],
    ) -> str | None:
        mem = self._memory
        mem.pending_path_advance = False
        # Hard cap on interview length: even when fresh bank questions still exist,
        # an interview that has already asked this many questions must wind down —
        # otherwise a bank-driven interview (no blueprint) keeps finding "fresh"
        # anchors forever and never concludes (observed: 24+ questions, no wrap-up).
        # Offer the single wrap-up once; the closing + teardown follow on later turns
        # via the existing wind-down state machine.
        if (
            not mem.wrap_up_offered
            and len(mem.asked_questions) >= _wrap_up_max_questions()
        ):
            mem.wrap_up_offered = True
            self._winddown_turn = mem.turn_index
            self._winddown_line = _WRAP_UP_PROMPT_AR
            logger.info(
                "[interview] hard question cap reached (%d) → offering wrap-up",
                len(mem.asked_questions),
            )
            return _WRAP_UP_PROMPT_AR
        anchor = self._pick_next_bank_anchor()

        if diag.get("is_topic_change_request"):
            if is_open_status(mem.active_question_status):
                self._reject_active_question(mem)
            mem.topic_change_count += 1
            hook_follow = self._pick_hook_or_entity_followup(diag, link_policy)
            if hook_follow:
                return self._set_turn_recommendation(hook_follow, source="hook_followup")
            correction = link_policy.get("last_correction") or mem.last_correction
            if correction and isinstance(correction, dict):
                fact = str(correction.get("corrected") or "").strip()
                if fact:
                    return self._set_turn_recommendation(
                        collapse_to_single_question(
                            pick_varied(ENTITY_APPLY_POOL, self._memory, key=fact)
                        ),
                        source="correction_followup",
                    )
            jumped = self._pick_competency_jump(mem, diag)
            if jumped:
                return jumped
            track_anchor = self._pick_track_aware_anchor(mem)
            return self._set_turn_recommendation(
                track_anchor or anchor,
                source="track_anchor" if track_anchor else "bank",
            )

        if diag.get("is_incomplete_turn") or diag.get("resume_active"):
            return self._set_turn_recommendation(
                "أكيد، خذ راحتك وكمل فكرتك.",
                source="wait_for_completion",
                response_mode=MODE_WAIT,
                question_id=mem.sent_question_id or None,
            )

        guidance_rec = self._pick_guidance_recommendation(diag, mem)
        if guidance_rec is not None:
            return guidance_rec

        clarify_rec = self._pick_clarify_recommendation(diag, mem)
        if clarify_rec is not None:
            return clarify_rec

        if is_open_status(mem.active_question_status):
            locked = self._active_question_locked_pick(diag, mem, link_policy)
            if locked is not None:
                return locked
            if diag.get("is_rich_answer"):
                self._close_active_answered(mem, rich=True)

        if diag.get("is_greeting_or_ready"):
            track_anchor = self._pick_track_aware_anchor(mem)
            return self._set_turn_recommendation(
                track_anchor or anchor,
                source="track_anchor" if track_anchor else "bank",
            )

        meta = diag.get("meta_request")
        if meta == "role_objection":
            return self._set_turn_recommendation(anchor, source="bank")

        if meta == "ask_interviewer":
            return None

        if meta == "clarify_challenge":
            text, src = clarify_challenge_reply(self._domain_pack_key)
            return self._set_turn_recommendation(
                collapse_to_single_question(text),
                source="clarify_challenge",
                clarify_fallback=text,
                clarify_source=src,
                response_mode=MODE_CLARIFY,
            )

        if meta == "clarify_term":
            same = (
                mem.active_question_text
                or mem.last_sample
                or mem.current_topic
                or ""
            ).strip()
            if same:
                clarified, src = self._clarify_for_current_pack(same)
                return self._set_turn_recommendation(
                    collapse_to_single_question(clarified),
                    source="clarify_pack",
                    clarify_fallback=clarified,
                    clarify_source=src,
                    response_mode=MODE_CLARIFY,
                    question_id=mem.sent_question_id or None,
                )
            return self._set_turn_recommendation(anchor, source="bank")

        if self._should_offer_path_step(diag) and not is_open_status(mem.active_question_status):
            path_q = self._pick_path_step_recommendation(mem)
            if path_q:
                mem.pending_path_advance = True
                return self._set_turn_recommendation(
                    path_q,
                    source="path_step",
                    step_key=mem.pending_step_key or None,
                    cluster_key=mem.pending_cluster_key or None,
                    competency_key=mem.pending_competency_key or None,
                    path_key=mem.pending_path_key or None,
                )

        # Depth inside the current competency is budgeted: one follow-up, then
        # the competency engine below moves on. Without this cap the follow-up
        # branches keep re-probing whatever the candidate happened to mention,
        # which is how a single competency ate six of twenty-five questions.
        depth_left = self._competency_followup_budget_left(mem)

        if depth_left and (diag.get("is_rich_answer") or diag.get("suggest_followup")):
            hook_follow = self._pick_hook_or_entity_followup(diag, link_policy)
            if hook_follow:
                return self._set_turn_recommendation(hook_follow, source="hook_followup")

        if depth_left and diag.get("is_rich_answer"):
            allowed = link_policy.get("allowed_link_entities") or []
            if allowed:
                follow = self._find_competency_followup(allowed[0])
                if follow:
                    return self._set_turn_recommendation(
                        collapse_to_single_question(follow),
                        source="competency_followup",
                    )
                return self._set_turn_recommendation(
                    collapse_to_single_question(
                        pick_varied(ENTITY_QUALITY_POOL, self._memory, key=allowed[0])
                    ),
                    source="entity_followup",
                )

        if meta == "intro_self":
            track_anchor = self._pick_track_aware_anchor(mem)
            return self._set_turn_recommendation(
                collapse_to_single_question(
                    track_anchor or anchor or "اذكرلي أهم مشروع اشتغلت عليه وشنو كان دورك بيه؟"
                ),
                source="intro_self",
            )

        # Blueprint competencies drive the interview once the shared anchor
        # backbone is done: every competency gets its own evidence-seeking
        # question, in priority order, exactly once. The bank is demoted to a
        # fallback for depth — it used to be the driver, which is why whole
        # competencies were never asked and the transcript had nothing to score.
        if not self._anchor_intro_pending(mem):
            competency_q = self._pick_next_competency_question(mem)
            if competency_q is not None:
                return competency_q

        result = self._pick_track_aware_anchor(mem) or anchor
        return self._set_turn_recommendation(
            collapse_to_single_question(result) if result else None,
            source="track_anchor" if result else "bank",
        )

    def _ordered_blueprint_competencies(self) -> list[dict[str, Any]]:
        """Blueprint competencies sorted critical → high → medium (stable)."""
        ranked = [
            (
                _COMPETENCY_PRIORITY_RANK.get(
                    str(comp.get("priority") or "high").strip().lower(), 1
                ),
                index,
                comp,
            )
            for index, comp in enumerate(self._blueprint_competencies)
            if isinstance(comp, dict)
        ]
        ranked.sort(key=lambda item: (item[0], item[1]))
        return [comp for _, _, comp in ranked]

    def _competency_question_text(self, comp: dict[str, Any]) -> str:
        """One spoken question that will produce scoreable evidence.

        The blueprint generator emits each ``followUpRules`` entry as a single
        short question, so those are used as-is. Taxonomy fallbacks emit
        instructions instead ("ask for a specific example…"), so those are turned
        into a behavioural probe built from ``questionObjective``/``title`` and
        grounded in the first ``expectedEvidence`` item.
        """
        for rule in comp.get("followUpRules") or comp.get("followUps") or []:
            text = str(rule).strip()
            if text and ("؟" in text or "?" in text):
                return text

        subject = (
            str(comp.get("title") or "").strip()
            or str(comp.get("questionObjective") or comp.get("objective") or "").strip()
        )
        if not subject:
            return ""
        evidence = next(
            (
                str(item).strip()
                for item in (comp.get("expectedEvidence") or comp.get("evidence") or [])
                if str(item).strip()
            ),
            "",
        )
        if evidence:
            return f"احچيلي عن موقف حقيقي يبيّن {subject}، وياريت تذكر {evidence}؟"
        return f"احچيلي عن موقف حقيقي يبيّن {subject}، شنو سويت وشنو كانت النتيجة؟"

    def _anchor_intro_pending(self, mem: InterviewMemory) -> bool:
        """True while the fixed anchor backbone is still being asked."""
        if not self._bank_questions:
            return False
        return mem.anchor_questions_sent < min(
            _anchor_intro_count(), len(self._bank_questions)
        )

    def _competency_followup_budget_left(self, mem: InterviewMemory) -> bool:
        """False once the current competency has had its allowance of depth."""
        ckey = (mem.current_competency_key or "").strip()
        if not ckey:
            return True
        return mem.competency_followup_counts.get(ckey, 0) < _max_followups_per_competency()

    def _pick_next_competency_question(self, mem: InterviewMemory) -> str | None:
        """Primary question driver: ask every blueprint competency once.

        Walks ``self._blueprint_competencies`` in priority order and returns a
        question for the first competency that has not been covered yet, so the
        transcript carries one evidence block per competency — without which the
        Stage-3 scorer falls back to ``insufficient_data`` and a generic score.
        Returns ``None`` when everything is covered; the caller then falls back
        to the question bank for depth.
        """
        for comp in self._ordered_blueprint_competencies():
            ckey = str(comp.get("competencyKey") or comp.get("key") or "").strip()
            if not ckey:
                continue
            if ckey in mem.asked_competency_keys or ckey in mem.rejected_competency_keys:
                continue
            question = self._competency_question_text(comp)
            if not question:
                continue
            mem.current_competency_key = ckey
            mem.pending_competency_key = ckey
            return self._set_turn_recommendation(
                collapse_to_single_question(question),
                source="competency_engine",
                competency_key=ckey,
            )
        return None

    def _wrap_decision_frame(
        self,
        body: str,
        diag: dict[str, Any],
        mem: InterviewMemory,
        link_policy: dict[str, Any],
        recommended: str | None,
    ) -> str:
        turn_state = self._format_turn_state(diag, mem)
        policy_block = self._link_policy_instructions(link_policy)
        parts = [
            f"TURN STATE: {turn_state}",
            policy_block,
            body,
        ]
        if recommended and diag.get("meta_request") != "ask_interviewer":
            single = collapse_to_single_question(recommended)
            parts.append(
                "SINGLE-QUESTION RULE (mandatory): your reply must contain exactly ONE question mark. "
                "Do not add secondary questions with و/وشلون/وكيف.\n"
                "PHRASING RULE: ask in the candidate's language. When it is Arabic, say it in natural spoken "
                "Arabic and translate or gloss any English HR jargon instead of dropping it in raw "
                "(source effectiveness → فعاليّة قنوات الاستقطاب، time-to-fill → مدة شغل الوظيفة، "
                "intake meeting → اجتماع تحديد المتطلبات، scorecard → بطاقة تقييم، boolean search → بحث منطقي، "
                "pipeline → مسار المرشّحين، ATS/HRIS → نظام التوظيف). Keep at most one English term, and only if "
                "you add its Arabic meaning right after. Ask ONE concrete thing.\n"
                "CLARITY RULE: keep it short and answerable in one breath — no throat-clearing, no compound "
                "clauses, no restating the whole competency. If the recommended question probes a skill, ask for "
                "ONE specific real situation from the candidate's own experience "
                "(\"احچيلي عن موقف…\"/\"اعطني مثال محدد…\") instead of a generic \"شنو تسوي عادة\"; if it is a "
                "short follow-up, keep it short. A brief warm lead-in (\"زين،\"/\"تمام،\") is welcome, but never "
                "a second question.\n"
                f'Recommended question (rephrase into natural language per the rules; ONE question only): "{single[:300]}"'
            )
        elif diag.get("meta_request") == "ask_interviewer":
            parts.append(
                "MANDATORY IDENTITY REPLY (this turn ONLY — zero interview questions, zero question marks): "
                f'"{self._canned_identity_reply("")}"'
            )
        return "\n\n".join(parts)

    def _apply_entity_policy(self, text: str, diag: dict[str, Any]) -> dict[str, Any]:
        mem = self._memory
        norm = normalize_text(text)
        entities = extract_candidate_entities(text, self._role_glossary)
        speech_hooks = extract_speech_hooks(text)

        if diag.get("is_topic_change_request"):
            remainder = strip_topic_change_phrases(text)
            if remainder:
                speech_hooks = list(
                    dict.fromkeys([*speech_hooks, *extract_speech_hooks(remainder)])
                )
                entities = list(
                    dict.fromkeys(
                        [*entities, *extract_candidate_entities(remainder, self._role_glossary)]
                    )
                )

        correction: CandidateCorrection | None = detect_tool_correction(
            norm, text, self._role_glossary
        )

        if correction:
            mem.rejected_entities.add(correction.incorrect_assumption)
            mem.last_correction = {
                "incorrect": correction.incorrect_assumption,
                "corrected": correction.corrected_fact,
            }
            if correction.corrected_fact not in entities:
                entities.append(correction.corrected_fact)

        if speech_hooks:
            entities = list(dict.fromkeys([*entities, *speech_hooks]))
            if not diag.get("is_substantive_answer"):
                diag = dict(diag)
                diag["is_substantive_answer"] = True
            if diag.get("is_topic_change_request"):
                diag = dict(diag)
                diag["honor_skip_content"] = True

        if diag.get("is_substantive_answer"):
            mem.session_entities.update(entities)
            mem.session_entities.update(speech_hooks)
            self._update_experience_track(text)

        if diag.get("is_topic_change_request") or diag.get("meta_request") == "role_objection":
            if mem.current_topic:
                mem.rejected_topics.add(mem.current_topic)

        link_policy = compute_link_policy(
            entities_in_message=entities,
            glossary=self._role_glossary,
            rejected_entities=mem.rejected_entities,
            is_greeting_or_ready=bool(diag.get("is_greeting_or_ready")),
            is_substantive=bool(diag.get("is_substantive_answer")),
            correction=correction,
        )
        out = dict(diag)
        out["link_policy"] = link_policy
        out["entities_in_message"] = entities
        out["speech_hooks"] = speech_hooks
        return out

    def _pick_next_bank_anchor(self, recent: list[str] | None = None) -> str | None:
        mem = self._memory
        used = mem.asked_question_keys
        pack = self._domain_pack_key or "default"
        for i, q in enumerate(self._bank_questions):
            key = normalize_text(q)
            if not key or key in used:
                continue
            bank_id = make_bank_question_id(pack, key[:80])
            if bank_id in mem.closed_question_ids or bank_id in mem.sent_question_guard:
                continue
            # Skip a bank question that is a near-duplicate of a recent one —
            # lexically OR by HR topic — since the bank clusters several
            # questions per topic, so the plain unused-key check alone still
            # surfaced repeats.
            if recent and (
                is_semantic_duplicate_question(q, recent) or is_topic_repeat(q, recent)
            ):
                continue
            mem.bank_cursor = i
            return collapse_to_single_question(q.strip())
        return None

    def record_agent_reply(self, text: str) -> None:
        """Record assistant turn for loop prevention (called after TTS text is finalized)."""
        mem = self._memory
        plan = self._turn_plan
        guarded = enforce_single_question_response(text, plan)
        mem.record_question(guarded)

        if not plan:
            return

        mode = plan.response_mode or MODE_ASK
        question_text = extract_primary_question(guarded) or (plan.question or guarded).strip()

        # Consecutive "go on…" nudge counter: increments on WAIT, resets on any
        # other turn. Read by the wait cap so short answers don't loop forever.
        mem.consecutive_wait_count = (
            mem.consecutive_wait_count + 1 if mode == MODE_WAIT else 0
        )

        # Track the opener signature of any turn that actually asked a question
        # (WAIT/ACK/RESUME strip their question marks, so they never record).
        if count_question_marks(guarded) >= 1:
            mem.record_opener_stem(_question_stem(question_text))
            # Remember the last real question so we never re-ask it verbatim.
            if mode in (MODE_ASK, MODE_FOLLOW_UP):
                mem.last_sent_question_norm = normalize_text(question_text)
            # Any question that is not a fresh competency ask spends depth on the
            # competency currently on the table, so the picker advances instead
            # of re-probing the same theme for a third of the interview.
            if (
                mode != MODE_WAIT
                and plan.source != "competency_engine"
                and mem.current_competency_key
            ):
                spent = mem.current_competency_key
                mem.competency_followup_counts[spent] = (
                    mem.competency_followup_counts.get(spent, 0) + 1
                )

        if mode == MODE_WAIT:
            if mem.active_question_status in (STATUS_ANSWERING, STATUS_CLARIFYING):
                mem.active_question_status = STATUS_AWAITING_ANSWER
            return

        if mode in (MODE_CLARIFY, MODE_FOLLOW_UP, MODE_RESUME, MODE_GUIDANCE):
            if question_text:
                mem.active_question_text = question_text
            if mode == MODE_FOLLOW_UP and plan.parent_question_id:
                mem.parent_question_id = plan.parent_question_id
                if plan.question_id:
                    mem.sent_question_id = plan.question_id
            mem.active_question_status = STATUS_AWAITING_ANSWER
            if plan.question:
                mem.last_sample = plan.question
                mem.current_topic = plan.question
            return

        if mem.active_question_status in (STATUS_ANSWERED, STATUS_REJECTED):
            if plan.advance_path_on_send:
                mem.path_cursor += 1
                mem.pending_path_advance = False

        if question_text:
            mem.active_question_text = question_text
        mem.sent_question_id = (plan.question_id or "").strip()
        mem.parent_question_id = (plan.parent_question_id or "").strip()
        # Loop guard: register the question the moment it is SENT — decoupled from
        # answer quality / open status. Previously an anchor was only recorded on
        # the next turn, and only when the question had closed; a run of short
        # answers left it "open" and eligible, so the picker looped back to the
        # first anchor. Register the raw recommended-question key + its id now.
        if plan.source in ("bank", "track_anchor", "path_step", "competency_jump"):
            if plan.question:
                sent_key = normalize_text(plan.question)
                if sent_key:
                    mem.asked_question_keys.add(sent_key)
            if plan.question_id:
                mem.sent_question_guard.add(plan.question_id)
        if plan.source in ("bank", "track_anchor") and count_question_marks(guarded) >= 1:
            mem.anchor_questions_sent += 1
        # Mark a competency covered the moment it is ASKED (any source, not just
        # the coverage floor), so it is never re-served as a new question later —
        # the main cause of repeated same-competency questions after the candidate
        # skips. Follow-up/clarify stay on the already-active competency, so they
        # must not (re)mark here; the picker skips asked_competency_keys.
        if (
            plan.competency_key
            and count_question_marks(guarded) >= 1
            and mode not in (MODE_FOLLOW_UP, MODE_CLARIFY)
        ):
            mem.asked_competency_keys.add(plan.competency_key)
        if plan.step_key:
            mem.pending_step_key = plan.step_key
        if plan.cluster_key:
            mem.pending_cluster_key = plan.cluster_key
        if plan.competency_key:
            mem.pending_competency_key = plan.competency_key
            mem.current_competency_key = plan.competency_key
        if plan.path_key:
            mem.pending_path_key = plan.path_key
        mem.active_question_status = STATUS_AWAITING_ANSWER
        if plan.question:
            mem.last_sample = plan.question
            mem.current_topic = plan.question

    def _memory_context_block(self, diag: dict[str, Any]) -> str:
        mem = self._memory
        topic = mem.current_topic or "(open — pick a fresh topic)"
        last_sample = mem.last_sample or "(none yet)"
        already_asked = ", ".join(sorted(mem.asked_topics)) or "(none yet)"
        followups_here = mem.followups_for(mem.current_topic)
        max_followups = _max_followups_per_topic()
        lang_line = self._reply_language_directive()
        role_line = (
            f"Role: {self._position}." if self._position else "Role: (unspecified)."
        )
        bank_line = (
            f"Bank key: {self._bank_key} ({len(self._bank_questions)} sample question(s) available)."
            if self._bank_questions
            else "Bank: none — improvise topics adaptively."
        )
        snippet = (mem.last_candidate_snippet or "").strip()
        cand_line = ""
        if snippet and diag.get("is_substantive_answer"):
            cand_line = (
                f"Candidate's last substantive answer (link ONLY to words they actually said): "
                f"\"{snippet[:240]}\""
            )
        elif diag.get("is_greeting_or_ready"):
            cand_line = (
                "Candidate's last message was only a greeting or readiness signal — "
                "do NOT say they mentioned any tool or topic. Ask a fresh open question."
            )
        domain_line = (
            "Domain guidance: active — prioritize technical/domain probes from session instructions."
            if self._has_domain_guidance
            else ""
        )
        people_line = (
            "Role is people/HR-focused — soft-skills questions are allowed when relevant."
            if self._role_is_people_focused
            else "Role is NOT HR-focused — avoid generic team/conflict HR questions unless the candidate raised them."
        )
        lines = [
            lang_line,
            role_line,
            bank_line,
            people_line,
            domain_line,
            f"Current topic: {topic}",
            f"Last sample question used: \"{last_sample}\"",
            f"Topics already covered: {already_asked}",
            f"Follow-ups asked on current topic: {followups_here} (max {max_followups}).",
            self._format_asked_questions_line(),
            self._suggest_next_anchor_line(),
        ]
        if cand_line:
            lines.append(cand_line)
        return "\n".join(line for line in lines if line)

    def _build_decision_frame(self, diag: dict[str, Any]) -> str | None:
        """Compose a contextual system message that frames the LLM's next action."""
        if diag.get("disabled"):
            return None

        mem = self._memory
        max_followups = _max_followups_per_topic()
        unsure_threshold = _unsure_pivot_threshold()
        ctx_block = self._memory_context_block(diag)
        link_policy = diag.get("link_policy") or {}
        recommended = self._pick_recommended_question(diag, mem, link_policy)
        body: str | None = None

        if diag.get("is_topic_change_request"):
            extra = ""
            if diag.get("honor_skip_content") or diag.get("speech_hooks"):
                hooks = ", ".join(diag.get("speech_hooks") or [])
                extra = (
                    " The candidate asked to skip BUT named concrete channels/tools in the "
                    "same message"
                    + (f" ({hooks})" if hooks else "")
                    + " — acknowledge the skip briefly, then ask ONE follow-up about what "
                    "they named (recommended question). Do NOT jump to an unrelated bank anchor "
                    "until you honour that detail."
                )
            elif diag.get("is_substantive_answer"):
                extra = (
                    " The candidate also shared a correction or detail in the same message — "
                    "honour it (e.g. if they said GPS not Total Station, ask about GPS only)."
                )
            body = (
                f"{ctx_block}\n\n"
                "The candidate explicitly asked to change/skip the current question.\n"
                f"Action: acknowledge briefly (one short clause, e.g. ماكو مشكلة), then ask a "
                "DIFFERENT competency from the recommended question — not a rephrased STAR step "
                "(problem/action/result on the same project). "
                "never repeat anything in the 'already asked' list. Do not insist on the previous topic. "
                "Do NOT attribute blueprint tools unless they appear in allowed_link_entities."
                f"{extra}"
                " Do not start with 'thank you'."
            )
        elif diag.get("meta_request") == "role_objection":
            body = (
                f"{ctx_block}\n\n"
                "The candidate says this question is not relevant to their role.\n"
                "Action: acknowledge briefly (one clause — do NOT lecture that the topic is still important). "
                "Immediately pivot to a technical/role-specific question from the recommended question or domain guidance. "
                "Do not ask another soft-skills or team-management question."
            )
        elif diag.get("meta_request") == "ask_interviewer":
            canned = self._canned_identity_reply("")
            body = (
                f"{ctx_block}\n\n"
                "The candidate asked who YOU are / wants YOU to introduce yourself "
                "(e.g. «عرفيني عن نفسك»، «من أنت؟»، «تعرفنا على حضرتك») — "
                "they are NOT asking to describe their own CV.\n"
                f'Action: reply with identity ONLY — exactly: "{canned}"\n'
                "Do NOT ask any interview, technical, or assessment question this turn. "
                "No question marks. Do NOT describe your own professional background in the role being assessed."
            )
        elif diag.get("meta_request") == "intro_self":
            body = (
                f"{ctx_block}\n\n"
                "The candidate asked to talk about themselves / wants an intro-style question.\n"
                "Action: ask ONE open question about their own experience on this role — a real project, "
                "field, achievement, or scope they are proud of. Do NOT ask a generic skills-assessment question. "
                "Do NOT describe your own experience as the interviewer."
            )
        elif diag.get("meta_request") == "clarify_term" or diag.get("is_ambiguous_clarify"):
            body = (
                f"{ctx_block}\n\n"
                "The candidate asked for clarification of your question or a term.\n"
                "STRICT CLARIFY LOCK: explain the SAME question in plain language with ONE "
                "concrete everyday example, then ask the recommended simplified question. "
                "Exactly ONE question mark in your reply. "
                "FORBIDDEN: ATS, candidate pipeline, new topics, second questions, pivoting away. "
                "Do NOT repeat the previous question verbatim."
                f"{self._forbidden_domain_hint()}"
            )
        elif diag.get("is_ask_for_guidance"):
            body = (
                f"{ctx_block}\n\n"
                "The candidate is asking for guidance or best practice — NOT skipping the question.\n"
                "Action: give ONE short practical guidance sentence (2 short clauses max), then ask "
                "the recommended bridge question to return to the interview. "
                "Exactly ONE question mark total. "
                "Do NOT jump to ATS, pipeline, or a brand-new interview topic. "
                "Stay on the current question context."
            )
        elif diag.get("meta_request") == "clarify_challenge":
            body = (
                f"{ctx_block}\n\n"
                "The candidate rejected your previous clarification as unrelated to their field.\n"
                "Action: apologize briefly, self-correct with domain-appropriate examples only, "
                "then ask the recommended question. Same topic — do NOT pivot away."
                f"{self._forbidden_domain_hint()}"
            )
        elif diag.get("is_incomplete_turn"):
            body = (
                f"{ctx_block}\n\n"
                "The candidate's message is unfinished or they asked for time to continue.\n"
                'Action: reply ONLY with encouragement to continue — use the recommended line '
                '("أكيد، خذ راحتك وكمل فكرتك."). Do NOT ask a new interview question. '
                "No question marks. Do NOT advance to a new topic."
            )
        elif diag.get("is_rich_answer"):
            allowed = link_policy.get("allowed_link_entities") or []
            echo_line = ""
            if allowed:
                echo_line = (
                    f" You MAY open with a brief 2-4 word reflection of \"{allowed[0]}\" "
                    "ONLY if it connects naturally to your question; otherwise ask directly. "
                    "Vary the wording — do not open with \"بخصوص\" every time."
                )
            body = (
                f"{ctx_block}\n\n"
                "The candidate gave a substantive answer with concrete details they actually said.\n"
                "Action: ask ONE follow-up from the recommended question — reference ONLY "
                "allowed_link_entities or speech_hooks. "
                "If they named LinkedIn, Telegram, referrals, or similar channels, follow up on "
                "that channel — do not jump to an unrelated generic topic."
                f"{echo_line}"
            )
        elif diag.get("is_greeting_or_ready"):
            body = (
                f"{ctx_block}\n\n"
                "The candidate only greeted or confirmed they are ready — no experience shared yet.\n"
                "Action: ask ONE open question from the recommended question (rephrase naturally). "
                "Do NOT use attribution phrases or imply they mentioned any tool, skill, or project."
            )
        elif diag.get("is_unsure"):
            if mem.consecutive_unsure + 1 >= unsure_threshold:
                body = (
                    f"{ctx_block}\n\n"
                    f"The candidate has been unsure {mem.consecutive_unsure + 1} time(s) in a row. "
                    "Do NOT rephrase the same topic again.\n"
                    "Choose ONE:\n"
                    "  1) Acknowledge gently, then pivot to a different, simpler topic from the bank or improvise.\n"
                    "  2) Ask a concrete experience-based question (e.g. 'tell me about a time when…') on a new topic.\n"
                    "Constraint: do not stay on the current topic; do not give another long example."
                )
            else:
                body = (
                    f"{ctx_block}\n\n"
                    "The candidate seems unsure about the current question.\n"
                    "Choose ONE:\n"
                    "  1) Rephrase the same question in one short, simpler sentence and offer a concrete example.\n"
                    "  2) Switch to an easier sub-aspect of the same topic.\n"
                    "Constraint: do not move to a brand-new topic yet; one short clarifying nudge."
                )
        elif diag.get("suggest_followup"):
            length = int(diag.get("length", 0))
            followups_here = mem.followups_for(mem.current_topic)
            if followups_here >= max_followups:
                body = (
                    f"{ctx_block}\n\n"
                    f"Answer is brief ({length} chars) and you have already asked "
                    f"{followups_here} follow-up(s) on this topic (max reached).\n"
                    "Choose ONE:\n"
                    "  1) Briefly acknowledge, then move to a different topic — prefer one NOT already covered.\n"
                    "  2) If the candidate clearly has nothing to add, transition naturally to a new topic from the bank.\n"
                    "Constraint: do NOT ask another follow-up on the current topic."
                )
            else:
                body = (
                    f"{ctx_block}\n\n"
                    f"Answer is brief ({length} chars). You have not asked a follow-up on this topic yet.\n"
                    "Choose ONE:\n"
                    "  1) Ask a probing follow-up that digs into a specific detail of their answer.\n"
                    "  2) Briefly acknowledge, then ask about a fresh sub-aspect of the same topic.\n"
                    "  3) If the topic is already exhausted, move to a different topic.\n"
                    "Constraint: do not repeat the exact same question; do not advance without depth unless option 3."
                )
        else:
            body = (
                f"{ctx_block}\n\n"
                "Continue the interview naturally. Ask ONE fresh question — prefer the recommended question "
                "or a domain-specific probe. Never repeat questions from the 'already asked' list. "
                "Do NOT attribute blueprint tools unless they appear in allowed_link_entities."
            )

        return self._wrap_decision_frame(body, diag, mem, link_policy, recommended)

    def _infer_action_from_frame(self, diag: dict[str, Any]) -> str:
        mem = self._memory
        if diag.get("is_topic_change_request") or diag.get("explicit_question_reject"):
            if diag.get("honor_skip_content"):
                return "honor_skip_content"
            return "acknowledged_skip"
        if diag.get("is_ask_for_guidance"):
            return "offer_guidance"
        if diag.get("resume_active"):
            return "wait_for_completion"
        if diag.get("is_incomplete_turn") or diag.get("is_answer_in_progress"):
            return "wait_for_completion"
        if diag.get("is_greeting_or_ready"):
            return "advance"
        meta = diag.get("meta_request")
        if meta == "ask_interviewer":
            return "identity_reply"
        if meta in ("role_objection", "intro_self"):
            return "acknowledged_skip"
        if meta in ("clarify_term", "clarify_challenge") or diag.get("is_ambiguous_clarify"):
            return "rephrase"
        if diag.get("is_story_starter") and is_open_status(mem.active_question_status):
            return "follow_up_on_active"
        if is_open_status(mem.active_question_status) and (
            diag.get("is_rich_answer")
            or (
                diag.get("is_substantive_answer")
                and diag.get("length", 0) >= 45
                and not diag.get("is_incomplete_turn")
                and not diag.get("is_answer_in_progress")
                and not diag.get("is_shallow")
            )
        ):
            return "close_active_answered"
        if diag.get("is_rich_answer"):
            return "follow_up"
        if diag.get("is_unsure"):
            if mem.consecutive_unsure + 1 >= _unsure_pivot_threshold():
                return "pivot_unsure"
            return "rephrase"
        if diag.get("suggest_followup"):
            if is_open_status(mem.active_question_status):
                return "follow_up_on_active"
            if mem.followups_for(mem.current_topic) >= _max_followups_per_topic():
                return "advance_after_loop_guard"
            return "follow_up"
        return "advance"

    def _assign_next_topic(self, mem: InterviewMemory) -> None:
        nxt = self._pick_next_bank_anchor()
        if nxt:
            mem.current_topic = nxt
            mem.last_sample = nxt
            key = normalize_text(nxt)
            if key:
                mem.asked_question_keys.add(key)
        else:
            mem.current_topic = ""
            mem.last_sample = ""

    def _update_memory_post_decision(self, diag: dict[str, Any], action: str) -> None:
        mem = self._memory
        mem.turn_index += 1
        open_q = is_open_status(mem.active_question_status)

        if diag.get("is_unsure"):
            mem.consecutive_unsure += 1
        else:
            mem.consecutive_unsure = 0

        if action == "close_active_answered":
            self._close_active_answered(mem, rich=bool(diag.get("is_rich_answer")))
        elif action == "follow_up_on_active":
            if not mem.current_topic and mem.active_question_text:
                mem.current_topic = mem.active_question_text
            mem.bump_followup(mem.current_topic or mem.active_question_text)
        elif action == "offer_guidance":
            pass
        elif action == "follow_up":
            if not mem.current_topic:
                self._assign_next_topic(mem)
            mem.bump_followup(mem.current_topic)
        elif action == "honor_skip_content":
            if not mem.current_topic:
                self._assign_next_topic(mem)
            mem.bump_followup(mem.current_topic)
        elif action in ("acknowledged_skip", "pivot_unsure", "advance", "advance_after_loop_guard"):
            if not open_q:
                if mem.pending_path_advance:
                    mem.path_cursor += 1
                    mem.pending_path_advance = False
                if mem.current_competency_key:
                    mem.asked_competency_keys.add(mem.current_competency_key)
                if mem.current_topic:
                    mem.mark_topic_asked(mem.current_topic)
                    key = normalize_text(mem.current_topic)
                    if key:
                        mem.asked_question_keys.add(key)
                rec = (self._turn_recommended or "").strip()
                if rec and self._turn_recommended_source in (
                    "competency_jump",
                    "path_step",
                    "clarify_pack",
                    "clarify_challenge",
                    "track_anchor",
                    "bank",
                ):
                    mem.current_topic = rec
                    mem.last_sample = rec
                else:
                    self._assign_next_topic(mem)
        elif action == "wait_for_completion":
            pass
        elif action == "rephrase":
            if not mem.current_topic and mem.active_question_text:
                mem.current_topic = mem.active_question_text
        elif action == "identity_reply":
            pass

        mem.last_action = action

    def _canned_identity_reply(self, user_text: str) -> str:
        custom_ar = (os.getenv("INTERVIEW_IDENTITY_REPLY_AR") or "").strip()
        custom_en = (os.getenv("INTERVIEW_IDENTITY_REPLY_EN") or "").strip()
        lang = detect_lang_from_text(user_text) or self._tts_router.last_user_lang or "ar"
        if lang == "en":
            return custom_en or _IDENTITY_REPLY_EN
        return custom_ar or _IDENTITY_REPLY_AR

    async def _deliver_canned_identity_reply(self, user_text: str) -> None:
        """Bypass LLM — fixed identity script via TTS only."""
        reply = self._canned_identity_reply(user_text)
        self.record_agent_reply(reply)
        mem = self._memory
        mem.turn_index += 1
        mem.last_action = "identity_reply"
        allow = (
            self.allow_interruptions
            if self.allow_interruptions is not None
            else env_allow_interruption()
        )
        await self.session.say(reply, allow_interruptions=allow)
        logger.info("identity_reply | canned path | reply=%r", reply)

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage
    ) -> None:
        """Inject a contextual decision-frame system message before the LLM responds.

        Runs after STT-final, before LLM generation. Pure heuristics — sub-millisecond.

        Even when no heuristic-driven decision frame fires (natural advance), we still
        inject a single-line reply-language directive so the LLM does not regress to the
        bank language after the candidate has switched (e.g. EN -> AR or vice-versa).
        """
        if self._heuristics_disabled:
            return
        try:
            text = ""
            tc = getattr(new_message, "text_content", None)
            if callable(tc):
                text = tc() or ""
            else:
                content = getattr(new_message, "content", None)
                if isinstance(content, list):
                    text = " ".join(str(c) for c in content if isinstance(c, str))
                elif isinstance(content, str):
                    text = content

            try:
                intent = detect_language_switch_intent(text)
                if intent and intent != self._locked_lang:
                    self._locked_lang = intent
                    self._tts_router.last_user_lang = intent
                    try:
                        self._tts_router.apply(intent, force=True, source="explicit_switch")
                    except Exception as ex:
                        logger.debug("explicit_switch tts_router.apply failed: %s", ex)
                    logger.info(
                        "language_lock | locked=%s reason=explicit_user_request text=%r",
                        intent,
                        text[:80],
                    )
            except Exception as ex:
                logger.debug("language switch intent detection failed: %s", ex)

            try:
                detected_now = detect_lang_from_text(text) or detect_lang_reply_fallback(text)
                if detected_now:
                    self._tts_router.last_user_lang = detected_now
            except Exception:
                pass

            mem = self._memory
            # Interview already closed: the deterministic wrap-up has sent the final
            # closing line ("the HR team will review your answers and contact you")
            # and teardown is scheduled. A later candidate turn — a goodbye, a stray
            # add-on — must NOT spawn another question, otherwise the agent asks one
            # more competency question AFTER the close while the room is still winding
            # down (observed on real interviews). Stay silent until teardown.
            if mem.final_closing_sent:
                logger.info("post-closing user turn → staying silent (interview concluded)")
                raise StopResponse()
            diag = analyze_user_answer(
                text,
                active_question_text=mem.active_question_text,
                active_question_status=mem.active_question_status,
            )
            diag = self._apply_entity_policy(text, diag)
            self._apply_active_question_user_signals(mem, diag)

            self._turn_cross_domain_guard = "pass"
            self._turn_recommended = None
            self._turn_recommended_source = ""
            self._turn_clarify_fallback = None
            self._turn_clarify_source = ""
            self._turn_plan = None

            if diag.get("meta_request") == "ask_interviewer":
                await self._deliver_canned_identity_reply(text)
                raise StopResponse()

            if diag.get("is_substantive_answer"):
                mem.last_candidate_snippet = text.strip()[:400]
            elif diag.get("is_greeting_or_ready"):
                mem.last_candidate_snippet = ""

            frame = self._build_decision_frame(diag)
            action = self._infer_action_from_frame(diag)

            # Candidate is still mid-answer (incomplete / resume). Do NOT speak a
            # "take your time, go on…" nudge — it fires on a pause and talks OVER
            # them, i.e. interrupts. Stay silent and let them finish; their next
            # words open a fresh turn. (Replaces the CONTINUATION_POOL nudges;
            # restore the old spoken nudge with INTERVIEW_WAIT_NUDGE=true.)
            # The planned turn is checked too, not just the inferred action: the
            # active-question path can emit a MODE_WAIT nudge on turns whose
            # action is "rephrase"/"advance", and those were slipping through.
            planned_wait = bool(
                self._turn_plan and self._turn_plan.response_mode == MODE_WAIT
            )
            if (
                action == "wait_for_completion" or planned_wait
            ) and not interview_wait_nudge_enabled():
                self._update_memory_post_decision(diag, action)
                logger.info("wait_for_completion → staying silent (continuation nudge suppressed)")
                raise StopResponse()

            if frame:
                turn_ctx.add_message(role="system", content=frame)
            else:
                turn_ctx.add_message(
                    role="system",
                    content=(
                        f"{self._reply_language_directive()}\n"
                        f"{self._format_asked_questions_line()}"
                    ),
                )

            logger.info(
                "decision_frame | turn=%s diag=%s link_policy=%s recommended=%r memory=%s action=%s frame=%s",
                self._memory.turn_index + 1,
                {k: v for k, v in diag.items() if k not in ("disabled", "link_policy")},
                diag.get("link_policy"),
                self._pick_recommended_question(
                    diag, self._memory, diag.get("link_policy") or {}
                ),
                self._memory.snapshot(),
                action,
                "yes" if frame else "no",
            )
            self._update_memory_post_decision(diag, action)
        except StopResponse:
            # Control-flow signal (identity reply / silent wait) — must reach the
            # framework so the LLM turn is actually suppressed, not swallowed here.
            raise
        except Exception as ex:
            logger.warning("on_user_turn_completed heuristic failed: %s", ex, exc_info=True)

    async def stt_node(
        self,
        audio: AsyncIterable[rtc.AudioFrame],
        model_settings: ModelSettings,
    ) -> AsyncIterable[agents_stt.SpeechEvent | str]:
        """Drop stray final transcripts (lone digits/symbols) before turn detection.

        Speechmatics, biased by the large bilingual ``additional_vocab``, occasionally
        emits a final segment containing only noise (e.g. "2") on a pause. That stray
        token makes the turn look incomplete and delays end-of-utterance until the user
        speaks again. We suppress only segments that are *entirely* stray; mixed segments
        with real words pass through untouched. Disable with INTERVIEW_FILTER_STRAY_TOKENS=false.
        """
        base = Agent.default.stt_node(self, audio, model_settings)
        if base is None or not _filter_stray_tokens_enabled():
            if base is not None:
                async for ev in base:
                    yield ev
            return
        filtered = (
            agents_stt.SpeechEventType.FINAL_TRANSCRIPT,
            agents_stt.SpeechEventType.INTERIM_TRANSCRIPT,
        )
        async for ev in base:
            if isinstance(ev, agents_stt.SpeechEvent) and ev.type in filtered:
                alts = getattr(ev, "alternatives", None) or []
                text = (alts[0].text if alts else "") or ""
                if _is_stray_stt_text(text):
                    logger.debug("stt_node: dropped stray token %r", text[:40])
                    continue
            yield ev

    async def transcription_node(
        self,
        text: AsyncIterable[str | TimedString],
        model_settings: ModelSettings,
    ) -> AsyncIterable[str | TimedString]:
        """Forward LLM/TTS text chunks to the room for real-time CHAT (default: streaming).

        The frontend renders assistant partials in one live bubble, then replaces with the final.
        Set ``INTERVIEW_TRANSCRIPT_STREAMING=false`` to emit a single segment per turn (less
        real-time feel; legacy mode before the CHAT live-caption UI).
        """
        if os.getenv("INTERVIEW_TRANSCRIPT_STREAMING", "true").lower() not in (
            "0",
            "false",
            "no",
        ):
            parts: list[str] = []
            async for item in Agent.default.transcription_node(self, text, model_settings):
                parts.append(str(item))
                yield item
            full = "".join(parts).strip()
            if full:
                guarded = self._apply_guard_to_agent_text(full)
                self.record_agent_reply(guarded)
            return

        parts: list[str] = []
        async for delta in text:
            parts.append(str(delta))
        full = "".join(parts).strip()
        if not full:
            return
        collapsed = " ".join(full.split())
        guarded = self._apply_guard_to_agent_text(collapsed)
        self.record_agent_reply(guarded)
        yield guarded

    @staticmethod
    async def _prefetch_text_for_lang(text: AsyncIterable[str]) -> tuple[str, AsyncIterable[str]]:
        chunks: list[str] = []
        agen = text.__aiter__()
        combined = ""
        max_prefetch = tts_reply_prefetch_max_chars()
        try:
            while len(combined) < max_prefetch:
                try:
                    chunk = await agen.__anext__()
                except StopAsyncIteration:
                    break
                chunks.append(chunk)
                combined = "".join(chunks)
                # IMPORTANT: break only on PRIMARY detector, not fallback.
                # Fallback can fire on short latin-only prefixes (e.g. "HR", "Excel")
                # before the Arabic part of the same sentence arrives, which used to
                # flip the TTS voice to English mid-reply.
                if detect_lang_from_text(combined):
                    break
        except StopAsyncIteration:
            pass

        async def _replay() -> AsyncIterable[str]:
            for c in chunks:
                yield c
            async for rest in agen:
                yield rest

        return combined, _replay()

    async def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        buffered: list[str] = []
        async for chunk in text:
            buffered.append(str(chunk))
        raw_combined = "".join(buffered).strip()
        if raw_combined:
            guarded = self._apply_guard_to_agent_text(raw_combined)

            async def _guarded_text() -> AsyncIterable[str]:
                yield guarded

            text = _guarded_text()
            # If the guard just emitted the deterministic final closing, tear the
            # session down after this closing plays (the model won't call
            # end_interview because the guard replaced its turn).
            self._schedule_conclude_after_reply()

        # Route to user's language before streaming LLM tokens — aligns with LiveKit "match reply to user" flow
        # and avoids waiting for prefetch to infer language (reduces avatar lip/audio desync on switch).
        # Locked language (explicit user request) wins over the last-utterance hint.
        hint: str | None = None
        hint_applied = False
        if self._locked_lang in ("ar", "en"):
            hint = self._locked_lang
            self._tts_router.apply(hint, force=True, source="locked_lang")
            hint_applied = True
        elif os.getenv("TTS_USE_LAST_USER_LANG_HINT", "true").lower() in ("1", "true", "yes"):
            hint = self._tts_router.last_user_lang
            if hint in ("ar", "en"):
                self._tts_router.apply(hint, force=True, source="user_lang_hint")
                hint_applied = True

        if os.getenv("AVATAR_SKIP_PREFETCH_WHEN_ROUTED", "true").lower() in (
            "1",
            "true",
            "yes",
        ) and tts_router_aligned_with_stream(self._tts_router) and not hint_applied:
            # Safe fast-path only when routing is already aligned WITHOUT applying a fresh
            # user-language hint this turn. Fresh hints can be stale (previous turn EN, new
            # reply AR), and skipping prefetch in that case caused wrong voice selection.
            async for frame in Agent.default.tts_node(self, text, model_settings):
                yield frame
            return

        combined, merged = await self._prefetch_text_for_lang(text)
        detected_primary = detect_lang_from_text(combined)
        detected_fallback = detect_lang_reply_fallback(combined)
        detected = detected_primary or detected_fallback
        # While the language is explicitly locked, never let detector noise on the
        # reply text override the locked voice — even if the LLM accidentally
        # produced a sentence in the other language.
        if self._locked_lang in ("ar", "en"):
            detected = self._locked_lang
        if detected:
            # Guard against accidental AR->EN flips on mixed-script Arabic replies.
            # Only allow overriding a known Arabic hint with English when the primary
            # detector (not fallback) says EN and we have enough prefetched text.
            min_switch_chars_raw = (os.getenv("TTS_REPLY_EN_SWITCH_MIN_CHARS") or "").strip()
            try:
                min_switch_chars = int(min_switch_chars_raw) if min_switch_chars_raw else 18
            except ValueError:
                min_switch_chars = 18
            min_switch_chars = max(6, min(128, min_switch_chars))

            if hint == "ar" and detected == "en":
                if detected_primary != "en":
                    logger.debug(
                        "TTS reply routing: keep AR voice (fallback-only EN detect, text=%r)",
                        combined[:80],
                    )
                    detected = "ar"
                elif len(combined) < min_switch_chars:
                    logger.debug(
                        "TTS reply routing: defer EN switch (%d < min %d chars, text=%r)",
                        len(combined),
                        min_switch_chars,
                        combined[:80],
                    )
                    detected = "ar"

            self._tts_router.apply(detected, force=True, source="reply")
        async for frame in Agent.default.tts_node(self, merged, model_settings):
            yield frame
