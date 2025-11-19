// Dashboard Script
document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard data
    updateDashboardStats();
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            updateDashboardStats();
            showToast('Dashboard refreshed successfully!');
        });
    }
    
    // Export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            exportDashboardData();
        });
    }
    
    // Quick action buttons
    const createInterviewBtn = document.getElementById('createInterviewBtn');
    if (createInterviewBtn) {
        createInterviewBtn.addEventListener('click', function() {
            window.location.href = 'design.html';
        });
    }
    
    const viewCandidatesBtn = document.getElementById('viewCandidatesBtn');
    if (viewCandidatesBtn) {
        viewCandidatesBtn.addEventListener('click', function() {
            showToast('Candidates view coming soon!');
        });
    }
    
    const analyticsBtn = document.getElementById('analyticsBtn');
    if (analyticsBtn) {
        analyticsBtn.addEventListener('click', function() {
            showToast('Analytics view coming soon!');
        });
    }
    
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            showToast('Settings coming soon!');
        });
    }
    
    const viewAllBtn = document.getElementById('viewAllBtn');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', function() {
            showToast('View all interviews coming soon!');
        });
    }
    
    // Update dashboard stats
    function updateDashboardStats() {
        // Load data from localStorage or use default values
        const savedInterviews = localStorage.getItem('designerQuestions');
        const interviews = savedInterviews ? JSON.parse(savedInterviews) : [];
        
        const totalInterviews = interviews.length || 25;
        const completedInterviews = Math.floor(totalInterviews * 0.6) || 15;
        const pendingInterviews = totalInterviews - completedInterviews || 10;
        const totalCandidates = Math.floor(totalInterviews * 4.5) || 112;
        
        // Update stat values
        animateValue('totalInterviews', 0, totalInterviews, 1000);
        animateValue('completedInterviews', 0, completedInterviews, 1000);
        animateValue('pendingInterviews', 0, pendingInterviews, 1000);
        animateValue('totalCandidates', 0, totalCandidates, 1000);
    }
    
    // Animate number counting
    function animateValue(id, start, end, duration) {
        const element = document.getElementById(id);
        if (!element) return;
        
        const range = end - start;
        const increment = end > start ? 1 : -1;
        const stepTime = Math.abs(Math.floor(duration / range));
        let current = start;
        
        const timer = setInterval(function() {
            current += increment;
            element.textContent = current;
            if (current === end) {
                clearInterval(timer);
            }
        }, stepTime);
    }
    
    // Export dashboard data
    function exportDashboardData() {
        const data = {
            totalInterviews: document.getElementById('totalInterviews').textContent,
            completedInterviews: document.getElementById('completedInterviews').textContent,
            pendingInterviews: document.getElementById('pendingInterviews').textContent,
            totalCandidates: document.getElementById('totalCandidates').textContent,
            exportDate: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dashboard-data.json';
        link.click();
        URL.revokeObjectURL(url);
        
        showToast('Dashboard data exported successfully!');
    }
    
    // Show toast notification
    function showToast(message) {
        // Use existing toast if available, or create a simple alert
        const toast = document.getElementById('successToast');
        if (toast) {
            const toastMessage = document.getElementById('toastMessage');
            if (toastMessage) {
                toastMessage.textContent = message;
            }
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        } else {
            alert(message);
        }
    }
    
    // Initialize performance chart (simple canvas drawing)
    const chartCanvas = document.getElementById('performanceChart');
    if (chartCanvas) {
        drawPerformanceChart(chartCanvas);
    }
    
    function drawPerformanceChart(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Chart data
        const data = [65, 75, 80, 70, 85, 90, 88];
        const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const maxValue = 100;
        
        // Chart area
        const padding = 40;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;
        const barWidth = chartWidth / data.length;
        
        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
        }
        
        // Draw bars
        data.forEach((value, index) => {
            const barHeight = (value / maxValue) * chartHeight;
            const x = padding + index * barWidth + barWidth * 0.1;
            const y = padding + chartHeight - barHeight;
            
            // Gradient
            const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.8)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, barWidth * 0.8, barHeight);
            
            // Value label
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(value + '%', x + barWidth * 0.4, y - 5);
            
            // Day label
            ctx.fillStyle = '#94A3B8';
            ctx.font = '11px sans-serif';
            ctx.fillText(labels[index], x + barWidth * 0.4, height - padding + 20);
        });
    }
    
    // Redraw chart on window resize
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            if (chartCanvas) {
                drawPerformanceChart(chartCanvas);
            }
        }, 250);
    });
});

