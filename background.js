/**
 * Instagram Media Downloader - Background Service Worker
 * Manages downloads, CORS-free media fetching fallback, and extension lifecycle.
 */

chrome.runtime.onInstalled.addListener(() => {
  // Set default settings if not yet defined
  chrome.storage.local.get(['dlSettings'], (result) => {
    if (!result.dlSettings) {
      chrome.storage.local.set({
        dlSettings: {
          defaultAction: 'menu', // 'menu', 'zip', 'pdf'
          filenameFormat: 'user_shortcode', // 'user_shortcode', 'shortcode'
          showFloatingBadge: true,
          includeVideosInZip: true
        }
      });
    }
  });
  console.log('[Instagram Media Downloader] Service worker installed.');
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FETCH_BLOB') {
    // Cross-origin fetch fallback using background permissions
    fetch(message.url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result, mimeType: blob.type });
        };
        reader.onerror = () => {
          sendResponse({ success: false, error: 'Failed to read blob as Data URL' });
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'TRIGGER_DOWNLOAD') {
    const { url, filename } = message;
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
    return true;
  }
});
