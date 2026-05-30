/* global React, ReactDOM, Engine, Board, THEMES,
   useTweaks, TweaksPanel, TweakSection, TweakSelect, TweakSlider, TweakToggle, TweakButton */
const { useState, useRef, useReducer, useEffect, useLayoutEffect, useCallback } = React;
const { cellOf, STEP_DONE, HOME_DOOR_STEP, CENTER, FACTIONS, FACTION_ORDER, START_IDX, RING, RING_LEN } = Engine;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIPS = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };

function Die({ value, rolling }) {
  const on = new Set(PIPS[value] || []);
  return React.createElement('div', { className: 'die' + (rolling ? ' rolling' : '') },
    Array.from({ length: 9 }, (_, i) =>
      React.createElement('div', { key: i, className: 'pip' + (on.has(i) ? ' on' : '') })));
}

// ---------- HUD player cards (4 corners) ----------
function HUD({ state, mode, onHover, mySeat, seatMeta }) {
  const order = ['tl', 'tr', 'br', 'bl'];
  return state.seats.map((st, p) => {
    const homeCount = state.horses[p].filter(h => h.step >= STEP_DONE).length;
    const active = state.turn === p && state.winner == null;
    const you = mySeat != null ? p === mySeat : (mode === 'hotseat' ? false : p === 0);
    const stt = state.status[p];
    const cls = ['pcard']; cls.push(active ? 'active' : 'dimmed');
    const debuffs = [];
    if (stt.skip > 0) debuffs.push('⏭️');
    if (stt.curse > 0) debuffs.push('⛓️');
    // online: derive role + name from the room's seat metadata
    const sm = seatMeta && seatMeta[p];
    let tagText, nameText = st.name;
    if (seatMeta) {
      if (you) tagText = 'Bạn';
      else if (sm && sm.isAI) tagText = 'AI';
      else if (sm && sm.occupied) { tagText = 'Người'; if (sm.displayName) nameText = sm.displayName; }
      else tagText = 'Trống';
    } else {
      tagText = you ? 'Bạn' : (mode === 'hotseat' ? 'Người' : 'AI');
    }
    return React.createElement('div', { key: p, className: 'hud-corner ' + order[p] },
      React.createElement('div', { className: cls.join(' '), style: { ['--pc']: st.hue },
        onMouseEnter: onHover ? (e) => onHover({ seat: p, faction: st.faction }, e) : undefined,
        onMouseMove: onHover ? (e) => onHover({ seat: p, faction: st.faction }, e) : undefined,
        onMouseLeave: onHover ? () => onHover(null) : undefined },
        React.createElement('div', { className: 'top' },
          React.createElement('div', { className: 'crest' }, st.icon),
          React.createElement('div', {},
            React.createElement('div', { className: 'nm' }, nameText),
            React.createElement('div', { className: 'sub' }, st.skill))),
        React.createElement('div', { className: 'pips' },
          state.horses[p].map((h, i) =>
            React.createElement('div', { key: i, className: 'p' + (h.step >= STEP_DONE ? ' home' : '') },
              h.step >= STEP_DONE ? '★' : ''))),
        React.createElement('div', { className: 'bot' },
          React.createElement('div', { className: 'tag' + (you ? ' you' : '') }, tagText),
          React.createElement('div', { className: 'sub' },
            debuffs.length ? debuffs.join(' ') + ' ' : '', 'Đích ' + homeCount + '/4'))));
  });
}

// ---------- Hero Wiki modal ----------
function HeroWiki({ open, onClose, seats }) {
  if (!open) return null;
  const inPlay = new Set((seats || []).map(s => s.faction));
  return React.createElement('div', { className: 'wiki-overlay', onClick: onClose },
    React.createElement('div', { className: 'wiki', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'wiki-head' },
        React.createElement('h2', {}, '📖 Từ Điển Hệ Phái'),
        React.createElement('button', { className: 'wiki-x', onClick: onClose }, '✕')),
      React.createElement('div', { className: 'wiki-grid' },
        FACTION_ORDER.map((k) => {
          const f = FACTIONS[k];
          return React.createElement('div', { key: k, className: 'wiki-card' + (inPlay.has(k) ? ' active' : ''),
            style: { ['--pc']: f.hue } },
            React.createElement('div', { className: 'wiki-card-top' },
              React.createElement('div', { className: 'wiki-chip' }, f.icon),
              React.createElement('div', {},
                React.createElement('div', { className: 'wiki-name' }, f.name),
                React.createElement('div', { className: 'wiki-skill' }, f.skill))),
            React.createElement('div', { className: 'wiki-desc' }, f.desc),
            inPlay.has(k) && React.createElement('div', { className: 'wiki-badge' }, 'Đang chơi'));
        })),
      React.createElement('div', { className: 'wiki-foot' },
        'Luật chung: ra 6 để xuất quân & đi thêm lượt · ba lần 6 = Thiên Lôi (trừ Quý Tộc) · cửa chuồng cần ra 6 · ra 1 = Nhót về Đỉnh · không nhảy qua đầu quân khác.')));
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "dawn",
  "tilt": 56,
  "opponents": "ai",
  "extraGlow": true,
  "aiSpeed": "vừa"
}/*EDITMODE-END*/;

// ---------- Online lobby overlay ----------
// me: undefined=loading · null=not logged in · {id,displayName,...}=authed
// net: null when not in a room; { code, mySeat } once seated.
function LudoLobby({ open, onClose, me, net, room, joinCode, setJoinCode, err,
                     onCreate, onJoin, onStart, onLeave }) {
  if (!open) return null;
  const h = React.createElement;
  const inRoom = !!net && !!room;
  const isHost = inRoom && me && room.hostUid === me.id;
  const humans = inRoom ? room.seats.filter(s => s.occupied && !s.isAI).length : 0;

  let body;
  if (me === undefined) {
    body = h('div', { className: 'lobby-msg' }, 'Đang tải…');
  } else if (me === null) {
    body = h('div', { className: 'lobby-auth' },
      h('p', {}, 'Đăng nhập bằng Discord để chơi cùng bạn bè.'),
      h('a', { className: 'roll-btn', href: '/api/auth/discord/start' }, '🎮 Đăng nhập Discord'));
  } else if (!inRoom) {
    body = h('div', { className: 'lobby-home' },
      h('div', { className: 'lobby-greet' }, 'Chào ' + (me.displayName || 'bạn') + '!'),
      h('button', { className: 'roll-btn', onClick: onCreate }, '➕ Tạo phòng mới'),
      h('div', { className: 'lobby-or' }, 'hoặc nhập mã phòng'),
      h('div', { className: 'lobby-join' },
        h('input', { className: 'lobby-input', value: joinCode, maxLength: 4,
          placeholder: 'ABCD', onChange: (e) => setJoinCode(e.target.value.toUpperCase()),
          onKeyDown: (e) => { if (e.key === 'Enter') onJoin(); } }),
        h('button', { className: 'roll-btn', onClick: onJoin }, 'Vào')));
  } else {
    // seated — show room code + the 4 seats
    body = h('div', { className: 'lobby-room' },
      h('div', { className: 'lobby-code' },
        h('span', { className: 'lobby-code-label' }, 'Mã phòng'),
        h('span', { className: 'lobby-code-val' }, room.code)),
      h('div', { className: 'lobby-seats' },
        room.seats.map((s) => h('div', { key: s.seat, className: 'lobby-seat' + (s.occupied ? ' filled' : '') },
          h('span', { className: 'lobby-seat-icon' }, s.isAI ? '🤖' : (s.occupied ? '🧑' : '∅')),
          h('span', {}, s.seat === (net && net.mySeat) ? (s.displayName || 'Bạn') + ' (bạn)'
            : s.isAI ? 'AI' : (s.occupied ? (s.displayName || 'Người chơi') : 'Trống'))))),
      h('div', { className: 'lobby-hint' }, 'Ghế trống sẽ do AI điều khiển khi bắt đầu.'),
      h('div', { className: 'lobby-actions' },
        isHost
          ? h('button', { className: 'roll-btn', onClick: onStart, disabled: humans < 1 }, '▶ Bắt đầu')
          : h('div', { className: 'lobby-msg' }, 'Chờ chủ phòng bắt đầu…'),
        h('button', { className: 'lobby-leave', onClick: onLeave }, 'Rời phòng')));
  }

  return h('div', { className: 'wiki-overlay', onClick: onClose },
    h('div', { className: 'wiki lobby', onClick: (e) => e.stopPropagation() },
      h('div', { className: 'wiki-head' },
        h('h2', {}, '🌐 Chơi Online'),
        h('button', { className: 'wiki-x', onClick: onClose }, '✕')),
      err && h('div', { className: 'lobby-err' }, err),
      body));
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const gameRef = useRef(Engine.newGame());
  const [, force] = useReducer(x => x + 1, 0);
  const render = () => force();

  const [die, setDie] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [movable, setMovable] = useState({ horses: new Set(), landing: null });
  const [status, setStatus] = useState('Bấm "Đổ xúc xắc" để bắt đầu');
  const [toast, setToast] = useState(null);
  const [fx, setFx] = useState([]);
  const [badges, setBadges] = useState({});       // {id: 'bleed'|'dizzy'|'frozen'|'curse'}
  const [logOpen, setLogOpen] = useState(true);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [tip, setTip] = useState(null);           // {x,y,faction}

  // ── online multiplayer state ──
  const [me, setMe] = useState(undefined);         // undefined=loading · null=guest · {id,...}=authed
  const [net, setNet] = useState(null);            // { code, mySeat, version } when in a room
  const [room, setRoom] = useState(null);          // latest server roomView (seats/status/state)
  const [onlineOpen, setOnlineOpen] = useState(false); // lobby overlay visible
  const [lobbyErr, setLobbyErr] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const netRef = useRef(null);
  const roomRef = useRef(null);
  const busyRef = useRef(false);
  const animatingRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const isOnline = !!net;

  const fitRef = useRef(null);
  const sceneRef = useRef(null);
  const fxId = useRef(0);

  const mode = t.opponents;
  const isAI = (p) => !isOnline && mode === 'ai' && p !== 0;
  const aiDelay = { 'nhanh': 240, 'vừa': 460, 'chậm': 800 }[t.aiSpeed] || 460;

  // keep refs in sync so async pollers / handlers read fresh values
  useEffect(() => { netRef.current = net; }, [net]);
  useEffect(() => { roomRef.current = room; }, [room]);

  // ---- detect Discord login (same-origin → session cookie auto-sent) ----
  useEffect(() => {
    let cancel = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then(async (d) => {
        if (cancel) return;
        const user = d?.user || null;
        setMe(user);
        // auto-rejoin a room we were in before a refresh (server matches by uid)
        if (user) {
          let saved = null;
          try { saved = localStorage.getItem('ludo.room'); } catch {}
          if (saved) {
            try {
              const data = await api('join', { body: { code: saved } });
              if (cancel) return;
              setNet({ code: data.room.code, mySeat: data.mySeat, version: data.room.version });
              await ingestRoom(data, { animate: false });
              setOnlineOpen(data.room.status === 'lobby');
            } catch { try { localStorage.removeItem('ludo.room'); } catch {} }
          }
        }
      })
      .catch(() => { if (!cancel) setMe(null); });
    return () => { cancel = true; };
  }, []);

  // ---- online API helper ----
  const api = useCallback(async (action, opts = {}) => {
    const { method = 'POST', body, query } = opts;
    const qs = new URLSearchParams({ kind: 'ludo', action, ...(query || {}) }).toString();
    const res = await fetch('/api/toolbox?' + qs, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
    return data;
  }, []);

  // expose the Hero Wiki toggle to the HTML toolbar button
  useEffect(() => { window.__openWiki = () => setWikiOpen(o => !o); return () => { delete window.__openWiki; }; }, []);
  // expose the Online lobby toggle to the HTML toolbar button
  useEffect(() => { window.__openOnline = () => setOnlineOpen(o => !o); return () => { delete window.__openOnline; }; }, []);

  // ---- theme ----
  useEffect(() => {
    const th = THEMES[t.variant] || THEMES.dawn;
    const root = document.documentElement;
    Object.entries(th.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.mat = th.vars['--standee'];
    root.style.setProperty('--center-glow-strength', t.extraGlow ? '1' : '0');
  }, [t.variant, t.extraGlow]);
  useEffect(() => { document.documentElement.style.setProperty('--tiltX', t.tilt + 'deg'); }, [t.tilt]);

  // ---- right-click drag to orbit ----
  const tiltRef = useRef(t.tilt);
  useEffect(() => { tiltRef.current = t.tilt; }, [t.tilt]);
  const rotRef = useRef(45);
  const TILT_MIN = 30, TILT_MAX = 68;
  // Touch-device default: orient the board so seat 0 (the human) sits at the
  // bottom-front of the diamond instead of seat 3, so the player's pieces are
  // closest to them. Empirically at rotZ=45° seat 0 is at the TOP-back of the
  // diamond; +180° brings it to the bottom-front.
  const HOME_ROT = 225;
  const HOME_TILT = 56;
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      rotRef.current = HOME_ROT;
      document.documentElement.style.setProperty('--rotZ', HOME_ROT + 'deg');
    }
  }, []);
  useEffect(() => {
    const onContext = (e) => e.preventDefault();
    const onDown = (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY, startTilt = tiltRef.current, startRot = rotRef.current;
      document.body.style.cursor = 'grabbing';
      const onMove = (ev) => {
        const nextTilt = Math.max(TILT_MIN, Math.min(TILT_MAX, Math.round(startTilt + (ev.clientY - startY) * 0.12)));
        if (nextTilt !== tiltRef.current) setTweak('tilt', nextTilt);
        const nextRot = Math.round(startRot + (ev.clientX - startX) * 0.12);
        if (nextRot !== rotRef.current) { rotRef.current = nextRot; document.documentElement.style.setProperty('--rotZ', nextRot + 'deg'); }
      };
      const onUp = () => { document.body.style.cursor = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    };
    window.addEventListener('contextmenu', onContext); window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('contextmenu', onContext); window.removeEventListener('mousedown', onDown); };
  }, [setTweak]);

  // ---- fit-to-viewport ----
  const fit = useCallback(() => {
    const box = fitRef.current;
    if (!box) return;
    // Compute against --cell (read from CSS) — no getBoundingClientRect, no
    // forced sync layout. The board is always --cell × 15 CSS pixels.
    const cellStr = getComputedStyle(document.documentElement).getPropertyValue('--cell').trim();
    const cellPx = parseFloat(cellStr) || 46;
    const boardPx = cellPx * 15;
    // rotateZ(45°)-ish makes the layout square read as a diamond ~√2 wider
    // in both axes; rotateX(tilt) compresses Y by cos(tilt).
    const tiltDeg = tiltRef.current;
    const diag = 1.42;
    const effW = boardPx * diag;
    const effH = boardPx * diag * Math.cos(tiltDeg * Math.PI / 180);
    const isShort = window.innerHeight < 540;  // phone landscape / tight
    const reserveTop = isShort ? 56 : 72;       // unified toolbar
    const reserveBot = isShort ? 76 : 96;       // dice dock + status pill
    const reserveSide = 14;
    const availW = Math.max(180, window.innerWidth - reserveSide * 2);
    const availH = Math.max(180, window.innerHeight - reserveTop - reserveBot);
    const base = Math.min(availW / effW, availH / effH);
    const s = Math.max(0.18, Math.min(base, 2.5));
    // Perspective renders the near corner of the diamond bigger than the
    // far one, so the visible centre-of-mass sits below the geometric
    // centre. Shift the whole stage up a touch so the board reads as
    // centered on screen instead of crowding the dice dock at the bottom.
    const yOffset = -Math.round(boardPx * 0.06 * s);
    box.style.transform = 'translate3d(0,' + yOffset + 'px,0) scale(' + s + ')';
  }, []);
  useLayoutEffect(() => { fit(); }, [t.tilt]);
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [fit]);

  // ---- 2-finger touch: small peek-orbit with spring-back.
  // Single-finger taps still work normally (tiles, dice, HUD buttons).
  //
  // Behavior tuned for board-game UX:
  //  • the resting orientation is HOME_ROT / HOME_TILT (so the player's
  //    pieces are always at the bottom-front of the diamond),
  //  • drag is clamped to a small peek (no 360° spins) so the player keeps
  //    their bearings while glancing at the far side of the board,
  //  • releasing the fingers springs rotZ + tilt back to HOME with a rAF
  //    tween.
  //
  // Pinch-zoom is intentionally NOT wired here — every per-frame transform
  // write on .stage-fit during a pinch was forcing a heavy composite of the
  // whole 3D board on phones. The fixed auto-fit is enough; the only per-
  // frame work in this handler is two CSS-var writes.
  useEffect(() => {
    const root = document.documentElement;
    let active = false, cx0 = 0, cy0 = 0;
    let pendingRot = HOME_ROT, pendingTilt = HOME_TILT, rafId = 0;
    let springRaf = 0;
    const ROT_PEEK = 22;   // max ° from HOME_ROT during a drag
    const TILT_PEEK = 8;   // max ° from HOME_TILT during a drag
    const SPRING_MS = 280;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const flush = () => {
      rafId = 0;
      if (!active) return;
      root.style.setProperty('--rotZ', pendingRot + 'deg');
      root.style.setProperty('--tiltX', pendingTilt + 'deg');
    };

    // Tween rotZ + tilt back to HOME. Picks the shortest angular path for rot
    // so e.g. 350° → 135° goes the short way (-145°), not the long way (+145°).
    const springHome = () => {
      const startRot = rotRef.current;
      const startTilt = tiltRef.current;
      const dRot = ((HOME_ROT - startRot + 540) % 360) - 180;
      const dTilt = HOME_TILT - startTilt;
      if (Math.abs(dRot) < 0.5 && Math.abs(dTilt) < 0.5) {
        document.body.classList.remove('gesturing');
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / SPRING_MS);
        const ease = 1 - Math.pow(1 - k, 3);
        const r = startRot + dRot * ease;
        const ti = startTilt + dTilt * ease;
        rotRef.current = r;
        tiltRef.current = Math.round(ti);
        root.style.setProperty('--rotZ', r + 'deg');
        root.style.setProperty('--tiltX', Math.round(ti) + 'deg');
        if (k < 1) {
          springRaf = requestAnimationFrame(step);
        } else {
          springRaf = 0;
          document.body.classList.remove('gesturing');
          if (tiltRef.current !== HOME_TILT) tiltRef.current = HOME_TILT;
          setTweak('tilt', HOME_TILT);
        }
      };
      springRaf = requestAnimationFrame(step);
    };

    const onStart = (e) => {
      if (e.touches.length !== 2) { active = false; return; }
      const [a, b] = e.touches;
      cx0 = (a.clientX + b.clientX) / 2;
      cy0 = (a.clientY + b.clientY) / 2;
      // Cancel any in-flight spring so the new gesture takes over cleanly.
      if (springRaf) { cancelAnimationFrame(springRaf); springRaf = 0; }
      pendingRot = HOME_ROT;
      pendingTilt = HOME_TILT;
      rotRef.current = HOME_ROT;
      tiltRef.current = HOME_TILT;
      document.body.classList.add('gesturing');
      active = true;
      if (!rafId) rafId = requestAnimationFrame(flush);
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!active || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = e.touches;
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      const dx = cx - cx0, dy = cy - cy0;
      pendingRot = HOME_ROT + clamp(dx * 0.18, -ROT_PEEK, ROT_PEEK);
      pendingTilt = clamp(Math.round(HOME_TILT + clamp(dy * 0.18, -TILT_PEEK, TILT_PEEK)), TILT_MIN, TILT_MAX);
      rotRef.current = pendingRot;
      tiltRef.current = pendingTilt;
      if (!rafId) rafId = requestAnimationFrame(flush);
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      springHome();
    };

    window.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (springRaf) cancelAnimationFrame(springRaf);
      document.body.classList.remove('gesturing');
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [setTweak]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1500); };

  function pushLog(line) {
    const g = gameRef.current;
    if (!line) return;
    g.log.unshift({ id: ++fxId.current, line });
    if (g.log.length > 40) g.log.length = 40;
  }
  function spawnFx(type, cell, extra) {
    const id = ++fxId.current;
    const f = { id, type, r: cell[0], c: cell[1], ...(extra || {}) };
    setFx(list => [...list, f]);
    setTimeout(() => setFx(list => list.filter(x => x.id !== id)), 900);
  }
  function setBadge(id, kind, turns) {
    setBadges(b => ({ ...b, [id]: kind }));
    setTimeout(() => setBadges(b => { const n = { ...b }; if (n[id] === kind) delete n[id]; return n; }), (turns || 1) * 1500 + 600);
  }

  const landingSet = (moves) => {
    const s = new Set();
    for (const m of moves) {
      const cell = m.to >= STEP_DONE ? CENTER : cellOf(m.horse.seat, m.to);
      if (cell) s.add(cell[0] + ',' + cell[1]);
    }
    return s;
  };

  // ---- play out an event list with VFX + log ----
  async function playEvents(events) {
    const g = gameRef.current;
    for (const ev of events) {
      const line = Engine.describeEvent(g, ev);
      if (line) pushLog(line);
      switch (ev.t) {
        case 'capture':
          if (ev.cell) spawnFx(ev.attackerSeat != null && g.seats[ev.attackerSeat].faction === 'red' ? 'slash' : 'poof', ev.cell);
          break;
        case 'shield': if (ev.cell) spawnFx('shatter', ev.cell); flash('🛡️ Khiên vỡ!'); break;
        case 'bleed':  setBadge(ev.victimSeat + '-' + ev.victimIdx, 'bleed', 1); break;
        case 'curse':  flash('⛓️ Nhân Quả!'); break;
        case 'stun':   flash('🌀 Choáng!'); break;
        case 'pushback': if (ev.fromCell) spawnFx('dust', ev.fromCell); break;
        case 'domino':  if (ev.cell) { spawnFx('strike', ev.cell); flash('🎳 Domino!'); } break;
        case 'trap-set': if (ev.cell) spawnFx('frost', ev.cell); break;
        case 'freeze':  if (ev.cell) spawnFx('iceblock', ev.cell); flash('🧊 Đóng băng!'); break;
        case 'nhot':    if (ev.cell) spawnFx('warp', ev.cell); flash('✨ Nhót!'); break;
        case 'finish':  flash('✦ Về đích!'); break;
        default: break;
      }
      render();
      await sleep(120);
    }
  }

  // ---- core turn flow ----
  async function doRoll() {
    if (isOnline) return onlineRoll();
    const g = gameRef.current;
    if (busy || rolling || g.winner != null || g.phase !== 'roll') return;
    setBusy(true); setRolling(true); setMovable({ horses: new Set(), landing: null });

    const seat = g.turn;
    const stt = g.status[seat];
    const fac = Engine.factionKey(g, seat);

    // skip-turn debuffs (Trọng Thương / Choáng / Đóng băng) consume the roll
    if (stt.skip > 0) {
      stt.skip -= 1;
      setRolling(false);
      setStatus(g.seats[seat].name + ' bị khống chế — mất lượt! ');
      pushLog('⏸️ ' + g.seats[seat].icon + ' ' + g.seats[seat].name + ' bị khống chế, mất lượt.');
      render(); await sleep(950);
      setBusy(false); endTurn(); return;
    }

    let v = 1 + Math.floor(Math.random() * 6);
    await sleep(600); setRolling(false);
    g.rawDie = v;

    // ⚪ Nhân Quả curse: −2 to this roll
    let cursed = false;
    if (stt.curse > 0) { stt.curse -= 1; v = Math.max(0, v - 2); cursed = true; }
    setDie(g.rawDie); g.die = v;
    g.sixStreak = (g.rawDie === 6) ? g.sixStreak + 1 : 0;
    render();

    if (cursed) { setStatus('⛓️ Nhân Quả! ' + g.rawDie + ' − 2 = ' + v); await sleep(800); }

    // 🌩️ Thiên Lôi — 3 sixes (Gold is immune)
    if (g.sixStreak >= 3 && fac !== 'gold') {
      const lost = Engine.sendFurthestToBase(g, seat);
      if (lost) spawnFx('poof', lost.cell);
      pushLog('🌩️ Thiên Lôi! ' + g.seats[seat].icon + ' ' + g.seats[seat].name + ' đổ ba lần 6 — quân xa nhất về chuồng, mất lượt.');
      setStatus('Ba số 6 liên tiếp — Thiên Lôi! Mất lượt.'); render(); await sleep(1100);
      setBusy(false); endTurn(); return;
    }

    if (v < 1) { // cursed to 0 → wasted
      setStatus(g.seats[seat].name + ': điểm về 0 — mất lượt'); await sleep(850);
      setBusy(false); endTurn(); return;
    }

    const moves = Engine.legalMoves(g);
    if (!moves.length) {
      setStatus(g.seats[seat].name + ': không có nước đi hợp lệ (đổ ' + v + ')'); await sleep(950);
      setBusy(false); endTurn(); return;
    }
    if (isAI(seat)) {
      const m = Engine.aiChoose(g, moves);
      await sleep(aiDelay); await execMove(m);
    } else {
      setMovable({ horses: new Set(moves.map(m => m.horse.seat + '-' + m.horse.idx)), landing: landingSet(moves) });
      const hasNhot = moves.some(m => m.kind === 'nhot');
      setStatus('Đổ ' + v + (hasNhot ? ' — có thể Nhót! ' : ' — ') + 'chọn quân phát sáng');
      g.phase = 'select'; setBusy(false); render();
    }
  }

  async function onPick(h) {
    if (isOnline) return onlinePick(h);
    const g = gameRef.current;
    if (g.phase !== 'select' || busy) return;
    const moves = Engine.legalMoves(g);
    // a horse may have both a normal ring move and a Nhót — prefer Nhót (more value, player intent)
    const mine = moves.filter(mv => mv.horse === h);
    if (!mine.length) return;
    const m = mine.find(mv => mv.kind === 'nhot') || mine[0];
    setBusy(true);
    await execMove(m);
  }

  async function execMove(m) {
    const g = gameRef.current;
    const h = m.horse;
    setMovable({ horses: new Set(), landing: null });
    g.phase = 'anim'; render();

    // animate the travel before mutating state, so steps walk visibly
    if (m.kind === 'deploy') {
      // handled in applyMove; just a small beat
    } else if (m.kind === 'nhot') {
      const fromCell = cellOf(h.seat, h.step);
      if (fromCell) spawnFx('warp', fromCell);
      await sleep(260);
    } else {
      for (let s = h.step + 1; s < m.to; s++) { const c = cellOf(h.seat, s); h.step = s; render(); await sleep(150); if (!c) break; }
    }

    const res = Engine.applyMove(g, m);
    render();
    await playEvents(res.events);

    // win check
    if (Engine.playerDone(g, h.seat)) { g.winner = h.seat; render(); setBusy(false); return; }

    // extra turn: a six (and not blocked by special no-extra rules), OR a finish.
    // 🔴 Đỏ does NOT get an extra turn from a capture. Others do.
    const aFac = res.attackerFaction;
    const sixExtra = g.rawDie === 6 && g.sixStreak < 3;
    const capExtra = res.capturedSomeone && aFac !== 'red';
    const extra = sixExtra || capExtra || res.finished;

    setBusy(false);
    if (extra) continueTurn(); else endTurn();
  }

  function continueTurn() {
    const g = gameRef.current;
    g.die = null; g.rawDie = null; g.phase = 'roll'; setDie(null);
    setStatus((isAI(g.turn) ? g.seats[g.turn].name : 'Bạn') + ' được đi tiếp!');
    render(); scheduleTurn();
  }
  function endTurn() {
    const g = gameRef.current;
    Engine.nextTurn(g); setDie(null);
    setMovable({ horses: new Set(), landing: null });
    setStatus(turnPrompt(g)); render(); scheduleTurn();
  }
  function turnPrompt(g) {
    return isAI(g.turn) ? 'Lượt của ' + g.seats[g.turn].name + ' (AI)…' : 'Lượt của bạn — đổ xúc xắc';
  }
  function scheduleTurn() {
    if (isOnline) return;            // server drives AI online; no client timers
    const g = gameRef.current;
    if (g.winner != null) return;
    if (isAI(g.turn)) setTimeout(() => doRoll(), 620);
  }

  function newGame() {
    gameRef.current = Engine.newGame();
    setDie(null); setBusy(false); setRolling(false);
    setMovable({ horses: new Set(), landing: null });
    setFx([]); setBadges({});
    setStatus('Ván mới! Hệ phái đã được bốc ngẫu nhiên. Bấm "Đổ xúc xắc"'); render();
    setTimeout(scheduleTurn, 400);
  }

  useEffect(() => { scheduleTurn(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setTimeout(fit, 60); /* eslint-disable-next-line */ }, [t.variant]);

  // ════════════════════════════════════════════════════════════════
  // ONLINE MULTIPLAYER — server-authoritative; this client only sends
  // intents (roll/move) and renders the state the server returns.
  // ════════════════════════════════════════════════════════════════

  // Replace local game state with the server's, then animate any new events.
  async function ingestRoom(data, { animate = true } = {}) {
    const r = data.room;
    if (!r) return;
    setRoom(r);
    if (typeof data.mySeat === 'number' && data.mySeat >= 0 && netRef.current) {
      if (netRef.current.mySeat !== data.mySeat) setNet(n => n && ({ ...n, mySeat: data.mySeat }));
    }
    if (r.state) {
      gameRef.current = r.state;
      // bump version so the next poll only pulls newer event batches
      if (netRef.current && r.version != null) setNet(n => n && ({ ...n, version: r.version }));
      // animate the server's event batch (captures, traps, finishes…)
      if (animate && Array.isArray(r.events) && r.events.length) {
        animatingRef.current = true;
        await playEvents(r.events);
        animatingRef.current = false;
      }
      refreshOnlineTurnUI();
      render();
    }
  }

  // After state settles, light up the player's movable horses if it's their
  // turn and the server is waiting on a selection (phase 'select').
  function refreshOnlineTurnUI() {
    const g = gameRef.current;
    const n = netRef.current;
    if (!g || !n) return;
    setDie(g.die || null);
    if (g.winner != null) { setMovable({ horses: new Set(), landing: null }); setStatus(g.seats[g.winner].name + ' chiến thắng!'); return; }
    const mine = g.turn === n.mySeat;
    if (mine && g.phase === 'select') {
      const moves = Engine.legalMoves(g);
      setMovable({ horses: new Set(moves.map(m => m.horse.seat + '-' + m.horse.idx)), landing: landingSet(moves) });
      const hasNhot = moves.some(m => m.kind === 'nhot');
      setStatus('Đổ ' + g.die + (hasNhot ? ' — có thể Nhót! ' : ' — ') + 'chọn quân phát sáng');
    } else {
      setMovable({ horses: new Set(), landing: null });
      setStatus(mine ? 'Lượt của bạn — đổ xúc xắc' : 'Lượt của ' + g.seats[g.turn].name + '…');
    }
  }

  async function onlineRoll() {
    const n = netRef.current; const g = gameRef.current;
    if (!n || busyRef.current || g.winner != null) return;
    if (g.turn !== n.mySeat || g.phase !== 'roll') return;
    setBusy(true); setRolling(true);
    try {
      await sleep(420);
      const data = await api('roll', { body: { code: n.code, version: n.version } });
      setRolling(false);
      await ingestRoom(data);
    } catch (e) {
      setRolling(false);
      if (e.status === 409 && e.data?.room) await ingestRoom({ room: e.data.room }, { animate: false });
      else flash('Lỗi: ' + (e.message || 'roll'));
    } finally { setBusy(false); }
  }

  async function onlinePick(h) {
    const n = netRef.current; const g = gameRef.current;
    if (!n || busyRef.current) return;
    if (g.turn !== n.mySeat || g.phase !== 'select') return;
    const moves = Engine.legalMoves(g);
    const mine = moves.filter(mv => mv.horse.seat === h.seat && mv.horse.idx === h.idx);
    if (!mine.length) return;
    const m = mine.find(mv => mv.kind === 'nhot') || mine[0];
    setBusy(true);
    setMovable({ horses: new Set(), landing: null });
    try {
      const data = await api('move', { body: { code: n.code, version: n.version, idx: m.horse.idx, kind: m.kind, to: m.to } });
      await ingestRoom(data);
    } catch (e) {
      if (e.status === 409 && e.data?.room) await ingestRoom({ room: e.data.room }, { animate: false });
      else flash('Lỗi: ' + (e.message || 'move'));
    } finally { setBusy(false); }
  }

  // ---- poll loop: ~1s, paused while a local action/animation is in flight ----
  useEffect(() => {
    if (!net) return;
    let stop = false; let ctrl = null;
    const tick = async () => {
      if (stop) return;
      if (busyRef.current || animatingRef.current) return; // don't clobber an in-flight turn
      const n = netRef.current; if (!n) return;
      ctrl = new AbortController();
      try {
        const qs = new URLSearchParams({ kind: 'ludo', action: 'state', code: n.code, since: String(n.version) });
        const res = await fetch('/api/toolbox?' + qs, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (stop || busyRef.current || animatingRef.current) return;
        if (data.room && data.room.version > n.version) await ingestRoom(data);
        else if (data.room) setRoom(data.room); // seats/presence refresh only
      } catch { /* aborted or network blip — next tick retries */ }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => { stop = true; clearInterval(id); if (ctrl) ctrl.abort(); };
  }, [net && net.code]); // eslint-disable-line

  // ---- lobby actions ----
  async function lobbyCreate() {
    setLobbyErr(null);
    try {
      const data = await api('create');
      setNet({ code: data.room.code, mySeat: data.mySeat, version: data.room.version });
      setRoom(data.room);
      try { localStorage.setItem('ludo.room', data.room.code); } catch {}
    } catch (e) { setLobbyErr(loginHintErr(e)); }
  }
  async function lobbyJoin() {
    setLobbyErr(null);
    const code = joinCode.toUpperCase().trim();
    if (code.length < 3) { setLobbyErr('Nhập mã phòng'); return; }
    try {
      const data = await api('join', { body: { code } });
      setNet({ code: data.room.code, mySeat: data.mySeat, version: data.room.version });
      setRoom(data.room);
      try { localStorage.setItem('ludo.room', data.room.code); } catch {}
    } catch (e) { setLobbyErr(joinErrMsg(e)); }
  }
  async function lobbyStart() {
    const n = netRef.current; if (!n) return;
    try { const data = await api('start', { body: { code: n.code } }); await ingestRoom(data, { animate: false }); }
    catch (e) { setLobbyErr(e.data?.error === 'need_player' ? 'Cần ít nhất 1 người' : 'Lỗi bắt đầu'); }
  }
  async function lobbyLeave() {
    const n = netRef.current; if (!n) return;
    try { await api('leave', { body: { code: n.code } }); } catch {}
    try { localStorage.removeItem('ludo.room'); } catch {}
    setNet(null); setRoom(null); setOnlineOpen(false);
    gameRef.current = Engine.newGame(); render();
  }
  function loginHintErr(e) { return e.status === 401 ? 'Cần đăng nhập Discord trước' : ('Lỗi: ' + (e.message || '')); }
  function joinErrMsg(e) {
    const m = { room_not_found: 'Không tìm thấy phòng', room_full: 'Phòng đã đầy', game_in_progress: 'Ván đang diễn ra' };
    return e.status === 401 ? 'Cần đăng nhập Discord trước' : (m[e.data?.error] || 'Lỗi vào phòng');
  }

  const g = gameRef.current;
  const canRoll = isOnline
    ? (net && g.turn === net.mySeat && g.phase === 'roll' && !busy && !rolling && g.winner == null)
    : (!isAI(g.turn) && g.phase === 'roll' && !busy && !rolling && g.winner == null);

  const onHover = (info, e) => {
    if (!info) { setTip(null); return; }
    setTip({ x: e.clientX, y: e.clientY, faction: info.faction });
  };

  const particles = React.useMemo(() => Array.from({ length: 24 }, () => ({
    left: Math.random() * 100, size: 3 + Math.random() * 6, dur: 9 + Math.random() * 10, delay: -Math.random() * 16,
  })), []);

  return React.createElement('div', { className: 'wrap' },
    React.createElement('div', { className: 'ambient' },
      particles.map((p, i) => React.createElement('i', { key: i, style: {
        left: p.left + '%', bottom: '-20px', width: p.size, height: p.size,
        animationDuration: p.dur + 's', animationDelay: p.delay + 's' } }))),

    React.createElement('div', { className: 'stage-fit', ref: fitRef },
      React.createElement('div', { ref: sceneRef, style: { display: 'inline-block' } },
        React.createElement(Board, { state: g, movable, onPick, onHover, fx, badges }))),

    React.createElement(HUD, { state: g, mode, onHover, mySeat: isOnline && net ? net.mySeat : null, seatMeta: isOnline && room ? room.seats : null }),

    // ---- game log panel ----
    React.createElement('div', { className: 'log-panel' + (logOpen ? '' : ' collapsed') },
      React.createElement('div', { className: 'log-head', onClick: () => setLogOpen(o => !o) },
        React.createElement('span', {}, '📜 Diễn biến'),
        React.createElement('span', { className: 'log-toggle' }, logOpen ? '▾' : '▸')),
      logOpen && React.createElement('div', { className: 'log-body' },
        g.log.length === 0
          ? React.createElement('div', { className: 'log-empty' }, 'Chưa có sự kiện nào…')
          : g.log.map(e => React.createElement('div', { key: e.id, className: 'log-line' }, e.line)))),

    // ---- dice dock ----
    React.createElement('div', { className: 'die-dock' },
      React.createElement('div', { className: 'status' }, status),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        React.createElement(Die, { value: die || 1, rolling }),
        React.createElement('button', { className: 'roll-btn', disabled: !canRoll, onClick: doRoll },
          rolling ? '…' : 'Đổ xúc xắc'))),

    toast && React.createElement('div', { className: 'toast show' }, toast),

    // ---- hover tooltip ----
    tip && (function () {
      const f = FACTIONS[tip.faction];
      return React.createElement('div', { className: 'hero-tip', style: { left: tip.x + 14, top: tip.y + 14, ['--pc']: f.hue } },
        React.createElement('div', { className: 'hero-tip-name' }, f.icon + ' ' + f.name),
        React.createElement('div', { className: 'hero-tip-skill' }, '【' + f.skill + '】 ' + f.short));
    })(),

    React.createElement(HeroWiki, { open: wikiOpen, onClose: () => setWikiOpen(false), seats: g.seats }),

    React.createElement(LudoLobby, {
      open: onlineOpen, onClose: () => setOnlineOpen(false),
      me, net, room, joinCode, setJoinCode, err: lobbyErr,
      onCreate: lobbyCreate, onJoin: lobbyJoin, onStart: lobbyStart, onLeave: lobbyLeave,
    }),

    g.winner != null && React.createElement('div', { className: 'win-overlay' },
      React.createElement('div', { className: 'win-card', style: { ['--pc']: g.seats[g.winner].hue } },
        React.createElement('h1', { style: { color: g.seats[g.winner].hue } }, g.seats[g.winner].icon + ' ' + g.seats[g.winner].name + ' chiến thắng!'),
        React.createElement('p', {}, 'Đưa cả 4 quân về Thánh Tích trung tâm.'),
        isOnline
          ? React.createElement('button', { className: 'roll-btn', onClick: lobbyLeave }, 'Về sảnh')
          : React.createElement('button', { className: 'roll-btn', onClick: newGame }, 'Chơi ván mới'))),

    React.createElement(TweaksPanel, { title: 'Cài đặt' },
      React.createElement(TweakSection, { label: 'Chủ đề' }),
      React.createElement(TweakSelect, { label: 'Chủ đề', value: t.variant,
        options: Object.keys(THEMES).map(k => ({ value: k, label: THEMES[k].label })),
        onChange: v => setTweak('variant', v) }),
      React.createElement('div', { style: { fontSize: 11, opacity: .7, padding: '0 2px 6px', lineHeight: 1.4 } },
        (THEMES[t.variant] || THEMES.dawn).blurb),
      React.createElement(TweakSection, { label: 'Đối thủ' }),
      React.createElement(TweakSelect, { label: 'Chế độ', value: t.opponents,
        options: [{ value: 'ai', label: 'Đấu với AI' }, { value: 'hotseat', label: 'Cùng máy (hotseat)' }],
        onChange: v => setTweak('opponents', v) }),
      React.createElement(TweakSelect, { label: 'Tốc độ AI', value: t.aiSpeed,
        options: [{ value: 'nhanh', label: 'Nhanh' }, { value: 'vừa', label: 'Vừa' }, { value: 'chậm', label: 'Chậm' }],
        onChange: v => setTweak('aiSpeed', v) }),
      React.createElement(TweakButton, { label: 'Ván mới', onClick: newGame }),
      React.createElement(TweakSection, { label: 'Góc nhìn' }),
      React.createElement(TweakSlider, { label: 'Độ nghiêng', value: t.tilt, min: 30, max: 68, step: 1, unit: '°',
        onChange: v => setTweak('tilt', v) })
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
