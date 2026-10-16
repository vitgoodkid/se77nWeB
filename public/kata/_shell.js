// Shared shell for /kata pages: the "B · Pixel Lobby" skin (theme tokens +
// pixel chrome, both light and dark), header chrome (lang / mode / palette /
// user chip), theme controller (palette synced with se77n main app), i18n,
// and the dialog / toast / model-picker primitives.
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
// Look: every page shares one skin, injected below (injectSkin). Tailwind
// configs on the pages point their colours at the --c-* channels defined
// here, so utility classes (bg-panel, text-ink, text-mute…) follow the B
// palette in both themes. Pages add their own B pieces with the k-* classes.
//
// Cross-page state lives in localStorage so navigation preserves it AND
// se77n.com main app reads/writes the same keys (theme.lockIdx, kata.theme).

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
  // top-of-body) script runs, before the rest of the body is parsed — so the
  // right theme applies without a flash. Default is light, like the main app.
  (function applyModeEarly() {
    try {
      var m = localStorage.getItem(LS_MODE);
      if (m !== 'light' && m !== 'dark') {
        var q = new URLSearchParams(location.search).get('theme');
        m = (q === 'light' || q === 'dark') ? q : 'light';
      }
      document.documentElement.setAttribute('data-theme', m);
    } catch (_) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    // Inject the skin now (head already exists; this script is render-blocking
    // and runs before the body content paints) so pages never flash unstyled.
    try { ensureFonts(); injectSkin(); } catch (_) {}
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
      return v === 'light' ? 'light' : (v === 'dark' ? 'dark' : (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'));
    } catch (_) { return 'light'; }
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

  // ── Theme (colour palette) ──────────────────────────────────────
  // The palette only tints small accents in the B skin (palette swatch, the
  // accent dot after page titles); the arcade palette itself stays fixed so
  // text keeps its contrast in both modes.
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

  // ── Fonts ───────────────────────────────────────────────────────
  // Pages link the fonts in <head>; this is a safety net so the pixel faces
  // load even on a page whose <link> predates the B skin.
  function ensureFonts() {
    if (document.getElementById('kata-b-fonts')) return;
    var links = document.querySelectorAll('link[href*="fonts.googleapis.com/css2"]');
    for (var i = 0; i < links.length; i++) {
      if (/Pixelify/.test(links[i].href) && /Silkscreen/.test(links[i].href) && /VT323/.test(links[i].href)) return;
    }
    var l = document.createElement('link');
    l.id = 'kata-b-fonts';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Pixelify+Sans:wght@500;700&family=Silkscreen:wght@400;700&family=VT323&display=swap';
    document.head.appendChild(l);
  }

  // ── Small overlay: accent utilities + page-local duplicates ─────
  function injectAccentOverlay() {
    if (document.getElementById('kata-accent-overlay')) return;
    var s = document.createElement('style');
    s.id = 'kata-accent-overlay';
    s.textContent = [
      ':root { --accent: #E04545; --accent-2: #5BA868; --ambient-r: 224; --ambient-g: 69; --ambient-b: 69; }',
      // Solid fills that used to follow the palette now keep the arcade red.
      '.bg-red { background-color: #e04545 !important; }',
      '.fill-red { fill: #e04545 !important; }',
      '.stroke-red { stroke: #e04545 !important; }',
      // cost.html ships its own light/dark button; the shell provides a
      // unified one in the header actions, so hide the page-local duplicate.
      '#themeToggle { display: none !important; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── The B skin ──────────────────────────────────────────────────
  // One stylesheet for every page, both themes. Neutrals are variables, so
  // [data-theme] on <html> flips the whole dashboard. Legacy literal dark
  // colours inside page templates are remapped by attribute-substring on the
  // intended property only (source form, e.g. `background:#131010`).
  function injectSkin() {
    if (document.getElementById('kata-b-skin')) return;
    var s = document.createElement('style');
    s.id = 'kata-b-skin';
    s.textContent = skinCss();
    document.head.appendChild(s);
  }

  function skinCss() {
    var RING4 = '0 -4px 0 0 var(--ink),0 4px 0 0 var(--ink),-4px 0 0 0 var(--ink),4px 0 0 0 var(--ink)';
    var RING3 = '0 -3px 0 0 var(--ink),0 3px 0 0 var(--ink),-3px 0 0 0 var(--ink),3px 0 0 0 var(--ink)';
    var RINGR = '0 -3px 0 0 #e04545,0 3px 0 0 #e04545,-3px 0 0 0 #e04545,3px 0 0 0 #e04545';
    var PX = RING4 + ',10px 10px 0 4px var(--shadow)';
    var PXD = RING3 + ',6px 7px 0 3px var(--shadow)';
    var SB = RING3 + ',4px 5px 0 3px var(--ink)';
    var SB_DOWN = RING3 + ',0 0 0 3px var(--ink)';
    var PB = RING4 + ',6px 8px 0 4px var(--ink)';
    var PB_HOVER = RING4 + ',8px 10px 0 4px var(--ink)';
    var PB_DOWN = RING4 + ',0 0 0 4px var(--ink)';
    // Pixel faces go through variables so Vietnamese (html[lang="vi"]) can swap
    // them out — Pixelify Sans / Silkscreen have no Vietnamese glyphs.
    var SK = 'var(--k-sk)';
    var PF = 'var(--k-pf)';
    var MONO = "'JetBrains Mono',ui-monospace,monospace";
    // ▶ cursor drawn as a 3×5 pixel sprite
    var STEP = 'polygon(0 0,34% 0,34% 20%,67% 20%,67% 40%,100% 40%,100% 60%,67% 60%,67% 80%,34% 80%,34% 100%,0 100%)';
    var R = [];

    // ── tokens (values mirror src/styles.css) ──
    R.push(':root,[data-theme="light"]{' +
      '--cream:#f3eee4;--paper:#fffaf0;--paper-2:#f7f0e3;--ink:#1b1410;--on-accent:#1b1410;' +
      '--rule:#d8cdb9;--strip:#1b1410;--strip-2:#2e251d;--strip-text:#fffaf0;--shadow:rgba(27,20,16,.18);' +
      '--dot:rgba(27,20,16,.09);--field:#f3eee4;--text:#1b1410;--muted:#5c5046;--muted-2:#6f6356;' +
      '--ka:#b9a2ff;--k-red:#b42828;--k-green:#2f7a3d;--k-gold:#7d5a0f;--k-info:#2f5f86;--k-purple:#5f43b8;' +
      '--c-bg:243 238 228;--c-panel:255 250 240;--c-panel2:247 240 227;--c-ink:27 20 16;' +
      '--c-red:180 40 40;--c-green:47 122 61;--c-gold:125 90 15;--c-info:47 95 134;--c-warn:125 90 15;--c-err:180 40 40;--c-purple:95 67 184;' +
      '--c-line:rgba(27,20,16,.2);--c-line2:rgba(27,20,16,.38);--c-mute:#5c5046;--c-mute2:#6f6356;' +
      '--kh:81px;color-scheme:light;' +
      "--k-pf:'Pixelify Sans','JetBrains Mono',ui-monospace,monospace;--k-sk:'Silkscreen','JetBrains Mono',ui-monospace,monospace;--k-fsa:none}");
    // VI mode (Pixelify / Silkscreen have no Vietnamese glyphs, and VT323's tone
    // marks blur below ~22px): big display titles (h1/h2, hero titles) use VT323;
    // every smaller pixel-styled bit falls back to bold JetBrains Mono.
    R.push('html[lang="vi"]{--k-pf:\'JetBrains Mono\',ui-monospace,monospace;--k-sk:\'JetBrains Mono\',ui-monospace,monospace;--k-fsa:none}');
    R.push('html[lang="vi"] :is(h1,h2,.k-disp){font-family:\'VT323\',\'JetBrains Mono\',monospace!important;font-weight:400!important;font-size-adjust:.62!important;line-height:1.3!important;letter-spacing:.02em!important}');
    R.push('[data-theme="dark"]{' +
      '--cream:#17110d;--paper:#261d16;--paper-2:#2e241b;--ink:#050302;' +
      '--rule:#3d3127;--strip:#0b0806;--strip-2:#261d16;--shadow:rgba(0,0,0,.5);' +
      '--dot:rgba(255,250,240,.05);--field:#17110d;--text:#fffaf0;--muted:#c9bca6;--muted-2:#a99b85;' +
      '--k-red:#ff7a7a;--k-green:#7fd18b;--k-gold:#ffd25e;--k-info:#9fd8ff;--k-purple:#b9a2ff;' +
      '--c-bg:23 17 13;--c-panel:38 29 22;--c-panel2:46 36 27;--c-ink:255 250 240;' +
      '--c-red:255 122 122;--c-green:127 209 139;--c-gold:255 210 94;--c-info:159 216 255;--c-warn:255 210 94;--c-err:255 122 122;--c-purple:185 162 255;' +
      '--c-line:rgba(255,250,240,.14);--c-line2:rgba(255,250,240,.3);--c-mute:#c9bca6;--c-mute2:#a99b85;' +
      'color-scheme:dark}');
    // Dark "screen" surface (terminals, bot status) — same in both themes.
    R.push('.k-screen{' +
      '--c-bg:27 20 16;--c-panel:46 37 29;--c-panel2:46 37 29;--c-ink:255 250 240;' +
      '--c-red:255 122 122;--c-green:127 209 139;--c-gold:255 210 94;--c-info:159 216 255;--c-warn:255 210 94;--c-err:255 122 122;--c-purple:185 162 255;' +
      '--c-line:rgba(255,250,240,.16);--c-line2:rgba(255,250,240,.3);--c-mute:#c9bca6;--c-mute2:#a99b85;' +
      '--text:#fffaf0;--muted:#c9bca6;--muted-2:#a99b85;--paper:#2e251d;--paper-2:#2e251d;--field:#2e251d;--rule:#43362b;--cream:#1b1410;' +
      '--k-red:#ff7a7a;--k-green:#7fd18b;--k-gold:#ffd25e;--k-info:#9fd8ff;--k-purple:#b9a2ff;' +
      'background-color:#1b1410!important;color:#fffaf0}');
    R.push('[data-theme="dark"] .k-screen{background-color:#0b0806!important}');

    // ── page ground ──
    R.push('html{background-color:var(--cream)!important}');
    R.push('body{background-color:var(--cream)!important;background-image:none!important;color:var(--text)!important;font-family:' + MONO + '!important;-webkit-font-smoothing:antialiased}');
    R.push('*:not(.k-round),*::before,*::after{border-radius:0!important}');
    R.push('.k-round{border-radius:999px!important}');
    R.push('.hidden{display:none!important}');
    R.push('#kata-ambient-base,#kata-ambient-grain,#kata-ambient-pulse,.ambient,.grain,.bg-stack{display:none!important}');
    // Tavern nebula in light mode: screen-blend so the dark base vanishes into the cream
    // and only the glow / dust shows (a faded dark canvas would just grey the page).
    R.push('html[data-theme="light"] canvas#bg{opacity:1!important;mix-blend-mode:screen}');
    R.push('::selection{background:#b9a2ff;color:#1b1410}');
    R.push(':focus-visible{outline:3px solid #e04545!important;outline-offset:2px}');
    R.push('::-webkit-scrollbar{width:12px;height:12px}');
    R.push('::-webkit-scrollbar-track{background:var(--paper-2)}');
    R.push('::-webkit-scrollbar-thumb{background:var(--ink)!important;border:3px solid var(--paper-2)!important;border-radius:0!important}');
    R.push('::-webkit-scrollbar-thumb:hover{background:#e04545!important}');

    // ── type ──
    R.push(':where(.font-sans,.mono){font-family:' + MONO + '}');
    R.push('h1,h2,h3,.k-pf{font-family:' + PF + '!important;font-size-adjust:var(--k-fsa);font-weight:700!important;letter-spacing:0!important}');
    R.push('.k-sk,.tracking-kicker,.tracking-label,.tracking-tag,' +
      '[style*="letter-spacing:.1"],[style*="letter-spacing:.2"],[style*="letter-spacing:.3"],' +
      '[style*="letter-spacing:0.1"],[style*="letter-spacing:0.2"],[style*="letter-spacing:0.3"],' +
      '[style*="letter-spacing: 0.1"],[style*="letter-spacing: 0.2"],[style*="letter-spacing: 0.3"]' +
      '{font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);letter-spacing:.03em!important;font-weight:700}');
    R.push('.text-\\[8px\\],.text-\\[8\\.5px\\],.text-\\[9px\\],.text-\\[9\\.5px\\]{font-size:10px!important}');
    R.push('.glow77{text-shadow:none!important}');
    R.push('.dot-pulse{animation:k-blink 1.2s steps(1) infinite!important}');

    // ── legacy literal colours → B variables (both themes) ──
    var BG = {
      '#0d0a08': 'var(--cream)', '#0d0a09': 'var(--cream)', '#08050a': 'var(--cream)',
      '#15110d': 'var(--paper)', '#131010': 'var(--paper)', '#13100f': 'var(--paper)', '#100d0c': 'var(--paper)', '#0b0908': 'var(--paper)',
      '#1c1813': 'var(--paper-2)', '#1c1614': 'var(--paper-2)', '#1a1312': 'var(--paper-2)', '#1a1513': 'var(--paper-2)',
      '#16120f': 'var(--paper-2)', '#0a0807': 'var(--paper-2)', '#15100f': 'var(--paper-2)', '#1d1817': 'var(--paper-2)',
      '#0e0b0a': 'var(--field)',
    };
    Object.keys(BG).forEach(function (h) {
      R.push('[style*="background:' + h + '" i],[style*="background-color:' + h + '" i]{background-color:' + BG[h] + '!important;background-image:none!important}');
    });
    ['13,10,8', '21,17,13', '8,5,10'].forEach(function (rgb) {
      R.push('[style*="background:rgba(' + rgb + '," i]{background-color:var(--paper)!important;background-image:none!important}');
    });
    R.push('[style*="background:rgba(245,237,224,0.0" i],[style*="background:rgba(245,237,224,0.1" i],[style*="background:rgba(255,255,255,0.0" i],[style*="background:rgba(255,255,255,0.1" i]{background-color:var(--paper-2)!important}');
    var TX = {
      '#f5ede0': 'var(--text)', '#f3ede6': 'var(--text)', '#ece6df': 'var(--text)', '#ddd6cf': 'var(--text)', '#f5e8e8': 'var(--text)', '#cfc7bf': 'var(--text)',
      '#b9b0a8': 'var(--muted)', '#8a7f78': 'var(--muted)', '#6b6058': 'var(--muted)', '#6b5f58': 'var(--muted)', '#57504b': 'var(--muted)',
      '#7a7068': 'var(--muted)', '#4a423d': 'var(--muted)', '#3a322e': 'var(--muted)', '#6b6258': 'var(--muted)',
      '#D4A858': 'var(--k-gold)', '#c9a653': 'var(--k-gold)', '#5BA868': 'var(--k-green)', '#E04545': 'var(--k-red)', '#c46868': 'var(--k-red)',
      '#7a9eb5': 'var(--k-info)', '#8a4fff': 'var(--k-purple)', '#a87aff': 'var(--k-purple)',
    };
    // Match `color:` only as its own declaration (not inside background-color / border-color).
    Object.keys(TX).forEach(function (h) {
      R.push('[style^="color:' + h + '" i],[style*=";color:' + h + '" i],[style*="; color:' + h + '" i]{color:' + TX[h] + '!important}');
    });
    R.push('[style^="color:rgba(245,237,224" i],[style*=";color:rgba(245,237,224" i]{color:var(--muted)!important}');
    R.push('[style^="color:rgba(245,237,224,0.9" i],[style*=";color:rgba(245,237,224,0.9" i],[style^="color:rgba(245,237,224,0.8" i],[style*=";color:rgba(245,237,224,0.8" i]{color:var(--text)!important}');
    ['#2c2522', '#272120', '#1d1817', '#332a26', '#1f1a18', '#3a302c', '#2a2422', '#2c2421', '#4a3a2a', '#2c5a44', '#5a342c'].forEach(function (h) {
      R.push('[style*="solid ' + h + '" i],[style*="border-color:' + h + '" i]{border-color:var(--c-line)!important}');
    });
    R.push('[style*="solid rgba(255,255,255," i],[style*="border-color:rgba(255,255,255," i]{border-color:var(--c-line)!important}');
    // Tinted status pills / notes → solid arcade fills with ink text.
    var PILL = {
      '#ff7a7a': ['#E0454518', '#E0454522', '#E0454514', '#c4686818', '#c4686810', 'rgba(224,69,69,0.1', 'rgba(224,69,69,0.05'],
      '#ffd25e': ['#D4A85818', '#D4A85822', '#c9a65318'],
      '#9fd8ff': ['#7a9eb518'],
      '#7fd18b': ['#5BA86818', 'rgba(91,168,104,0.1'],
    };
    Object.keys(PILL).forEach(function (fill) {
      var sel = PILL[fill].map(function (h) { return '[style*="background:' + h + '" i]'; }).join(',');
      R.push(sel + '{background:' + fill + '!important;color:#1b1410!important;border:2px solid var(--ink)!important}');
    });

    // ── header (HUD) ──
    R.push('body>header.fixed,header.kata-nav{height:72px!important;background:var(--paper)!important;border:0!important;border-bottom:4px solid var(--ink)!important;' +
      'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;color:var(--text)!important;padding-left:28px!important;padding-right:28px!important}');
    R.push('body>header.fixed::after,header.kata-nav::after{content:"";position:absolute;left:0;right:0;top:100%;height:6px;background:var(--ka);border-bottom:3px solid var(--ink);pointer-events:none}');
    R.push('body>header.fixed>div:first-child{gap:22px!important;min-width:0}');
    R.push('.k-logo{display:flex!important;flex-direction:column;align-items:flex-start;gap:5px;color:var(--text)!important;text-decoration:none!important;flex-shrink:0;line-height:1}');
    R.push('.k-logo .k-word{font-family:' + PF + ';font-size-adjust:var(--k-fsa);font-size:30px;font-weight:700;line-height:1;white-space:nowrap;color:var(--text)}');
    R.push('.k-logo .k-77{color:#e04545;text-shadow:3px 3px 0 var(--ink)}');
    R.push('.k-logo .k-sfx{color:var(--muted);font-size:20px;margin-left:8px}');
    R.push('.k-logo .k-sub{font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--muted);white-space:nowrap;text-transform:uppercase}');
    R.push('.k-lobby{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;flex-shrink:0;font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;white-space:nowrap;' +
      'color:var(--text)!important;background:var(--paper);text-decoration:none!important;box-shadow:' + SB + ';transition:transform 60ms,box-shadow 60ms}');
    R.push('.k-lobby:hover{transform:translate(-1px,-1px)}');
    R.push('.k-lobby:active{transform:translate(4px,5px);box-shadow:' + SB_DOWN + '}');
    R.push('.k-bc{font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important;gap:8px!important;margin-left:0!important}');
    R.push('.k-bc a{color:var(--muted)!important;text-decoration:none}.k-bc a:hover{color:var(--text)!important;text-decoration:underline}');
    R.push('.k-live{display:inline-flex!important;align-items:center;gap:8px!important;height:30px;padding:0 10px;margin-left:0!important;flex-shrink:0;background:#7fd18b!important;color:#1b1410!important;box-shadow:' + RING3 + ';font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important}');
    R.push('.k-live>span:first-child{width:8px!important;height:8px!important;background:#1b1410!important;box-shadow:none!important}');

    // ── header actions (built below) ──
    R.push('#kata-header-actions{display:flex;align-items:center;gap:14px!important}');
    R.push('#kata-header-actions>*{transform:none!important}');
    R.push('.k-hbtn{position:relative;display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 11px;border:0!important;background:var(--paper)!important;color:var(--text)!important;' +
      'font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important;font-weight:700;letter-spacing:.03em!important;text-transform:uppercase;cursor:pointer;box-shadow:' + RING3 + ';' +
      'text-decoration:none!important;white-space:nowrap;transition:background 80ms steps(2)}');
    R.push('.k-hbtn:hover{background:var(--paper-2)!important}');
    R.push('.k-lang{padding:0!important;gap:0!important}');
    R.push('.k-lang .k-seg{display:grid;place-items:center;height:100%;padding:0 10px;color:var(--text)}');
    R.push('.k-lang .k-seg.on{background:var(--ink);color:var(--paper)}');
    R.push('[data-theme="dark"] .k-lang .k-seg.on{background:var(--strip-text);color:#1b1410}');
    R.push('.k-mode svg,.k-hbtn svg{display:block;flex:none}');
    R.push('.k-hl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}');
    R.push('.k-sw{display:inline-block;width:14px;height:14px;flex:none;box-shadow:0 0 0 2px var(--ink)}');
    R.push('.k-caret{font-size:9px;color:var(--muted)}');
    R.push('.k-user{padding:0 12px 0 5px!important}');
    R.push('.k-user>img,.k-user>span:first-child{width:28px!important;height:28px!important;flex:none;object-fit:cover;display:grid!important;place-items:center;' +
      'background:#ff7a7a!important;color:#1b1410!important;font-family:' + PF + '!important;font-size-adjust:var(--k-fsa);font-size:15px!important;font-weight:700;border:0!important;box-shadow:0 0 0 2px var(--ink)!important}');
    R.push('.k-user>span:nth-child(2){max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;font-family:' + MONO + ';font-size:12px}');
    R.push('.k-user>span:nth-child(3){color:var(--muted)!important}');

    // ── menus (palette, account) ──
    R.push('.k-menu{position:absolute;right:0;top:calc(100% + 14px);z-index:120;min-width:210px;max-width:80vw;padding:8px;background:var(--paper);color:var(--text);box-shadow:' + PX + ';' +
      'font-family:' + MONO + ';text-transform:none;letter-spacing:0;cursor:default;text-align:left;white-space:normal}');
    R.push('.k-menu-row{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:0 10px;border:0;background:transparent;color:var(--text);' +
      'font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;cursor:pointer;text-align:left}');
    R.push('.k-menu-row:hover{background:var(--paper-2)}');
    R.push('.k-menu-row.on{background:var(--ink);color:var(--paper)}');
    R.push('[data-theme="dark"] .k-menu-row.on{background:var(--strip-text);color:#1b1410}');
    R.push('.k-menu-row .k-cur{margin-left:auto;width:9px;height:15px;flex:none;background:var(--ka);clip-path:' + STEP + ';visibility:hidden}');
    R.push('.k-menu-row.on .k-cur{visibility:visible}');
    R.push('.k-menu-foot{margin-top:6px;padding:9px 10px 3px;border-top:3px dashed var(--rule);font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase}');
    R.push('.k-menu-kicker{font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:2px 2px 8px}');
    R.push('.k-menu-name{font-size:14px;font-weight:700;color:var(--text);margin:0 2px}');
    R.push('.k-menu-mail{font-size:11px;color:var(--muted);margin:4px 2px 0;word-break:break-all}');

    // ── SELECT STAGE side menu ──
    R.push('body>aside.fixed{top:calc(var(--kh) + 30px)!important;left:28px!important;bottom:28px!important;width:244px!important;background:var(--paper)!important;' +
      'border:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:' + PX + '!important;overflow-y:auto;overflow-x:hidden;color:var(--text);z-index:40}');
    R.push('body>aside.fixed::before{content:"SELECT STAGE";content:"SELECT STAGE"/"";display:flex;align-items:center;position:sticky;top:0;z-index:3;flex:none;height:34px;padding:0 14px;' +
      'background:var(--strip);color:var(--strip-text);font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.06em}');
    R.push('body>aside.fixed>div:first-child{border-bottom:3px dashed var(--rule)!important;border-top:0!important}');
    R.push('body>aside.fixed>div:last-child:not(:first-child){border-top:3px dashed var(--rule)!important;margin-top:8px;padding-top:12px!important}');
    R.push('body>aside.fixed nav{display:flex!important;flex-direction:column!important;gap:6px!important;padding:14px 14px 12px!important;min-height:0!important}');
    var NAVI = '.navrow,.navitem,body>aside nav a[data-tab]';
    R.push(NAVI + '{position:relative;display:flex!important;align-items:center!important;gap:10px!important;min-height:42px;margin:0!important;padding:0 12px!important;' +
      'border:0!important;background:transparent!important;color:var(--text)!important;box-shadow:none!important;font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:12px!important;font-weight:700!important;' +
      'letter-spacing:.03em!important;line-height:1.3!important;text-transform:uppercase;text-decoration:none!important;cursor:pointer;transform:none!important;transition:background 80ms steps(2)!important;padding-top:8px!important;padding-bottom:8px!important}');
    R.push(NAVI.split(',').map(function (x) { return x + '::before'; }).join(',') + '{content:"";flex:none;width:9px;height:15px;background:var(--ka);clip-path:' + STEP + ';visibility:hidden}');
    R.push(NAVI.split(',').map(function (x) { return x + ':hover'; }).join(',') + '{background:var(--cream)!important}');
    var NAVON = '.navrow.on,.navitem.on,body>aside nav a[data-tab].tab-active,body>aside nav a[data-tab].on';
    R.push(NAVON + '{background:var(--strip)!important;color:var(--strip-text)!important}');
    R.push(NAVON.split(',').map(function (x) { return x + '::before'; }).join(',') + '{visibility:visible}');
    R.push(NAVON.split(',').map(function (x) { return x + ' *'; }).join(',') + '{color:#c9bca6!important;background:transparent!important;border-color:transparent!important}');
    R.push(NAVON.split(',').map(function (x) { return x + '>span:first-child'; }).join(',') + '{color:var(--ka)!important}');
    R.push('.navrow>span:first-child,.navitem>span:first-child{color:var(--muted)}');
    R.push('.navrow .flex-1,.navitem .flex-1,.navitem>span[style*="flex:1"]{min-width:0}');
    R.push('.navrow>span:last-child:not(.flex-1),.navitem>span:last-child:not(.flex-1){flex:none}');
    R.push('#kata-guild-icon{width:64px!important;height:64px!important;background:var(--ka)!important;color:#1b1410!important;border:0!important;box-shadow:' + RING3 + '!important;font-family:' + PF + '!important;font-size-adjust:var(--k-fsa);font-size:24px!important;overflow:hidden}');
    R.push('#kata-guild-icon img{width:64px!important;height:64px!important}');
    R.push('#kata-guild-name{font-family:' + MONO + '!important;font-size:14px!important}');

    // ── main column offsets for the fixed chrome ──
    R.push('body>main[class*="pl-["]{padding-left:308px!important;padding-right:44px!important}');
    R.push('body>main.pt-20{padding-top:calc(var(--kh) + 40px)!important}');
    R.push('body>main[style*="padding-top:58px"]{padding-top:var(--kh)!important}');
    R.push('#toast{top:calc(var(--kh) + 18px)!important}');

    // ── generic content: panels, cards, inputs, buttons ──
    var PANEL = 'main .border.rounded-\\[12px\\],main .border.rounded-\\[13px\\],main .border.rounded-\\[14px\\],main .border.rounded-\\[16px\\]';
    R.push(PANEL + '{border:0!important;background-color:var(--paper)!important;background-image:none!important;box-shadow:' + PX + '!important}');
    R.push('main a.border.rounded-\\[14px\\],main article.rounded-\\[14px\\],main .mem-card{box-shadow:' + PXD + '!important}');
    R.push('main .grid.gap-3{gap:24px!important}');
    R.push('main .space-y-2>:not([hidden])~:not([hidden]),main .space-y-2\\.5>:not([hidden])~:not([hidden]){margin-top:22px!important}');
    var FIELD = 'main input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),main textarea,main select,.k-field';
    R.push(FIELD + '{background-color:var(--field)!important;color:var(--text)!important;border:0!important;box-shadow:' + RING3 + '!important;outline:none!important;font-family:' + MONO + '}');
    R.push(FIELD.split(',').map(function (x) { return x + ':focus'; }).join(',') + '{background-color:var(--paper)!important;box-shadow:' + RINGR + '!important}');
    R.push('input::placeholder,textarea::placeholder{color:var(--muted)!important;opacity:.8!important}');
    R.push('main input[class*="h-8"],main input[class*="h-9"]{height:40px!important}');
    R.push('main .flex.gap-2:has(>input,>button,>.relative>input){gap:14px!important}');
    var BTN = 'main :is(button,a)[class*="h-8"].border,main :is(button,a)[class*="h-9"].border,main :is(button,a)[class*="h-10"].border,.k-sbtn';
    R.push(BTN + '{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0!important;background:var(--paper)!important;color:var(--text)!important;' +
      'font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important;font-weight:700;letter-spacing:.03em!important;text-transform:uppercase;text-decoration:none!important;cursor:pointer;' +
      'box-shadow:' + SB + '!important;transition:transform 60ms,box-shadow 60ms}');
    R.push(BTN.split(',').map(function (x) { return x + ':hover'; }).join(',') + '{transform:translate(-1px,-1px)}');
    R.push(BTN.split(',').map(function (x) { return x + ':active'; }).join(',') + '{transform:translate(4px,5px);box-shadow:' + SB_DOWN + '!important}');
    R.push('main button[class*="h-8"],main button[class*="h-9"],main a[class*="h-9"].border{height:40px!important}');
    // Primary actions (legacy red / accent / Discord-blurple fills) → kata purple, ink text.
    var PRI = ':is(button,a)[style*="background:#E04545" i],:is(button,a)[style*="background:var(--accent" i],:is(button,a)[style*="background:#5865F2" i],.k-pri';
    R.push(PRI + '{background:var(--ka)!important;color:#1b1410!important;border:0!important;box-shadow:' + SB + '!important;font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);letter-spacing:.03em!important;' +
      'text-transform:uppercase;text-decoration:none!important;transition:transform 60ms,box-shadow 60ms}');
    R.push(PRI.split(',').map(function (x) { return x + ':hover'; }).join(',') + '{transform:translate(-1px,-1px)}');
    R.push(PRI.split(',').map(function (x) { return x + ':active'; }).join(',') + '{transform:translate(4px,5px);box-shadow:' + SB_DOWN + '!important}');
    // Inside a dark screen: cream input wells, flat terminal buttons.
    R.push('body .k-screen :is(input,textarea,select){background-color:#f3eee4!important;color:#1b1410!important;box-shadow:none!important}');
    R.push('body .k-screen :is(input,textarea,select):focus{background-color:#fffaf0!important;box-shadow:' + RINGR + '!important}');
    R.push('body .k-screen :is(input,textarea)::placeholder{color:#6f6356!important}');
    R.push('body .k-screen :is(button,a):is(.border,.k-sbtn){background:#2e251d!important;color:#fffaf0!important;box-shadow:none!important}');
    R.push('body .k-screen :is(button,a):is(.border,.k-sbtn):hover{background:#43362b!important}');
    R.push('body .k-screen :is(button,a):is(.border,.k-sbtn):active{transform:translate(2px,3px)}');
    R.push('body .k-screen .k-pri{background:var(--ka)!important;color:#1b1410!important;box-shadow:none!important}');
    R.push('main footer.grid{border-top:3px dashed var(--rule)!important;font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important}');
    R.push('.border-line\\/60{border-color:var(--rule)!important}');

    // ── k-* building blocks (pages use these directly) ──
    R.push('.k-px{box-shadow:' + PX + '}');
    R.push('.k-pxs{box-shadow:' + RING3 + '}');
    R.push('.k-pxd{box-shadow:' + PXD + '}');
    R.push('.k-pbtn{cursor:pointer;border:0;box-shadow:' + PB + ';transition:transform 60ms,box-shadow 60ms}');
    R.push('.k-pbtn:hover{transform:translate(-2px,-2px);box-shadow:' + PB_HOVER + '}');
    R.push('.k-pbtn:active{transform:translate(6px,8px);box-shadow:' + PB_DOWN + '}');
    R.push('.k-chip{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border:0!important;background:var(--paper)!important;color:var(--text)!important;' +
      'box-shadow:' + RING3 + '!important;font-family:' + SK + '!important;font-size-adjust:var(--k-fsa);font-size:11px!important;font-weight:700;letter-spacing:.03em!important;text-transform:uppercase;cursor:pointer;transform:none!important;transition:background 80ms steps(2)}');
    R.push('.k-chip:hover{background:var(--paper-2)!important}');
    R.push('.k-chip.on,.k-chip[aria-pressed="true"]{background:var(--ink)!important;color:var(--paper)!important}');
    R.push('[data-theme="dark"] .k-chip.on,[data-theme="dark"] .k-chip[aria-pressed="true"]{background:var(--strip-text)!important;color:#1b1410!important}');
    R.push('.k-tag{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;background:var(--strip);color:var(--strip-text);font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}');
    R.push('.k-badge{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:3px 7px;font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#1b1410;background:#ffd25e;box-shadow:' + RING3 + '}');
    R.push('.k-kicker{font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}');
    R.push('.k-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}');
    R.push('.k-kpi{padding:20px 24px 22px;min-width:0}');
    R.push('.k-kpi+.k-kpi{border-left:3px dashed var(--rule)}');
    R.push('.k-kpi-l{margin:0;font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--muted);text-transform:uppercase}');
    R.push('.k-kpi-v{display:flex;align-items:center;gap:10px;margin:12px 0 0;font-family:' + PF + ';font-size-adjust:var(--k-fsa);font-size:34px;font-weight:700;line-height:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}');
    R.push('.k-kpi-n{margin:8px 0 0;font-size:12px;color:var(--muted)}');
    R.push('.k-hp{height:18px;background:var(--paper);border:3px solid var(--ink);overflow:hidden}');
    R.push('.k-hp>span{display:block;height:100%;background:repeating-linear-gradient(90deg,var(--a,#b9a2ff) 0 10px,transparent 10px 12px);transition:width .4s steps(6)}');
    R.push('.k-say{position:relative;padding:40px 30px 34px;background:var(--paper);box-shadow:' + PX + '}');
    R.push('.k-say>.k-tag:first-child{position:absolute;left:18px;top:-18px}');
    R.push('.k-say .k-more{position:absolute;right:22px;bottom:16px;width:20px;height:14px;background:#e04545;clip-path:polygon(0 0,100% 0,100% 33%,80% 33%,80% 67%,60% 67%,60% 100%,40% 100%,40% 67%,20% 67%,20% 33%,0 33%)}');
    R.push('.k-cursor{display:inline-block;width:10px;height:18px;vertical-align:-3px;background:currentColor}');
    R.push('.k-prompt{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px}');
    R.push('.k-prompt b{color:#7fd18b}');
    R.push('.k-prompt i{font-style:normal;color:#c9bca6}');
    R.push('.k-bricks{height:44px;background-color:#c9733e;background-image:linear-gradient(#8e4a22 4px,transparent 4px),linear-gradient(90deg,#8e4a22 4px,transparent 4px);background-size:32px 24px;border-top:8px solid #5bbf6a;box-shadow:inset 0 4px 0 var(--ink)}');
    R.push('.k-blink{animation:k-blink 1s steps(1) infinite}');
    R.push('.k-bob{animation:k-bob 1s steps(2) infinite}');
    R.push('.k-rise{animation:k-rise .4s steps(4) backwards}');
    R.push('.k-coin{animation:k-coin .9s steps(4) infinite}');
    R.push('@keyframes k-blink{50%{opacity:0}}');
    R.push('@keyframes k-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}');
    R.push('@keyframes k-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}');
    R.push('@keyframes k-coin{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.15)}}');

    // ── dialogs + toasts ──
    R.push('.k-dlg-ov{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(27,20,16,.55);animation:kdFadeIn 120ms steps(3)}');
    R.push('[data-theme="dark"] .k-dlg-ov{background:rgba(0,0,0,.7)}');
    R.push('.k-dlg{position:relative;width:100%;min-width:300px;max-width:520px;padding:40px 26px 22px;background:var(--paper);color:var(--text);box-shadow:' + PX + ';font-family:' + MONO + ';animation:kdPop 160ms steps(4)}');
    R.push('.k-dlg>.k-tag{position:absolute;left:18px;top:-17px}');
    R.push('.k-dlg-msg{font-size:14px;line-height:1.6;color:var(--text);white-space:pre-wrap}');
    R.push('.k-dlg .k-field{display:block;width:100%;margin-top:16px;padding:11px 12px;font-size:14px;line-height:1.5}');
    R.push('.k-dlg-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:18px;margin-top:24px;padding:0 6px 6px 0}');
    R.push('.k-dlg-btn{height:40px;padding:0 16px}');
    R.push('.k-dlg-btn.k-danger{background:#ff7a7a!important}');
    R.push('.k-toast{position:fixed;bottom:24px;right:24px;z-index:1100;display:flex;align-items:center;gap:10px;max-width:min(420px,calc(100vw - 48px));padding:12px 16px;background:var(--paper);color:var(--text);' +
      'box-shadow:' + PXD + ';font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;animation:kdToastIn 160ms steps(4)}');
    R.push('.k-toast::before,.k-toast-i::before{content:"";flex:none;width:12px;height:12px;background:var(--tc,#b9a2ff);box-shadow:0 0 0 2px var(--ink)}');
    // page-local stacked toasts (#toast / #toast-wrap containers)
    R.push('.k-toast-i{display:flex;align-items:center;gap:10px;max-width:420px;margin:0 0 16px;padding:11px 14px;background:var(--paper);color:var(--text);box-shadow:' + PXD + ';' +
      'font-family:' + SK + ';font-size-adjust:var(--k-fsa);font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;pointer-events:auto;animation:kdToastIn 160ms steps(4)}');
    R.push('@keyframes kdFadeIn{from{opacity:0}to{opacity:1}}');
    R.push('@keyframes kdFadeOut{from{opacity:1}to{opacity:0}}');
    R.push('@keyframes kdPop{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}');
    R.push('@keyframes kdToastIn{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}');
    R.push('@keyframes kdToastOut{from{transform:none;opacity:1}to{transform:translateY(8px);opacity:0}}');

    // ── model picker ──
    R.push('.k-mp{position:absolute;z-index:1100;min-width:340px;padding:10px;background:var(--paper);color:var(--text);box-shadow:' + PX + ';font-family:' + MONO + '}');
    R.push('.k-mp-tabs{display:flex;flex-wrap:wrap;gap:10px;padding:3px 3px 12px;margin-bottom:10px;border-bottom:3px dashed var(--rule)}');
    R.push('.k-mp-tabs .k-chip{height:30px;padding:0 10px;font-size:10px!important}');
    R.push('.k-mp-list{max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-bottom:12px}');
    R.push('.k-mp-row{display:block;width:100%;padding:9px 10px;border:0;background:transparent;color:var(--text);font-family:' + MONO + ';font-size:12px;text-align:left;cursor:pointer}');
    R.push('.k-mp-row:hover{background:var(--paper-2)}');
    R.push('.k-mp-row.on{background:var(--ink);color:var(--paper)}');
    R.push('[data-theme="dark"] .k-mp-row.on{background:var(--strip-text);color:#1b1410}');
    R.push('.k-mp-row.k-mp-def{color:var(--muted);font-size:11px;border-bottom:3px dashed var(--rule);margin-bottom:4px}');
    R.push('.k-mp-row.k-mp-def.on{color:var(--paper)}');
    R.push('.k-mp-custom{display:flex;gap:14px;padding:3px 6px 6px 3px}');
    R.push('.k-mp-custom .k-field{flex:1;min-width:0;height:38px;padding:0 10px;font-size:12px}');
    R.push('.k-mp-custom .k-sbtn{height:38px;padding:0 14px}');

    // ── tablet: breadcrumb gives way first ──
    R.push('@media (max-width:1500px){.k-bc{display:none!important}}');
    R.push('@media (max-width:1180px){.k-logo .k-sub,.k-live{display:none!important}}');
    R.push('@media (max-width:980px){#kata-theme-btn .k-hbtn>span:nth-child(2){display:none!important}}');

    // ── phone ──
    R.push('@media (max-width:768px){' +
      ':root{--kh:73px}' +
      'body>header.fixed,header.kata-nav{height:64px!important;padding-left:12px!important;padding-right:12px!important;gap:10px}' +
      'body>header.fixed>div:first-child{gap:12px!important}' +
      '.k-logo .k-word{font-size:22px}.k-logo .k-sfx,.k-logo .k-sub{display:none!important}' +
      '.k-lobby{width:36px;padding:0;justify-content:center}.k-lobby .k-lobby-t{display:none}' +
      '.k-bc,.k-live{display:none!important}' +
      '#kata-header-actions{gap:10px!important}' +
      '.k-hbtn{height:34px;padding:0 8px}.k-lang .k-seg{padding:0 7px}' +
      '.k-mode .k-hl,#kata-theme-btn .k-hbtn>span:nth-child(2),#kata-user-name,.k-user>span:nth-child(2),.k-user>span:nth-child(3){display:none!important}' +
      '.k-user{padding:0 3px!important}' +
      'body>aside.fixed:not(.k-drawer){top:var(--kh)!important;left:0!important;right:0!important;bottom:auto!important;width:auto!important;height:auto!important;display:flex!important;flex-direction:row!important;' +
      'overflow-x:auto!important;overflow-y:hidden!important;box-shadow:none!important;border-bottom:3px solid var(--ink)!important;background:var(--paper)!important}' +
      'body>aside.fixed:not(.k-drawer)::before,body>aside.fixed:not(.k-drawer)>div{display:none!important}' +
      'body>aside.fixed:not(.k-drawer) nav{flex-direction:row!important;gap:12px!important;padding:12px 14px!important}' +
      'body>aside.fixed:not(.k-drawer) :is(.navrow,.navitem,nav a[data-tab]){flex:0 0 auto;min-height:36px;padding:0 12px!important;background:var(--paper)!important;box-shadow:' + RING3 + '!important;font-size:11px!important}' +
      'body>aside.fixed:not(.k-drawer) :is(.navrow,.navitem,nav a[data-tab])::before{display:none}' +
      'body>aside.fixed:not(.k-drawer) :is(.navrow.on,.navitem.on,nav a[data-tab].tab-active,nav a[data-tab].on){background:var(--strip)!important}' +
      'body>aside.fixed:not(.k-drawer) nav>div{display:none!important}' +
      'body>main[class*="pl-["]{padding-left:16px!important;padding-right:16px!important}' +
      'body:has(>aside.fixed:not(.k-drawer))>main[class*="pl-["]{padding-top:calc(var(--kh) + 86px)!important}' +
      'body>main.pt-20:not([class*="pl-["]){padding-top:calc(var(--kh) + 26px)!important}' +
      'body>main[class*="px-8"]{padding-left:16px!important;padding-right:16px!important}' +
      'main h1:not([data-text]){font-size:30px!important}' +
      '.k-kpis{grid-template-columns:minmax(0,1fr)}.k-kpi+.k-kpi{border-left:0;border-top:3px dashed var(--rule)}' +
      '.k-menu{position:fixed;left:12px;right:12px;top:calc(var(--kh) + 10px);min-width:0}' +
      '.k-toast{left:16px;right:16px;bottom:16px}' +
      '}');
    R.push('@media (min-width:769px) and (max-width:1100px){.k-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.k-kpi:nth-child(3){border-left:0}.k-kpi:nth-child(n+3){border-top:3px dashed var(--rule)}}');

    // ── motion off ──
    R.push('.still *,.still *::before,.still *::after{animation:none!important;transition:none!important}');
    R.push('@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}');
    return R.join('\n');
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
  }
  function rerenderThemeButton() {
    var existing = document.getElementById('kata-theme-btn');
    if (!existing || !existing.parentElement) return;
    existing.parentElement.replaceChild(buildThemeButton(), existing);
  }

  var SUN_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><rect x="8" y="8" width="8" height="8"></rect><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"></path></svg>';
  var MOON_SVG = '<svg width="18" height="18" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path d="M3 0h3v1H4v1H3v3h1v1h3v1H6v1H3V7H2V6H1V2h1V1h1z" fill="currentColor"></path></svg>';

  // Light / dark toggle — square pixel button with a sun / moon sprite.
  function buildModeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kata-mode-btn';
    btn.className = 'k-hbtn k-mode';
    btn.title = 'Light / dark';
    btn.setAttribute('aria-label', 'Light or dark mode');
    btn.setAttribute('aria-pressed', state.mode === 'dark' ? 'true' : 'false');
    btn.innerHTML = (state.mode === 'light' ? SUN_SVG : MOON_SVG) +
      '<span class="k-hl">' + (state.mode === 'light' ? 'light' : 'dark') + '</span>';
    btn.addEventListener('click', function () {
      setMode(state.mode === 'light' ? 'dark' : 'light');
    });
    return btn;
  }

  // Language — one button, two segments; the active one is inked.
  function buildLangButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kata-lang-btn';
    btn.className = 'k-hbtn k-lang';
    btn.setAttribute('aria-label', 'Language: ' + (state.lang === 'en' ? 'English' : 'Tiếng Việt'));
    var en = document.createElement('span');
    en.className = 'k-seg' + (state.lang === 'en' ? ' on' : '');
    en.textContent = 'EN';
    var vi = document.createElement('span');
    vi.className = 'k-seg' + (state.lang === 'vi' ? ' on' : '');
    vi.textContent = 'VI';
    btn.appendChild(en);
    btn.appendChild(vi);
    btn.addEventListener('click', function () {
      setLang(state.lang === 'vi' ? 'en' : 'vi');
    });
    return btn;
  }

  function swatchBg(idx) {
    return idx == null ? 'conic-gradient(#E04545,#5BA868,#D4A858,#E04545)' : TRACKS[idx].palette[0];
  }

  function buildThemeButton() {
    var wrap = document.createElement('div');
    wrap.id = 'kata-theme-btn';
    wrap.style.position = 'relative';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'k-hbtn k-pal';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Colour palette');

    var dot = document.createElement('span');
    dot.className = 'k-sw';
    dot.style.background = swatchBg(state.lockIdx);
    var label = document.createElement('span');
    label.textContent = state.lockIdx == null ? t('theme.auto') : t(TRACKS[state.lockIdx].i18n);
    var caret = document.createElement('span');
    caret.className = 'k-caret';
    caret.textContent = '▼';
    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(caret);
    wrap.appendChild(btn);

    var menu = null;
    function closeMenu() {
      if (menu && menu.parentElement) menu.parentElement.removeChild(menu);
      menu = null;
      btn.setAttribute('aria-expanded', 'false');
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
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { document.addEventListener('click', onOutside, true); }, 0);
    });

    return wrap;
  }

  function buildThemeMenu() {
    var box = document.createElement('div');
    box.className = 'k-menu';
    box.setAttribute('role', 'menu');

    var options = [{ idx: null, i18n: 'theme.auto' }].concat(
      TRACKS.map(function (track, i) {
        return { idx: i, i18n: track.i18n };
      }),
    );
    options.forEach(function (opt) {
      var row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', state.lockIdx === opt.idx ? 'true' : 'false');
      row.className = 'k-menu-row' + (state.lockIdx === opt.idx ? ' on' : '');

      var sw = document.createElement('span');
      sw.className = 'k-sw';
      sw.style.background = swatchBg(opt.idx);
      var lbl = document.createElement('span');
      lbl.textContent = t(opt.i18n);
      var cur = document.createElement('span');
      cur.className = 'k-cur';
      cur.setAttribute('aria-hidden', 'true');

      row.appendChild(sw);
      row.appendChild(lbl);
      row.appendChild(cur);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        setLockIdx(opt.idx);
        if (box.parentElement) box.parentElement.removeChild(box);
      });
      box.appendChild(row);
    });

    var sub = document.createElement('div');
    sub.className = 'k-menu-foot';
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
    a.className = 'k-hbtn k-user';
    a.style.position = 'relative';
    a.style.cursor = 'pointer';

    var initialBubble = document.createElement('span');
    initialBubble.textContent = '?';
    initialBubble.setAttribute('aria-hidden', 'true');
    var name = document.createElement('span');
    name.id = 'kata-user-name';
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
    box.className = 'k-menu';
    box.style.padding = '14px';
    box.style.minWidth = '230px';

    var kicker = document.createElement('div');
    kicker.className = 'k-menu-kicker';
    kicker.textContent = (vi ? 'Đã đăng nhập' : 'Signed in') + (u.provider ? ' · ' + String(u.provider).toUpperCase() : '');
    box.appendChild(kicker);

    var nm = document.createElement('div');
    nm.className = 'k-menu-name';
    nm.textContent = u.displayName || u.username || '—';
    box.appendChild(nm);

    if (u.email) {
      var em = document.createElement('div');
      em.className = 'k-menu-mail';
      em.textContent = u.email;
      box.appendChild(em);
    }

    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'k-sbtn';
    out.textContent = '↩ ' + (vi ? 'Đăng xuất' : 'Sign out');
    out.style.cssText = 'margin:16px 5px 5px 3px;width:calc(100% - 8px);height:38px;justify-content:flex-start;padding:0 12px';
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
    // A page may have re-rendered the chip itself; then it already shows the name.
    var name = document.getElementById('kata-user-name') || a.querySelector('#kata-user-name');
    var label = user.displayName || user.username || '—';
    if (name) name.textContent = label;
    if (user.avatarUrl) {
      var img = document.createElement('img');
      img.src = user.avatarUrl;
      img.alt = '';
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
     *     byProvider: { openrouter: ['openrouter:google/gemini-2.5-flash'], fal: ['fal:google/gemini-3.5-flash'], ... },
     *     placeholder: 'fal:google/gemini-3.1-pro-preview',
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
    const currentValue = (hiddenInput && hiddenInput.value) || '';

    let activeProvider = providers[0];
    for (const p of providers) {
      if ((byProvider[p] || []).includes(currentValue)) { activeProvider = p; break; }
    }

    const pop = document.createElement('div');
    pop.className = 'k-mp';

    const r = triggerBtn.getBoundingClientRect();
    pop.style.left = (r.left + window.scrollX) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 12) + 'px';
    pop.style.width = Math.min(Math.max(r.width, 340), window.innerWidth - 24) + 'px';

    function render() {
      pop.innerHTML = '';
      const tabs = document.createElement('div');
      tabs.className = 'k-mp-tabs';
      for (const p of providers) {
        const tb = document.createElement('button');
        tb.type = 'button';
        tb.textContent = p;
        tb.className = 'k-chip' + (p === activeProvider ? ' on' : '');
        tb.setAttribute('aria-pressed', p === activeProvider ? 'true' : 'false');
        tb.addEventListener('click', () => { activeProvider = p; render(); });
        tabs.appendChild(tb);
      }
      pop.appendChild(tabs);

      const list = byProvider[activeProvider] || [];
      const wrap = document.createElement('div');
      wrap.className = 'k-mp-list';

      const def = document.createElement('button');
      def.type = 'button';
      def.textContent = `(use default · ${placeholder || '—'})`;
      def.className = 'k-mp-row k-mp-def' + (!currentValue ? ' on' : '');
      def.addEventListener('click', () => apply(''));
      wrap.appendChild(def);

      for (const m of list) {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = m.includes(':') ? m.split(':').slice(1).join(':') : m;
        row.className = 'k-mp-row' + (m === currentValue ? ' on' : '');
        row.addEventListener('click', () => apply(m));
        wrap.appendChild(row);
      }
      pop.appendChild(wrap);

      const custom = document.createElement('div');
      custom.className = 'k-mp-custom';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'k-field';
      inp.setAttribute('aria-label', 'custom model id');
      inp.placeholder = 'custom model id (vd: 9router:kr/...)';
      const setBtn = document.createElement('button');
      setBtn.type = 'button'; setBtn.textContent = 'use';
      setBtn.className = 'k-sbtn k-pri';
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

  // ── Dialog implementation (vanilla, no deps) ──────────────────
  // An RPG dialog box: paper panel + ink name plate on its top edge, pixel
  // buttons. Returns a promise:
  //   alert   → resolves null (always)
  //   confirm → resolves true (ok) | false (cancel)
  //   prompt  → resolves string | null (cancel)
  //   custom  → resolves whatever the caller's resolver returned

  function openDialog(opts) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.setAttribute('data-kata-dialog', '');
      overlay.className = 'k-dlg-ov';

      var panel = document.createElement('div');
      panel.className = 'k-dlg';
      panel.setAttribute('role', opts.kind === 'alert' ? 'alertdialog' : 'dialog');
      panel.setAttribute('aria-modal', 'true');

      var titleLabel = opts.title || (
        opts.kind === 'confirm' ? 'Xác nhận' :
        opts.kind === 'prompt'  ? 'Nhập' :
        'Thông báo'
      );
      var kicker = document.createElement('div');
      kicker.className = 'k-tag';
      kicker.textContent = titleLabel;
      panel.appendChild(kicker);
      panel.setAttribute('aria-label', titleLabel);

      var msg = document.createElement('div');
      msg.className = 'k-dlg-msg';
      msg.textContent = opts.message || '';
      panel.appendChild(msg);

      var input = null;
      if (opts.kind === 'prompt') {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'k-field';
        input.value = opts.defaultValue || '';
        input.placeholder = opts.placeholder || '';
        input.setAttribute('aria-label', titleLabel);
        panel.appendChild(input);
      } else if (opts.kind === 'longprompt') {
        input = document.createElement('textarea');
        input.className = 'k-field';
        input.value = opts.defaultValue || '';
        input.placeholder = opts.placeholder || '';
        input.rows = opts.rows || 4;
        input.style.resize = 'vertical';
        input.setAttribute('aria-label', titleLabel);
        panel.appendChild(input);
      }

      var actions = document.createElement('div');
      actions.className = 'k-dlg-actions';

      function btn(label, primary, danger) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = 'k-sbtn k-dlg-btn' + (primary ? ' k-pri' : '') + (danger ? ' k-danger' : '');
        return b;
      }

      function close(result) {
        if (closed) return;
        closed = true;
        overlay.style.animation = 'kdFadeOut 120ms steps(3) forwards';
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
      if (input) setTimeout(function () { input.focus(); input.select && input.select(); }, 30);
      else setTimeout(function () { var f = actions.lastChild; if (f && f.focus) f.focus(); }, 30);
    });
  }

  // Toast (fire-and-forget). Replaces in-line `flash()` helpers.
  function showToast(message, opts) {
    opts = opts || {};
    var color = opts.kind === 'error' ? '#ff7a7a' : opts.kind === 'success' ? '#7fd18b' : '#b9a2ff';
    var el = document.createElement('div');
    el.className = 'k-toast';
    el.setAttribute('role', 'status');
    el.style.setProperty('--tc', color);
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.animation = 'kdToastOut 180ms steps(3) forwards';
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
      '  header > div:first-child > a:not([href="/"]) { display: none !important; }',
      '  .kata-nav-toggle { display: inline-grid; place-items: center; width: 36px; height: 36px; border: 0; background: var(--paper); color: var(--text); cursor: pointer; flex: 0 0 auto; box-shadow: 0 -3px 0 0 var(--ink),0 3px 0 0 var(--ink),-3px 0 0 0 var(--ink),3px 0 0 0 var(--ink); }',
      '  aside.kata-drawer { transform: translateX(-110%); transition: transform 200ms steps(5); width: 280px; max-width: 86vw; }',
      '  body.kata-nav-open aside.kata-drawer { transform: none; }',
      '  #kata-nav-scrim { position: fixed; inset: 0; z-index: 39; background: rgba(27,20,16,0.55); }',
      '  body.kata-nav-open #kata-nav-scrim { display: block; }',
      '  main .grid { grid-template-columns: 1fr !important; }',
      '}',
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'kata-mobile-css';
    st.textContent = css;
    document.head.appendChild(st);

    // Turn the fixed sidebar into an off-canvas drawer with a hamburger.
    var header = document.querySelector('header');
    var aside = document.querySelector('aside');
    if (aside && header) {
      aside.classList.add('kata-drawer', 'k-drawer');
      var btn = document.createElement('button');
      btn.id = 'kata-nav-toggle-btn';
      btn.className = 'kata-nav-toggle';
      btn.setAttribute('aria-label', 'menu');
      btn.innerHTML = '<svg width="16" height="14" viewBox="0 0 16 14" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h16v3H0zM0 5.5h16v3H0zM0 11h10v3H0z" fill="currentColor"/></svg>';
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
    ensureFonts();
    injectSkin();
    applyMode();
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
