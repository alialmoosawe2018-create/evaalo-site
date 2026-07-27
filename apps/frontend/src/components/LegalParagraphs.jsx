import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';

/** Paragraph blocks on Privacy / Terms / Data Security pages — brand name localized per locale. */
export default function LegalParagraphs({ paragraphs }) {
    const { currentLang } = useLanguage();
    if (!paragraphs?.length) return null;
    return paragraphs.map((text, i) => (
        <p key={i}>{localizeLegalBrandText(text, currentLang)}</p>
    ));
}
