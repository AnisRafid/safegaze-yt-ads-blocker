/**
 * SafeGaze YouTube Ads Blocker - Standalone Script
 * Version: 1.4.0
 *
 * Cross-platform compatible script for blocking YouTube ads.
 * Can be used in:
 * - Browser Extensions (Chrome, Firefox, Edge)
 * - Android WebView
 * - iOS WKWebView
 *
 * This script combines three layers of ad blocking:
 * - Layer 1: Player data interception (ytInitialPlayerResponse, fetch, XHR hooks)
 * - Layer 2: Blocked URL patterns (for mobile network-level blocking)
 * - Layer 3: DOM-based fallback (ad detection, skip buttons, overlay removal)
 */
(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.__SAFEGAZE_YT_AD_BLOCKER_INITIALIZED__) {
    return;
  }
  window.__SAFEGAZE_YT_AD_BLOCKER_INITIALIZED__ = true;

  // =============================================================================
  // IMMEDIATE CSS INJECTION (runs on ALL YouTube pages - home, search, watch, etc.)
  // This ensures feed/search ads are hidden even before Layer 3 initializes
  // =============================================================================
  (function injectFeedAdBlockingCSS() {
    var existingStyle = document.getElementById('sg-youtube-ad-blocker-styles');
    if (existingStyle) return;

    var style = document.createElement('style');
    style.id = 'sg-youtube-ad-blocker-styles';
    style.textContent =
      '/* Hide YouTube ad renderers (feed, search, sidebar) */\n' +
      'ytd-display-ad-renderer,\n' +
      'ytd-video-masthead-ad-v3-renderer,\n' +
      'ytd-promoted-sparkles-web-renderer,\n' +
      'ytd-compact-promoted-video-renderer,\n' +
      'ytd-promoted-video-renderer,\n' +
      'ytd-banner-promo-renderer,\n' +
      'ytd-action-companion-ad-renderer,\n' +
      'ytd-ad-slot-renderer,\n' +
      'ytd-in-feed-ad-layout-renderer,\n' +
      '#masthead-ad,\n' +
      '#player-ads,\n' +
      'ytd-rich-item-renderer:has(.ytd-display-ad-renderer),\n' +
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),\n' +
      'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer),\n' +
      '#related ytd-ad-slot-renderer,\n' +
      'ytd-search ytd-ad-slot-renderer,\n' +
      'ytd-merch-shelf-renderer,\n' +
      'ytd-brand-video-singleton-renderer,\n' +
      'ytd-brand-video-shelf-renderer,\n' +
      'ytd-statement-banner-renderer,\n' +
      'ytd-primetime-promo-renderer,\n' +
      '.ytd-promoted-sparkles-web-renderer,\n' +
      'ytd-movie-offer-module-renderer,\n' +
      'ytd-companion-slot-renderer,\n' +
      'ytd-promoted-sparkles-text-search-renderer,\n' +
      'ytd-search-pyv-renderer,\n' +
      'ytd-carousel-ad-renderer,\n' +
      'ytd-player-legacy-desktop-watch-ads-renderer,\n' +
      'ytd-single-option-survey-renderer,\n' +
      '.ytd-promoted-sparkles-text-search-renderer,\n' +
      '.ytd-search-pyv-renderer,\n' +
      '.ytd-carousel-ad-renderer,\n' +
      '.ytd-player-legacy-desktop-watch-ads-renderer,\n' +
      '.ytd-video-masthead-ad-v3-renderer,\n' +
      '.ytd-compact-promoted-video-renderer,\n' +
      '.ytd-promoted-video-renderer,\n' +
      '.ytd-merch-shelf-renderer {\n' +
      '  display: none !important;\n' +
      '  visibility: hidden !important;\n' +
      '  height: 0 !important;\n' +
      '  overflow: hidden !important;\n' +
      '}\n' +
      '\n' +
      '/* Hide ad overlay elements */\n' +
      '.ytp-ad-overlay-container,\n' +
      '.ytp-ad-text-overlay,\n' +
      '.ytp-ad-image-overlay {\n' +
      '  display: none !important;\n' +
      '}';

    var target = document.head || document.documentElement;
    if (target) {
      target.appendChild(style);
    }
  })();

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
  // =============================================================================

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

    // Only remove confirmed ad-related properties
    var adProps = [
      'playerAds',
      'adPlacements',
      'adSlots',
      'ads',
      'adBreakParams',
      'companions'
    ];

    function cleanObject(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Remove ad properties directly (no cloning)
      for (var i = 0; i < adProps.length; i++) {
        if (obj.hasOwnProperty(adProps[i])) {
          delete obj[adProps[i]];
        }
      }

      // Recursively clean nested objects
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        if (obj[key] && typeof obj[key] === 'object') {
          cleanObject(obj[key]);
        }
      }
    }

    cleanObject(data);
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

        // Only intercept player API, NOT comments (/next) or navigation
        if (url && url.indexOf('/youtubei/v1/player') !== -1 && url.indexOf('/next') === -1) {
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

      // CRITICAL: Only intercept player API, NOT comments (/next) or navigation
      if (url.indexOf('/youtubei/v1/player') !== -1 && url.indexOf('/next') === -1) {
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
  // LAYER 3: DOM-BASED FALLBACK
  // Detects and skips ads that slip through Layer 1-2
  // IMPORTANT: Only activates when CONFIDENT an ad is playing
  // =============================================================================

  var YouTubeAdSkipper = {
    observer: null,
    checkInterval: null,
    isInitialized: false,
    lastAdState: false,
    userWasMuted: false,
    userPlaybackRate: 1,
    consecutiveAdDetections: 0, // Require multiple detections to confirm ad

    /**
     * Initialize ad skipper
     */
    init: function() {
      var self = this;
      if (this.isInitialized) return;

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
          var video = document.querySelector('video.video-stream');

          if (moviePlayer && video) {
            resolve();
          } else {
            setTimeout(checkPlayer, 200);
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

      // Backup polling every 500ms (less aggressive)
      this.checkInterval = setInterval(function() {
        self.handleAdDetection();
      }, 500);
    },

    /**
     * Check if we're CONFIDENTLY in an ad state
     * Requires the movie_player to have ad-showing class (most reliable indicator)
     */
    isDefinitelyInAd: function() {
      var moviePlayer = document.getElementById('movie_player');
      if (!moviePlayer) return false;

      // Primary check: movie_player must have ad-showing or ad-interrupting class
      var hasAdClass = moviePlayer.classList.contains('ad-showing') ||
                       moviePlayer.classList.contains('ad-interrupting');

      if (!hasAdClass) return false;

      // Secondary confirmation: check for ad-specific elements
      var hasAdOverlay = document.querySelector('.ytp-ad-player-overlay') !== null;
      var hasAdModule = document.querySelector('.video-ads.ytp-ad-module') !== null;
      var hasAdPreview = document.querySelector('.ytp-ad-preview-container') !== null;
      var hasAdText = document.querySelector('.ytp-ad-text') !== null;

      // Must have ad class AND at least one ad element
      return hasAdClass && (hasAdOverlay || hasAdModule || hasAdPreview || hasAdText);
    },

    /**
     * Layer 3: Fallback ad detection and skipping
     * Only triggers if ads slip through Layers 1-2 (should be rare)
     * Uses conservative detection to avoid false positives
     */
    handleAdDetection: function() {
      var video = document.querySelector('video.video-stream');
      var moviePlayer = document.getElementById('movie_player');

      if (!video || !moviePlayer) return;

      var isNowInAd = this.isDefinitelyInAd();
      var wasInAd = this.lastAdState;

      // STATE TRANSITION: Entering ad state
      if (isNowInAd && !wasInAd) {
        // Require 2 consecutive detections to confirm (avoid false positives)
        this.consecutiveAdDetections++;
        if (this.consecutiveAdDetections < 2) {
          return;
        }

        console.log('[SafeGaze] Ad detected, attempting to skip...');

        // Save user's preferences
        this.userWasMuted = video.muted;
        this.userPlaybackRate = video.playbackRate;

        // Mute the ad
        video.muted = true;

        // Try to skip - but be careful not to skip actual content
        this.trySkipAd(video);
      }

      // STATE TRANSITION: Exiting ad state
      if (!isNowInAd && wasInAd) {
        console.log('[SafeGaze] Ad ended, restoring playback...');

        // Reset detection counter
        this.consecutiveAdDetections = 0;

        // Restore user's original preferences
        video.muted = this.userWasMuted;
        video.playbackRate = this.userPlaybackRate;

        // Auto-resume playback if paused
        setTimeout(function() {
          if (video.paused) {
            video.play().catch(function() {
              // Ignore autoplay errors
            });
          }
        }, 100);
      }

      // While IN ad state, keep trying to skip
      if (isNowInAd && wasInAd) {
        this.trySkipAd(video);
      }

      // Reset counter if not in ad
      if (!isNowInAd) {
        this.consecutiveAdDetections = 0;
      }

      // Update state for next check
      this.lastAdState = isNowInAd;
    },

    /**
     * Try to skip the ad using various methods
     */
    trySkipAd: function(video) {
      // Method 1: Click skip button if available
      if (this.clickSkipButton()) {
        return;
      }

      // Method 2: Speed up the ad (safer than jumping to end)
      if (video.playbackRate < 16) {
        video.playbackRate = 16;
      }

      // Method 3: If ad is very short or near end, skip to end
      if (video.duration && !isNaN(video.duration) && video.duration < 30) {
        // Only skip short ads (< 30 seconds) to avoid skipping actual content
        if (video.currentTime < video.duration - 0.5) {
          video.currentTime = video.duration - 0.1;
        }
      }

      // Remove overlay ads
      this.removeAdOverlays();
    },

    /**
     * Click skip ad button
     * Returns true if a button was clicked
     */
    clickSkipButton: function() {
      var skipSelectors = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        'button.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-slot button'
      ];

      for (var i = 0; i < skipSelectors.length; i++) {
        var button = document.querySelector(skipSelectors[i]);
        if (button && button.offsetParent !== null) {
          button.click();
          console.log('[SafeGaze] Clicked skip button');
          return true;
        }
      }
      return false;
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
        '.ytp-ad-overlay-close-container'
      ];

      for (var i = 0; i < adOverlaySelectors.length; i++) {
        var elements = document.querySelectorAll(adOverlaySelectors[i]);
        for (var j = 0; j < elements.length; j++) {
          elements[j].remove();
        }
      }
    },

    /**
     * Observe YouTube SPA navigation
     */
    observeYouTubeNavigation: function() {
      var self = this;

      window.addEventListener('yt-navigate-finish', function() {
        // Reset state on navigation
        self.cleanup();
        self.isInitialized = false;
        self.lastAdState = false;
        self.consecutiveAdDetections = 0;

        // Re-initialize if on watch page
        if (self.isWatchPage()) {
          self.init();
        }
      });

      window.addEventListener('popstate', function() {
        self.cleanup();
        self.isInitialized = false;
        self.lastAdState = false;
        self.consecutiveAdDetections = 0;

        if (self.isWatchPage()) {
          self.init();
        }
      });
    },

    /**
     * Check if current page is a YouTube watch page
     */
    isWatchPage: function() {
      return window.location.pathname === '/watch' && window.location.search.indexOf('v=') !== -1;
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
    // Initialize Layer 3 (DOM-based fallback) only on watch pages
    if (YouTubeAdSkipper.isWatchPage()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          YouTubeAdSkipper.init();
        });
      } else {
        YouTubeAdSkipper.init();
      }
    }

    // Listen for future navigations to watch pages
    YouTubeAdSkipper.observeYouTubeNavigation();
  }

  // Expose for debugging
  window.__SAFEGAZE_YT_AD_SKIPPER__ = YouTubeAdSkipper;

  console.log('[SafeGaze] YouTube Ads Blocker v1.4.0 initialized');

})();
