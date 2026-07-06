// Shared shell for /kata pages: header chrome (3 buttons + user chip),
// theme controller (palette synced with se77n main app), and i18n.
//
// Loaded after _strings.js. Reads window.KATA_STRINGS as the i18n table.
//
// Pages opt in by:
//   1. Including <script src="_strings.js"></script><script src="_shell.js"></script>
//      near the top of <body> (before page-specific scripts).
//   2. Replacing their hardcoded 3-button + chip cluster with a single
//      <div id="kata-header-actions"></div> slot. Shell renders into it.
//   3. Tagging static Vietnamese strings with `data-i18n="key"`. Shell
//      swaps text content on lang change.
//
// Cross-page state lives in localStorage so navigation preserves it AND
// se77n.com main app reads/writes the same keys (theme.lockIdx).

(function () {
  'use strict';

  // ── Palette (mirrors src/lib.jsx AMBIENT_TRACKS verbatim) ──────
  // [primary, secondary]; primary is what we expose as --accent and use
  // to build --ambient-r/g/b. Secondary kept for future gradients.
  var TRACKS = [
    { palette: ['#E04545', '#1a0a08'], i18n: 'theme.red' },
    { palette: ['#5BA868', '#0b1a12'], i18n: 'theme.green' },
    { palette: ['#D4A858', '#1a1408'], i18n: 'theme.gold' },
    { palette: ['#E04545', '#5BA868'], i18n: 'theme.red-green' },
    { palette: ['#D4A858', '#E04545'], i18n: 'theme.gold-red' },
    { palette: ['#FAFAF7', '#E4E4E1'], i18n: 'theme.white' },
  ];
  var ROTATE_MS = 40_000; // matches src/lib.jsx:715

  var LS_LOCK = 'se77n.theme.lockIdx';   // shared with main app
  var LS_LANG = 'se77n.lang';            // local to dashboard for now
  var LS_MODE = 'kata.theme';            // 'light' | 'dark' — shared with cost.html + main app

  // Pre-paint: set data-theme on <html> the instant this (render-blocking,
  // top-of-body) script runs, before the rest of the body is parsed — so
  // light mode applies without a flash of dark content.
  (function applyModeEarly() {
    try {
      var m = localStorage.getItem(LS_MODE);
      if (m !== 'light' && m !== 'dark') {
        var q = new URLSearchParams(location.search).get('theme');
        m = (q === 'light' || q === 'dark') ? q : 'dark';
      }
      document.documentElement.setAttribute('data-theme', m);
    } catch (_) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    // Inject the light-mode overrides now (head already exists; this script is
    // render-blocking and runs before the body content paints) so light pages
    // never flash dark while waiting for boot()/DOMContentLoaded.
    try { injectLightOverlay(); } catch (_) {}
  })();

  // ── State ───────────────────────────────────────────────────────
  var state = {
    lockIdx: readLockIdx(),     // null | 0..5
    rotIdx: 0,                   // current rotation slot when AUTO
    rotTimer: null,
    lang: readLang(),            // 'vi' | 'en'
    mode: readMode(),            // 'light' | 'dark'
  };

  function readMode() {
    try {
      var v = localStorage.getItem(LS_MODE);
      return v === 'light' ? 'light' : (v === 'dark' ? 'dark' : (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
    } catch (_) { return 'dark'; }
  }
  function writeMode(m) {
    try { localStorage.setItem(LS_MODE, m); } catch (_) {}
  }
  function applyMode() {
    document.documentElement.setAttribute('data-theme', state.mode);
  }
  function setMode(m) {
    m = (m === 'light') ? 'light' : 'dark';
    if (m === state.mode) return;
    state.mode = m;
    writeMode(m);
    applyMode();
    rerenderHeader();
    repaintAmbient();
    document.dispatchEvent(new CustomEvent('kata:mode-change', { detail: { mode: m } }));
  }

  function readLockIdx() {
    try {
      var raw = localStorage.getItem(LS_LOCK);
      if (raw == null) return null;
      var v = JSON.parse(raw);
      if (v == null) return null;
      var n = Number(v);
      return Number.isInteger(n) && n >= 0 && n < TRACKS.length ? n : null;
    } catch (_) { return null; }
  }
  function writeLockIdx(idx) {
    try { localStorage.setItem(LS_LOCK, JSON.stringify(idx)); } catch (_) {}
  }
  function readLang() {
    try {
      var v = localStorage.getItem(LS_LANG);
      return v === 'en' ? 'en' : 'vi';
    } catch (_) { return 'vi'; }
  }
  function writeLang(lang) {
    try { localStorage.setItem(LS_LANG, lang); } catch (_) {}
  }

  // ── i18n ────────────────────────────────────────────────────────
  function t(key) {
    var table = (window.KATA_STRINGS && window.KATA_STRINGS[state.lang]) || {};
    var fallback = (window.KATA_STRINGS && window.KATA_STRINGS.vi) || {};
    return table[key] || fallback[key] || key;
  }
  function applyI18n(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      if (!key) continue;
      var attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, t(key));
      } else {
        el.textContent = t(key);
      }
    }
    document.documentElement.lang = state.lang;
  }
  function setLang(lang) {
    if (lang !== 'vi' && lang !== 'en') return;
    if (lang === state.lang) return;
    state.lang = lang;
    writeLang(lang);
    applyI18n();
    rerenderHeader();
    document.dispatchEvent(new CustomEvent('kata:lang-change', { detail: { lang: lang } }));
  }

  // ── Theme ───────────────────────────────────────────────────────
  function activeIdx() {
    return state.lockIdx == null ? state.rotIdx : state.lockIdx;
  }
  function paint() {
    var hex = TRACKS[activeIdx()].palette[0];
    var hex2 = TRACKS[activeIdx()].palette[1] || '#5BA868';
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var root = document.documentElement;
    root.style.setProperty('--ambient-r', String(r));
    root.style.setProperty('--ambient-g', String(g));
    root.style.setProperty('--ambient-b', String(b));
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-2', hex2);
    repaintAmbient();
    document.dispatchEvent(new CustomEvent('kata:theme-change', { detail: { idx: activeIdx(), hex: hex } }));
  }
  function startRotation() {
    stopRotation();
    if (state.lockIdx != null) return;
    state.rotTimer = setInterval(function () {
      state.rotIdx = (state.rotIdx + 1) % TRACKS.length;
      paint();
      rerenderThemeButton();
    }, ROTATE_MS);
  }
  function stopRotation() {
    if (state.rotTimer) {
      clearInterval(state.rotTimer);
      state.rotTimer = null;
    }
  }
  function setLockIdx(idx) {
    state.lockIdx = (idx == null || idx < 0) ? null : idx;
    writeLockIdx(state.lockIdx);
    if (state.lockIdx == null) {
      startRotation();
    } else {
      stopRotation();
    }
    paint();
    rerenderThemeButton();
  }

  // ── CSS overlay so existing tailwind classes follow --accent ────
  // The kata pages use tailwind CDN with a fixed `red` color compiled in.
  // We can't change tailwind output at runtime, but we can add overrides
  // for the specific classes used as accents. This is a small surface —
  // about 8 utility classes — and covers every accent on every page.
  function injectAccentOverlay() {
    if (document.getElementById('kata-accent-overlay')) return;
    var s = document.createElement('style');
    s.id = 'kata-accent-overlay';
    s.textContent = [
      ':root { --accent: #E04545; --accent-2: #5BA868; --ambient-r: 224; --ambient-g: 69; --ambient-b: 69; }',
      // Solid red usages
      '.text-red { color: var(--accent) !important; }',
      '.bg-red { background-color: var(--accent) !important; }',
      '.border-red { border-color: var(--accent) !important; }',
      '.fill-red { fill: var(--accent) !important; }',
      '.stroke-red { stroke: var(--accent) !important; }',
      // Glow used on logo and accent dots
      '.glow77 { text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 80%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 36px color-mix(in srgb, var(--accent) 20%, transparent); }',
      // Ambient breathe animation, mirrors src/styles.css
      '@keyframes kata-ambient { 0%,100% { opacity: 0.55; } 50% { opacity: 0.85; } }',
      // The 3 fixed full-viewport background layers we paint in
      // injectAmbientLayers(). z-index:-1 so they stay above body's own
      // background paint but below every other element on the page,
      // including elements that are themselves position:fixed (header,
      // sidebar) — without forcing position:relative on the whole page,
      // which would break those fixed elements and push content down.
      '#kata-ambient-base, #kata-ambient-grain, #kata-ambient-pulse { position: fixed; inset: 0; pointer-events: none; z-index: -1; }',
      '#kata-ambient-base { transition: background-image 1.2s ease; }',
      '#kata-ambient-grain { background-image: radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px); background-size: 3px 3px; opacity: 0.5; }',
      '#kata-ambient-pulse { animation: kata-ambient 4s ease-in-out infinite; }',
      // The kata pages set bg-bg on <body>, which would paint OVER our
      // z-index:-1 layers. Make body's background transparent and move
      // the solid colour to <html> instead — html paints below body, so
      // the negative-z-index layers sit between the two and are visible.
      'html { background-color: #0d0a08; }',
      'body { background-color: transparent !important; }',
      // cost.html ships its own light/dark button; the shell now provides a
      // unified one in the header actions, so hide the page-local duplicate.
      '#themeToggle { display: none !important; }',
      // ── Mobile: light/dark + colour-theme buttons become icon-only so the
      //    header action cluster stops overflowing onto the se77n/kata logo.
      //    Injected here (always runs in boot) so it covers every page,
      //    including the .hdr-logo pages that setupMobileChrome() skips.
      '@media (max-width: 768px) {',
      '  #kata-mode-btn > span:last-child { display: none !important; }',       // "LIGHT"/"DARK" text
      '  #kata-mode-btn { width: 34px !important; padding-left: 0 !important; padding-right: 0 !important; justify-content: center !important; gap: 0 !important; }',
      '  #kata-theme-btn button > span:nth-child(2) { display: none !important; }', // colour name / AUTO
      '  #kata-theme-btn button { padding-left: 9px !important; padding-right: 9px !important; gap: 5px !important; }',
      '  #kata-user-name { display: none !important; }',                        // keep avatar only
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Light-mode overlay ─────────────────────────────────────────
  // Every kata page hardcodes a dark palette (tailwind config + inline
  // styles). Rather than refactor 11 pages, we flip the whole site from one
  // place: when <html data-theme="light">, remap the dark tokens to the
  // light palette. Inline literals are matched by attribute-substring with a
  // property prefix (`background:` / `color:` / `solid `) so we only ever
  // touch the intended property and never a gradient stop or box-shadow.
  function injectLightOverlay() {
    if (document.getElementById('kata-light-overlay')) return;
    var R = [];
    var L = '[data-theme="light"] ';

    // expose the design palette as variables for pages that opt in
    R.push('[data-theme="light"]{--bg:#f3eee4;--fg-rgb:33,28,22;--panel:#ffffff;--panel2:#faf6ee;--chrome-rgb:248,244,237;}');
    R.push('[data-theme="dark"]{--bg:#0d0a08;--fg-rgb:245,237,224;--panel:#15110d;--panel2:#1c1813;--chrome-rgb:13,10,8;}');

    // base chrome
    R.push('html[data-theme="light"]{background-color:#f3eee4 !important;}');
    R.push(L + 'body{color:#211c16 !important;}');
    R.push(L + '#kata-ambient-grain{background-image:radial-gradient(rgba(33,28,22,0.05) 1px,transparent 1px) !important;}');
    // page-local grain (tavern / cost) uses white dots — flip to dark
    R.push(L + '.grain{background-image:radial-gradient(rgba(33,28,22,0.05) 1px,transparent 1px) !important;}');
    // tavern's WebGL backdrop canvas is opaque dark; fade it so the light bg shows
    R.push(L + '#bg{opacity:0.12 !important;}');

    // tailwind utility classes used across pages
    R.push(L + '.bg-bg{background-color:#f3eee4 !important;}');
    R.push(L + '.bg-panel{background-color:#ffffff !important;}');
    R.push(L + '.bg-panel2{background-color:#faf6ee !important;}');
    R.push(L + '.text-ink{color:#211c16 !important;}');
    R.push(L + '.text-mute{color:rgba(33,28,22,0.55) !important;}');
    R.push(L + '.text-mute2{color:rgba(33,28,22,0.40) !important;}');
    R.push(L + '.border-line{border-color:rgba(33,28,22,0.12) !important;}');
    R.push(L + '.border-line2{border-color:rgba(33,28,22,0.18) !important;}');
    R.push(L + '.text-gold{color:#ad7f31 !important;}');
    R.push(L + '.text-green{color:#3d8a4f !important;}');

    // solid inline surface fills
    var BG = {
      '#0d0a08':'#f3eee4', '#0d0a09':'#f3eee4',
      '#15110d':'#ffffff', '#131010':'#ffffff', '#13100f':'#ffffff', '#100d0c':'#ffffff',
      '#1c1813':'#faf6ee', '#1c1614':'#faf6ee', '#1a1312':'#f3ece0', '#1a1513':'#f3ece0', '#16120f':'#faf6ee',
      '#0e0b0a':'#ffffff', '#0b0908':'#ffffff', '#0a0807':'#f0ebe1',
    };
    Object.keys(BG).forEach(function (h) {
      R.push(L + '[style*="background:' + h + '" i]{background-color:' + BG[h] + ' !important;}');
      R.push(L + '[style*="background-color:' + h + '" i]{background-color:' + BG[h] + ' !important;}');
    });
    // translucent chrome rgba(13,10,8,A) → light chrome (keep alpha)
    ['0.5','0.55','0.6','0.7','0.72','0.78','0.82','0.84','0.85','0.92','0.95','0.96'].forEach(function (a) {
      R.push(L + '[style*="background:rgba(13,10,8,' + a + ')" i]{background-color:rgba(248,244,237,' + a + ') !important;}');
    });
    // translucent panels rgba(21,17,13,A) → white panel
    ['0.4','0.45','0.5','0.55','0.62','0.7','0.85','0.88','0.92'].forEach(function (a) {
      R.push(L + '[style*="background:rgba(21,17,13,' + a + ')" i]{background-color:rgba(255,255,255,' + a + ') !important;}');
    });
    // faint fg overlays used as active-button backgrounds
    ['0.10','0.07','0.05','0.04'].forEach(function (a) {
      R.push(L + '[style*="background:rgba(245,237,224,' + a + ')" i]{background-color:rgba(33,28,22,0.06) !important;}');
    });

    // inline ink text
    var TX = { '#f5ede0':'#211c16', '#f3ede6':'#211c16', '#ece6df':'#26201a', '#ddd6cf':'#3a322a', '#cfc7bf':'#4a4036', '#b9b0a8':'#6b6258' };
    Object.keys(TX).forEach(function (h) { R.push(L + '[style*="color:' + h + '" i]{color:' + TX[h] + ' !important;}'); });
    R.push(L + '[style*="color:#D4A858" i]{color:#ad7f31 !important;}');
    R.push(L + '[style*="color:#5BA868" i]{color:#3d8a4f !important;}');
    // muted inline text rgba(245,237,224,A) → dark (same alpha)
    ['0.3','0.32','0.35','0.4','0.45','0.5','0.55','0.6','0.65','0.7','0.75','0.85'].forEach(function (a) {
      R.push(L + '[style*="color:rgba(245,237,224,' + a + ')" i]{color:rgba(33,28,22,' + a + ') !important;}');
    });

    // dark solid borders → light
    ['#2c2522','#272120','#1d1817','#332a26','#1f1a18','#3a302c','#2a2422','#2c2421'].forEach(function (h) {
      R.push(L + '[style*="solid ' + h + '" i]{border-color:rgba(33,28,22,0.14) !important;}');
      R.push(L + '[style*="border-color:' + h + '" i]{border-color:rgba(33,28,22,0.14) !important;}');
    });
    // white borders → dark tint (scale alpha up a touch for visibility)
    ['0.02','0.03','0.04','0.05','0.06','0.08','0.09','0.10','0.12','0.14','0.15','0.18','0.25','0.3'].forEach(function (a) {
      var da = Math.min(0.3, parseFloat(a) * 1.5 + 0.02).toFixed(2);
      R.push(L + '[style*="solid rgba(255,255,255,' + a + ')" i]{border-color:rgba(33,28,22,' + da + ') !important;}');
      R.push(L + '[style*="border-color:rgba(255,255,255,' + a + ')" i]{border-color:rgba(33,28,22,' + da + ') !important;}');
    });

    // ── Surfaces defined in page CSS classes (the inline overlay can't reach
    //    class rules). Flip card/panel/input surfaces to light + their text to
    //    dark. Nav active/hover and the hover highlights deliberately STAY dark
    //    (dark bg + light text) — that's the legible "selected/hover" treatment.
    ['.card', '.row', '.set-card', '.resolved', '.dd-panel'].forEach(function (c) {
      R.push(L + c + '{background-color:#ffffff !important;border-color:rgba(33,28,22,0.12) !important;}');
    });
    ['.field', '.inp', '.dd-trigger', '.btn-step', '.set-segnav', '.msg-bubble', '.rv-prompt', '.rv-rrow', '.rv-cnode'].forEach(function (c) {
      R.push(L + c + '{background-color:#faf6ee !important;border-color:rgba(33,28,22,0.12) !important;}');
    });
    R.push(L + '.bar-track{background-color:rgba(33,28,22,0.08) !important;}');
    R.push(L + '.tgl{background-color:rgba(33,28,22,0.10) !important;border-color:rgba(33,28,22,0.18) !important;}');
    R.push(L + '.card:hover, ' + L + '.row:hover{border-color:rgba(33,28,22,0.24) !important;}');
    // class-defined light text → dark (nav/hover excluded so they stay legible)
    ['.fld-title', '.set-sec-h', '.rv-rv', '.rv-sv', '.rv-title', '.dd-item', '.dd-trigger', '.field', '.inp', '.chain-model', '.set-narr-t'].forEach(function (c) {
      R.push(L + c + '{color:#211c16 !important;}');
    });
    // Nav active/hover deliberately STAYS a dark pill — keep its text LIGHT
    // (these rows lean on .text-ink which the overlay above flipped to dark).
    R.push(L + '.navrow.on, ' + L + '.navrow.on .flex-1, ' + L + '.navitem.on{color:#f5ede0 !important;}');
    // Content-row hover → a subtle light highlight so the (now dark) text stays readable.
    ['.dd-item:hover', '.act-row:hover'].forEach(function (c) {
      R.push(L + c + '{background-color:rgba(33,28,22,0.05) !important;}');
    });

    // JS-built header controls set their colour via el.style.color = '#f5ede0',
    // which the browser serialises to rgb(245, 237, 224) — so the inline
    // [style*="color:#f5ede0"] flips above never match them and the lang / mode
    // / theme / user buttons stayed near-white on the light chrome (invisible).
    // Override them by id (stylesheet !important beats the non-important inline).
    R.push(L + '#kata-lang-btn, ' + L + '#kata-lang-btn span, ' + L + '#kata-mode-btn, ' +
      L + '#kata-theme-btn button, ' + L + '#kata-user-chip{color:#211c16 !important;}');
    // active language pill: its inline highlight is rgba(245,237,224,.10) (light
    // on light) → flip to a dark tint so the selected language reads.
    R.push(L + '#kata-lang-btn span[style*="background"]{background-color:rgba(33,28,22,0.10) !important;}');

    var s = document.createElement('style');
    s.id = 'kata-light-overlay';
    s.textContent = R.join('\n');
    document.head.appendChild(s);
  }

  // ── Ambient background layers ──────────────────────────────────
  // Paints three fixed full-viewport backgrounds behind the page content,
  // mirroring AmbientBackground in se77n/src/App.jsx. Layer 1 is the soft
  // gradient driven by the active palette (changes when theme changes),
  // layer 2 is a static dotted grain, layer 3 is a bottom radial that
  // pulses via the kata-ambient keyframe.
  function injectAmbientLayers() {
    if (!document.getElementById('kata-ambient-base')) {
      var base = document.createElement('div');
      base.id = 'kata-ambient-base';
      base.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(base, document.body.firstChild);
    }
    if (!document.getElementById('kata-ambient-grain')) {
      var grain = document.createElement('div');
      grain.id = 'kata-ambient-grain';
      grain.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(grain, document.body.firstChild);
    }
    if (!document.getElementById('kata-ambient-pulse')) {
      var pulse = document.createElement('div');
      pulse.id = 'kata-ambient-pulse';
      pulse.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(pulse, document.body.firstChild);
    }
  }

  function repaintAmbient() {
    var idx = activeIdx();
    var c1 = TRACKS[idx].palette[0];
    var c2 = TRACKS[idx].palette[1] || '#5BA868';
    var base = document.getElementById('kata-ambient-base');
    var pulse = document.getElementById('kata-ambient-pulse');
    if (base) {
      base.style.backgroundImage =
        'radial-gradient(60% 50% at 18% 12%, ' + c1 + '26 0%, transparent 65%),' +
        'radial-gradient(50% 45% at 90% 88%, ' + c2 + '28 0%, transparent 70%),' +
        'radial-gradient(35% 30% at 60% 50%, #D4A85810 0%, transparent 75%),' +
        'linear-gradient(180deg, rgba(91,168,104,0.02) 0%, transparent 50%)';
    }
    if (pulse) {
      pulse.style.background =
        'radial-gradient(600px circle at 50% 100%, ' + c1 + '11, transparent 70%)';
    }
  }

  // ── Header chrome ───────────────────────────────────────────────
  // Renders into <div id="kata-header-actions"></div>. Idempotent —
  // safe to call multiple times.
  function rerenderHeader() {
    var slot = document.getElementById('kata-header-actions');
    if (!slot) return;
    slot.innerHTML = '';
    slot.appendChild(buildLangButton());
    slot.appendChild(buildModeButton());
    slot.appendChild(buildThemeButton());
    slot.appendChild(buildUserChip());
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.gap = '10px';
  }
  function rerenderThemeButton() {
    var existing = document.getElementById('kata-theme-btn');
    if (!existing || !existing.parentElement) return;
    existing.parentElement.replaceChild(buildThemeButton(), existing);
  }

  // Light / dark toggle — pill with a swatch + LIGHT/DARK label.
  function buildModeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kata-mode-btn';
    btn.className = 'mono h-8 px-3 rounded-full border border-line text-[10px] font-bold flex items-center gap-2';
    btn.style.letterSpacing = '0.14em';
    btn.style.textTransform = 'uppercase';
    btn.title = 'Light / dark';
    var sw = document.createElement('span');
    sw.style.cssText = 'width:12px;height:12px;border-radius:999px;flex:none;box-shadow:0 0 0 1px rgba(127,127,127,0.35)';
    sw.style.background = state.mode === 'light' ? '#f3eee4' : '#0d0a08';
    var lbl = document.createElement('span');
    lbl.textContent = state.mode === 'light' ? 'light' : 'dark';
    btn.appendChild(sw);
    btn.appendChild(lbl);
    btn.addEventListener('click', function () {
      setMode(state.mode === 'light' ? 'dark' : 'light');
    });
    return btn;
  }

  function buildLangButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kata-lang-btn';
    btn.className = 'mono h-8 rounded-full border border-line px-1 text-[10px] font-bold flex items-center';
    btn.style.letterSpacing = '0.18em';
    btn.style.textTransform = 'uppercase';
    var en = document.createElement('span');
    en.className = 'px-2 py-1 rounded-full';
    en.textContent = 'EN';
    var dot = document.createElement('span');
    dot.className = 'text-mute2 text-[9px]';
    dot.textContent = '·';
    var vi = document.createElement('span');
    vi.className = 'px-2 py-1 rounded-full';
    vi.textContent = 'VI';
    if (state.lang === 'en') {
      en.style.background = 'rgba(245,237,224,0.10)';
      en.style.color = '#f5ede0';
      vi.style.color = 'rgba(245,237,224,0.5)';
    } else {
      vi.style.background = 'rgba(245,237,224,0.10)';
      vi.style.color = '#f5ede0';
      en.style.color = 'rgba(245,237,224,0.5)';
    }
    btn.appendChild(en);
    btn.appendChild(dot);
    btn.appendChild(vi);
    btn.addEventListener('click', function () {
      setLang(state.lang === 'vi' ? 'en' : 'vi');
    });
    return btn;
  }

  function buildThemeButton() {
    var wrap = document.createElement('div');
    wrap.id = 'kata-theme-btn';
    wrap.style.position = 'relative';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mono h-8 px-3 rounded-full border border-line text-[10px] font-bold flex items-center gap-2';
    btn.style.letterSpacing = '0.18em';
    btn.style.textTransform = 'uppercase';
    btn.style.color = '#f5ede0';

    var dot = document.createElement('span');
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '9999px';
    dot.style.border = '1px solid rgba(255,255,255,.1)';
    if (state.lockIdx == null) {
      dot.style.background = 'conic-gradient(#E04545,#5BA868,#D4A858,#E04545)';
    } else {
      dot.style.background = TRACKS[state.lockIdx].palette[0];
    }
    var label = document.createElement('span');
    label.textContent = state.lockIdx == null ? t('theme.auto') : t(TRACKS[state.lockIdx].i18n);
    var caret = document.createElement('span');
    caret.className = 'text-mute text-[9px]';
    caret.textContent = '▾';
    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(caret);
    wrap.appendChild(btn);

    var menu = null;
    function closeMenu() {
      if (menu && menu.parentElement) menu.parentElement.removeChild(menu);
      menu = null;
      document.removeEventListener('click', onOutside, true);
    }
    function onOutside(e) {
      if (!menu) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeMenu();
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu) { closeMenu(); return; }
      menu = buildThemeMenu();
      wrap.appendChild(menu);
      setTimeout(function () { document.addEventListener('click', onOutside, true); }, 0);
    });

    return wrap;
  }

  function buildThemeMenu() {
    var box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.right = '0';
    box.style.top = 'calc(100% + 6px)';
    box.style.minWidth = '180px';
    box.style.background = 'rgba(13,10,8,0.95)';
    box.style.border = '1px solid rgba(255,255,255,0.08)';
    box.style.borderRadius = '10px';
    box.style.padding = '6px';
    box.style.zIndex = '100';
    box.style.backdropFilter = 'blur(8px)';
    box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';

    var options = [{ idx: null, i18n: 'theme.auto', swatch: null }].concat(
      TRACKS.map(function (track, i) {
        return { idx: i, i18n: track.i18n, swatch: track.palette[0] };
      }),
    );
    options.forEach(function (opt) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.style.width = '100%';
      row.style.padding = '8px 10px';
      row.style.background = 'transparent';
      row.style.border = 'none';
      row.style.borderRadius = '6px';
      row.style.cursor = 'pointer';
      row.style.fontFamily = '"JetBrains Mono", ui-monospace, monospace';
      row.style.fontSize = '11px';
      row.style.letterSpacing = '0.18em';
      row.style.textTransform = 'uppercase';
      row.style.color = state.lockIdx === opt.idx ? '#f5ede0' : 'rgba(245,237,224,0.6)';

      var sw = document.createElement('span');
      sw.style.width = '12px';
      sw.style.height = '12px';
      sw.style.borderRadius = '9999px';
      sw.style.border = '1px solid rgba(255,255,255,0.12)';
      sw.style.background = opt.swatch || 'conic-gradient(#E04545,#5BA868,#D4A858,#E04545)';
      var lbl = document.createElement('span');
      lbl.textContent = t(opt.i18n);
      lbl.style.flex = '1';
      lbl.style.textAlign = 'left';
      var sel = document.createElement('span');
      sel.style.color = 'var(--accent)';
      sel.style.fontSize = '12px';
      sel.textContent = state.lockIdx === opt.idx ? '●' : '';

      row.appendChild(sw);
      row.appendChild(lbl);
      row.appendChild(sel);
      row.addEventListener('mouseenter', function () { row.style.background = 'rgba(245,237,224,0.04)'; });
      row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        setLockIdx(opt.idx);
        if (box.parentElement) box.parentElement.removeChild(box);
        document.removeEventListener('click', function () {}, true);
      });
      box.appendChild(row);
    });

    var sub = document.createElement('div');
    sub.style.padding = '6px 10px 4px';
    sub.style.fontFamily = '"JetBrains Mono", ui-monospace, monospace';
    sub.style.fontSize = '9px';
    sub.style.letterSpacing = '0.22em';
    sub.style.textTransform = 'uppercase';
    sub.style.color = 'rgba(245,237,224,0.3)';
    sub.style.borderTop = '1px solid rgba(255,255,255,0.06)';
    sub.style.marginTop = '4px';
    sub.textContent = state.lockIdx == null ? t('theme.rotating') : t('theme.locked');
    box.appendChild(sub);
    return box;
  }

  // ── User chip ───────────────────────────────────────────────────
  // Pages used to show their own chip; we centralise so all pages share
  // the same hydration logic. Initially "guest"; we hit /api/auth/me
  // once and update.
  function buildUserChip() {
    var a = document.createElement('a');
    a.id = 'kata-user-chip';
    a.href = '/api/auth/discord/start';
    a.className = 'h-8 pl-1 pr-3 rounded-full border border-line flex items-center gap-2 mono text-[11px]';
    a.style.color = '#f5ede0';
    a.style.textDecoration = 'none';
    a.style.position = 'relative';
    a.style.cursor = 'pointer';

    var initialBubble = document.createElement('span');
    initialBubble.className = 'w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-extrabold';
    initialBubble.style.background = 'rgba(224,69,69,0.13)';
    initialBubble.style.color = 'var(--accent)';
    initialBubble.textContent = '?';
    var name = document.createElement('span');
    name.id = 'kata-user-name';
    name.style.maxWidth = '120px';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.textContent = t('kata.guest');
    a.appendChild(initialBubble);
    a.appendChild(name);

    // Hydrate. Cached because pages may both call this and their own
    // `/api/auth/me` fetch — sharing avoids the duplicate request.
    if (window.__kataMe) {
      hydrateChip(a, window.__kataMe);
    } else {
      fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          window.__kataMe = data;
          document.dispatchEvent(new CustomEvent('kata:auth', { detail: data }));
          hydrateChip(a, data);
        })
        .catch(function () {});
    }

    // Real interactive control: guest → OAuth start, authed → account menu.
    a.addEventListener('click', function (e) {
      var authed = !!(window.__kataMe && window.__kataMe.user);
      if (!authed) {
        if (!a.getAttribute('href')) { e.preventDefault(); window.location.href = '/api/auth/discord/start'; }
        return; // href present → let the link navigate
      }
      e.preventDefault();
      e.stopPropagation();
      if (a._menu) closeUserMenu(a); else openUserMenu(a);
    });

    return a;
  }

  function openUserMenu(anchor) {
    var u = (window.__kataMe && window.__kataMe.user) || {};
    var vi = state.lang === 'vi';
    var box = document.createElement('div');
    box.style.cssText = [
      'position:absolute', 'right:0', 'top:calc(100% + 8px)', 'z-index:120',
      'min-width:220px', 'max-width:80vw',
      'background:rgba(13,10,8,0.96)', 'border:1px solid rgba(255,255,255,0.10)',
      'border-radius:12px', 'padding:12px', 'backdrop-filter:blur(8px)',
      'box-shadow:0 16px 40px rgba(0,0,0,0.5)',
    ].join(';');

    var kicker = document.createElement('div');
    kicker.style.cssText = 'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,237,224,0.5);margin-bottom:8px';
    kicker.textContent = (vi ? 'Đã đăng nhập' : 'Signed in') + (u.provider ? ' · ' + String(u.provider).toUpperCase() : '');
    box.appendChild(kicker);

    var nm = document.createElement('div');
    nm.style.cssText = 'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;font-weight:700;color:#f5ede0';
    nm.textContent = u.displayName || u.username || '—';
    box.appendChild(nm);

    if (u.email) {
      var em = document.createElement('div');
      em.style.cssText = 'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:rgba(245,237,224,0.5);margin-top:3px;word-break:break-all';
      em.textContent = u.email;
      box.appendChild(em);
    }

    var out = document.createElement('button');
    out.type = 'button';
    out.textContent = '↩ ' + (vi ? 'Đăng xuất' : 'Sign out');
    out.style.cssText = [
      'margin-top:12px', 'width:100%', 'text-align:left',
      'padding:10px 12px', 'border-radius:8px',
      'background:transparent', 'border:1px solid rgba(255,255,255,0.10)',
      'color:#f5ede0', 'cursor:pointer',
      'font-family:"JetBrains Mono",ui-monospace,monospace', 'font-size:11px', 'letter-spacing:0.08em',
    ].join(';');
    out.addEventListener('mouseenter', function () { out.style.background = 'rgba(224,69,69,0.12)'; out.style.borderColor = 'rgba(224,69,69,0.4)'; out.style.color = '#E04545'; });
    out.addEventListener('mouseleave', function () { out.style.background = 'transparent'; out.style.borderColor = 'rgba(255,255,255,0.10)'; out.style.color = '#f5ede0'; });
    out.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      out.disabled = true;
      out.textContent = vi ? 'Đang đăng xuất…' : 'Signing out…';
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(function () {})
        .then(function () { window.location.reload(); });
    });
    box.appendChild(out);

    anchor.appendChild(box);
    anchor._menu = box;
    anchor._onOutside = function (ev) {
      if (box.contains(ev.target) || anchor.contains(ev.target)) return;
      closeUserMenu(anchor);
    };
    setTimeout(function () { document.addEventListener('click', anchor._onOutside, true); }, 0);
  }
  function closeUserMenu(anchor) {
    if (anchor._menu && anchor._menu.parentElement) anchor._menu.parentElement.removeChild(anchor._menu);
    anchor._menu = null;
    if (anchor._onOutside) { document.removeEventListener('click', anchor._onOutside, true); anchor._onOutside = null; }
  }

  function hydrateChip(a, data) {
    var user = data && data.user;
    if (!user) return;
    a.removeAttribute('href');
    a.style.cursor = 'pointer';
    var bubble = a.firstChild;
    var name = document.getElementById('kata-user-name') || a.querySelector('#kata-user-name') || a.lastChild;
    var label = user.displayName || user.username || '—';
    name.textContent = label;
    if (user.avatarUrl) {
      var img = document.createElement('img');
      img.src = user.avatarUrl;
      img.alt = '';
      img.style.width = '26px';
      img.style.height = '26px';
      img.style.borderRadius = '9999px';
      img.style.objectFit = 'cover';
      img.style.border = '1px solid rgba(255,255,255,0.08)';
      a.replaceChild(img, bubble);
    } else {
      bubble.textContent = label.slice(0, 1).toUpperCase();
    }
  }

  // ── Cross-tab sync ──────────────────────────────────────────────
  // Pick up theme/lang changes done in another tab (e.g. user toggles
  // on se77n.com main, dashboard tab updates instantly).
  window.addEventListener('storage', function (e) {
    if (e.key === LS_LOCK) {
      var newIdx = readLockIdx();
      if (newIdx !== state.lockIdx) {
        state.lockIdx = newIdx;
        if (state.lockIdx == null) startRotation();
        else stopRotation();
        paint();
        rerenderThemeButton();
      }
    } else if (e.key === LS_LANG) {
      var newLang = readLang();
      if (newLang !== state.lang) {
        state.lang = newLang;
        applyI18n();
        rerenderHeader();
      }
    } else if (e.key === LS_MODE) {
      var newMode = readMode();
      if (newMode !== state.mode) {
        state.mode = newMode;
        applyMode();
        rerenderHeader();
      }
    }
  });

  // ── Public API ──────────────────────────────────────────────────
  window.KataShell = {
    t: t,
    applyI18n: applyI18n,
    getLang: function () { return state.lang; },
    setLang: setLang,
    getMode: function () { return state.mode; },
    setMode: setMode,
    getLockIdx: function () { return state.lockIdx; },
    setLockIdx: setLockIdx,
    getAccent: function () { return TRACKS[activeIdx()].palette[0]; },
    // ── Dialog primitives ─────────────────────────────────────────
    // Native browser prompt/confirm/alert dialogs look like this:
    //   "se77n.com says..."
    // — they break the visual style of the page and on Firefox they
    // even include an "always block dialogs from this site" checkbox.
    // Pages should call these instead.
    alert: function (message, opts) { return openDialog({ kind: 'alert', message: message, ...(opts || {}) }); },
    confirm: function (message, opts) { return openDialog({ kind: 'confirm', message: message, ...(opts || {}) }); },
    prompt: function (message, defaultValue, opts) {
      return openDialog({ kind: 'prompt', message: message, defaultValue: defaultValue || '', ...(opts || {}) });
    },
    toast: showToast,
    /**
     * Open a provider-tabbed model picker popup anchored to a trigger
     * button. Used by Admin (chat/image/video model) and Tavern (storyteller
     * model, lore model, etc.). The picker writes the chosen value into
     * `opts.hiddenInput` and updates `opts.labelEl` text.
     *
     *   KataShell.modelPicker(buttonEl, {
     *     byProvider: { yunwu: ['grok-4-fast', 'gemini-3.1-pro-preview'], ... },
     *     placeholder: 'grok-4-fast',
     *     hiddenInput: <HTMLInputElement>,
     *     labelEl: <HTMLElement>,
     *     onApply: (value) => {},  // optional
     *   });
     */
    modelPicker: openModelPicker,
  };

  function openModelPicker(triggerBtn, opts) {
    const byProvider = opts.byProvider || {};
    const providers = Object.keys(byProvider);
    if (providers.length === 0) return;
    const placeholder = opts.placeholder || '';
    const hiddenInput = opts.hiddenInput;
    const labelEl = opts.labelEl;
    const accent = window.KataShell.getAccent();
    const currentValue = (hiddenInput && hiddenInput.value) || '';

    let activeProvider = providers[0];
    for (const p of providers) {
      if ((byProvider[p] || []).includes(currentValue)) { activeProvider = p; break; }
    }

    const pop = document.createElement('div');
    pop.style.cssText = [
      'position:absolute', 'z-index:1100', 'min-width:340px',
      'background:rgba(13,10,8,0.95)', 'border:1px solid rgba(255,255,255,0.10)',
      'border-radius:10px', 'padding:8px',
      'backdrop-filter:blur(8px)',
      'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
    ].join(';');

    const r = triggerBtn.getBoundingClientRect();
    pop.style.left = (r.left + window.scrollX) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
    pop.style.width = Math.max(r.width, 340) + 'px';

    function render() {
      pop.innerHTML = '';
      const tabs = document.createElement('div');
      tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px';
      for (const p of providers) {
        const t = document.createElement('button');
        t.type = 'button';
        t.textContent = p;
        t.style.cssText = [
          'font-family:"JetBrains Mono", ui-monospace, monospace',
          'font-size:10px', 'letter-spacing:0.18em', 'text-transform:uppercase',
          'padding:6px 12px', 'border-radius:6px', 'border:none', 'cursor:pointer',
          p === activeProvider ? 'background:rgba(245,237,224,0.10);color:#f5ede0' : 'background:transparent;color:rgba(245,237,224,0.5)',
        ].join(';');
        t.addEventListener('click', () => { activeProvider = p; render(); });
        tabs.appendChild(t);
      }
      pop.appendChild(tabs);

      const list = byProvider[activeProvider] || [];
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-height:280px;overflow-y:auto;margin-bottom:8px;display:flex;flex-direction:column;gap:2px';

      const def = document.createElement('button');
      def.type = 'button';
      def.textContent = `(use default · ${placeholder || '—'})`;
      def.style.cssText = [
        'font-family:"JetBrains Mono", ui-monospace, monospace',
        'font-size:11px', 'text-align:left',
        'background:rgba(13,10,8,0.6)', 'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:6px', 'padding:9px 12px', 'cursor:pointer',
        !currentValue ? `border-color:${accent};color:#f5ede0` : 'color:rgba(245,237,224,0.5)',
      ].join(';');
      def.addEventListener('click', () => apply(''));
      wrap.appendChild(def);

      for (const m of list) {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = m.includes(':') ? m.split(':').slice(1).join(':') : m;
        const isCur = m === currentValue;
        row.style.cssText = [
          'font-family:"JetBrains Mono", ui-monospace, monospace',
          'font-size:12px', 'text-align:left', 'cursor:pointer',
          'background:' + (isCur ? `${accent}11` : 'rgba(13,10,8,0.6)'),
          'border:1px solid ' + (isCur ? accent : 'rgba(255,255,255,0.08)'),
          'border-radius:6px', 'padding:9px 12px', 'color:#f5ede0',
        ].join(';');
        row.addEventListener('click', () => apply(m));
        wrap.appendChild(row);
      }
      pop.appendChild(wrap);

      const custom = document.createElement('div');
      custom.style.cssText = 'display:flex;gap:6px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'custom model id (vd: 9router:kr/...)';
      inp.style.cssText = [
        'font-family:"JetBrains Mono", ui-monospace, monospace', 'font-size:11px', 'flex:1',
        'background:rgba(13,10,8,0.6)', 'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:8px', 'padding:8px 12px', 'color:#f5ede0', 'outline:none',
      ].join(';');
      const setBtn = document.createElement('button');
      setBtn.type = 'button'; setBtn.textContent = 'use';
      setBtn.style.cssText = [
        'font-family:"JetBrains Mono", ui-monospace, monospace',
        'font-size:10px', 'letter-spacing:0.18em', 'text-transform:uppercase',
        'padding:8px 14px', 'border-radius:8px', 'border:1px solid ' + accent + '70',
        'background:' + accent + '20', 'color:#f5ede0', 'cursor:pointer', 'font-weight:700',
      ].join(';');
      setBtn.addEventListener('click', () => { const v = inp.value.trim(); if (v) apply(v); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setBtn.click(); } });
      custom.appendChild(inp); custom.appendChild(setBtn);
      pop.appendChild(custom);
    }

    function apply(v) {
      if (hiddenInput) hiddenInput.value = v;
      if (labelEl) {
        const disp = v && v.includes(':') ? v.split(':').slice(1).join(':') : v;
        labelEl.textContent = disp || `(default · ${placeholder || '—'})`;
      }
      if (typeof opts.onApply === 'function') opts.onApply(v);
      close();
    }
    function close() {
      if (pop.parentElement) pop.parentElement.removeChild(pop);
      document.removeEventListener('click', onOutside, true);
    }
    function onOutside(e) {
      if (pop.contains(e.target) || triggerBtn.contains(e.target)) return;
      close();
    }

    render();
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);
  }

  function ensureDialogStyles() {
    if (document.getElementById('kata-dialog-styles')) return;
    var s = document.createElement('style');
    s.id = 'kata-dialog-styles';
    s.textContent = [
      '@keyframes kdFadeIn { from { opacity:0 } to { opacity:1 } }',
      '@keyframes kdFadeOut { from { opacity:1 } to { opacity:0 } }',
      '@keyframes kdPop { from { transform: translateY(8px) scale(0.98); opacity:0 } to { transform: translateY(0) scale(1); opacity:1 } }',
      '@keyframes kdToastIn { from { transform: translateY(20px); opacity:0 } to { transform: translateY(0); opacity:1 } }',
      '@keyframes kdToastOut { from { transform: translateY(0); opacity:1 } to { transform: translateY(8px); opacity:0 } }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Dialog implementation (vanilla, no deps) ──────────────────
  // Matches the kata palette: panel bg, mono kicker, ink button. Returns
  // a promise:
  //   alert   → resolves null (always)
  //   confirm → resolves true (ok) | false (cancel)
  //   prompt  → resolves string | null (cancel)
  //   custom  → resolves whatever the caller's resolver returned

  function openDialog(opts) {
    return new Promise(function (resolve) {
      var accent = window.KataShell.getAccent();
      var overlay = document.createElement('div');
      overlay.setAttribute('data-kata-dialog', '');
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:1000',
        'background:rgba(13,10,8,0.78)', 'backdrop-filter:blur(8px)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:24px', 'animation:kdFadeIn 140ms ease',
        'font-family:Geist, system-ui, sans-serif',
      ].join(';');

      var panel = document.createElement('div');
      panel.style.cssText = [
        'min-width:340px', 'max-width:520px', 'width:100%',
        'background:linear-gradient(180deg, rgba(28,24,19,0.95), rgba(21,17,13,0.95))',
        'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:14px',
        'box-shadow:0 24px 60px rgba(0,0,0,0.55)',
        'padding:22px 22px 18px',
        'color:#f5ede0',
        'animation:kdPop 160ms cubic-bezier(.2,.9,.3,1.05)',
      ].join(';');

      var titleLabel = opts.title || (
        opts.kind === 'confirm' ? 'Xác nhận' :
        opts.kind === 'prompt'  ? 'Nhập' :
        'Thông báo'
      );
      var kicker = document.createElement('div');
      kicker.style.cssText = [
        'font-family:"JetBrains Mono", ui-monospace, monospace',
        'font-size:10px', 'letter-spacing:0.22em', 'text-transform:uppercase',
        'color:' + accent, 'margin-bottom:10px',
      ].join(';');
      kicker.textContent = titleLabel;
      panel.appendChild(kicker);

      var msg = document.createElement('div');
      msg.style.cssText = 'font-size:14px; line-height:1.55; color:rgba(245,237,224,0.92); white-space:pre-wrap';
      msg.textContent = opts.message || '';
      panel.appendChild(msg);

      var input = null;
      if (opts.kind === 'prompt') {
        input = document.createElement('input');
        input.type = 'text';
        input.value = opts.defaultValue || '';
        input.placeholder = opts.placeholder || '';
        input.style.cssText = [
          'width:100%', 'margin-top:14px',
          'background:rgba(13,10,8,0.65)',
          'border:1px solid rgba(255,255,255,0.10)',
          'border-radius:8px', 'padding:9px 12px',
          'color:#f5ede0',
          'font-family:Geist, system-ui, sans-serif', 'font-size:14px',
          'outline:none',
        ].join(';');
        input.addEventListener('focus', function () { input.style.borderColor = accent + '88'; });
        input.addEventListener('blur',  function () { input.style.borderColor = 'rgba(255,255,255,0.10)'; });
        panel.appendChild(input);
      } else if (opts.kind === 'longprompt') {
        input = document.createElement('textarea');
        input.value = opts.defaultValue || '';
        input.placeholder = opts.placeholder || '';
        input.rows = opts.rows || 4;
        input.style.cssText = [
          'width:100%', 'margin-top:14px',
          'background:rgba(13,10,8,0.65)',
          'border:1px solid rgba(255,255,255,0.10)',
          'border-radius:8px', 'padding:10px 12px',
          'color:#f5ede0',
          'font-family:Geist, system-ui, sans-serif', 'font-size:14px',
          'line-height:1.5', 'resize:vertical', 'outline:none',
        ].join(';');
        input.addEventListener('focus', function () { input.style.borderColor = accent + '88'; });
        input.addEventListener('blur',  function () { input.style.borderColor = 'rgba(255,255,255,0.10)'; });
        panel.appendChild(input);
      }

      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:18px';

      function btn(label, primary, danger) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        var bg = 'transparent';
        var bd = 'rgba(255,255,255,0.12)';
        var col = 'rgba(245,237,224,0.7)';
        if (primary) { bg = 'rgba(255,255,255,0.04)'; bd = accent + '70'; col = '#f5ede0'; }
        if (danger)  { col = '#E04545'; bd = 'rgba(224,69,69,0.35)'; }
        b.style.cssText = [
          'display:inline-flex', 'align-items:center', 'justify-content:center',
          'height:34px', 'padding:0 18px', 'border-radius:999px',
          'border:1px solid ' + bd, 'background:' + bg, 'color:' + col,
          'font-family:"JetBrains Mono", ui-monospace, monospace',
          'font-size:11px', 'letter-spacing:0.18em', 'text-transform:uppercase',
          'cursor:pointer', 'transition:all 120ms ease',
        ].join(';');
        b.addEventListener('mouseenter', function () { b.style.background = 'rgba(245,237,224,0.06)'; });
        b.addEventListener('mouseleave', function () { b.style.background = bg; });
        return b;
      }

      function close(result) {
        if (closed) return;
        closed = true;
        overlay.style.animation = 'kdFadeOut 120ms ease forwards';
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 130);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      var closed = false;
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(opts.kind === 'confirm' || opts.kind === 'prompt' || opts.kind === 'longprompt' ? null : null);
          if (opts.kind === 'confirm') resolve(false);
        } else if (e.key === 'Enter' && e.ctrlKey && opts.kind === 'longprompt') {
          e.preventDefault();
          close((input && input.value) || '');
        } else if (e.key === 'Enter' && opts.kind === 'prompt') {
          e.preventDefault();
          close((input && input.value) || '');
        } else if (e.key === 'Enter' && opts.kind === 'alert') {
          e.preventDefault();
          close(null);
        } else if (e.key === 'Enter' && opts.kind === 'confirm') {
          e.preventDefault();
          close(true);
        }
      }
      document.addEventListener('keydown', onKey);

      if (opts.kind === 'alert') {
        var ok = btn(opts.okLabel || 'OK', true, false);
        ok.addEventListener('click', function () { close(null); });
        actions.appendChild(ok);
      } else if (opts.kind === 'confirm') {
        var cancel = btn(opts.cancelLabel || 'huỷ', false, false);
        var confirmBtn = btn(opts.okLabel || 'đồng ý', true, !!opts.danger);
        cancel.addEventListener('click', function () { close(false); });
        confirmBtn.addEventListener('click', function () { close(true); });
        actions.appendChild(cancel);
        actions.appendChild(confirmBtn);
      } else if (opts.kind === 'prompt' || opts.kind === 'longprompt') {
        var cancel2 = btn(opts.cancelLabel || 'huỷ', false, false);
        var confirm2 = btn(opts.okLabel || 'OK', true, false);
        cancel2.addEventListener('click', function () { close(null); });
        confirm2.addEventListener('click', function () { close((input && input.value) || ''); });
        actions.appendChild(cancel2);
        actions.appendChild(confirm2);
      }

      panel.appendChild(actions);
      overlay.appendChild(panel);
      // Click on backdrop to dismiss (alert / confirm / prompt all behave
      // the same as ESC).
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          if (opts.kind === 'confirm') close(false);
          else if (opts.kind === 'prompt' || opts.kind === 'longprompt') close(null);
          else close(null);
        }
      });
      document.body.appendChild(overlay);
      ensureDialogStyles();
      if (input) setTimeout(function () { input.focus(); input.select && input.select(); }, 30);
    });
  }

  // Toast (fire-and-forget). Replaces in-line `flash()` helpers.
  function showToast(message, opts) {
    opts = opts || {};
    ensureDialogStyles();
    var accent = window.KataShell.getAccent();
    var color = opts.kind === 'error' ? '#E04545' : opts.kind === 'success' ? '#5BA868' : accent;
    var bg = opts.kind === 'error' ? 'rgba(224,69,69,0.12)' : opts.kind === 'success' ? 'rgba(91,168,104,0.12)' : (accent + '22');
    var bd = opts.kind === 'error' ? 'rgba(224,69,69,0.35)' : opts.kind === 'success' ? 'rgba(91,168,104,0.35)' : (accent + '55');
    var el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:1100',
      'background:' + bg, 'border:1px solid ' + bd, 'color:#f5ede0',
      'padding:10px 16px', 'border-radius:999px',
      'font-family:"JetBrains Mono", ui-monospace, monospace',
      'font-size:11px', 'letter-spacing:0.18em', 'text-transform:uppercase',
      'animation:kdToastIn 180ms ease',
      'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    ].join(';');
    void color;
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.animation = 'kdToastOut 180ms ease forwards';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }, opts.durationMs || 2400);
  }

  // ── Mobile chrome (responsive header + sidebar drawer) ─────────
  // Centralised so every kata page gets a usable phone layout without
  // per-page CSS. Pages that already ship their own mobile handling
  // (detected via an `.hdr-logo` class) are skipped to avoid double
  // hamburgers / conflicting rules — currently tavern + tavern-play.
  function setupMobileChrome() {
    if (document.querySelector('.hdr-logo')) return;        // page handles its own
    if (document.getElementById('kata-mobile-css')) return; // idempotent

    var css = [
      '.kata-nav-toggle { display: none; }',
      '#kata-nav-scrim { display: none; }',
      '@media (max-width: 768px) {',
      '  header { padding-left: 14px !important; padding-right: 14px !important; }',
      '  header > div:first-child { gap: 10px !important; }',
      '  header > div:first-child > a:not([href="/"]) { display: none !important; }',
      '  .kata-nav-toggle { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.08); background: transparent; color: #f5ede0; cursor: pointer; flex: 0 0 auto; }',
      '  .kata-bc { display: none !important; }',
      '  .kata-logo > div:first-child { font-size: 22px !important; letter-spacing: -0.025em; }',
      '  .kata-logo > div:nth-child(2) { display: none !important; }',
      '  .kata-logo span.font-normal { display: none !important; }',
      '  #kata-header-actions { gap: 7px !important; }',
      '  #kata-theme-btn button { padding-left: 8px !important; padding-right: 8px !important; gap: 4px !important; }',
      '  #kata-theme-btn button > span:nth-child(2) { display: none !important; }',
      '  #kata-lang-btn span { padding-left: 6px; padding-right: 6px; }',
      '  #kata-user-chip { padding-right: 3px !important; }',
      '  #kata-user-name { display: none !important; }',
      '  aside.kata-drawer { transform: translateX(-100%); transition: transform 240ms cubic-bezier(.22,1,.36,1); width: 280px; max-width: 86vw; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }',
      '  body.kata-nav-open aside.kata-drawer { transform: none; }',
      '  #kata-nav-scrim { position: fixed; inset: 0; z-index: 39; background: rgba(0,0,0,0.55); }',
      '  body.kata-nav-open #kata-nav-scrim { display: block; }',
      '  main.kata-shifted { padding-left: 16px !important; padding-right: 16px !important; }',
      '  main .grid { grid-template-columns: 1fr !important; }',
      '}',
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'kata-mobile-css';
    st.textContent = css;
    document.head.appendChild(st);

    var header = document.querySelector('header');
    if (header) {
      var bc = header.querySelector('.ml-3');         // breadcrumb block
      if (bc) bc.classList.add('kata-bc');
      var logo = header.querySelector('a[href="/"]'); // se77n / kata logo
      if (logo) logo.classList.add('kata-logo');
    }

    var main = document.querySelector('main');
    if (main && /pl-\[/.test(main.className)) main.classList.add('kata-shifted');

    // Turn the fixed sidebar into an off-canvas drawer with a hamburger.
    var aside = document.querySelector('aside');
    if (aside && header) {
      aside.classList.add('kata-drawer');
      var btn = document.createElement('button');
      btn.id = 'kata-nav-toggle-btn';
      btn.className = 'kata-nav-toggle';
      btn.setAttribute('aria-label', 'menu');
      btn.innerHTML = '<svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1" y1="2" x2="13" y2="2"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="1" y1="10" x2="9" y2="10"/></svg>';
      var left = header.firstElementChild;
      if (left) left.insertBefore(btn, left.firstChild);
      else header.insertBefore(btn, header.firstChild);

      var scrim = document.createElement('div');
      scrim.id = 'kata-nav-scrim';
      document.body.appendChild(scrim);

      var close = function () { document.body.classList.remove('kata-nav-open'); };
      btn.addEventListener('click', function () { document.body.classList.toggle('kata-nav-open'); });
      scrim.addEventListener('click', close);
      aside.querySelectorAll('a, [data-tab]').forEach(function (a) { a.addEventListener('click', close); });
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }
  }

  // ── Boot ────────────────────────────────────────────────────────
  function boot() {
    injectAccentOverlay();
    injectLightOverlay();
    applyMode();
    injectAmbientLayers();
    paint();
    if (state.lockIdx == null) startRotation();
    rerenderHeader();
    applyI18n();
    setupMobileChrome();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
