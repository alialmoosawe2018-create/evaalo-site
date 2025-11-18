// Design Platform Script
document.addEventListener('DOMContentLoaded', function() {
    let questions = [];
    let editingQuestionIndex = null;
    let currentQuestionType = 'text';

    // Elements
    const questionModal = document.getElementById('questionModal');
    const closeModal = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveQuestionBtn = document.getElementById('saveQuestionBtn');
    const questionTypeBtns = document.querySelectorAll('.question-type-btn');
    const previewBtn = document.getElementById('previewBtn');
    const saveBtn = document.getElementById('saveBtn');
    const previewModal = document.getElementById('previewModal');
    const closePreview = document.getElementById('closePreview');
    const closePreviewBtn = document.getElementById('closePreviewBtn');
    const successToast = document.getElementById('successToast');
    const shareBtn = document.getElementById('shareBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShare = document.getElementById('closeShare');
    const copyShareBtn = document.getElementById('copyShareBtn');
    const shareLink = document.getElementById('shareLink');
    const shareEmail = document.getElementById('shareEmail');
    const shareQR = document.getElementById('shareQR');
    const shareDownload = document.getElementById('shareDownload');

    // Load saved data
    loadFromStorage();

    // Custom Color Dropdown
    const colorDropdown = document.getElementById('colorDropdown');
    const colorDropdownSelected = document.getElementById('colorDropdownSelected');
    const colorDropdownMenu = document.getElementById('colorDropdownMenu');
    const colorDropdownItems = document.querySelectorAll('.color-dropdown-item');
    
    function openColorDropdown() {
        colorDropdownMenu.classList.add('open');
        colorDropdownSelected.classList.add('open');
    }
    
    function closeColorDropdown() {
        colorDropdownMenu.classList.remove('open');
        colorDropdownSelected.classList.remove('open');
    }
    
    // Toggle dropdown
    colorDropdownSelected.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = colorDropdownMenu.classList.contains('open');
        
        if (isOpen) {
            closeColorDropdown();
        } else {
            openColorDropdown();
        }
    });
    
    // Select color
    colorDropdownItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const colorName = item.dataset.color;
            const primary = item.dataset.primary;
            const dark = item.dataset.dark;
            const text = item.querySelector('span').textContent;
            const colorBox = item.querySelector('.color-box').style.background;
            
            // Update selected display
            const selectedColorBox = colorDropdownSelected.querySelector('.color-box');
            const selectedText = colorDropdownSelected.querySelector('span');
            selectedColorBox.style.background = colorBox;
            selectedText.textContent = text;
            
            // Update active state
            colorDropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Apply theme
            applyColorTheme(primary, dark, text);
            
            // Save preference
            localStorage.setItem('formColorTheme', colorName);
            
            // Close dropdown
            closeColorDropdown();
            
            // Show notification
            showToast(`Theme changed to ${text.replace(' (Default)', '')}!`);
        });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (colorDropdown && !colorDropdown.contains(e.target)) {
            closeColorDropdown();
        }
    });
    
    // ====================================
    // Category Dropdown Functionality
    // ====================================
    const categoryDropdown = document.getElementById('categoryDropdown');
    const categoryDropdownSelected = document.getElementById('categoryDropdownSelected');
    const categoryDropdownMenu = document.getElementById('categoryDropdownMenu');
    const categoryDropdownItems = document.querySelectorAll('.category-dropdown-item');
    
    if (categoryDropdown && categoryDropdownSelected && categoryDropdownMenu && categoryDropdownItems.length > 0) {
        function openCategoryDropdown() {
            categoryDropdownMenu.classList.add('open');
            categoryDropdownSelected.classList.add('open');
        }
        
        function closeCategoryDropdown() {
            categoryDropdownMenu.classList.remove('open');
            categoryDropdownSelected.classList.remove('open');
        }
        
        // Toggle dropdown
        categoryDropdownSelected.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = categoryDropdownMenu.classList.contains('open');
            
            if (isOpen) {
                closeCategoryDropdown();
            } else {
                openCategoryDropdown();
            }
        });
        
        // Select category
        categoryDropdownItems.forEach(item => {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const categoryValue = item.dataset.category;
                const textSpan = item.querySelector('span');
                const iconDiv = item.querySelector('.category-icon');
                
                if (textSpan && iconDiv) {
                    const text = textSpan.textContent;
                    const icon = iconDiv.innerHTML;
                    
                    // Update selected display
                    const selectedIcon = categoryDropdownSelected.querySelector('.category-icon');
                    const selectedText = categoryDropdownSelected.querySelector('span');
                    
                    if (selectedIcon && selectedText) {
                        selectedIcon.innerHTML = icon;
                        selectedText.textContent = text;
                    }
                    
                    // Update active state
                    categoryDropdownItems.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    
                    // Save preference
                    localStorage.setItem('interviewCategory', categoryValue);
                    
                    // Save all settings to storage
                    if (typeof saveToStorage === 'function') {
                        saveToStorage();
                    }
                    
                    // Close dropdown
                    closeCategoryDropdown();
                    
                    // Show notification
                    if (typeof showToast === 'function') {
                        showToast(`Category set to ${text}!`);
                    }
                }
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!categoryDropdown.contains(e.target)) {
                closeCategoryDropdown();
            }
        });
        
        // Load saved category
        const savedCategory = localStorage.getItem('interviewCategory');
        if (savedCategory) {
            const savedCategoryItem = document.querySelector(`.category-dropdown-item[data-category="${savedCategory}"]`);
            if (savedCategoryItem) {
                const textSpan = savedCategoryItem.querySelector('span');
                const iconDiv = savedCategoryItem.querySelector('.category-icon');
                
                if (textSpan && iconDiv) {
                    const text = textSpan.textContent;
                    const icon = iconDiv.innerHTML;
                    
                    // Update selected display
                    const selectedIcon = categoryDropdownSelected.querySelector('.category-icon');
                    const selectedText = categoryDropdownSelected.querySelector('span');
                    
                    if (selectedIcon && selectedText) {
                        selectedIcon.innerHTML = icon;
                        selectedText.textContent = text;
                    }
                    
                    savedCategoryItem.classList.add('active');
                }
            }
        }
    }
    
    // Apply Color Theme
    function applyColorTheme(primary, dark, name) {
        const designMain = document.querySelector('.design-main');
        
        // Update ONLY the form editor area
        if (designMain) {
            designMain.style.background = `linear-gradient(135deg, ${primary}0D 0%, ${dark}08 100%)`;
            designMain.style.borderColor = `${primary}4D`;
            designMain.style.boxShadow = `0 8px 32px ${primary}1A`;
        }
        
        // Update question badges and form elements only
        const style = document.getElementById('dynamic-theme-style') || document.createElement('style');
        style.id = 'dynamic-theme-style';
        style.textContent = `
            .question-badge {
                background: linear-gradient(135deg, ${primary} 0%, ${dark} 100%) !important;
            }
            .question-type-label {
                background: ${primary}33 !important;
                border-color: ${primary}4D !important;
                color: ${primary} !important;
            }
            .question-card {
                background: ${primary}05 !important;
                border-color: ${primary}1A !important;
            }
            .question-card:hover {
                border-color: ${primary}80 !important;
                box-shadow: 0 8px 24px ${primary}33 !important;
            }
            .toolbar-btn {
                background: ${primary}1A !important;
                border-color: ${primary}4D !important;
            }
            .toolbar-btn:hover {
                background: ${primary}33 !important;
                border-color: ${primary} !important;
                box-shadow: 0 4px 12px ${primary}33 !important;
            }
            .toolbar-btn svg {
                color: ${primary} !important;
            }
            .stat-value {
                color: ${primary} !important;
            }
            .editor-toolbar {
                border-bottom-color: ${primary}1A !important;
            }
        `;
        if (!document.getElementById('dynamic-theme-style')) {
            document.head.appendChild(style);
        }
    }
    
    // Load saved theme
    const savedTheme = localStorage.getItem('formColorTheme') || 'blue';
    const savedItem = document.querySelector(`.color-dropdown-item[data-color="${savedTheme}"]`);
    if (savedItem) {
        const primary = savedItem.dataset.primary;
        const dark = savedItem.dataset.dark;
        const text = savedItem.querySelector('span').textContent;
        const colorBox = savedItem.querySelector('.color-box').style.background;
        
        // Update selected display
        const selectedColorBox = colorDropdownSelected.querySelector('.color-box');
        const selectedText = colorDropdownSelected.querySelector('span');
        selectedColorBox.style.background = colorBox;
        selectedText.textContent = text;
        
        savedItem.classList.add('active');
        applyColorTheme(primary, dark, text);
    }

    // Event Listeners

    // New header buttons (Model, Workflow, Connect)
    const modelBtn = document.getElementById('modelBtn');
    const workflowBtn = document.getElementById('workflowBtn');
    const connectBtn = document.getElementById('connectBtn');

    if (modelBtn) {
        modelBtn.addEventListener('click', () => {
            showToast('Model settings coming soon!');
        });
    }

    if (workflowBtn) {
        workflowBtn.addEventListener('click', () => {
            showToast('Workflow editor coming soon!');
        });
    }

    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            showToast('Connect integrations coming soon!');
        });
    }

    // Navigation Menu Toggle - Override landing-script.js if needed
    setTimeout(function() {
        const navMenuToggle = document.getElementById('navMenuToggle');
        const navMenu = document.getElementById('navMenu');
        const navMenuWrapper = navMenuToggle ? navMenuToggle.closest('.nav-menu-wrapper') : null;
        const navLinks = document.querySelectorAll('.nav-link');
        
        // Remove any existing event listeners by cloning the button
        if (navMenuToggle) {
            const newToggle = navMenuToggle.cloneNode(true);
            navMenuToggle.parentNode.replaceChild(newToggle, navMenuToggle);
            
            // Get the new reference
            const newNavMenuToggle = document.getElementById('navMenuToggle');
            const newNavMenu = document.getElementById('navMenu');
            const newNavMenuWrapper = newNavMenuToggle ? newNavMenuToggle.closest('.nav-menu-wrapper') : null;
            
            if (newNavMenuToggle && newNavMenu && newNavMenuWrapper) {
                // Ensure button is clickable
                newNavMenuToggle.style.pointerEvents = 'auto';
                newNavMenuToggle.style.cursor = 'pointer';
                newNavMenuToggle.style.zIndex = '10001';
                newNavMenuToggle.style.position = 'relative';
                
                // Add click event
                newNavMenuToggle.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    newNavMenuWrapper.classList.toggle('active');
                });
                
                // Close menu when clicking on any nav link
                navLinks.forEach(link => {
                    link.addEventListener('click', function() {
                        if (newNavMenuWrapper) {
                            newNavMenuWrapper.classList.remove('active');
                        }
                    });
                });
                
                // Close menu when clicking outside
                document.addEventListener('click', function(e) {
                    if (newNavMenuWrapper && newNavMenuWrapper.classList.contains('active')) {
                        if (!newNavMenu.contains(e.target) && 
                            !newNavMenuToggle.contains(e.target) && 
                            !newNavMenuWrapper.contains(e.target)) {
                            newNavMenuWrapper.classList.remove('active');
                        }
                    }
                });
            }
        }
    }, 100);

    // Mobile Sidebar Slide Panel
    const mobileSidebarToggle = document.getElementById('mobileSidebarToggle');
    const mobileSidebarClose = document.getElementById('mobileSidebarClose');
    const mobileSidebarOverlay = document.getElementById('mobileSidebarOverlay');
    const designSidebar = document.getElementById('designSidebar');
    
    let touchStartX = 0;
    let touchStartY = 0;
    let isDragging = false;
    let sidebarStartX = 0;
    
    function openMobileSidebar() {
        if (window.innerWidth <= 768) {
            designSidebar.classList.add('mobile-open');
            mobileSidebarOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
    
    function closeMobileSidebar() {
        designSidebar.classList.remove('mobile-open');
        mobileSidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    // Toggle sidebar on button click
    if (mobileSidebarToggle) {
        mobileSidebarToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                if (designSidebar.classList.contains('mobile-open')) {
                    closeMobileSidebar();
                } else {
                    openMobileSidebar();
                }
            }
        });
    }
    
    // Close sidebar on close button click
    if (mobileSidebarClose) {
        mobileSidebarClose.addEventListener('click', function(e) {
            e.stopPropagation();
            closeMobileSidebar();
        });
    }
    
    // Close sidebar on overlay click
    if (mobileSidebarOverlay) {
        mobileSidebarOverlay.addEventListener('click', function(e) {
            if (e.target === mobileSidebarOverlay) {
                closeMobileSidebar();
            }
        });
    }
    
    // Swipe gestures for mobile sidebar
    if (window.innerWidth <= 768 && designSidebar) {
        // Swipe from right edge to open
        document.addEventListener('touchstart', function(e) {
            if (window.innerWidth > 768) return;
            
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            
            // Check if touch started from right edge (within 20px)
            if (touchStartX >= window.innerWidth - 20 && !designSidebar.classList.contains('mobile-open')) {
                isDragging = true;
                sidebarStartX = 0;
            }
        }, { passive: true });
        
        // Swipe on sidebar to close
        designSidebar.addEventListener('touchstart', function(e) {
            if (window.innerWidth > 768) return;
            if (!designSidebar.classList.contains('mobile-open')) return;
            
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isDragging = true;
            sidebarStartX = designSidebar.getBoundingClientRect().right;
        }, { passive: true });
        
        document.addEventListener('touchmove', function(e) {
            if (window.innerWidth > 768 || !isDragging) return;
            
            const touchCurrentX = e.touches[0].clientX;
            const touchCurrentY = e.touches[0].clientY;
            const deltaX = touchCurrentX - touchStartX;
            const deltaY = Math.abs(touchCurrentY - touchStartY);
            
            // Only process horizontal swipes
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
                e.preventDefault();
                
                if (!designSidebar.classList.contains('mobile-open')) {
                    // Opening from right edge
                    const translateX = Math.max(0, window.innerWidth - touchCurrentX);
                    designSidebar.style.transform = `translateX(${translateX}px)`;
                } else {
                    // Closing by swiping left
                    const translateX = Math.min(0, deltaX);
                    designSidebar.style.transform = `translateX(${translateX}px)`;
                }
            }
        }, { passive: false });
        
        document.addEventListener('touchend', function(e) {
            if (window.innerWidth > 768 || !isDragging) return;
            
            const touchEndX = e.changedTouches[0].clientX;
            const deltaX = touchEndX - touchStartX;
            const threshold = 50;
            
            if (!designSidebar.classList.contains('mobile-open')) {
                // Opening gesture
                if (deltaX < -threshold) {
                    openMobileSidebar();
                } else {
                    designSidebar.style.transform = '';
                    closeMobileSidebar();
                }
            } else {
                // Closing gesture
                if (deltaX > threshold) {
                    closeMobileSidebar();
                } else {
                    designSidebar.style.transform = '';
                    openMobileSidebar();
                }
            }
            
            isDragging = false;
            designSidebar.style.transform = '';
        }, { passive: true });
    }
    
    // Hide/show toggle button based on screen size
    function updateMobileSidebarToggle() {
        if (window.innerWidth <= 768) {
            if (mobileSidebarToggle) {
                mobileSidebarToggle.style.display = 'flex';
            }
            if (designSidebar) {
                designSidebar.classList.remove('mobile-open');
            }
            if (mobileSidebarOverlay) {
                mobileSidebarOverlay.classList.remove('active');
            }
        } else {
            if (mobileSidebarToggle) {
                mobileSidebarToggle.style.display = 'none';
            }
            if (designSidebar) {
                designSidebar.classList.remove('mobile-open');
            }
            if (mobileSidebarOverlay) {
                mobileSidebarOverlay.classList.remove('active');
            }
            document.body.style.overflow = '';
        }
    }
    
    // Initial check
    updateMobileSidebarToggle();
    
    // Update on resize
    window.addEventListener('resize', updateMobileSidebarToggle);

    if (questionTypeBtns && questionTypeBtns.length > 0) {
        questionTypeBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                const type = this.dataset.type;
                // Types that are coming soon
                const comingSoonTypes = ['video', 'matrix', 'ranking', 'hubspot', 'salesforce', 'browse-apps', 'stripe', 'google-drive', 'calendly'];
                
                if (!comingSoonTypes.includes(type)) {
                    editingQuestionIndex = null;
                    currentQuestionType = type;
                    openQuestionModal(type);
                } else {
                    showToast(`${getTypeLabel(type)} coming soon!`);
                }
            });
        });
    }

    if (closeModal) {
        closeModal.addEventListener('click', closeQuestionModal);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeQuestionModal);
    }
    if (closePreview) {
        closePreview.addEventListener('click', () => previewModal.classList.remove('show'));
    }
    if (closePreviewBtn) {
        closePreviewBtn.addEventListener('click', () => previewModal.classList.remove('show'));
    }
    if (closeShare) {
        closeShare.addEventListener('click', () => shareModal.classList.remove('show'));
    }

    if (saveQuestionBtn) {
        saveQuestionBtn.addEventListener('click', saveQuestion);
    }
    if (shareBtn) {
        shareBtn.addEventListener('click', showShareModal);
    }
    if (previewBtn) {
        previewBtn.addEventListener('click', showPreview);
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', saveInterview);
    }

    // Close modals on background click
    if (questionModal) {
        questionModal.addEventListener('click', (e) => {
            if (e.target === questionModal) closeQuestionModal();
        });
    }
    if (previewModal) {
        previewModal.addEventListener('click', (e) => {
            if (e.target === previewModal) previewModal.classList.remove('show');
        });
    }
    if (shareModal) {
        shareModal.addEventListener('click', (e) => {
            if (e.target === shareModal) shareModal.classList.remove('show');
        });
    }

    // Share functionality
    if (copyShareBtn && shareLink) {
        copyShareBtn.addEventListener('click', () => {
            shareLink.select();
            document.execCommand('copy');
            copyShareBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.3333 4L6 11.3333L2.66667 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Copied!
        `;
        setTimeout(() => {
            copyShareBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 6.75H8.25C7.42157 6.75 6.75 7.42157 6.75 8.25V15C6.75 15.8284 7.42157 16.5 8.25 16.5H15C15.8284 16.5 16.5 15.8284 16.5 15V8.25C16.5 7.42157 15.8284 6.75 15 6.75Z" stroke="currentColor" stroke-width="2"/>
                    <path d="M3.75 11.25H3C2.60218 11.25 2.22064 11.092 1.93934 10.8107C1.65804 10.5294 1.5 10.1478 1.5 9.75V3C1.5 2.60218 1.65804 2.22064 1.93934 1.93934C2.22064 1.65804 2.60218 1.5 3 1.5H9.75C10.1478 1.5 10.5294 1.65804 10.8107 1.93934C11.092 2.22064 11.25 2.60218 11.25 3V3.75" stroke="currentColor" stroke-width="2"/>
                </svg>
                Copy
            `;
        }, 2000);
            showToast('Link copied to clipboard!');
        });
    }

    if (shareEmail && shareLink) {
        shareEmail.addEventListener('click', () => {
            const title = document.getElementById('interviewTitle')?.value || 'Interview';
            const subject = encodeURIComponent(`${title} - Interview Link`);
            const body = encodeURIComponent(`You've been invited to take an interview. Click here: ${shareLink.value}`);
            window.open(`mailto:?subject=${subject}&body=${body}`);
        });
    }

    if (shareQR) {
        shareQR.addEventListener('click', () => {
            showToast('QR Code generation coming soon!');
        });
    }

    if (shareDownload) {
        shareDownload.addEventListener('click', () => {
            downloadInterview();
        });
    }

    // Open Question Modal
    function openQuestionModal(type) {
        currentQuestionType = type;
        const modalBody = document.getElementById('modalBody');
        const modalTitle = document.getElementById('modalTitle');
        
        modalTitle.textContent = editingQuestionIndex !== null ? 'Edit Question' : 'Add Question';
        saveQuestionBtn.textContent = editingQuestionIndex !== null ? 'Update Question' : 'Add Question';

        // Generate form based on type
        let formHTML = '';

        // Simple text-based questions
        if (type === 'short-text' || type === 'long-text' || type === 'email' || type === 'phone' || type === 'number' || type === 'url' || type === 'date' || type === 'time') {
            const placeholders = {
                'short-text': 'e.g., What is your name?',
                'long-text': 'e.g., Describe your experience...',
                'email': 'e.g., What is your email address?',
                'phone': 'e.g., What is your phone number?',
                'number': 'e.g., How many years of experience?',
                'url': 'e.g., What is your portfolio website?',
                'date': 'e.g., What is your available start date?',
                'time': 'e.g., What time works best for you?'
            };
            
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="${placeholders[type]}" required></textarea>
                </div>
                ${type === 'number' ? `
                <div class="modal-form-group">
                    <label>Min Value</label>
                    <input type="number" id="minValue" placeholder="e.g., 0">
                </div>
                <div class="modal-form-group">
                    <label>Max Value</label>
                    <input type="number" id="maxValue" placeholder="e.g., 100">
                </div>
                ` : ''}
                ${type === 'short-text' || type === 'long-text' ? `
                <div class="modal-form-group">
                    <label>Character Limit</label>
                    <input type="number" id="charLimit" placeholder="e.g., 500" min="10" max="5000">
                </div>
                ` : ''}
                <div class="modal-form-group">
                    <label>Time Limit (seconds)</label>
                    <input type="number" id="questionTime" placeholder="e.g., 120" min="10" max="600">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
                ${type === 'email' || type === 'phone' || type === 'url' ? `
                <div class="modal-form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="validateFormat">
                        <span class="checkmark"></span>
                        <span>Validate format</span>
                    </label>
                </div>
                ` : ''}
            `;
        } else if (type === 'voice') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Time Limit (seconds)</label>
                    <input type="number" id="questionTime" placeholder="e.g., 120" min="10" max="600">
                </div>
                <div class="modal-form-group">
                    <label>Max Recording Duration (seconds)</label>
                    <input type="number" id="maxDuration" placeholder="e.g., 60" min="10" max="300">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
                <div class="modal-form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="requireTranscript">
                        <span class="checkmark"></span>
                        <span>Require transcript of response</span>
                    </label>
                </div>
            `;
        } else if (type === 'multiple' || type === 'checkbox' || type === 'dropdown') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Answer Options</label>
                    <div class="options-builder">
                        <div class="option-input-group">
                            <input type="text" id="optionInput" placeholder="Enter an option...">
                            <button type="button" class="btn btn-secondary" id="addOptionBtn">Add Option</button>
                        </div>
                        <div id="optionsList"></div>
                    </div>
                </div>
                <div class="modal-form-group">
                    <label>Time Limit (seconds)</label>
                    <input type="number" id="questionTime" placeholder="e.g., 60" min="10" max="600">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        } else if (type === 'rating' || type === 'linear-scale') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>${type === 'rating' ? 'Star Rating' : 'Scale Range'}</label>
                    <select id="ratingScale">
                        ${type === 'rating' ? `
                            <option value="3">3 Stars</option>
                            <option value="5">5 Stars</option>
                            <option value="10">10 Stars</option>
                        ` : `
                            <option value="1-5">1 to 5</option>
                            <option value="0-10">0 to 10</option>
                            <option value="1-10">1 to 10</option>
                            <option value="1-7">1 to 7</option>
                        `}
                    </select>
                </div>
                ${type === 'linear-scale' ? `
                <div class="modal-form-group">
                    <label>Low Label</label>
                    <input type="text" id="lowLabel" placeholder="e.g., Not at all">
                </div>
                <div class="modal-form-group">
                    <label>High Label</label>
                    <input type="text" id="highLabel" placeholder="e.g., Extremely">
                </div>
                ` : ''}
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        } else if (type === 'yes-no') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Correct Answer (Optional)</label>
                    <select id="correctAnswer">
                        <option value="">Not graded</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
                <div class="modal-form-group">
                    <label>Time Limit (seconds)</label>
                    <input type="number" id="questionTime" placeholder="e.g., 30" min="10" max="600">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        } else if (type === 'file') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="e.g., Upload your resume..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Allowed File Types</label>
                    <select id="fileTypes" multiple>
                        <option value="pdf" selected>PDF</option>
                        <option value="doc" selected>Word (DOC/DOCX)</option>
                        <option value="image">Images (JPG, PNG)</option>
                        <option value="video">Video</option>
                        <option value="audio">Audio</option>
                    </select>
                    <span style="font-size: 12px; color: #94A3B8; margin-top: 5px;">Hold Ctrl/Cmd to select multiple</span>
                </div>
                <div class="modal-form-group">
                    <label>Max File Size (MB)</label>
                    <input type="number" id="maxFileSize" placeholder="e.g., 5" min="1" max="50" value="10">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        } else if (type === 'slider') {
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Minimum Value</label>
                    <input type="number" id="sliderMin" placeholder="e.g., 0" value="0">
                </div>
                <div class="modal-form-group">
                    <label>Maximum Value</label>
                    <input type="number" id="sliderMax" placeholder="e.g., 100" value="100">
                </div>
                <div class="modal-form-group">
                    <label>Step Increment</label>
                    <input type="number" id="sliderStep" placeholder="e.g., 1" value="1" min="1">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        } else if (type === 'multiple' || type === 'checkbox' || type === 'dropdown') {
            const typeLabels = {
                'multiple': 'Single choice',
                'checkbox': 'Multiple choices allowed',
                'dropdown': 'Dropdown selection'
            };
            
            formHTML = `
                <div class="modal-form-group">
                    <label>Question Text *</label>
                    <textarea id="questionText" placeholder="Enter your question here..." required></textarea>
                </div>
                <div class="modal-form-group">
                    <label>Answer Options (${typeLabels[type]})</label>
                    <div class="options-builder">
                        <div class="option-input-group">
                            <input type="text" id="optionInput" placeholder="Enter an option...">
                            <button type="button" class="btn btn-secondary" id="addOptionBtn">Add Option</button>
                        </div>
                        <div id="optionsList"></div>
                    </div>
                </div>
                ${type !== 'dropdown' ? `
                <div class="modal-form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="randomizeOptions">
                        <span class="checkmark"></span>
                        <span>Randomize option order</span>
                    </label>
                </div>
                ` : ''}
                <div class="modal-form-group">
                    <label>Time Limit (seconds)</label>
                    <input type="number" id="questionTime" placeholder="e.g., 60" min="10" max="600">
                </div>
                <div class="modal-form-group">
                    <label>Points</label>
                    <input type="number" id="questionPoints" placeholder="e.g., 10" min="1" max="100" value="10">
                </div>
            `;
        }

        modalBody.innerHTML = formHTML;

        // If editing, populate fields
        if (editingQuestionIndex !== null) {
            populateEditForm(questions[editingQuestionIndex]);
        }

        // Setup multiple choice specific handlers
        if (type === 'multiple' || type === 'checkbox' || type === 'dropdown') {
            setupMultipleChoiceHandlers();
        }

        questionModal.classList.add('show');
    }

    // Close Question Modal
    function closeQuestionModal() {
        questionModal.classList.remove('show');
        editingQuestionIndex = null;
    }

    // Setup Multiple Choice Handlers
    function setupMultipleChoiceHandlers() {
        const addOptionBtn = document.getElementById('addOptionBtn');
        const optionInput = document.getElementById('optionInput');

        if (!window.currentOptions) {
            window.currentOptions = [];
        }

        addOptionBtn.addEventListener('click', () => {
            const optionText = optionInput.value.trim();
            if (optionText) {
                window.currentOptions.push({
                    text: optionText,
                    correct: false
                });
                renderOptions();
                optionInput.value = '';
            }
        });

        optionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addOptionBtn.click();
            }
        });
    }

    // Render Options
    function renderOptions() {
        const optionsList = document.getElementById('optionsList');
        if (!optionsList) return;

        optionsList.innerHTML = window.currentOptions.map((option, index) => `
            <div class="option-item ${option.correct ? 'correct' : ''}">
                <span class="option-text">${option.text}</span>
                <div class="option-actions">
                    <button type="button" class="option-btn" onclick="toggleCorrect(${index})" title="Mark as correct">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13.3333 4L6 11.3333L2.66667 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button type="button" class="option-btn delete" onclick="deleteOption(${index})" title="Delete option">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Global functions for option management
    window.toggleCorrect = function(index) {
        window.currentOptions[index].correct = !window.currentOptions[index].correct;
        renderOptions();
    };

    window.deleteOption = function(index) {
        window.currentOptions.splice(index, 1);
        renderOptions();
    };

    // Populate Edit Form
    function populateEditForm(question) {
        document.getElementById('questionText').value = question.text;
        
        if (question.timeLimit) {
            document.getElementById('questionTime').value = question.timeLimit;
        }
        
        if (question.points) {
            document.getElementById('questionPoints').value = question.points;
        }

        if (question.type === 'multiple' && question.options) {
            window.currentOptions = [...question.options];
            renderOptions();
        }

        if (question.type === 'rating' && question.scale) {
            document.getElementById('ratingScale').value = question.scale;
        }
    }

    // Save Question
    function saveQuestion() {
        const questionText = document.getElementById('questionText')?.value.trim();
        if (!questionText) {
            alert('Please enter a question');
            return;
        }

        const questionData = {
            type: currentQuestionType,
            text: questionText,
            timeLimit: parseInt(document.getElementById('questionTime')?.value) || null,
            points: parseInt(document.getElementById('questionPoints')?.value) || 10,
        };

        // Type-specific data
        if (currentQuestionType === 'multiple' || currentQuestionType === 'checkbox' || currentQuestionType === 'dropdown') {
            if (!window.currentOptions || window.currentOptions.length < 2) {
                alert('Please add at least 2 options');
                return;
            }
            if (currentQuestionType !== 'checkbox' && !window.currentOptions.some(opt => opt.correct)) {
                alert('Please mark at least one option as correct');
                return;
            }
            questionData.options = [...window.currentOptions];
            questionData.randomizeOptions = document.getElementById('randomizeOptions')?.checked || false;
        } else if (currentQuestionType === 'rating' || currentQuestionType === 'linear-scale') {
            questionData.scale = document.getElementById('ratingScale')?.value || '5';
            if (currentQuestionType === 'linear-scale') {
                questionData.lowLabel = document.getElementById('lowLabel')?.value || '';
                questionData.highLabel = document.getElementById('highLabel')?.value || '';
            }
        } else if (currentQuestionType === 'yes-no') {
            questionData.correctAnswer = document.getElementById('correctAnswer')?.value || null;
        } else if (currentQuestionType === 'number') {
            questionData.minValue = parseInt(document.getElementById('minValue')?.value) || null;
            questionData.maxValue = parseInt(document.getElementById('maxValue')?.value) || null;
        } else if (currentQuestionType === 'short-text' || currentQuestionType === 'long-text') {
            questionData.charLimit = parseInt(document.getElementById('charLimit')?.value) || null;
        } else if (currentQuestionType === 'email' || currentQuestionType === 'phone' || currentQuestionType === 'url') {
            questionData.validateFormat = document.getElementById('validateFormat')?.checked || false;
        } else if (currentQuestionType === 'file') {
            const fileTypesSelect = document.getElementById('fileTypes');
            questionData.allowedTypes = Array.from(fileTypesSelect.selectedOptions).map(opt => opt.value);
            questionData.maxFileSize = parseInt(document.getElementById('maxFileSize')?.value) || 10;
        } else if (currentQuestionType === 'voice') {
            questionData.maxDuration = parseInt(document.getElementById('maxDuration')?.value) || null;
            questionData.requireTranscript = document.getElementById('requireTranscript')?.checked || false;
        } else if (currentQuestionType === 'slider') {
            questionData.sliderMin = parseInt(document.getElementById('sliderMin')?.value) || 0;
            questionData.sliderMax = parseInt(document.getElementById('sliderMax')?.value) || 100;
            questionData.sliderStep = parseInt(document.getElementById('sliderStep')?.value) || 1;
        }

        if (editingQuestionIndex !== null) {
            questions[editingQuestionIndex] = questionData;
        } else {
            questions.push(questionData);
        }

        window.currentOptions = [];
        closeQuestionModal();
        updateStats();
        saveToStorage();
        showToast('Question saved successfully!');
    }


    // Get Type Label
    function getTypeLabel(type) {
        const labels = {
            'short-text': 'Short Answer',
            'long-text': 'Paragraph',
            'multiple': 'Multiple Choice',
            'checkbox': 'Checkboxes',
            'dropdown': 'Dropdown',
            'rating': 'Rating Scale',
            'linear-scale': 'Linear Scale',
            'opinion-scale': 'Opinion Scale',
            'yes-no': 'Yes/No',
            'date': 'Date',
            'time': 'Time',
            'email': 'Email',
            'phone': 'Phone Number',
            'contact-info': 'Contact Info',
            'address': 'Address',
            'number': 'Number',
            'url': 'Website URL',
            'file': 'File Upload',
            'voice': 'Voice Recording',
            'video': 'Video Recording',
            'picture-choice': 'Picture Choice',
            'legal': 'Legal',
            'clarify-ai': 'Clarify with AI',
            'faq-ai': 'FAQ with AI',
            'hubspot': 'HubSpot',
            'salesforce': 'Salesforce',
            'browse-apps': 'Browse all apps',
            'stripe': 'Stripe',
            'google-drive': 'Google Drive',
            'calendly': 'Calendly',
            'nps': 'Net Promoter Score',
            'ranking': 'Ranking',
            'matrix': 'Matrix/Grid',
            'slider': 'Slider',
            'welcome-screen': 'Welcome Screen',
            'partial-submit': 'Partial Submit Point',
            'statement': 'Statement',
            'question-group': 'Question Group',
            'end-screen': 'End Screen',
            'redirect': 'Redirect to URL'
        };
        return labels[type] || type;
    }


    // Update Stats
    function updateStats() {
        document.getElementById('questionCount').textContent = questions.length;
        
        const totalTime = questions.reduce((sum, q) => sum + (q.timeLimit || 0), 0);
        const estimatedMinutes = Math.ceil(totalTime / 60);
        document.getElementById('estimatedTime').textContent = `${estimatedMinutes} min`;
    }

    // Show Share Modal
    function showShareModal() {
        if (questions.length === 0) {
            alert('Add at least one question before sharing');
            return;
        }
        
        // Save interview data and generate share link
        const interviewData = {
            title: document.getElementById('interviewTitle').value || 'Untitled Interview',
            category: localStorage.getItem('interviewCategory') || 'general',
            timeLimit: document.getElementById('timeLimit').value,
            passingScore: document.getElementById('passingScore').value,
            randomizeQuestions: document.getElementById('randomizeQuestions').checked,
            showResults: document.getElementById('showResults').checked,
            enableAIAnalysis: document.getElementById('enableAIAnalysis').checked,
            questions: questions,
            settings: {
                title: document.getElementById('interviewTitle').value || 'Untitled Interview',
                category: localStorage.getItem('interviewCategory') || 'general',
                timeLimit: document.getElementById('timeLimit').value,
                passingScore: document.getElementById('passingScore').value,
                randomizeQuestions: document.getElementById('randomizeQuestions').checked,
                showResults: document.getElementById('showResults').checked,
                enableAIAnalysis: document.getElementById('enableAIAnalysis').checked
            },
            createdAt: new Date().toISOString()
        };

        // Generate unique short form ID (8-10 characters)
        const formId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36).substring(2, 8);
        
        // Save form data to localStorage with formId and timestamp (for same device)
        const formDataString = JSON.stringify(interviewData);
        const formStorage = {
            data: interviewData,
            timestamp: Date.now(),
            expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        };
        localStorage.setItem(`evaalo_form_${formId}`, JSON.stringify(formStorage));
        
        // Compress and encode data for URL (for cross-device sharing)
        // Use formId for short link, data for actual content
        let compressedData = '';
        try {
            // Advanced minification: remove all unnecessary whitespace only
            // Keep JSON structure intact for proper parsing
            const minified = JSON.stringify(interviewData).replace(/\s+/g, '');
            
            // Encode to base64 with URL-safe characters
            compressedData = btoa(unescape(encodeURIComponent(minified)))
                .replace(/\+/g, '-')  // Replace + with - (URL-safe)
                .replace(/\//g, '_')  // Replace / with _ (URL-safe)
                .replace(/=+$/, '');  // Remove padding
        } catch (error) {
            // Fallback: simple base64 encoding
            const simpleMinified = formDataString.replace(/\s+/g, '');
            compressedData = btoa(unescape(encodeURIComponent(simpleMinified)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }
        
        // Generate share link
        // Primary: formId only (works for same device)
        // Fallback: formId + data (works across devices)
        const currentUrl = window.location.origin + window.location.pathname.replace('design.html', '');
        
        // Always include data in URL for cross-device compatibility
        // formId is kept for reference and localStorage lookup
        const shareUrl = `${currentUrl}form-preview.html?id=${formId}&d=${compressedData}`;
        
        shareLink.value = shareUrl;
        
        // Also save to a global forms list for management
        let formsList = JSON.parse(localStorage.getItem('evaalo_forms_list') || '[]');
        formsList.push({
            id: formId,
            title: interviewData.title,
            createdAt: Date.now()
        });
        // Keep only last 50 forms
        if (formsList.length > 50) {
            formsList = formsList.slice(-50);
        }
        localStorage.setItem('evaalo_forms_list', JSON.stringify(formsList));
        
        shareModal.classList.add('show');
    }

    // Show Preview
    function showPreview() {
        const previewBody = document.getElementById('previewBody');
        const title = document.getElementById('interviewTitle').value || 'Untitled Interview';
        
        if (questions.length === 0) {
            alert('Add at least one question to preview');
            return;
        }

        previewBody.innerHTML = `
            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="color: #fff; font-size: 28px; margin-bottom: 10px;">${title}</h2>
                <p style="color: rgba(255,255,255,0.7); font-size: 16px;">Total Questions: ${questions.length}</p>
            </div>
            ${questions.map((q, index) => `
                <div style="margin-bottom: 30px; padding: 25px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 15px;">
                        <span style="padding: 6px 12px; background: linear-gradient(135deg, #3B82F6, #8B5CF6); border-radius: 8px; color: #fff; font-weight: 700; font-size: 13px;">Q${index + 1}</span>
                        <span style="padding: 6px 12px; background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.3); border-radius: 8px; color: #60A5FA; font-weight: 600; font-size: 12px;">${getTypeLabel(q.type)}</span>
                    </div>
                    <p style="color: #F8FAFC; font-size: 16px; font-weight: 600; margin-bottom: 15px; line-height: 1.6;">${q.text}</p>
                    ${q.timeLimit || q.points ? `<p style="color: #94A3B8; font-size: 14px; margin-top: 10px;">${q.timeLimit ? `⏱️ ${q.timeLimit}s` : ''} ${q.points ? `⭐ ${q.points} points` : ''}</p>` : ''}
                </div>
            `).join('')}
        `;

        previewModal.classList.add('show');
    }

    // Save Interview
    function saveInterview() {
        if (questions.length === 0) {
            alert('Add at least one question before saving');
            return;
        }

        const interviewData = {
            title: document.getElementById('interviewTitle').value || 'Untitled Interview',
            category: localStorage.getItem('interviewCategory') || 'general',
            timeLimit: document.getElementById('timeLimit').value,
            passingScore: document.getElementById('passingScore').value,
            randomizeQuestions: document.getElementById('randomizeQuestions').checked,
            showResults: document.getElementById('showResults').checked,
            enableAIAnalysis: document.getElementById('enableAIAnalysis').checked,
            questions: questions,
            createdAt: new Date().toISOString()
        };

        saveToStorage();
        showToast('Interview saved successfully!');
        
        // Could send to backend here
    }


    // Download Interview
    function downloadInterview() {
        if (questions.length === 0) {
            alert('Add at least one question before downloading');
            return;
        }

        const interviewData = {
            title: document.getElementById('interviewTitle').value || 'Untitled Interview',
            category: localStorage.getItem('interviewCategory') || 'general',
            timeLimit: document.getElementById('timeLimit').value,
            passingScore: document.getElementById('passingScore').value,
            randomizeQuestions: document.getElementById('randomizeQuestions').checked,
            showResults: document.getElementById('showResults').checked,
            questions: questions,
            createdAt: new Date().toISOString()
        };

        const dataStr = JSON.stringify(interviewData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${interviewData.title.replace(/\s+/g, '_')}_${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showToast('Interview downloaded successfully!');
        shareModal.classList.remove('show');
    }

    // Show Toast
    function showToast(message) {
        const toast = document.getElementById('successToast');
        const toastMessage = document.getElementById('toastMessage');
        toastMessage.textContent = message;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // Storage Functions
    function saveToStorage() {
        localStorage.setItem('designerQuestions', JSON.stringify(questions));
        localStorage.setItem('designerSettings', JSON.stringify({
            title: document.getElementById('interviewTitle').value,
            category: localStorage.getItem('interviewCategory') || '',
            timeLimit: document.getElementById('timeLimit').value,
            passingScore: document.getElementById('passingScore').value,
            randomizeQuestions: document.getElementById('randomizeQuestions').checked,
            showResults: document.getElementById('showResults').checked,
            enableAIAnalysis: document.getElementById('enableAIAnalysis').checked
        }));
    }

    function loadFromStorage() {
        const savedQuestions = localStorage.getItem('designerQuestions');
        const savedSettings = localStorage.getItem('designerSettings');
        
        if (savedQuestions) {
            questions = JSON.parse(savedQuestions);
            updateStats();
        }
        
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            document.getElementById('interviewTitle').value = settings.title || '';
            
            // Category is handled by custom dropdown - save to localStorage
            if (settings.category) {
                localStorage.setItem('interviewCategory', settings.category);
            }
            
            document.getElementById('timeLimit').value = settings.timeLimit || '';
            document.getElementById('passingScore').value = settings.passingScore || '';
            document.getElementById('randomizeQuestions').checked = settings.randomizeQuestions || false;
            document.getElementById('showResults').checked = settings.showResults || false;
            document.getElementById('enableAIAnalysis').checked = settings.enableAIAnalysis !== undefined ? settings.enableAIAnalysis : true;
        }
    }

    // Auto-save on settings change
    const settingsInputs = ['interviewTitle', 'timeLimit', 'passingScore', 'randomizeQuestions', 'showResults', 'enableAIAnalysis'];
    settingsInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', function() {
                saveToStorage();
                showToast('Settings saved!');
            });
            if (element.type === 'text' || element.type === 'number') {
                element.addEventListener('input', saveToStorage);
            }
        }
    });
});

// Global Voice Recording Demo Handler
window.handleVoiceDemo = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const btn = event.currentTarget;
    const preview = btn.closest('.voice-recorder-preview');
    const status = preview.querySelector('.recorder-status');
    
    if (!btn.classList.contains('recording') && !btn.classList.contains('recorded')) {
        // Start recording
        startRecordingDemo(btn);
    } else if (btn.classList.contains('recording')) {
        // If already recording, clicking the button does nothing (use Stop button instead)
        return;
    }
};

// Start Recording Function
window.startRecordingDemo = function(btn) {
    const preview = btn.closest('.voice-recorder-preview');
    const status = preview.querySelector('.recorder-status');
    
    // Start recording
    btn.classList.add('recording');
    btn.classList.remove('recorded');
    status.textContent = 'Recording in progress...';
    
    // Enable button during recording (for visual feedback)
    btn.style.pointerEvents = 'auto';
    
    // Get max duration from data attribute (set from question settings)
    const maxDuration = parseInt(preview.getAttribute('data-max-duration')) || 60;
    
    // Create timer
    let seconds = 0;
    
    // Add timer display
    let timerDiv = preview.querySelector('.recording-timer');
    if (!timerDiv) {
        timerDiv = document.createElement('div');
        timerDiv.className = 'recording-timer';
        status.after(timerDiv);
    }
    timerDiv.style.display = 'block';
    
    // Add waveform visualization
    let waveform = preview.querySelector('.waveform-preview');
    if (!waveform) {
        waveform = document.createElement('div');
        waveform.className = 'waveform-preview';
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'waveform-bar';
            bar.style.height = '10px';
            waveform.appendChild(bar);
        }
        timerDiv.after(waveform);
    }
    waveform.style.display = 'flex';
    
    // Show Stop and Re-record buttons during recording
    let recordingControls = preview.querySelector('.recording-controls');
    if (!recordingControls) {
        recordingControls = document.createElement('div');
        recordingControls.className = 'recording-controls';
        preview.appendChild(recordingControls);
    }
    
    recordingControls.innerHTML = `
        <button class="control-btn stop-btn" onclick="stopRecordingDemo(event)">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor"/>
            </svg>
            Stop
        </button>
        <button class="control-btn restart-btn" onclick="restartRecordingDemo(event)">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.33333 10C3.33333 6.31746 6.31746 3.33333 10 3.33333C13.6825 3.33333 16.6667 6.31746 16.6667 10C16.6667 13.6825 13.6825 16.6667 10 16.6667" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M10 6.66667V10L12.5 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Re-record
        </button>
    `;
    recordingControls.style.display = 'flex';
    
    // Timer interval
    btn.recordingInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerDiv.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        // Animate waveform
        const bars = waveform.querySelectorAll('.waveform-bar');
        bars.forEach(bar => {
            bar.style.height = `${Math.random() * 35 + 5}px`;
        });
        
        // Stop recording when max duration is reached
        if (seconds >= maxDuration) {
            window.finishRecordingDemo(btn);
        }
    }, 1000);
    
    // Store seconds in button for access
    btn.recordingSeconds = 0;
    btn.recordingMaxDuration = maxDuration;
};

// Stop Recording Function
window.stopRecordingDemo = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const preview = event.currentTarget.closest('.voice-recorder-preview');
    const btn = preview.querySelector('.voice-record-btn');
    
    if (btn && btn.classList.contains('recording')) {
        window.finishRecordingDemo(btn);
    }
};

// Restart Recording Function
window.restartRecordingDemo = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const preview = event.currentTarget.closest('.voice-recorder-preview');
    const btn = preview.querySelector('.voice-record-btn');
    
    if (btn) {
        // Reset everything
        resetRecordingDemo(preview);
        // Start recording again
        window.startRecordingDemo(btn);
    }
};

window.finishRecordingDemo = function(btn) {
    const preview = btn.closest('.voice-recorder-preview');
    const status = preview.querySelector('.recorder-status');
    
    btn.classList.remove('recording');
    btn.classList.add('recorded');
    btn.style.pointerEvents = 'auto';
    status.textContent = 'Recording stopped';
    
    if (btn.recordingInterval) {
        clearInterval(btn.recordingInterval);
        btn.recordingInterval = null;
    }
    
    // Hide waveform but keep timer visible
    const waveform = preview.querySelector('.waveform-preview');
    if (waveform) {
        waveform.style.display = 'none';
    }
    
    // Update controls to show Re-record and Send/Delete options
    let controls = preview.querySelector('.recording-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'recording-controls';
        preview.appendChild(controls);
    }
    
    controls.innerHTML = `
        <button class="control-btn restart-btn" onclick="restartRecordingDemo(event)">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.33333 10C3.33333 6.31746 6.31746 3.33333 10 3.33333C13.6825 3.33333 16.6667 6.31746 16.6667 10C16.6667 13.6825 13.6825 16.6667 10 16.6667" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M10 6.66667V10L12.5 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Re-record
        </button>
        <button class="control-btn send-btn" onclick="sendRecordingDemo(event)">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.3333 1.66666L9.16667 10.8333M18.3333 1.66666L12.5 18.3333L9.16667 10.8333M18.3333 1.66666L1.66667 7.49999L9.16667 10.8333" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Send
        </button>
        <button class="control-btn delete-btn" onclick="deleteRecordingDemo(event)">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 5h15M8.33333 8.33333v5M11.6667 8.33333v5M15.8333 5v11.6667a1.66667 1.66667 0 01-1.66667 1.66667H5.83333a1.66667 1.66667 0 01-1.66667-1.66667V5m2.5 0V3.33333a1.66667 1.66667 0 011.66667-1.66667h3.33333a1.66667 1.66667 0 011.66667 1.66667V5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Delete
        </button>
    `;
    controls.style.display = 'flex';
};

window.sendRecordingDemo = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const preview = event.currentTarget.closest('.voice-recorder-preview');
    const status = preview.querySelector('.recorder-status');
    
    status.textContent = 'Recording sent! ✓';
    status.style.color = '#22C55E';
    
    // Show toast
    const toast = document.getElementById('successToast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = 'Voice recording sent successfully!';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
    
    // Reset after delay
    setTimeout(() => {
        resetRecordingDemo(preview);
    }, 2000);
};

window.deleteRecordingDemo = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const preview = event.currentTarget.closest('.voice-recorder-preview');
    resetRecordingDemo(preview);
    
    // Show toast
    const toast = document.getElementById('successToast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = 'Recording deleted';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
};

function resetRecordingDemo(preview) {
    const btn = preview.querySelector('.voice-record-btn');
    const status = preview.querySelector('.recorder-status');
    const timer = preview.querySelector('.recording-timer');
    const waveform = preview.querySelector('.waveform-preview');
    const controls = preview.querySelector('.recording-controls');
    
    btn.classList.remove('recording', 'recorded');
    btn.style.display = 'flex';
    status.textContent = 'Ready to record';
    status.style.color = '';
    
    if (timer) {
        timer.style.display = 'none';
        timer.textContent = '';
    }
    if (waveform) {
        waveform.style.display = 'none';
    }
    if (controls) {
        controls.style.display = 'none';
        controls.innerHTML = '';
    }
    
    if (btn.recordingInterval) {
        clearInterval(btn.recordingInterval);
        btn.recordingInterval = null;
    }
}

