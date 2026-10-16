// Travel (tv4) pixel kit — presentation helpers shared by the tv4 tabs:
// palette for statuses / pins / categories, pixel icons, dialog shell,
// form rows, chips, checkbox and empty / loading / error states.
// Pairs with tv4.arcade.css (imported by index.jsx and SharedTripView.jsx).
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { COLORS, ACCENTS } from '../lib.jsx';

// ─── Palette ────────────────────────────────────────────────────
export const GOLD = ACCENTS.tv4;        // #ffd25e — this tool's highlight
export const ON = COLORS.onAccent;      // ink text on any accent fill

export const STATUS_FILL = { ongoing: '#ffd25e', visited: '#7fd18b', planned: '#ff7a7a' };
// Status colours that read as text on paper (both themes).
export const STATUS_INK = { ongoing: 'var(--tv-gold-ink)', visited: 'var(--green-ink)', planned: 'var(--tv-red-ink)' };
export const statusFill = (s) => STATUS_FILL[s] || '#d8cdb9';

export const PIN_FILL = {
  see: '#7fd18b', eat: '#ffd25e', move: '#ff7a7a', stay: '#9fd8ff',
  other: '#d8cdb9', wishlist: '#fffaf0', ongoing: '#ffd25e',
};
export const PIN_LEGEND = [
  { id: 'see', label: 'SEE' }, { id: 'eat', label: 'EAT' }, { id: 'move', label: 'MOVE' },
  { id: 'stay', label: 'STAY' }, { id: 'other', label: 'OTHER' }, { id: 'wishlist', label: 'WISHLIST' },
];

export const CAT_FILL = {
  food: '#ffd25e', stay: '#7fd18b', transport: '#ff7a7a', shopping: '#9fd8ff', other: '#d8cdb9',
};
export const catFill = (c) => CAT_FILL[c] || '#b9a2ff';

export const REGION_FILL = {
  SEA: '#7fd18b', NEA: '#ff7a7a', EU: '#7aa8ff', NA: '#ffd25e', OCEANIA: '#66d9d2',
  SA: '#ffa764', AF: '#ff9ad5', ME: '#b9a2ff', OTHER: '#d8cdb9',
};

// ─── Pixel icons ────────────────────────────────────────────────
// Stroke icons: 24 grid, square caps, miter joins (B spec).
function Stroke({ size = 18, children, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}
export const IconGear = (p) => (
  <Stroke {...p}>
    <path d="M10 2h4v3l2 1 2-2 3 3-2 2 1 2h3v4h-3l-1 2 2 2-3 3-2-2-2 1v3h-4v-3l-2-1-2 2-3-3 2-2-1-2H2v-4h3l1-2-2-2 3-3 2 2 2-1z" />
    <rect x="9" y="9" width="6" height="6" />
  </Stroke>
);
export const IconSearch = (p) => <Stroke {...p}><rect x="4" y="4" width="12" height="12" /><path d="M16 16l5 5" /></Stroke>;
export const IconRows = (p) => <Stroke {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Stroke>;
export const IconTiles = (p) => (
  <Stroke {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></Stroke>
);
export const IconCopy = (p) => <Stroke {...p}><rect x="8" y="8" width="12" height="12" /><path d="M16 8V4H4v12h4" /></Stroke>;
export const IconRefresh = (p) => <Stroke {...p}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></Stroke>;
export const IconClose = (p) => <Stroke {...p}><path d="M6 6l12 12M18 6L6 18" /></Stroke>;
export const IconCheck = (p) => <Stroke {...p} style={{ strokeWidth: 3.2, ...p?.style }}><path d="M4 12l5 5L20 6" /></Stroke>;
export const IconPrint = (p) => <Stroke {...p}><path d="M6 9V3h12v6M6 17H3V9h18v8h-3" /><rect x="6" y="14" width="12" height="7" /></Stroke>;

// Three pixel dots (trip menu).
export function IconDots({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="10" width="4" height="4" fill="currentColor" />
      <rect x="10" y="10" width="4" height="4" fill="currentColor" />
      <rect x="17" y="10" width="4" height="4" fill="currentColor" />
    </svg>
  );
}

// Pixel warning sign.
export function IconWarn({ size = 18, fill = GOLD }) {
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M2 0h2v1h1v2h1v3H0V3h1V1h1z" fill={ON} />
      <rect x="2.5" y="1.5" width="1" height="2" fill={fill} />
      <rect x="2.5" y="4" width="1" height="1" fill={fill} />
    </svg>
  );
}

// Pixel hourglass (countdown).
export function IconHourglass({ size = 16 }) {
  return (
    <svg width={size} height={Math.round(size * 9 / 8)} viewBox="0 0 8 9" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M0 0h8v1H7v2H6v1H5v1h1v1h1v2h1v1H0V8h1V6h1V5h1V4H2V3H1V1H0z" fill={ON} />
      <rect x="2" y="1" width="4" height="1" fill="#fffaf0" />
      <rect x="2" y="7" width="4" height="1" fill="#fffaf0" />
    </svg>
  );
}

// Pixel flag: ink pole + coloured pennant.
export function PixelFlag({ size = 24, fill = GOLD, style, className }) {
  return (
    <svg className={className} width={size} height={Math.round(size * 7 / 6)} viewBox="0 0 6 7" shapeRendering="crispEdges"
      aria-hidden="true" style={{ flexShrink: 0, display: 'block', ...style }}>
      <rect x="0" y="0" width="1" height="7" style={{ fill: 'var(--ink)' }} />
      <path d="M1 0h5v1H5v1h1v2H1z" fill={fill} style={{ stroke: 'var(--ink)' }} strokeWidth="0.3" />
    </svg>
  );
}

// Checkered goal flag (last day of the stage path).
export function GoalFlag({ size = 26 }) {
  const ink = { fill: 'var(--ink)' };
  return (
    <svg width={size} height={Math.round(size * 7 / 6)} viewBox="0 0 6 7" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="0" y="0" width="1" height="7" style={ink} />
      <rect x="1" y="0" width="5" height="4" fill="#fffaf0" style={{ stroke: 'var(--ink)' }} strokeWidth="0.3" />
      {[[1, 0], [3, 0], [5, 0], [2, 1], [4, 1], [1, 2], [3, 2], [5, 2], [2, 3], [4, 3]].map(([x, y]) => (
        <rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill="#1b1410" />
      ))}
    </svg>
  );
}

// Small square swatch with an ink edge (legends, category dots).
export function Swatch({ fill, size = 10, dashed }) {
  return (
    <span aria-hidden="true" style={{
      display: 'inline-block', flexShrink: 0, width: size, height: size, background: fill,
      border: dashed ? '2px dashed #c98a12' : '2px solid var(--ink)',
    }} />
  );
}

// ─── Text bits ──────────────────────────────────────────────────
export function Label({ children, style, as: Tag = 'span', className = '', ...rest }) {
  return (
    <Tag className={'sk ' + className} style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', ...style }} {...rest}>
      {children}
    </Tag>
  );
}

// Silkscreen heading for cards (real heading element, pixel label look).
export function CardTitle({ children, level = 3, id, style }) {
  const Tag = 'h' + level;
  return (
    <Tag id={id} className="sk tv-skh" style={{ margin: 0, fontSize: 12, lineHeight: 1.3, color: COLORS.text, ...style }}>
      {children}
    </Tag>
  );
}

// Accent tag chip (status / type / category). Ink text on an accent fill.
export function Tag({ fill = GOLD, children, style, title }) {
  return (
    <span className="sk" title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 6px', fontSize: 10, lineHeight: 1.3,
      whiteSpace: 'nowrap', textTransform: 'uppercase', color: ON, background: fill, border: '2px solid var(--ink)', ...style,
    }}>{children}</span>
  );
}

// Paper chip for neutral facts (dates, country, tags).
export function Fact({ children, style }) {
  return (
    <span className="sk pxs" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', fontSize: 11,
      whiteSpace: 'nowrap', textTransform: 'uppercase', color: COLORS.text, background: COLORS.paper, ...style,
    }}>{children}</span>
  );
}

// Ribbed accent strip on top of a big panel (cartridge label).
export function CartHead({ id, title, right, fill = GOLD, children }) {
  return (
    <div className="sk ribs" style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      minHeight: 32, padding: '4px 14px', fontSize: 12, color: ON, backgroundColor: fill,
      borderBottom: '4px solid var(--ink)',
    }}>
      <h3 id={id} className="tv-skh" style={{ margin: 0, fontSize: 12, color: ON }}>{title}</h3>
      {right != null && <span style={{ whiteSpace: 'nowrap' }}>{right}</span>}
      {children}
    </div>
  );
}

// HUD stat: label over a big value, dashed left rule.
export function HudStat({ label, value, color, first, last, big }) {
  return (
    <div className="sk" style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 16px',
      borderLeft: first === false ? 'none' : '3px dashed var(--rule)',
      borderRight: last ? '3px dashed var(--rule)' : 'none',
    }}>
      <span style={{ fontSize: 11, color: COLORS.muted }}>{label}</span>
      <span className={big ? 'pf' : undefined} style={{ fontSize: big ? 26 : 16, lineHeight: 1, color: color || COLORS.text }}>{value}</span>
    </div>
  );
}

// ─── Controls ───────────────────────────────────────────────────
export function FormRow({ label, children, style, className }) {
  return (
    <label className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, ...style }}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}

export const fieldStyle = { width: '100%', height: 44, padding: '0 12px', fontSize: 14 };

export function PxSelect({ value, onChange, options, ariaLabel, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="mono field"
      style={{ ...fieldStyle, padding: '0 8px', cursor: 'pointer', ...style }}
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

// Compact segmented control (one ring around the group).
export function Seg({ options, value, onChange, ariaLabel, height = 40, style }) {
  return (
    <div role="group" aria-label={ariaLabel} className="pxs" style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="tv-seg"
          aria-pressed={value === o.id}
          aria-label={o.aria}
          title={o.title}
          onClick={() => onChange(o.id)}
          style={{ height, minWidth: o.icon ? 40 : undefined, padding: o.icon ? 0 : '0 14px', fontSize: 12, display: 'grid', placeItems: 'center' }}
        >{o.icon || o.label}</button>
      ))}
    </div>
  );
}

// Pixel checkbox (toggle button).
export function Chk({ on, onClick, label }) {
  return (
    <button type="button" className="tv-chk" aria-pressed={!!on} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <IconCheck size={14} />
    </button>
  );
}

// Small × remove button.
export function XBtn({ onClick, label = 'Remove', style }) {
  return (
    <button type="button" className="tv-x" aria-label={label} title={label} style={style}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <IconClose size={14} />
    </button>
  );
}

// ─── States ─────────────────────────────────────────────────────
export function Loading({ label = 'LOADING', style }) {
  return (
    <div role="status" className="sk" style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '18px 4px', fontSize: 11,
      color: COLORS.muted, textTransform: 'uppercase', ...style,
    }}>
      <span className="dots-step" aria-hidden="true" style={{ color: GOLD, display: 'inline-flex' }}><i /><i /><i /></span>
      {label}
    </div>
  );
}

export function Empty({ title = 'NO SAVE DATA', hint, action, icon, style }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      padding: '30px 18px', textAlign: 'center', ...style,
    }}>
      {icon || <PixelFlag size={34} fill="var(--rule)" />}
      <p className="sk" style={{ margin: 0, fontSize: 14, color: COLORS.text }}>{title}</p>
      {hint && <p style={{ margin: 0, maxWidth: 380, fontSize: 13, lineHeight: 1.55, color: COLORS.muted }}>{hint}</p>}
      {action}
    </div>
  );
}

// Red pixel banner for errors (ink text on the accent fill).
export function ErrorNote({ children, style }) {
  return (
    <div role="alert" className="pxs" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px',
      fontSize: 13, lineHeight: 1.45, color: ON, background: '#ff7a7a', ...style,
    }}>
      <IconWarn size={18} fill="#ff7a7a" />
      <span style={{ minWidth: 0, flex: 1 }}>{children}</span>
    </div>
  );
}

// ─── Overlays ───────────────────────────────────────────────────
// Dialogs render into <body>: the app shell animates the route wrapper with
// transforms, which would otherwise trap position:fixed inside the module.
export function Overlay({ children }) {
  if (typeof document === 'undefined') return children;
  return createPortal(<div className="tv4 tv-portal">{children}</div>, document.body);
}

// ─── Dialog ─────────────────────────────────────────────────────
// Paper box with the big pixel ring over a dimmed backdrop. Click outside
// closes (same as before). `as="form"` turns the box into the form.
export function PxDialog({
  kicker, title, sub, onClose, children, footer, width = 560, zIndex = 1000,
  as: Tag = 'div', onSubmit, bodyStyle,
}) {
  const id = useId();
  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex, background: 'var(--tv-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <Tag
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          onClick={(e) => e.stopPropagation()}
          onSubmit={onSubmit}
          className="px"
          style={{
            width, maxWidth: 'calc(100% - 20px)', maxHeight: 'calc(100vh - 56px)', overflow: 'auto',
            display: 'flex', flexDirection: 'column', background: COLORS.paper, color: COLORS.text,
          }}
        >
          <header style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
            padding: '16px 20px', borderBottom: '3px dashed var(--rule)',
          }}>
            <div style={{ minWidth: 0 }}>
              {kicker && <Label as="p" style={{ margin: '0 0 6px' }}>{kicker}</Label>}
              <h2 id={id} className="pf" style={{ margin: 0, fontSize: 24, lineHeight: 1.1 }}>{title}</h2>
              {sub && <p className="mono" style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.muted }}>{sub}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="pxs" style={{
              display: 'grid', placeItems: 'center', flexShrink: 0, width: 40, height: 40, padding: 0,
              color: COLORS.text, background: COLORS.paper, border: 0, cursor: 'pointer',
            }}><IconClose size={16} /></button>
          </header>
          <div style={{ padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 16, ...bodyStyle }}>
            {children}
          </div>
          {footer && (
            <footer style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 18,
              padding: '16px 26px 22px 20px', borderTop: '3px dashed var(--rule)',
            }}>{footer}</footer>
          )}
        </Tag>
      </div>
    </Overlay>
  );
}
