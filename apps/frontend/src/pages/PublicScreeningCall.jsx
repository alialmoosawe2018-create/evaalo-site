// ============================================
// File: pages/PublicScreeningCall.jsx
// Purpose: Public, shareable voice screening interview (no data injection).
// ============================================

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import {
    publicScreeningCreateErrorMessage,
    resolvePublicScreeningCandidateId,
} from '../utils/publicScreeningIntake.js';
import useVoiceInterview from '../hooks/useVoiceInterview';
import VoiceInterviewStage from '../components/VoiceInterviewStage';
import VoiceInterviewPrepTips from '../components/VoiceInterviewPrepTips';
import InterviewLinkBlocked from '../components/InterviewLinkBlocked.jsx';
import { API_BASE_URL } from '../config/apiBase.js';
import '../styles.css';

const API_BASE = API_BASE_URL;

function parseUrlLanguage(raw) {
  const v = (raw || '').toLowerCase();
  if (v === 'en' || v === 'english') return 'en';
  if (v === 'ku' || v === 'kurdish' || v === 'ckb') return 'ku';
  if (v === 'ar' || v === 'arabic') return 'ar';
  return null;
}

function voiceSessionLanguage(uiLang) {
  return uiLang === 'en' ? 'en' : 'ar';
}

const PublicScreeningCall = () => {
  const [searchParams] = useSearchParams();
  const { t, currentLang, changeLanguage } = useLanguage();

  const campaignId = searchParams.get('campaignId') || undefined;
  const position = searchParams.get('position') || undefined;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [candidateId, setCandidateId] = useState(null);
  const [prepDone, setPrepDone] = useState(false);

  const isRtl = currentLang === 'ar' || currentLang === 'ku';
  const voiceLang = voiceSessionLanguage(currentLang);

  useEffect(() => {
    const fromUrl = parseUrlLanguage(searchParams.get('language'));
    if (fromUrl && fromUrl !== currentLang) {
      changeLanguage(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = useVoiceInterview({
    candidateId,
    language: voiceLang,
    mode: 'public',
    position,
    campaignId,
  });

  const handleStart = async (e) => {
    e?.preventDefault?.();
    setFormError(null);
    const name = fullName.trim();
    const mail = email.trim();
    const tel = phone.trim();
    if (!name || !mail || !tel) {
      setFormError(t('publicScreening_required'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setFormError(t('publicScreening_invalidEmail'));
      return;
    }
    setCreating(true);
    try {
      const payload = {
        full_name: name,
        email: mail,
        phone: tel,
        position_applied_for: (position || '').trim() || 'General',
        years_of_experience: 'N/A',
        entryStage: 'audio',
        sourceType: 'public_screening',
        agreeToTerms: true,
      };
      if (campaignId) payload.campaignId = campaignId;
      const res = await fetch(`${API_BASE}/api/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      const newId = resolvePublicScreeningCandidateId(res, result);
      if (!newId) {
        setFormError(publicScreeningCreateErrorMessage(res, result, t('publicScreening_genericError')));
        return;
      }
      setCandidateId(newId);
      setPrepDone(false);
    } catch (_) {
      setFormError(t('publicScreening_genericError'));
    } finally {
      setCreating(false);
    }
  };

  if (candidateId) {
    if (session.linkConsumed) {
      return (
        <InterviewLinkBlocked
          title={t('interviewLinkBlocked_title')}
          message={t('interviewLinkBlocked_message')}
          dir={isRtl ? 'rtl' : 'ltr'}
        />
      );
    }
    if (!prepDone) {
      return (
        <VoiceInterviewPrepTips
          title={t('publicScreening_title')}
          subtitle={
            (fullName.trim() || t('publicScreening_candidate')) + (position ? ` — ${position}` : '')
          }
          onContinue={() => setPrepDone(true)}
          dir={isRtl ? 'rtl' : 'ltr'}
        />
      );
    }
    return (
      <VoiceInterviewStage
        title={t('publicScreening_title')}
        subtitle={(fullName.trim() || t('publicScreening_candidate')) + (position ? ` — ${position}` : '')}
        candidateName={fullName.trim() || t('publicScreening_candidate')}
        session={session}
        canStart={!session.linkConsumed}
        startHint={null}
        recordingNotice={t('voiceInterview_recordingNotice')}
      />
    );
  }

  return (
    <div className="form-page public-screening-intake" dir={isRtl ? 'rtl' : 'ltr'} lang={currentLang}>
      <div className="container">
        <div className="form-wrapper psc-card">
          {/* عنوان + أيقونة */}
          <div className="psc-hero">
            <span className="psc-hero__icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M19 11v1a7 7 0 01-14 0v-1M12 18v3M8 21h8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div className="psc-hero__text">
              <h1 className="psc-hero__title">{t('publicScreening_title')}</h1>
              <p className="psc-hero__subtitle">{t('publicScreening_subtitle')}</p>
              <p className="psc-hero__subtitle psc-hero__subtitle--muted">{t('publicScreening_subtitle2')}</p>
            </div>
          </div>

          {/* شارة الوظيفة */}
          {position ? (
            <div className="psc-role-badge">
              <span className="psc-role-badge__text">
                {t('publicScreening_roleLabel')} {position}
              </span>
            </div>
          ) : null}

          {/* مؤشر الخطوات */}
          <div className="psc-stepper" aria-label={`${t('publicScreening_step1')} — ${t('publicScreening_step2')}`}>
            <div className="psc-step psc-step--active">
              <span className="psc-step__circle">1</span>
              <span className="psc-step__label">{t('publicScreening_step1')}</span>
            </div>
            <div className="psc-step psc-step--inactive">
              <span className="psc-step__circle">2</span>
              <span className="psc-step__label">{t('publicScreening_step2')}</span>
            </div>
          </div>

          <form id="publicScreeningIntakeForm" className="psc-form" onSubmit={handleStart} noValidate>
            <h2 className="psc-form__heading">{t('publicScreening_sectionYourInfo')}</h2>

            <div className="psc-fields">
              <div className="form-group psc-field psc-field--full">
                <label htmlFor="psc-name">{t('publicScreening_fullName')}</label>
                <input
                  id="psc-name"
                  type="text"
                  name="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('publicScreening_fullNamePh')}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="form-group psc-field">
                <label htmlFor="psc-email">{t('publicScreening_email')}</label>
                <input
                  id="psc-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('publicScreening_emailPh')}
                  autoComplete="email"
                  dir="ltr"
                  required
                />
              </div>
              <div className="form-group psc-field">
                <label htmlFor="psc-phone">{t('publicScreening_phone')}</label>
                <input
                  id="psc-phone"
                  type="tel"
                  name="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('publicScreening_phonePh')}
                  autoComplete="tel"
                  dir="ltr"
                  required
                />
              </div>
            </div>

            {formError ? (
              <p className="psc-form__error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="psc-submit-wrap">
              <button type="submit" className="psc-submit" disabled={creating}>
                {creating ? t('publicScreening_preparing') : t('publicScreening_continue')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PublicScreeningCall;
