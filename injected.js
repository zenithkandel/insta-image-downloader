/**
 * Instagram Media Downloader - Main World Injected Script
 * Runs in the page's execution context to intercept Instagram's internal network responses
 * and cache highest-resolution media objects for posts (including carousels and videos).
 */

(function () {
  'use strict';

  if (window.__instaDlInjectedLoaded) return;
  window.__instaDlInjectedLoaded = true;

  const mediaStore = new Map();
  const blobCache = new Map();

  // Intercept URL.createObjectURL to capture blob media instances
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = originalCreateObjectURL.apply(this, arguments);
    if (obj instanceof Blob) {
      blobCache.set(url, obj);
    }
    return url;
  };

  /**
   * Helper to safely extract media items from an Instagram post or story object
   */
  function extractMediaFromNode(node, fallbackUsername) {
    if (!node || typeof node !== 'object') return null;

    const shortcode =
      node.shortcode ||
      node.code ||
      (node.id ? String(node.id).split('_')[0] : null) ||
      (node.pk ? String(node.pk) : null);

    if (!shortcode) return null;

    const username =
      node.owner?.username ||
      node.user?.username ||
      node.caption?.user?.username ||
      fallbackUsername ||
      'instagram_user';

    const items = [];

    // Case 1: Carousel post (edge_sidecar_to_children or carousel_media)
    const sidecarEdges = node.edge_sidecar_to_children?.edges;
    const carouselMedia = node.carousel_media;

    if (Array.isArray(sidecarEdges) && sidecarEdges.length > 0) {
      for (const edge of sidecarEdges) {
        const itemNode = edge.node;
        if (!itemNode) continue;
        if (itemNode.is_video && itemNode.video_url) {
          items.push({
            type: 'video',
            url: itemNode.video_url,
            thumbnailUrl: itemNode.display_url,
            width: itemNode.dimensions?.width || 1080,
            height: itemNode.dimensions?.height || 1080
          });
        } else {
          const displayUrl =
            itemNode.display_resources?.[itemNode.display_resources.length - 1]?.src ||
            itemNode.display_url;
          if (displayUrl) {
            items.push({
              type: 'image',
              url: displayUrl,
              width: itemNode.dimensions?.width || 1080,
              height: itemNode.dimensions?.height || 1080
            });
          }
        }
      }
    } else if (Array.isArray(carouselMedia) && carouselMedia.length > 0) {
      for (const item of carouselMedia) {
        const isVideo = item.media_type === 2 || !!item.video_versions;
        if (isVideo && item.video_versions && item.video_versions.length > 0) {
          items.push({
            type: 'video',
            url: item.video_versions[0].url,
            thumbnailUrl: item.image_versions2?.candidates?.[0]?.url,
            width: item.video_versions[0].width || 1080,
            height: item.video_versions[0].height || 1080
          });
        } else if (item.image_versions2?.candidates?.length > 0) {
          items.push({
            type: 'image',
            url: item.image_versions2.candidates[0].url,
            width: item.image_versions2.candidates[0].width || 1080,
            height: item.image_versions2.candidates[0].height || 1080
          });
        }
      }
    } else {
      // Case 2: Single Video post / Story video
      const isVideo =
        node.is_video ||
        node.media_type === 2 ||
        (Array.isArray(node.video_versions) && node.video_versions.length > 0);

      if (isVideo) {
        const videoUrl =
          node.video_url ||
          node.video_versions?.[0]?.url;
        if (videoUrl) {
          items.push({
            type: 'video',
            url: videoUrl,
            thumbnailUrl:
              node.display_url ||
              node.image_versions2?.candidates?.[0]?.url,
            width: node.dimensions?.width || node.video_versions?.[0]?.width || 1080,
            height: node.dimensions?.height || node.video_versions?.[0]?.height || 1920
          });
        }
      } else {
        // Case 3: Single Image post / Story photo
        const imageUrl =
          node.display_resources?.[node.display_resources.length - 1]?.src ||
          node.display_url ||
          node.image_versions2?.candidates?.[0]?.url;
        if (imageUrl) {
          items.push({
            type: 'image',
            url: imageUrl,
            width: node.dimensions?.width || node.image_versions2?.candidates?.[0]?.width || 1080,
            height: node.dimensions?.height || node.image_versions2?.candidates?.[0]?.height || 1920
          });
        }
      }
    }

    if (items.length > 0) {
      return {
        shortcode,
        username,
        id: node.id ? String(node.id) : (node.pk ? String(node.pk) : shortcode),
        items
      };
    }
    return null;
  }

  /**
   * Deep scan any JSON object to discover post and story nodes
   */
  function parseAndStorePosts(obj, parentUser) {
    if (!obj || typeof obj !== 'object') return;

    const currentUser = obj.user?.username || obj.owner?.username || parentUser;

    // Check if the current object itself is a post or story
    if (obj.shortcode || obj.code || (obj.id && (obj.video_versions || obj.image_versions2 || obj.is_video !== undefined))) {
      const extracted = extractMediaFromNode(obj, currentUser);
      if (extracted) {
        mediaStore.set(extracted.shortcode, extracted);
        if (extracted.id) mediaStore.set(String(extracted.id), extracted);
        if (obj.id) mediaStore.set(String(obj.id), extracted);
        if (obj.pk) mediaStore.set(String(obj.pk), extracted);

        // Also track under username for multi-story download
        if (extracted.username && extracted.username !== 'instagram_user') {
          const uKey = 'user_stories_' + extracted.username;
          const userStories = mediaStore.get(uKey) || [];
          if (!userStories.some((s) => s.shortcode === extracted.shortcode)) {
            userStories.push(extracted);
            mediaStore.set(uKey, userStories);
          }
        }
      }
    }

    // Direct common GraphQL wrapper properties
    if (obj.xdt_shortcode_media) {
      const extracted = extractMediaFromNode(obj.xdt_shortcode_media, currentUser);
      if (extracted) mediaStore.set(extracted.shortcode, extracted);
    }
    if (obj.shortcode_media) {
      const extracted = extractMediaFromNode(obj.shortcode_media, currentUser);
      if (extracted) mediaStore.set(extracted.shortcode, extracted);
    }

    // Story tray and reels media wrappers
    if (Array.isArray(obj.reels_media)) {
      for (const reel of obj.reels_media) {
        parseAndStorePosts(reel, reel.user?.username || currentUser);
      }
    }
    if (obj.reels && typeof obj.reels === 'object') {
      for (const k of Object.keys(obj.reels)) {
        parseAndStorePosts(obj.reels[k], obj.reels[k]?.user?.username || currentUser);
      }
    }
    if (Array.isArray(obj.tray)) {
      for (const reel of obj.tray) {
        parseAndStorePosts(reel, reel.user?.username || currentUser);
      }
    }

    // Traverse arrays and nested objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        parseAndStorePosts(item, currentUser);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'node' || key === 'items' || key === 'edges' || key === 'feed' || key === 'data' || key === 'story' || key === 'stories') {
          parseAndStorePosts(obj[key], currentUser);
        }
      }
    }
  }

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (
        url.includes('/graphql/query') ||
        url.includes('/api/v1/') ||
        url.includes('/p/') ||
        url.includes('xdt_') ||
        url.includes('timeline') ||
        url.includes('feed/reels_media') ||
        url.includes('reels_media') ||
        url.includes('/stories/')
      ) {
        response
          .clone()
          .json()
          .then((data) => {
            parseAndStorePosts(data);
          })
          .catch(() => {});
      }
    } catch (e) {
      // Ignore intercept errors
    }
    return response;
  };

  // Intercept XMLHttpRequest
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = args[1] || '';
        if (
          url.includes('/graphql/query') ||
          url.includes('/api/v1/') ||
          url.includes('/p/') ||
          url.includes('feed/reels_media') ||
          url.includes('reels_media') ||
          url.includes('/stories/')
        ) {
          const data = JSON.parse(this.responseText);
          parseAndStorePosts(data);
        }
      } catch (e) {}
    });
    return originalXHR.apply(this, args);
  };

  // Listen for requests from extension content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'INSTA_DL_REQUEST') {
      return;
    }

    const { action, shortcode, requestId, blobUrl } = event.data;

    // Handle Blob Data Resolution (converts in-page blob to dataUrl in main world)
    if (action === 'GET_BLOB_DATA') {
      try {
        let blob = blobCache.get(blobUrl);
        if (!blob && blobUrl) {
          const res = await window.fetch(blobUrl);
          blob = await res.blob();
        }

        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            window.postMessage(
              {
                type: 'INSTA_DL_RESPONSE',
                requestId,
                success: true,
                dataUrl: reader.result
              },
              '*'
            );
          };
          reader.readAsDataURL(blob);
          return;
        }
      } catch (e) {
        console.warn('[Instagram Media Downloader] Error resolving blob in main world:', e);
      }

      window.postMessage(
        {
          type: 'INSTA_DL_RESPONSE',
          requestId,
          success: false,
          error: 'Could not resolve blob'
        },
        '*'
      );
      return;
    }

    if (action === 'GET_MEDIA') {
      let result = mediaStore.get(shortcode);

      // Also check stripped ID or user_stories
      if (!result && shortcode) {
        const cleanId = String(shortcode).split('_')[0];
        result = mediaStore.get(cleanId);
      }

      if (!result && shortcode) {
        const userStories = mediaStore.get('user_stories_' + shortcode);
        if (userStories && userStories.length > 0) {
          const allItems = userStories.flatMap((s) => s.items);
          result = {
            username: shortcode,
            shortcode,
            items: allItems
          };
        }
      }

      // If not in cache, attempt an active in-page fetch with session cookies
      if (!result && shortcode && !shortcode.startsWith('story_')) {
        try {
          const res = await originalFetch(
            `/p/${shortcode}/?__a=1&__d=dis`,
            {
              headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-IG-App-ID': '936619743392459'
              }
            }
          );
          if (res.ok) {
            const data = await res.json();
            parseAndStorePosts(data);
            result = mediaStore.get(shortcode);
          }
        } catch (err) {}
      }

      window.postMessage(
        {
          type: 'INSTA_DL_RESPONSE',
          action: 'GET_MEDIA',
          shortcode,
          requestId,
          data: result || null
        },
        '*'
      );
    }
  });

  console.log('[Instagram Media Downloader] Network interceptor active (Posts + Stories).');
})();
