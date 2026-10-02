/**
 * Instagram Media Downloader - Content Script
 * Injects download buttons into Instagram posts (home feed, /p/:id overlay modal, dedicated pages)
 * and enables 1-click downloading of all images/videos as ZIP or images-only as PDF.
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same frame
  if (window.__instaDlContentScriptLoaded) return;
  window.__instaDlContentScriptLoaded = true;

  console.log('[Instagram Media Downloader] Content script initialized.');

  // =========================================================================
  // Toast Notification System
  // =========================================================================
  let activeToast = null;
  let toastTimer = null;

  function showToast({
    title = 'Downloading Media',
    message = '',
    progress = 0,
    indeterminate = false,
    isSuccess = false,
    isError = false,
    autoClose = true,
    duration = 3500
  }) {
    if (toastTimer) clearTimeout(toastTimer);

    if (!activeToast) {
      activeToast = document.createElement('div');
      activeToast.className = 'insta-dl-toast';
      document.body.appendChild(activeToast);
    }

    const iconHtml = isSuccess
      ? '<span style="color:#00d26a; font-size:16px;">✓</span>'
      : isError
      ? '<span style="color:#ff3366; font-size:16px;">✕</span>'
      : '<span class="insta-dl-spinner"></span>';

    activeToast.className = `insta-dl-toast ${indeterminate ? 'insta-dl-progress-indeterminate' : ''}`;
    activeToast.innerHTML = `
      <div class="insta-dl-toast-header">
        <div class="insta-dl-toast-title">
          ${iconHtml}
          <span>${title}</span>
        </div>
        <button class="insta-dl-toast-close" title="Close">✕</button>
      </div>
      <div class="insta-dl-toast-msg">${message}</div>
      <div class="insta-dl-progress-bar-bg">
        <div class="insta-dl-progress-bar-fill" style="width: ${indeterminate ? '40%' : Math.min(100, Math.max(0, progress)) + '%'};"></div>
      </div>
    `;

    const closeBtn = activeToast.querySelector('.insta-dl-toast-close');
    closeBtn.addEventListener('click', closeToast);

    if (autoClose && (isSuccess || isError)) {
      toastTimer = setTimeout(closeToast, duration);
    }
  }

  function closeToast() {
    if (!activeToast) return;
    activeToast.classList.add('closing');
    setTimeout(() => {
      if (activeToast && activeToast.parentNode) {
        activeToast.parentNode.removeChild(activeToast);
      }
      activeToast = null;
    }, 300);
  }

  // =========================================================================
  // Communication with Injected Script (Layer 1: Network Cache / In-Page Fetch)
  // =========================================================================
  function getMediaFromInjected(shortcode) {
    return new Promise((resolve) => {
      if (!shortcode) return resolve(null);

      const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
      let resolved = false;

      function onMessage(event) {
        if (
          event.source === window &&
          event.data &&
          event.data.type === 'INSTA_DL_RESPONSE' &&
          event.data.requestId === requestId
        ) {
          window.removeEventListener('message', onMessage);
          resolved = true;
          resolve(event.data.data);
        }
      }

      window.addEventListener('message', onMessage);

      window.postMessage(
        {
          type: 'INSTA_DL_REQUEST',
          action: 'GET_MEDIA',
          shortcode,
          requestId
        },
        '*'
      );

      // Timeout fallback to DOM traversal after 700ms
      setTimeout(() => {
        if (!resolved) {
          window.removeEventListener('message', onMessage);
          resolve(null);
        }
      }, 700);
    });
  }

  // =========================================================================
  // DOM Metadata & Shortcode Extraction
  // =========================================================================
  function getPostMetadata(article) {
    let shortcode = '';
    let username = '';

    // Check location URL if on single post page (/p/SHORTCODE or /reel/SHORTCODE)
    const pageMatch = window.location.pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
    if (pageMatch) {
      shortcode = pageMatch[2];
    }

    // Check links inside article
    if (!shortcode) {
      const postLinks = article.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
      for (const link of postLinks) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        if (match && match[1]) {
          shortcode = match[1];
          break;
        }
      }
    }

    // Try finding username in header or user link
    const userLink = article.querySelector('header a[href^="/"], a._a6hd[href^="/"]');
    if (userLink) {
      const rawUser = userLink.getAttribute('href') || '';
      const cleanUser = rawUser.replace(/\//g, '').split('?')[0];
      if (cleanUser && cleanUser !== 'explore' && cleanUser !== 'p' && cleanUser !== 'reel') {
        username = cleanUser;
      }
    }

    if (!username) {
      // Look for any link with role="link" containing username text
      const authorElem = article.querySelector('span._ap3a._aaco._aacw._aacx._aad7._aade');
      if (authorElem && authorElem.textContent.trim()) {
        username = authorElem.textContent.trim();
      }
    }

    return {
      shortcode: shortcode || 'post_' + Math.random().toString(36).substring(2, 8),
      username: username || 'instagram_user'
    };
  }

  // =========================================================================
  // Helper: Extract highest-resolution image from an <img> element
  // =========================================================================
  function getHighestResImageFromElement(img) {
    if (!img) return null;
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      // Parse "url 1080w, url 720w, url 640w"
      const candidates = srcset.split(',').map((entry) => {
        const parts = entry.trim().split(/\s+/);
        const url = parts[0];
        const width = parts[1] ? parseInt(parts[1].replace('w', ''), 10) : 0;
        return { url, width };
      });
      candidates.sort((a, b) => b.width - a.width);
      if (candidates.length > 0 && candidates[0].url) {
        return candidates[0].url;
      }
    }
    return img.src || null;
  }

  // =========================================================================
  // DOM Media Extractor (Layer 2: Carousel Traversal & Single Media Scraper)
  // =========================================================================
  async function extractMediaFromDOM(article, onProgress = () => {}) {
    const items = [];
    const seenUrls = new Set();

    // Check if this article contains a carousel
    const slideButtons = article.querySelectorAll('button[aria-label*="slide"], button[aria-label*="Slide"]');
    const isCarousel = slideButtons.length > 1 || !!article.querySelector('button[aria-label="Next"], button[aria-label*="Next"]');

    if (!isCarousel) {
      // Single media post
      const video = article.querySelector('video');
      if (video && video.src && !video.src.startsWith('blob:')) {
        items.push({
          type: 'video',
          url: video.src,
          width: video.videoWidth || 1080,
          height: video.videoHeight || 1080
        });
        return items;
      }

      // Check main image
      const imgs = article.querySelectorAll('div._aagu img, div._aagv img, img[crossorigin="anonymous"]');
      let bestImg = null;
      for (const img of imgs) {
        // Exclude small profile pictures
        const w = img.clientWidth || img.naturalWidth || 0;
        if (w > 150) {
          bestImg = img;
          break;
        }
      }
      if (!bestImg && imgs.length > 0) bestImg = imgs[0];

      if (bestImg) {
        const url = getHighestResImageFromElement(bestImg);
        if (url) {
          items.push({
            type: 'image',
            url,
            width: bestImg.naturalWidth || 1080,
            height: bestImg.naturalHeight || 1080
          });
        }
      }
      return items;
    }

    // Carousel: Traverse all slides
    const totalEstimated = slideButtons.length > 0 ? slideButtons.length : 10;
    onProgress({ current: 1, total: totalEstimated, status: 'Scanning carousel slides...' });

    // Ensure we start from slide 1 if slide button is available
    const firstSlideBtn = article.querySelector('button[aria-label="Go to slide 1"], button[aria-label="Slide 1"]');
    if (firstSlideBtn && !firstSlideBtn.hasAttribute('aria-current')) {
      firstSlideBtn.click();
      await new Promise((r) => setTimeout(r, 200));
    }

    let slideIndex = 1;
    let keepGoing = true;

    while (keepGoing && slideIndex <= 25) {
      onProgress({ current: slideIndex, total: totalEstimated, status: `Scanning slide ${slideIndex}...` });

      // Scan current slide media
      // In Instagram carousels, active or visible list items are inside <ul>
      const currentListItems = article.querySelectorAll('ul li');
      let slideFound = false;

      // Check videos in slide
      const videos = article.querySelectorAll('video');
      for (const video of videos) {
        if (video && video.src && !video.src.startsWith('blob:') && !seenUrls.has(video.src)) {
          seenUrls.add(video.src);
          items.push({
            type: 'video',
            url: video.src,
            width: video.videoWidth || 1080,
            height: video.videoHeight || 1080
          });
          slideFound = true;
        }
      }

      // Check images in slide
      const imgs = article.querySelectorAll('ul li img, div._aagu img, div._aagv img');
      for (const img of imgs) {
        const w = img.clientWidth || img.naturalWidth || 0;
        if (w > 150) {
          const url = getHighestResImageFromElement(img);
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            items.push({
              type: 'image',
              url,
              width: img.naturalWidth || 1080,
              height: img.naturalHeight || 1080
            });
            slideFound = true;
          }
        }
      }

      // Check if there is a Next button
      const nextBtn = article.querySelector('button[aria-label="Next"], button[aria-label*="Next"]');
      if (nextBtn && nextBtn.offsetParent !== null) {
        nextBtn.click();
        slideIndex++;
        await new Promise((r) => setTimeout(r, 220));
      } else {
        keepGoing = false;
      }
    }

    // Restore carousel back to slide 1
    const resetBtn = article.querySelector('button[aria-label="Go to slide 1"], button[aria-label="Slide 1"]');
    if (resetBtn) {
      resetBtn.click();
    } else {
      // Click Previous buttons until at beginning
      let prevBtn = article.querySelector('button[aria-label="Go back"], button[aria-label="Previous"], button[aria-label*="Previous"]');
      let rewindCount = 0;
      while (prevBtn && prevBtn.offsetParent !== null && rewindCount < 20) {
        prevBtn.click();
        await new Promise((r) => setTimeout(r, 50));
        prevBtn = article.querySelector('button[aria-label="Go back"], button[aria-label="Previous"], button[aria-label*="Previous"]');
        rewindCount++;
      }
    }

    return items;
  }

  // =========================================================================
  // Master Media Gathering Function
  // =========================================================================
  async function getPostMedia(article, metadata, onProgress) {
    onProgress({ current: 0, total: 1, status: 'Locating media items...' });

    // Step 1: Check Injected Script network cache
    try {
      const netData = await getMediaFromInjected(metadata.shortcode);
      if (netData && Array.isArray(netData.items) && netData.items.length > 0) {
        console.log('[Instagram Media Downloader] Found media via network cache:', netData.items.length);
        if (netData.username) metadata.username = netData.username;
        return netData.items;
      }
    } catch (e) {
      console.warn('[Instagram Media Downloader] Network cache check error:', e);
    }

    // Step 2: Fall back to DOM extraction
    console.log('[Instagram Media Downloader] Extracting media from DOM...');
    const domItems = await extractMediaFromDOM(article, onProgress);
    return domItems;
  }

  // =========================================================================
  // Blob Fetching with Background Worker Fallback
  // =========================================================================
  async function fetchMediaBlob(url) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return { blob, dataUrl: null };
    } catch (directError) {
      // Fall back to background worker cross-origin fetch
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'FETCH_BLOB', url },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            if (res && res.success && res.dataUrl) {
              fetch(res.dataUrl)
                .then((r) => r.blob())
                .then((blob) => resolve({ blob, dataUrl: res.dataUrl }))
                .catch(reject);
            } else {
              reject(new Error(res?.error || 'Failed to fetch media blob.'));
            }
          }
        );
      });
    }
  }

  // Helper to convert Blob to Data URL
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // =========================================================================
  // File Download Trigger
  // =========================================================================
  function triggerFileDownload(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      link.remove();
    }, 2000);
  }

  // =========================================================================
  // Download as ZIP (Images + Videos)
  // =========================================================================
  async function handleDownloadZip(article) {
    const metadata = getPostMetadata(article);
    showToast({
      title: 'Packaging ZIP',
      message: 'Scanning post media...',
      indeterminate: true
    });

    try {
      const items = await getPostMedia(article, metadata, (p) => {
        showToast({
          title: 'Packaging ZIP',
          message: p.status,
          indeterminate: true
        });
      });

      if (!items || items.length === 0) {
        showToast({
          title: 'Download Failed',
          message: 'Could not find images or videos in this post.',
          isError: true
        });
        return;
      }

      if (!window.JSZip) {
        throw new Error('JSZip library is not loaded.');
      }

      const zip = new window.JSZip();
      const total = items.length;

      for (let i = 0; i < total; i++) {
        const item = items[i];
        const percent = Math.round(((i + 1) / total) * 85);
        showToast({
          title: 'Downloading Files',
          message: `Downloading item ${i + 1} of ${total} (${item.type.toUpperCase()})...`,
          progress: percent
        });

        const { blob } = await fetchMediaBlob(item.url);
        const ext = item.type === 'video' ? 'mp4' : 'jpg';
        const fileNumber = String(i + 1).padStart(2, '0');
        const filename = `${metadata.username}_${metadata.shortcode}_${fileNumber}.${ext}`;
        zip.file(filename, blob);
      }

      showToast({
        title: 'Compressing Archive',
        message: 'Building ZIP file...',
        progress: 90
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        const p = 90 + Math.round((meta.percent / 100) * 10);
        showToast({
          title: 'Compressing Archive',
          message: `Compressing... ${Math.round(meta.percent)}%`,
          progress: p
        });
      });

      const zipFilename = `${metadata.username}_${metadata.shortcode}.zip`;
      triggerFileDownload(zipBlob, zipFilename);

      showToast({
        title: 'Download Complete! 🎉',
        message: `Saved ${total} file${total > 1 ? 's' : ''} to ${zipFilename}`,
        progress: 100,
        isSuccess: true
      });
    } catch (err) {
      console.error('[Instagram Media Downloader] ZIP error:', err);
      showToast({
        title: 'Error Generating ZIP',
        message: err.message || 'An unexpected error occurred.',
        isError: true
      });
    }
  }

  // =========================================================================
  // Download as PDF (Images Only - Videos Excluded)
  // =========================================================================
  async function handleDownloadPdf(article) {
    const metadata = getPostMetadata(article);
    showToast({
      title: 'Generating PDF',
      message: 'Scanning images...',
      indeterminate: true
    });

    try {
      const allItems = await getPostMedia(article, metadata, (p) => {
        showToast({
          title: 'Generating PDF',
          message: p.status,
          indeterminate: true
        });
      });

      // Filter: ONLY IMAGES (strictly exclude videos per user prompt)
      const imageItems = (allItems || []).filter((item) => item.type === 'image');

      if (!imageItems || imageItems.length === 0) {
        showToast({
          title: 'No Images Found',
          message: 'This post only contains video(s). Please choose "Download ZIP" to download videos.',
          isError: true,
          duration: 5000
        });
        return;
      }

      if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('jsPDF library is not loaded.');
      }

      const totalImages = imageItems.length;
      const loadedImages = [];

      for (let i = 0; i < totalImages; i++) {
        const item = imageItems[i];
        const percent = Math.round(((i + 1) / totalImages) * 75);
        showToast({
          title: 'Loading Images',
          message: `Processing image ${i + 1} of ${totalImages}...`,
          progress: percent
        });

        const { blob, dataUrl: initialDataUrl } = await fetchMediaBlob(item.url);
        const dataUrl = initialDataUrl || (await blobToDataUrl(blob));

        // Load image in memory to determine accurate natural aspect ratio
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            loadedImages.push({
              dataUrl,
              width: img.naturalWidth || item.width || 1080,
              height: img.naturalHeight || item.height || 1080
            });
            resolve();
          };
          img.onerror = () => {
            // Fallback dimensions if decode fails
            loadedImages.push({
              dataUrl,
              width: item.width || 1080,
              height: item.height || 1080
            });
            resolve();
          };
          img.src = dataUrl;
        });
      }

      showToast({
        title: 'Compiling PDF',
        message: 'Formatting pages with full resolution...',
        progress: 85
      });

      const { jsPDF } = window.jspdf;
      let doc = null;

      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const orientation = img.width >= img.height ? 'landscape' : 'portrait';

        if (i === 0) {
          doc = new jsPDF({
            orientation,
            unit: 'px',
            format: [img.width, img.height],
            hotfixes: ['px_scaling']
          });
          doc.addImage(img.dataUrl, 'JPEG', 0, 0, img.width, img.height);
        } else {
          doc.addPage([img.width, img.height], orientation);
          doc.addImage(img.dataUrl, 'JPEG', 0, 0, img.width, img.height);
        }
      }

      showToast({
        title: 'Finalizing PDF',
        message: 'Generating document file...',
        progress: 95
      });

      const pdfBlob = doc.output('blob');
      const pdfFilename = `${metadata.username}_${metadata.shortcode}.pdf`;
      triggerFileDownload(pdfBlob, pdfFilename);

      showToast({
        title: 'PDF Ready! 🎉',
        message: `Saved ${totalImages} image${totalImages > 1 ? 's' : ''} to ${pdfFilename}`,
        progress: 100,
        isSuccess: true
      });
    } catch (err) {
      console.error('[Instagram Media Downloader] PDF error:', err);
      showToast({
        title: 'PDF Generation Error',
        message: err.message || 'Failed to create PDF.',
        isError: true
      });
    }
  }

  // =========================================================================
  // Download Active / Single Slide
  // =========================================================================
  async function handleDownloadCurrent(article) {
    const metadata = getPostMetadata(article);
    showToast({
      title: 'Quick Download',
      message: 'Fetching current item...',
      indeterminate: true
    });

    try {
      // Check for active video first
      const video = article.querySelector('video');
      if (video && video.src && !video.src.startsWith('blob:')) {
        const { blob } = await fetchMediaBlob(video.src);
        const filename = `${metadata.username}_${metadata.shortcode}_current.mp4`;
        triggerFileDownload(blob, filename);
        showToast({
          title: 'Video Downloaded! 🎉',
          message: filename,
          isSuccess: true
        });
        return;
      }

      // Check current visible image
      const imgs = article.querySelectorAll('ul li img, div._aagu img, div._aagv img');
      let currentImg = null;
      for (const img of imgs) {
        if ((img.clientWidth || img.naturalWidth || 0) > 150) {
          currentImg = img;
          break;
        }
      }

      if (!currentImg) {
        showToast({
          title: 'Not Found',
          message: 'Could not detect active image on screen.',
          isError: true
        });
        return;
      }

      const url = getHighestResImageFromElement(currentImg);
      const { blob } = await fetchMediaBlob(url);
      const filename = `${metadata.username}_${metadata.shortcode}_current.jpg`;
      triggerFileDownload(blob, filename);

      showToast({
        title: 'Image Downloaded! 🎉',
        message: filename,
        isSuccess: true
      });
    } catch (err) {
      showToast({
        title: 'Download Error',
        message: err.message,
        isError: true
      });
    }
  }

  // =========================================================================
  // Dropdown Menu UI Component
  // =========================================================================
  let openDropdown = null;

  function closeOpenDropdown() {
    if (openDropdown && openDropdown.parentNode) {
      openDropdown.parentNode.removeChild(openDropdown);
    }
    openDropdown = null;
  }

  document.addEventListener('click', (e) => {
    if (openDropdown && !openDropdown.contains(e.target) && !e.target.closest('.insta-dl-action-btn') && !e.target.closest('.insta-dl-media-badge')) {
      closeOpenDropdown();
    }
  });

  function showDownloadMenu(anchorElement, article) {
    if (openDropdown) {
      const wasSame = openDropdown.__anchor === anchorElement;
      closeOpenDropdown();
      if (wasSame) return;
    }

    const metadata = getPostMetadata(article);
    const slideButtons = article.querySelectorAll('button[aria-label*="slide"], button[aria-label*="Slide"]');
    const isCarousel = slideButtons.length > 1;
    const mediaTypeLabel = isCarousel ? `Carousel (${slideButtons.length} items)` : 'Single Post';

    const menu = document.createElement('div');
    menu.className = 'insta-dl-dropdown';
    menu.__anchor = anchorElement;

    menu.innerHTML = `
      <div class="insta-dl-menu-header">
        <div class="insta-dl-menu-header-info">
          <span class="insta-dl-menu-username">@${metadata.username}</span>
          <span class="insta-dl-menu-subtitle">${mediaTypeLabel}</span>
        </div>
        <span class="insta-dl-badge">DOWNLOAD</span>
      </div>

      <div class="insta-dl-menu-item" data-action="zip">
        <div class="insta-dl-item-icon insta-dl-icon-zip">📦</div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Download All as ZIP</span>
            <span class="insta-dl-tag">ZIP</span>
          </div>
          <div class="insta-dl-item-desc">All images + videos in original quality</div>
        </div>
      </div>

      <div class="insta-dl-menu-item" data-action="pdf">
        <div class="insta-dl-item-icon insta-dl-icon-pdf">📄</div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Download Images as PDF</span>
            <span class="insta-dl-tag">PDF</span>
          </div>
          <div class="insta-dl-item-desc">Multi-page PDF • Videos excluded</div>
        </div>
      </div>

      <div class="insta-dl-menu-item" data-action="current">
        <div class="insta-dl-item-icon insta-dl-icon-single">🖼️</div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Download Current Slide</span>
            <span class="insta-dl-tag">FAST</span>
          </div>
          <div class="insta-dl-item-desc">Save active image or video only</div>
        </div>
      </div>
    `;

    // Handle clicks inside dropdown menu
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.insta-dl-menu-item');
      if (!item) return;

      const action = item.getAttribute('data-action');
      closeOpenDropdown();

      if (action === 'zip') {
        handleDownloadZip(article);
      } else if (action === 'pdf') {
        handleDownloadPdf(article);
      } else if (action === 'current') {
        handleDownloadCurrent(article);
      }
    });

    anchorElement.appendChild(menu);
    openDropdown = menu;
  }

  // =========================================================================
  // Button Injection Logic
  // =========================================================================
  const DOWNLOAD_ICON_SVG = `
    <svg aria-label="Download" class="insta-dl-icon" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24">
      <title>Download Post</title>
      <path d="M12 2.5a1 1 0 0 1 1 1v10.172l2.879-2.879a1 1 0 1 1 1.414 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-4.586-4.586a1 1 0 1 1 1.414-1.414L11 13.672V3.5a1 1 0 0 1 1-1Z" fill="currentColor"></path>
      <path d="M3.5 16.5a1 1 0 0 1 1 1V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5a1 1 0 1 1 2 0V19a3 3 0 0 1-3 3H5.5a3 3 0 0 1-3-3v-1.5a1 1 0 0 1 1-1Z" fill="currentColor"></path>
    </svg>
  `;

  function injectButtonsIntoArticle(article) {
    if (!article || article.hasAttribute('data-insta-dl-injected')) return;

    // 1. Locate Action Section (containing Like, Comment, Share, Save)
    const sections = article.querySelectorAll('section');
    let actionSection = null;

    for (const section of sections) {
      if (
        section.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]') ||
        section.querySelector('svg[aria-label="Save"], svg[aria-label="Remove"]') ||
        section.querySelector('svg[aria-label="Share"], svg[aria-label="Share Post"]')
      ) {
        actionSection = section;
        break;
      }
    }

    if (!actionSection) {
      // If no section found yet (might still be rendering), don't mark as permanently injected
      return;
    }

    // Mark post as injected
    article.setAttribute('data-insta-dl-injected', 'true');

    // Create Action Bar Download Button
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'insta-dl-action-btn-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'insta-dl-action-btn';
    btn.setAttribute('aria-label', 'Download Options');
    btn.innerHTML = DOWNLOAD_ICON_SVG;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadMenu(btnWrapper, article);
    });

    btnWrapper.appendChild(btn);

    // Place right beside the Save/Bookmark button if present, or at the end of the action section
    const saveIcon = actionSection.querySelector('svg[aria-label="Save"], svg[aria-label="Remove"]');
    if (saveIcon) {
      const saveContainer = saveIcon.closest('div[role="button"]') || saveIcon.closest('.x14z9mp') || saveIcon.parentElement;
      if (saveContainer && saveContainer.parentElement) {
        saveContainer.parentElement.insertBefore(btnWrapper, saveContainer);
      } else {
        actionSection.appendChild(btnWrapper);
      }
    } else {
      actionSection.appendChild(btnWrapper);
    }

    // 2. Also inject a floating badge onto the media container for rapid 1-click access
    const mediaContainer =
      article.querySelector('div._aagu') ||
      article.querySelector('div._aagv') ||
      article.querySelector('ul') ||
      article.querySelector('div[role="presentation"]');

    if (mediaContainer && !article.querySelector('.insta-dl-media-badge-container')) {
      const badgeContainer = document.createElement('div');
      badgeContainer.className = 'insta-dl-media-badge-container';

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'insta-dl-media-badge';
      badge.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M12 2.5a1 1 0 0 1 1 1v10.172l2.879-2.879a1 1 0 1 1 1.414 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-4.586-4.586a1 1 0 1 1 1.414-1.414L11 13.672V3.5a1 1 0 0 1 1-1Z" fill="currentColor"></path><path d="M3.5 16.5a1 1 0 0 1 1 1V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5a1 1 0 1 1 2 0V19a3 3 0 0 1-3 3H5.5a3 3 0 0 1-3-3v-1.5a1 1 0 0 1 1-1Z" fill="currentColor"></path></svg>
        <span>Download</span>
      `;

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showDownloadMenu(badgeContainer, article);
      });

      badgeContainer.appendChild(badge);

      // Media container must be relatively positioned
      const parentStyle = window.getComputedStyle(mediaContainer);
      if (parentStyle.position === 'static') {
        mediaContainer.style.position = 'relative';
      }
      mediaContainer.appendChild(badgeContainer);
    }
  }

  // Scan all articles across the document
  function scanAndInject() {
    // Both standard articles and dialog overlay articles
    const articles = document.querySelectorAll('article:not([data-insta-dl-injected])');
    articles.forEach((article) => {
      injectButtonsIntoArticle(article);
    });

    // Also check dedicated dialog or modal overlays
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    dialogs.forEach((dialog) => {
      const modalArticle = dialog.querySelector('article:not([data-insta-dl-injected])');
      if (modalArticle) {
        injectButtonsIntoArticle(modalArticle);
      }
    });
  }

  // =========================================================================
  // MutationObserver for Dynamic Feed Loading & SPAs
  // =========================================================================
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(scanAndInject, 150);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Run initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndInject);
  } else {
    scanAndInject();
  }

  // Re-scan when history changes (SPA route transitions)
  window.addEventListener('popstate', () => {
    setTimeout(scanAndInject, 500);
  });
})();
