// ============================================
// File: pages/PublicVideoScreeningCall.jsx
// Purpose: Public, shareable LIVE VIDEO screening interview (no data injection).
//          Collects basic candidate info, creates a candidate record (entryStage=video,
//          sourceType=public_screening), then navigates to the LiveKit video call page.
// ============================================

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import {
    publicScreeningCreateErrorMessage,
    resolvePublicScreeningCandidateId,
} from '../utils/publicScreeningIntake.js';
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

const PublicVideoScreeningCall = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, currentLang, changeLanguage } = useLanguage();

  const campaignId = searchParams.get('campaignId') || undefined;
  const position = searchParams.get('position') || undefined;
  const headHunterContextId = searchParams.get('hh') || undefined;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  const isRtl = currentLang === 'ar' || currentLang === 'ku';

  useEffect(() => {
    const fromUrl = parseUrlLanguage(searchParams.get('language'));
    if (fromUrl && fromUrl !== currentLang) {
      changeLanguage(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        entryStage: 'video',
        sourceType: 'public_screening',
        agreeToTerms: true,
      };
      if (campaignId) payload.campaignId = campaignId;
      if (headHunterContextId) payload.headHunterContextId = headHunterContextId;
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
      // مسار الفيديو يعمل عبر LiveKit في صفحة /video-interview-call (تنشئ الجلسة وتحقن المعايير عبر الباكند).
      const params = new URLSearchParams();
      params.set('candidateId', newId);
      if (campaignId) params.set('campaignId', campaignId);
      if (currentLang) params.set('language', currentLang);
      navigate(`/video-interview-call?${params.toString()}`);
    } catch (_) {
      setFormError(t('publicScreening_genericError'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="form-page public-screening-intake" dir={isRtl ? 'rtl' : 'ltr'} lang={currentLang}>
      <div className="container">
        <div className="form-wrapper psc-card">
          {/* عنوان + أيقونة فيديو */}
          <div className="psc-hero">
            <span className="psc-hero__icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="psc-hero__text">
              <h1 className="psc-hero__title">{t('publicVideoScreening_title')}</h1>
              <p className="psc-hero__subtitle">{t('publicVideoScreening_subtitle')}</p>
              <p className="psc-hero__subtitle psc-hero__subtitle--muted">{t('publicVideoScreening_subtitle2')}</p>
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

          <form id="publicVideoScreeningIntakeForm" className="psc-form" onSubmit={handleStart} noValidate>
            <h2 className="psc-form__heading">{t('publicScreening_sectionYourInfo')}</h2>

            <div className="psc-fields">
              <div className="form-group psc-field psc-field--full">
                <label htmlFor="pvsc-name">{t('publicScreening_fullName')}</label>
                <input
                  id="pvsc-name"
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
                <label htmlFor="pvsc-email">{t('publicScreening_email')}</label>
                <input
                  id="pvsc-email"
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
                <label htmlFor="pvsc-phone">{t('publicScreening_phone')}</label>
                <input
                  id="pvsc-phone"
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

export default PublicVideoScreeningCall;
