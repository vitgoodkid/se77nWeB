// Ludo online multiplayer — room CRUD + server-authoritative turn engine.
//
// `_lib` prefix → Vercel does NOT expose this as an HTTP route, so it doesn't
// count against the Hobby 12-function cap. It's invoked by api/toolbox.js via
//   /api/toolbox?kind=ludo&action=<action>
//
// The whole game is server-authoritative: the Mongo `ludo_rooms` doc holds the
// engine state, and every roll/move is validated + applied here with
// server-side randomness so clients can't desync or cheat dice/AI. Clients
// poll GET ?action=state to stay in sync (no Redis/WebSocket on this stack).
//
// AI seats (and disconnected humans) are driven SYNCHRONOUSLY inside the
// request handlers (runAiTurns) — Vercel functions are frozen between requests
// so setTimeout/background timers don't survive. A request that mutates the
// game returns only once it's a connected human's turn or the game is over.
import { ObjectId } from 'mongodb';
import Engine from '../../public/games/ludo/engine.js';
import { getDb, getUsers } from './mongo.js';
import { readSession } from './session.js';

const { factionKey, legalMoves, applyMove, aiChoose, sendFurthestToBase,
        playerDone, describeEvent, FACTION_ORDER } = Engine;

// ── tunables ────────────────────────────────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const CODE_LEN = 4;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;          // rooms expire 6h after last activity
const DISCONNECT_MS = 12 * 1000;                  // no poll for 12s → seat marked offline
const TURN_TIMEOUT_MS = 60 * 1000;                // human dawdling 60s → AI plays the turn
const LOG_CAP = 40;
const EVENTLOG_CAP = 30;
const AI_LOOP_CAP = 200;                          // safety: bound consecutive AI rolls

// ═════════════════════════════════════════════════════════════════
// PURE ORCHESTRATION — mirrors public/games/ludo/app.jsx doRoll/execMove.
// No DB, no req/res. Mutates `state` in place and returns event batches.
// ═════════════════════════════════════════════════════════════════

function pushLog(state, line) {
  if (!line) return;
  state._seq = (state._seq || 0) + 1;
  state.log.unshift({ id: state._seq, line });
  if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;
}

function logEngineEvents(state, events) {
  for (const ev of events) {
    const line = describeEvent(state, ev);
    if (line) pushLog(state, line);
  }
}

function seatLabel(state, seat) {
  const s = state.seats[seat];
  return s.icon + ' ' + s.name;
}

// One die roll for the current seat. Mirrors doRoll up to the point a human
// would be asked to pick. Returns { events, turnEnded }. When turnEnded is
// false, state.phase === 'select' and the caller must resolve a move.
function doRollServer(state) {
  const events = [];
  const seat = state.turn;
  const stt = state.status[seat];
  const fac = factionKey(state, seat);

  // skip-turn debuffs (Trọng Thương / Choáng / Đóng băng) consume the roll
  if (stt.skip > 0) {
    stt.skip -= 1;
    pushLog(state, '⏸️ ' + seatLabel(state, seat) + ' bị khống chế, mất lượt.');
    events.push({ t: 'skip-turn', seat });
    Engine.nextTurn(state);
    return { events, turnEnded: true };
  }

  let v = 1 + Math.floor(Math.random() * 6);
  state.rawDie = v;

  // ⚪ Nhân Quả curse: −2 to this roll
  let cursed = false;
  if (stt.curse > 0) { stt.curse -= 1; v = Math.max(0, v - 2); cursed = true; }
  state.die = v;
  state.sixStreak = (state.rawDie === 6) ? state.sixStreak + 1 : 0;
  if (cursed) events.push({ t: 'cursed-roll', seat, raw: state.rawDie, value: v });

  // 🌩️ Thiên Lôi — 3 sixes (Gold is immune)
  if (state.sixStreak >= 3 && fac !== 'gold') {
    const lost = sendFurthestToBase(state, seat);
    pushLog(state, '🌩️ Thiên Lôi! ' + seatLabel(state, seat) + ' đổ ba lần 6 — quân xa nhất về chuồng, mất lượt.');
    events.push({ t: 'thienloi', seat, cell: lost ? lost.cell : null });
    Engine.nextTurn(state);
    return { events, turnEnded: true };
  }

  if (v < 1) { // cursed to 0 → wasted
    pushLog(state, '⛓️ ' + seatLabel(state, seat) + ' bị Nhân Quả, điểm về 0 — mất lượt.');
    Engine.nextTurn(state);
    return { events, turnEnded: true };
  }

  const moves = legalMoves(state);
  if (!moves.length) {
    pushLog(state, '🎲 ' + seatLabel(state, seat) + ' đổ ' + v + ' — không có nước đi.');
    Engine.nextTurn(state);
    return { events, turnEnded: true };
  }

  state.phase = 'select';
  return { events, turnEnded: false };
}

// Apply an already-chosen engine move object. Mirrors execMove (sans
// animation). Returns { events, win, extra }.
function applyChosen(state, m) {
  const events = [];
  const res = applyMove(state, m);
  events.push(...res.events);
  logEngineEvents(state, res.events);

  if (playerDone(state, m.horse.seat)) {
    state.winner = m.horse.seat;
    state.phase = 'over';
    pushLog(state, '👑 ' + seatLabel(state, m.horse.seat) + ' CHIẾN THẮNG!');
    return { events, win: true, extra: false };
  }

  // extra turn: a six (not blocked by 3-six rule), OR a capture (except 🔴 Đỏ),
  // OR finishing a horse. Verbatim from execMove.
  const sixExtra = state.rawDie === 6 && state.sixStreak < 3;
  const capExtra = res.capturedSomeone && res.attackerFaction !== 'red';
  const extra = sixExtra || capExtra || res.finished;

  if (extra) {
    state.die = null; state.rawDie = null; state.phase = 'roll';
  } else {
    Engine.nextTurn(state);
  }
  return { events, win: false, extra };
}

// Resolve a human's selection {seat,idx,kind,to} against the legal move list,
// matching app.jsx onPick (prefer exact kind+to, else Nhót, else first).
// Returns { error } or { events, win, extra }.
function serverMove(state, sel) {
  if (state.phase !== 'select') return { error: 'not_select_phase' };
  if (sel.seat !== state.turn) return { error: 'not_your_turn' };
  const moves = legalMoves(state);
  const mine = moves.filter((mv) => mv.horse.seat === sel.seat && mv.horse.idx === sel.idx);
  if (!mine.length) return { error: 'illegal_move' };
  const m = mine.find((mv) => mv.kind === sel.kind && mv.to === sel.to)
        || mine.find((mv) => mv.kind === 'nhot')
        || mine[0];
  return applyChosen(state, m);
}

// Is this seat currently driven by the machine? AI seat, or a human who has
// gone quiet (disconnected) — so the game never stalls on an absent player.
function seatIsBot(room, seat, now) {
  const s = room.seats[seat];
  if (!s || !s.uid) return true;            // unclaimed seat
  if (s.isAI) return true;
  if (s.connected === false) return true;
  if (s.lastSeenAt && (now - new Date(s.lastSeenAt).getTime()) > DISCONNECT_MS) return true;
  return false;
}

// Drive every consecutive bot/absent turn synchronously until it's a connected
// human's turn or the game ends. Returns the accumulated event batch.
function runAiTurns(state, room, now = Date.now()) {
  const events = [];
  let guard = 0;
  while (state.winner == null && seatIsBot(room, state.turn, now)) {
    if (++guard > AI_LOOP_CAP) break;       // pathological safety net
    const r = doRollServer(state);
    events.push(...r.events);
    if (r.turnEnded) continue;              // roll ended the turn; re-check seat
    // phase==='select' → bot must choose
    const moves = legalMoves(state);
    const m = aiChoose(state, moves);
    if (!m) { Engine.nextTurn(state); continue; }
    const mv = applyChosen(state, m);
    events.push(...mv.events);
    if (mv.win) break;
    // if mv.extra, turn pointer unchanged → loop continues for the same bot
  }
  return events;
}

// ═════════════════════════════════════════════════════════════════
// DB layer
// ═════════════════════════════════════════════════════════════════

let indexesEnsured = false;
async function getRooms() {
  const col = (await getDb()).collection('ludo_rooms');
  if (!indexesEnsured) {
    try {
      await col.createIndex({ code: 1 }, { unique: true, name: 'code_unique' });
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'room_ttl' });
      indexesEnsured = true;
    } catch { /* index race on parallel cold-starts — ignore */ }
  }
  return col;
}

function genCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function emptySeats() {
  return [0, 1, 2, 3].map((seat) => ({
    seat, faction: null, uid: null, displayName: null, avatarUrl: null,
    isAI: false, connected: false, lastSeenAt: null,
  }));
}

// Public projection of a room for the client. Strips nothing sensitive (state
// is meant to be shared) but trims eventLog unless the client is behind.
function roomView(room, since) {
  const events = [];
  if (Number.isFinite(since) && Array.isArray(room.eventLog)) {
    for (const batch of room.eventLog) {
      if (batch.v > since) events.push(...batch.events);
    }
  }
  return {
    code: room.code,
    status: room.status,
    version: room.version,
    hostUid: room.hostUid,
    seats: room.seats.map((s) => ({
      seat: s.seat, faction: s.faction, displayName: s.displayName,
      avatarUrl: s.avatarUrl, isAI: s.isAI, connected: s.connected,
      occupied: !!s.uid || s.isAI,
    })),
    state: room.state,
    events,
  };
}

// Compare-and-swap write: only succeeds if the room's version is unchanged
// since we read it. Guards against double roll/move + concurrent writers.
async function casWrite(col, code, expectedVersion, patch, now) {
  const next = expectedVersion + 1;
  const r = await col.findOneAndUpdate(
    { code, version: expectedVersion },
    { $set: { ...patch, version: next, updatedAt: new Date(now), expiresAt: new Date(now + ROOM_TTL_MS) } },
    { returnDocument: 'after' },
  );
  return r?.value || r || null;
}

function appendEventLog(room, version, events) {
  if (!events || !events.length) return room.eventLog || [];
  const log = (room.eventLog || []).slice();
  log.push({ v: version, events });
  while (log.length > EVENTLOG_CAP) log.shift();
  return log;
}

// ═════════════════════════════════════════════════════════════════
// HTTP dispatch
// ═════════════════════════════════════════════════════════════════

async function requireUser(req, res) {
  const session = readSession(req);
  if (!session?.uid) { res.status(401).json({ error: 'unauthenticated' }); return null; }
  let oid;
  try { oid = new ObjectId(session.uid); } catch { res.status(401).json({ error: 'bad_session' }); return null; }
  const u = await (await getUsers()).findOne({ _id: oid });
  if (!u) { res.status(401).json({ error: 'user_not_found' }); return null; }
  return {
    uid: session.uid,
    displayName: u.displayName || u.username || 'Người chơi',
    avatarUrl: u.avatarUrl || null,
  };
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return {}; } }
  return body && typeof body === 'object' ? body : {};
}

export async function handleLudo(req, res) {
  const action = (req.query?.action || '').toString();
  try {
    switch (action) {
      case 'create': return await actionCreate(req, res);
      case 'join':   return await actionJoin(req, res);
      case 'leave':  return await actionLeave(req, res);
      case 'start':  return await actionStart(req, res);
      case 'state':  return await actionState(req, res);
      case 'roll':   return await actionRoll(req, res);
      case 'move':   return await actionMove(req, res);
      default: return res.status(400).json({ error: 'unknown_action', hint: 'create|join|leave|start|state|roll|move' });
    }
  } catch (err) {
    console.error('[ludo]', action, err);
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
}

async function actionCreate(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const col = await getRooms();
  const now = Date.now();
  const seats = emptySeats();
  seats[0] = { seat: 0, faction: null, uid: user.uid, displayName: user.displayName, avatarUrl: user.avatarUrl, isAI: false, connected: true, lastSeenAt: new Date(now) };

  // Insert with a fresh code, retrying on the unique-index collision rather
  // than a racy findOne-then-insert.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode();
    const doc = {
      code, hostUid: user.uid, status: 'lobby', version: 1,
      seats, state: null, eventLog: [], turnDeadline: null,
      createdAt: new Date(now), updatedAt: new Date(now), expiresAt: new Date(now + ROOM_TTL_MS),
    };
    try {
      await col.insertOne(doc);
      return res.status(200).json({ ok: true, mySeat: 0, room: roomView(doc, NaN) });
    } catch (e) {
      if (e?.code === 11000) continue; // code taken — retry
      throw e;
    }
  }
  return res.status(500).json({ error: 'code_generation_failed' });
}

async function actionJoin(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const code = String(readBody(req).code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const col = await getRooms();
  const now = Date.now();

  for (let attempt = 0; attempt < 6; attempt++) {
    const room = await col.findOne({ code });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    // Already seated? (reconnect) — just refresh presence.
    const existing = room.seats.findIndex((s) => s.uid === user.uid);
    if (existing >= 0) {
      const seats = room.seats.slice();
      seats[existing] = { ...seats[existing], connected: true, lastSeenAt: new Date(now), displayName: user.displayName, avatarUrl: user.avatarUrl };
      const saved = await casWrite(col, code, room.version, { seats }, now);
      if (!saved) continue;
      return res.status(200).json({ ok: true, mySeat: existing, room: roomView(saved, NaN) });
    }

    if (room.status !== 'lobby') return res.status(409).json({ error: 'game_in_progress' });
    const free = room.seats.findIndex((s) => !s.uid && !s.isAI);
    if (free < 0) return res.status(409).json({ error: 'room_full' });

    const seats = room.seats.slice();
    seats[free] = { seat: free, faction: null, uid: user.uid, displayName: user.displayName, avatarUrl: user.avatarUrl, isAI: false, connected: true, lastSeenAt: new Date(now) };
    const saved = await casWrite(col, code, room.version, { seats }, now);
    if (!saved) continue; // version moved under us — retry
    return res.status(200).json({ ok: true, mySeat: free, room: roomView(saved, NaN) });
  }
  return res.status(409).json({ error: 'join_contended' });
}

async function actionLeave(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const code = String(readBody(req).code || '').toUpperCase().trim();
  const col = await getRooms();
  const now = Date.now();

  for (let attempt = 0; attempt < 6; attempt++) {
    const room = await col.findOne({ code });
    if (!room) return res.status(200).json({ ok: true }); // already gone
    const mine = room.seats.findIndex((s) => s.uid === user.uid);
    if (mine < 0) return res.status(200).json({ ok: true });

    // In lobby: free the seat. If no humans remain, disband (delete).
    const seats = room.seats.slice();
    seats[mine] = { seat: mine, faction: null, uid: null, displayName: null, avatarUrl: null, isAI: false, connected: false, lastSeenAt: null };
    const humansLeft = seats.some((s) => s.uid);

    if (!humansLeft) {
      const del = await col.deleteOne({ code, version: room.version });
      if (del.deletedCount === 0) continue;
      return res.status(200).json({ ok: true, disbanded: true });
    }

    // Transfer host if the host left.
    let hostUid = room.hostUid;
    if (hostUid === user.uid) hostUid = seats.find((s) => s.uid)?.uid || hostUid;

    const saved = await casWrite(col, code, room.version, { seats, hostUid }, now);
    if (!saved) continue;
    return res.status(200).json({ ok: true, room: roomView(saved, NaN) });
  }
  return res.status(409).json({ error: 'leave_contended' });
}

async function actionStart(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const body = readBody(req);
  const code = String(body.code || '').toUpperCase().trim();
  const col = await getRooms();
  const now = Date.now();

  const room = await col.findOne({ code });
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (room.hostUid !== user.uid) return res.status(403).json({ error: 'host_only' });
  if (room.status !== 'lobby') return res.status(409).json({ error: 'already_started' });

  const humans = room.seats.filter((s) => s.uid).length;
  if (humans < 1) return res.status(400).json({ error: 'need_player' });

  // Pick 4 distinct factions; honour an explicit assign if the host sent one.
  let assign = Array.isArray(body.assign) && body.assign.length === 4
    && body.assign.every((k) => FACTION_ORDER.includes(k))
    && new Set(body.assign).size === 4
    ? body.assign
    : Engine.pickFactions();

  const state = Engine.newGame(assign);
  state.log = [];
  state._seq = 0;

  // Bind seats: humans keep their uid, empty seats become AI. Faction comes
  // from newGame's seat order so seats[i].faction === state.seats[i].faction.
  const seats = room.seats.map((s, i) => ({
    seat: i,
    faction: state.seats[i].faction,
    uid: s.uid || null,
    displayName: s.uid ? s.displayName : null,
    avatarUrl: s.uid ? s.avatarUrl : null,
    isAI: !s.uid,
    connected: s.uid ? true : false,
    lastSeenAt: s.uid ? new Date(now) : null,
  }));

  const roomForBots = { seats };
  pushLog(state, '🎮 Ván mới bắt đầu!');
  // Drive any leading AI turns (e.g. seat 0 is AI) up to the first human.
  const events = runAiTurns(state, roomForBots, now);
  const eventLog = appendEventLog({ eventLog: [] }, room.version + 1, events);

  const saved = await casWrite(col, code, room.version, {
    status: state.winner != null ? 'finished' : 'playing',
    seats, state, eventLog,
    turnDeadline: new Date(now + TURN_TIMEOUT_MS),
  }, now);
  if (!saved) return res.status(409).json({ error: 'version_conflict', room: roomView(room, NaN) });
  return res.status(200).json({ ok: true, room: roomView(saved, NaN) });
}

// GET poll. Refreshes the caller's presence and lazily resolves a stuck turn
// (a human who timed out) by letting AI play — there are no background timers
// on serverless, so every handler, even this GET, nudges the game forward.
async function actionState(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const code = String(req.query?.code || '').toUpperCase().trim();
  const since = parseInt(req.query?.since, 10);
  const col = await getRooms();
  const now = Date.now();

  const room = await col.findOne({ code });
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const mySeat = room.seats.findIndex((s) => s.uid === user.uid);

  // Refresh presence for the caller's seat (best-effort, no CAS needed — a
  // presence write losing a race is harmless, the next poll fixes it).
  if (mySeat >= 0) {
    await col.updateOne({ code, [`seats.${mySeat}.uid`]: user.uid },
      { $set: { [`seats.${mySeat}.connected`]: true, [`seats.${mySeat}.lastSeenAt`]: new Date(now), expiresAt: new Date(now + ROOM_TTL_MS) } });
  }

  // Stuck-turn takeover: playing, current seat is a human past the deadline.
  if (room.status === 'playing' && room.state && room.state.winner == null) {
    const turnSeat = room.state.turn;
    const overdue = room.turnDeadline && now > new Date(room.turnDeadline).getTime();
    if (overdue && seatIsBot(room, turnSeat, now)) {
      const state = room.state;
      const events = runAiTurns(state, room, now);
      const eventLog = appendEventLog(room, room.version + 1, events);
      const saved = await casWrite(col, code, room.version, {
        status: state.winner != null ? 'finished' : 'playing',
        state, eventLog, turnDeadline: new Date(now + TURN_TIMEOUT_MS),
      }, now);
      if (saved) return res.status(200).json({ ok: true, mySeat, room: roomView(saved, since) });
      // lost the race → fall through and just return current
    }
  }

  const fresh = (await col.findOne({ code })) || room;
  return res.status(200).json({ ok: true, mySeat, room: roomView(fresh, since) });
}

async function actionRoll(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const body = readBody(req);
  const code = String(body.code || '').toUpperCase().trim();
  const col = await getRooms();
  const now = Date.now();

  const room = await col.findOne({ code });
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (room.status !== 'playing' || !room.state) return res.status(409).json({ error: 'not_playing' });
  const state = room.state;
  if (state.winner != null) return res.status(409).json({ error: 'game_over' });

  const turnSeat = state.turn;
  const owner = room.seats[turnSeat];
  if (!owner || owner.uid !== user.uid) return res.status(403).json({ error: 'not_your_turn' });
  if (state.phase !== 'roll') return res.status(409).json({ error: 'not_roll_phase' });

  const events = [];
  const r = doRollServer(state);
  events.push(...r.events);
  // If the roll didn't end the turn, the human now picks (phase 'select').
  // If it did end the turn, drive any AI seats that follow.
  if (r.turnEnded) events.push(...runAiTurns(state, room, now));

  const eventLog = appendEventLog(room, room.version + 1, events);
  const saved = await casWrite(col, code, room.version, {
    status: state.winner != null ? 'finished' : 'playing',
    state, eventLog, turnDeadline: new Date(now + TURN_TIMEOUT_MS),
  }, now);
  if (!saved) return res.status(409).json({ error: 'version_conflict', room: roomView(await col.findOne({ code }), NaN) });
  return res.status(200).json({ ok: true, mySeat: turnSeat, room: roomView(saved, room.version) });
}

async function actionMove(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const body = readBody(req);
  const code = String(body.code || '').toUpperCase().trim();
  const col = await getRooms();
  const now = Date.now();

  const room = await col.findOne({ code });
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (room.status !== 'playing' || !room.state) return res.status(409).json({ error: 'not_playing' });
  const state = room.state;
  if (state.winner != null) return res.status(409).json({ error: 'game_over' });

  const turnSeat = state.turn;
  const owner = room.seats[turnSeat];
  if (!owner || owner.uid !== user.uid) return res.status(403).json({ error: 'not_your_turn' });

  const sel = {
    seat: turnSeat,
    idx: parseInt(body.idx, 10),
    kind: String(body.kind || ''),
    to: parseInt(body.to, 10),
  };
  const mv = serverMove(state, sel);
  if (mv.error) return res.status(409).json({ error: mv.error, room: roomView(room, NaN) });

  const events = mv.events.slice();
  if (!mv.win) events.push(...runAiTurns(state, room, now));

  const eventLog = appendEventLog(room, room.version + 1, events);
  const saved = await casWrite(col, code, room.version, {
    status: state.winner != null ? 'finished' : 'playing',
    state, eventLog, turnDeadline: new Date(now + TURN_TIMEOUT_MS),
  }, now);
  if (!saved) return res.status(409).json({ error: 'version_conflict', room: roomView(await col.findOne({ code }), NaN) });
  return res.status(200).json({ ok: true, mySeat: turnSeat, room: roomView(saved, room.version) });
}

// Exported for unit testing the pure orchestration without a DB.
export const __test = { doRollServer, applyChosen, serverMove, runAiTurns, seatIsBot, pushLog };
