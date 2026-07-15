import React from 'react';

export default function HeadHunterResultsSkeleton({ count = 6 }) {
    return (
        <div className="headhunter-skeleton-grid" aria-busy="true" aria-label="Loading">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="headhunter-skeleton-card">
                    <div className="headhunter-skeleton headhunter-skeleton--avatar" />
                    <div className="headhunter-skeleton headhunter-skeleton--line-lg" />
                    <div className="headhunter-skeleton headhunter-skeleton--line-md" />
                    <div className="headhunter-skeleton headhunter-skeleton--line-sm" />
                    <div className="headhunter-skeleton headhunter-skeleton--chips" />
                </div>
            ))}
        </div>
    );
}
