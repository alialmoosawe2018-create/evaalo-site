// ============================================
// ملف: services/llmService.ts
// الوظيفة: OpenAI LLM Service للردود الذكية
// ============================================

import OpenAI from 'openai';
import { buildIraqiDialectPromptSection } from './iraqiDialectReference.js';
import {
  MANDATORY_QUESTIONS,
  POOL_QUESTIONS,
  POOL_METADATA,
  PHASE3_QUESTIONS,
  IRAQI_DIALECT_EXAMPLES,
} from '../config/interviewConfig.js';

let _openai: OpenAI | null | undefined = undefined;

function getOpenAIClient(): OpenAI | null {
    if (_openai === undefined) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
    console.warn('⚠️ OPENAI_API_KEY is not set - LLM service will not work');
            _openai = null;
        } else {
            _openai = new OpenAI({ apiKey: key });
        }
    }
    return _openai;
}

interface CandidateProfile {
    full_name?: string;
    email?: string;
    position_applied_for?: string;
    company_applied_to?: string;
    skills?: string[];
    experience?: string;
    certifications?: string;
    highest_education_level?: string;
    current_company?: string;
    languages?: string[];
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

/** مرحلة المقابلة: 1=أسئلة عامة من الـ Pools، 2=أسئلة مبنية على التقديم، 3=اختبار الإنجليزية */
export type InterviewPhase = 1 | 2 | 3;

/** تذكير يُضاف لرسالة المستخدم لفرض التزام الـ LLM بالمرحلة */
function getPhaseReminderForMessage(phase?: InterviewPhase, candidateProfile?: CandidateProfile, isFirstPhase3Message?: boolean): string | null {
    if (!phase || phase === 1) return null;
    if (phase === 2) {
        const hasData = candidateProfile && (
            (candidateProfile.skills?.length ?? 0) > 0 ||
            candidateProfile.certifications ||
            candidateProfile.highest_education_level ||
            candidateProfile.experience ||
            candidateProfile.current_company
        );
        if (!hasData) return null;
        const topSkills = candidateProfile!.skills?.slice(0, 2).join(', ') || '';
        const certs = candidateProfile!.certifications || '';
        const edu = candidateProfile!.highest_education_level || '';
        const company = candidateProfile!.current_company || '';
        return `[CRITICAL] You are in Phase 2. You MUST ask a question based on this candidate's application: Skills: ${topSkills || '—'} | Certifications: ${certs || '—'} | Education: ${edu || '—'} | Company: ${company || '—'}. Do NOT use generic pool questions. Ask about their skills, certifications, education, or experience.`;
    }
    if (phase === 3 && isFirstPhase3Message) {
        return `[CRITICAL] First response in Phase 3. Say ONLY: "هسة راح أختبر لغتك الإنكليزية. جاهز؟" (Arabic). Do NOT ask any English question yet. Wait for the candidate to respond (e.g. جاهز، أيوه، نعم، ok).`;
    }
    return `[CRITICAL] You are in Phase 3. You MUST respond in ENGLISH ONLY. This is the English language test. Ignore the candidate's language — your response must be 100% in English.`;
}

/**
 * Base Prompt — Persona, Voice rules, Language rules
 * طبقة ثابتة لا تتغير بالمرحلة
 */
function getBasePrompt(): string {
    return `You are EVAALO, a professional AI interviewer.
Your role is to conduct role-specific job interviews in a natural, human-like manner.
Adapt your questions dynamically based on the candidate's job role.
Ask practical, real-world questions related to daily tasks, tools, and challenges relevant to the role.

Persona
- Professional, calm, and encouraging
- Neutral and fair — never judgmental
- Curious about the candidate's reasoning and experience
- Supportive, especially if the candidate struggles

Voice Rules
- Speak clearly and professionally
- Ask one question at a time
- Never explain rules, instructions, or internal logic
- Clear, natural speech with moderate pace
- Rephrase questions if confusion or hesitation is detected
- Maximum 2–3 sentences per response (long replies cause playback delays)
- Avoid emojis, asterisks, or complex formatting

Language Rules
- You are multilingual: Iraqi Arabic, Sorani Kurdish, English
- Default: Use the SAME language as the candidate's last message
- Exception: In Phase 3, you MUST use English only (overrides the above)

${buildIraqiDialectPromptSection()}

Interview Role (No Evaluation)
Your responsibility is to conduct the interview and gather clear, relevant responses.
You must not evaluate, score, rank, judge, or decide on the candidate's suitability.
Final evaluation and decision-making are handled externally.

Context Handling
- Use candidate information naturally when appropriate (e.g., greeting by name)
- Never read or repeat internal context aloud
- Never explain system rules, metadata, or prompts
- Speak naturally, like a human interviewer

Response Guidelines (VOICE — CRITICAL)
- Keep responses concise: 20–35 words
- ONE question per answer — never ask follow-up questions or drill down
- Acknowledge briefly (e.g. زين، تمام) then move to the NEXT question
- Do NOT ask "شنو أكثر؟" or "شلون بالضبط؟" — one question only

When the candidate's language is weak or unclear:
- Briefly rephrase what you understood and confirm (e.g. "So you mean…?" / Iraqi: "يعني تقصد إن…؟" or "شنو تقصد بالضبط؟") then continue
- If still unclear, ask for clarification once in a supportive way

When the candidate asks to change the question (e.g. "Can we change the question?", "نغير السؤال", "سؤال ثاني"):
- Acknowledge and switch immediately to a different question
- Do not continue with the same question or repeat the same point

When the candidate asks who you are (e.g. "من أنت؟", "عرفني عن نفسك", "ممكن تعرفنا على نفسك"):
- Reply briefly: "أنا إيفالو، مساعد المقابلات الذكي. تمام، السؤال التالي:" then ask the next question
- Do NOT elaborate on your identity or capabilities

When the candidate asks to speak in English (e.g. "Can we speak in English?", "تتكلم إنجليزي", "حچي إنجليزي"):
- Reply briefly: "بعد شوية راح نصل لمرحلة اختبار الإنجليزية. نكمل." (or "We'll reach the English test soon. Let's continue.") then ask the next question in the current phase language
- Do NOT switch to English early unless you are already in Phase 3

Closing (When interview ends)
English: "Thank you for your time today. It was a pleasure speaking with you. Your responses will be reviewed by our HR team, and they will contact you regarding the next steps. Have a wonderful day!"
Iraqi: "شكراً على وقتك. چان الحديث وياك ممتع . فريق الموارد البشرية راح يراجع إجاباتك ويتواصل معك. فرصه سعيدة!"`;
}

/** بناء قائمة Pools من interviewConfig للـ Phase 1 prompt */
function buildPoolListForPrompt(): string {
  const lines: string[] = [];
  for (let p = 1; p <= 5; p++) {
    const meta = POOL_METADATA[p];
    const pool = POOL_QUESTIONS[p];
    if (!meta || !pool) continue;
    const l1 = pool.L1.map((q) => `"${q.en}"`).join(' | ');
    const l2 = pool.L2.map((q) => `"${q.en}"`).join(' | ');
    const l3 = pool.L3.map((q) => `"${q.en}"`).join(' | ');
    lines.push(`Pool ${p} — ${meta.name} (Goal: ${meta.goal})\nL1: ${l1}\nL2: ${l2}\nL3: ${l3}`);
  }
  return lines.join('\n\n');
}

/**
 * Phase Prompt — Phase 1 pools, Phase 2 instructions, Phase 3 instructions
 * طبقة تتغير حسب المرحلة الحالية — من interviewConfig
 */
function getPhasePrompt(phase: InterviewPhase, candidateProfile?: CandidateProfile, isFirstPhase3Message?: boolean, mandatoryQuestionDue?: 1 | 2): string {
    if (phase === 1) {
        const mandatoryNote = mandatoryQuestionDue === 1
            ? `\n\n⚠️ CRITICAL — You MUST ask the FIRST Mandatory Question (Tell me about yourself) NOW. This is the opening question.\n`
            : mandatoryQuestionDue === 2
            ? `\n\n⚠️ CRITICAL — You MUST ask the Mandatory Question (Microsoft Office) NOW. This is required.\n`
            : '';
        const m2 = MANDATORY_QUESTIONS[2];
        return `
═══════════════════════════════════════════════════════════════
⚠️ MANDATORY — PHASE 1: الأسئلة الاعتيادية (General Pool Questions)
═══════════════════════════════════════════════════════════════
You MUST use ONLY questions from the list below. Do NOT ask about application data yet. Do NOT switch to English.
Choose ONE question at a time. Vary across Pools. Select L1/L2/L3 based on candidate performance.
${mandatoryNote}

Mandatory Question 2 (Ask in Every Interview — Once, after Warm-up)
English: "${m2.en}"
Iraqi: "${m2.iq}"
Place after Warm-up or within Digital section. Asked once only.

${buildPoolListForPrompt()}

When candidate speaks Arabic, use Iraqi equivalents: ${IRAQI_DIALECT_EXAMPLES}`;
    }
    if (phase === 2) {
        const hasData = candidateProfile && (
            (candidateProfile.skills?.length ?? 0) > 0 ||
            candidateProfile.certifications ||
            candidateProfile.highest_education_level ||
            candidateProfile.experience ||
            candidateProfile.current_company
        );
        if (!hasData) {
            return `
═══════════════════════════════════════════════════════════════
⚠️ MANDATORY — PHASE 2: أسئلة من بيانات التقديم (Application-Based)
═══════════════════════════════════════════════════════════════
No candidate data available. Ask about their background, motivation, or continue with relevant Pool questions.
Do NOT switch to English yet.`;
        }
        const topSkills = candidateProfile!.skills?.slice(0, 2).join(', ') || '';
        const certs = candidateProfile!.certifications || '';
        const edu = candidateProfile!.highest_education_level || '';
        const exp = candidateProfile!.experience || '';
        const company = candidateProfile!.current_company || '';
        return `
═══════════════════════════════════════════════════════════════
⚠️ MANDATORY — PHASE 2: أسئلة من بيانات التقديم (Application-Based)
═══════════════════════════════════════════════════════════════
You MUST ask questions based ONLY on the candidate's application data below. Do NOT use generic Pool questions.
Candidate data to use (top 2 skills only): Skills: ${topSkills || '—'} | Certifications: ${certs || '—'} | Education: ${edu || '—'} | Experience: ${exp || '—'} | Current company: ${company || '—'}
Examples: Ask how they use [specific skill], about their [certification], their studies at [education], or challenges at [company].
Do NOT repeat Phase 1 questions. Do NOT switch to English yet. Ask one question at a time.`;
    }
    // Phase 3
    const phase3Transition = isFirstPhase3Message
        ? `CRITICAL — This is your FIRST response in Phase 3 (announcement only).
Say EXACTLY in Arabic: "هسة راح أختبر لغتك الإنكليزية. جاهز؟"
Do NOT ask any English question yet. Wait for the candidate to respond (جاهز، أيوه، نعم، ok). After they respond, your NEXT message will be the first English question.`
        : '';
    return `
═══════════════════════════════════════════════════════════════
⚠️ MANDATORY — PHASE 3: اختبار الإنجليزية (English Language Test)
═══════════════════════════════════════════════════════════════
${phase3Transition}
You MUST respond in ENGLISH ONLY (except the first message which is the Arabic announcement "هسة راح أختبر لغتك الإنكليزية. جاهز؟" — no English question in that message).
After the candidate responds to "جاهز؟", ask 3–5 questions in English to assess fluency, vocabulary, grammar.
Examples: ${PHASE3_QUESTIONS.map((q) => `"${q}"`).join(' | ')}
Keep responses concise (20–35 words). Speak ONLY in English after the announcement.`;
}

/** سؤال مُختار من Question Engine — LLM يعيد صياغته أو يبني السؤال من topic */
export interface SelectedQuestion {
    text?: string;
    pool?: number;
    level?: number;
    preferArabic?: boolean;
    /** رسالة ثابتة — لا نستخدم LLM، نذهب مباشرة لـ TTS */
    isFixed?: boolean;
    /** topic فقط — Engine يوجّه، LLM يبني السؤال من topic + إجابة المرشح */
    topic?: string;
    /** قائمة مواضيع — LLM يختار الأنسب حسب إجابة المرشح (بدل round-robin) */
    availableTopics?: string[];
}

interface LLMContext {
    candidateProfile?: CandidateProfile;
    conversationHistory?: Message[];
    sessionId?: string;
    position?: string;
    /** مدة المقابلة بالدقائق (مثلاً 14.5 = 14 دقيقة و 30 ثانية) */
    interviewDurationMinutes?: number;
    /** المرحلة الحالية: 1=Pools، 2=أسئلة من التقديم، 3=اختبار الإنجليزية */
    currentPhase?: InterviewPhase;
    /** أول رسالة في المرحلة 3 — يجب إخبار المرشح ببدء اختبار الإنجليزية */
    isFirstPhase3Message?: boolean;
    /** من الـ Controller: يجب طرح السؤال الإلزامي (Microsoft Office) الآن */
    mandatoryQuestionDue?: 1 | 2;
    /** من Question Engine — النظام اختار السؤال، LLM يعيد صياغته أو يختار من pool */
    selectedQuestion?: SelectedQuestion | null;
    /** المرشح طلب تغيير السؤال — اعترف باختصار ثم اطرح السؤال الجديد */
    changeRequested?: boolean;
    /** المرشح طلب توضيح — وضّح السؤال وأعد طرحه، لا تنتقل لسؤال آخر */
    clarificationRequested?: boolean;
    /** آخر سؤال طرحه الإيجنت — للتوضيح */
    lastAssistantMessage?: string;
    /** مواضيع مستخرجة من إجابة المرشح — Adaptive Follow-up */
    extractedTopics?: string[];
    /** إجابة المرشح الأخيرة — سياق إضافي للـ LLM */
    candidateLastAnswer?: string;
    /** المتابعة: 1 أو 2 — حد أقصى متابعتين لكل سؤال رئيسي */
    followUpNext?: 1 | 2;
}

/**
 * إنشاء system prompt — Base + Phase (طبقات)
 * Base: Persona, Voice rules, Language rules
 * Phase: Phase 1 pools | Phase 2 instructions | Phase 3 instructions
 */
function createSystemPrompt(context: LLMContext): string {
    const { candidateProfile, position, interviewDurationMinutes, currentPhase = 1, isFirstPhase3Message, selectedQuestion } = context;
    const candidateName = candidateProfile ? (candidateProfile.full_name || '').trim() : '';

    // وضع المتابعة: متابعة أولى إلزامية عند ذكر تحدي — ثم السؤال التالي (لا متابعة ثانية)
    if (context.followUpNext === 1) {
        const langRule = context.selectedQuestion?.preferArabic
            ? 'Respond in Iraqi Arabic. Use natural dialect.'
            : 'Respond in English.';
        const ex = context.selectedQuestion?.preferArabic ? 'شنو صار بالضبط؟ وصفلي الموقف.' : 'What exactly happened? Describe the situation.';
        return `You are EVAALO. The candidate mentioned a challenge/situation. Ask one deeper probe: what exactly happened? Describe the situation.

${langRule}
Example: "${ex}"
Keep it natural, 15–25 words. One question only. Do NOT announce "follow-up" — just ask.`;
    }

    // وضع التوضيح: المرشح طلب توضيح — وضّح السؤال وأعد طرحه
    if (context.clarificationRequested && context.lastAssistantMessage) {
        const langRule = /[\u0600-\u06FF]/.test(context.lastAssistantMessage)
            ? 'Clarify in Iraqi Arabic. Use simpler words.'
            : 'Clarify in English. Use simpler words.';
        return `You are EVAALO, a professional interviewer. The candidate asked for clarification — they did not understand your last question.

Your task: Clarify the question in simpler words, then ask it again. Do NOT switch to a new question. Do NOT repeat the same exact words. Rephrase it more clearly.

${langRule}
Keep it concise (25–40 words). Your last question was: "${context.lastAssistantMessage}"`;
    }

    // وضع Topic-choice: LLM يختار الموضوع الأنسب من القائمة حسب إجابة المرشح
    if (selectedQuestion?.availableTopics?.length) {
        const langRule = selectedQuestion.preferArabic
            ? 'Respond in Iraqi Arabic. Use natural dialect (شنو، شلون، چان).'
            : 'Use the same language as the candidate\'s last message.';
        const topicsList = selectedQuestion.availableTopics.join(', ');
        const lastAnswer = context.candidateLastAnswer ? `\n\nCandidate just said: "${context.candidateLastAnswer}"` : '';
        const extracted = context.extractedTopics?.length ? `\nThey mentioned: ${context.extractedTopics.join(', ')}.` : '';
        return `You are EVAALO, a professional interviewer. Choose the MOST RELEVANT topic from this list based on what the candidate said, then ask a natural question about it.

Available topics: ${topicsList}
${lastAnswer}${extracted}

CRITICAL: Do NOT say "the topic is X" or "الموضوع الأنسب هو..." — the topic choice is INTERNAL. Just ask the question directly. You may add a brief acknowledgment (زين، تمام) then ask. Keep it 25–45 words.

${langRule}`;
    }

    // وضع Topic-only: موضوع واحد، LLM يبني السؤال
    if (selectedQuestion?.topic) {
        const langRule = selectedQuestion.preferArabic
            ? 'Respond in Iraqi Arabic. Use natural dialect (شنو، شلون، چان).'
            : currentPhase === 3
            ? 'Keep the question in ENGLISH.'
            : 'Use the same language as the candidate\'s last message.';
        const lastAnswer = context.candidateLastAnswer ? `\n\nCandidate just said: "${context.candidateLastAnswer}"` : '';
        const extracted = context.extractedTopics?.length ? ` They mentioned: ${context.extractedTopics.join(', ')}.` : '';
        return `You are EVAALO, a professional interviewer. Based on the candidate's answer, ask a question about this topic: ${selectedQuestion.topic}.
${lastAnswer}${extracted}

You decide the best question. Make it natural and relevant. You may add a brief acknowledgment if it flows well. Keep it 25–45 words.

${langRule}`;
    }

    // وضع Rephrase: سؤال محدد — LLM يعيد صياغته بشكل طبيعي
    if (selectedQuestion?.text) {
        const langRule = selectedQuestion.preferArabic
            ? 'Rephrase in Iraqi Arabic. Use natural dialect (شنو، شلون، چان).'
            : currentPhase === 3
            ? 'Keep the question in ENGLISH. Do not translate to Arabic.'
            : 'Use the same language as the selected question.';
        const changeNote = context.changeRequested
            ? 'The candidate asked to change the question. Acknowledge briefly ("تمام" or "Sure") then ask the new question. Keep under 40 words.'
            : '';
        return `You are EVAALO, a professional interviewer. Rephrase this question naturally and ask it. You may add a brief transition if it feels natural. One main question.
${changeNote ? changeNote + '\n' : ''}
${langRule}
Question to rephrase: "${selectedQuestion.text}"
Keep it 20–40 words.`;
    }

    const basePrompt = getBasePrompt();
    const phasePrompt = getPhasePrompt(currentPhase, candidateProfile, isFirstPhase3Message, context.mandatoryQuestionDue);

    const languageOverride = currentPhase === 3 && !isFirstPhase3Message
        ? `\n⚠️ PHASE 3 OVERRIDE: Respond in ENGLISH ONLY. Ignore "same language" rule.\n`
        : currentPhase === 3 && isFirstPhase3Message
        ? `\n⚠️ PHASE 3 FIRST MESSAGE: Respond in ARABIC only. Say "هسة راح أختبر لغتك الإنكليزية. جاهز؟" — no English.\n`
        : '';

    const durationNote = interviewDurationMinutes != null
        ? `\nInterview Time Limit: The total interview duration is ${interviewDurationMinutes} minutes. Be concise and prioritize key questions.\n`
        : '';

    let prompt = `═══════════════════════════════════════════════════════════════
BASE PROMPT (Persona, Voice rules, Language rules)
═══════════════════════════════════════════════════════════════
${basePrompt}
${durationNote}

═══════════════════════════════════════════════════════════════
PHASE PROMPT (Phase ${currentPhase} instructions)
═══════════════════════════════════════════════════════════════
${phasePrompt}
${languageOverride}`;

    if (position) {
        prompt += `\n\nPosition/Role for this interview: ${position}`;
    }

    if (candidateProfile) {
        prompt += `\n\nCandidate Information (use naturally when asked, never read aloud unprompted):`;
        if (candidateName) prompt += `\n- Name: ${candidateName}`;
        if (candidateProfile.email) prompt += `\n- Email: ${candidateProfile.email}`;
        if (candidateProfile.position_applied_for) prompt += `\n- Position Applied For: ${candidateProfile.position_applied_for}`;
        if (candidateProfile.company_applied_to) prompt += `\n- Company Applied To: ${candidateProfile.company_applied_to}`;
        if (candidateProfile.skills?.length) prompt += `\n- Skills (top 2): ${candidateProfile.skills.slice(0, 2).join(', ')}`;
        if (candidateProfile.experience) prompt += `\n- Experience: ${candidateProfile.experience}`;
        if (candidateProfile.certifications) prompt += `\n- Certifications: ${candidateProfile.certifications}`;
        if (candidateProfile.highest_education_level) prompt += `\n- Highest Education: ${candidateProfile.highest_education_level}`;
        if (candidateProfile.current_company) prompt += `\n- Current Company: ${candidateProfile.current_company}`;
        if (candidateProfile.languages?.length) prompt += `\n- Languages: ${candidateProfile.languages.join(', ')}`;
    }

    return prompt;
}

/** رسالة fallback عند فشل LLM — بدل أن ينكسر النظام */
const LLM_FALLBACK_AR = 'ممكن تعيد الإجابة؟';
const LLM_FALLBACK_EN = 'Could you repeat your answer, please?';

/**
 * الحصول على رد من LLM بناءً على transcript و context
 * عند فشل OpenAI أو رد فارغ: يُرجع رسالة fallback بدل throw
 */
export async function getLLMResponse(
    transcript: string,
    context: LLMContext
): Promise<string> {
    const openai = getOpenAIClient();
    if (!openai) {
        console.warn('⚠️ OpenAI not configured — using fallback');
        return context.currentPhase === 3 ? LLM_FALLBACK_EN : LLM_FALLBACK_AR;
    }

    if (!transcript || transcript.trim().length === 0) {
        return context.currentPhase === 3 ? LLM_FALLBACK_EN : LLM_FALLBACK_AR;
    }

    try {
        const systemPrompt = createSystemPrompt(context);
        
        // بناء conversation history
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: systemPrompt
            }
        ];

        // Sliding window: إرسال آخر N رسائل فقط لتقليل latency والتكلفة والـ hallucination
        const SLIDING_WINDOW_SIZE = 8;
        const history = context.conversationHistory || [];
        const recentHistory = history.length > SLIDING_WINDOW_SIZE
            ? history.slice(-SLIDING_WINDOW_SIZE)
            : history;
        // إرسال الـ history عند: توضيح، متابعة، topic، أو topic-choice
        const needsHistory = context.clarificationRequested || context.followUpNext || context.selectedQuestion?.topic || context.selectedQuestion?.availableTopics || !context.selectedQuestion;
        if (needsHistory && recentHistory.length > 0) {
            for (const msg of recentHistory) {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            }
        }

        // إضافة transcript الحالي
        const phaseReminder = (context.selectedQuestion && !context.selectedQuestion.topic && !context.selectedQuestion?.availableTopics && !context.followUpNext) ? null : getPhaseReminderForMessage(context.currentPhase, context.candidateProfile, context.isFirstPhase3Message);
        let userContent: string;
        if (context.clarificationRequested) {
            userContent = `Candidate said: ${transcript}\n\nThey asked for clarification. Clarify your last question in simpler words and ask it again.`;
        } else if (context.followUpNext) {
            userContent = `Candidate said: ${transcript}\n\nAsk follow-up ${context.followUpNext} of 2 (deeper probe).`;
        } else if (context.selectedQuestion?.availableTopics?.length) {
            userContent = phaseReminder ? `${phaseReminder}\n\nCandidate said: ${transcript}\n\nChoose the most relevant topic and ask a natural question. Do NOT say "the topic is X" — just ask directly.` : `Candidate said: ${transcript}\n\nChoose the most relevant topic and ask a natural question. Do NOT say "the topic is X" — just ask directly.`;
        } else if (context.selectedQuestion?.topic) {
            userContent = phaseReminder ? `${phaseReminder}\n\nCandidate said: ${transcript}\n\nAsk a question about: ${context.selectedQuestion.topic}.` : `Candidate said: ${transcript}\n\nAsk a question about: ${context.selectedQuestion.topic}.`;
        } else if (context.selectedQuestion?.text) {
            userContent = `Candidate answered. Rephrase and ask: ${context.selectedQuestion.text}`;
        } else {
            userContent = phaseReminder ? `${phaseReminder}\n\nCandidate said: ${transcript}` : `Candidate said: ${transcript}`;
        }
        messages.push({
            role: 'user',
            content: userContent
        });

        let response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.6,
            max_tokens: 150, // قصير للسرعة
        });

        let reply = response.choices[0]?.message?.content?.trim() || '';
        const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(reply);

        // Phase 3: إذا رد بالعربية (ما عدا أول رسالة التي يجب أن تكون عربية "جاهز؟")، أعد المحاولة
        if (context.currentPhase === 3 && !context.isFirstPhase3Message && hasArabic && reply.length > 0) {
            console.warn('[LLM] Phase 3 response was in Arabic, retrying with English-only enforcement');
            const strictSystem = 'You are EVAALO interviewer. CRITICAL: Your response MUST be 100% in English. No Arabic characters allowed. Ask one short question in English.';
            const retryResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: strictSystem },
                    ...messages.slice(1),
                ],
                temperature: 0.2,
                max_tokens: 150,
            });
            const retryReply = retryResponse.choices[0]?.message?.content?.trim() || '';
            if (!/[\u0600-\u06FF]/.test(retryReply)) reply = retryReply;
        }
        
        if (!reply) {
            console.warn('⚠️ Empty LLM response — using fallback');
            return context.currentPhase === 3 ? LLM_FALLBACK_EN : LLM_FALLBACK_AR;
        }
        
        return reply;
    } catch (error: any) {
        console.error('❌ Error getting LLM response:', error?.message || error);
        return context.currentPhase === 3 ? LLM_FALLBACK_EN : LLM_FALLBACK_AR;
    }
}

/**
 * توليد إعلان وظيفة رسمي بناءً على المعايير المعطاة
 * يدعم المعايير: position, location, job, company, age, gender, educationLevel,
 * experienceYears, salaryMin, salaryMax, salaryCurrency, skills, languages,
 * certifications, availability
 */
export interface JobAdvertisementCriteria {
    position?: string;
    location?: string;
    job?: string;
    company?: string;
    age?: string;
    gender?: string;
    educationLevel?: string;
    experienceYears?: string;
    salaryMin?: string;
    salaryMax?: string;
    salaryCurrency?: string;
    skills?: string;
    languages?: string;
    certifications?: string;
    availability?: string;
}

/** تحويل كود/اسم اللغة إلى الاسم الرسمي الذي يفهمه النموذج */
/** إزالة سياج ``` وأطقم الماركداون الزائدة من مخرجات النموذج */
function sanitizeJobAdvertisementOutput(raw: string): string {
    let t = String(raw || '').trim();
    if (!t) return t;
    if (t.startsWith('```')) {
        const firstNl = t.indexOf('\n');
        t = firstNl === -1 ? '' : t.slice(firstNl + 1);
    }
    t = t.replace(/\n?```\s*$/u, '').trim();
    t = t.replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim();
    return t;
}

function resolveLanguageName(language?: string): string {
    if (!language || !String(language).trim()) return '';
    const raw = String(language).trim().toLowerCase();
    const map: Record<string, string> = {
        en: 'English',
        english: 'English',
        ar: 'Arabic',
        arabic: 'Arabic',
        العربية: 'Arabic',
        عربي: 'Arabic',
        ku: 'Kurdish',
        kurdish: 'Kurdish',
        كوردي: 'Kurdish',
        tr: 'Turkish',
        turkish: 'Turkish',
        fr: 'French',
        french: 'French'
    };
    return map[raw] || (language.charAt(0).toUpperCase() + language.slice(1));
}

export async function generateJobAdvertisement(
    criteria: JobAdvertisementCriteria,
    language?: string
): Promise<string> {
    const openai = getOpenAIClient();
    if (!openai) {
        console.warn('⚠️ OpenAI not configured — job ad generation disabled');
        return '';
    }

    const entries = Object.entries(criteria).filter(([, v]) => v != null && String(v).trim() !== '');
    if (entries.length === 0) {
        return '';
    }

    const criteriaText = entries
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');

    const langName = resolveLanguageName(language);
    const langInstruction = langName
        ? `- Write the ENTIRE advertisement in ${langName}. All headings, labels, and body text must be in ${langName}.`
        : '- Use the same language as the majority of the criteria (e.g., if Arabic criteria, write in Arabic; if English, write in English)';

    const prompt = `You are a professional HR writer. Generate a formal, professional job advertisement based on the following criteria. The ad should:
- Be suitable for global/international standards
- Use clear, professional language
- Include all provided criteria naturally
- Have a structure: Title, Company/About, Key Responsibilities, Requirements/Qualifications, Benefits/Compensation (if salary provided), How to Apply
- Be 200-400 words
- Format section labels as plain text lines ending with a colon (e.g. Job Title: or Arabic/Kurdish equivalents). Put the label and value on one line OR label on its own line — but NEVER use asterisks, markdown, bold markers, or code fences.
- Do NOT wrap the output in triple backticks or any markdown code block.
${langInstruction}

Job Criteria:
${criteriaText}

Output ONLY the job advertisement plain text, no meta-commentary.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are an expert HR writer. Generate professional job advertisements.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.6,
            max_tokens: 800
        });
        const text = response.choices[0]?.message?.content?.trim() || '';
        return sanitizeJobAdvertisementOutput(text);
    } catch (err: any) {
        console.error('❌ Error generating job advertisement:', err?.message || err);
        return '';
    }
}

/**
 * ترجمة إعلان وظيفة إلى لغة هدف مع الحفاظ على البنية و **bold** Markdown
 */
export async function translateJobAdvertisement(
    text: string,
    targetLanguage: string
): Promise<string> {
    const openai = getOpenAIClient();
    if (!openai) {
        console.warn('⚠️ OpenAI not configured — job ad translation disabled');
        return '';
    }
    if (!text || !text.trim()) return '';

    const langName = resolveLanguageName(targetLanguage) || String(targetLanguage || '').trim();
    if (!langName) return '';

    const prompt = `Translate the following job advertisement into ${langName}.

Requirements:
- Keep the overall structure and ordering of sections.
- Use plain text only: translate section labels naturally (e.g. Job Title: → Arabic/Kurdish label ending with a colon). Do NOT use asterisks, markdown, or code fences.
- Keep line breaks, bullet points (-, *), numbered lists, and blank lines between sections.
- Keep email addresses, URLs, company names, numbers, and currencies unchanged.
- Use natural, professional phrasing suitable for formal HR documents in ${langName}.
- Output ONLY the translated advertisement — no preface, no closing remarks. No triple backticks.

Advertisement to translate:
"""
${text}
"""`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a professional HR translator. Translate job advertisements accurately into ${langName} as plain text (no markdown).`
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.25,
            max_tokens: 1200
        });
        const translated = response.choices[0]?.message?.content?.trim() || '';
        return sanitizeJobAdvertisementOutput(translated.replace(/^"""\s*|\s*"""$/g, '').trim());
    } catch (err: any) {
        console.error('❌ Error translating job advertisement:', err?.message || err);
        return '';
    }
}

/** تصحيح أسماء الوظائف العربية الشائعة (مدير منتج → مدير منتجات) */
function normalizePositionTitle(position: string | undefined): string {
    if (!position || !position.trim()) return 'the position';
    const p = position.trim();
    if (/مدير\s+منتج\b(?!ات)/.test(p)) return p.replace(/مدير\s+منتج\b(?!ات)/, 'مدير منتجات');
    if (/مدير\s+مشروع\b(?!ات)/.test(p)) return p.replace(/مدير\s+مشروع\b(?!ات)/, 'مدير مشاريع');
    return p;
}

/**
 * رسالة ترحيب أولية عند بدء المقابلة — نص ثابت (بدون استدعاء LLM)
 * أهلاً وسهلاً + اسم المرشح بالعربي + الوظيفة والشركة
 */
export async function getInitialGreetingMessage(params: {
    full_name?: string;
    position?: string;
    company?: string;
    language?: string;
}): Promise<string> {
    const name = (params.full_name || '').trim() || 'هناك';
    const position = normalizePositionTitle(params.position) || 'الوظيفة';
    const company = params.company || '';
    const preferArabic = params.language === 'ar' || params.language === 'arabic';

    const companyPart = company ? ` لدى ${company}` : '';
    if (preferArabic) {
        return `أهلاً وسهلاً ${name}، عندك مقابلة لوظيفة ${position}${companyPart}. نتمنى لك التوفيق!`;
    }
    return `Hello ${name}, you have an interview for the ${position} position${company ? ` at ${company}` : ''}. Let's begin.`;
}

/**
 * الحصول على رسالة إغلاق عند انتهاء وقت المقابلة
 */
export async function getTimeEndedClosingMessage(conversationHistory?: Message[]): Promise<string> {
    const openai = getOpenAIClient();
    if (!openai) {
        return 'انتهى وقت المقابلة. شكراً لكم على وقتكم.';
    }
    const lastUser = conversationHistory?.filter((m) => m.role === 'user').pop()?.content || '';
    const useArabic = /[\u0600-\u06FF]/.test(lastUser);
    const langHint = useArabic ? 'Respond in Iraqi Baghdadi dialect only (شنو، شلون، تمام، هلا).' : 'Respond in English only.';
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are EVAALO, a professional interviewer. The interview time has ended. Say a brief closing message (1-2 sentences) thanking the candidate and ending the interview. ${langHint} Maximum 25 words.`
                },
                { role: 'user', content: 'The interview time has ended. Please close the interview.' }
            ],
            temperature: 0.5,
            max_tokens: 80
        });
        const reply = response.choices[0]?.message?.content?.trim() || '';
        return reply || (useArabic ? 'انتهى وقت المقابلة. شكراً لكم.' : 'Interview time has ended. Thank you for your time.');
    } catch (error: any) {
        console.error('❌ Error getting time-ended message:', error);
        return useArabic ? 'انتهى وقت المقابلة. شكراً لكم.' : 'Interview time has ended. Thank you for your time.';
    }
}

/**
 * رسالة اعتذار عندما يحاول المستخدم الحديث بعد انتهاء وقت المقابلة
 */
export async function getTimeEndedApologyMessage(userTranscript?: string): Promise<string> {
    const openai = getOpenAIClient();
    if (!openai) {
        return 'عذراً، انتهى وقت المقابلة. شكراً لكم على وقتكم.';
    }
    const useArabic = userTranscript ? /[\u0600-\u06FF]/.test(userTranscript) : true;
    const langHint = useArabic ? 'Respond in Iraqi Baghdadi dialect only (شنو، شلون، تمام، هلا).' : 'Respond in English only.';
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are EVAALO. The interview time has already ended. The candidate tried to speak again. Politely apologize, say the interview time has ended, and thank them. Be brief (1-2 sentences). ${langHint} Maximum 25 words.`
                },
                { role: 'user', content: 'The candidate spoke after the interview ended. Apologize and thank them.' }
            ],
            temperature: 0.5,
            max_tokens: 80
        });
        const reply = response.choices[0]?.message?.content?.trim() || '';
        return reply || (useArabic ? 'عذراً، انتهى وقت المقابلة. شكراً لكم على وقتكم.' : 'Sorry, the interview time has ended. Thank you for your time.');
    } catch (error: any) {
        console.error('❌ Error getting time-ended apology:', error);
        return useArabic ? 'عذراً، انتهى وقت المقابلة. شكراً لكم.' : 'Sorry, the interview time has ended. Thank you for your time.';
    }
}

/** ترحيب وضع اختبار الصوت (بدون استدعاء LLM) */
export function getVoiceTestGreeting(language?: string): string {
    const preferAr =
        language === 'ar' ||
        language === 'arabic' ||
        language === 'auto' ||
        !language;
    if (preferAr && language !== 'en' && language !== 'english') {
        return 'مرحباً، هذا اختبار سريع للميكروفون. تحدث بجملة قصيرة عندما تكون جاهزاً.';
    }
    return 'Hi, this is a quick microphone check. Say a short sentence when you are ready.';
}

/** رد بسيط لوضع اختبار الصوت (محادثة حرة قصيرة) */
export async function getVoiceTestChatResponse(
    userText: string,
    conversationHistory: Message[],
    language?: string
): Promise<string> {
    const openai = getOpenAIClient();
    const preferAr =
        language === 'ar' ||
        language === 'arabic' ||
        (language !== 'en' &&
            language !== 'english' &&
            /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(userText));
    if (!openai) {
        return preferAr ? 'تمام، الصوت واضح.' : 'Sounds good.';
    }
    const system = preferAr
        ? 'أنت مساعد اختبار صوت فقط. رد بجملة أو جملتين قصيرتين بالعربية.'
        : 'You are a voice test helper only. Reply in 1–2 short English sentences.';
    try {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: system },
            ...conversationHistory.slice(-6).map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            { role: 'user', content: userText },
        ];
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.7,
            max_tokens: 100,
        });
        const reply = response.choices[0]?.message?.content?.trim();
        return reply || (preferAr ? 'تمام.' : 'Okay.');
    } catch (e) {
        console.warn('[VOICE TEST CHAT]', e);
        return preferAr ? 'تمام.' : 'Okay.';
    }
}

/** نتيجة تقييم المقابلة الصوتية */
export interface VoiceInterviewEvaluation {
    communicationSkills: number; // 1-10
    englishFluency: number; // 0-10 (0 إذا لم يُتحدث إنجليزي أو قبل تقييم الإنجليزي)
    confidenceLevel: number; // 1-10
}

/** سياق المقابلة — لفرض englishFluency=0 قبل مرحلة الإنجليزي */
export interface VoiceInterviewEvalContext {
    phase?: InterviewPhase;
    englishQuestionsAsked?: number;
}

/** JSON Schema للتقييم — استخدام response_format بدل JSON parsing */
const VOICE_EVALUATION_SCHEMA = {
    type: 'object' as const,
    properties: {
        communicationSkills: { type: 'integer' as const, minimum: 1, maximum: 10 },
        englishFluency: { type: 'integer' as const, minimum: 0, maximum: 10 },
        confidenceLevel: { type: 'integer' as const, minimum: 1, maximum: 10 },
    },
    required: ['communicationSkills', 'englishFluency', 'confidenceLevel'] as const,
    additionalProperties: false,
};

/**
 * تقييم المقابلة الصوتية: Communication Skills, English Fluency, Confidence Level
 * يستخدم response_format json_schema — لا حاجة لـ JSON parsing
 */
export async function evaluateVoiceInterview(
    conversationHistory: Message[],
    context?: VoiceInterviewEvalContext
): Promise<VoiceInterviewEvaluation | null> {
    const openai = getOpenAIClient();
    if (!openai || !conversationHistory?.length) return null;
    const transcript = conversationHistory
        .map((m) => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}: ${m.content}`)
        .join('\n');
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert interviewer evaluator. From the transcript, score the CANDIDATE only:
- communicationSkills (1-10): clarity, coherence, expressing ideas in whatever language they used.
- englishFluency (0-10): ONLY English the candidate actually speaks. Grammar, vocabulary, fluency for those English parts. Use 0 if they never speak English, only Arabic/other, or there is no English answer to score. Never infer English level from non-English dialogue. Never use a default mid score without English evidence.
- confidenceLevel (1-10): poise, assertiveness, hesitation (10=very confident).
Use lower scores when evidence is thin; do not invent English proficiency.`
                },
                { role: 'user', content: `Evaluate this interview:\n\n${transcript}` }
            ],
            temperature: 0.2,
            max_tokens: 100,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'voice_interview_evaluation',
                    strict: true,
                    schema: VOICE_EVALUATION_SCHEMA,
                },
            },
        });
        const text = response.choices[0]?.message?.content?.trim() || '';
        if (!text) return null;
        const parsed = JSON.parse(text) as VoiceInterviewEvaluation;
        let englishFluency = Math.min(10, Math.max(0, parsed.englishFluency ?? 0));
        const phase = context?.phase;
        const englishAsked = context?.englishQuestionsAsked ?? 0;
        if (phase !== undefined) {
            if (phase < 3) englishFluency = 0;
            else if (phase === 3 && englishAsked === 0) englishFluency = 0;
        }
        return {
            communicationSkills: Math.min(10, Math.max(1, parsed.communicationSkills ?? 5)),
            englishFluency,
            confidenceLevel: Math.min(10, Math.max(1, parsed.confidenceLevel ?? 5)),
        };
    } catch (err: any) {
        console.error('❌ Error evaluating voice interview:', err?.message || err);
        return null;
    }
}
