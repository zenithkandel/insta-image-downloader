# Instagram Media Downloader (ZIP & PDF) - Chrome Extension

A modern, high-performance Chrome Extension (Manifest V3) that injects a native-style download button onto every Instagram post, allowing you to download all post media in your desired format (**ZIP** or **PDF**).

---

## 🚀 Key Features

* **📦 Download as ZIP (Images + Videos)**:
  * Automatically bundles **all images and videos** from single posts or carousel posts into a single `.zip` archive.
  * Preserves original quality and highest resolution (1080p+).
  * Automatically formats filenames cleanly: `{username}_{shortcode}_{slide_number}.(jpg|mp4)`.

* **📄 Download as PDF (Images Only)**:
  * Automatically filters and downloads **only images** into a crisp, multi-page PDF document.
  * **Strictly excludes videos** from the PDF.
  * Custom page sizing matching the exact aspect ratio of each slide (no distortion, no black bars, no cropping).

* **🖼️ Quick Download Current Item**:
  * Instantly saves the active slide/video you are currently viewing.

* **🎯 Seamless DOM & Native Aesthetic Integration**:
  * **Action Bar Button**: Injected directly into the action bar right beside the Save/Bookmark icon, matching Instagram's native SVG icon size (24x24) and dynamic light/dark theme.
  * **Floating Media Badge**: A stylish, translucent glassmorphic badge on the top-right corner of post media for quick 1-click access.
  * **Interactive Dropdown Menu**: A sleek, non-clipping floating card showing post author, media count, and format choices.
  * **Live Progress Toast**: Bottom-right floating toast notification with real-time progress bar ("Scanning slides...", "Downloading item 2/5...", "Compressing ZIP...", "Finalizing PDF...").

* **⚡ Dual-Engine Media Extraction**:
  1. **Layer 1 (Network Interceptor)**: Runs in the page's execution context (`world: "MAIN"`) to intercept Instagram's internal GraphQL/REST queries and cache maximum-resolution media URLs instantly.
  2. **Layer 2 (DOM Carousel Traversal Fallback)**: If a post was loaded earlier, the extension automatically steps through carousel slides, captures high-res images from `srcset`, and returns the carousel to slide 1 seamlessly.

---

## 📁 Project Structure

```
insta-image-downloader/
├── manifest.json         # Chrome Extension Manifest V3 configuration
├── injected.js           # Main World script: intercepts Instagram GraphQL/API network calls
├── background.js         # Service Worker: manages downloads and CORS fallback fetching
├── content.js            # Content Script: button injection, DOM scraper, ZIP & PDF builders
├── content.css           # Styling for action buttons, dropdowns, and progress toast
├── libs/
│   ├── jszip.min.js      # JSZip library for creating .zip archives client-side
│   └── jspdf.umd.min.js  # jsPDF library for creating multi-page PDFs client-side
├── popup/
│   ├── popup.html        # Extension popup interface
│   ├── popup.css         # Popup styles (dark mode)
│   └── popup.js          # User preferences & toggles
├── icons/
│   ├── icon16.png        # 16x16 extension icon
│   ├── icon48.png        # 48x48 extension icon
│   └── icon128.png       # 128x128 extension icon
├── test/
│   ├── mock_instagram.html # Test page replicating Instagram feed and carousels
│   └── run_tests.js      # Automated test suite for ZIP & PDF logic
└── README.md
```

---

## 🛠️ Installation Instructions (Chrome / Edge / Brave / Opera)

1. Open your Chromium-based browser (Google Chrome, Microsoft Edge, Brave, etc.).
2. Go to the Extensions management page:
   * **Chrome**: Navigate to `chrome://extensions/`
   * **Edge**: Navigate to `edge://extensions/`
   * **Brave**: Navigate to `brave://extensions/`
3. Toggle on **Developer mode** (in Chrome, this is located at the top-right corner).
4. Click the **Load unpacked** button (top-left corner).
5. Select this folder:
   ```
   c:\xampp\htdocs\codes\insta-image-downloader
   ```
6. The extension **"Instagram Media Downloader (ZIP & PDF)"** is now installed and active!

---

## 📖 How to Use

1. Go to [Instagram](https://www.instagram.com).
2. Browse your home feed, open any post overlay modal (`/p/:id/`), or visit any dedicated post or profile page.
3. On every post, you will see:
   * A **Download icon** right beside the Save/Bookmark button in the interaction row.
   * A **Download badge** on the top-right corner of the image/video.
4. Click either button to open the download menu:
   * Click **Download All as ZIP** to download a `.zip` archive containing all images and videos.
   * Click **Download Images as PDF** to generate a single `.pdf` document with only the images.
5. Watch the real-time progress toast in the bottom right corner as it packages and saves your file!

---

## 🧪 Testing

To run the automated tests verifying ZIP compilation, video filtering, and PDF generation:

```bash
node test/run_tests.js
```
