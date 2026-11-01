/* =====================================================================
 * BoostPay — API base + host failover  (public/api-base.js)
 * ---------------------------------------------------------------------
 * Loaded BEFORE the app bundle in every web app (see index.html).
 *
 *  · In a normal browser it does nothing at all: requests stay same-origin ("/api/...").
 *  · Inside the Android app (Capacitor) the bundle is served from https://localhost,
 *    so relative "/api/..." calls would hit the phone itself. This file then:
 *      1. picks the first reachable BoostPay host (health probe, 3s timeout),
 *      2. remembers it in localStorage so the next launch is instant,
 *      3. wraps window.fetch so every "/api/..." call goes to that host,
 *      4. moves to the next host automatically if a call fails with a network error
 *         (domain died / blocked) and retries once.
 *
 * Hosts can be changed here and shipped with a new APK — or changed remotely by
 * GET /api/mobile/hosts (the app asks the server, which knows the current list).
 * Nothing secret is stored here.
 * ===================================================================== */
(function () {
  // Every entry MUST answer <host>/api/health (a dead entry only costs a 3s probe).
  // Keep in sync with MOBILE_HOSTS_DEFAULT in server.ts; the server can also change
  // this list remotely via GET /api/mobile/hosts.
  var HOSTS = [
    'https://boostpay.online',
    'https://boostpay.72-60-42-18.sslip.io'
  ];

  var STORE_KEY = 'boostpay.apiHost';
  var PROBE_MS = 3000;
  var native = (function () {
    try {
      var cap = window.Capacitor;
      if (cap && typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    } catch (e) { /* ignore */ }
    return /^(capacitor|ionic):\/\//i.test(location.protocol) || location.hostname === 'localhost' && location.port === '';
  })();

  window.__BP_NATIVE__ = native;
  window.__BP_API_HOSTS__ = HOSTS.slice();

  if (!native) {
    // Browser / PWA: same-origin, nothing to rewrite.
    window.__BP_API_BASE__ = '';
    return;
  }

  var originalFetch = window.fetch.bind(window);
  var current = null;       // chosen host
  var choosing = null;      // in-flight selection promise

  function hostIndex(h) { return HOSTS.indexOf(h); }

  function probe(host, ms) {
    return new Promise(function (resolve) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve(false); }, ms || PROBE_MS);
      originalFetch(host + '/api/health', { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { clearTimeout(timer); resolve(r.ok); })
        .catch(function () { clearTimeout(timer); resolve(false); });
    });
  }

  function remember(host) {
    current = host;
    window.__BP_API_BASE__ = host;
    try { localStorage.setItem(STORE_KEY, host); } catch (e) { /* private mode */ }
  }

  function pick() {
    if (current) return Promise.resolve(current);
    if (choosing) return choosing;
    var cached = null;
    try { cached = localStorage.getItem(STORE_KEY); } catch (e) { /* ignore */ }

    // Cached host first (fast path), then the rest in order.
    var order = HOSTS.slice();
    if (cached && hostIndex(cached) > 0) {
      order = [cached].concat(HOSTS.filter(function (h) { return h !== cached; }));
    }

    choosing = order.reduce(function (chain, host) {
      return chain.then(function (found) {
        if (found) return found;
        return probe(host).then(function (ok) { return ok ? host : null; });
      });
    }, Promise.resolve(null)).then(function (found) {
      choosing = null;
      var host = found || cached || HOSTS[0];
      remember(host);
      return host;
    });
    return choosing;
  }

  /** Only API paths are rewritten — never page assets, never absolute URLs. */
  function isApiPath(url) {
    return typeof url === 'string' && url.charAt(0) === '/' && url.indexOf('/api/') === 0;
  }

  /** Every host except the one that just failed, in priority order. */
  function candidatesAfter(host) {
    var i = hostIndex(host);
    if (i < 0) return HOSTS.slice();
    return HOSTS.slice(i + 1).concat(HOSTS.slice(0, i));
  }

  /** First reachable host from the candidate list, or null. */
  function firstReachable(list) {
    return list.reduce(function (chain, host) {
      return chain.then(function (found) {
        if (found) return found;
        return probe(host, PROBE_MS).then(function (ok) { return ok ? host : null; });
      });
    }, Promise.resolve(null));
  }

  /**
   * Ask the server for the current host order (it watches the hosts and puts the
   * healthy ones first). Falls back to the baked-in list when offline.
   */
  function refreshHostsFromServer() {
    return originalFetch(HOSTS[0] + '/api/mobile/hosts', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.hosts) && data.hosts.length) {
          HOSTS = data.hosts.filter(function (h) { return /^https:\/\//.test(h); });
          window.__BP_API_HOSTS__ = HOSTS.slice();
        }
        return HOSTS;
      })
      .catch(function () { return HOSTS; });
  }

  // Pick a host while the splash is still up, but never block the first paint.
  window.__BP_READY__ = pick().then(function (host) { return host; });
  // Refresh the list in the background (a moved/blocked domain reaches the phone
  // without a new APK).
  pick().then(refreshHostsFromServer).then(function (list) {
    // If the host we picked is no longer in the server's list, re-probe next launch.
    if (current && list && list.indexOf(current) < 0) current = null;
  });

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    if (!isApiPath(url)) return originalFetch(input, init);

    return pick().then(function (host) {
      var target = host + url;
      var opts = init || {};
      var send = function (h) {
        return originalFetch(h + url, opts);
      };
      return send(host).catch(function (err) {
        // Network-level failure (domain dead / blocked): walk the remaining hosts.
        return firstReachable(candidatesAfter(host)).then(function (alt) {
          if (!alt) throw err;
          remember(alt);
          return send(alt);
        });
      });
    });
  };

  // Surface the app's host state to the UI (e.g. a "reconnecting" banner).
  window.__BP_SWITCH_HOST__ = function (host) {
    if (hostIndex(host) >= 0) remember(host);
  };
})();
