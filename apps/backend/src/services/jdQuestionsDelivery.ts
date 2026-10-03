// ============================================
// services/jdQuestionsDelivery.ts
// Part one of the video interview, phase D: the campaign's three questions from the
// job description reach the agent in the dispatch metadata (`jd_questions`), the
// session records which set the agent actually received, and the campaign's set is
// frozen when the first interview really starts (/start — never /prepare, which a
// candidate may never follow).
//
// Off unless JD_INTERVIEW_QUESTIONS_DELIVER=true. Fail-open everywhere: anything
// missing, incomplete or in another language sends nothing, and the agent runs
// today's interview. The agent has its own switch (INTERVIEW_JD_PART1) and checks
// the set again.
// ============================================

import crypto from 'crypto';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { loadCampaignInterviewLanguage, type InterviewLanguage } from './interviewLanguage.js';

const COUNT = 3;

export function isJdQuestionsDeliveryEnabled(): boolean {
    return String(process.env.JD_INTERVIEW_QUESTIONS_DELIVER || '').trim().toLowerCase() === 'true';
}

export interface DeliveredJdQuestion {
    id: string;
    question: string;
    clarifyHint: string;
    duty: string;
}

export interface JdQuestionsDelivery {
    questions: DeliveredJdQuestion[];
    /** Identity of the exact text the agent gets — an edit changes it. */
    setKey: string;
    jdHash: string;
    promptVersion: string;
    language: InterviewLanguage;
}

/** Stable identity of a set: ids, questions and clarifications, in order. */
export function jdQuestionsSetKey(questions: DeliveredJdQuestion[]): string {
    const basis = JSON.stringify(questions.map((q) => [q.id, q.question, q.clarifyHint]));
    return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/**
 * The set to send for this campaign, or null. Only a `ready` set of exactly three
 * complete questions, written for the interview's own language, is ever sent.
 */
export async function loadJdQuestionsForDelivery(
    campaignId: string | undefined | null
): Promise<JdQuestionsDelivery | null> {
    const id = String(campaignId || '').trim();
    if (!id || !isJdQuestionsDeliveryEnabled()) return null;
    try {
        const camp: any = await RecruitmentCampaign.findOne({ campaignId: id })
            .select('jdInterviewQuestions')
            .lean();
        const field = camp?.jdInterviewQuestions;
        if (!field || field.status !== 'ready' || !Array.isArray(field.questions)) return null;
        const questions: DeliveredJdQuestion[] = field.questions.map((q: any, i: number) => ({
            id: `q${i + 1}`,
            question: String(q?.question || '').trim(),
            clarifyHint: String(q?.clarifyHint || '').trim(),
            duty: String(q?.duty || '').trim(),
        }));
        if (questions.length !== COUNT || questions.some((q) => !q.question || !q.clarifyHint)) {
            console.warn(`⚠️ jd_questions: campaign ${id} has an incomplete set — not sent`);
            return null;
        }
        // The agent speaks the campaign's language; a set written for another one
        // (the language cannot change after creation, but a hand-edited record can)
        // is not sent rather than heard in the wrong language.
        const { language } = await loadCampaignInterviewLanguage(id);
        if (field.language !== language) {
            console.warn(
                `⚠️ jd_questions: campaign ${id} set is ${field.language}, interview is ${language} — not sent`
            );
            return null;
        }
        return {
            questions,
            setKey: jdQuestionsSetKey(questions),
            jdHash: String(field.jdHash || ''),
            promptVersion: String(field.promptVersion || ''),
            language,
        };
    } catch (err: any) {
        console.warn(`⚠️ jd_questions: could not load campaign ${id} (${err?.message || err}) — not sent`);
        return null;
    }
}

/** Adds `jd_questions` to the dispatch metadata (the agent's jd_part_one.py reads it). */
export function applyJdQuestionsToLiveKit(
    metadata: Record<string, string>,
    delivery: JdQuestionsDelivery | null
): void {
    if (!delivery) return;
    metadata.jd_questions = JSON.stringify(delivery.questions);
}

/** What the session records: the set this interview's agent received. */
export function jdQuestionsSessionSnapshot(delivery: JdQuestionsDelivery | null) {
    if (!delivery) return undefined;
    return {
        setKey: delivery.setKey,
        jdHash: delivery.jdHash,
        promptVersion: delivery.promptVersion,
        language: delivery.language,
        questions: delivery.questions,
        deliveredAt: new Date(),
    };
}

/**
 * The first interview that really starts freezes the campaign's set. Conditional
 * and idempotent: only a `ready` set with the same jdHash, and only once — a later
 * interview never moves the date. Best effort: never blocks an interview.
 */
export async function freezeJdQuestionsAtStart(
    campaignId: string | undefined | null,
    delivery: JdQuestionsDelivery | null
): Promise<boolean> {
    const id = String(campaignId || '').trim();
    if (!id || !delivery) return false;
    try {
        const res = await RecruitmentCampaign.updateOne(
            {
                campaignId: id,
                'jdInterviewQuestions.status': 'ready',
                'jdInterviewQuestions.jdHash': delivery.jdHash,
                $or: [
                    { 'jdInterviewQuestions.frozenAt': { $exists: false } },
                    { 'jdInterviewQuestions.frozenAt': null },
                ],
            },
            { $set: { 'jdInterviewQuestions.frozenAt': new Date() } }
        );
        return (res as any).modifiedCount === 1;
    } catch (err: any) {
        console.warn(`⚠️ jd_questions: could not freeze campaign ${id}: ${err?.message || err}`);
        return false;
    }
}
