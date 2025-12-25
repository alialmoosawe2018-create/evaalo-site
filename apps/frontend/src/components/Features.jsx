import React from 'react';

const Features = () => {
    const visualLanguageIcons = [
        { img: 'icon9-removebg-preview.png', title: 'Vision & Insights', desc: 'Short description here – you can write a note or comment about this icon.' },
        { img: 'icon10-removebg-preview.png', title: 'Voice & Communication', desc: 'Short description here – add your own text to explain this icon.' },
        { img: 'icon11-removebg-preview.png', title: 'Global Reach', desc: 'Short description here – suitable for "Anytime, Anywhere" concepts.' },
        { img: 'icon12-removebg-preview.png', title: 'AI & Smart Decisions', desc: 'Short description here – add your comment or label for this icon.' },
        { img: 'icon13-removebg-preview.png', title: 'Audio & Sound', desc: 'Short description here – add your comment or label for this icon.' },
        { img: 'icon17-removebg-preview.png', title: 'Technology', desc: 'Short description here – add your comment or label for this icon.' },
        { img: 'icon2-removebg-preview.png', title: 'Security & Privacy', desc: 'Short description here – focused on data protection and secure processes.' },
        { img: 'icon16-removebg-preview.png', title: 'Analytics & Reports', desc: 'Short description here – data visualization and comprehensive reporting tools.' }
    ];

    const whyChooseFeatures = [
        { img: 'icon3-removebg-preview.png', title: 'Smart & Fair Evaluation', desc: 'AI-based assessments without human bias for accurate candidate scoring.' },
        { img: 'icon14-removebg-preview.png', title: 'Interview Anytime, Anywhere', desc: 'Candidates complete interviews autonomously — no scheduling or interviewers required.' },
        { img: 'icon1-removebg-preview.png', title: 'Deep Skill Profiling', desc: 'Analysis of communication, confidence, body language, writing clarity, and problem-solving ability.' },
        { img: 'icon5-removebg-preview.png', title: 'Faster Hiring Decisions', desc: 'Instant evaluation reports that save your HR team time and effort.' },
        { img: 'icon15-removebg-preview.png', title: 'Advanced AI Technology', desc: 'Powered by state-of-the-art language and behavior analysis algorithms for maximum accuracy.' },
        { img: 'icon4-removebg-preview.png', title: 'Customizable to Your Needs', desc: 'Configure question sets, scoring rules, and interview formats to match your hiring criteria.' },
        { img: 'icon2-removebg-preview.png', title: 'Secure & Confidential', desc: 'Enterprise-grade security and data privacy compliance to protect candidate information.' },
        { img: 'icon16-removebg-preview.png', title: 'Scalable Solutions', desc: 'Handle high-volume hiring with automated interview processes that scale with your needs.' }
    ];

    return (
        <>
            <section className="features" id="features">
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">evaalo Visual Language</h2>
                        <p className="section-description">
                            Core visual icons used across the evaalo experience.
                        </p>
                    </div>
                    <div className="icon-highlights-grid">
                        {visualLanguageIcons.map((icon, index) => (
                            <div key={index} className="simple-icon-wrapper">
                                <div className="icon-wrapper-inner">
                                    <img src={`/images/${icon.img}`} alt={icon.title} className="simple-icon" />
                                </div>
                                <div className="icon-text-content">
                                    <h3 className="icon-label">{icon.title}</h3>
                                    <p className="icon-description">{icon.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="features" id="features-2">
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">Why Companies Choose evaalo</h2>
                        <p className="section-description">
                            We help companies evaluate candidates accurately and objectively through AI-powered voice, video, and written interviews.
                        </p>
                    </div>
                    <div className="icon-highlights-grid">
                        {whyChooseFeatures.map((feature, index) => (
                            <div key={index} className="icon-card">
                                <div className="icon-card-graphic">
                                    <img src={`/images/${feature.img}`} alt={`Icon ${index + 1}`} className="icon-card-image" />
                                </div>
                                <div className="icon-card-body">
                                    <h3 className="icon-card-title">{feature.title}</h3>
                                    <p className="icon-card-text">{feature.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
};

export default Features;

