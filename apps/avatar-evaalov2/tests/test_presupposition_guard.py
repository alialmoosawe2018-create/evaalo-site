"""The agent must not ask about something the candidate never said they did.

Observed twice in production, verbatim the same invented question:

  exec 1783, turn [13]  «زين، شنو كانت قراءة bottomhole pressure وقت اتخاذ القرار اللي اتخذته؟»
  session 6aa1bfa0, [15] «تمام، اذكرلي شنو كانت قراءة bottomhole pressure وقت اتخاذ القرار؟»

Neither candidate had described a decision. The first had said the opposite
twice — «لا تعتمد على شخص معين. تعتمد على فريق كامل» and «ويتم اتخاذ القرار من
فريق كامل» — and the second had just said «صراحة ما عندي خبرة قوية بالهندسه
النفط» and «الأكاديمية أكثر».

It is not a bank template: "bottomhole" appears zero times in
`data/interview_questions.json`. The model generates it.

The prompt already forbids this (assistant.py: "NEVER attribute a tool, skill,
project, or term ... as if the candidate said it"), and the model does it anyway
— exactly as it ignores the opener-variety rule and opens 70-87% of turns with
«زين». So the enforcement has to be deterministic, like the cross-domain and
repetition guards it sits beside.

The cost is real: the only question in exec 1783 that demanded a measurement was
the fabricated one, and `reservoir_and_well_fundamentals` scored 1 of 5 with the
red flag «يعطي وصف غامض بدون أرقام أو قياسات بئر».
"""

from __future__ import annotations

from voice_interview.presupposition_guard import presupposes_unstated_act


# ── the two real failures ────────────────────────────────────────────────────

def test_the_1783_hallucination_is_caught():
    turns = [
        "إبرة العملية. اشتغلت في عدة شركات. شركات.",
        "في قطاعات مختلفة. القطاعات الحكومية والقطاع الخاص. اكثر شي خبرة ميدانية.",
        "قراءة بيانات. بئر. معين. لا تعتمد على شخص معين. تعتمد على فريق كامل.",
        "جزء معين. ويتم اتخاذ القرار من فريق كامل. فريق متكامل.",
        "طبعا. أشوف أكثر شي. المحاكاة قريبة لي.",
    ]
    # He narrated a past act («اشتغلت») but never «اتخذت» — the presupposed verb.
    assert presupposes_unstated_act(
        "زين، شنو كانت قراءة bottomhole pressure وقت اتخاذ القرار اللي اتخذته؟", turns
    )


def test_the_6aa1bfa0_hallucination_is_caught():
    turns = [
        "أهلا وسهلا ومرحبا. انا جاهز.",
        "ممكن توضحي لي السؤال.",
        "ما مر علي. صراحة. واحد من عندهم. واذا تحبيني يعني.",
        "نوقف الإنتاج لأن السلامة اهم من ضغط البئر. هيچ.",
        "صراحة ما عندي خبرة قوية بالهندسه النفط. يعني. ممكن غير السؤال.",
        "الأكاديمية أكثر.",
    ]
    # No «اتخاذ القرار» attributed to him anywhere; two explicit denials.
    assert presupposes_unstated_act(
        "تمام، اذكرلي شنو كانت قراءة bottomhole pressure وقت اتخاذ القرار؟", turns
    )


def test_the_1783_scada_hallucination_is_caught():
    turns = [
        "إبرة العملية. اشتغلت في عدة شركات.",
        "ممكن.",
        "طبعا. أشوف أكثر شي. المحاكاة قريبة لي.",
        "يصير. بلانس بين الضغوط. ويصير توازن بين الضغط.",
    ]
    # SCADA cleaning was never claimed — the agent raised SCADA, he moved on.
    assert presupposes_unstated_act("زين، شنو الخطوة الأولى اللي سويتها لتنظيف بيانات SCADA؟", turns)


# ── grounded questions must pass, or the guard is useless ────────────────────

def test_a_grounded_decision_passes():
    turns = ["اتخذت قرار إني أوقف الإنتاج لأن الضغط كان عالي وما كانت السلامة مضمونة."]
    assert not presupposes_unstated_act("شنو كان تأثير القرار اللي اتخذته على الفريق؟", turns)


def test_a_grounded_action_passes():
    turns = ["سويت مراجعة كاملة لبيانات الآبار قبل ما نعتمد التقرير."]
    assert not presupposes_unstated_act("شنو الخطوة الأولى اللي سويتها بهالمراجعة؟", turns)


def test_feminine_first_person_form_counts_as_grounding():
    # Iraqi/MSA first person past is the same form regardless of gender; make sure
    # a female candidate's phrasing is not treated as ungrounded.
    turns = ["اشتغلت على تحليل الضغوط وقررت نغير جدول الصيانة."]
    assert not presupposes_unstated_act("شنو نتيجة القرار اللي قررته؟", turns)


# ── it must not fire on ordinary questions ───────────────────────────────────

def test_open_questions_are_untouched():
    turns = ["أهلا وسهلا."]
    for q in [
        "زين، خبرتك أكثر أكاديمية ولا ميدانية ولا الاثنين؟",
        "شنو خبرتك بقراءة بيانات بئر أو مكمن قبل اتخاذ قرار انتاجي؟",
        "احچيلي عن أهم مشروع بترولي اشتغلت عليه، سواء أكاديمي أو ميداني؟",
        "لو صار عندك تعارض بين السلامة والإنتاج، شنو تسوي؟",
        "شكراً على وقتك وإجاباتك.",
    ]:
        assert not presupposes_unstated_act(q, turns), q


def test_hypothetical_framing_is_allowed():
    # The safe way to ask the same thing when nothing is grounded.
    turns = ["ما مر علي."]
    assert not presupposes_unstated_act(
        "لو مرّ عليك موقف من هذا النوع، شنو كانت تكون قراءة الضغط وقتها؟", turns
    )


# ── robustness: this runs on every agent turn ────────────────────────────────

def test_empty_and_odd_inputs_do_not_throw():
    assert not presupposes_unstated_act("", [])
    assert not presupposes_unstated_act("   ", ["شيء"])
    assert not presupposes_unstated_act("سؤال بلا افتراض؟", [])


def test_diacritics_and_tatweel_do_not_hide_grounding():
    turns = ["اتّخذتُ قراراً بإيقاف الإنتاج."]
    assert not presupposes_unstated_act("شنو كان أثر القرار اللي اتخذته؟", turns)
