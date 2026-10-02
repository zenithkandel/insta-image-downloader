/**
 * Instagram Media Downloader - Popup Script
 * Manages user preferences and settings.
 */

document.addEventListener('DOMContentLoaded', () => {
  const floatingBadgeToggle = document.getElementById('floatingBadgeToggle');
  const includeVideosToggle = document.getElementById('includeVideosToggle');

  // Load existing preferences
  chrome.storage.local.get(['dlSettings'], (result) => {
    const settings = result.dlSettings || {};
    if (floatingBadgeToggle && typeof settings.showFloatingBadge === 'boolean') {
      floatingBadgeToggle.checked = settings.showFloatingBadge;
    }
    if (includeVideosToggle && typeof settings.includeVideosInZip === 'boolean') {
      includeVideosToggle.checked = settings.includeVideosInZip;
    }
  });

  // Save changes
  if (floatingBadgeToggle) {
    floatingBadgeToggle.addEventListener('change', () => {
      chrome.storage.local.get(['dlSettings'], (result) => {
        const settings = result.dlSettings || {};
        settings.showFloatingBadge = floatingBadgeToggle.checked;
        chrome.storage.local.set({ dlSettings: settings });
      });
    });
  }

  if (includeVideosToggle) {
    includeVideosToggle.addEventListener('change', () => {
      chrome.storage.local.get(['dlSettings'], (result) => {
        const settings = result.dlSettings || {};
        settings.includeVideosInZip = includeVideosToggle.checked;
        chrome.storage.local.set({ dlSettings: settings });
      });
    });
  }
});
