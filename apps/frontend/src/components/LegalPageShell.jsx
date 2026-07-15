import React from 'react';
import Footer from './Footer';

/**
 * Shell for About, Contact, Privacy, Terms, Data & Security.
 * Content comes from translations; replace keys or wire to CMS/API later.
 */
export default function LegalPageShell({ children, title, variant = 'default', preActionsContent = null, afterContent = null }) {
    const shellClass =
        variant === 'features'
            ? 'legal-page-shell legal-page-shell--features'
            : variant === 'agent'
              ? 'legal-page-shell legal-page-shell--agent'
              : 'legal-page-shell';

    return (
        <>
            <main className={shellClass}>
                <div className="legal-page-container">
                    <header className="legal-page-header">
                        <h1 className="legal-page-title">{title}</h1>
                    </header>
                    <article className="legal-page-article">{children}</article>
                </div>
                {preActionsContent}
                {afterContent}
            </main>
            <Footer />
        </>
    );
}
