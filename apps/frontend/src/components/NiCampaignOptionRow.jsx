import React from 'react';
import { CampaignReadyIcon } from './CampaignReadyIcon.jsx';

/**
 * صف واحد في شاشة Campaign Ready — التصميم موحّد عبر CSS؛ المحتوى يأتي من `option`.
 *
 * كل صف يستهلك ثيم لونه عبر CSS variables (`--ni-c1`, `--ni-c2`) ليعطي:
 * - حافة hover ملوّنة بحسب نوع الخيار
 * - توهج خلفي خفيف
 * - أيقونة بمدرج لوني
 * - سهم دائري يظهر بنعومة عند المرور
 */
export default function NiCampaignOptionRow({ option, tokens, onClick }) {
    const accent = option.accent || option.color || '#3B82F6';
    const accent2 = option.accent2 || option.color || accent;

    return (
        <div
            className="ni-campaign-option-row"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            onClick={onClick}
            style={{
                '--ni-c1': accent,
                '--ni-c2': accent2,
            }}
        >
            <span className="ni-campaign-option-row__glow" aria-hidden />
            <span className="ni-campaign-option-row__shine" aria-hidden />

            <div className="ni-campaign-option-row__content">
                <div className="ni-campaign-option-row__icon-wrap">
                    <CampaignReadyIcon type={option.iconType} color="#ffffff" size={28} />
                </div>

                <div className="ni-campaign-option-row__text">
                    <h3 className="ni-campaign-option-row__title">{option.title}</h3>
                    <p className="ni-campaign-option-row__desc">{option.description}</p>
                </div>

                <div className="ni-campaign-option-chevron" dir="ltr" aria-hidden>
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden
                    >
                        <path
                            d="M5 12h14M13 5l7 7-7 7"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
}
