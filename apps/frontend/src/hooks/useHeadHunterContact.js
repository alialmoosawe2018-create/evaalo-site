import { useCallback, useMemo, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { appendInterviewShareLanguage } from '../utils/interviewShareLink.js';

/**
 * @param {unknown} status
 * @param {{ phone?: string; linkedin_url?: string }} candidate
 */
export function getHeadHunterSendChannels(status, candidate) {
    const phone = typeof candidate?.phone === 'string' ? candidate.phone.trim() : '';
    const linkedinUrl =
        typeof candidate?.linkedin_url === 'string' ? candidate.linkedin_url.trim() : '';

    const waConnected = Boolean(status?.integrations?.whatsapp?.connected);
    const liConnected = Boolean(status?.integrations?.linkedin?.connected);
    const liAutomation = Boolean(status?.flags?.linkedinAutomationEnabled);

    const canWhatsApp = Boolean(phone && waConnected);
    const canLinkedIn = Boolean(linkedinUrl && liConnected && liAutomation);

    return { phone, linkedinUrl, canWhatsApp, canLinkedIn };
}

/**
 * @param {import('../utils/headHunterNormalize.js').HeadHunterCandidate} candidate
 */
export function headHunterCandidatePosition(candidate) {
    const title =
        (typeof candidate?.current_title === 'string' ? candidate.current_title : '').trim() ||
        (typeof candidate?.headline === 'string' ? candidate.headline : '').trim();
    return title;
}

/**
 * @param {{ campaignId?: string; position?: string; headHunterContextId?: string }} [opts]
 */
export function buildPublicVideoScreeningUrl(opts = {}) {
    const params = new URLSearchParams();
    const campaignId = (opts.campaignId || '').trim();
    const position = (opts.position || '').trim();
    const hh = (opts.headHunterContextId || '').trim();
    if (campaignId) params.set('campaignId', campaignId);
    if (position) params.set('position', position);
    if (hh) params.set('hh', hh);
    appendInterviewShareLanguage(params, opts.language);
    const qs = params.toString();
    const base = `${window.location.origin}${import.meta.env.BASE_URL || '/'}`.replace(/\/?$/, '/');
    return qs ? `${base}video-screening-call?${qs}` : `${base}video-screening-call`;
}

/**
 * يبني نص دعوة المشاركة الافتراضي (مع/بدون الرابط). يُستخدم لروابط المشاركة المجانية
 * (واتساب عبر wa.me، البريد عبر mailto، أو المشاركة الأصلية) بلا أي تكلفة Unipile.
 * @param {object} opts
 * @param {(key: string) => string} opts.t
 * @param {{ full_name?: string }} [opts.candidate]
 * @param {string} [opts.url]
 * @param {boolean} [opts.includeLink]
 */
export function buildShareInviteText({ t, candidate, url, includeLink = true }) {
    const name = (typeof candidate?.full_name === 'string' ? candidate.full_name : '').trim();
    let msg = t('aiHeadHunterShareMessage').replace('{name}', name ? ` ${name}` : '');
    if (includeLink && url) msg = `${msg}\n${url}`;
    return msg.trim();
}

/**
 * رابط واتساب «اضغط للدردشة» — يفتح تطبيق المستخدم برسالة جاهزة بلا أي API.
 * @param {string} phone
 * @param {string} [text]
 */
export function buildWhatsAppShareLink(phone, text) {
    const digits = (typeof phone === 'string' ? phone : '').replace(/[^\d]/g, '');
    const q = text ? `?text=${encodeURIComponent(text)}` : '';
    return digits ? `https://wa.me/${digits}${q}` : `https://wa.me/${q}`;
}

/**
 * رابط mailto مع موضوع ونص جاهزين.
 * @param {string} email
 * @param {string} [subject]
 * @param {string} [body]
 */
export function buildMailtoShareLink(email, subject, body) {
    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    const qs = params.join('&').replace(/\+/g, '%20');
    const addr = (typeof email === 'string' ? email : '').trim();
    return `mailto:${addr}${qs ? `?${qs}` : ''}`;
}

/**
 * يبني لقطة سياق المصدر من بطاقة المرشح + معايير البحث (للعرض في الوكيل لاحقاً).
 * @param {import('../utils/headHunterNormalize.js').HeadHunterCandidate} candidate
 * @param {{ position?: string; location?: string; yearsExperience?: string; ageRange?: string; query?: string }} [searchContext]
 */
function buildSourcingProfile(candidate, searchContext) {
    const candidateProfile = candidate
        ? {
              full_name: candidate.full_name,
              headline: candidate.headline,
              current_title: candidate.current_title,
              current_company: candidate.current_company,
              location: candidate.location,
              years_experience: candidate.years_experience,
              skills: Array.isArray(candidate.skills) ? candidate.skills : undefined,
              languages: Array.isArray(candidate.languages) ? candidate.languages : undefined,
              summary: candidate.summary,
              ai_summary: candidate.ai_summary,
              experience_timeline: Array.isArray(candidate.experience_timeline)
                  ? candidate.experience_timeline
                  : undefined,
              education: Array.isArray(candidate.education) ? candidate.education : undefined,
              linkedin_url: candidate.linkedin_url,
          }
        : undefined;
    const searchCriteria = searchContext
        ? {
              position: searchContext.position,
              location: searchContext.location,
              yearsExperience: searchContext.yearsExperience,
              ageRange: searchContext.ageRange,
              query: searchContext.query,
          }
        : undefined;
    return { candidateProfile, searchCriteria };
}

/**
 * يحفظ لقطة سياق المصدر على الخادم ويعيد المعرّف القصير (?hh=). يفشل بصمت بإعادة ''.
 * @param {object} opts
 * @param {import('../utils/headHunterNormalize.js').HeadHunterCandidate} opts.candidate
 * @param {object} [opts.searchContext]
 * @param {string} [opts.campaignId]
 * @param {string} [opts.position]
 * @returns {Promise<string>}
 */
export async function createHeadHunterSourcingContext({ candidate, searchContext, campaignId, position }) {
    try {
        const { candidateProfile, searchCriteria } = buildSourcingProfile(candidate, searchContext);
        if (!candidateProfile && !searchCriteria) return '';
        const res = await apiClient.post('/api/head-hunter/sourcing-context', {
            candidateProfile,
            searchCriteria,
            campaignId: campaignId || undefined,
            position: position || undefined,
        });
        const id = res?.data?.id || res?.id || '';
        return typeof id === 'string' ? id : '';
    } catch {
        return '';
    }
}

/**
 * @param {object} opts
 * @param {(key: string) => string} opts.t
 * @param {'form' | 'video'} [opts.interviewType]
 */
export function useHeadHunterContactSend({ t, interviewType = 'form' }) {
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const send = useCallback(
        async ({ channel, recipient, message, campaignId, position, headHunterContextId, sendInterviewLink = true, language }) => {
            setSending(true);
            setFeedback(null);
            try {
                await apiClient.post('/api/head-hunter/contact', {
                    channel,
                    recipient,
                    message: message?.trim() || undefined,
                    sendInterviewLink,
                    interviewType,
                    campaignId: campaignId || undefined,
                    position: position?.trim() || undefined,
                    headHunterContextId: headHunterContextId || undefined,
                    language: language || undefined,
                });
                setFeedback({ ok: true, text: t('aiHeadHunterSent') });
                return true;
            } catch (err) {
                const code = err?.data?.error || '';
                const text = /not_connected|disabled/.test(code)
                    ? t('aiHeadHunterNotConnected')
                    : t('aiHeadHunterSendFailed');
                setFeedback({ ok: false, text });
                return false;
            } finally {
                setSending(false);
            }
        },
        [t, interviewType],
    );

    const resetFeedback = useCallback(() => setFeedback(null), []);

    return useMemo(
        () => ({ send, sending, feedback, resetFeedback, setFeedback }),
        [send, sending, feedback, resetFeedback],
    );
}
