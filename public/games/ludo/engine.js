/* ===========================================================================
   Cờ Cá Ngựa (Vietnamese Ludo) — game engine.  Pure logic, no UI.
   Exposes window.Engine = { PATH, HOME, START, STABLE, PLAYERS, ... fns }
   Board is a 15x15 grid. Coordinates are [row, col], 0-indexed.
   =========================================================================== */
(function () {
  const N = 15;

  // The 52-cell clockwise outer track.
  const PATH = [
    [6,1],[6,2],[6,3],[6,4],[6,5],          // 0-4  left arm, top row, going right
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],     // 5-10 up col 6
    [0,7],                                    // 11   top crossover
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],     // 12-17 down col 8
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],// 18-23 top arm? right along row 6
    [7,14],                                   // 24   right crossover
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],// 25-30 left along row 8
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],// 31-36 down col 8
    [14,7],                                   // 37   bottom crossover
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],// 38-43 up col 6
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],     // 44-49 left along row 8
    [7,0],                                    // 50    left crossover
    [6,0],                                    // 51    back near start
  ];

  // Per-player entry index on PATH (where a deployed horse appears).
  const START = [0, 13, 26, 39];

  // Per-player 6-cell home stretch leading to centre [7,7].
  const HOME = [
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],     // P0 red   — middle row, going right
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],     // P1 gold  — middle col, going down
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]], // P2 green — middle row, going left
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]], // P3 blue  — middle col, going up
  ];

  // Stable slot cells (4 per player) in their corner 6x6 block.
  const STABLE = [
    [[1,1],[1,4],[4,1],[4,4]],         // P0 red   top-left
    [[1,10],[1,13],[4,10],[4,13]],     // P1 gold  top-right
    [[10,10],[10,13],[13,10],[13,13]], // P2 green bottom-right
    [[10,1],[10,4],[13,1],[13,4]],     // P3 blue  bottom-left
  ];

  const PLAYERS = [
    { id:0, name:'Hiệp Sĩ',  cls:'knight', hue:'#ff5763', corner:'tl' },
    { id:1, name:'Pháp Sư',  cls:'mage',   hue:'#ffc24b', corner:'tr' },
    { id:2, name:'Cung Thủ', cls:'ranger', hue:'#3fd17a', corner:'br' },
    { id:3, name:'Sát Thủ',  cls:'rogue',  hue:'#4aa8ff', corner:'bl' },
  ];

  const CENTER = [7,7];
  const STEP_DONE = 57;       // step index meaning "reached centre"
  const TRACK_LEN = 51;       // steps 0..50 are on the outer track

  // Safe cells: the 4 coloured start squares can't be captured.
  const SAFE = new Set(START.map(i => PATH[i].join(',')));

  // ---- geometry helpers -----------------------------------------------------
  // Returns [row,col] for a horse's logical step (or null if stable/done at centre).
  function cellOf(player, step) {
    if (step < 0) return null;                 // stable
    if (step <= 50) return PATH[(START[player] + step) % 52];
    if (step <= 56) return HOME[player][step - 51];
    return CENTER;                             // done
  }

  // ---- state ----------------------------------------------------------------
  function newGame() {
    return {
      horses: PLAYERS.map((_, p) =>
        [0,1,2,3].map(h => ({ player:p, idx:h, step:-1 }))   // step -1 = stable
      ),
      turn: 0,
      die: null,
      sixStreak: 0,
      phase: 'roll',     // 'roll' | 'select' | 'gameover'
      winner: null,
      log: [],
    };
  }

  function horseAt(state, cell, exceptHorse) {
    // returns list of horses sitting on a given track/home cell
    const key = cell.join(',');
    const out = [];
    for (const row of state.horses) for (const h of row) {
      if (h === exceptHorse) continue;
      if (h.step < 0 || h.step >= STEP_DONE) continue;
      const c = cellOf(h.player, h.step);
      if (c && c.join(',') === key) out.push(h);
    }
    return out;
  }

  // ---- legal moves for current die ------------------------------------------
  function legalMoves(state) {
    const p = state.turn, die = state.die;
    if (die == null) return [];
    const moves = [];
    for (const h of state.horses[p]) {
      if (h.step < 0) {
        // in stable — only a 6 deploys to entry
        if (die === 6) moves.push({ horse:h, from:-1, to:0, deploy:true });
      } else {
        const to = h.step + die;
        if (to <= STEP_DONE) moves.push({ horse:h, from:h.step, to, deploy:false });
      }
    }
    return moves;
  }

  // Apply a move, resolve captures. Returns {captured:[...], finished:bool}.
  function applyMove(state, move) {
    const h = move.horse;
    h.step = move.to;
    const result = { captured: [], finished: false };

    if (h.step >= STEP_DONE) { result.finished = true; }

    // capture only when landing on an outer-track cell
    if (h.step >= 0 && h.step <= 50) {
      const cell = cellOf(h.player, h.step);
      if (!SAFE.has(cell.join(','))) {
        const others = horseAt(state, cell, h).filter(o => o.player !== h.player);
        for (const o of others) { o.step = -1; result.captured.push(o); }
      }
    }
    return result;
  }

  function playerDone(state, p) {
    return state.horses[p].every(h => h.step >= STEP_DONE);
  }

  // Advance to next player (skips finished players).
  function nextTurn(state) {
    let t = state.turn;
    for (let i = 0; i < 4; i++) {
      t = (t + 1) % 4;
      if (!playerDone(state, t)) break;
    }
    state.turn = t;
    state.die = null;
    state.sixStreak = 0;
    state.phase = 'roll';
  }

  // ---- AI: choose a move from legal list ------------------------------------
  function aiChoose(state, moves) {
    if (!moves.length) return null;
    const p = state.turn;
    const score = (m) => {
      let s = 0;
      // finishing a horse is best
      if (m.to >= STEP_DONE) s += 1000;
      // entering home stretch is good
      if (m.to > 50 && m.to < STEP_DONE) s += 120 + m.to;
      // capture?
      if (!m.deploy && m.to <= 50) {
        const cell = cellOf(p, m.to);
        if (!SAFE.has(cell.join(','))) {
          const enemies = horseAt(state, cell, m.horse)
            .filter(o => o.player !== p);
          if (enemies.length) s += 400 + enemies.reduce((a,o)=>a+o.step,0);
        }
      }
      // deploying gets a horse into play
      if (m.deploy) s += 80;
      // otherwise prefer advancing the furthest horse
      s += m.to;
      // small randomness to avoid robotic ties
      s += Math.random() * 5;
      return s;
    };
    return moves.slice().sort((a,b)=>score(b)-score(a))[0];
  }

  window.Engine = {
    N, PATH, START, HOME, STABLE, PLAYERS, CENTER, SAFE,
    STEP_DONE, TRACK_LEN,
    cellOf, newGame, legalMoves, applyMove, horseAt,
    playerDone, nextTurn, aiChoose,
  };
})();
