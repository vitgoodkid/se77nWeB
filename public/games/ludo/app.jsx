/* global React, ReactDOM, Engine, Board, THEMES,
   useTweaks, TweaksPanel, TweakSection, TweakSelect, TweakSlider, TweakToggle, TweakButton */
const { useState, useRef, useReducer, useEffect, useLayoutEffect, useCallback } = React;
const { PLAYERS, cellOf, STEP_DONE, SAFE, CENTER } = Engine;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIPS = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };

function Die({ value, rolling }) {
  const on = new Set(PIPS[value] || []);
  return React.createElement('div', { className: 'die' + (rolling ? ' rolling' : '') },
    Array.from({ length: 9 }, (_, i) =>
      React.createElement('div', { key: i, className: 'pip' + (on.has(i) ? ' on' : '') })));
}

function HUD({ state, mode }) {
  const order = ['tl','tr','br','bl'];
  return PLAYERS.map((pl, p) => {
    const homeCount = state.horses[p].filter(h => h.step >= STEP_DONE).length;
    const active = state.turn === p && state.winner == null;
    const you = mode === 'hotseat' ? false : p === 0;
    const cls = ['pcard']; if (active) cls.push('active'); else cls.push('dimmed');
    return React.createElement('div', { key: p, className: 'hud-corner ' + order[p] },
      React.createElement('div', { className: cls.join(' '), style: { ['--pc']: pl.hue } },
        React.createElement('div', { className: 'top' },
          React.createElement('div', { className: 'crest' }),
          React.createElement('div', {},
            React.createElement('div', { className: 'nm' }, pl.name),
            React.createElement('div', { className: 'sub' }, ['Hỏa','Quang','Mộc','Băng'][p] + ' tộc'))),
        React.createElement('div', { className: 'pips' },
          state.horses[p].map((h, i) =>
            React.createElement('div', { key: i, className: 'p' + (h.step >= STEP_DONE ? ' home' : '') },
              h.step >= STEP_DONE ? '★' : ''))),
        React.createElement('div', { className: 'bot' },
          React.createElement('div', { className: 'tag' + (you ? ' you' : '') }, you ? 'Bạn' : (mode==='hotseat'?'Người':'AI')),
          React.createElement('div', { className: 'sub' }, 'Về đích ' + homeCount + '/4'))));
  });
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "dawn",
  "tilt": 56,
  "opponents": "ai",
  "extraGlow": true,
  "aiSpeed": "vừa"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const gameRef = useRef(Engine.newGame());
  const [, force] = useReducer(x => x + 1, 0);
  const render = () => force();

  const [die, setDie] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [movable, setMovable] = useState({ horses: new Set(), landing: null });
  const [status, setStatus] = useState('Bấm “Đổ xúc xắc” để bắt đầu');
  const [toast, setToast] = useState(null);
  const [poofs, setPoofs] = useState([]);
  const fitRef = useRef(null);
  const sceneRef = useRef(null);
  const poofId = useRef(0);

  const mode = t.opponents;
  const isAI = (p) => mode === 'ai' && p !== 0;
  const aiDelay = { 'nhanh': 260, 'vừa': 480, 'chậm': 820 }[t.aiSpeed] || 480;

  // ---- theme ----
  useEffect(() => {
    const th = THEMES[t.variant] || THEMES.dawn;
    const root = document.documentElement;
    Object.entries(th.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.mat = th.vars['--standee'];
    root.style.setProperty('--center-glow-strength', t.extraGlow ? '1' : '0');
  }, [t.variant, t.extraGlow]);
  useEffect(() => {
    document.documentElement.style.setProperty('--tiltX', t.tilt + 'deg');
  }, [t.tilt]);

  // ---- right-click drag to adjust board tilt ----
  // Hold the right mouse button and drag vertically to tilt the board (drag up
  // = flatter/lower angle, down = steeper). Keeps the Tweaks slider in sync.
  // tiltRef mirrors t.tilt so the drag handler never reads a stale closure.
  const tiltRef = useRef(t.tilt);
  useEffect(() => { tiltRef.current = t.tilt; }, [t.tilt]);
  const TILT_MIN = 30, TILT_MAX = 68;
  useEffect(() => {
    const onContext = (e) => e.preventDefault(); // suppress the browser menu
    const onDown = (e) => {
      if (e.button !== 2) return; // right button only
      e.preventDefault();
      const startY = e.clientY;
      const startTilt = tiltRef.current;
      document.body.style.cursor = 'ns-resize';
      const onMove = (ev) => {
        // 0.35°/px feels natural across the 30–68 range
        const next = Math.round(startTilt + (ev.clientY - startY) * 0.35);
        const clamped = Math.max(TILT_MIN, Math.min(TILT_MAX, next));
        if (clamped !== tiltRef.current) setTweak('tilt', clamped);
      };
      const onUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('mousedown', onDown);
    };
  }, [setTweak]);

  // ---- fit-to-viewport scaling ----
  const fit = useCallback(() => {
    const el = sceneRef.current, box = fitRef.current;
    if (!el || !box) return;
    box.style.transform = 'scale(1)';
    const r = el.getBoundingClientRect();
    const s = Math.min((window.innerWidth * 0.98) / r.width,
                       (window.innerHeight * 0.98) / (r.height + 70));
    box.style.transform = 'scale(' + Math.max(0.3, Math.min(s, 2.1)) + ')';
  }, []);
  useLayoutEffect(() => { fit(); }, [t.tilt]);
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  // ---- capture resolution at a horse's final cell ----
  function resolveCapture(g, h) {
    if (h.step < 0 || h.step > 50) return [];
    const cell = cellOf(h.player, h.step);
    if (SAFE.has(cell.join(','))) return [];
    const enemies = Engine.horseAt(g, cell, h).filter(o => o.player !== h.player);
    const out = enemies.map(o => ({ o, cell: cellOf(o.player, o.step) }));
    enemies.forEach(o => { o.step = -1; });
    return out;
  }

  const landingSet = (g, moves) => {
    const s = new Set();
    for (const m of moves) {
      const cell = m.to >= STEP_DONE ? CENTER : cellOf(m.horse.player, m.to);
      s.add(cell[0] + ',' + cell[1]);
    }
    return s;
  };

  // ---- core turn flow ----
  async function doRoll() {
    const g = gameRef.current;
    if (busy || rolling || g.winner != null) return;
    setBusy(true); setRolling(true); setMovable({ horses: new Set(), landing: null });
    const v = 1 + Math.floor(Math.random() * 6);
    await sleep(620); setRolling(false); setDie(v);
    g.die = v; g.sixStreak = v === 6 ? g.sixStreak + 1 : 0; render();

    if (g.sixStreak >= 3) {
      setStatus('Ba số 6 liên tiếp — mất lượt! 🎲'); await sleep(950);
      setBusy(false); endTurn(); return;
    }
    const moves = Engine.legalMoves(g);
    if (!moves.length) {
      setStatus(PLAYERS[g.turn].name + ': không có nước đi hợp lệ'); await sleep(950);
      setBusy(false); endTurn(); return;
    }
    if (isAI(g.turn)) {
      const m = Engine.aiChoose(g, moves);
      await sleep(aiDelay);
      await execMove(m);
    } else {
      setMovable({ horses: new Set(moves.map(m => m.horse.player + '-' + m.horse.idx)), landing: landingSet(g, moves) });
      setStatus('Đổ ' + v + ' — chọn quân phát sáng để di chuyển');
      g.phase = 'select'; setBusy(false); render();
    }
  }

  async function onPick(h) {
    const g = gameRef.current;
    if (g.phase !== 'select' || busy) return;
    const moves = Engine.legalMoves(g);
    const m = moves.find(mv => mv.horse === h);
    if (!m) return;
    setBusy(true);
    await execMove(m);
  }

  async function execMove(m) {
    const g = gameRef.current;
    const h = m.horse;
    setMovable({ horses: new Set(), landing: null });
    if (m.deploy) {
      h.step = 0; render(); await sleep(280);
    } else {
      for (let s = h.step + 1; s <= m.to; s++) { h.step = s; render(); await sleep(165); }
    }
    // capture
    const caps = resolveCapture(g, h);
    if (caps.length) {
      const np = caps.map(c => ({ id: ++poofId.current, r: c.cell[0], c: c.cell[1] }));
      setPoofs(p => [...p, ...np]); render();
      setTimeout(() => setPoofs(p => p.filter(x => !np.find(n => n.id === x.id))), 520);
      flash('⚔️ Hạ gục!');
    }
    const finished = h.step >= STEP_DONE;
    if (finished) flash('✦ Về đích!');
    render();

    // win?
    if (Engine.playerDone(g, h.player)) {
      g.winner = h.player; render(); setBusy(false); return;
    }
    const extra = (g.die === 6 && g.sixStreak < 3) || caps.length > 0 || finished;
    setBusy(false);
    if (extra) continueTurn(); else endTurn();
  }

  function continueTurn() {
    const g = gameRef.current;
    g.die = null; g.phase = 'roll'; setDie(null);
    setStatus((isAI(g.turn) ? PLAYERS[g.turn].name : 'Bạn') + ' được đi tiếp!');
    render(); scheduleTurn();
  }
  function endTurn() {
    const g = gameRef.current;
    Engine.nextTurn(g); setDie(null);
    setMovable({ horses: new Set(), landing: null });
    setStatus(turnPrompt(g)); render(); scheduleTurn();
  }
  function turnPrompt(g) {
    return isAI(g.turn)
      ? 'Lượt của ' + PLAYERS[g.turn].name + ' (AI)…'
      : 'Lượt của bạn — đổ xúc xắc';
  }
  function scheduleTurn() {
    const g = gameRef.current;
    if (g.winner != null) return;
    if (isAI(g.turn)) setTimeout(() => doRoll(), 650);
  }

  function newGame() {
    gameRef.current = Engine.newGame();
    setDie(null); setBusy(false); setRolling(false);
    setMovable({ horses: new Set(), landing: null });
    setStatus('Ván mới! Bấm “Đổ xúc xắc”'); setPoofs([]); render();
    setTimeout(scheduleTurn, 400);
  }

  // kick off AI if first player is AI (won't be, human is 0) — and on mount fit
  useEffect(() => { scheduleTurn(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setTimeout(fit, 60); /* eslint-disable-next-line */ }, [t.variant]);

  const g = gameRef.current;
  const canRoll = !isAI(g.turn) && g.phase === 'roll' && !busy && !rolling && g.winner == null;

  // ambient particles
  const particles = React.useMemo(() =>
    Array.from({ length: 26 }, (_, i) => ({
      left: Math.random() * 100, size: 3 + Math.random() * 6,
      dur: 9 + Math.random() * 10, delay: -Math.random() * 16,
    })), []);

  return React.createElement('div', { className: 'wrap' },
    React.createElement('div', { className: 'ambient' },
      particles.map((p, i) => React.createElement('i', { key: i, style: {
        left: p.left + '%', bottom: '-20px', width: p.size, height: p.size,
        animationDuration: p.dur + 's', animationDelay: p.delay + 's',
      } }))),

    React.createElement('div', { className: 'stage-fit', ref: fitRef },
      React.createElement('div', { ref: sceneRef, style: { display: 'inline-block' } },
        React.createElement(Board, { state: g, movable, onPick, poofs }))),

    React.createElement(HUD, { state: g, mode }),

    React.createElement('div', { className: 'die-dock' },
      React.createElement('div', { className: 'status' }, status),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        React.createElement(Die, { value: die || 1, rolling }),
        React.createElement('button', { className: 'roll-btn', disabled: !canRoll, onClick: doRoll },
          rolling ? '…' : 'Đổ xúc xắc'))),

    toast && React.createElement('div', { className: 'toast show' }, toast),

    g.winner != null && React.createElement('div', { className: 'win-overlay' },
      React.createElement('div', { className: 'win-card', style: { ['--pc']: PLAYERS[g.winner].hue } },
        React.createElement('h1', { style: { color: PLAYERS[g.winner].hue } }, PLAYERS[g.winner].name + ' chiến thắng!'),
        React.createElement('p', {}, 'Đưa cả 4 quân về Thánh Tích trung tâm.'),
        React.createElement('button', { className: 'roll-btn', onClick: newGame }, 'Chơi ván mới'))),

    React.createElement(TweaksPanel, { title: 'Cài đặt' },
      React.createElement(TweakSection, { label: 'Chủ đề' }),
      React.createElement(TweakSelect, { label: 'Chủ đề', value: t.variant,
        options: Object.keys(THEMES).map(k => ({ value: k, label: THEMES[k].label })),
        onChange: v => setTweak('variant', v) }),
      React.createElement('div', { style: { fontSize: 11, opacity: .7, padding: '0 2px 6px', lineHeight: 1.4 } },
        (THEMES[t.variant] || THEMES.dawn).blurb),
      React.createElement(TweakSection, { label: 'Góc nhìn' }),
      React.createElement(TweakSlider, { label: 'Độ nghiêng', value: t.tilt, min: 30, max: 68, step: 1, unit: '°',
        onChange: v => setTweak('tilt', v) })
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
