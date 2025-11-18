// Design Platform Script
document.addEventListener('DOMContentLoaded', function() {
    let questions = [];
    let editingQuestionIndex = null;
    let currentQuestionType = 'text';

    // Initialize Sortable for drag and drop
    const questionsContainer = document.getElementById('questionsContainer');
    let sortable = null;


    // Elements
    const addQuestionBtn = document.getElementById('addQuestionBtn');
    const questionModal = document.getElementById('questionModal');
    const closeModal = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveQuestionBtn = document.getElementById('saveQuestionBtn');
    const questionTypeBtns = document.querySelectorAll('.question-type-btn');
    const previewBtn = document.getElementById('previewBtn');
    const saveBtn = document.getElementById('saveBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
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
    if (addQuestionBtn) {
        addQuestionBtn.addEventListener('click', () => {
            editingQuestionIndex = null;
            currentQuestionType = 'short-text';
            openQuestionModal('short-text');
        });
    }

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

    // Sidebar Drawer for Mobile
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const designSidebar = document.getElementById('designSidebar');
    
    // Create overlay element for mobile sidebar
    let sidebarOverlay = document.querySelector('.sidebar-overlay');
    if (!sidebarOverlay) {
        sidebarOverlay = document.createElement('div');
        sidebarOverlay.className = 'sidebar-overlay';
        document.body.appendChild(sidebarOverlay);
    }
    
    // Open/Close functions
    function openSidebar() {
        if (designSidebar) {
            designSidebar.classList.add('mobile-open');
            if (sidebarOverlay) {
                sidebarOverlay.classList.add('active');
            }
            // Add class to body to control z-index of main content
            document.body.classList.add('sidebar-open');
            // Prevent body scroll when drawer is open
            document.body.style.overflow = 'hidden';
        }
    }
    
    function closeSidebar() {
        if (designSidebar) {
            designSidebar.classList.remove('mobile-open');
            // Ensure sidebar is completely hidden
            designSidebar.style.transform = 'translateX(-100%)';
            designSidebar.style.opacity = '1';
            designSidebar.style.visibility = 'visible';
            
            if (sidebarOverlay) {
                sidebarOverlay.classList.remove('active');
                sidebarOverlay.style.opacity = '';
            }
            
            // Remove class from body
            document.body.classList.remove('sidebar-open');
            
            // Restore body scroll
            document.body.style.overflow = '';
            
            // Clean up any inline styles after transition
            setTimeout(() => {
                if (designSidebar && !designSidebar.classList.contains('mobile-open')) {
                    // Ensure no residual styles
                    designSidebar.style.transform = 'translateX(-100%)';
                }
            }, 350);
        }
    }
    
    // Show/hide toggle button based on screen size
    function updateSidebarToggle() {
        if (window.innerWidth <= 768) {
            if (sidebarToggleBtn) {
                sidebarToggleBtn.style.display = 'block';
            }
            if (sidebarCloseBtn) {
                sidebarCloseBtn.style.display = 'flex';
            }
            if (designSidebar) {
                // On mobile, sidebar should be hidden by default (drawer closed)
                closeSidebar();
                // Ensure sidebar is visible when rendered (not transparent)
                designSidebar.style.opacity = '1';
                designSidebar.style.visibility = 'visible';
                designSidebar.style.display = 'block';
            }
        } else {
            if (sidebarToggleBtn) {
                sidebarToggleBtn.style.display = 'none';
            }
            if (sidebarCloseBtn) {
                sidebarCloseBtn.style.display = 'none';
            }
            if (designSidebar) {
                // On desktop, sidebar should always be visible (sticky)
                closeSidebar();
                designSidebar.style.transform = 'translateX(0)';
                designSidebar.style.position = 'sticky';
                designSidebar.style.opacity = '1';
                designSidebar.style.visibility = 'visible';
                designSidebar.style.display = 'block';
            }
            if (sidebarOverlay) {
                sidebarOverlay.classList.remove('active');
            }
            // Restore body scroll on desktop
            document.body.style.overflow = '';
        }
    }
    
    // Initial check
    updateSidebarToggle();
    
    // Update on resize
    window.addEventListener('resize', updateSidebarToggle);
    
    // Open sidebar on toggle button click
    if (sidebarToggleBtn && designSidebar) {
        sidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSidebar();
        });
    }
    
    // Close sidebar on close button click
    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSidebar();
        });
    }
    
    // Close sidebar when clicking overlay (but not when clicking inside sidebar)
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', (e) => {
            // Only close if clicking directly on overlay, not on sidebar content
            if (e.target === sidebarOverlay) {
                closeSidebar();
            }
        });
    }
    
    // Prevent sidebar from closing when clicking inside it
    if (designSidebar) {
        // Use event delegation to prevent closing when interacting with any element inside sidebar
        designSidebar.addEventListener('click', (e) => {
            // Stop all clicks inside sidebar from bubbling to document level
            // This prevents the document click handler from closing the sidebar
            e.stopPropagation();
        }, true); // Use capture phase to catch events early
        
        designSidebar.addEventListener('touchstart', (e) => {
            // Same for touch events
            e.stopPropagation();
        }, true); // Use capture phase
    }
    
    // Close sidebar only when clicking outside (on mobile only)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            // Check if sidebar is open
            if (designSidebar && designSidebar.classList.contains('mobile-open')) {
                // Only close if clicking outside sidebar, toggle button, and overlay
                const clickedInsideSidebar = designSidebar.contains(e.target);
                const clickedOnToggle = sidebarToggleBtn && sidebarToggleBtn.contains(e.target);
                const clickedOnOverlay = sidebarOverlay && (e.target === sidebarOverlay);
                
                if (!clickedInsideSidebar && !clickedOnToggle && clickedOnOverlay) {
                    closeSidebar();
                }
            }
        }
    }, true); // Use capture phase to catch events early
    
    // Swipe Gestures for Mobile Drawer
    if (designSidebar) {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        let isDragging = false;
        let isOpeningFromEdge = false; // Track if we're opening from left edge
        let currentTranslate = 0;
        let minDragDistance = 0; // Track minimum drag distance to prevent accidental opens
        
        // Touch start - detect swipe from left edge ONLY
        document.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return; // Desktop only
            if (designSidebar.classList.contains('mobile-open')) return; // Don't interfere if already open
            
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            
            // Only allow opening from very left edge (within 15px) and only if sidebar is closed
            if (touchStartX <= 15 && !designSidebar.classList.contains('mobile-open')) {
                // Check if touch is not on an interactive element
                const target = e.target;
                const isInteractive = target.matches('button, a, input, select, textarea, .btn, .question-type-btn') ||
                                     target.closest('button, a, input, select, textarea, .btn, .question-type-btn');
                
                if (!isInteractive) {
                    isDragging = true;
                    isOpeningFromEdge = true;
                    currentTranslate = -100;
                    minDragDistance = 0;
                }
            }
        }, { passive: true });
        
        // Touch move - drag drawer open from left edge
        document.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 768 || !isDragging || !isOpeningFromEdge) return;
            if (designSidebar.classList.contains('mobile-open')) return; // Don't interfere if already open
            
            touchEndX = e.touches[0].clientX;
            touchEndY = e.touches[0].clientY;
            
            const deltaX = touchEndX - touchStartX;
            const deltaY = Math.abs(touchEndY - touchStartY);
            
            // Only allow horizontal swipe (not vertical scrolling)
            // Require minimum horizontal movement to prevent accidental opens
            if (deltaX > 20 && Math.abs(deltaX) > deltaY * 1.5) {
                e.preventDefault();
                
                // Calculate translate percentage
                const sidebarWidth = designSidebar.offsetWidth;
                currentTranslate = Math.max(-100, Math.min(0, (deltaX / sidebarWidth) * 100));
                minDragDistance = Math.max(minDragDistance, deltaX);
                
                // Apply transform
                designSidebar.style.transition = 'none';
                designSidebar.style.transform = `translateX(${currentTranslate}%)`;
                
                // Update overlay opacity
                if (sidebarOverlay) {
                    const opacity = Math.min(0.6, (100 + currentTranslate) / 100 * 0.6);
                    sidebarOverlay.style.opacity = opacity;
                }
            } else if (deltaY > 10 || Math.abs(deltaX) < 10) {
                // If vertical movement or too little horizontal movement, cancel
                isDragging = false;
                isOpeningFromEdge = false;
                designSidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                designSidebar.style.transform = 'translateX(-100%)';
                if (sidebarOverlay) {
                    sidebarOverlay.style.opacity = '';
                }
            }
        }, { passive: false });
        
        // Touch end - snap to open/close
        document.addEventListener('touchend', (e) => {
            if (window.innerWidth > 768 || !isDragging || !isOpeningFromEdge) {
                isDragging = false;
                isOpeningFromEdge = false;
                return;
            }
            
            isDragging = false;
            isOpeningFromEdge = false;
            
            // Restore smooth transition
            designSidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            
            // Only open if dragged at least 30% of sidebar width to prevent accidental opens
            const threshold = -70; // 70% of sidebar width must be revealed
            const minDragThreshold = 50; // Minimum pixels dragged
            
            if (currentTranslate > threshold && minDragDistance >= minDragThreshold) {
                // Open drawer
                designSidebar.style.transform = 'translateX(0)';
                openSidebar();
            } else {
                // Close drawer - snap back
                designSidebar.style.transform = 'translateX(-100%)';
                closeSidebar();
            }
            
            // Reset overlay opacity
            if (sidebarOverlay) {
                sidebarOverlay.style.opacity = '';
            }
            
            // Reset for next interaction
            minDragDistance = 0;
            currentTranslate = -100;
        }, { passive: true });
        
        // Swipe to close when drawer is open
        designSidebar.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return;
            
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            
            if (designSidebar.classList.contains('mobile-open')) {
                isDragging = true;
                currentTranslate = 0;
            }
        }, { passive: true });
        
        designSidebar.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 768 || !isDragging || !designSidebar.classList.contains('mobile-open')) return;
            
            touchEndX = e.touches[0].clientX;
            const deltaX = touchEndX - touchStartX;
            
            // Only allow swipe left (negative deltaX) to close
            if (deltaX < -5) { // Reduced threshold for more responsive dragging
                e.preventDefault();
                
                const sidebarWidth = designSidebar.offsetWidth;
                // Calculate translate percentage (negative = left, positive = right)
                currentTranslate = Math.max(-100, Math.min(0, (deltaX / sidebarWidth) * 100));
                
                // Disable transition during drag for smooth following
                designSidebar.style.transition = 'none';
                designSidebar.style.transform = `translateX(${currentTranslate}%)`;
                
                // Update overlay opacity based on drag progress
                if (sidebarOverlay) {
                    const opacity = Math.max(0, Math.min(0.6, (100 + currentTranslate) / 100 * 0.6));
                    sidebarOverlay.style.opacity = opacity;
                }
            }
        }, { passive: false });
        
        designSidebar.addEventListener('touchend', (e) => {
            if (window.innerWidth > 768 || !isDragging) return;
            
            isDragging = false;
            
            // Restore smooth transition
            designSidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            
            // Determine if should close or snap back based on drag distance and velocity
            const threshold = -25; // 25% of sidebar width - more sensitive for closing
            const velocity = Math.abs(currentTranslate); // Simple velocity check
            
            if (currentTranslate < threshold || velocity > 50) {
                // Close completely - ensure it goes fully off screen
                designSidebar.style.transform = 'translateX(-100%)';
                closeSidebar();
                
                // Ensure sidebar is completely hidden after animation
                setTimeout(() => {
                    if (designSidebar && !designSidebar.classList.contains('mobile-open')) {
                        designSidebar.style.transform = 'translateX(-100%)';
                        designSidebar.style.opacity = '1';
                        designSidebar.style.visibility = 'visible';
                    }
                }, 300); // Wait for transition to complete
            } else {
                // Snap back to open position
                designSidebar.style.transform = 'translateX(0)';
                openSidebar();
            }
            
            // Reset overlay opacity
            if (sidebarOverlay) {
                sidebarOverlay.style.opacity = '';
            }
            
            // Reset currentTranslate for next interaction
            currentTranslate = designSidebar.classList.contains('mobile-open') ? 0 : -100;
        }, { passive: true });
    }

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
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAll);
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
        renderQuestions();
        updateStats();
        saveToStorage();
        showToast('Question saved successfully!');
    }

    // Render Questions
    function renderQuestions() {
        if (questions.length === 0) {
            questionsContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
                        <path d="M60 40v40M40 60h40" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-linecap="round"/>
                    </svg>
                    <h3>No Questions Yet</h3>
                    <p>Click "Add Question" or choose a question type to get started</p>
                </div>
            `;
            if (sortable) sortable.destroy();
            return;
        }

        questionsContainer.innerHTML = questions.map((q, index) => `
            <div class="question-card" data-index="${index}">
                <div class="question-header">
                    <div class="question-number">
                        <span class="question-drag-handle">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </span>
                        <span class="question-badge">Q${index + 1}</span>
                        <span class="question-type-label">${getTypeLabel(q.type)}</span>
                    </div>
                    <div class="question-actions">
                        <button class="question-action-btn" onclick="editQuestion(${index})" title="Edit">
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8.25 3H3.75C3.15326 3 2.58097 3.23705 2.15901 3.65901C1.73705 4.08097 1.5 4.65326 1.5 5.25V14.25C1.5 14.8467 1.73705 15.419 2.15901 15.841C2.58097 16.2629 3.15326 16.5 3.75 16.5H12.75C13.3467 16.5 13.919 16.2629 14.341 15.841C14.7629 15.419 15 14.8467 15 14.25V9.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M13.875 1.875C14.3223 1.42774 14.9281 1.17667 15.5625 1.17667C16.1969 1.17667 16.8027 1.42774 17.25 1.875C17.6973 2.32226 17.9483 2.92806 17.9483 3.5625C17.9483 4.19694 17.6973 4.80274 17.25 5.25L9 13.5L6 14.25L6.75 11.25L15 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="question-action-btn" onclick="duplicateQuestion(${index})" title="Duplicate">
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15 6.75H8.25C7.42157 6.75 6.75 7.42157 6.75 8.25V15C6.75 15.8284 7.42157 16.5 8.25 16.5H15C15.8284 16.5 16.5 15.8284 16.5 15V8.25C16.5 7.42157 15.8284 6.75 15 6.75Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M3.75 11.25H3C2.60218 11.25 2.22064 11.092 1.93934 10.8107C1.65804 10.5294 1.5 10.1478 1.5 9.75V3C1.5 2.60218 1.65804 2.22064 1.93934 1.93934C2.22064 1.65804 2.60218 1.5 3 1.5H9.75C10.1478 1.5 10.5294 1.65804 10.8107 1.93934C11.092 2.22064 11.25 2.60218 11.25 3V3.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="question-action-btn delete" onclick="deleteQuestion(${index})" title="Delete">
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2.25 4.5h13.5M14.25 4.5v10.5a1.5 1.5 0 01-1.5 1.5h-7.5a1.5 1.5 0 01-1.5-1.5V4.5m2.25 0V3a1.5 1.5 0 011.5-1.5h3a1.5 1.5 0 011.5 1.5v1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="question-content">
                    <p class="question-text">${q.text}</p>
                    ${renderQuestionOptions(q)}
                </div>
                <div class="question-meta">
                    ${q.timeLimit ? `
                    <div class="question-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M8 4v4l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        ${q.timeLimit}s
                    </div>
                    ` : ''}
                    <div class="question-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 2l2 4 4 .5-3 3 .5 4-3.5-2-3.5 2 .5-4-3-3 4-.5 2-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                        ${q.points} points
                    </div>
                </div>
            </div>
        `).join('');

        // Initialize Sortable
        if (sortable) sortable.destroy();
        sortable = Sortable.create(questionsContainer, {
            animation: 150,
            handle: '.question-drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: function(evt) {
                const item = questions.splice(evt.oldIndex, 1)[0];
                questions.splice(evt.newIndex, 0, item);
                renderQuestions();
                saveToStorage();
            }
        });
    }

    // Render Question Options
    function renderQuestionOptions(question) {
        if ((question.type === 'multiple' || question.type === 'checkbox' || question.type === 'dropdown') && question.options) {
            const icon = question.type === 'checkbox' ? 'square' : 'circle';
            return `
                <div class="question-options">
                    ${question.options.map(opt => `
                        <div class="question-option ${opt.correct ? 'correct' : ''}">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                ${icon === 'circle' ? `
                                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                                    ${opt.correct ? '<path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' : ''}
                                ` : `
                                    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
                                    ${opt.correct ? '<path d="M4 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' : ''}
                                `}
                            </svg>
                            ${opt.text}
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (question.type === 'rating') {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    ⭐ ${question.scale || 5} Star Rating
                </div>
            `;
        } else if (question.type === 'linear-scale') {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    📊 Scale: ${question.scale || '1-5'}
                    ${question.lowLabel || question.highLabel ? `<br>${question.lowLabel || ''} ↔️ ${question.highLabel || ''}` : ''}
                </div>
            `;
        } else if (question.type === 'yes-no') {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    ${question.correctAnswer ? `✓ Correct Answer: ${question.correctAnswer.toUpperCase()}` : '❓ Not graded'}
                </div>
            `;
        } else if (question.type === 'slider') {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    🎚️ Range: ${question.sliderMin || 0} to ${question.sliderMax || 100} (step: ${question.sliderStep || 1})
                </div>
            `;
        } else if (question.type === 'file') {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    📎 Allowed: ${question.allowedTypes?.join(', ') || 'All files'} | Max: ${question.maxFileSize || 10}MB
                </div>
            `;
        } else if (question.type === 'voice') {
            const maxDuration = question.maxDuration || 60;
            return `
                <div style="margin-top: 15px;">
                    <div class="voice-recorder-preview" data-max-duration="${maxDuration}">
                        <div class="recorder-status">Ready to record</div>
                        <button class="voice-record-btn" onclick="handleVoiceDemo(event)">
                            <svg class="mic-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="11" y="4" width="6" height="12" rx="3" stroke="currentColor" stroke-width="2"/>
                                <path d="M8 14v1a6 6 0 0012 0v-1M14 22v3M14 25h-4M14 25h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                            <span class="record-text">Start Recording</span>
                        </button>
                        <div class="recorder-info">
                            <div style="color: #94A3B8; font-size: 13px;">
                                🎤 Max Duration: ${maxDuration}s
                                ${question.requireTranscript ? ' | 📝 Transcript required' : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (question.type === 'number') {
            const range = question.minValue !== null || question.maxValue !== null 
                ? `Range: ${question.minValue || 'Any'} - ${question.maxValue || 'Any'}`
                : 'Any number';
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    🔢 ${range}
                </div>
            `;
        } else if (question.charLimit) {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    📝 Character limit: ${question.charLimit}
                </div>
            `;
        } else if (question.validateFormat && (question.type === 'email' || question.type === 'phone' || question.type === 'url')) {
            return `
                <div style="color: #94A3B8; font-size: 14px; margin-top: 10px;">
                    ✓ Format validation enabled
                </div>
            `;
        }
        return '';
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

    // Global question management functions
    window.editQuestion = function(index) {
        editingQuestionIndex = index;
        currentQuestionType = questions[index].type;
        openQuestionModal(questions[index].type);
    };

    window.duplicateQuestion = function(index) {
        const duplicate = JSON.parse(JSON.stringify(questions[index]));
        questions.splice(index + 1, 0, duplicate);
        renderQuestions();
        updateStats();
        saveToStorage();
        showToast('Question duplicated!');
    };

    window.deleteQuestion = function(index) {
        if (confirm('Are you sure you want to delete this question?')) {
            questions.splice(index, 1);
            renderQuestions();
            updateStats();
            saveToStorage();
            showToast('Question deleted!');
        }
    };

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
            console.error('Error compressing data:', error);
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
                    ${renderQuestionOptions(q)}
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
        console.log('Interview Data:', interviewData);
    }

    // Clear All
    function clearAll() {
        if (confirm('Are you sure you want to clear all questions? This cannot be undone.')) {
            questions = [];
            renderQuestions();
            updateStats();
            saveToStorage();
            showToast('All questions cleared!');
        }
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
            renderQuestions();
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

