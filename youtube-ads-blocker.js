/**
 * SafeGaze YouTube Ads Blocker - Standalone Script v1.1.0
 *
 * Cross-platform compatible script for blocking YouTube ads.
 * Can be used in:
 * - Browser Extensions (Chrome, Firefox, Edge)
 * - Android WebView
 * - iOS WKWebView
 *
 * This script combines four layers of ad blocking:
 * - Layer 1: Player data interception (ytInitialPlayerResponse, fetch, XHR hooks)
 * - Layer 2: Blocked URL patterns (for mobile network-level blocking)
 * - Layer 3: DOM-based fallback (ad detection, skip buttons, overlay removal)
 * - Layer 4: Embed fallback (youtube-nocookie.com replacement for persistent ads)
 *
 * Updated: December 2024
 * - Enhanced ad property removal based on uBlock Origin filters
 * - Added embed fallback for server-side ad injection bypass
 * - Improved DOM detection for 2024 YouTube UI
 */
(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.__SAFEGAZE_YT_AD_BLOCKER_INITIALIZED__) {
    return;
  }
  window.__SAFEGAZE_YT_AD_BLOCKER_INITIALIZED__ = true;

  // =============================================================================
  // LAYER 2: BLOCKED URL PATTERNS
  // These patterns can be used by mobile apps for network-level blocking
  // Access via: window.SAFEGAZE_BLOCKED_AD_PATTERNS
  // =============================================================================
  var BLOCKED_AD_PATTERNS = [
    // Ad serving domains
    '*://*.googlesyndication.com/*',
    '*://*.doubleclick.net/*',
    '*://googleads.g.doubleclick.net/*',
    '*://static.doubleclick.net/*',

    // YouTube ad endpoints (classic)
    '*://youtube.com/api/stats/ads*',
    '*://youtube.com/ptracking*',
    '*://youtube.com/pagead/*',
    '*://youtube.com/get_midroll_*',
    '*://youtube.com/ad_*',
    '*://youtube.com/adunit/*',
    '*://*.youtube.com/api/stats/ads*',
    '*://*.youtube.com/ptracking*',
    '*://*.youtube.com/pagead/*',
    '*://*.youtube.com/get_midroll_*',
    '*://*.youtube.com/ad_*',

    // YouTube API v1 ad endpoints
    '*://youtube.com/youtubei/v1/player/ad_*',
    '*://*.youtube.com/youtubei/v1/player/ad_*',
    '*://youtube.com/api/stats/qoe*',
    '*://*.youtube.com/api/stats/qoe*',

    // Video ad segments (googlevideo.com with ad parameters)
    '*://googlevideo.com/videoplayback*&aclk=*',
    '*://googlevideo.com/videoplayback*&ad=*',
    '*://googlevideo.com/videoplayback*ad_*',
    '*://googlevideo.com/pcs/activeview*',
    '*://*.googlevideo.com/videoplayback*&aclk=*',
    '*://*.googlevideo.com/videoplayback*&ad=*',
    '*://*.googlevideo.com/videoplayback*ad_*',
    '*://*.googlevideo.com/pcs/activeview*',

    // Ad tracking and analytics
    '*://youtube.com/api/stats/watchtime*',
    '*://*.youtube.com/api/stats/watchtime*',
    '*://google.com/pagead/*',
    '*://*.google.com/pagead/*',
    '*://youtube.com/pagead/interaction/*',
    '*://*.youtube.com/pagead/interaction/*'
  ];

  // Expose blocked patterns for mobile apps
  window.SAFEGAZE_BLOCKED_AD_PATTERNS = BLOCKED_AD_PATTERNS;

  // =============================================================================
  // LAYER 1: PLAYER DATA INTERCEPTION
  // Intercepts YouTube's player data to remove ads before they load
  // Enhanced with uBlock Origin filter patterns (December 2024)
  // =============================================================================

  /**
   * Enhanced ad properties list based on uBlock Origin filters
   * Includes nested playerResponse paths for comprehensive coverage
   */
  var AD_PROPERTIES = [
    // Primary ad properties
    'playerAds',
    'adPlacements',
    'adSlots',
    'ads',
    'adBreakParams',
    'companions',
    // New properties (2024)
    'no_ads',
    'adBreakHeartbeatParams',
    'adInfoRenderers',
    'adModule',
    'adSafetyReason',
    'advertisementVideo',
    'instreamAdPlayerOverlayRenderer',
    'linearAdSequenceRenderer',
    'adLayoutLoggingData',
    'inPlayerSlotId',
    'inPlayerLayoutId'
  ];

  /**
   * Remove ad-related properties from YouTube player data
   * Modifies objects in-place to preserve object types and avoid cloning overhead
   * @param {Object} data - The data object to clean
   * @returns {Object} The cleaned data object
   */
  function removeAdData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    function cleanObject(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 15) return;

      // Remove ad properties directly (no cloning)
      for (var i = 0; i < AD_PROPERTIES.length; i++) {
        if (obj.hasOwnProperty(AD_PROPERTIES[i])) {
          delete obj[AD_PROPERTIES[i]];
        }
      }

      // Handle nested playerResponse specifically (common in API responses)
      if (obj.playerResponse && typeof obj.playerResponse === 'object') {
        for (var j = 0; j < AD_PROPERTIES.length; j++) {
          if (obj.playerResponse.hasOwnProperty(AD_PROPERTIES[j])) {
            delete obj.playerResponse[AD_PROPERTIES[j]];
          }
        }
      }

      // Handle array of playerResponses (playlist scenarios)
      if (Array.isArray(obj)) {
        for (var k = 0; k < obj.length; k++) {
          if (obj[k] && obj[k].playerResponse) {
            for (var l = 0; l < AD_PROPERTIES.length; l++) {
              if (obj[k].playerResponse.hasOwnProperty(AD_PROPERTIES[l])) {
                delete obj[k].playerResponse[AD_PROPERTIES[l]];
              }
            }
          }
          cleanObject(obj[k], depth + 1);
        }
        return;
      }

      // Recursively clean nested objects
      var keys = Object.keys(obj);
      for (var m = 0; m < keys.length; m++) {
        var key = keys[m];
        if (obj[key] && typeof obj[key] === 'object') {
          cleanObject(obj[key], depth + 1);
        }
      }
    }

    cleanObject(data, 0);
    return data;
  }

  // Layer 1A: Intercept ytInitialPlayerResponse (page load)
  try {
    var _ytInitialPlayerResponse;

    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      set: function(value) {
        _ytInitialPlayerResponse = removeAdData(value);
      },
      get: function() {
        return _ytInitialPlayerResponse;
      },
      configurable: true,
      enumerable: true
    });
  } catch (error) {
    console.error('[SafeGaze] Failed to hook ytInitialPlayerResponse:', error);
  }

  // Layer 1B: Intercept fetch() API (dynamic requests)
  try {
    var originalFetch = window.fetch;

    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // PERFORMANCE: Skip video CDN entirely (never intercept video segments)
      if (url && url.indexOf('googlevideo.com') !== -1) {
        return originalFetch.call(this, input, init);
      }

      // Call original fetch
      return originalFetch.call(this, input, init).then(function(response) {
        // PERFORMANCE: Only process JSON responses (skip binary video/images)
        var contentType = response.headers.get('content-type');
        if (!contentType || contentType.indexOf('application/json') === -1) {
          return response;
        }

        // Intercept player API and browse API (for home page ads)
        // Skip /next (comments) to avoid breaking comment section
        var shouldIntercept = url && (
          (url.indexOf('/youtubei/v1/player') !== -1 && url.indexOf('/next') === -1) ||
          (url.indexOf('/youtubei/v1/browse') !== -1) ||
          (url.indexOf('/get_video_info') !== -1)
        );

        if (shouldIntercept) {
          // Clone response to read it
          var cloned = response.clone();
          return cloned.text().then(function(text) {
            // Try to parse as JSON
            var data;
            try {
              data = JSON.parse(text);
            } catch (e) {
              // Not JSON, return original
              return response;
            }

            // Remove ad data (modifies in place)
            removeAdData(data);

            // Reconstruct response with proper headers
            var modifiedText = JSON.stringify(data);
            var modifiedHeaders = new Headers(response.headers);
            modifiedHeaders.set('content-length', modifiedText.length.toString());

            return new Response(modifiedText, {
              status: response.status,
              statusText: response.statusText,
              headers: modifiedHeaders
            });
          }).catch(function() {
            return response;
          });
        }

        return response;
      });
    };
  } catch (error) {
    console.error('[SafeGaze] Failed to hook fetch():', error);
  }

  // Layer 1C: Intercept XMLHttpRequest (legacy support)
  try {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      this._sgUrl = url ? url.toString() : '';
      return originalOpen.call(this, method, url, async !== false, user, password);
    };

    XMLHttpRequest.prototype.send = function() {
      var self = this;
      var url = this._sgUrl || '';
      var args = arguments;

      // Intercept player API and browse API, skip /next (comments)
      var shouldIntercept = (
        (url.indexOf('/youtubei/v1/player') !== -1 && url.indexOf('/next') === -1) ||
        (url.indexOf('/youtubei/v1/browse') !== -1) ||
        (url.indexOf('/get_video_info') !== -1)
      );

      if (shouldIntercept) {
        this.addEventListener('readystatechange', function() {
          if (self.readyState === 4 && self.responseText) {
            try {
              var data = JSON.parse(self.responseText);
              removeAdData(data);

              // Override responseText getter
              Object.defineProperty(self, 'responseText', {
                writable: false,
                configurable: true,
                value: JSON.stringify(data)
              });
            } catch (e) {
              // Not JSON or parsing failed, ignore
            }
          }
        });
      }

      return originalSend.apply(this, args);
    };
  } catch (error) {
    console.error('[SafeGaze] Failed to hook XMLHttpRequest:', error);
  }

  // =============================================================================
  // LAYER 3 & 4: DOM-BASED FALLBACK + EMBED REPLACEMENT
  // Detects and skips ads that slip through Layer 1-2
  // Falls back to embed replacement for server-side injected ads
  // =============================================================================

  var YouTubeAdSkipper = {
    observer: null,
    checkInterval: null,
    isInitialized: false,
    lastAdState: false,
    userWasMuted: false,
    adStartTime: null,
    embedFallbackTriggered: false,
    AD_PERSIST_THRESHOLD: 2000, // 2 seconds before embed fallback

    /**
     * Initialize ad skipper
     */
    init: function() {
      var self = this;
      if (this.isInitialized) return;

      // Inject CSS for ad hiding
      this.injectAdBlockingCSS();

      // Wait for player then start detection
      this.waitForPlayer().then(function() {
        self.setupAdDetection();
        self.isInitialized = true;
      });

      // Handle YouTube SPA navigation
      this.observeYouTubeNavigation();
    },

    /**
     * Wait for YouTube player to be ready
     */
    waitForPlayer: function() {
      return new Promise(function(resolve) {
        function checkPlayer() {
          var moviePlayer = document.getElementById('movie_player');
          var video = document.querySelector('.video-stream');

          if (moviePlayer && video) {
            resolve();
          } else {
            setTimeout(checkPlayer, 100);
          }
        }

        checkPlayer();
      });
    },

    /**
     * Setup ad detection - Simple and fast
     */
    setupAdDetection: function() {
      var self = this;
      var moviePlayer = document.getElementById('movie_player');
      if (!moviePlayer) return;

      // MutationObserver for class changes
      this.observer = new MutationObserver(function() {
        self.handleAdDetection();
      });

      if (moviePlayer instanceof Node) {
        this.observer.observe(moviePlayer, {
          attributes: true,
          attributeFilter: ['class']
        });
      }

      // Backup polling every 100ms for reliability
      this.checkInterval = setInterval(function() {
        self.handleAdDetection();
      }, 100);
    },

    /**
     * Layer 3 & 4: Fallback ad detection, skipping, and embed replacement
     * Enhanced with 2024 YouTube UI selectors and embed fallback
     */
    handleAdDetection: function() {
      var video = document.querySelector('.video-stream');
      var moviePlayer = document.getElementById('movie_player');

      if (!video || !moviePlayer) return;

      // Multi-signal ad detection (enhanced for 2024)
      var isNowInAd = (moviePlayer && (
          moviePlayer.classList.contains('ad-showing') ||
          moviePlayer.classList.contains('ad-interrupting')
        )) ||
        document.querySelector('.ytp-ad-player-overlay') !== null ||
        document.querySelector('.video-ads.ytp-ad-module') !== null ||
        document.querySelector('.ytp-ad-text') !== null ||
        // New 2024 selectors
        document.querySelector('.ytp-ad-preview-container') !== null ||
        document.querySelector('.ytp-ad-action-interstitial') !== null ||
        document.querySelector('.ytp-ad-player-overlay-instream-info') !== null ||
        document.querySelector('.ytp-ad-persistent-progress-bar-container') !== null;

      var wasInAd = this.lastAdState;

      // STATE TRANSITION: Entering ad state
      if (isNowInAd && !wasInAd) {
        // Reset embed fallback flag for new ad
        this.embedFallbackTriggered = false;
        this.adStartTime = Date.now();

        // Save user's mute preference
        this.userWasMuted = video.muted;

        // Mute immediately
        video.muted = true;

        // Skip to end IMMEDIATELY (most aggressive)
        if (video.duration && !isNaN(video.duration)) {
          video.currentTime = video.duration;
        }

        // Also try speed-up as backup
        video.playbackRate = 16;

        // Click skip buttons
        this.clickSkipButton();
        this.removeAdOverlays();
      }

      // STATE TRANSITION: Exiting ad state
      if (!isNowInAd && wasInAd) {
        // Reset tracking
        this.adStartTime = null;

        // Restore user's original mute preference
        video.muted = this.userWasMuted;

        // Reset playback speed
        video.playbackRate = 1;

        // Auto-resume playback
        setTimeout(function() {
          if (video.paused) {
            video.play().catch(function() {
              // Ignore autoplay errors
            });
          }
        }, 50);
      }

      // When STAYING in ad state, continuously try to skip
      if (isNowInAd && wasInAd) {
        // Keep jumping to end
        if (video.duration && !isNaN(video.duration)) {
          if (video.currentTime < video.duration - 0.3) {
            video.currentTime = video.duration;
          }
        }
        this.clickSkipButton();
        this.removeAdOverlays();

        // LAYER 4: Embed fallback for persistent ads (server-side injection)
        if (!this.embedFallbackTriggered && this.adStartTime) {
          var adDuration = Date.now() - this.adStartTime;
          if (adDuration > this.AD_PERSIST_THRESHOLD) {
            console.log('[SafeGaze] Ad persisted for ' + adDuration + 'ms, triggering embed fallback');
            this.replaceWithEmbed();
            this.embedFallbackTriggered = true;
          }
        }
      }

      // Update state for next check
      this.lastAdState = isNowInAd;
    },

    /**
     * Layer 4: Replace video player with youtube-nocookie.com embed
     * This completely bypasses YouTube's ad system including server-side injection
     */
    replaceWithEmbed: function() {
      var url = new URL(window.location.href);
      var videoID = url.searchParams.get('v');

      // Handle live URLs: /live/VIDEO_ID
      if (!videoID) {
        var pathSegments = url.pathname.split('/');
        var liveIndex = pathSegments.indexOf('live');
        if (liveIndex !== -1 && liveIndex + 1 < pathSegments.length) {
          videoID = pathSegments[liveIndex + 1];
        }
      }

      if (!videoID) {
        console.warn('[SafeGaze] Could not extract video ID for embed fallback');
        return;
      }

      var video = document.querySelector('.video-stream');
      var currentTime = video ? Math.floor(video.currentTime) : 0;

      // Get playlist info if available
      var playlistParam = '';
      if (url.searchParams.has('list')) {
        playlistParam = '&list=' + url.searchParams.get('list');
      }

      // Build embed URL
      var embedUrl = 'https://www.youtube-nocookie.com/embed/' + videoID +
                     '?autoplay=1&modestbranding=1&rel=0&start=' + currentTime + playlistParam;

      // Create iframe
      var iframe = document.createElement('iframe');
      iframe.setAttribute('src', embedUrl);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('mozallowfullscreen', 'mozallowfullscreen');
      iframe.setAttribute('msallowfullscreen', 'msallowfullscreen');
      iframe.setAttribute('webkitallowfullscreen', 'webkitallowfullscreen');

      iframe.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;z-index:9999;pointer-events:all;border:none;';

      var player = document.querySelector('.html5-video-player');
      if (player) {
        // Remove existing videos to prevent audio overlap
        var existingVideos = player.querySelectorAll('video');
        existingVideos.forEach(function(v) {
          v.muted = true;
          v.pause();
          v.remove();
        });

        // Remove any existing iframes
        var existingIframes = player.querySelectorAll('iframe');
        existingIframes.forEach(function(f) {
          f.remove();
        });

        // Add the new embed
        player.appendChild(iframe);
        console.log('[SafeGaze] Video player replaced with ad-free embed');

        // Stop the ad detection loop since we've replaced the player
        this.cleanup();
      }
    },

    /**
     * Click skip ad button
     */
    clickSkipButton: function() {
      var skipSelectors = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button-slot',
        // New 2024 selectors
        'button.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-container button'
      ];

      for (var i = 0; i < skipSelectors.length; i++) {
        var button = document.querySelector(skipSelectors[i]);
        if (button && button.offsetParent !== null) {
          button.click();
          break;
        }
      }
    },

    /**
     * Remove ad overlay elements from DOM
     */
    removeAdOverlays: function() {
      var adOverlaySelectors = [
        '.ytp-ad-overlay-container',
        '.ytp-ad-text-overlay',
        '.ytp-ad-image-overlay',
        '.ytp-ad-player-overlay-flyout-cta',
        '.ytp-ad-overlay-close-container',
        // New 2024 selectors
        '.ytp-ad-action-interstitial',
        '.ytp-ad-player-overlay-instream-info',
        '.ytp-ad-message-container'
      ];

      for (var i = 0; i < adOverlaySelectors.length; i++) {
        var elements = document.querySelectorAll(adOverlaySelectors[i]);
        for (var j = 0; j < elements.length; j++) {
          elements[j].remove();
        }
      }
    },

    /**
     * Inject CSS for ad hiding
     */
    injectAdBlockingCSS: function() {
      var existingStyle = document.getElementById('sg-youtube-ad-skipper-styles');
      if (existingStyle) return;

      var style = document.createElement('style');
      style.id = 'sg-youtube-ad-skipper-styles';
      style.textContent =
        '/* Hide ad-related elements */\n' +
        '.ad-showing .video-ads,\n' +
        '.ad-showing .ytp-ad-module,\n' +
        '.ad-showing .ytp-ad-player-overlay,\n' +
        '.ad-interrupting .video-ads,\n' +
        '.ad-interrupting .ytp-ad-module,\n' +
        '.ad-interrupting .ytp-ad-player-overlay,\n' +
        '.ytp-ad-preview-container,\n' +
        '.ytp-ad-action-interstitial {\n' +
        '  display: none !important;\n' +
        '  visibility: hidden !important;\n' +
        '}\n' +
        '\n' +
        '/* Hide YouTube ad renderers */\n' +
        'ytd-display-ad-renderer,\n' +
        'ytd-video-masthead-ad-v3-renderer,\n' +
        'ytd-promoted-sparkles-web-renderer,\n' +
        'ytd-compact-promoted-video-renderer,\n' +
        'ytd-promoted-video-renderer,\n' +
        'ytd-banner-promo-renderer,\n' +
        'ytd-action-companion-ad-renderer,\n' +
        'ytd-in-feed-ad-layout-renderer,\n' +
        'ytd-ad-slot-renderer,\n' +
        'ytd-statement-banner-renderer,\n' +
        'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),\n' +
        '#masthead-ad {\n' +
        '  display: none !important;\n' +
        '}\n' +
        '\n' +
        '/* Hide skip ad button container (auto-skip handles it) */\n' +
        '.ytp-ad-skip-button-container {\n' +
        '  opacity: 0 !important;\n' +
        '}';

      // Append to head or documentElement (for early injection)
      var target = document.head || document.documentElement;
      if (target) {
        target.appendChild(style);
      }
    },

    /**
     * Observe YouTube SPA navigation
     */
    observeYouTubeNavigation: function() {
      var self = this;

      window.addEventListener('yt-navigate-finish', function() {
        if (self.isWatchPage()) {
          self.cleanup();
          self.isInitialized = false;
          self.lastAdState = false;
          self.adStartTime = null;
          self.embedFallbackTriggered = false;
          self.init();
        }
      });

      window.addEventListener('popstate', function() {
        if (self.isWatchPage()) {
          self.cleanup();
          self.isInitialized = false;
          self.lastAdState = false;
          self.adStartTime = null;
          self.embedFallbackTriggered = false;
          self.init();
        }
      });
    },

    /**
     * Check if current page is a YouTube watch page
     */
    isWatchPage: function() {
      return (window.location.pathname === '/watch' && window.location.search.indexOf('v=') !== -1) ||
             window.location.pathname.indexOf('/live/') !== -1;
    },

    /**
     * Cleanup observers and intervals
     */
    cleanup: function() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (this.checkInterval !== null) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    },

    /**
     * Destroy the ad skipper
     */
    destroy: function() {
      this.cleanup();
      this.isInitialized = false;
    }
  };

  // =============================================================================
  // AUTO-INITIALIZATION
  // =============================================================================

  // Only run on YouTube domains
  if (window.location.hostname.indexOf('youtube.com') !== -1) {
    // Initialize Layer 3 & 4 (DOM-based fallback + embed replacement)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        YouTubeAdSkipper.init();
      });
    } else {
      YouTubeAdSkipper.init();
    }
  }

  // Expose for debugging
  window.__SAFEGAZE_YT_AD_SKIPPER__ = YouTubeAdSkipper;

  console.log('[SafeGaze] YouTube Ads Blocker v1.1.0 initialized');

})();
