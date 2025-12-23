import React from 'react';
import Hero from '../components/Hero';
import Features from '../components/Features';
import Process from '../components/Process';
import CTA from '../components/CTA';
import Footer from '../components/Footer';
import VapiWidget from '../components/VapiWidget';
import { vapiAssistants } from '../config/vapiAssistants';

const Home = () => {
    return (
        <>
            <Hero />
            <Features />
            <Process />
            <CTA />
            <Footer />
            
            {/* Vapi Widget - evaalo (Main Assistant) */}
            <VapiWidget
                apiKey={vapiAssistants.evaalo.apiKey}
                assistantId={vapiAssistants.evaalo.assistantId}
                config={vapiAssistants.evaalo.config}
            />
        </>
    );
};

export default Home;

