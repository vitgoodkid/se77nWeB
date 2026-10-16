// se77n arcade kit — React building blocks for the "B · Pixel Lobby" look.
// Pair with the classes in src/arcade.css. Colours come from COLORS/ACCENTS
// (lib.jsx) so everything follows the light/dark theme.
import { COLORS, ACCENTS } from '../lib.jsx';

const COIN_PATH = 'M2 0h4v1h1v1h1v4H7v1H6v1H2V7H1V6H0V2h1V1h1z';
const HEART_PATH = 'M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z';
const CLOUD_PATH = 'M5 0h4v1h2v1h3v1h2v3H0V3h2V2h2V1h1z';

export function PixelCoin({ size = 16, spin = false, style }) {
  return (
    <svg className={spin ? 'coin-spin' : undefined} width={size} height={size} viewBox="0 0 8 8"
      shapeRendering="crispEdges" aria-hidden="true" style={style}>
      <path d={COIN_PATH} fill="#ffc93c" stroke="#1b1410" strokeWidth="0.5" />
      <rect x="4" y="2" width="1" height="4" fill="#c98a12" />
    </svg>
  );
}

export function PixelHeart({ size = 22, color = '#e04545', style }) {
  return (
    <svg width={size} height={Math.round(size * 6 / 7)} viewBox="0 0 7 6" shapeRendering="crispEdges"
      aria-hidden="true" style={style}>
      <path d={HEART_PATH} fill={color} stroke="#1b1410" strokeWidth="0.35" />
    </svg>
  );
}

export function PixelCloud({ width = 96, style, className }) {
  return (
    <svg className={className} width={width} height={Math.round(width * 6 / 16)} viewBox="0 0 16 6"
      shapeRendering="crispEdges" aria-hidden="true" style={style}>
      <path d={CLOUD_PATH} fill="#ffffff" />
    </svg>
  );
}

// Pixel triangle: right ▶ (menu cursor / play), down ▼ (dialog continue), left ◀ (back).
export function PixelArrow({ dir = 'right', size = 12, color = 'currentColor', className, style }) {
  if (dir === 'down') {
    return (
      <svg className={className} width={size * 5 / 3} height={size} viewBox="0 0 5 3" shapeRendering="crispEdges" aria-hidden="true" style={style}>
        <path d="M0 0h5v1H4v1H3v1H2V2H1V1H0z" fill={color} />
      </svg>
    );
  }
  const d = dir === 'left' ? 'M3 0h1v5H3V4H2V3H1V2h1V1h1z' : 'M0 0h1v1h1v1h1v1H2v1H1v1H0z';
  return (
    <svg className={className} width={size * 4 / 5} height={size} viewBox="0 0 4 5" shapeRendering="crispEdges" aria-hidden="true" style={style}>
      <path d={d} fill={color} />
    </svg>
  );
}

// Square-cap stroke icons, one per module id.
const ICONS = {
  home: <><path d="M3 11 12 3l9 8" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5h4v5" /></>,
  ai: <path d="M12 3l1.9 7.1L21 12l-7.1 1.9L12 21l-1.9-7.1L3 12l7.1-1.9z" />,
  tools: <><rect x="3" y="8" width="18" height="12" /><path d="M9 8V5h6v3M3 13h18M11 13v2h2v-2" /></>,
  game: <><rect x="2" y="7" width="20" height="11" /><path d="M7 10.5v4M5 12.5h4" /><rect x="15" y="11" width="1.5" height="1.5" /><rect x="17.5" y="13.5" width="1.5" height="1.5" /></>,
  crypto: <><circle cx="12" cy="12" r="9" /><path d="M15 9.2c-.6-.9-1.7-1.4-3-1.4-1.7 0-3 .8-3 2.1s1.3 1.8 3 2.1 3 .8 3 2.1-1.3 2.1-3 2.1c-1.4 0-2.5-.5-3-1.4M12 6v12" /></>,
  feed: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  kata: <><rect x="3" y="5" width="18" height="14" /><path d="M7 10l3 2-3 2M12.5 15H17" /></>,
  stylist: <path d="M10 6a2 2 0 1 1 2 2v1.5l8.4 6a1 1 0 0 1-.6 1.8H4.2a1 1 0 0 1-.6-1.8l8.4-6" />,
  store: <><path d="M5 8h14l-1.2 12H6.2z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
  tv4: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  tech: <><rect x="3" y="5" width="18" height="15" /><path d="M3 10h18M8 3v4M16 3v4M7 14h4" /></>,
  todo: <><rect x="4" y="4" width="16" height="16" /><path d="M8 12l3 3 5-6" /></>,
};

export function ModuleIcon({ id, size = 24, strokeWidth = 2.4, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" style={style}>
      {ICONS[id] || ICONS.home}
    </svg>
  );
}

// Accent icon tile (module badge).
export function IconTile({ id, accent, size = 56, iconSize, style }) {
  return (
    <span className="pxs" style={{
      display: 'grid', placeItems: 'center', flexShrink: 0, width: size, height: size,
      background: accent || ACCENTS[id] || COLORS.paper, color: COLORS.onAccent, ...style,
    }}>
      <ModuleIcon id={id} size={iconSize || Math.round(size * 0.5)} />
    </span>
  );
}

// Paper panel with the big pixel ring.
export function PxPanel({ children, style, padding = 24, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag className={'px ' + className} style={{ position: 'relative', background: COLORS.paper, padding, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

// RPG dialog box with a name plate straddling the top edge and a ▼ prompt.
export function DialogBox({ speaker = 'SE77N SAYS:', children, style, padding = '30px 26px 24px', showArrow = true }) {
  return (
    <div style={{ position: 'relative', marginTop: 16, ...style }}>
      <span className="sk" style={{
        position: 'absolute', left: 16, top: -14, zIndex: 1, padding: '5px 10px',
        fontSize: 11, color: COLORS.stripText, background: COLORS.strip,
      }}>{speaker}</span>
      <div className="px" style={{ position: 'relative', padding, background: COLORS.paper }}>
        {children}
        {showArrow && (
          <PixelArrow dir="down" size={9} color={COLORS.red} className="bob"
            style={{ position: 'absolute', right: 16, bottom: 12 }} />
        )}
      </div>
    </div>
  );
}

// Pixel button. kind: 'big' (pbtn) or 'small' (sbtn). Fill defaults to paper.
export function PxButton({ kind = 'small', fill, children, className = '', style, as: Tag = 'button', ...rest }) {
  const big = kind === 'big';
  return (
    <Tag className={(big ? 'pbtn ' : 'sbtn ') + 'sk ' + className} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      minHeight: big ? 52 : 40, padding: big ? '0 22px' : '0 14px',
      fontSize: big ? 15 : 12, textDecoration: 'none',
      background: fill || COLORS.paper, color: fill ? COLORS.onAccent : COLORS.text,
      ...style,
    }} {...rest}>
      {children}
    </Tag>
  );
}

// Filter / segmented chip.
export function PxChip({ on = false, children, className = '', style, ...rest }) {
  return (
    <button type="button" aria-pressed={on} className={'chip-px sk ' + (on ? 'on ' : '') + className}
      style={{ minHeight: 36, padding: '0 12px', fontSize: 11, ...style }} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ children, color, style }) {
  return (
    <span className="sk pxs" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 7px', fontSize: 10,
      background: color || COLORS.paper, color: color ? COLORS.onAccent : COLORS.text, whiteSpace: 'nowrap', ...style,
    }}>{children}</span>
  );
}

export function HpBar({ value = 0, accent, label, style }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={style}>
      {label && <div className="sk" style={{ fontSize: 10, color: COLORS.muted, marginBottom: 6 }}>{label}</div>}
      <div className="hpbar" style={{ '--a': accent || '#7fd18b' }}>
        <span style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}

export function StatTile({ label, value, accent, sub, style }) {
  return (
    <div className="pxs" style={{ padding: '14px 16px', background: COLORS.paper, minWidth: 0, ...style }}>
      <div className="sk" style={{ fontSize: 10, color: COLORS.muted }}>{label}</div>
      <div className="pf" style={{ marginTop: 6, fontSize: 28, lineHeight: 1.05, color: COLORS.text }}>
        {accent && <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, marginRight: 8, background: accent, boxShadow: '0 0 0 2px var(--ink)', verticalAlign: 'middle' }} />}
        {value}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: COLORS.muted }}>{sub}</div>}
    </div>
  );
}

export function EmptyState({ title = 'NO SAVE DATA', hint, action, style }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 12, padding: '36px 16px', textAlign: 'center', ...style }}>
      <PixelCoin size={36} spin />
      <div className="sk" style={{ fontSize: 14, color: COLORS.text }}>{title}</div>
      {hint && <div style={{ maxWidth: 360, fontSize: 12, lineHeight: 1.6, color: COLORS.muted }}>{hint}</div>}
      {action}
    </div>
  );
}

// Brick + grass ground strip (footers, scene floors).
export function Bricks({ height = 48, style }) {
  return <div className="bricks" aria-hidden="true" style={{ height, ...style }} />;
}
