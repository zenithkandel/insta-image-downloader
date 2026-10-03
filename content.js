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
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : isError
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<span class="insta-dl-spinner"></span>';

    activeToast.className = `insta-dl-toast ${indeterminate ? 'insta-dl-progress-indeterminate' : ''}`;
    activeToast.innerHTML = `
      <div class="insta-dl-toast-header">
        <div class="insta-dl-toast-title">
          ${iconHtml}
          <span>${title}</span>
        </div>
        <button class="insta-dl-toast-close" title="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
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
  function getPostMetadata(postContainer) {
    let shortcode = '';
    let username = '';

    // Check location URL if on single post page (/p/SHORTCODE or /reel/SHORTCODE)
    const pageMatch = window.location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    if (pageMatch) {
      shortcode = pageMatch[1];
    }

    // Check links inside postContainer
    if (!shortcode && postContainer) {
      const postLinks = postContainer.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
      for (const link of postLinks) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        if (match && match[1]) {
          shortcode = match[1];
          break;
        }
      }
    }

    // Fallback: check canonical or og:url meta tags
    if (!shortcode) {
      const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
      const match = ogUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (match && match[1]) {
        shortcode = match[1];
      }
    }

    // Try finding username in header or user links
    if (postContainer) {
      const userLinks = postContainer.querySelectorAll('header a[href^="/"], a._a6hd[href^="/"], h2 a, a[role="link"][href^="/"]');
      for (const userLink of userLinks) {
        const rawUser = userLink.getAttribute('href') || '';
        const cleanUser = rawUser.replace(/\//g, '').split('?')[0];
        if (cleanUser && !['explore', 'p', 'reel', 'stories', 'direct'].includes(cleanUser)) {
          username = cleanUser;
          break;
        }
      }
    }

    if (!username && postContainer) {
      // Look for any element with username text
      const authorElem = postContainer.querySelector('span._ap3a._aaco._aacw._aacx._aad7._aade, h2');
      if (authorElem && authorElem.textContent.trim()) {
        username = authorElem.textContent.trim();
      }
    }

    // Fallback: extract username from document title e.g. "Mahabir Pun on Instagram: ..."
    if (!username) {
      const titleMatch = document.title.match(/^([^•:(@]+)/);
      if (titleMatch && titleMatch[1]) {
        username = titleMatch[1].trim().replace(/\s+/g, '_');
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
      const imgs = article.querySelectorAll('div._aagu img, div._aagv img, div._aatk img, img[crossorigin="anonymous"], img[src*="cdninstagram"], img[src*="fbcdn"], img');
      let bestImg = null;
      let maxArea = 0;

      for (const img of imgs) {
        // Exclude small profile pictures, avatars, and emojis
        const w = img.clientWidth || img.naturalWidth || 0;
        const h = img.clientHeight || img.naturalHeight || 0;
        const area = w * h;

        if (w > 160 && h > 160 && area > maxArea) {
          // Avoid recommendation grid images at bottom if on standalone page
          const isFooterRec =
            img.closest('main > div:nth-child(2)') ||
            img.closest('div[style*="max-width: 935px"] > div:nth-child(2)') ||
            img.closest('footer') ||
            img.closest('header');
          if (!isFooterRec) {
            maxArea = area;
            bestImg = img;
          }
        }
      }

      if (!bestImg && imgs.length > 0) {
        for (const img of imgs) {
          const w = img.clientWidth || img.naturalWidth || 0;
          if (w > 120) {
            bestImg = img;
            break;
          }
        }
      }

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
    if (url.startsWith('data:')) {
      const res = await fetch(url);
      const blob = await res.blob();
      return { blob, dataUrl: url };
    }

    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return { blob, dataUrl: null };
    } catch (directError) {
      // Fall back to background worker cross-origin fetch
      return new Promise((resolve, reject) => {
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
          return reject(new Error('Browser extension runtime unavailable.'));
        }
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
      </div>

      <div class="insta-dl-menu-item" data-action="zip">
        <div class="insta-dl-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 8v13H3V8"></path>
            <path d="M1 3h22v5H1z"></path>
            <path d="M10 12h4"></path>
          </svg>
        </div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Download ZIP</span>
            <span class="insta-dl-tag">.ZIP</span>
          </div>
          <div class="insta-dl-item-desc">All images &amp; videos archive</div>
        </div>
      </div>

      <div class="insta-dl-menu-item" data-action="pdf">
        <div class="insta-dl-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
        </div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Download PDF</span>
            <span class="insta-dl-tag">.PDF</span>
          </div>
          <div class="insta-dl-item-desc">Images only • Multi-page document</div>
        </div>
      </div>

      <div class="insta-dl-menu-item" data-action="current">
        <div class="insta-dl-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </div>
        <div class="insta-dl-item-content">
          <div class="insta-dl-item-title">
            <span>Current Slide</span>
            <span class="insta-dl-tag">ACTIVE</span>
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

    // Calculate smart fixed position
    const rect = anchorElement.getBoundingClientRect();
    const menuWidth = 280;
    const menuHeight = 230;

    const spaceBelow = window.innerHeight - rect.bottom;
    let top, left;

    if (spaceBelow < menuHeight + 20 && rect.top > menuHeight + 20) {
      // Open upwards
      top = rect.top - menuHeight - 8;
    } else {
      // Open downwards
      top = rect.bottom + 8;
    }

    // Align right edge of menu with right edge of anchor button
    left = rect.right - menuWidth;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    document.body.appendChild(menu);
    openDropdown = menu;

    function onScrollOrResize() {
      closeOpenDropdown();
    }
    window.addEventListener('scroll', onScrollOrResize, { passive: true, once: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true, once: true });
  }

  // =========================================================================
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

  // Track user preferences from popup settings
  let showFloatingBadge = true;

  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(['dlSettings'], (result) => {
          if (result && result.dlSettings && typeof result.dlSettings.showFloatingBadge === 'boolean') {
            showFloatingBadge = result.dlSettings.showFloatingBadge;
            if (!showFloatingBadge) {
              document.querySelectorAll('.insta-dl-media-badge-container').forEach((el) => el.remove());
            } else {
              scanAndInject();
            }
          }
        });
      } catch (e) {}
    }
  }

  loadSettings();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.dlSettings) {
          loadSettings();
        }
      });
    } catch (e) {}
  }

  // Remove any button erroneously placed outside a legitimate post container
  function cleanupOrphanButtons() {
    document.querySelectorAll('.insta-dl-action-btn-wrapper').forEach((wrapper) => {
      if (
        wrapper.closest('nav, [role="navigation"], aside, [role="complementary"], header, footer') ||
        (!wrapper.closest('article') &&
          !wrapper.closest('div[role="dialog"]') &&
          !window.location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/) &&
          !document.querySelector('.standalone-post-view'))
      ) {
        wrapper.remove();
      }
    });

    document.querySelectorAll('.insta-dl-media-badge-container').forEach((badge) => {
      if (
        badge.closest('nav, [role="navigation"], aside, [role="complementary"], header, footer') ||
        (!badge.closest('article') &&
          !badge.closest('div[role="dialog"]') &&
          !window.location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/) &&
          !document.querySelector('.standalone-post-view'))
      ) {
        badge.remove();
      }
    });
  }

  function createActionButton(postContainer, sampleSvg) {
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'insta-dl-action-btn-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'insta-dl-action-btn';
    btn.setAttribute('aria-label', 'Download Options');
    btn.setAttribute('title', 'Download Media');
    btn.innerHTML = DOWNLOAD_ICON_SVG;

    if (sampleSvg) {
      try {
        const comp = window.getComputedStyle(sampleSvg);
        const c = comp.color || comp.fill;
        if (c && c !== 'none' && c !== 'rgba(0, 0, 0, 0)') {
          btn.style.color = c;
        }
      } catch (e) {}
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadMenu(btnWrapper, postContainer);
    });

    btnWrapper.appendChild(btn);
    return btnWrapper;
  }

  function injectDownloadButtonIntoPost(postContainer) {
    if (!postContainer) return;
    // Strictly one download button per post container
    if (postContainer.querySelector('.insta-dl-action-btn-wrapper')) return;

    // Disallow injection if container is inside navigation, sidebar, or footer
    if (postContainer.closest('nav, [role="navigation"], aside, [role="complementary"], header, footer')) {
      return;
    }

    // 1. Locate the Save/Bookmark button in this post
    const saveCandidate = postContainer.querySelector(`
      [aria-label="Save" i],
      [aria-label="Save post" i],
      [aria-label="Saved" i],
      [aria-label="Remove from saved" i],
      [aria-label="Bookmark" i],
      [aria-label*="Bookmark" i],
      polygon[points*="20 21 12 13.44"],
      polygon[points*="12 13.44"],
      [title="Save" i],
      [title="Bookmark" i]
    `);

    let validSave = null;
    if (saveCandidate && !saveCandidate.closest('header, form, ul[class*="comments"], aside, nav, [role="navigation"]')) {
      validSave = saveCandidate;
    }

    let targetEl = null;
    let insertBefore = true;

    if (validSave) {
      targetEl =
        validSave.closest('div[role="button"]') ||
        validSave.closest('button') ||
        (validSave.tagName === 'SVG' ? validSave.parentElement : validSave);
      insertBefore = true;
    } else {
      // 2. Fallback: Search for the Share button within this post (never "Direct")
      const shareCandidate = postContainer.querySelector(`
        [aria-label="Share Post" i],
        [aria-label="Share" i],
        [aria-label="Share post" i],
        [aria-label*="Share Post" i]
      `);

      if (shareCandidate && !shareCandidate.closest('header, form, ul[class*="comments"], aside, nav, [role="navigation"]')) {
        targetEl =
          shareCandidate.closest('div[role="button"]') ||
          shareCandidate.closest('button') ||
          (shareCandidate.tagName === 'SVG' ? shareCandidate.parentElement : shareCandidate);
        insertBefore = false;
      }
    }

    // If neither Save nor Share was found, DO NOT inject anything
    if (!targetEl || !targetEl.parentElement) {
      return;
    }

    const actionRow = targetEl.closest('section') || targetEl.parentElement;
    const sampleSvg = (actionRow && actionRow.querySelector('svg')) || (targetEl && targetEl.querySelector('svg'));
    const btnWrapper = createActionButton(postContainer, sampleSvg);

    const parent = targetEl.parentElement;

    // If parent is a tiny fixed-size single-button wrapper, inject into grandparent next to the wrapper
    if (
      parent.clientWidth > 0 &&
      parent.clientWidth <= 40 &&
      parent.parentElement &&
      parent.parentElement !== postContainer
    ) {
      const grandParent = parent.parentElement;
      const grandComp = window.getComputedStyle(grandParent);
      if (grandComp.display === 'block' || grandComp.display === 'inline') {
        grandParent.style.display = 'inline-flex';
        grandParent.style.alignItems = 'center';
      }
      if (insertBefore) {
        grandParent.insertBefore(btnWrapper, parent);
      } else {
        grandParent.insertBefore(btnWrapper, parent.nextSibling);
      }
    } else {
      const pComp = window.getComputedStyle(parent);
      if (pComp.display === 'block' || pComp.display === 'inline') {
        parent.style.display = 'inline-flex';
        parent.style.alignItems = 'center';
      }
      if (insertBefore) {
        parent.insertBefore(btnWrapper, targetEl);
      } else {
        parent.insertBefore(btnWrapper, targetEl.nextSibling);
      }
    }
  }

  // Find the primary post media element (image or video)
  function findPrimaryPostMedia(postRoot) {
    if (!postRoot) return null;

    // 1. Check video
    const videos = postRoot.querySelectorAll('video');
    for (const v of videos) {
      if (v.closest('header, nav, footer, aside, [role="navigation"], [role="complementary"]')) continue;
      const rect = v.getBoundingClientRect();
      if ((rect.width > 200 && rect.height > 200) || (v.clientWidth > 200 && v.clientHeight > 200)) {
        return v;
      }
    }

    // 2. Check images
    const imgs = postRoot.querySelectorAll('img');
    let bestImg = null;
    let maxArea = 0;

    for (const img of imgs) {
      if (img.closest('header, nav, footer, aside, [role="navigation"], [role="complementary"]')) continue;
      // Skip recommendation thumbnails ("More posts from...")
      if (img.closest('div[style*="max-width: 935px"] > div:nth-child(2)')) continue;
      // Skip avatar icons
      if (img.closest('a[href*="/"] > div > img') || (img.clientWidth > 0 && img.clientWidth < 100)) continue;

      const rect = img.getBoundingClientRect();
      const area = (rect.width || img.clientWidth || 0) * (rect.height || img.clientHeight || 0);
      if (area > maxArea && (img.clientWidth > 200 || img.naturalWidth > 200 || rect.width > 200)) {
        maxArea = area;
        bestImg = img;
      }
    }

    return bestImg;
  }

  function injectFloatingBadge(postRoot) {
    if (!postRoot) return;
    if (!showFloatingBadge) return;
    // Strictly one floating badge per post
    if (postRoot.querySelector('.insta-dl-media-badge-container')) return;

    if (postRoot.closest('nav, [role="navigation"], aside, [role="complementary"], header, footer')) {
      return;
    }

    const mediaEl = findPrimaryPostMedia(postRoot);
    if (!mediaEl) return;

    let container = mediaEl.parentElement;
    if (!container || container.querySelector('.insta-dl-media-badge-container')) return;

    const style = window.getComputedStyle(container);
    if (style.position === 'static') {
      container.style.position = 'relative';
    }

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'insta-dl-media-badge-container';

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'insta-dl-media-badge';
    badge.setAttribute('aria-label', 'Download Media');
    badge.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2.5a1 1 0 0 1 1 1v10.172l2.879-2.879a1 1 0 1 1 1.414 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-4.586-4.586a1 1 0 1 1 1.414-1.414L11 13.672V3.5a1 1 0 0 1 1-1Z" fill="currentColor"></path><path d="M3.5 16.5a1 1 0 0 1 1 1V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5a1 1 0 1 1 2 0V19a3 3 0 0 1-3 3H5.5a3 3 0 0 1-3-3v-1.5a1 1 0 0 1 1-1Z" fill="currentColor"></path></svg>
      <span>Download</span>
    `;

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadMenu(badge, postRoot);
    });

    badgeContainer.appendChild(badge);
    container.appendChild(badgeContainer);
  }

  // Master scan function
  function scanAndInject() {
    cleanupOrphanButtons();

    const postContainers = [];

    // 1. All post articles (home feed, profile feed, explore feed)
    document.querySelectorAll('article').forEach((art) => {
      if (!postContainers.includes(art)) {
        postContainers.push(art);
      }
    });

    // 2. Post dialog modals (when clicking a post in explore or profile grid)
    document.querySelectorAll('div[role="dialog"]').forEach((dlg) => {
      const art = dlg.querySelector('article');
      if (art) {
        if (!postContainers.includes(art)) {
          postContainers.push(art);
        }
      } else if (
        dlg.querySelector('img, video') &&
        dlg.querySelector('[aria-label*="Like" i], [aria-label*="Save" i], polygon[points*="12 13.44"]')
      ) {
        if (!postContainers.includes(dlg)) {
          postContainers.push(dlg);
        }
      }
    });

    // 3. Standalone post or reel page (/p/:id/ or /reel/:id/ or standalone test bed)
    const isStandalonePage =
      window.location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/) ||
      document.querySelector('.standalone-post-view');

    if (isStandalonePage) {
      const standalonePost =
        document.querySelector('.standalone-post-view main') ||
        document.querySelector('main article') ||
        document.querySelector('main > div') ||
        document.querySelector('main');

      if (standalonePost && !postContainers.some((c) => c === standalonePost || c.contains(standalonePost) || standalonePost.contains(c))) {
        postContainers.push(standalonePost);
      }
    }

    // Inject into each legitimate post container
    postContainers.forEach((postContainer) => {
      injectDownloadButtonIntoPost(postContainer);
      if (showFloatingBadge) {
        injectFloatingBadge(postContainer);
      }
    });
  }

  // =========================================================================
  // Lifecycle & Route Observer
  // =========================================================================
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(scanAndInject, 100);
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

  // Periodic safety check to handle lazy-loaded action bars
  setInterval(scanAndInject, 1000);

  // Hook history pushState and replaceState for SPA route changes
  const _pushState = history.pushState;
  history.pushState = function (...args) {
    const res = _pushState.apply(this, args);
    setTimeout(scanAndInject, 200);
    return res;
  };

  const _replaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = _replaceState.apply(this, args);
    setTimeout(scanAndInject, 200);
    return res;
  };

  window.addEventListener('popstate', () => {
    setTimeout(scanAndInject, 200);
  });
})();
