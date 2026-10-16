// Pixel-art side columns for wide desktop screens. Purely decorative: fixed,
// aria-hidden, pointer-events off, static SVGs with a few stepped bobs, so it
// costs almost nothing to render. Shown only when the gutters are wide enough.

// Each sprite is a char grid; each char maps to a palette colour ('.' = clear).
const SPRITES = {
  cabinet: {
    pal: { k: '#1b1410', r: '#e04545', y: '#ffd25e', b: '#7aa8ff', s: '#2a3a6b', w: '#fffaf0', g: '#7fd18b', p: '#b9a2ff' },
    rows: [
      '..kkkkkkkkkkkk..',
      '.kyyyyyyyyyyyyk.',
      '.kyrrrrrrrrrryk.',
      '.kyyyyyyyyyyyyk.',
      '.kkkkkkkkkkkkkk.',
      '.kppppppppppppk.',
      '.kpkkkkkkkkkkpk.',
      '.kpkssssssssbkpk',
      '.kpksswsssgssk.k',
      '.kpksssssssssk.k',
      '.kpkssyssyssskpk',
      '.kpksssssssssk.k',
      '.kpkssssrrsssk.k',
      '.kpkkkkkkkkkkkpk',
      '.kppppppppppppk.',
      'kkkkkkkkkkkkkkkk',
      'kppppppppppppppk',
      'kpkkpppprpppyppk',
      'kpkkppppppppppk.',
      'kpppppppppppppk.',
      '.kppppppppppppk.',
      '.kppkkkkkkkkppk.',
      '.kppkyyyyyykppk.',
      '.kppkkkkkkkkppk.',
      '.kppppppppppppk.',
      '.kppppppppppppk.',
      '.kkkkkkkkkkkkkk.',
    ],
  },
  chest: {
    pal: { k: '#1b1410', o: '#c9733e', d: '#8e4a22', y: '#ffd25e', w: '#fffaf0' },
    rows: [
      '..kkkkkkkkkk..',
      '.koooooooooook.',
      'koddddddddddok',
      'kooooooooooook',
      'kkkkkkyykkkkkk',
      'koooookyyooook',
      'kdddddkkkddddk',
      'koooooooooooook',
      'koooooooooooook',
      'kddddddddddddk',
      'kkkkkkkkkkkkkk',
    ],
  },
  alien: {
    pal: { k: '#1b1410', g: '#7fd18b', w: '#fffaf0' },
    rows: [
      '..g......g..',
      '...g....g...',
      '..gggggggg..',
      '.ggkggggkgg.',
      'gggggggggggg',
      'g.gggggggg.g',
      'g.g......g.g',
      '...gg..gg...',
    ],
  },
  sword: {
    pal: { k: '#1b1410', s: '#d9e2ec', w: '#fffaf0', y: '#ffd25e', b: '#7a4a22', r: '#e04545' },
    rows: [
      '....kk....',
      '...kwsk...',
      '...kwsk...',
      '...kwsk...',
      '...kwsk...',
      '...kwsk...',
      '...kwsk...',
      '...kwsk...',
      '.kkkkkkkk.',
      'kyyyrryyyk',
      '.kkkbbkkk.',
      '....bb....',
      '....bb....',
      '...kyyk...',
      '....kk....',
    ],
  },
  potion: {
    pal: { k: '#1b1410', c: '#c9733e', w: '#fffaf0', p: '#ff9ad5', m: '#e86aa8' },
    rows: [
      '...kkkk...',
      '...kcck...',
      '...kwwk...',
      '..kwwwwk..',
      '.kwwwwwwk.',
      'kwpppppwwk',
      'kppwpppppk',
      'kpppppmppk',
      'kppppmmppk',
      '.kpppppk.',
      '..kkkkk..',
    ],
  },
  ghost: {
    pal: { k: '#1b1410', v: '#b9a2ff', w: '#fffaf0', b: '#1b1410' },
    rows: [
      '...kkkkk...',
      '..kvvvvvk..',
      '.kvvvvvvvk.',
      '.kvwbvwbvk.',
      'kvvwbvwbvvk',
      'kvvvvvvvvvk',
      'kvvvvvvvvvk',
      'kvvvvvvvvvk',
      'kvkvvkvvkvk',
      'kk.kk.kk.kk',
    ],
  },
  coin: {
    pal: { k: '#1b1410', y: '#ffc93c', d: '#c98a12', w: '#fff3b0' },
    rows: ['..kkkk..', '.kyyyyk.', 'kywyydyk', 'kywyydyk', 'kyyyydyk', 'kyyyydyk', '.kyyyyk.', '..kkkk..'],
  },
  heart: {
    pal: { k: '#1b1410', r: '#e04545', w: '#fffaf0' },
    rows: ['.kk.kk.', 'krrkrrk', 'krwrrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'],
  },
  star: {
    pal: { k: '#1b1410', y: '#ffd25e' },
    rows: ['...k...', '..kyk..', 'kkkykkk', 'kyyyyyk', '.kyyyk.', 'kyk.kyk', 'kk...kk'],
  },
};

function Sprite({ name, px = 6, style, className }) {
  const s = SPRITES[name];
  const w = Math.max(...s.rows.map((r) => r.length));
  const h = s.rows.length;
  const rects = [];
  s.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = s.pal[row[x]];
      if (c) rects.push(<rect key={x + '-' + y} x={x} y={y} width="1.02" height="1.02" fill={c} />);
    }
  });
  return (
    <svg className={className} width={w * px} height={h * px} viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block', ...style }}>
      {rects}
    </svg>
  );
}

const DECOR_CSS = `
.sd-col { display: none; }
@media (min-width: 1500px) {
  .sd-col {
    position: fixed; z-index: 1; pointer-events: none;
    display: flex; flex-direction: column; align-items: center; justify-content: space-around;
    width: max(var(--sd-g, 160px), calc((100vw - 1720px) / 2));
  }
}
.sd-l { left: 0; }
.sd-r { right: 0; }
.sd-rail { position: absolute; top: 0; bottom: 0; width: 4px; background: repeating-linear-gradient(var(--rule) 0 8px, transparent 8px 16px); }
.sd-l .sd-rail { right: 18px; }
.sd-r .sd-rail { left: 18px; }
.sd-bob { animation: px-bob 1.6s steps(2) infinite; }
.sd-tag { padding: 4px 8px; font-size: 10px; color: var(--strip-text); background: var(--strip); white-space: nowrap; }
`;

// top/bottom: the fixed chrome above and footer below (px).
export default function SideDecor({ top, bottom }) {
  const col = { top, bottom };
  return (
    <>
      <style>{DECOR_CSS}</style>
      <div className="sd-col sd-l" aria-hidden="true" style={col}>
        <span className="sd-rail" />
        <span className="sk sd-tag">1UP · P1</span>
        <Sprite name="star" px={5} className="sd-bob" />
        <Sprite name="cabinet" px={7} />
        <Sprite name="coin" px={6} className="sd-bob" style={{ animationDelay: '0.4s' }} />
        <Sprite name="alien" px={7} className="sd-bob" style={{ animationDelay: '0.8s' }} />
        <Sprite name="chest" px={7} />
      </div>
      <div className="sd-col sd-r" aria-hidden="true" style={col}>
        <span className="sd-rail" />
        <span className="sk sd-tag">HI-SCORE</span>
        <Sprite name="heart" px={6} className="sd-bob" style={{ animationDelay: '0.2s' }} />
        <Sprite name="sword" px={7} />
        <Sprite name="ghost" px={7} className="sd-bob" style={{ animationDelay: '0.6s' }} />
        <Sprite name="potion" px={7} />
        <Sprite name="coin" px={6} className="sd-bob" style={{ animationDelay: '1s' }} />
      </div>
    </>
  );
}
