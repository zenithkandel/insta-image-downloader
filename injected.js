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

  /**
   * Helper to safely extract media items from an Instagram post object
   */
  function extractMediaFromNode(node) {
    if (!node || typeof node !== 'object') return null;

    const shortcode = node.shortcode || node.code;
    if (!shortcode) return null;

    const username =
      node.owner?.username ||
      node.user?.username ||
      node.caption?.user?.username ||
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
          // Take highest resolution video (first candidate in list)
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
      // Case 2: Single Video post
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
            height: node.dimensions?.height || node.video_versions?.[0]?.height || 1080
          });
        }
      } else {
        // Case 3: Single Image post
        const imageUrl =
          node.display_resources?.[node.display_resources.length - 1]?.src ||
          node.display_url ||
          node.image_versions2?.candidates?.[0]?.url;
        if (imageUrl) {
          items.push({
            type: 'image',
            url: imageUrl,
            width: node.dimensions?.width || node.image_versions2?.candidates?.[0]?.width || 1080,
            height: node.dimensions?.height || node.image_versions2?.candidates?.[0]?.height || 1080
          });
        }
      }
    }

    if (items.length > 0) {
      return {
        shortcode,
        username,
        id: node.id || node.pk,
        items
      };
    }
    return null;
  }

  /**
   * Deep scan any JSON object to discover post nodes
   */
  function parseAndStorePosts(obj) {
    if (!obj || typeof obj !== 'object') return;

    // Check if the current object itself is a post
    if (obj.shortcode || obj.code) {
      const extracted = extractMediaFromNode(obj);
      if (extracted) {
        mediaStore.set(extracted.shortcode, extracted);
      }
    }

    // Direct common GraphQL wrapper properties
    if (obj.xdt_shortcode_media) {
      const extracted = extractMediaFromNode(obj.xdt_shortcode_media);
      if (extracted) mediaStore.set(extracted.shortcode, extracted);
    }
    if (obj.shortcode_media) {
      const extracted = extractMediaFromNode(obj.shortcode_media);
      if (extracted) mediaStore.set(extracted.shortcode, extracted);
    }

    // Traverse arrays and nested objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        parseAndStorePosts(item);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'node' || key === 'items' || key === 'edges' || key === 'feed' || key === 'data') {
          parseAndStorePosts(obj[key]);
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
        url.includes('timeline')
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
          url.includes('/p/')
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

    const { action, shortcode, requestId } = event.data;

    if (action === 'GET_MEDIA') {
      let result = mediaStore.get(shortcode);

      // If not in cache, attempt an active in-page fetch with session cookies
      if (!result && shortcode) {
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
        } catch (err) {
          // In-page fetch fallback failed; content script will fall back to DOM
        }
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

  console.log('[Instagram Media Downloader] Network interceptor active.');
})();
