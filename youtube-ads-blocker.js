/**
 * SafeGaze YouTube Ads Blocker - Local Enhanced Version
 * LOCALLY MAINTAINED - Updated selectors for December 2025 YouTube
 * Based on: https://github.com/AnisRafid/safegaze-yt-ads-blocker
 *
 * Changes from upstream:
 * - Updated ad container selectors (ytd-ad-slot-renderer, etc.)
 * - Added modern badge detection (ad-badge-view-model, badge-shape)
 * - Enhanced detection with checkIfSponsored() function
 * - Improved CSS hiding for 2025 YouTube structure
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
 * - Layer 4: Feed ad monitoring (sponsored content in home/search feeds)
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
  // LAYER 3 & 4: ENHANCED DOM-BASED FALLBACK AND FEED MONITORING
  // Detects and skips ads that slip through Layer 1-2
  // Monitors and removes sponsored content from feeds
  // =============================================================================

  var YouTubeAdSkipper = {
    observer: null,
    feedObserver: null,
    checkInterval: null,
    isInitialized: false,
    lastAdState: false,
    userWasMuted: false,

    /**
     * Initialize ad skipper
     */
    init: function() {
      var self = this;
      if (this.isInitialized) return;

      // Inject CSS for ad hiding (ENHANCED)
      this.injectAdBlockingCSS();

      // Always setup feed ad monitoring (works on all pages)
      this.setupFeedAdMonitoring();

      // Only setup video player monitoring on watch pages
      if (this.isWatchPage()) {
        // Wait for player then start detection
        this.waitForPlayer().then(function() {
          self.setupAdDetection();
          self.isInitialized = true;
        });
      } else {
        // For non-watch pages, still consider initialized
        self.isInitialized = true;
      }

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
     * Setup monitoring for feed ads and sponsored content (NEW)
     */
    setupFeedAdMonitoring: function() {
      var self = this;

      // Create observer immediately
      this.feedObserver = new MutationObserver(function(mutations) {
        var adsDetected = false;

        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(function(node) {
              if (node instanceof HTMLElement) {
                // Check if it's an ad container
                if (self.checkIfSponsored(node)) {
                  self.cleanupAdParentContainers(node);
                  adsDetected = true;
                  console.log('[SafeGaze] Removed sponsored content:', node.tagName);
                  return;
                }

                // Check children using modern selectors
                var sponsoredElements = node.querySelectorAll(
                  'ytd-ad-slot-renderer, ' +
                  'ytd-in-feed-ad-layout-renderer, ' +
                  'ad-badge-view-model, ' +
                  'ytd-display-ad-renderer'
                );

                sponsoredElements.forEach(function(element) {
                  self.cleanupAdParentContainers(element);
                  adsDetected = true;
                  console.log('[SafeGaze] Removed sponsored container');
                });
              }
            });
          }
        });

        // Debounced reflow after all mutations processed
        if (adsDetected) {
          self.debouncedGridReflow();
        }
      });

      // Start observing body immediately
      // Body always exists, will catch all content
      this.feedObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Initial cleanup
      this.removeExistingSponsoredContent();
    },

    /**
     * Remove parent containers and force grid reflow
     * This eliminates empty space in YouTube's grid layout
     * @param {HTMLElement} adElement - The detected ad element
     */
    cleanupAdParentContainers: function(adElement) {
      if (!adElement) return;

      var self = this;

      try {
        // Find the grid item container (ytd-rich-item-renderer)
        var richItem = adElement.closest('ytd-rich-item-renderer');

        if (richItem) {
          // Mark for CSS hiding first (instant)
          richItem.setAttribute('data-sg-ad-removed', 'true');

          // Schedule DOM removal after CSS hiding takes effect
          setTimeout(function() {
            // Check if parent section will be empty
            var richSection = richItem.closest('ytd-rich-section-renderer');
            var shouldRemoveSection = false;

            if (richSection) {
              // Check if section only contains this ad item
              var sectionItems = richSection.querySelectorAll('ytd-rich-item-renderer');
              var nonAdItems = Array.prototype.filter.call(sectionItems, function(item) {
                return !item.hasAttribute('data-sg-ad-removed') && item !== richItem;
              });

              shouldRemoveSection = nonAdItems.length === 0;
            }

            // Remove the item
            richItem.remove();

            // Remove empty section if applicable
            if (shouldRemoveSection && richSection) {
              richSection.remove();
            }

            // Force grid reflow
            self.forceGridReflow();

            console.log('[SafeGaze] Cleaned up ad container hierarchy');
          }, 50); // 50ms delay ensures CSS hiding happens first
        }
      } catch (e) {
        console.error('[SafeGaze] Error cleaning up ad containers:', e);
      }
    },

    /**
     * Force YouTube grid to recalculate layout
     * Uses requestAnimationFrame for optimal performance
     */
    forceGridReflow: function() {
      requestAnimationFrame(function() {
        var grids = document.querySelectorAll('ytd-rich-grid-renderer');

        grids.forEach(function(grid) {
          // Trigger reflow by reading offsetHeight then modifying style
          var height = grid.offsetHeight; // Force browser to calculate layout

          // Temporarily adjust grid properties to force recalculation
          grid.style.gridTemplateColumns = window.getComputedStyle(grid).gridTemplateColumns;

          // Reset on next frame to allow browser to optimize
          requestAnimationFrame(function() {
            grid.style.gridTemplateColumns = '';
          });
        });
      });
    },

    /**
     * Debounced grid reflow to prevent excessive calls
     * Stores timeout reference for cleanup
     */
    debouncedGridReflow: function() {
      var self = this;
      if (self._debouncedReflowTimeout) clearTimeout(self._debouncedReflowTimeout);

      self._debouncedReflowTimeout = setTimeout(function() {
        self.forceGridReflow();
        self._debouncedReflowTimeout = null;
      }, 150); // Wait 150ms after last ad removal
    },

    /**
     * Enhanced sponsored content detection
     * Uses multiple strategies for reliability
     */
    checkIfSponsored: function(element) {
      if (!element) return false;

      // Strategy 1: Check for modern ad containers
      if (element.tagName === 'YTD-AD-SLOT-RENDERER' ||
        element.tagName === 'YTD-IN-FEED-AD-LAYOUT-RENDERER' ||
        element.tagName === 'AD-BADGE-VIEW-MODEL') {
        return true;
      }

      // Strategy 2: Check for parent containers
      if (element.closest && (
        element.closest('ytd-ad-slot-renderer') ||
        element.closest('ytd-in-feed-ad-layout-renderer'))) {
        return true;
      }

      // Strategy 3: Text content analysis
      var textContent = element.textContent || '';
      if (textContent.includes('Sponsored') ||
        textContent.includes('Ad ·')) {
        // Verify it's in a badge/metadata context
        var badge = element.querySelector('badge-shape, ad-badge-view-model');
        if (badge) return true;
      }

      // Strategy 4: Check aria-labels (case-insensitive)
      var ariaLabel = element.getAttribute('aria-label') || '';
      if (ariaLabel.toLowerCase().includes('sponsored') ||
        ariaLabel.toLowerCase().includes('ad')) {
        return true;
      }

      return false;
    },

    /**
     * Check and remove sponsored content (NEW)
     */
    checkAndRemoveSponsoredContent: function(element) {
      if (!element) return;

      var adSelectors = [
        // Modern YouTube ad containers (2025)
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ad-badge-view-model',
        'ytd-display-ad-renderer',

        // Legacy selectors (keep for compatibility)
        '.ytd-merch-shelf-renderer',
        '.ytd-single-option-survey-renderer',
        'ytd-statement-banner-renderer',
        'ytd-banner-promo-renderer',

        // Video masthead ads
        'ytd-video-masthead-ad-v3-renderer',
        'ytd-video-masthead-ad-primary-video-renderer'
      ];

      var shouldRemove = false;

      // Check if element matches any ad selector
      for (var i = 0; i < adSelectors.length; i++) {
        try {
          if (element.matches && element.matches(adSelectors[i])) {
            shouldRemove = true;
            break;
          }
          // Also check if closest ancestor matches
          if (element.closest && element.closest(adSelectors[i])) {
            shouldRemove = true;
            break;
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      if (shouldRemove) {
        element.remove();
        console.log('[SafeGaze] Removed sponsored content from feed');
      }
    },

    /**
     * Remove existing sponsored content from the page (NEW)
     */
    removeExistingSponsoredContent: function() {
      var adSelectors = [
        // Modern YouTube ad containers (2025)
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ad-badge-view-model',
        'ytd-display-ad-renderer',

        // Legacy selectors (keep for compatibility)
        '.ytd-merch-shelf-renderer',
        '.ytd-single-option-survey-renderer',
        'ytd-statement-banner-renderer',
        'ytd-banner-promo-renderer',

        // Video masthead ads
        'ytd-video-masthead-ad-v3-renderer',
        'ytd-video-masthead-ad-primary-video-renderer'
      ];

      var self = this;
      var foundAds = false;

      adSelectors.forEach(function(selector) {
        try {
          var elements = document.querySelectorAll(selector);
          elements.forEach(function(element) {
            self.cleanupAdParentContainers(element);
            foundAds = true;
          });
        } catch (e) {
          // Invalid selector, skip
        }
      });

      // Single reflow after all initial ads removed
      if (foundAds) {
        setTimeout(function() {
          self.forceGridReflow();
        }, 200); // 200ms ensures all DOM removals complete
      }
    },

    /**
     * Layer 3: Fallback ad detection and skipping
     * Only triggers if ads slip through Layers 1-2 (should be rare)
     * More aggressive detection and immediate skipping
     */
    handleAdDetection: function() {
      var video = document.querySelector('.video-stream');
      var moviePlayer = document.getElementById('movie_player');

      if (!video || !moviePlayer) return;

      // Multi-signal ad detection (more comprehensive)
      var isNowInAd = (moviePlayer && (
          moviePlayer.classList.contains('ad-showing') ||
          moviePlayer.classList.contains('ad-interrupting')
        )) ||
        document.querySelector('.ytp-ad-player-overlay') !== null ||
        document.querySelector('.video-ads.ytp-ad-module') !== null ||
        document.querySelector('.ytp-ad-text') !== null;

      var wasInAd = this.lastAdState;

      // STATE TRANSITION: Entering ad state (fallback - should be rare with MAIN world script)
      if (isNowInAd && !wasInAd) {
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
      }

      // When STAYING in content state - DO NOTHING (respect user controls)

      // Update state for next check
      this.lastAdState = isNowInAd;
    },

    /**
     * Click skip ad button
     */
    clickSkipButton: function() {
      var skipSelectors = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button'
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
     * Inject CSS for ad hiding (ENHANCED)
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
        '.ad-interrupting .ytp-ad-player-overlay {\n' +
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
        'ytd-action-companion-ad-renderer {\n' +
        '  display: none !important;\n' +
        '}\n' +
        '\n' +
        '/* 2024 YouTube ad selectors - Home Feed, Search, and Browse */\n' +
        '.ytd-search-pyv-renderer,\n' +                    // Search result promoted videos
        '.ytd-merch-shelf-renderer,\n' +                   // Merchandise shelves (promotional)
        '.ad-container,\n' +                              // General ad containers
        '#player-ads,\n' +                                // Player area ads
        '.ytp-ad-overlay-container,\n' +                  // Ad overlay containers
        'YTM-PROMOTED-VIDEO-RENDERER,\n' +               // Mobile promoted videos
        '.iv-promo,\n' +                                 // In-video promotions
        '.companion-ad {\n' +                             // Companion ads
        '  display: none !important;\n' +
        '  visibility: hidden !important;\n' +
        '}\n' +
        '\n' +
        '/* Additional ad containers and overlays */\n' +
        '.video-ads,\n' +
        '.ytp-ad-progress-list,\n' +
        '.ytd-single-option-survey-renderer,\n' +          // Promotional surveys
        '[data-ad-impression],\n' +                      // Elements with ad tracking
        '[aria-label*="ad"],\n' +                       // Elements with ad in aria-label
        '[aria-label*="Ad"],\n' +                       // Elements with Ad in aria-label
        '[aria-label*="sponsored"],\n' +                 // Elements with sponsored in aria-label
        '[aria-label*="Sponsored"] {\n' +                 // Elements with Sponsored in aria-label
        '  display: none !important;\n' +
        '  visibility: hidden !important;\n' +
        '}\n' +
        '\n' +
        '/* Skip ad button container */\n' +
        '.ytp-ad-skip-button-container {\n' +
        '  display: none !important;\n' +
        '}\n' +
        '\n' +
        '/* Modern YouTube Ad Containers (December 2025) */\n' +
        'ytd-ad-slot-renderer,\n' +
        'ytd-in-feed-ad-layout-renderer,\n' +
        'ad-badge-view-model,\n' +
        'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),\n' +
        'ytd-item-section-renderer:has(ytd-ad-slot-renderer),\n' +
        'ytd-video-masthead-ad-primary-video-renderer,\n' +
        'ytd-statement-banner-renderer,\n' +
        'ytd-banner-promo-renderer,\n' +
        'ytd-in-feed-ad-layout-renderer,\n' +
        'ytd-primetime-promo-renderer {\n' +
        '  display: none !important;\n' +
        '  visibility: hidden !important;\n' +
        '  height: 0 !important;\n' +
        '  margin: 0 !important;\n' +
        '  padding: 0 !important;\n' +
        '}\n' +
        '\n' +
        '/* Force grid to collapse when items are removed */\n' +
        'ytd-rich-grid-renderer {\n' +
        '  grid-auto-rows: minmax(0, auto) !important;\n' +
        '}\n' +
        '\n' +
        '/* Hide empty rich sections completely */\n' +
        'ytd-rich-section-renderer:empty,\n' +
        'ytd-rich-section-renderer:has(> #content:empty) {\n' +
        '  display: none !important;\n' +
        '  height: 0 !important;\n' +
        '  margin: 0 !important;\n' +
        '}\n' +
        '\n' +
        '/* Mark items for cleanup with data attribute */\n' +
        'ytd-rich-item-renderer[data-sg-ad-removed] {\n' +
        '  display: none !important;\n' +
        '  height: 0 !important;\n' +
        '  margin: 0 !important;\n' +
        '  padding: 0 !important;\n' +
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
        if (self.isYouTubePage()) {
          self.cleanup();
          self.isInitialized = false;
          self.lastAdState = false; // Reset state for new page
          self.init();
        }
      });

      window.addEventListener('popstate', function() {
        if (self.isYouTubePage()) {
          self.cleanup();
          self.isInitialized = false;
          self.lastAdState = false; // Reset state for new page
          self.init();
        }
      });
    },

    /**
     * Check if current page is a YouTube page (any page that should have ad blocking)
     */
    isYouTubePage: function() {
      var hostname = window.location.hostname;
      var pathname = window.location.pathname;

      // Check if we're on YouTube domain
      if (!hostname || hostname.indexOf('youtube.com') === -1) {
        return false;
      }

      // Allow ad blocking on all YouTube pages
      return true;
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

      if (this.feedObserver) {
        this.feedObserver.disconnect();
        this.feedObserver = null;
      }

      if (this.checkInterval !== null) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }

      // Clear any pending debounced reflows
      if (this._debouncedReflowTimeout) {
        clearTimeout(this._debouncedReflowTimeout);
        this._debouncedReflowTimeout = null;
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
  // AUTO-INITIALIZATION (ENHANCED)
  // =============================================================================

  // Only run on YouTube domains
  if (window.location.hostname.indexOf('youtube.com') !== -1) {
    // Initialize Layer 3 & 4 (DOM-based fallback + feed monitoring) on ALL YouTube pages
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        YouTubeAdSkipper.init();
      });
    } else {
      YouTubeAdSkipper.init();
    }
  }

  // Expose for debugging (optional - remove in production if desired)
  window.__SAFEGAZE_YT_AD_SKIPPER__ = YouTubeAdSkipper;

})();
