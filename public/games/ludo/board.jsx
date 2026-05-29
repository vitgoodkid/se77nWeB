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

        // centre goal — a crisp faceted diamond that floats, bobs and sparkles
        (function () {
          const svg =
            '<svg viewBox="0 0 100 100" width="58" height="58" xmlns="http://www.w3.org/2000/svg">' +
            '<defs>' +
            '<linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fdff"/><stop offset="1" stop-color="#c7ecfb"/></linearGradient>' +
            '<linearGradient id="gL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdeefb"/><stop offset="1" stop-color="#92cfef"/></linearGradient>' +
            '<linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aaddf4"/><stop offset="1" stop-color="#73bce8"/></linearGradient>' +
            '<linearGradient id="pA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb0e2"/><stop offset="1" stop-color="#2b7cba"/></linearGradient>' +
            '<linearGradient id="pB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ea3da"/><stop offset="1" stop-color="#226ea8"/></linearGradient>' +
            '<linearGradient id="pC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f95d2"/><stop offset="1" stop-color="#1c5f95"/></linearGradient>' +
            '</defs>' +
            '<g stroke="#eef9ff" stroke-width="0.8" stroke-linejoin="round">' +
            // crown
            '<polygon points="36,10 64,10 76,36 24,36" fill="url(#gT)"/>' +
            '<polygon points="6,36 24,36 36,10" fill="url(#gL)"/>' +
            '<polygon points="94,36 76,36 64,10" fill="url(#gR)"/>' +
            // pavilion (converges to a culet point)
            '<polygon points="6,36 28,36 50,95" fill="url(#pB)"/>' +
            '<polygon points="28,36 50,36 50,95" fill="url(#pA)"/>' +
            '<polygon points="50,36 72,36 50,95" fill="url(#pC)"/>' +
            '<polygon points="72,36 94,36 50,95" fill="url(#pB)"/>' +
            '</g>' +
            // specular glints
            '<polygon points="40,13 51,13 49,22 39,22" fill="#ffffff" opacity="0.7"/>' +
            '<polygon points="30,36 40,36 36,60" fill="#dff4ff" opacity="0.5"/>' +
            '</svg>';
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
              React.createElement('div', { className: 'crown-stand' },
                React.createElement('div', { className: 'dia-gem', dangerouslySetInnerHTML: { __html: svg } }),
                sparks
              )
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
