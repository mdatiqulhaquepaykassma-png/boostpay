/*!
 * app-install.js — a visible "Install app" bar for the console web apps.
 *
 * Chrome dropped its automatic install mini-infobar, so opening /app showed no
 * install action at all unless the user hunted through the browser menu. This
 * tiny, dependency-free script adds one obvious button that triggers the native
 * install sheet, and falls back to exact per-platform steps when the browser
 * cannot show a programmatic prompt (iOS Safari, in-app browsers, a dismissal).
 *
 * Injected only into dist/app.html (the /app entry), never into the normal app.
 */
(function () {
  'use strict';
  if (window.__bpInstallBar) return;
  window.__bpInstallBar = true;

  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  if (standalone) return;                      // already installed

  try {
    var dismissedAt = Number(localStorage.getItem('bp_install_bar_dismissed') || 0);
    if (dismissedAt && Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return;
  } catch (e) { /* private mode */ }

  var promptEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    promptEvent = e;
    if (window.__bpInstallBarBtn) window.__bpInstallBarBtn.disabled = false;
  });
  window.addEventListener('appinstalled', function () {
    if (window.__bpInstallBarRoot) window.__bpInstallBarRoot.remove();
  });

  var ua = (navigator.userAgent || '').toLowerCase();
  var isIOS = /iphone|ipad|ipod/.test(ua);
  var inApp = /(fban|fbav|instagram|line\/|telegram|twitter|micromessenger)/.test(ua);
  var appName = (document.title || 'the app').replace(/\s*[—-]\s*.*$/, '') || 'the app';

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.setAttribute('style', css);
    if (text) n.textContent = text;
    return n;
  }

  var root = el('div',
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:10px;align-items:center;' +
    'padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,#18181b,#09090b);' +
    'border-top:1px solid #3f3f46;font:400 12px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e4e4e7;' +
    'box-shadow:0 -8px 24px rgba(0,0,0,.45)');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Install ' + appName);

  var icon = el('div',
    'flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:#f59e0b;color:#09090b;display:flex;' +
    'align-items:center;justify-content:center;font-weight:900;font-size:15px', '↓');

  var copy = el('div', 'flex:1 1 auto;min-width:0');
  copy.appendChild(el('div', 'font-weight:800;font-size:12.5px;color:#fff', 'Install ' + appName));
  copy.appendChild(el('div', 'font-size:10px;color:#a1a1aa;margin-top:1px', 'Full screen app, one tap away.'));

  var btn = el('button',
    'flex:0 0 auto;border:0;border-radius:10px;background:#f59e0b;color:#09090b;font-weight:900;font-size:11.5px;' +
    'padding:9px 14px;cursor:pointer;font-family:inherit', 'Install');
  btn.setAttribute('aria-label', 'Install ' + appName);
  window.__bpInstallBarBtn = btn;

  var close = el('button',
    'flex:0 0 auto;border:0;background:transparent;color:#71717a;font-size:16px;line-height:1;padding:6px;cursor:pointer', '✕');
  close.setAttribute('aria-label', 'Dismiss');

  function dismiss() {
    try { localStorage.setItem('bp_install_bar_dismissed', String(Date.now())); } catch (e) { /* ignore */ }
    root.remove();
  }
  close.addEventListener('click', dismiss);

  function help() {
    var steps = inApp
      ? ['এই ব্রাউজারের ভেতরে (Facebook/Instagram/Telegram) ইনস্টল হয় না।',
         'উপরে ⋯ মেনু → “Open in browser” / “Open in Chrome” চাপুন।',
         'তারপর আবার Install চাপুন।']
      : isIOS
        ? ['Safari-র নিচের Share আইকনে চাপুন ⬆️',
           '“Add to Home Screen” বেছে নিন',
           'নাম দেখে “Add” চাপুন']
        : ['Chrome-এর ⋮ মেনু খুলুন',
           '“Install app” বা “Add to Home screen” বেছে নিন',
           '“Install” / “Add” চাপুন'];

    var back = el('div',
      'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.75);display:flex;align-items:flex-end;' +
      'justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom))');
    var card = el('div',
      'width:100%;max-width:380px;background:#18181b;border:1px solid #3f3f46;border-radius:18px;padding:16px;' +
      'font:400 12.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e4e4e7');
    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px');
    head.appendChild(el('div', 'font-weight:800;font-size:13.5px;color:#fff', 'Install ' + appName));
    var x = el('button', 'border:0;background:transparent;color:#a1a1aa;font-size:16px;cursor:pointer', '✕');
    x.addEventListener('click', function () { back.remove(); });
    head.appendChild(x);
    card.appendChild(head);
    var ol = el('ol', 'margin:0;padding-left:18px;color:#d4d4d8');
    steps.forEach(function (s) { ol.appendChild(el('li', 'margin:6px 0', s)); });
    card.appendChild(ol);
    back.appendChild(card);
    back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
  }

  btn.addEventListener('click', function () {
    if (promptEvent && promptEvent.prompt) {
      promptEvent.prompt();
      var choice = promptEvent.userChoice;
      if (choice && choice.then) {
        choice.then(function (c) {
          if (c && c.outcome === 'accepted') root.remove();
          promptEvent = null;
        });
      }
      return;
    }
    help();                                    // no programmatic prompt available
  });

  root.appendChild(icon);
  root.appendChild(copy);
  root.appendChild(btn);
  root.appendChild(close);
  window.__bpInstallBarRoot = root;

  function mount() { if (document.body) document.body.appendChild(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
