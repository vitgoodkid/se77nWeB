/* global React, Engine */
const { RING, RING_LEN, HOME, BASE, START_IDX, DOOR_IDX, CORNERS_IDX, CENTER,
        SAFE, FACTIONS, cellOf } = Engine;
const CELL = 46; // must match --cell in styles.css

// ---- static cell descriptors ----------------------------------------------
function buildCells() {
  const cells = [];
  RING.forEach(([r, c], idx) => {
    const d = { r, c, kind: 'ring', key: 'r' + idx, ringIdx: idx };
    const seat = START_IDX.indexOf(idx);
    if (seat >= 0) { d.kind = 'start'; d.seat = seat; }
    else if (DOOR_IDX.indexOf(idx) >= 0) { d.kind = 'door'; d.seat = DOOR_IDX.indexOf(idx); }
    else if (CORNERS_IDX.indexOf(idx) >= 0) { d.kind = 'corner'; }
    cells.push(d);
  });
  HOME.forEach((arr, seat) => arr.forEach(([r, c], stage) => {
    if (stage === 5) return; // stage 6 == centre gem, drawn separately
    cells.push({ r, c, kind: 'home', seat, key: 'h' + seat + '-' + stage });
  }));
  return cells;
}
const CELLS = buildCells();

// home-lane chevrons point toward centre [7,7]
const CHEV = { 0: '135deg', 1: '-135deg', 2: '-45deg', 3: '45deg' };

function Board({ state, movable, onPick, onHover, fx, badges }) {
  const center = (r, c) => ({ left: (c + 0.5) * CELL, top: (r + 0.5) * CELL });
  const hueOf = (seat) => state.seats[seat].hue;
  const traps = state.traps || {};

  return (
    React.createElement('div', { className: 'scene' },
      React.createElement('div', { className: 'board' },
        React.createElement('div', { className: 'slab' }),

        // ---- base camps (corner quadrants) ----
        state.seats.map((st, seat) => {
          const slots = BASE[seat];
          const minR = Math.min(...slots.map(s => s[0])), maxR = Math.max(...slots.map(s => s[0]));
          const minC = Math.min(...slots.map(s => s[1])), maxC = Math.max(...slots.map(s => s[1]));
          const left = (minC - 0.7) * CELL, top = (minR - 0.7) * CELL;
          const w = (maxC - minC + 1.4) * CELL, h = (maxR - minR + 1.4) * CELL;
          return React.createElement('div', {
            key: 'base' + seat, className: 'base',
            style: { left, top, width: w, height: h, ['--cell-tint']: hueOf(seat) },
          },
            slots.map(([r, c], i) => {
              const p = center(r, c);
              return React.createElement('div', { key: i, className: 'slot',
                style: { left: p.left - left, top: p.top - top } });
            }));
        }),

        // ---- track / corner / door / home cells ----
        CELLS.map((d) => {
          const cls = ['cell', d.kind];
          if (SAFE.has(d.r + ',' + d.c)) cls.push('safe');
          const style = { left: d.c * CELL, top: d.r * CELL };
          if (d.seat != null) style['--cell-tint'] = hueOf(d.seat);
          if (d.kind === 'home') style['--chev'] = CHEV[d.seat];
          const key = d.r + ',' + d.c;
          const showRing = movable.landing && movable.landing.has(key);
          const trapSeat = d.ringIdx != null ? traps[d.ringIdx] : null;
          return React.createElement('div', { key: d.key, className: cls.join(' '), style },
            (d.seat != null && d.kind !== 'home') && React.createElement('div', { className: 'tint' }),
            React.createElement('div', { className: 'tile' }),
            d.kind === 'corner' && React.createElement('div', { className: 'corner-mark' }, '◆'),
            (trapSeat != null) && React.createElement('div', { className: 'ice-trap', title: 'Bẫy Băng' }, '❄'),
            showRing && React.createElement('div', { className: 'ring' }));
        }),

        // ---- centre goal: 3D faceted gem (kept from original) ----
        (function () {
          const NSEG = 8, R = 24, HC = 16, HP = 30, S = 100;
          const top = [0, 0, HC], cul = [0, 0, -HP], girdle = [];
          for (let i = 0; i < NSEG; i++) { const a = (i / NSEG) * Math.PI * 2; girdle.push([R * Math.cos(a), R * Math.sin(a), 0]); }
          const sub = (p, q) => [p[0]-q[0], p[1]-q[1], p[2]-q[2]];
          const cross = (u, v) => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
          const dot = (u, v) => u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
          function facet(p0, p1, p2, grad) {
            let U = sub(p1, p0), V = sub(p2, p0);
            const c = [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
            if (dot(cross(U, V), c) < 0) { const t = p1; p1 = p2; p2 = t; U = sub(p1, p0); V = sub(p2, p0); }
            const nrm = cross(U, V), nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
            const col = [U[0]/S,U[1]/S,U[2]/S,0, V[0]/S,V[1]/S,V[2]/S,0, nrm[0]/nl,nrm[1]/nl,nrm[2]/nl,0, p0[0],p0[1],p0[2],1];
            return { transform: 'matrix3d(' + col.map(n => Math.abs(n)<1e-6?0:+n.toFixed(4)).join(',') + ')', grad };
          }
          const crown = ['linear-gradient(135deg,#f6fdff,#8fcaec)', 'linear-gradient(135deg,#e6f6ff,#62b2e3)'];
          const pav = ['linear-gradient(135deg,#1c5f95,#5fb0e2)', 'linear-gradient(135deg,#23709f,#74bde9)'];
          const facets = [];
          for (let i = 0; i < NSEG; i++) { const g0 = girdle[i], g1 = girdle[(i+1)%NSEG];
            facets.push(facet(top, g0, g1, crown[i%2])); facets.push(facet(cul, g0, g1, pav[i%2])); }
          const sparks = [{cls:'sp1',d:'0s'},{cls:'sp2',d:'1.2s'},{cls:'sp3',d:'2.4s'}].map(s =>
            React.createElement('div', { key: s.cls, className: 'dia-spark ' + s.cls, style: { animationDelay: s.d } }));
          return React.createElement('div', { className: 'goal', style: { left: 6*CELL, top: 6*CELL, width: 3*CELL, height: 3*CELL } },
            React.createElement('div', { className: 'crown-float' },
              React.createElement('div', { className: 'crown-shadow' }),
              React.createElement('div', { className: 'dia-glow' }),
              React.createElement('div', { className: 'gem3d' },
                React.createElement('div', { className: 'gem-spin' },
                  facets.map((f, i) => React.createElement('div', { key: i, className: 'gem-facet',
                    style: { transform: f.transform, backgroundImage: f.grad } })))),
              sparks));
        })(),

        // ---- pieces ----
        state.horses.flat().map((h) => {
          const st = state.seats[h.seat];
          const fac = st.faction;
          const cell = h.step < 0 ? BASE[h.seat][h.idx] : cellOf(h.seat, h.step);
          const pos = center(cell[0], cell[1]);
          const id = h.seat + '-' + h.idx;
          const can = movable.horses && movable.horses.has(id);
          const cls = ['piece', 'cls-' + st.cls];
          if (can) cls.push('movable');
          if (fac === 'gold') cls.push('aura-gold');
          const badge = badges && badges[id];
          return React.createElement('div', {
            key: id, className: cls.join(' '),
            style: { left: pos.left, top: pos.top, ['--pc']: hueOf(h.seat), zIndex: 5 + Math.round(pos.top) },
            onClick: can ? () => onPick(h) : undefined,
            onMouseEnter: onHover ? (e) => onHover({ seat: h.seat, faction: fac }, e) : undefined,
            onMouseMove: onHover ? (e) => onHover({ seat: h.seat, faction: fac }, e) : undefined,
            onMouseLeave: onHover ? () => onHover(null) : undefined,
          },
            React.createElement('div', { className: 'shadow' }),
            can && React.createElement('div', { className: 'ground-ring' }),
            (fac === 'green' && h.shield) && React.createElement('div', { className: 'shield-bubble' }),
            React.createElement('div', { className: 'billboard' },
              React.createElement('div', { className: 'standee' },
                React.createElement('div', { className: 'hat' }),
                React.createElement('div', { className: 'body' }),
                React.createElement('div', { className: 'head' },
                  React.createElement('div', { className: 'face' },
                    React.createElement('div', { className: 'eye l' }),
                    React.createElement('div', { className: 'eye r' }),
                    React.createElement('div', { className: 'blush l' }),
                    React.createElement('div', { className: 'blush r' }))),
                badge && React.createElement('div', { className: 'debuff debuff-' + badge },
                  badge === 'bleed' ? '🩸' : badge === 'dizzy' ? '💫' : badge === 'frozen' ? '🧊' : '☁️'))));
        }),

        // ---- transient VFX layer ----
        (fx || []).map((f) => {
          const p = center(f.r, f.c);
          if (f.type === 'chain' && f.r2 != null) {
            const p2 = center(f.r2, f.c2);
            const dx = (p2.left - p.left), dy = (p2.top - p.top);
            const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
            return React.createElement('div', { key: f.id, className: 'vfx-chain',
              style: { left: p.left, top: p.top, width: len, transform: 'rotate(' + ang + 'deg)' } });
          }
          return React.createElement('div', { key: f.id, className: 'vfx vfx-' + f.type,
            style: { left: p.left, top: p.top } });
        })
      )
    )
  );
}

window.Board = Board;
window.CELL = CELL;
