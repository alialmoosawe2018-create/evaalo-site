import React from 'react';
import Hero from '../components/Hero';
import WhyEvaalo from '../components/WhyEvaalo';
import Features from '../components/Features';
import Process from '../components/Process';
import CTA from '../components/CTA';
import Footer from '../components/Footer';

const Home = () => {
    return (
        <>
            <Hero />
            <WhyEvaalo />
            <Features />
            <Process />
            <CTA />
            <Footer />
        </>
    );
};

export default Home;

