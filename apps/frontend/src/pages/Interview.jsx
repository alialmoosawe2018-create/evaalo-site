// ============================================
// File: pages/Interview.jsx
// Purpose: Voice Interview Frontend - candidate-specific entry point
// ============================================

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import useVoiceInterview from '../hooks/useVoiceInterview';
import VoiceInterviewStage from '../components/VoiceInterviewStage';
import VoiceInterviewPrepTips from '../components/VoiceInterviewPrepTips';
import InterviewLinkBlocked from '../components/InterviewLinkBlocked.jsx';
import { isVoiceInterviewLinkConsumed } from '../utils/interviewLinkAccess.js';
import { parseInterviewUrlLanguage } from '../utils/interviewShareLink.js';
import '../design-styles.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const Interview = () => {
  const [searchParams] = useSearchParams();
  const { t, currentLang, changeLanguage } = useLanguage();
  const candidateIdParam = searchParams.get('candidateId');
  const campaignId = searchParams.get('campaignId') || null;
  const applicationIdFromUrl = searchParams.get('applicationId') || null;
  const urlLang = parseInterviewUrlLanguage(searchParams.get('language'));
  const language = urlLang || 'ar';

  const [candidate, setCandidate] = useState(null);
  const [resolvedPersonId, setResolvedPersonId] = useState(candidateIdParam);
  const [resolvedApplicationId, setResolvedApplicationId] = useState(applicationIdFromUrl);
  const [loadingCandidate, setLoadingCandidate] = useState(!!candidateIdParam);
  const [candidateError, setCandidateError] = useState(null);
  const [prepDone, setPrepDone] = useState(false);

  const session = useVoiceInterview({
    candidateId: resolvedPersonId,
    language,
    campaignId,
    applicationId: resolvedApplicationId,
  });

  useEffect(() => {
    const fromUrl = parseInterviewUrlLanguage(searchParams.get('language'));
    if (fromUrl && fromUrl !== currentLang) {
      changeLanguage(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!candidateIdParam) {
      setLoadingCandidate(false);
      return;
    }
    let cancelled = false;
    setLoadingCandidate(true);
    setCandidateError(null);
    fetch(`${API_BASE}/api/candidates/${candidateIdParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const row = data?.data;
        if (!data?.success || !row) {
          setCandidateError(data?.message || 'Candidate not found');
          setCandidate(null);
          return;
        }
        setCandidate(row);
        const personId = row.candidateId ? String(row.candidateId) : String(row._id || candidateIdParam);
        setResolvedPersonId(personId);
        if (row.applicationId) setResolvedApplicationId(String(row.applicationId));
        else if (applicationIdFromUrl) setResolvedApplicationId(applicationIdFromUrl);
      })
      .catch((err) => {
        if (!cancelled) setCandidateError(err?.message || 'Failed to load candidate');
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidateIdParam, applicationIdFromUrl]);

  const displayName = candidate
    ? ((candidate.full_name || candidate.fullName) || '').trim() || candidate.email?.split('@')[0] || 'Candidate'
    : 'Candidate';
  const displayPosition = candidate?.position_applied_for || candidate?.positionAppliedFor || 'Position';
  const subtitle = loadingCandidate
    ? 'Loading...'
    : candidateError
      ? 'Candidate not available'
      : `${displayName} - ${displayPosition}`;
  const candidateCardName = loadingCandidate ? 'Loading...' : candidateError ? '—' : displayName;

  const isRtl = currentLang === 'ar' || currentLang === 'ku';
  const linkBlocked =
    session.linkConsumed || (!loadingCandidate && isVoiceInterviewLinkConsumed(candidate));

  if (linkBlocked) {
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
        subtitle={subtitle !== 'Loading...' && !candidateError ? subtitle : t('voiceInterviewPrep_subtitle')}
        onContinue={() => setPrepDone(true)}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
    );
  }

  return (
    <VoiceInterviewStage
      title={t('publicScreening_title')}
      subtitle={subtitle}
      candidateName={candidateCardName}
      session={session}
      canStart={!!resolvedPersonId && !session.linkConsumed}
      startHint={!resolvedPersonId ? 'Add candidateId to the URL to start the interview' : null}
      recordingNotice={t('voiceInterview_recordingNotice')}
    />
  );
};

export default Interview;
