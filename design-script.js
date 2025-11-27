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
    
    // ====================================
    // Editable Title Functionality
    // ====================================
    const questionsTitle = document.querySelector('.questions-title');
    if (questionsTitle) {
        // Load saved title
        const savedTitle = localStorage.getItem('questionsTitle');
        if (savedTitle) {
            questionsTitle.textContent = savedTitle;
        }
        
        // Save title on blur (when user finishes editing)
        questionsTitle.addEventListener('blur', function() {
            const titleText = this.textContent.trim();
            if (titleText) {
                localStorage.setItem('questionsTitle', titleText);
            } else {
                // If empty, restore placeholder
                this.textContent = this.dataset.placeholder || 'Interview Questions';
                localStorage.setItem('questionsTitle', this.textContent);
            }
        });
        
        // Prevent line breaks (keep it as single line)
        questionsTitle.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur();
            }
        });
        
        // Save on paste (after paste event)
        questionsTitle.addEventListener('paste', function(e) {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const plainText = text.replace(/\n/g, ' ').trim();
            document.execCommand('insertText', false, plainText);
        });
    }

    // Custom Color Dropdown - Form Color Theme
    const colorDropdown = document.getElementById('colorDropdown');
    const colorDropdownSelected = document.getElementById('colorDropdownSelected');
    const colorDropdownMenu = document.getElementById('colorDropdownMenu');
    // IMPORTANT: Only select items from the form color dropdown, NOT the question color dropdown
    const colorDropdownItems = document.querySelectorAll('#colorDropdownMenu .color-dropdown-item');
    
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
            
            // Update selected display - ONLY for form color dropdown
            const selectedColorBox = colorDropdownSelected.querySelector('.color-box');
            const selectedText = colorDropdownSelected.querySelector('span');
            selectedColorBox.style.background = colorBox;
            selectedText.textContent = text;
            
            // Update active state - ONLY for form color items
            colorDropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Apply theme - ONLY affects form container
            applyColorTheme(primary, dark, colorName);
            
            // Save preference - ONLY form color theme
            if (colorName === 'none') {
                localStorage.removeItem('formColorTheme');
            } else {
                localStorage.setItem('formColorTheme', colorName);
            }
            
            // DO NOT update background color theme - keep them separate
            
            // Close dropdown
            closeColorDropdown();
            
            // Show notification
            showToast(`Form color changed to ${text.replace(' (Default)', '')}!`);
        });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (colorDropdown && !colorDropdown.contains(e.target)) {
            closeColorDropdown();
        }
        if (backgroundColorDropdown && !backgroundColorDropdown.contains(e.target)) {
            closeBackgroundColorDropdown();
        }
    });
    
    // ====================================
    // Background Color Dropdown Functionality
    // ====================================
    const backgroundColorDropdown = document.getElementById('backgroundColorDropdown');
    const backgroundColorDropdownSelected = document.getElementById('backgroundColorDropdownSelected');
    const backgroundColorDropdownMenu = document.getElementById('backgroundColorDropdownMenu');
    const backgroundColorDropdownItems = document.querySelectorAll('#backgroundColorDropdownMenu .color-dropdown-item');
    
    function openBackgroundColorDropdown() {
        if (backgroundColorDropdownMenu) {
            backgroundColorDropdownMenu.classList.add('open');
            if (backgroundColorDropdownSelected) {
                backgroundColorDropdownSelected.classList.add('open');
            }
        }
    }
    
    function closeBackgroundColorDropdown() {
        if (backgroundColorDropdownMenu) {
            backgroundColorDropdownMenu.classList.remove('open');
            if (backgroundColorDropdownSelected) {
                backgroundColorDropdownSelected.classList.remove('open');
            }
        }
    }
    
    // Toggle dropdown
    if (backgroundColorDropdownSelected) {
        backgroundColorDropdownSelected.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = backgroundColorDropdownMenu && backgroundColorDropdownMenu.classList.contains('open');
            
            if (isOpen) {
                closeBackgroundColorDropdown();
            } else {
                openBackgroundColorDropdown();
            }
        });
    }
    
    // Select background color
    backgroundColorDropdownItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const colorName = item.dataset.color;
            const primary = item.dataset.primary;
            const dark = item.dataset.dark;
            const text = item.querySelector('span').textContent;
            const colorBox = item.querySelector('.color-box').style.background;
            
            // Update selected display - ONLY for background color dropdown
            if (backgroundColorDropdownSelected) {
                const selectedColorBox = backgroundColorDropdownSelected.querySelector('.color-box');
                const selectedText = backgroundColorDropdownSelected.querySelector('span');
                if (selectedColorBox) selectedColorBox.style.background = colorBox;
                if (selectedText) selectedText.textContent = text;
            }
            
            // Update active state - ONLY for background color items
            backgroundColorDropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Apply background color - ONLY affects question boxes
            applyBackgroundColor(primary, dark, colorName);
            
            // Save preference - ONLY background color theme
            if (colorName === 'none') {
                localStorage.removeItem('backgroundColorTheme');
            } else {
                localStorage.setItem('backgroundColorTheme', colorName);
            }
            
            // DO NOT update form color theme - keep them separate
            
            // Close dropdown
            closeBackgroundColorDropdown();
            
            // Show notification
            showToast(`Question color changed to ${text.replace(' (Default)', '')}!`);
        });
    });
    
    // ====================================
    // Font Dropdown Functionality
    // ====================================
    const fontDropdown = document.getElementById('fontDropdown');
    const fontDropdownSelected = document.getElementById('fontDropdownSelected');
    const fontDropdownMenu = document.getElementById('fontDropdownMenu');
    const fontDropdownItems = document.querySelectorAll('#fontDropdownMenu .font-dropdown-item');
    
    // Load Google Font dynamically
    function loadGoogleFont(fontUrl) {
        // Check if font is already loaded
        const existingLink = document.querySelector(`link[href="${fontUrl}"]`);
        if (!existingLink) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = fontUrl;
            document.head.appendChild(link);
        }
    }
    
    function openFontDropdown() {
        if (fontDropdownMenu) {
            fontDropdownMenu.classList.add('open');
            if (fontDropdownSelected) {
                fontDropdownSelected.classList.add('open');
            }
        }
    }
    
    function closeFontDropdown() {
        if (fontDropdownMenu) {
            fontDropdownMenu.classList.remove('open');
            if (fontDropdownSelected) {
                fontDropdownSelected.classList.remove('open');
            }
        }
    }
    
    // Toggle dropdown
    if (fontDropdownSelected) {
        fontDropdownSelected.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = fontDropdownMenu && fontDropdownMenu.classList.contains('open');
            
            if (isOpen) {
                closeFontDropdown();
            } else {
                openFontDropdown();
            }
        });
    }
    
    // Select font
    fontDropdownItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const fontName = item.dataset.font;
            const fontFamily = item.dataset.fontFamily;
            const fontUrl = item.dataset.fontUrl;
            const text = item.querySelector('span').textContent;
            
            // Update selected display
            if (fontDropdownSelected) {
                const selectedText = fontDropdownSelected.querySelector('span');
                if (selectedText) {
                    selectedText.textContent = text;
                    selectedText.style.fontFamily = fontFamily;
                }
            }
            
            // Update active state
            fontDropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Load font from Google Fonts (skip if None)
            if (fontUrl && fontName !== 'None') {
                loadGoogleFont(fontUrl);
            }
            
            // Apply font to form
            applyFontFamily(fontFamily, fontName);
            
            // Save preference
            if (fontName === 'None') {
                localStorage.removeItem('formFontFamily');
                localStorage.removeItem('formFontFamilyValue');
                localStorage.removeItem('formFontUrl');
            } else {
                localStorage.setItem('formFontFamily', fontName);
                localStorage.setItem('formFontFamilyValue', fontFamily);
                localStorage.setItem('formFontUrl', fontUrl || '');
            }
            
            // Close dropdown
            closeFontDropdown();
            
            // Show notification
            showToast(`Font changed to ${fontName}!`);
        });
    });
    
    // Apply Font Family
    function applyFontFamily(fontFamily, fontName) {
        // If "None" is selected, remove custom font and restore default
        if (fontName === 'None' || fontFamily === 'None') {
            const questionsContainer = document.getElementById('questionsContainer');
            const designMain = document.querySelector('.design-main');
            
            // Remove inline styles
            if (questionsContainer) {
                questionsContainer.style.fontFamily = '';
            }
            if (designMain) {
                designMain.style.fontFamily = '';
            }
            
            // Remove dynamic font style
            const style = document.getElementById('dynamic-font-style');
            if (style) {
                style.remove();
            }
            
            // Remove Google Fonts link if exists
            const fontLink = document.querySelector('link[data-font-link]');
            if (fontLink) {
                fontLink.remove();
            }
            
            return;
        }
        
        const questionsContainer = document.getElementById('questionsContainer');
        const designMain = document.querySelector('.design-main');
        
        // Apply font to form container
        if (questionsContainer) {
            questionsContainer.style.fontFamily = fontFamily;
        }
        
        if (designMain) {
            designMain.style.fontFamily = fontFamily;
        }
        
        // Apply font to all form elements via CSS
        const style = document.getElementById('dynamic-font-style') || document.createElement('style');
        style.id = 'dynamic-font-style';
        style.textContent = `
            #questionsContainer,
            #questionsContainer *,
            .questions-title,
            .questions-subtitle,
            .question-item,
            .question-item *,
            .design-main,
            .design-main * {
                font-family: ${fontFamily} !important;
            }
        `;
        if (!document.getElementById('dynamic-font-style')) {
            document.head.appendChild(style);
        }
    }
    
    // Load saved font - default to "None"
    const savedFont = localStorage.getItem('formFontFamily');
    const savedFontFamily = localStorage.getItem('formFontFamilyValue') || "'Inter', sans-serif";
    const savedFontUrl = localStorage.getItem('formFontUrl') || '';
    
    // If no saved font, use "None" as default
    if (!savedFont) {
        const noneFontItem = document.querySelector(`#fontDropdownMenu .font-dropdown-item[data-font="None"]`);
        if (noneFontItem && fontDropdownSelected) {
            const selectedText = fontDropdownSelected.querySelector('span');
            if (selectedText) {
                selectedText.textContent = noneFontItem.querySelector('span').textContent;
                selectedText.style.fontFamily = "'Inter', sans-serif";
            }
            fontDropdownItems.forEach(i => i.classList.remove('active'));
            noneFontItem.classList.add('active');
        }
    } else {
        const savedFontItem = document.querySelector(`#fontDropdownMenu .font-dropdown-item[data-font="${savedFont}"]`);
        
        if (savedFontItem && fontDropdownSelected) {
            // Load font if URL exists
            if (savedFontUrl) {
                loadGoogleFont(savedFontUrl);
            }
            
            // Update selected display
            const selectedText = fontDropdownSelected.querySelector('span');
            if (selectedText) {
                selectedText.textContent = savedFontItem.querySelector('span').textContent;
                selectedText.style.fontFamily = savedFontFamily;
            }
            
            // Update active state
            fontDropdownItems.forEach(i => i.classList.remove('active'));
            savedFontItem.classList.add('active');
            
            // Apply font
            applyFontFamily(savedFontFamily, savedFont);
        }
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (fontDropdown && !fontDropdown.contains(e.target)) {
            closeFontDropdown();
        }
        if (textColorDropdown && !textColorDropdown.contains(e.target)) {
            closeTextColorDropdown();
        }
    });
    
    // ====================================
    // Text Color Dropdown Functionality
    // ====================================
    const textColorDropdown = document.getElementById('textColorDropdown');
    const textColorDropdownSelected = document.getElementById('textColorDropdownSelected');
    const textColorDropdownMenu = document.getElementById('textColorDropdownMenu');
    const textColorDropdownItems = document.querySelectorAll('#textColorDropdownMenu .color-dropdown-item');
    
    function openTextColorDropdown() {
        if (textColorDropdownMenu) {
            textColorDropdownMenu.classList.add('open');
            if (textColorDropdownSelected) {
                textColorDropdownSelected.classList.add('open');
            }
        }
    }
    
    function closeTextColorDropdown() {
        if (textColorDropdownMenu) {
            textColorDropdownMenu.classList.remove('open');
            if (textColorDropdownSelected) {
                textColorDropdownSelected.classList.remove('open');
            }
        }
    }
    
    // Toggle dropdown
    if (textColorDropdownSelected) {
        textColorDropdownSelected.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = textColorDropdownMenu && textColorDropdownMenu.classList.contains('open');
            
            if (isOpen) {
                closeTextColorDropdown();
            } else {
                openTextColorDropdown();
            }
        });
    }
    
    // Select text color
    textColorDropdownItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const colorName = item.dataset.color;
            const colorHex = item.dataset.hex;
            const text = item.querySelector('span').textContent;
            const colorBox = item.querySelector('.color-box').style.background;
            
            // Update selected display
            if (textColorDropdownSelected) {
                const selectedColorBox = textColorDropdownSelected.querySelector('.color-box');
                const selectedText = textColorDropdownSelected.querySelector('span');
                if (selectedColorBox) selectedColorBox.style.background = colorBox;
                if (selectedText) selectedText.textContent = text;
            }
            
            // Update active state
            textColorDropdownItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Apply text color
            applyTextColor(colorHex, colorName);
            
            // Save preference
            if (colorName === 'none') {
                localStorage.removeItem('textColorTheme');
                localStorage.removeItem('textColorHex');
            } else {
                localStorage.setItem('textColorTheme', colorName);
                localStorage.setItem('textColorHex', colorHex);
            }
            
            // Close dropdown
            closeTextColorDropdown();
            
            // Show notification
            showToast(`Text color changed to ${text.replace(' (Default)', '')}!`);
        });
    });
    
    // Apply Text Color
    function applyTextColor(colorHex, colorName) {
        // If "None" is selected, remove custom text color and restore default
        if (colorName === 'none' || colorHex === '' || !colorHex) {
            const questionsContainer = document.getElementById('questionsContainer');
            
            // Remove inline styles
            if (questionsContainer) {
                questionsContainer.style.color = '';
            }
            
            // Restore default questions-title gradient (original design)
            const questionsTitle = questionsContainer?.querySelector('.questions-title');
            if (questionsTitle) {
                questionsTitle.style.color = '';
                questionsTitle.style.background = '';
                questionsTitle.style.webkitBackgroundClip = '';
                questionsTitle.style.webkitTextFillColor = '';
                questionsTitle.style.backgroundClip = '';
            }
            
            // Remove dynamic text color style to restore CSS defaults
            const style = document.getElementById('dynamic-text-color-style');
            if (style) {
                style.remove();
            }
            
            return;
        }
        
        const questionsContainer = document.getElementById('questionsContainer');
        
        // Apply text color to form container and all text elements
        if (questionsContainer) {
            questionsContainer.style.color = colorHex;
        }
        
        // Apply text color to all form elements via CSS
        // But don't override question item type color (handled by question color)
        // questions-title should ONLY be affected by text color, not form color or question color
        const style = document.getElementById('dynamic-text-color-style') || document.createElement('style');
        style.id = 'dynamic-text-color-style';
        style.textContent = `
            #questionsContainer,
            .questions-title,
            .questions-subtitle,
            .question-item,
            .question-item-title,
            .question-item-meta,
            .question-item-meta-item,
            .empty-message,
            .empty-hint,
            .design-main {
                color: ${colorHex} !important;
            }
            /* Apply to text elements inside question items, but not question-item-type */
            #questionsList .question-item .question-item-title,
            #questionsList .question-item .question-item-meta,
            #questionsList .question-item .question-item-meta-item {
                color: ${colorHex} !important;
            }
            /* Ensure questions-title is ONLY affected by text color, not form/question colors */
            /* Override any gradient or background-clip to apply solid text color */
            .questions-title {
                color: ${colorHex} !important;
                background: none !important;
                -webkit-background-clip: unset !important;
                -webkit-text-fill-color: ${colorHex} !important;
                background-clip: unset !important;
            }
            
            /* Also apply to questions-title when it has gradient (override gradient with solid color) */
            #questionsContainer .questions-title {
                color: ${colorHex} !important;
                -webkit-text-fill-color: ${colorHex} !important;
            }
            /* DO NOT override question-item-type color - that's handled by question color */
        `;
        if (!document.getElementById('dynamic-text-color-style')) {
            document.head.appendChild(style);
        } else {
            // Update existing style
            const existingStyle = document.getElementById('dynamic-text-color-style');
            if (existingStyle) {
                existingStyle.textContent = style.textContent;
            }
        }
    }
    
    // Load saved text color - default to "None"
    const savedTextColor = localStorage.getItem('textColorTheme');
    const savedTextColorHex = localStorage.getItem('textColorHex');
    
    if (!savedTextColor) {
        // Use "None" as default
        const noneTextColorItem = document.querySelector(`#textColorDropdownMenu .color-dropdown-item[data-color="none"]`);
        if (noneTextColorItem && textColorDropdownSelected) {
            const colorBox = noneTextColorItem.querySelector('.color-box').style.background;
            const text = noneTextColorItem.querySelector('span').textContent;
            
            const selectedColorBox = textColorDropdownSelected.querySelector('.color-box');
            const selectedText = textColorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            textColorDropdownItems.forEach(i => i.classList.remove('active'));
            noneTextColorItem.classList.add('active');
        }
    } else {
        const savedTextColorItem = document.querySelector(`#textColorDropdownMenu .color-dropdown-item[data-color="${savedTextColor}"]`);
        
        if (savedTextColorItem && textColorDropdownSelected) {
            const colorBox = savedTextColorItem.querySelector('.color-box').style.background;
            const text = savedTextColorItem.querySelector('span').textContent;
            
            // Update selected display
            const selectedColorBox = textColorDropdownSelected.querySelector('.color-box');
            const selectedText = textColorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            // Update active state
            textColorDropdownItems.forEach(i => i.classList.remove('active'));
            savedTextColorItem.classList.add('active');
            
            // Apply text color
            applyTextColor(savedTextColorHex, savedTextColor);
        }
    }
    
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
        
        // Select section and add it
        categoryDropdownItems.forEach(item => {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const sectionValue = item.dataset.category;
                const textSpan = item.querySelector('span');
                const iconDiv = item.querySelector('.category-icon');
                
                if (textSpan && iconDiv) {
                    const text = textSpan.textContent;
                    const icon = iconDiv.innerHTML;
                    
                    // Add section at the end of questions list
                    const newSection = {
                        id: Date.now(),
                        type: 'text',
                        text: text,
                        required: false,
                        timeLimit: 0,
                        points: 0,
                        isSection: true,
                        sectionType: sectionValue
                    };
                    
                    questions.push(newSection);
                    
                    renderQuestions();
                    updateStats();
                    saveToStorage();
                    
                    // Reset dropdown to default
                    const defaultIcon = categoryDropdownSelected.querySelector('.category-icon');
                    const defaultText = categoryDropdownSelected.querySelector('span');
                    if (defaultIcon && defaultText) {
                        defaultIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m8-8H4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg>';
                        defaultText.textContent = 'Select Section';
                    }
                    
                    // Update active state
                    categoryDropdownItems.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    
                    // Close dropdown
                    closeCategoryDropdown();
                    
                    // Show notification
                    if (typeof showToast === 'function') {
                        showToast(`Section "${text}" added successfully!`);
                    }
                    
                    // Scroll to the new section
                    setTimeout(() => {
                        const newQuestionElement = document.querySelector(`[data-question-id="${newSection.id}"]`);
                        if (newQuestionElement) {
                            newQuestionElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }, 100);
                }
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!categoryDropdown.contains(e.target)) {
                closeCategoryDropdown();
            }
        });
    }
    
    // Apply Question Color - Only to question boxes (not the entire form)
    function applyBackgroundColor(primary, dark, name) {
        // If "None" is selected, remove custom color and restore default
        if (name === 'none' || primary === '' || !primary) {
            // Remove dynamic question color style to restore CSS defaults
            const style = document.getElementById('dynamic-question-color-style');
            if (style) {
                style.remove();
            }
            return;
        }
        
        // Check if color is white - use true white
        const isWhite = primary === '#FFFFFF' || primary === '#ffffff';
        const isLightColor = primary === '#FFFFFF' || primary === '#E5E7EB' || primary === '#F8FAFC';
        
        // For white/light colors, use true colors with proper contrast
        let questionBg, questionBorder, questionHoverBg, questionHoverBorder, questionTypeBg, questionTypeBorder, questionTypeColor;
        
        if (isWhite) {
            questionBg = '#FFFFFF';
            questionBorder = '#E5E7EB';
            questionHoverBg = '#F8FAFC';
            questionHoverBorder = '#CBD5E1';
            questionTypeBg = '#F1F5F9';
            questionTypeBorder = '#CBD5E1';
            questionTypeColor = '#1E293B';
        } else if (isLightColor) {
            questionBg = primary;
            questionBorder = dark;
            questionHoverBg = primary;
            questionHoverBorder = dark;
            questionTypeBg = `${primary}E6`;
            questionTypeBorder = dark;
            questionTypeColor = dark;
        } else {
            // For dark colors, use stronger opacity for better visibility
            questionBg = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
            questionBorder = `${primary}90`;
            questionHoverBg = `linear-gradient(135deg, ${primary}60 0%, ${dark}50 100%)`;
            questionHoverBorder = `${primary}`;
            questionTypeBg = `${primary}50`;
            questionTypeBorder = `${primary}80`;
            questionTypeColor = primary;
        }
        
        // Apply color ONLY to question items (the boxes), NOT the container or form
        // Make sure we don't affect the form container at all
        // Use highest specificity to override any form theme styles
        const style = document.getElementById('dynamic-question-color-style') || document.createElement('style');
        style.id = 'dynamic-question-color-style';
        // Place this style AFTER the theme style to ensure it has higher priority
        style.textContent = `
            /* Question color - ONLY affects question boxes, overrides form theme */
            #questionsContainer #questionsList .question-item {
                background: ${questionBg} !important;
                border-color: ${questionBorder} !important;
            }
            #questionsContainer #questionsList .question-item:hover {
                background: ${questionHoverBg} !important;
                border-color: ${questionHoverBorder} !important;
                box-shadow: 0 4px 12px ${isWhite ? 'rgba(0, 0, 0, 0.1)' : `${primary}40`} !important;
            }
            #questionsContainer #questionsList .question-item .question-item-type {
                background: ${questionTypeBg} !important;
                border-color: ${questionTypeBorder} !important;
                color: ${questionTypeColor} !important;
            }
            /* NEVER affect action buttons - modern glassmorphism design, stay independent */
            #questionsContainer #questionsList .question-item .question-item-actions {
                background: transparent !important;
            }
            #questionsContainer #questionsList .question-item .question-item-btn,
            #questionsContainer #questionsList .question-item .edit-question,
            #questionsContainer #questionsList .question-item .copy-question,
            #questionsContainer #questionsList .question-item .delete-question {
                background: rgba(15, 23, 42, 0.8) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                border: 1px solid rgba(34, 211, 238, 0.3) !important;
                color: rgba(255, 255, 255, 0.95) !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(34, 211, 238, 0) !important;
            }
            #questionsContainer #questionsList .question-item .question-item-btn:hover,
            #questionsContainer #questionsList .question-item .edit-question:hover,
            #questionsContainer #questionsList .question-item .copy-question:hover,
            #questionsContainer #questionsList .question-item .delete-question:hover {
                background: rgba(15, 23, 42, 0.95) !important;
                border-color: rgba(34, 211, 238, 0.6) !important;
                color: #ffffff !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 16px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.2) !important;
            }
            #questionsContainer #questionsList .question-item .question-item-btn svg,
            #questionsContainer #questionsList .question-item .edit-question svg,
            #questionsContainer #questionsList .question-item .copy-question svg {
                color: rgba(34, 211, 238, 0.9) !important;
                filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.3)) !important;
            }
            #questionsContainer #questionsList .question-item .question-item-btn:hover svg,
            #questionsContainer #questionsList .question-item .edit-question:hover svg,
            #questionsContainer #questionsList .question-item .copy-question:hover svg {
                color: rgba(34, 211, 238, 1) !important;
                filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.6)) !important;
                transform: scale(1.1) !important;
            }
            #questionsContainer #questionsList .question-item .delete-question svg {
                color: rgba(239, 68, 68, 0.9) !important;
                filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.3)) !important;
            }
            #questionsContainer #questionsList .question-item .delete-question:hover svg {
                color: rgba(239, 68, 68, 1) !important;
                filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)) !important;
                transform: scale(1.1) !important;
            }
        `;
        if (!document.getElementById('dynamic-question-color-style')) {
            document.head.appendChild(style);
        } else {
            // Update existing style to ensure it's applied after theme style
            const existingStyle = document.getElementById('dynamic-question-color-style');
            if (existingStyle) {
                existingStyle.textContent = style.textContent;
            }
        }
    }
    
    // Apply Color Theme - Apply to the ENTIRE form/question form completely (but NOT question items)
    function applyColorTheme(primary, dark, name) {
        // If "None" is selected, remove custom theme and restore default
        if (name === 'none' || primary === '' || !primary) {
            const designMain = document.querySelector('.design-main');
            const questionsContainer = document.getElementById('questionsContainer');
            
            // Remove inline styles to restore CSS defaults
            if (questionsContainer) {
                questionsContainer.style.background = '';
                questionsContainer.style.borderColor = '';
                questionsContainer.style.boxShadow = '';
            }
            
            if (designMain) {
                designMain.style.background = '';
                designMain.style.borderColor = '';
                designMain.style.boxShadow = '';
            }
            
            // Remove dynamic theme style
            const style = document.getElementById('dynamic-theme-style');
            if (style) {
                style.remove();
            }
            
            // DO NOT restore questions title - it should only be affected by text color
            // Keep questions title independent from form color
            
            const questionsSubtitle = questionsContainer?.querySelector('.questions-subtitle');
            if (questionsSubtitle) {
                questionsSubtitle.style.color = '';
            }
            
            return;
        }
        
        const designMain = document.querySelector('.design-main');
        const questionsContainer = document.getElementById('questionsContainer');
        
        // Check if color is white - use true white
        const isWhite = primary === '#FFFFFF' || primary === '#ffffff';
        const isLightColor = primary === '#FFFFFF' || primary === '#E5E7EB' || primary === '#F8FAFC';
        
        // Apply to the entire questions container (the form) - but NOT the question items inside
        if (questionsContainer) {
            if (isWhite) {
                questionsContainer.style.background = '#FFFFFF';
                questionsContainer.style.borderColor = '#E5E7EB';
                questionsContainer.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.1)';
            } else if (isLightColor) {
                questionsContainer.style.background = `linear-gradient(135deg, ${primary} 0%, ${dark} 100%)`;
                questionsContainer.style.borderColor = dark;
                questionsContainer.style.boxShadow = `0 8px 32px ${primary}30`;
            } else {
                questionsContainer.style.background = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
                questionsContainer.style.borderColor = `${primary}90`;
                questionsContainer.style.boxShadow = `0 8px 32px ${primary}50`;
            }
            
            // DO NOT update questions title - it should only be affected by text color
            // Keep questions title independent from form color
            
            // Update questions subtitle
            const questionsSubtitle = questionsContainer.querySelector('.questions-subtitle');
            if (questionsSubtitle) {
                if (isWhite) {
                    questionsSubtitle.style.color = '#64748B';
                } else {
                    questionsSubtitle.style.color = `${primary}CC`;
                }
            }
        }
        
        // Update form editor area if it exists
        if (designMain) {
            if (isWhite) {
                designMain.style.background = '#FFFFFF';
                designMain.style.borderColor = '#E5E7EB';
                designMain.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.1)';
            } else if (isLightColor) {
                designMain.style.background = `linear-gradient(135deg, ${primary} 0%, ${dark} 100%)`;
                designMain.style.borderColor = dark;
                designMain.style.boxShadow = `0 8px 32px ${primary}30`;
            } else {
                designMain.style.background = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
                designMain.style.borderColor = `${primary}90`;
                designMain.style.boxShadow = `0 8px 32px ${primary}50`;
            }
        }
        
        // Update question badges and form elements - DO NOT affect .question-item (those are handled by question color)
        // Use more specific selectors to ensure question items are NOT affected
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
            .empty-questions-state {
                color: ${isWhite ? '#64748B' : `${primary}80`} !important;
            }
            .empty-message {
                color: ${isWhite ? '#1E293B' : `${primary}CC`} !important;
            }
            .empty-hint {
                color: ${isWhite ? '#94A3B8' : `${primary}99`} !important;
            }
            /* CRITICAL: DO NOT style .question-item here - that's handled by question color */
            /* Ensure question items are NOT affected by form color theme */
            #questionsList .question-item {
                /* Reset any form theme styles - question color will override */
            }
            /* NEVER affect action buttons - modern glassmorphism design, stay independent */
            #questionsList .question-item .question-item-actions {
                background: transparent !important;
            }
            #questionsList .question-item .question-item-btn,
            #questionsList .question-item .edit-question,
            #questionsList .question-item .copy-question,
            #questionsList .question-item .delete-question {
                background: rgba(15, 23, 42, 0.8) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                border: 1px solid rgba(34, 211, 238, 0.3) !important;
                color: rgba(255, 255, 255, 0.95) !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(34, 211, 238, 0) !important;
            }
            #questionsList .question-item .question-item-btn:hover,
            #questionsList .question-item .edit-question:hover,
            #questionsList .question-item .copy-question:hover,
            #questionsList .question-item .delete-question:hover {
                background: rgba(15, 23, 42, 0.95) !important;
                border-color: rgba(34, 211, 238, 0.6) !important;
                color: #ffffff !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 16px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.2) !important;
            }
            #questionsList .question-item .question-item-btn svg,
            #questionsList .question-item .edit-question svg,
            #questionsList .question-item .copy-question svg {
                color: rgba(34, 211, 238, 0.9) !important;
                filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.3)) !important;
            }
            #questionsList .question-item .question-item-btn:hover svg,
            #questionsList .question-item .edit-question:hover svg,
            #questionsList .question-item .copy-question:hover svg {
                color: rgba(34, 211, 238, 1) !important;
                filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.6)) !important;
                transform: scale(1.1) !important;
            }
            #questionsList .question-item .delete-question svg {
                color: rgba(239, 68, 68, 0.9) !important;
                filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.3)) !important;
            }
            #questionsList .question-item .delete-question:hover svg {
                color: rgba(239, 68, 68, 1) !important;
                filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)) !important;
                transform: scale(1.1) !important;
            }
        `;
        if (!document.getElementById('dynamic-theme-style')) {
            document.head.appendChild(style);
        }
    }
    
    // Load saved themes - Load form color FIRST, then question color SECOND (so question color overrides)
    // Default to "none" if no saved theme
    const savedTheme = localStorage.getItem('formColorTheme');
    if (!savedTheme) {
        // Use "None" as default
        const noneItem = document.querySelector(`#colorDropdownMenu .color-dropdown-item[data-color="none"]`);
        if (noneItem && colorDropdownSelected) {
            const colorBox = noneItem.querySelector('.color-box').style.background;
            const text = noneItem.querySelector('span').textContent;
            
            const selectedColorBox = colorDropdownSelected.querySelector('.color-box');
            const selectedText = colorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            colorDropdownItems.forEach(i => i.classList.remove('active'));
            noneItem.classList.add('active');
        }
    } else {
        // IMPORTANT: Only search in the form color dropdown menu
        const savedItem = document.querySelector(`#colorDropdownMenu .color-dropdown-item[data-color="${savedTheme}"]`);
        if (savedItem) {
            const primary = savedItem.dataset.primary;
            const dark = savedItem.dataset.dark;
            const text = savedItem.querySelector('span').textContent;
            const colorBox = savedItem.querySelector('.color-box').style.background;
            
            // Update selected display - ONLY for form color dropdown
            const selectedColorBox = colorDropdownSelected.querySelector('.color-box');
            const selectedText = colorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            // Update active state - ONLY for form color items
            colorDropdownItems.forEach(i => i.classList.remove('active'));
            savedItem.classList.add('active');
            
            // Apply form color theme - affects form container, NOT question items
            applyColorTheme(primary, dark, text);
        }
    }
    
    // Load saved background color - Load AFTER form color so it can override
    // Default to "none" if no saved theme
    const savedBackgroundTheme = localStorage.getItem('backgroundColorTheme');
    if (!savedBackgroundTheme) {
        // Use "None" as default
        const noneBackgroundItem = document.querySelector(`#backgroundColorDropdownMenu .color-dropdown-item[data-color="none"]`);
        if (noneBackgroundItem && backgroundColorDropdownSelected) {
            const colorBox = noneBackgroundItem.querySelector('.color-box').style.background;
            const text = noneBackgroundItem.querySelector('span').textContent;
            
            const selectedColorBox = backgroundColorDropdownSelected.querySelector('.color-box');
            const selectedText = backgroundColorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            backgroundColorDropdownItems.forEach(i => i.classList.remove('active'));
            noneBackgroundItem.classList.add('active');
        }
    } else {
        const savedBackgroundItem = document.querySelector(`#backgroundColorDropdownMenu .color-dropdown-item[data-color="${savedBackgroundTheme}"]`);
        if (savedBackgroundItem && backgroundColorDropdownSelected) {
            const primary = savedBackgroundItem.dataset.primary;
            const dark = savedBackgroundItem.dataset.dark;
            const text = savedBackgroundItem.querySelector('span').textContent;
            const colorBox = savedBackgroundItem.querySelector('.color-box').style.background;
            
            // Update selected display - ONLY for background color dropdown
            const selectedColorBox = backgroundColorDropdownSelected.querySelector('.color-box');
            const selectedText = backgroundColorDropdownSelected.querySelector('span');
            if (selectedColorBox) selectedColorBox.style.background = colorBox;
            if (selectedText) selectedText.textContent = text;
            
            // Update active state - ONLY for background color items
            backgroundColorDropdownItems.forEach(i => i.classList.remove('active'));
            savedBackgroundItem.classList.add('active');
            
            // Apply background color - ONLY affects question boxes, not form
            // This is called AFTER form color, so it will override any conflicting styles
            applyBackgroundColor(primary, dark, text);
            
            // DO NOT affect form color theme - they are independent
        }
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
    const leftIconBtn = document.getElementById('leftIconBtn');
    const leftIconWrapper = document.querySelector('.left-icon-wrapper');
    
    let touchStartX = 0;
    let touchStartY = 0;
    let isDragging = false;
    let sidebarStartX = 0;
    
    function openMobileSidebar() {
        if (window.innerWidth <= 768) {
            designSidebar.classList.add('mobile-open');
            mobileSidebarOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
            // Hide left icon when sidebar opens
            if (leftIconWrapper) {
                leftIconWrapper.classList.add('hidden');
            }
        }
    }
    
    function closeMobileSidebar() {
        designSidebar.classList.remove('mobile-open');
        mobileSidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
        // Show left icon when sidebar closes
        if (leftIconWrapper && window.innerWidth <= 768) {
            leftIconWrapper.classList.remove('hidden');
        }
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
    
    // Open sidebar on left icon click
    if (leftIconBtn) {
        leftIconBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                openMobileSidebar();
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
    
    // Swipe gestures for mobile sidebar - DISABLED
    // Touch swipe functionality has been disabled
    // Sidebar can only be opened/closed using the toggle button
    
    // Hide/show toggle button based on screen size
    function updateMobileSidebarToggle() {
        if (window.innerWidth <= 768) {
            if (mobileSidebarToggle) {
                mobileSidebarToggle.style.display = 'flex';
            }
            if (leftIconWrapper) {
                leftIconWrapper.classList.remove('hidden');
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
            if (leftIconWrapper) {
                leftIconWrapper.classList.add('hidden');
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

    // Empty State Add Button (Plus Icon)
    const emptyStateAddBtn = document.getElementById('emptyStateAddBtn');
    if (emptyStateAddBtn) {
        emptyStateAddBtn.addEventListener('click', function() {
            editingQuestionIndex = null;
            currentQuestionType = 'short-text';
            openQuestionModal('short-text');
        });
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
    
    // Clear All Button
    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllQuestions);
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
                    <label>Section (Optional)</label>
                    <input type="text" id="questionSection" placeholder="e.g., Personal Information, Skills, etc." value="">
                    <small style="color: rgba(255,255,255,0.6); font-size: 12px;">Group questions by section name</small>
                </div>
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
                    <label>Section (Optional)</label>
                    <input type="text" id="questionSection" placeholder="e.g., Personal Information, Skills, etc." value="">
                    <small style="color: rgba(255,255,255,0.6); font-size: 12px;">Group questions by section name</small>
                </div>
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
                    <label>Section (Optional)</label>
                    <input type="text" id="questionSection" placeholder="e.g., Personal Information, Skills, etc." value="">
                    <small style="color: rgba(255,255,255,0.6); font-size: 12px;">Group questions by section name</small>
                </div>
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
                    <label>Section (Optional)</label>
                    <input type="text" id="questionSection" placeholder="e.g., Personal Information, Skills, etc." value="">
                    <small style="color: rgba(255,255,255,0.6); font-size: 12px;">Group questions by section name</small>
                </div>
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

    // Populate Edit Form - Enhanced to support all question types
    function populateEditForm(question) {
        // Fill common fields
        const questionTextEl = document.getElementById('questionText');
        const questionTimeEl = document.getElementById('questionTime');
        const questionPointsEl = document.getElementById('questionPoints');
        
        if (questionTextEl) questionTextEl.value = question.text || '';
        if (questionTimeEl) questionTimeEl.value = question.timeLimit || '';
        if (questionPointsEl) questionPointsEl.value = question.points || 10;
        
        // Type-specific data population
        if (question.type === 'multiple' || question.type === 'checkbox' || question.type === 'dropdown') {
            // Populate options
            if (question.options) {
                window.currentOptions = [...question.options];
                renderOptions();
            }
            const randomizeOptionsEl = document.getElementById('randomizeOptions');
            if (randomizeOptionsEl) randomizeOptionsEl.checked = question.randomizeOptions || false;
            
        } else if (question.type === 'rating' || question.type === 'linear-scale') {
            const ratingScaleEl = document.getElementById('ratingScale');
            if (ratingScaleEl) ratingScaleEl.value = question.scale || '5';
            
            if (question.type === 'linear-scale') {
                const lowLabelEl = document.getElementById('lowLabel');
                const highLabelEl = document.getElementById('highLabel');
                if (lowLabelEl) lowLabelEl.value = question.lowLabel || '';
                if (highLabelEl) highLabelEl.value = question.highLabel || '';
            }
            
        } else if (question.type === 'yes-no') {
            const correctAnswerEl = document.getElementById('correctAnswer');
            if (correctAnswerEl) correctAnswerEl.value = question.correctAnswer || '';
            
        } else if (question.type === 'number') {
            const minValueEl = document.getElementById('minValue');
            const maxValueEl = document.getElementById('maxValue');
            if (minValueEl) minValueEl.value = question.minValue || '';
            if (maxValueEl) maxValueEl.value = question.maxValue || '';
            
        } else if (question.type === 'short-text' || question.type === 'long-text') {
            const charLimitEl = document.getElementById('charLimit');
            if (charLimitEl) charLimitEl.value = question.charLimit || '';
            
        } else if (question.type === 'email' || question.type === 'phone' || question.type === 'url') {
            const validateFormatEl = document.getElementById('validateFormat');
            if (validateFormatEl) validateFormatEl.checked = question.validateFormat || false;
            
        } else if (question.type === 'file') {
            const fileTypesEl = document.getElementById('fileTypes');
            const maxFileSizeEl = document.getElementById('maxFileSize');
            
            if (fileTypesEl && question.allowedTypes) {
                Array.from(fileTypesEl.options).forEach(option => {
                    option.selected = question.allowedTypes.includes(option.value);
                });
            }
            if (maxFileSizeEl) maxFileSizeEl.value = question.maxFileSize || 10;
            
        } else if (question.type === 'voice') {
            const maxDurationEl = document.getElementById('maxDuration');
            const requireTranscriptEl = document.getElementById('requireTranscript');
            if (maxDurationEl) maxDurationEl.value = question.maxDuration || '';
            if (requireTranscriptEl) requireTranscriptEl.checked = question.requireTranscript || false;
            
        } else if (question.type === 'slider') {
            const sliderMinEl = document.getElementById('sliderMin');
            const sliderMaxEl = document.getElementById('sliderMax');
            const sliderStepEl = document.getElementById('sliderStep');
            if (sliderMinEl) sliderMinEl.value = question.sliderMin || 0;
            if (sliderMaxEl) sliderMaxEl.value = question.sliderMax || 100;
            if (sliderStepEl) sliderStepEl.value = question.sliderStep || 1;
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
            // Check if we're adding to a specific position
            if (window.newQuestionInsertIndex !== undefined) {
                questions.splice(window.newQuestionInsertIndex, 0, questionData);
                window.newQuestionInsertIndex = undefined;
            } else {
                questions.push(questionData);
            }
        }

        window.currentOptions = [];
        closeQuestionModal();
        updateStats();
        renderQuestions();
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

    // Render Questions in Form
    function renderQuestions() {
        const questionsList = document.getElementById('questionsList');
        const clearAllBtn = document.getElementById('clearAllBtn');
        if (!questionsList) return;

        // Show/hide Clear All button based on questions count
        if (clearAllBtn) {
            clearAllBtn.style.display = questions.length > 0 ? 'flex' : 'none';
        }

        if (questions.length === 0) {
            questionsList.innerHTML = `
                <div class="empty-questions-state">
                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="12" y="8" width="40" height="48" rx="4" stroke="currentColor" stroke-width="2" opacity="0.3"/>
                        <path d="M20 20h24M20 28h24M20 36h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
                    </svg>
                    <p class="empty-message">No questions added yet</p>
                    <p class="empty-hint">Add questions from the sidebar to get started</p>
                </div>
            `;
            return;
        }

        // Group questions by section
        const sections = {};
        const noSectionQuestions = [];
        
        questions.forEach((question, index) => {
            if (question.sectionId && question.sectionName) {
                if (!sections[question.sectionId]) {
                    sections[question.sectionId] = {
                        name: question.sectionName,
                        questions: []
                    };
                }
                sections[question.sectionId].questions.push({ question, index });
            } else {
                noSectionQuestions.push({ question, index });
            }
        });

        // Build HTML
        let html = '';
        
        // Render questions with sections
        Object.keys(sections).forEach(sectionId => {
            const section = sections[sectionId];
            html += `
                <div class="question-section-header" data-section-id="${sectionId}">
                    <h3 class="section-title">${section.name}</h3>
                </div>
            `;
            section.questions.forEach(({ question, index }) => {
                html += renderQuestionItem(question, index);
            });
        });
        
        // Render questions without sections
        noSectionQuestions.forEach(({ question, index }) => {
            html += renderQuestionItem(question, index);
        });

        questionsList.innerHTML = html;

        // Add event listeners
        setupQuestionEventListeners();
    }

    // Render single question item
    function renderQuestionItem(question, index) {
        const typeLabel = getTypeLabel(question.type);
        const timeInfo = question.timeLimit ? `${question.timeLimit}s` : 'No limit';
        const pointsInfo = question.points ? `${question.points} pts` : '';
        
        return `
            <div class="question-item" data-index="${index}" data-question-id="${question.id}">
                <div class="question-item-header">
                    <div>
                        <div class="question-item-title">${question.text}</div>
                        <div class="question-item-type">${typeLabel}</div>
                    </div>
                    <div class="question-item-actions">
                        <button class="question-item-btn edit-question" data-index="${index}" aria-label="Edit question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11.333 2.667a2.667 2.667 0 0 1 3.774 3.774L5.333 15.333H2v-3.333l9.333-9.333Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="question-item-btn copy-question" data-index="${index}" aria-label="Duplicate question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10.667 10.667h2.666a1.333 1.333 0 0 0 1.334-1.334V2.667a1.333 1.333 0 0 0-1.334-1.334H6.667A1.333 1.333 0 0 0 5.333 2.667v2.666M10.667 5.333H3.333a1.333 1.333 0 0 0-1.333 1.334v6.666a1.333 1.333 0 0 0 1.333 1.334h7.334a1.333 1.333 0 0 0 1.333-1.334V6.667a1.333 1.333 0 0 0-1.333-1.334Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="question-item-btn delete-question" data-index="${index}" aria-label="Delete question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2 4h12M6 4V2.667a1.333 1.333 0 0 1 1.333-1.334h1.334A1.333 1.333 0 0 1 10.667 2.667V4m2 0v9.333a1.333 1.333 0 0 1-1.333 1.334H5.333A1.333 1.333 0 0 1 4 13.333V4h8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="question-item-meta">
                    <span class="question-meta-item">${timeInfo}</span>
                    ${pointsInfo ? `<span class="question-meta-item">${pointsInfo}</span>` : ''}
                    ${question.options ? `<span class="question-meta-item">${question.options.length} options</span>` : ''}
                </div>
            </div>
        `;
    }

    // Setup event listeners for question buttons
    function setupQuestionEventListeners() {
        const questionsList = document.getElementById('questionsList');
        if (!questionsList) return;

        questionsList.querySelectorAll('.edit-question').forEach(btn => {
            btn.addEventListener('click', function() {
                const index = parseInt(this.dataset.index);
                editQuestion(index);
            });
        });

        questionsList.querySelectorAll('.copy-question').forEach(btn => {
            btn.addEventListener('click', function() {
                const index = parseInt(this.dataset.index);
                copyQuestion(index);
            });
        });

        questionsList.querySelectorAll('.delete-question').forEach(btn => {
            btn.addEventListener('click', function() {
                const index = parseInt(this.dataset.index);
                deleteQuestion(index);
            });
        });

    }

    // Delete Question
    function deleteQuestion(index) {
        if (confirm('Are you sure you want to delete this question?')) {
            questions.splice(index, 1);
            renderQuestions();
            updateStats();
            saveToStorage();
            showToast('Question deleted successfully!');
        }
    }

    // Clear All Questions
    function clearAllQuestions() {
        if (questions.length === 0) return;
        
        if (confirm('Are you sure you want to delete all questions? This action cannot be undone.')) {
            questions = [];
            renderQuestions();
            updateStats();
            saveToStorage();
            showToast('All questions cleared successfully!');
        }
    }

    // Duplicate Question
    function copyQuestion(index) {
        const questionToCopy = questions[index];
        // Create a deep copy of the question
        const duplicatedQuestion = JSON.parse(JSON.stringify(questionToCopy));
        // Add "Duplicate" to the question text if it doesn't already contain it
        if (!duplicatedQuestion.text.includes('(Duplicate)')) {
            duplicatedQuestion.text = duplicatedQuestion.text + ' (Duplicate)';
        }
        // Insert the duplicated question right after the original
        questions.splice(index + 1, 0, duplicatedQuestion);
        renderQuestions();
        updateStats();
        saveToStorage();
        showToast('Question duplicated successfully!');
    }

    // Add Section After Question
    function addSectionAfterQuestion(index) {
        if (index < 0 || index >= questions.length) return;

        // Create a new section/question after the current one
        const newSection = {
            id: Date.now(),
            type: 'text',
            text: 'New Section',
            required: false,
            timeLimit: 0,
            points: 0
        };

        questions.splice(index + 1, 0, newSection);

        renderQuestions();
        updateStats();
        saveToStorage();
        showToast('Section added successfully!');
        
        // Scroll to the new section
        setTimeout(() => {
            const newQuestionElement = document.querySelector(`[data-question-id="${newSection.id}"]`);
            if (newQuestionElement) {
                newQuestionElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100);
    }

    // Edit Question
    function editQuestion(index) {
        editingQuestionIndex = index;
        currentQuestionType = questions[index].type;
        openQuestionModal(questions[index].type);
        // Small delay to ensure modal content is rendered before populating
        setTimeout(() => {
            populateEditForm(questions[index]);
        }, 100);
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
            renderQuestions();
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

