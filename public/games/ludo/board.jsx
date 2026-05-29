/* global React, Engine */
const { PATH, HOME, STABLE, START, PLAYERS, cellOf, SAFE } = Engine;
const CELL = 46; // must match --cell in styles.css

// ---- precompute static cell descriptors -----------------------------------
function buildCells() {
  const cells = [];
  const seen = {};
  // outer track
  PATH.forEach(([r, c], i) => {
    const key = r + ',' + c;
    const startP = START.indexOf(i);
    const d = { r, c, kind: 'path', key };
    if (startP >= 0) { d.kind = 'start'; d.player = startP; }
    if (SAFE.has(key) && startP < 0) d.safe = true;
    cells.push(d); seen[key] = true;
  });
  // home stretches
  HOME.forEach((arr, p) => arr.forEach(([r, c]) => {
    cells.push({ r, c, kind: 'home', player: p, key: r + ',' + c });
  }));
  return cells;
}
const CELLS = buildCells();

const CORNERS = {
  0: { left: 0,        top: 0        }, // tl
  1: { left: 9 * CELL, top: 0        }, // tr
  2: { left: 9 * CELL, top: 9 * CELL }, // br
  3: { left: 0,        top: 9 * CELL }, // bl
};

function hueOf(p) { return PLAYERS[p].hue; }
// chevron rotation so each home-lane arrow points toward the centre
const CHEV = { 0: '-45deg', 1: '45deg', 2: '135deg', 3: '-135deg' };

function Board({ state, movable, onPick, poofs }) {
  const center = (r, c) => ({ left: (c + 0.5) * CELL, top: (r + 0.5) * CELL });

  return (
    React.createElement('div', { className: 'scene' },
      React.createElement('div', { className: 'board' },
        React.createElement('div', { className: 'slab' }),

        // stable platforms
        PLAYERS.map((pl, p) => {
          const cn = CORNERS[p];
          return React.createElement('div', {
            key: 'stab' + p, className: 'stable',
            style: {
              left: cn.left + 8, top: cn.top + 8,
              width: 6 * CELL - 16, height: 6 * CELL - 16,
              ['--cell-tint']: hueOf(p),
            },
          },
            STABLE[p].map(([r, c], i) => {
              const pos = center(r, c);
              return React.createElement('div', {
                key: i, className: 'slot',
                style: { left: pos.left - cn.left - 8, top: pos.top - cn.top - 8 },
              });
            })
          );
        }),

        // track + home cells
        CELLS.map((d) => {
          const cls = ['cell', d.kind];
          if (d.safe) cls.push('safe');
          const style = { left: d.c * CELL, top: d.r * CELL };
          if (d.player != null) style['--cell-tint'] = hueOf(d.player);
          if (d.kind === 'home') style['--chev'] = CHEV[d.player];
          const showRing = movable.landing && movable.landing.has(d.key);
          return React.createElement('div', { key: d.key + d.kind, className: cls.join(' '), style },
            (d.player != null) && React.createElement('div', { className: 'tint' }),
            React.createElement('div', { className: 'tile' }),
            showRing && React.createElement('div', { className: 'ring' })
          );
        }),

        // centre goal — a TRUE 3D faceted gem (octagonal bipyramid). Each
        // triangular facet is a flat div placed in 3D space via matrix3d, so the
        // jewel reads as a solid volume from every angle, including top-down
        // (you see the crown pyramid, not a flat sheet). Parented to the board →
        // it tilts & turns with the board; gem-spin adds a slow idle spin.
        (function () {
          const N = 8;     // girdle segments
          const R = 24;    // girdle radius (px)
          const HC = 16;   // crown height (top apex above girdle)
          const HP = 30;   // pavilion depth (culet below girdle)
          const S = 100;   // facet div size in local px (resolution only)

          const top = [0, 0, HC];
          const cul = [0, 0, -HP];
          const girdle = [];
          for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            girdle.push([R * Math.cos(a), R * Math.sin(a), 0]);
          }

          const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

          // Map a 100x100 right-triangle div (corners 0,0 / S,0 / 0,S) onto the
          // 3D triangle p0,p1,p2. matrix3d columns = images of local x, y, z axes
          // and the translation. Flip winding so the normal faces outward, which
          // lets backface-culling render exactly the near (convex) facets.
          function facet(p0, p1, p2, grad) {
            let U = sub(p1, p0), V = sub(p2, p0);
            const c = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
            if (dot(cross(U, V), c) < 0) { const t = p1; p1 = p2; p2 = t; U = sub(p1, p0); V = sub(p2, p0); }
            const nrm = cross(U, V);
            const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
            const col = [U[0] / S, U[1] / S, U[2] / S, 0,
                         V[0] / S, V[1] / S, V[2] / S, 0,
                         nrm[0] / nl, nrm[1] / nl, nrm[2] / nl, 0,
                         p0[0], p0[1], p0[2], 1];
            const m = col.map(n => (Math.abs(n) < 1e-6 ? 0 : +n.toFixed(4))).join(',');
            return { transform: 'matrix3d(' + m + ')', grad };
          }

          const crown = ['linear-gradient(135deg,#f6fdff,#8fcaec)', 'linear-gradient(135deg,#e6f6ff,#62b2e3)'];
          const pav = ['linear-gradient(135deg,#1c5f95,#5fb0e2)', 'linear-gradient(135deg,#23709f,#74bde9)'];
          const facets = [];
          for (let i = 0; i < N; i++) {
            const g0 = girdle[i], g1 = girdle[(i + 1) % N];
            facets.push(facet(top, g0, g1, crown[i % 2]));
            facets.push(facet(cul, g0, g1, pav[i % 2]));
          }

          const sparks = [
            { cls: 'sp1', d: '0s' }, { cls: 'sp2', d: '1.2s' }, { cls: 'sp3', d: '2.4s' },
          ].map((s) => React.createElement('div', {
            key: s.cls, className: 'dia-spark ' + s.cls, style: { animationDelay: s.d },
          }));

          return React.createElement('div', {
            className: 'goal',
            style: { left: 6 * CELL, top: 6 * CELL, width: 3 * CELL, height: 3 * CELL },
          },
            React.createElement('div', { className: 'crown-float' },
              React.createElement('div', { className: 'crown-shadow' }),
              React.createElement('div', { className: 'dia-glow' }),
              React.createElement('div', { className: 'gem3d' },
                React.createElement('div', { className: 'gem-spin' },
                  facets.map((f, i) => React.createElement('div', {
                    key: i, className: 'gem-facet',
                    style: { transform: f.transform, backgroundImage: f.grad },
                  }))
                )
              ),
              sparks
            )
          );
        })(),

        // pieces
        state.horses.flat().map((h) => {
          let cell;
          if (h.step < 0) cell = STABLE[h.player][h.idx];
          else cell = cellOf(h.player, h.step);
          const pos = center(cell[0], cell[1]);
          const id = h.player + '-' + h.idx;
          const can = movable.horses && movable.horses.has(id);
          const cls = ['piece', 'cls-' + PLAYERS[h.player].cls];
          if (can) cls.push('movable');
          // stagger overlapping horses slightly
          const stack = state.horses.flat().filter(o =>
            o !== h && o.step === h.step && h.step >= 0 && h.step < Engine.STEP_DONE &&
            o.player === h.player);
          const off = 0;
          return React.createElement('div', {
            key: id, className: cls.join(' '),
            style: { left: pos.left, top: pos.top, ['--pc']: hueOf(h.player), zIndex: 5 + Math.round(pos.top) },
            onClick: can ? () => onPick(h) : undefined,
          },
            React.createElement('div', { className: 'shadow' }),
            can && React.createElement('div', { className: 'ground-ring' }),
            React.createElement('div', { className: 'billboard' },
              React.createElement('div', { className: 'standee' },
                React.createElement('div', { className: 'hat' }),
                React.createElement('div', { className: 'body' }),
                React.createElement('div', { className: 'head' },
                  React.createElement('div', { className: 'face' },
                    React.createElement('div', { className: 'eye l' }),
                    React.createElement('div', { className: 'eye r' }),
                    React.createElement('div', { className: 'blush l' }),
                    React.createElement('div', { className: 'blush r' })
                  )
                )
              )
            )
          );
        }),

        // capture poofs
        poofs.map((pf) => {
          const pos = center(pf.r, pf.c);
          return React.createElement('div', {
            key: pf.id, className: 'poof', style: { left: pos.left, top: pos.top },
          });
        })
      )
    )
  );
}

window.Board = Board;
window.CELL = CELL;
