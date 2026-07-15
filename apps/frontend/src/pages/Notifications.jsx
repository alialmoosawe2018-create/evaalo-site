import React from 'react';
import '../design-styles.css';
import RecentInterviewsCard from '../components/RecentInterviewsCard';

const Notifications = () => {
    return (
        <div className="dashboard-page dashboard-page--evaalo-visual notifications-page">
            <div className="dashboard-visual-container container">
                <RecentInterviewsCard variant="notifications" />
            </div>
        </div>
    );
};

export default Notifications;
