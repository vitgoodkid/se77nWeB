/* ===========================================================================
   LUDO HEROES — Cờ Cá Ngựa 8 Hệ Phái.  Pure game logic, no UI.
   Exposes window.Engine.

   BOARD GEOMETRY — CLASSIC CROSS (15x15 grid, [row,col] 0-indexed)
   ───────────────────────────────────────────────────────────────
   • RING : the 52-cell clockwise cross track (steps 0..50 are walked by each
            seat; the array has 52 cells for modulo positioning).
   • CORNERS ("Đỉnh") : the 4 crossover tip cells (RING idx 11/24/37/50) — the
            outermost point of each arm, which sit at the 4 board corners once
            the board is rotated 45°.  Each tip is ALSO a seat's home door.
   • STARTS : the 4 coloured deploy squares (RING idx 0/13/26/39).
   • DOORS  : each seat's home gate == its tip (step 50 for every seat).
   • HOME   : 6-cell coloured column (bậc 1..6) per seat, leading to CENTER.
   • BASE   : 4 stable slots per seat in its corner 6x6 block.

   LOGICAL STEP per horse: -1 = base, 0..50 = ring (50 = home door),
   51..56 = home bậc1..6, 57 = centre = DONE.
   =========================================================================== */
const ENGINE = (function () {
  const N = 15;

  // 52-cell clockwise cross track (identical to the classic board)
  const RING = [
    [6,1],[6,2],[6,3],[6,4],[6,5],          // 0-4   left arm → right
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],     // 5-10  up col 6
    [0,7],                                    // 11    TOP TIP (Đỉnh)
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],     // 12-17 down col 8
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],// 18-23 right along row 6
    [7,14],                                   // 24    RIGHT TIP (Đỉnh)
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],// 25-30 left along row 8
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],// 31-36 down col 8
    [14,7],                                   // 37    BOTTOM TIP (Đỉnh)
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],// 38-43 up col 6
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],     // 44-49 left along row 8
    [7,0],                                    // 50    LEFT TIP (Đỉnh)
    [6,0],                                    // 51    back near start
  ];
  const RING_LEN = RING.length;               // 52

  const START_IDX   = [0, 13, 26, 39];
  const HOME_DOOR_STEP = 50;                  // every seat's door sits at step 50
  const STEP_DONE      = 57;                  // step >= 57 → reached centre
  const TRACK_MAX      = 50;                  // last ring step (== the door tip)
  const DOOR_IDX     = START_IDX.map(s => (s + HOME_DOOR_STEP) % RING_LEN); // 50,11,24,37
  const CORNERS_IDX  = [11, 24, 37, 50];      // the 4 Đỉnh / tips

  // 6-cell home columns (classic), pointing inward to CENTER [7,7]
  const HOME = [
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],     // seat 0 — row 7, east
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],     // seat 1 — col 7, south
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]], // seat 2 — row 7, west
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]], // seat 3 — col 7, north
  ];
  // 4 stable slots per seat, inside its corner 6x6 block
  const BASE = [
    [[1,1],[1,4],[4,1],[4,4]],         // seat 0 TL
    [[1,10],[1,13],[4,10],[4,13]],     // seat 1 TR
    [[10,10],[10,13],[13,10],[13,13]], // seat 2 BR
    [[10,1],[10,4],[13,1],[13,4]],     // seat 3 BL
  ];

  const CENTER = [7, 7];
  const SAFE = new Set(START_IDX.map(i => RING[i].join(',')));          // start cells
  const CORNER_KEYS = new Set(CORNERS_IDX.map(i => RING[i].join(',')));  // Đỉnh cells

  // ---- the 8 factions -------------------------------------------------------
  const FACTIONS = {
    red:    { key:'red',    name:'Sát Thủ',   tribe:'Hỏa',  hue:'#ff4d57', icon:'🗡️', cls:'assassin',
              skill:'Trọng Thương',  short:'Đá địch không được đi thêm; nạn nhân mất lượt kế.',
              desc:'Khi đá ngựa địch, Đỏ KHÔNG được đi thêm lượt. Kẻ bị đá dính "Trọng Thương" — mất (skip) lượt đổ xúc xắc tiếp theo.' },
    green:  { key:'green',  name:'Vệ Thần',   tribe:'Mộc',  hue:'#34d17a', icon:'🛡️', cls:'guardian',
              skill:'Khiên Thánh',   short:'Xuất quân có 1 khiên, chặn 1 lần bị đá.',
              desc:'Khi xuất quân tự có 1 Khiên. Khiên chặn đúng 1 lần bị đá (khiên vỡ, cả hai đứng chung ô). Phải về Base xuất quân lại mới có khiên mới.' },
    blue:   { key:'blue',   name:'Pháp Sư',   tribe:'Băng', hue:'#3f9dff', icon:'❄️', cls:'mage',
              skill:'Bẫy Băng',      short:'Đổ ra 5 để lại bẫy băng ở ô vừa rời.',
              desc:'Khi đổ ra 5, để lại 1 Bẫy Băng ở ô vừa rời. Ai dẫm vào bị Đóng băng (mất lượt kế). Bẫy biến mất sau khi bị dẫm.' },
    gold:   { key:'gold',   name:'Quý Tộc',   tribe:'Quang',hue:'#ffc83d', icon:'👑', cls:'noble',
              skill:'Thẻ VIP',       short:'Miễn Thiên Lôi; vào chuồng bằng 4/5/6.',
              desc:'(1) Miễn nhiễm Thiên Lôi — đổ ba lần 6 vô tư. (2) Ở cửa chuồng, đổ 4, 5 hoặc 6 đều bước vào Bậc 1 (không bị ép phải ra 6).' },
    black:  { key:'black',  name:'Bóng Đêm',  tribe:'Ám',   hue:'#7b8194', icon:'🌑', cls:'shadow',
              skill:'Bóng Huynh Đệ', short:'Đi xuyên qua quân Đen cùng phe.',
              desc:'Được phép đi xuyên qua các quân cờ CÙNG MÀU ĐEN đứng trước mặt (vẫn bị quân màu khác cản).' },
    white:  { key:'white',  name:'Tâm Linh',  tribe:'Linh', hue:'#e6ebff', icon:'⛓️', cls:'spirit',
              skill:'Nhân Quả',      short:'Bị đá thì nguyền kẻ thủ ác −2 điểm.',
              desc:'Khi bị đá về chuồng, kẻ thủ ác bị nguyền: lượt đổ xúc xắc ngay kế bị TRỪ 2 ĐIỂM (đổ ≤2 → 0, mất lượt).' },
    purple: { key:'purple', name:'Không Gian',tribe:'Hư',   hue:'#a85cff', icon:'🌀', cls:'void',
              skill:'Neo Hư Không',  short:'Bị đá thì rơi về Đỉnh sau lưng, choáng.',
              desc:'Khi bị đá, KHÔNG về chuồng — rơi xuống "Đỉnh" gần nhất sau lưng và dính Choáng (khóa cứng lượt kế).' },
    orange: { key:'orange', name:'Đấu Sĩ',    tribe:'Thiết',hue:'#ff8a3d', icon:'💥', cls:'fighter',
              skill:'Đẩy Lùi',       short:'Bị đá thì văng lùi 12 ô (Domino).',
              desc:'Khi bị đá, văng ngược lại đúng 12 ô. Nếu điểm rơi trúng quân khác (địch/ta) → Domino, đá luôn quân đó về chuồng.' },
  };
  const FACTION_ORDER = ['red','green','blue','gold','black','white','purple','orange'];

  // ---- geometry helpers -----------------------------------------------------
  function cellOf(seat, step) {
    if (step < 0) return null;
    if (step <= TRACK_MAX) return RING[(START_IDX[seat] + step) % RING_LEN];
    if (step <= 56) return HOME[seat][step - 51];
    return CENTER;
  }
  function ringIdxAt(seat, step) {
    return (step >= 0 && step <= TRACK_MAX) ? (START_IDX[seat] + step) % RING_LEN : -1;
  }
  function nextCornerIdx(idx) {
    let best = null, bestD = 99;
    for (const c of CORNERS_IDX) { const d = (c - idx + RING_LEN) % RING_LEN; if (d > 0 && d < bestD) { bestD = d; best = c; } }
    return best;
  }
  function prevCornerIdx(idx) {
    let best = null, bestD = 99;
    for (const c of CORNERS_IDX) { const d = (idx - c + RING_LEN) % RING_LEN; if (d > 0 && d < bestD) { bestD = d; best = c; } }
    return best;
  }
  function factionKey(state, seat) { return state.seats[seat].faction; }

  // ---- occupancy lookups ----------------------------------------------------
  function ringOccupants(state, ringIdx, except) {
    const out = [];
    for (const row of state.horses) for (const h of row) {
      if (h === except) continue;
      if (ringIdxAt(h.seat, h.step) === ringIdx) out.push(h);
    }
    return out;
  }
  function homeOccupants(state, seat, stage, except) { // stage 0..5 → step 51..56
    const out = [];
    for (const h of state.horses[seat]) {
      if (h === except) continue;
      if (h.step >= 51 && h.step < STEP_DONE && (h.step - 51) === stage) out.push(h);
    }
    return out;
  }

  // ---- legality helpers -----------------------------------------------------
  function ringPathClear(state, mover, fromStep, toStep) {
    const black = factionKey(state, mover.seat) === 'black';
    for (let s = fromStep + 1; s < toStep; s++) {
      const idx = (START_IDX[mover.seat] + s) % RING_LEN;
      const occ = ringOccupants(state, idx, mover);
      for (const o of occ) { if (black && o.seat === mover.seat) continue; return false; }
    }
    return true;
  }
  function ringLanding(state, mover, toStep) {
    const idx = (START_IDX[mover.seat] + toStep) % RING_LEN;
    if (SAFE.has(RING[idx].join(','))) return { ok: true, capture: [] };
    const occ = ringOccupants(state, idx, mover);
    if (occ.some(o => o.seat === mover.seat)) return { ok: false, capture: [] }; // ally block
    return { ok: true, capture: occ.filter(o => o.seat !== mover.seat) };
  }
  function homePathClear(state, mover, fromStep, toStep) {
    for (let s = Math.max(fromStep + 1, 51); s < toStep; s++) {
      if (homeOccupants(state, mover.seat, s - 51, mover).length) return false;
    }
    return true;
  }

  // ---- state ----------------------------------------------------------------
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pickFactions() { return shuffle(FACTION_ORDER.slice()).slice(0, 4); }

  function newGame(assign) {
    const facs = (assign && assign.length === 4) ? assign : pickFactions();
    return {
      seats: facs.map((k, seat) => ({ seat, faction: k,
        name: FACTIONS[k].name, tribe: FACTIONS[k].tribe, hue: FACTIONS[k].hue,
        icon: FACTIONS[k].icon, cls: FACTIONS[k].cls, skill: FACTIONS[k].skill })),
      horses: [0,1,2,3].map(seat => [0,1,2,3].map(idx => ({ seat, idx, step:-1, shield:false }))),
      turn: 0, die: null, rawDie: null, sixStreak: 0,
      phase: 'roll', winner: null,
      status: [0,1,2,3].map(() => ({ skip: 0, curse: 0 })),
      traps: {},        // { ringIdx: ownerSeat }
      log: [],
    };
  }

  function playerDone(state, seat) { return state.horses[seat].every(h => h.step >= STEP_DONE); }

  function furthestHorse(state, seat) {
    let best = null;
    for (const h of state.horses[seat]) {
      if (h.step >= 0 && h.step < STEP_DONE && (!best || h.step > best.step)) best = h;
    }
    return best;
  }

  // ---- legal moves for the current die --------------------------------------
  function legalMoves(state) {
    const seat = state.turn, die = state.die;
    if (die == null || die < 1) return [];
    const vip = factionKey(state, seat) === 'gold';
    const moves = [];
    for (const h of state.horses[seat]) {
      const s = h.step;
      if (s < 0) {
        if (die === 6) moves.push({ horse: h, kind: 'deploy', from: -1, to: 0 });
        continue;
      }
      if (s < TRACK_MAX) {                         // on the ring, not yet at door
        const to = s + die;
        if (to <= TRACK_MAX && ringPathClear(state, h, s, to)) {
          const land = ringLanding(state, h, to);
          if (land.ok) moves.push({ horse: h, kind: 'ring', from: s, to, capture: land.capture });
        }
        if (die === 1) {                           // ── Nhót: teleport to next Đỉnh ──
          const curIdx = (START_IDX[seat] + s) % RING_LEN;
          const C = nextCornerIdx(curIdx);
          const d = (C - curIdx + RING_LEN) % RING_LEN;
          const newStep = s + d;
          if (d > 0 && newStep <= TRACK_MAX && ringPathClear(state, h, s, newStep)) {
            const land = ringLanding(state, h, newStep);
            if (land.ok) moves.push({ horse: h, kind: 'nhot', from: s, to: newStep, cornerIdx: C, capture: land.capture });
          }
        }
      } else if (s === HOME_DOOR_STEP) {           // at the home door
        const can = die === 6 || (vip && (die === 4 || die === 5 || die === 6));
        if (can && homeOccupants(state, seat, 0, h).length === 0)
          moves.push({ horse: h, kind: 'enter', from: s, to: 51 });
      } else if (s >= 51 && s < STEP_DONE) {       // climbing the home column
        const to = s + die;
        if (to <= STEP_DONE && homePathClear(state, h, s, to) && homeOccupants(state, seat, to - 51, h).length === 0)
          moves.push({ horse: h, kind: 'home', from: s, to });
      }
    }
    return moves;
  }

  // ---- capture resolution (returns true if a "real" capture happened) -------
  function resolveCapture(state, attacker, victim, ev) {
    const aFac = factionKey(state, attacker.seat);
    const vFac = factionKey(state, victim.seat);
    const cell = cellOf(victim.seat, victim.step);
    const tag = { attackerSeat: attacker.seat, victimSeat: victim.seat, victimIdx: victim.idx, cell };

    // 🟢 Khiên Thánh — shield soaks the hit, no capture
    if (vFac === 'green' && victim.shield) {
      victim.shield = false;
      ev.push({ t: 'shield', ...tag });
      return false;
    }
    // 🟣 Neo Hư Không — drop to the Đỉnh behind + stun
    if (vFac === 'purple') {
      const curIdx = (START_IDX[victim.seat] + victim.step) % RING_LEN;
      const C = prevCornerIdx(curIdx);
      victim.step = (C - START_IDX[victim.seat] + RING_LEN) % RING_LEN;
      victim.shield = false;
      state.status[victim.seat].skip += 1;
      ev.push({ t: 'capture', ...tag, dest: 'corner', toCell: RING[C] });
      ev.push({ t: 'stun', victimSeat: victim.seat });
    }
    // 🟠 Đẩy Lùi — knocked back 12, Domino on landing
    else if (vFac === 'orange') {
      const newStep = Math.max(0, victim.step - 12);
      victim.step = newStep; victim.shield = false;
      const toIdx = (START_IDX[victim.seat] + newStep) % RING_LEN;
      ev.push({ t: 'capture', ...tag, dest: 'push', toCell: RING[toIdx] });
      ev.push({ t: 'pushback', victimSeat: victim.seat, fromCell: cell, toCell: RING[toIdx] });
      if (!SAFE.has(RING[toIdx].join(','))) {
        for (const o of ringOccupants(state, toIdx, victim)) {
          const oc = cellOf(o.seat, o.step); o.step = -1; o.shield = false;
          ev.push({ t: 'domino', victimSeat: o.seat, victimIdx: o.idx, cell: oc });
        }
      }
    }
    // ⚪ Nhân Quả — sent home, but curses the attacker
    else if (vFac === 'white') {
      victim.step = -1; victim.shield = false;
      state.status[attacker.seat].curse += 1;
      ev.push({ t: 'capture', ...tag, dest: 'base' });
      ev.push({ t: 'curse', attackerSeat: attacker.seat });
    }
    // everyone else — straight back to base
    else {
      victim.step = -1; victim.shield = false;
      ev.push({ t: 'capture', ...tag, dest: 'base' });
    }

    // 🔴 Trọng Thương — Đỏ's victims always bleed (skip next roll)
    if (aFac === 'red') { state.status[victim.seat].skip += 1; ev.push({ t: 'bleed', victimSeat: victim.seat }); }
    return true;
  }

  // ---- apply a chosen move --------------------------------------------------
  function applyMove(state, move) {
    const h = move.horse, seat = h.seat;
    const fac = factionKey(state, seat);
    const ev = [];
    let capturedSomeone = false;
    const fromStep = h.step;

    if (move.kind === 'deploy') {
      h.step = 0;
      if (fac === 'green') h.shield = true;
      ev.push({ t: 'deploy', seat });
      return { events: ev, capturedSomeone, finished: false, attackerFaction: fac };
    }

    if (move.kind === 'enter' || move.kind === 'home') {
      h.step = move.to;
      const finished = h.step >= STEP_DONE;
      if (finished) ev.push({ t: 'finish', seat });
      return { events: ev, capturedSomeone, finished, attackerFaction: fac };
    }

    // ring / nhot — both land on a ring cell
    h.step = move.to;
    if (move.kind === 'nhot') ev.push({ t: 'nhot', seat, cornerIdx: move.cornerIdx, cell: cellOf(seat, move.to) });

    const landIdx = (START_IDX[seat] + move.to) % RING_LEN;
    const landCell = RING[landIdx];
    if (!SAFE.has(landCell.join(','))) {
      for (const o of ringOccupants(state, landIdx, h).filter(o => o.seat !== seat))
        capturedSomeone = resolveCapture(state, h, o, ev) || capturedSomeone;
    }
    // step on an ice trap?
    if (state.traps[landIdx] != null) {
      delete state.traps[landIdx];
      state.status[seat].skip += 1;
      ev.push({ t: 'freeze', seat, cell: landCell });
    }
    // 🔵 Bẫy Băng — blue rolling a 5 drops a trap on the cell it just left
    if (fac === 'blue' && state.die === 5 && fromStep >= 0 && fromStep <= TRACK_MAX) {
      const leftIdx = (START_IDX[seat] + fromStep) % RING_LEN;
      if (!SAFE.has(RING[leftIdx].join(',')) && state.traps[leftIdx] == null) {
        state.traps[leftIdx] = seat;
        ev.push({ t: 'trap-set', seat, ringIdx: leftIdx, cell: RING[leftIdx] });
      }
    }
    const finished = h.step >= STEP_DONE;
    if (finished) ev.push({ t: 'finish', seat });
    return { events: ev, capturedSomeone, finished, attackerFaction: fac };
  }

  // ---- turn helpers ---------------------------------------------------------
  function nextTurn(state) {
    let t = state.turn;
    for (let i = 0; i < 4; i++) { t = (t + 1) % 4; if (!playerDone(state, t)) break; }
    state.turn = t; state.die = null; state.rawDie = null; state.sixStreak = 0; state.phase = 'roll';
  }
  function sendFurthestToBase(state, seat) {
    const h = furthestHorse(state, seat);
    if (!h) return null;
    const cell = cellOf(h.seat, h.step);
    h.step = -1; h.shield = false;
    return { horse: h, cell };
  }

  // ---- AI: score the legal move list ----------------------------------------
  function aiChoose(state, moves) {
    if (!moves.length) return null;
    const seat = state.turn;
    const score = (m) => {
      let s = 0;
      if (m.kind === 'enter' || m.kind === 'home') { s += (m.to >= STEP_DONE) ? 1000 : 200 + m.to; }
      if (m.kind === 'deploy') s += 120;
      if ((m.kind === 'ring' || m.kind === 'nhot') && m.capture && m.capture.length) {
        s += 420 + m.capture.reduce((a, o) => a + o.step, 0) * 2;
      }
      if (m.kind === 'nhot') s += 60;
      if (m.to >= 0 && m.to <= TRACK_MAX && state.traps[(START_IDX[seat] + m.to) % RING_LEN] != null) s -= 200;
      s += (m.to >= 0 ? m.to : 0);
      s += Math.random() * 6;
      return s;
    };
    return moves.slice().sort((a, b) => score(b) - score(a))[0];
  }

  // ---- Vietnamese log line for an event -------------------------------------
  function label(state, seat) { const s = state.seats[seat]; return s.icon + ' ' + s.name; }
  function describeEvent(state, ev) {
    const L = (seat) => label(state, seat);
    switch (ev.t) {
      case 'deploy':   return L(ev.seat) + ' xuất quân ra sân.';
      case 'nhot':     return L(ev.seat) + ' dùng Nhót, dịch chuyển tới Đỉnh!';
      case 'capture':  return L(ev.attackerSeat) + ' đá ' + L(ev.victimSeat) +
                              (ev.dest === 'corner' ? ' văng về Đỉnh!' : ev.dest === 'push' ? ' bay lùi 12 ô!' : ' về chuồng!');
      case 'shield':   return '🛡️ Khiên Thánh của ' + L(ev.victimSeat) + ' vỡ — thoát một mạng!';
      case 'bleed':    return '🩸 ' + L(ev.victimSeat) + ' dính Trọng Thương — mất lượt kế!';
      case 'curse':    return '⛓️ Nhân Quả giáng xuống ' + L(ev.attackerSeat) + ' — lượt kế −2 điểm!';
      case 'stun':     return '🌀 ' + L(ev.victimSeat) + ' bị Choáng — khóa lượt kế!';
      case 'pushback': return '💥 ' + L(ev.victimSeat) + ' bị Đẩy Lùi 12 ô!';
      case 'domino':   return '🎳 Domino! ' + L(ev.victimSeat) + ' bị văng về chuồng!';
      case 'trap-set': return '❄️ ' + L(ev.seat) + ' gài một Bẫy Băng.';
      case 'freeze':   return '🧊 ' + L(ev.seat) + ' dẫm Bẫy Băng — Đóng băng mất lượt!';
      case 'finish':   return '✦ ' + L(ev.seat) + ' đưa một quân về đích!';
      default:         return '';
    }
  }

  const Engine = {
    N, RING, RING_LEN, CORNERS_IDX, START_IDX, DOOR_IDX, HOME, BASE, CENTER,
    SAFE, CORNER_KEYS, FACTIONS, FACTION_ORDER,
    STEP_DONE, HOME_DOOR_STEP, TRACK_MAX,
    cellOf, ringIdxAt, nextCornerIdx, prevCornerIdx, factionKey,
    ringOccupants, homeOccupants,
    newGame, playerDone, furthestHorse, legalMoves, applyMove,
    nextTurn, sendFurthestToBase, aiChoose,
    label, describeEvent, pickFactions,
  };

  // Dual-mode: browser global for the CDN-loaded client, ESM export for the
  // Vercel serverless side (api/_lib/ludo-rooms.js imports this same file so
  // server + client never drift on the rules).
  if (typeof window !== 'undefined') window.Engine = Engine;
  return Engine;
})();

// ESM exports — only the server uses these. The IIFE above still runs in the
// browser (where `export` is a no-op statement that module scripts allow) and
// sets window.Engine. Node imports the named/default bindings below.
export default ENGINE;
export const {
  N, RING, RING_LEN, CORNERS_IDX, START_IDX, DOOR_IDX, HOME, BASE, CENTER,
  SAFE, CORNER_KEYS, FACTIONS, FACTION_ORDER,
  STEP_DONE, HOME_DOOR_STEP, TRACK_MAX,
  cellOf, ringIdxAt, nextCornerIdx, prevCornerIdx, factionKey,
  ringOccupants, homeOccupants,
  newGame, playerDone, furthestHorse, legalMoves, applyMove,
  nextTurn, sendFurthestToBase, aiChoose,
  label, describeEvent, pickFactions,
} = ENGINE;
