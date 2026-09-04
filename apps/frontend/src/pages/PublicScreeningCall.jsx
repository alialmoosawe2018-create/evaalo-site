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
import {
    buildPublicIntakeFormData,
    createPublicIntakeState,
    isValidEmail,
    missingRequiredFields,
} from '../utils/publicIntakeForm.js';
import PublicIntakeFields from '../components/PublicIntakeFields.jsx';
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

  // The role from the link pre-fills the field the candidate can still correct.
  const [intake, setIntake] = useState(() => {
    const initial = createPublicIntakeState();
    if (position) initial.details.position_applied_for = position;
    return initial;
  });
  const fullName = intake.details.full_name;
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
    if (missingRequiredFields(intake.details).length > 0) {
      setFormError(t('publicScreening_required'));
      return;
    }
    if (!isValidEmail(intake.details.email)) {
      setFormError(t('publicScreening_invalidEmail'));
      return;
    }
    setCreating(true);
    try {
      // multipart, not JSON — it is the only body shape that carries the CV
      // and the photo. /api/candidates accepts both, so the text-only case is
      // unchanged. Let the browser set the boundary: no Content-Type header.
      const body = buildPublicIntakeFormData(intake, {
        entryStage: 'audio',
        sourceType: 'public_screening',
        campaignId,
      });
      const res = await fetch(`${API_BASE}/api/candidates`, {
        method: 'POST',
        body,
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
        audioBlockedMessage={t('voiceInterview_audioBlocked')}
        audioBlockedAction={t('voiceInterview_audioBlockedAction')}
        dir={isRtl ? 'rtl' : 'ltr'}
        completedTitle={t('voiceInterview_completedTitle')}
        completedMessage={t('voiceInterview_completedMessage')}
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

            <PublicIntakeFields
              idPrefix="psc"
              value={intake}
              onChange={setIntake}
              disabled={creating}
              t={t}
            />

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
