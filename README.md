
# Career Portal Application

A modern, professional landing page and application form system with multi-language support (English, Arabic, Kurdish).

## 📁 Project Structure

```
AL/
├── landing.html          # Landing page (entry point)
├── landing-styles.css    # Landing page styles
├── landing-script.js     # Landing page functionality
├── index.html           # Application form
├── styles.css           # Application form styles
├── script.js            # Application form functionality
└── README.md            # This file
```

## 🚀 Getting Started

### How to Use

1. **Open the Landing Page**: Start by opening `landing.html` in your web browser
   - This is the introductory page with company information
   - Users can learn about the company and available positions
   
2. **Navigate to Application**: Click any of the "Apply Now" buttons to go to the application form (`index.html`)

3. **Fill Application Form**: Complete the multi-step application form with your information

## ✨ Features

### Landing Page (`landing.html`)
- **Modern Hero Section**: Eye-catching gradient background with animated orbs
- **Company Statistics**: Animated counters showing employee count, open positions, and global reach
- **Features Section**: Highlights benefits like competitive salary, flexible schedule, career growth, etc.
- **Application Process**: Visual guide showing the 4-step hiring process
- **Call-to-Action Section**: Prominent CTA to encourage applications
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **Multi-language Support**: English, Arabic (RTL), and Kurdish (RTL)

### Application Form (`index.html`)
- **Multi-step Form**: 4 sections with progress tracking
- **Form Validation**: Real-time validation with helpful error messages
- **Language Support**: Same 3 languages as landing page
- **Professional UI**: Clean, modern design with smooth animations

## 🎨 Design Features

### Visual Elements
- Gradient backgrounds with animated orbs
- Smooth scroll animations
- Fade-in effects on scroll
- Counter animations for statistics
- Hover effects on cards and buttons
- Glass-morphism design for language selector

### Color Scheme
- Primary: Indigo (#4f46e5)
- Accent: Purple (#8b5cf6)
- Gradients: Modern purple-to-pink combinations
- Text: Dark gray for primary, light gray for secondary

### Typography
- System fonts for optimal performance
- Clear hierarchy with proper font weights
- Responsive font sizes

## 🌐 Multi-language Support

The application supports three languages:

1. **English (en)** - LTR
2. **Arabic (ar)** - RTL
3. **Kurdish (ku)** - RTL

Users can switch languages using the dropdown in the top-right corner. The layout automatically adjusts for RTL languages.

## 📱 Responsive Breakpoints

- **Desktop**: 1024px and above
- **Tablet**: 768px - 1023px
- **Mobile**: Below 768px

## 🔧 Customization

### To Customize Company Information:

1. **Edit Statistics** in `landing.html`:
   ```html
   <div class="stat-number" data-number="500">0</div>
   ```

2. **Update Company Name**:
   - Search for "Company Name" in `landing.html`
   - Update in translations in `landing-script.js`

3. **Modify Colors**:
   - Edit CSS variables in `landing-styles.css` under `:root`

4. **Add/Remove Features**:
   - Edit the features grid in `landing.html`
   - Update translations accordingly

### To Add a New Language:

1. Add language option in HTML:
   ```html
   <button class="language-option" role="menuitem" data-lang="xx">
       <span class="language-name">Language Name</span>
       <span class="language-code">(XX)</span>
   </button>
   ```

2. Add translations in `landing-script.js`:
   ```javascript
   xx: {
       badge: "Translation",
       heroTitle1: "Translation",
       // ... add all keys
   }
   ```

## 🌟 Modern Technologies Used

- **HTML5**: Semantic markup
- **CSS3**: Modern features (Grid, Flexbox, Custom Properties, Animations)
- **JavaScript (ES6+)**: Modern syntax with no dependencies
- **Intersection Observer API**: For scroll animations
- **CSS Custom Properties**: For easy theming
- **Backdrop Filter**: For glass-morphism effects

## 📝 Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (some features require Safari 14+)
- Mobile browsers: Full support

## 🎯 Best Practices Implemented

1. **Accessibility**: Proper ARIA labels and semantic HTML
2. **Performance**: Optimized animations with will-change
3. **SEO**: Proper meta tags and semantic structure
4. **Responsive**: Mobile-first approach
5. **Progressive Enhancement**: Core functionality works without JavaScript
6. **Code Organization**: Clean, commented, and modular code

## 📄 License

All rights reserved © 2025

---

## 🚀 Quick Start

Simply open `landing.html` in any modern web browser to see the landing page in action!

For the best experience, use a local web server or deploy to a hosting service.


