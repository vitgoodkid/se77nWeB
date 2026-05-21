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

  // ── State ───────────────────────────────────────────────────────
  var state = {
    lockIdx: readLockIdx(),     // null | 0..5
    rotIdx: 0,                   // current rotation slot when AUTO
    rotTimer: null,
    lang: readLang(),            // 'vi' | 'en'
  };

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
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var root = document.documentElement;
    root.style.setProperty('--ambient-r', String(r));
    root.style.setProperty('--ambient-g', String(g));
    root.style.setProperty('--ambient-b', String(b));
    root.style.setProperty('--accent', hex);
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
      ':root { --accent: #E04545; --ambient-r: 224; --ambient-g: 69; --ambient-b: 69; }',
      // Solid red usages
      '.text-red { color: var(--accent) !important; }',
      '.bg-red { background-color: var(--accent) !important; }',
      '.border-red { border-color: var(--accent) !important; }',
      '.fill-red { fill: var(--accent) !important; }',
      '.stroke-red { stroke: var(--accent) !important; }',
      // Glow used on logo and accent dots
      '.glow77 { text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 80%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 36px color-mix(in srgb, var(--accent) 20%, transparent); }',
      // Some pages use bg-red/N pattern via inline styles with hex; nothing
      // we can do for those without HTML edits — but the accent vars are
      // exposed so page-level scripts can read them where needed.
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Header chrome ───────────────────────────────────────────────
  // Renders into <div id="kata-header-actions"></div>. Idempotent —
  // safe to call multiple times.
  function rerenderHeader() {
    var slot = document.getElementById('kata-header-actions');
    if (!slot) return;
    slot.innerHTML = '';
    slot.appendChild(buildLangButton());
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

    var initialBubble = document.createElement('span');
    initialBubble.className = 'w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-extrabold';
    initialBubble.style.background = 'rgba(224,69,69,0.13)';
    initialBubble.style.color = 'var(--accent)';
    initialBubble.textContent = '?';
    var name = document.createElement('span');
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
    return a;
  }
  function hydrateChip(a, data) {
    var user = data && data.user;
    if (!user) return;
    a.removeAttribute('href');
    a.style.cursor = 'default';
    var bubble = a.firstChild;
    var name = a.lastChild;
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
    }
  });

  // ── Public API ──────────────────────────────────────────────────
  window.KataShell = {
    t: t,
    applyI18n: applyI18n,
    getLang: function () { return state.lang; },
    setLang: setLang,
    getLockIdx: function () { return state.lockIdx; },
    setLockIdx: setLockIdx,
    getAccent: function () { return TRACKS[activeIdx()].palette[0]; },
  };

  // ── Boot ────────────────────────────────────────────────────────
  function boot() {
    injectAccentOverlay();
    paint();
    if (state.lockIdx == null) startRotation();
    rerenderHeader();
    applyI18n();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
