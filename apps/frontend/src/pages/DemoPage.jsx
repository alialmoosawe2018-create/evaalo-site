import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AvatarShowcase from '../components/AvatarShowcase';
import Features from '../components/Features';
import Footer from '../components/Footer';
import EvaaloReceptionChat from '../evaalo-only-chat/EvaaloReceptionChat';
import { useLanguage } from '../contexts/LanguageContext';

/** Landing content for Product → Overview (`/overview`). Features first, then voice/video/chat demos. */
export default function DemoPage() {
    const { currentLang } = useLanguage();
    const [searchParams, setSearchParams] = useSearchParams();
    const [chatOpen, setChatOpen] = useState(false);

    const voiceReceptionPath = useMemo(() => {
        const sessionLang =
            currentLang === 'en' ? 'en' : currentLang === 'ku' ? 'ku' : 'ar';
        return `/reception?language=${sessionLang}`;
    }, [currentLang]);

    useEffect(() => {
        if (searchParams.get('openChat') === '1') return;
        window.scrollTo(0, 0);
    }, [searchParams]);

    useEffect(() => {
        if (searchParams.get('openChat') !== '1') return;
        setChatOpen(true);
        const section = document.getElementById('avatar-showcase-3');
        if (section) {
            requestAnimationFrame(() => {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    }, [searchParams]);

    const handleCloseChat = useCallback(() => {
        setChatOpen(false);
        if (searchParams.get('openChat') === '1') {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('openChat');
                    return next;
                },
                { replace: true }
            );
        }
    }, [searchParams, setSearchParams]);

    return (
        <>
            <main className="demo-marketing-page">
                <Features showWhyChoose={false} variant="demo" />
                <AvatarShowcase />
                <AvatarShowcase
                    sectionId="avatar-showcase-audio"
                    ctaIcon="audio"
                    copyVariant="voice"
                    tryDemoTo={voiceReceptionPath}
                />
                <AvatarShowcase
                    sectionId="avatar-showcase-3"
                    ctaIcon="text"
                    copyVariant="chat"
                    onTryDemo={() => setChatOpen(true)}
                />
            </main>
            <EvaaloReceptionChat open={chatOpen} onClose={handleCloseChat} />
            <Footer />
        </>
    );
}
