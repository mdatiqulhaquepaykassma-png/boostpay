/*!
 * app-install.js — one tap = the browser's own install sheet (no popup of ours).
 *
 * Owner rule (2026-11-10): "no popup, direct install". Chrome removed its
 * automatic install mini-infobar, so /app needs to offer the action itself — but
 * the action must be the NATIVE install sheet, not a dialog we draw.
 *
 * Behaviour
 *  - tap Install  -> beforeinstallprompt.prompt()  (Chrome/Edge/Android sheet)
 *  - prompt not ready yet -> remember the intent, wait up to 3 s, fire as soon
 *    as Chromium hands it over (cold start on a phone), then give up silently
 *  - platform that can never install from a button (iOS Safari, in-app browser)
 *    -> the bar's own subtitle changes to the exact two-tap instruction
 * Nothing is ever rendered as an overlay. Injected only into dist/app.html.
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
  var pendingIntent = false;

  function fire() {
    if (!promptEvent) return false;
    var ev = promptEvent;
    promptEvent = null;
    pendingIntent = false;
    try {
      ev.prompt();
      var choice = ev.userChoice;
      if (choice && choice.then) {
        choice.then(function (c) { if (c && c.outcome === 'accepted') removeBar(); });
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    promptEvent = e;
    if (pendingIntent) fire();                 // the user already asked for it
  });
  window.addEventListener('appinstalled', removeBar);

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
    'border-top:1px solid #3f3f46;font:400 12px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'color:#e4e4e7;box-shadow:0 -8px 24px rgba(0,0,0,.45);flex-wrap:wrap');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Install ' + appName);

  var icon = el('div',
    'flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:#f59e0b;color:#09090b;display:flex;' +
    'align-items:center;justify-content:center;font-weight:900;font-size:15px', '↓');

  var copy = el('div', 'flex:1 1 120px;min-width:0');
  var title = el('div', 'font-weight:800;font-size:12.5px;color:#fff', 'Install ' + appName);
  var sub = el('div', 'font-size:10px;color:#a1a1aa;margin-top:1px', 'One tap — the browser installs it.');
  copy.appendChild(title);
  copy.appendChild(sub);

  var btn = el('button',
    'flex:0 0 auto;border:0;border-radius:10px;background:#f59e0b;color:#09090b;font-weight:900;font-size:11.5px;' +
    'padding:9px 14px;cursor:pointer;font-family:inherit', 'Install');
  btn.setAttribute('aria-label', 'Install ' + appName);

  var close = el('button',
    'flex:0 0 auto;border:0;background:transparent;color:#71717a;font-size:16px;line-height:1;padding:6px;cursor:pointer', '✕');
  close.setAttribute('aria-label', 'Dismiss');

  function removeBar() { try { root.remove(); } catch (e) { /* ignore */ } }

  close.addEventListener('click', function () {
    try { localStorage.setItem('bp_install_bar_dismissed', String(Date.now())); } catch (e) { /* ignore */ }
    removeBar();
  });

  function inlineHint() {
    sub.textContent = inApp
      ? 'Open this page in Chrome/Safari first (the app browser blocks installs).'
      : isIOS
        ? 'Safari: Share ⬆️ → "Add to Home Screen" → Add.'
        : 'Chrome: ⋮ menu → "Install app" / "Add to Home screen".';
    sub.style.color = '#fcd34d';
  }

  btn.addEventListener('click', function () {
    if (fire()) return;                        // native sheet, done
    pendingIntent = true;                      // prompt may still be on its way
    btn.textContent = 'Installing…';
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (!pendingIntent) { clearInterval(timer); btn.textContent = 'Install'; return; }
      if (fire()) { clearInterval(timer); btn.textContent = 'Install'; return; }
      if (tries >= 12) {                       // ~3 s: this browser cannot prompt
        clearInterval(timer);
        pendingIntent = false;
        btn.textContent = 'Install';
        inlineHint();
      }
    }, 250);
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
