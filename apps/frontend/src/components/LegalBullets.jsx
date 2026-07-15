import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';

/** Newline-less bullet list used on Privacy / Terms / Data & Security pages. */
export default function LegalBullets({ items }) {
    const { currentLang } = useLanguage();
    if (!items?.length) return null;
    return (
        <ul>
            {items.map((line, i) => (
                <li key={i}>{localizeLegalBrandText(line, currentLang)}</li>
            ))}
        </ul>
    );
}
