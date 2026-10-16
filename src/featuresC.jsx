// featuresC.jsx — AI Outfit Stylist.
//
// Wardrobe (upload → AI detects garment(s) → catalog item, with edit/retry/
// pin/exclude/filter/stats), a Character (photo + height/gender/build/skin →
// generated model, editable), occasion mixing (constraints, more-like-this,
// shuffle, manual swap, favourites) and lookbooks that render the character
// wearing the outfit (pose/scene/framing/ratio + download/regenerate).
//
// All AI goes through /api/agent (detect/classify/mix) and /api/image (catalog
// re-render, character, lookbook) — no new serverless functions. Image bytes
// cache on-device (IndexedDB); only small metadata syncs via useSyncedData.
//
// Look: "B · Pixel Lobby" RPG equip screen — a stage path, the character as a
// dark portrait frame with equip slots (pinned pieces), the wardrobe as an
// inventory grid, mixed sets as loadout cards and saved looks as save slots.
// Real photos stay real images inside pixel frames. Pixel classes come from
// arcade.css plus the sty-* rules in featuresC.arcade.css.

import './featuresC.arcade.css';
import { Fragment, useState, useRef, useCallback, useMemo, useEffect, useId } from 'react';
import {
  COLORS, ACCENTS,
  useLang, useSyncedData, useMediaQuery, compressImage, usePasteImage,
} from './lib.jsx';
import { createPortal } from 'react-dom';
import { DialogBox, PixelArrow } from './ui/arcade.jsx';
import { useCachedImage, idbPut, idbGet, idbDel } from './lib/idb.js';

const CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];
const ACCENT = ACCENTS.stylist;    // Stylist pink — accent fills always carry ink text
const ON_ACCENT = COLORS.onAccent; // ink text on any accent fill (both themes)
const GOLD = ACCENTS.crypto;       // #ffd25e
const GREEN = ACCENTS.tools;       // #7fd18b
const SALMON = ACCENTS.ai;         // #ff7a7a — errors / excluded
const DIM = '#c9bca6';             // muted text on the always-dark screens
const SCANLINES = 'repeating-linear-gradient(0deg, rgba(255, 250, 240, 0.06) 0 2px, transparent 2px 5px)';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const opt = (arr) => arr.map((v) => ({ v, label: cap(v) }));
const GENDERS = opt(['female', 'male', 'neutral']);
const BODY    = opt(['slim', 'average', 'athletic', 'curvy', 'plus']);
const SKIN    = opt(['light', 'medium', 'tan', 'deep']);
const POSES   = opt(['auto', 'standing', 'walking', 'sitting']);
const SCENES  = opt(['studio', 'street', 'outdoor', 'indoor']);
const FRAMINGS = [{ v: 'full', label: 'Full body' }, { v: 'half', label: 'Upper body' }];
const RATIOS   = [{ v: '3:4', label: '3:4' }, { v: '1:1', label: '1:1' }, { v: '9:16', label: '9:16' }];
const FORMALITY = opt(['casual', 'smart', 'formal']);
const SEASONS   = opt(['spring', 'summer', 'autumn', 'winter']);
const PRESETS = [
  { k: 'work', occ: 'work / office' }, { k: 'date', occ: 'a date night' },
  { k: 'casual', occ: 'casual everyday' }, { k: 'gym', occ: 'gym / workout' },
  { k: 'party', occ: 'a party' }, { k: 'formal', occ: 'a formal event' },
];
const DEFAULT_LOOK = { pose: 'auto', scene: 'studio', framing: 'full', ratio: '3:4' };

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || [, 'image/jpeg'])[1];
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
async function downloadImage(url, filename) {
  try {
    const r = await fetch('/api/image?url=' + encodeURIComponent(url));
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = filename || 'lookbook.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch { window.open(url, '_blank'); }
}

// ── Prompts ────────────────────────────────────────────────────
function catalogPrompt(g) {
  return `Studio e-commerce product photo showing ONLY the ${g.color ? g.color + ' ' : ''}${g.name} (${g.category}) from this image, isolated on a clean seamless light-grey background, centered, no model, no other items, soft even lighting, sharp focus, catalog style. Keep its real color, pattern and shape.`;
}
function characterPrompt(p, tweak, multi) {
  const bits = [];
  if (p.gender) bits.push(p.gender);
  if (p.bodyType) bits.push(p.bodyType + ' build');
  if (p.skinTone) bits.push(p.skinTone + ' skin tone');
  if (p.height) bits.push('about ' + p.height + ' cm tall');
  const desc = bits.length ? ` The person is ${bits.join(', ')}.` : '';
  const tw = tweak && tweak.trim() ? ` ${tweak.trim()}.` : '';
  const ref = multi ? 'the same person shown across the provided reference photos (multiple angles)' : 'this exact person';
  return `A clean, photorealistic full-body portrait of ${ref}, standing in a neutral relaxed pose, facing the camera, plain light-grey studio background, soft even lighting, full body visible head to toe.${desc}${tw} Keep their real face and identity. No text.`;
}

// Build a /api/image body from 1..N reference photos (multiple face angles
// improve likeness). Falls back to an existing character URL when none given.
function charRenderBody(params, tweak, photos, fallbackUrl) {
  const urls = (photos || []).map((p) => p?.dataUrl).filter(Boolean);
  if (urls.length > 1) return { prompt: characterPrompt(params, tweak, true), images: urls, engine: 'nano' };
  if (urls.length === 1) return { prompt: characterPrompt(params, tweak, false), image: urls[0], engine: 'nano' };
  return { prompt: characterPrompt(params, tweak, false), image: fallbackUrl, engine: 'nano' };
}
function lookbookPrompt(occasion, character, o) {
  const occ = (occasion || '').trim();
  const styled = occ ? `, styled for ${occ}` : '';
  const pose = ({ auto: 'a natural relaxed random pose', standing: 'standing confidently', walking: 'walking naturally', sitting: 'sitting casually' })[o.pose] || 'a natural relaxed pose';
  const scene = ({ studio: 'a clean studio background', street: 'an urban street background', outdoor: 'a natural outdoor background', indoor: 'a stylish indoor background' })[o.scene] || 'a clean studio background';
  const frame = o.framing === 'half' ? 'framed from head to hips (upper body)' : 'full body visible head to toe';
  const ratio = ({ '3:4': 'vertical 3:4 portrait orientation', '1:1': 'square 1:1 framing', '9:16': 'tall 9:16 vertical orientation' })[o.ratio] || 'vertical 3:4 portrait orientation';
  const params = [];
  if (character?.gender) params.push(character.gender);
  if (character?.bodyType) params.push(character.bodyType + ' build');
  if (character?.skinTone) params.push(character.skinTone + ' skin tone');
  if (character?.height) params.push('about ' + character.height + ' cm tall');
  const pdesc = params.length ? ` The person is ${params.join(', ')}.` : '';
  if (character?.charUrl) {
    return `Generate a photorealistic fashion photo of the exact person shown in the FIRST image, in ${pose}, wearing a complete outfit assembled from the clothing pieces in the following images. ${frame}, ${scene}${styled}, ${ratio}.${pdesc} Keep the person's real face and identity; keep each garment's real color, pattern and shape.`;
  }
  return `Generate a photorealistic fashion photo of a person in ${pose} wearing a complete outfit assembled from the clothing pieces in these images. ${frame}, ${scene}${styled}, ${ratio}.${pdesc} Keep each garment's real color, pattern and shape.`;
}

// ── fetch helpers ──────────────────────────────────────────────
async function safeJson(res, label) {
  const raw = await res.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { /* not JSON */ } }
  if (!res.ok) throw new Error(data?.error || data?.message || `${label} ${res.status}`);
  if (!data) throw new Error(`${label}: empty response`);
  return data;
}
async function pollImage(initial) {
  if (initial?.image) return initial.image;
  if (!initial?.pending || !initial.statusUrl) throw new Error('image: missing url and not pending');
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const data = await safeJson(await fetch(initial.statusUrl), 'image');
    if (data.image) return data.image;
    if (!data.pending) throw new Error('image: unexpected response');
  }
  throw new Error('image: still rendering after 10 min');
}
async function renderImage(body) {
  const res = await fetch('/api/image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return pollImage(await safeJson(res, 'image'));
}

// ── Pixel icons ────────────────────────────────────────────────
// Tiny bitmaps ('#' = ink pixel) → one crisp SVG path each. Rendered at
// whole multiples of the grid (7px grid → 14 / 21px) so pixels stay square.
function bitmap(rows) {
  let d = '';
  rows.forEach((row, y) => row.replace(/#+/g, (run, x) => { d += `M${x} ${y}h${run.length}v1H${x}z`; return run; }));
  return { d, w: rows[0].length, h: rows.length };
}
const PIX = {
  spark: bitmap(['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...']),
  diamond: bitmap(['...#...', '..#.#..', '.#...#.', '#.....#', '.#...#.', '..#.#..', '...#...']),
  plus: bitmap(['...#...', '...#...', '...#...', '#######', '...#...', '...#...', '...#...']),
  check: bitmap(['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....']),
  close: bitmap(['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#']),
  star: bitmap(['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.']),
  pin: bitmap(['.#####.', '..###..', '..###..', '.#####.', '#######', '...#...', '...#...']),
  ban: bitmap(['#######', '#....##', '#...#.#', '#..#..#', '#.#...#', '##....#', '#######']),
  edit: bitmap(['.....##', '....###', '...###.', '..###..', '.###...', '.##....', '#......']),
  retry: bitmap(['.####.#', '#....##', '#...###', '#......', '#.....#', '#.....#', '.#####.']),
  download: bitmap(['...#...', '...#...', '.#.#.#.', '..###..', '...#...', '.......', '#######']),
  upload: bitmap(['#######', '.......', '...#...', '..###..', '.#.#.#.', '...#...', '...#...']),
  shuffle: bitmap(['.....#.', '#######', '.....#.', '.......', '.#.....', '#######', '.#.....']),
  expand: bitmap(['###.###', '#.....#', '#.....#', '.......', '#.....#', '#.....#', '###.###']),
  bang: bitmap(['###', '###', '###', '###', '...', '###', '###']),
};
function Pix({ name, size = 14, color = 'currentColor', className, style }) {
  const b = PIX[name];
  return (
    <svg className={className} width={Math.round((size * b.w) / b.h)} height={size} viewBox={`0 0 ${b.w} ${b.h}`}
      shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block', flexShrink: 0, ...style }}>
      <path d={b.d} fill={color} />
    </svg>
  );
}

// Garment sprites for the five real categories (16px grid).
const CAT_PATH = {
  top: 'M4 2h3v1h2V2h3v1h2v1h1v3h-2v7H3V7H1V4h1V3h2z',
  bottom: 'M4 1h8v3h1v11H9V7H7v8H3V4h1z',
  outer: 'M4 1h3v2h2V1h3v1h2v2h1v5h-2v6H3V9H1V4h1V2h2z',
  shoes: 'M2 6h5v2h2v1h3v1h2v1h1v3H1V6z',
  accessory: 'M2 6h12v9H2z',
};
const CAT_DETAIL = {
  top: 'M10 6h2v1h-2z',
  bottom: 'M4 3h8v1H4z',
  outer: 'M7.5 3h1v12h-1z',
  shoes: 'M1 13h14v1H1zM5 8h1v1H5z',
  accessory: 'M5 2h6v4h-1V3H6v3H5zM7 9h2v2H7z',
};
function CatIcon({ cat, size = 32, fill = 'none', stroke = 'currentColor', detail = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d={CAT_PATH[cat] || CAT_PATH.top} fill={fill} stroke={stroke} strokeWidth="0.8" />
      <path d={CAT_DETAIL[cat] || CAT_DETAIL.top} fill={detail} />
    </svg>
  );
}

// Placeholder model sprite shown before a character exists. Equipped (pinned)
// categories light up in accent colours.
function Silhouette({ equipped, height = 200 }) {
  const has = (c) => equipped.some((it) => it.category === c);
  const off = '#5c5046';
  const skin = DIM;
  const top = has('top') ? ACCENT : off;
  const outer = has('outer') ? GOLD : null;
  return (
    <svg className="bob" width={height / 2} height={height} viewBox="0 0 12 24" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 0h4v1h1v4H8v1H4V5H3V1h1z" fill={skin} />
      <path d="M5 6h2v1H5z" fill={skin} />
      <path d="M1 7h2v7H1zM9 7h2v7H9z" fill={outer || top} stroke="#fffaf0" strokeWidth="0.2" />
      <path d="M1 14h2v1H1zM9 14h2v1H9z" fill={skin} />
      <path d="M3 7h6v7H3z" fill={top} stroke="#fffaf0" strokeWidth="0.2" />
      <path d="M3 14h6v6H7v-4H5v4H3z" fill={has('bottom') ? '#7aa8ff' : off} stroke="#fffaf0" strokeWidth="0.2" />
      {outer && <path d="M3 7h2v8H3zM7 7h2v8H7z" fill={outer} stroke="#fffaf0" strokeWidth="0.2" />}
      <path d="M2 20h3v2H2zM7 20h3v2H7z" fill={has('shoes') ? GREEN : off} stroke="#fffaf0" strokeWidth="0.2" />
      {has('accessory') && <path d="M10 15h2v3h-2z" fill="#ffa764" stroke="#fffaf0" strokeWidth="0.2" />}
    </svg>
  );
}

// ── Tiny UI atoms ──────────────────────────────────────────────
function Chip({ active, onClick, children, title, mini }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!active}
      className={'chip-px sk' + (active ? ' on' : '')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
        minHeight: mini ? 26 : 34, padding: mini ? '0 7px' : '0 12px', fontSize: mini ? 9 : 11,
      }}>{children}</button>
  );
}
function ChipRow({ options, value, onChange, nullable, label, mini }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: mini ? 9 : 12, flexWrap: 'wrap', padding: 3 }}>
      {options.map((o) => (
        <Chip key={o.v} mini={mini} active={value === o.v}
          onClick={() => onChange(nullable && value === o.v ? null : o.v)}>{o.label}</Chip>
      ))}
    </div>
  );
}
function IconBtn({ onClick, title, children, active, excl, danger, size = 30 }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      aria-pressed={active === undefined ? undefined : !!active}
      className={'sty-ibtn' + (active ? (excl ? ' xon' : ' on') : '') + (danger ? ' danger' : '')}
      style={{ width: size, height: size }}>{children}</button>
  );
}
// Small pressable pixel button. fill = accent (ink text); ink = dark strip fill.
function SBtn({ onClick, children, fill, ink, disabled, title, style }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="sk sbtn" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      minHeight: 38, padding: '0 13px', fontSize: 11, lineHeight: 1.2, whiteSpace: 'nowrap', textTransform: 'uppercase',
      background: ink ? COLORS.strip : fill || COLORS.paper,
      color: ink ? COLORS.stripText : fill ? ON_ACCENT : COLORS.text,
      ...style,
    }}>{children}</button>
  );
}
function BtnRow({ children, style }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 16px', padding: '3px 8px 8px 3px', ...style }}>{children}</div>;
}
function Lbl({ htmlFor, children }) {
  return <label htmlFor={htmlFor} className="sk" style={{ display: 'block', marginBottom: 9, fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>{children}</label>;
}
function GroupLbl({ children, style }) {
  return <div className="sk" style={{ marginBottom: 9, fontSize: 10, color: COLORS.muted, textTransform: 'uppercase', ...style }}>{children}</div>;
}
function PxInput({ id, value, onChange, placeholder, onKeyDown, small, inputMode }) {
  return (
    <input id={id} type="text" inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} onKeyDown={onKeyDown} className="field mono" style={{
        display: 'block', width: '100%', minWidth: 0,
        height: small ? 32 : 44, padding: small ? '0 8px' : '0 13px', fontSize: small ? 12 : 13,
      }} />
  );
}
// Paper panel with an ink name plate straddling its top edge.
function Plate({ label, children, pad = '36px 26px 28px', style, ariaLabel }) {
  return (
    <section aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      style={{ position: 'relative', marginTop: 16, minWidth: 0, ...style }}>
      <div className="px" style={{ position: 'relative', padding: pad, background: COLORS.paper }}>
        <span className="sk" style={{
          position: 'absolute', left: 18, top: -16, zIndex: 2, maxWidth: 'calc(100% - 36px)',
          padding: '7px 12px', fontSize: 11, color: COLORS.stripText, background: COLORS.strip,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase',
        }}>{label}</span>
        {children}
      </div>
    </section>
  );
}
function SectionHead({ kicker, title, right }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 30 }}>
      <div>
        <div className="sk" style={{ marginBottom: 9, fontSize: 12, color: COLORS.muted, textTransform: 'uppercase' }}>{kicker}</div>
        <h2 className="pf" style={{ margin: 0, fontSize: 34, lineHeight: 1, color: COLORS.text }}>{title}</h2>
      </div>
      {right}
    </div>
  );
}
function EmptyBox({ icon, title, hint, action, framed }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '42px 20px', textAlign: 'center',
      border: framed ? '3px dashed ' + COLORS.rule : 0,
    }}>
      {icon}
      <div className="sk" style={{ fontSize: 16, color: COLORS.text, textTransform: 'uppercase' }}>{title}</div>
      {hint && <p style={{ margin: 0, maxWidth: 380, fontSize: 13, lineHeight: 1.55, color: COLORS.muted }}>{hint}</p>}
      {action && <div style={{ padding: '4px 8px 8px 4px' }}>{action}</div>}
    </div>
  );
}
function TagList({ tags, empty }) {
  if (!tags.length) return <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: COLORS.muted }}>{empty}</p>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 3 }}>
      {tags.map((x, i) => (
        <span key={i} className="sk pxs" style={{ padding: '4px 8px', fontSize: 10, color: COLORS.text, background: COLORS.field, textTransform: 'uppercase' }}>{x}</span>
      ))}
    </div>
  );
}
function Toggle({ open, onClick, children }) {
  return (
    <button type="button" className="sk sty-tog" aria-expanded={open} onClick={onClick}>
      <span style={{ display: 'grid', placeItems: 'center', width: 15 }}>
        <PixelArrow dir={open ? 'down' : 'right'} size={9} color="currentColor" />
      </span>
      {children}
    </button>
  );
}
function CachedImg({ cacheKey, url, alt, style, onClick, className }) {
  const src = useCachedImage(cacheKey, url);
  if (!src) {
    return (
      <div className={className} onClick={onClick} style={{ ...style, background: COLORS.field, color: COLORS.muted, display: 'grid', placeItems: 'center' }}>
        <Pix name="diamond" size={14} />
      </div>
    );
  }
  return <img className={className} src={src} alt={alt || ''} style={style} loading="lazy" onClick={onClick} />;
}

// Full-screen image viewer — click an image (item / character / lookbook) to
// open; click anywhere or press Esc to close. Pixel modal: pink mat, ink plate.
function Lightbox({ data, onClose }) {
  const { lang } = useLang();
  useEffect(() => {
    if (!data) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);
  if (!data) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={data.alt || 'image'} onClick={onClose} className="sty-lb" style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '64px 20px 24px',
      backgroundColor: 'rgba(27, 20, 16, 0.9)', backgroundImage: SCANLINES,
      cursor: 'zoom-out',
    }}>
      <div style={{ position: 'relative', maxWidth: '100%' }}>
        <span className="sk" style={{
          position: 'absolute', left: 14, top: -15, zIndex: 1, maxWidth: 'calc(100% - 28px)', padding: '6px 11px',
          fontSize: 11, color: COLORS.stripText, background: COLORS.strip, textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{data.alt || 'image'}</span>
        <div className="px" style={{ padding: 10, background: ACCENT }}>
          <CachedImg cacheKey={data.cacheKey} url={data.url} alt={data.alt}
            style={{ maxWidth: 'calc(96vw - 64px)', maxHeight: 'calc(100vh - 170px)', objectFit: 'contain', display: 'block', background: '#fffaf0' }} />
        </div>
        <div className="sk" style={{ marginTop: 18, textAlign: 'center', fontSize: 10, color: DIM }}>
          {lang === 'vi' ? 'BẤM BẤT KỲ ĐÂU · ESC ĐỂ ĐÓNG' : 'CLICK ANYWHERE · ESC TO CLOSE'}
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="close" className="sbtn" style={{
        position: 'fixed', top: 16, right: 20, display: 'grid', placeItems: 'center', width: 44, height: 44, padding: 0,
        color: ON_ACCENT, background: ACCENT,
      }}><Pix name="close" size={14} /></button>
    </div>,
    document.body,
  );
}

// ── Wardrobe item card (inventory slot) ────────────────────────
function ItemCard({ item, pinned, excluded, onEdit, onDelete, onRetry, onTogglePin, onToggleExclude, onZoom }) {
  const { t } = useLang();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [cat, setCat] = useState(item.category);
  const [color, setColor] = useState(item.color || '');
  const processing = item.status === 'processing';
  const error = item.status === 'error';

  const save = () => { onEdit(item.id, { name: name.trim() || 'item', category: cat, color: color.trim() }); setEditing(false); };

  return (
    <article className="pxs" aria-label={item.name} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: COLORS.paper }}>
      <div className={'sty-med' + (pinned ? ' pin' : '') + (excluded ? ' xcl' : '')}>
        {processing ? (
          <div className="sty-state">
            <span style={{ opacity: 0.45, color: COLORS.muted }}><CatIcon cat={item.category} size={48} /></span>
            <span className="sk blink" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10, color: COLORS.text, textTransform: 'uppercase' }}>
              <Pix name="diamond" size={14} />{t('stylist.processing')}
            </span>
            <span className="sty-bar" aria-hidden="true"><i /></span>
          </div>
        ) : error ? (
          <div className="sty-state">
            <Pix name="bang" size={21} color={COLORS.red} />
            <span className="sk" style={{ maxWidth: '100%', padding: '3px 6px', fontSize: 9, lineHeight: 1.4, color: ON_ACCENT, background: SALMON, overflowWrap: 'anywhere' }}>
              {item.error || 'failed'}
            </span>
          </div>
        ) : (
          <CachedImg className="sty-img" cacheKey={'item:' + item.id} url={item.itemUrl} alt={item.name}
            onClick={() => onZoom && onZoom('item:' + item.id, item.itemUrl, item.name)} />
        )}
        {pinned && <span className="sk sty-tag" style={{ color: COLORS.stripText, background: COLORS.strip }}>{t('stylist.pinned')}</span>}
        {excluded && <span className="sk sty-tag" style={{ color: ON_ACCENT, background: SALMON }}>{t('stylist.excluded')}</span>}
        <div className="sty-tools">
          {error && <IconBtn size={26} onClick={() => onRetry(item)} title={t('stylist.retry')}><Pix name="retry" size={14} /></IconBtn>}
          <IconBtn size={26} danger onClick={() => onDelete(item)} title={t('stylist.delete')}><Pix name="close" size={14} /></IconBtn>
        </div>
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 10px 12px' }}>
          <label htmlFor={uid + 'n'} className="sr">name</label>
          <PxInput id={uid + 'n'} small value={name} onChange={setName} placeholder="name" />
          <ChipRow mini label="category" options={CATEGORIES.map((c) => ({ v: c, label: t('stylist.cat.' + c) }))} value={cat} onChange={setCat} />
          <label htmlFor={uid + 'c'} className="sr">color</label>
          <PxInput id={uid + 'c'} small value={color} onChange={setColor} placeholder="color" />
          <BtnRow style={{ gap: 12 }}>
            <SBtn fill={ACCENT} onClick={save} style={{ minHeight: 30, padding: '0 9px', fontSize: 10 }}>{t('stylist.save')}</SBtn>
            <SBtn onClick={() => setEditing(false)} style={{ minHeight: 30, padding: '0 9px', fontSize: 10 }}>{t('stylist.cancel')}</SBtn>
          </BtnRow>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 10px 12px' }}>
          <span title={item.name} style={{ overflow: 'hidden', fontSize: 13, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.name}</span>
          {!processing && (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className="sk" style={{ flexShrink: 0, padding: '3px 6px', fontSize: 9, color: ON_ACCENT, background: ACCENT, textTransform: 'uppercase' }}>{t('stylist.cat.' + item.category)}</span>
                {item.color && <span style={{ overflow: 'hidden', fontSize: 11, color: COLORS.muted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.color}</span>}
              </span>
              {!error && (
                <div style={{ display: 'flex', gap: 10, padding: '5px 3px 3px' }}>
                  <IconBtn onClick={() => onTogglePin(item.id)} active={pinned} title={t('stylist.pin')}><Pix name="pin" size={14} /></IconBtn>
                  <IconBtn onClick={() => onToggleExclude(item.id)} active={excluded} excl title={t('stylist.exclude')}><Pix name="ban" size={14} /></IconBtn>
                  <IconBtn onClick={() => { setName(item.name); setCat(item.category); setColor(item.color || ''); setEditing(true); }} title={t('stylist.edit')}><Pix name="edit" size={14} /></IconBtn>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

// ── Character panel (portrait frame + equip slots + player file) ──
function EquipSlot({ cat, item, n, label, size }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="pxs" role="img" title={item ? item.name : label}
        aria-label={label + ': ' + (item ? item.name : '—')} style={{
          position: 'relative', display: 'grid', placeItems: 'center', width: size, height: size,
          color: COLORS.muted, background: item ? ACCENT : COLORS.field,
        }}>
        {item
          ? <CachedImg cacheKey={'item:' + item.id} url={item.itemUrl} alt="" style={{ width: size - 10, height: size - 10, objectFit: 'cover', display: 'block' }} />
          : <span style={{ opacity: 0.7 }}><CatIcon cat={cat} size={32} /></span>}
        {n > 1 && (
          <span className="sk" style={{ position: 'absolute', right: -9, bottom: -9, padding: '2px 4px', fontSize: 9, color: COLORS.stripText, background: COLORS.strip }}>+{n - 1}</span>
        )}
      </span>
      <span className="sk" style={{ maxWidth: size + 16, fontSize: 9, lineHeight: 1.3, textAlign: 'center', color: COLORS.muted, textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

function CharacterPanel({ character, busy, onCreate, onEdit, onRemove, isMobile, onZoom, equipped = [] }) {
  const { t, lang } = useLang();
  const tt = (en, vi) => (lang === 'vi' ? vi : en);
  const uid = useId();
  const [open, setOpen] = useState(false); // edit form open
  const [photos, setPhotos] = useState([]); // 1..4 reference photos (face angles)
  const [name, setName] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState(null);
  const [bodyType, setBodyType] = useState(null);
  const [skinTone, setSkinTone] = useState(null);
  const [tweak, setTweak] = useState('');
  const fileRef = useRef(null);

  const pickPhotos = (e) => {
    const fs = Array.from(e.target.files || []);
    e.target.value = '';
    fs.forEach((f) => compressImage(f, { maxDim: 1280, maxBytes: 1_000_000 })
      .then((img) => img && setPhotos((p) => [...p, img].slice(0, 4))).catch(() => {}));
  };
  const resetForm = () => { setPhotos([]); setName(''); setHeight(''); setGender(null); setBodyType(null); setSkinTone(null); setTweak(''); };

  const startEdit = () => {
    setName(character?.name || ''); setHeight(character?.height ? String(character.height) : '');
    setGender(character?.gender || null); setBodyType(character?.bodyType || null);
    setSkinTone(character?.skinTone || null); setTweak(''); setPhotos([]); setOpen(true);
  };

  // Equip slots: pinned (ready) pieces per real category.
  const slotSize = isMobile ? 52 : 60;
  const slots = CATEGORIES.map((c) => {
    const its = equipped.filter((it) => it.category === c);
    return { c, item: its[0] || null, n: its.length };
  });
  const equipCount = slots.filter((s) => s.item).length;
  const slotEl = (s) => <EquipSlot key={s.c} cat={s.c} item={s.item} n={s.n} label={t('stylist.cat.' + s.c)} size={slotSize} />;
  const charName = character ? (character.name || t('stylist.charDefault')) : null;

  const portrait = (
    <div className="sty-screen" style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 262 : 312 }}>
      <span className="sty-corner tl" aria-hidden="true" />
      <span className="sty-corner tr" aria-hidden="true" />
      <span className="sty-corner bl" aria-hidden="true" style={{ bottom: 34 }} />
      <span className="sty-corner br" aria-hidden="true" style={{ bottom: 34 }} />
      <span className="sk" aria-hidden="true" style={{ position: 'absolute', left: 14, top: 13, zIndex: 2, padding: '2px 5px', fontSize: 10, color: ON_ACCENT, background: ACCENT }}>P1</span>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 12 }}>
        {character ? (
          <CachedImg cacheKey={'char:' + character.id} url={character.charUrl} alt={character.name || 'character'}
            onClick={() => onZoom && onZoom('char:' + character.id, character.charUrl, character.name || 'character')}
            style={{ position: 'absolute', left: 12, top: 12, width: 'calc(100% - 24px)', height: 'calc(100% - 24px)', objectFit: 'cover', objectPosition: 'center top', display: 'block', cursor: 'zoom-in' }} />
        ) : (
          <>
            <Silhouette equipped={equipped} height={isMobile ? 156 : 188} />
            <span aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: 14, width: 80, height: 6, marginLeft: -40, background: 'rgba(255, 250, 240, 0.14)' }} />
          </>
        )}
      </div>
      <div className="sk" style={{
        flexShrink: 0, height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: character ? COLORS.stripText : DIM, borderTop: '3px solid ' + ACCENT,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase',
      }}>{character ? charName : tt('No model yet', 'Chưa có nhân vật')}</div>
    </div>
  );

  const equipScreen = (
    <div style={{ display: 'grid', gridTemplateColumns: `${slotSize + 6}px minmax(0, 1fr) ${slotSize + 6}px`, gap: isMobile ? 12 : 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 3 }}>
        {slots.slice(0, 3).map(slotEl)}
      </div>
      {portrait}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 3 }}>
        {slots.slice(3).map(slotEl)}
        <div className="sk" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%', paddingTop: 10, borderTop: '3px dashed ' + COLORS.rule }}>
          <span style={{ fontSize: 9, color: COLORS.muted }}>{tt('EQUIP', 'TRANG BỊ')}</span>
          <span style={{ fontSize: 15, color: COLORS.text }}>{equipCount}/{CATEGORIES.length}</span>
        </div>
      </div>
    </div>
  );

  const photoStrip = (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 3 }}>
      {photos.map((p, i) => (
        <div key={i} className="pxs" style={{ position: 'relative', width: 72, height: 96, background: COLORS.field }}>
          <img src={p.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label="remove" className="sty-ibtn danger"
            style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22 }}><Pix name="close" size={7} /></button>
        </div>
      ))}
      {photos.length < 4 && (
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="add photo" className="chip-px" style={{
          position: 'relative', width: 72, height: 96, padding: 0, overflow: 'hidden', display: 'grid', placeItems: 'center', color: COLORS.text,
        }}>
          {photos.length === 0 && character
            ? <CachedImg cacheKey={'char:' + character.id} url={character.charUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
            : null}
          <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: 32, height: 32, color: ON_ACCENT, background: ACCENT }}><Pix name="plus" size={14} /></span>
        </button>
      )}
    </div>
  );

  const busyLabel = (
    <><Pix name="diamond" size={14} />{t('stylist.charCreating')}<span className="dots-step" aria-hidden="true"><i /><i /><i /></span></>
  );
  const form = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: 'none' }} />
      {!character && <p style={{ margin: 0, maxWidth: 560, fontSize: 13, lineHeight: 1.6, color: COLORS.muted }}>{t('stylist.charHint')}</p>}
      <div>
        <GroupLbl>{tt('Reference photos', 'Ảnh tham chiếu')}</GroupLbl>
        {photoStrip}
        <p style={{ margin: '10px 0 0', fontSize: 11, lineHeight: 1.5, color: COLORS.muted }}>{t('stylist.charPhotosHint')}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 22px' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0, padding: 3 }}>
          <Lbl htmlFor={uid + 'name'}>{tt('Name', 'Tên')}</Lbl>
          <PxInput id={uid + 'name'} value={name} onChange={setName} placeholder={t('stylist.charNamePh')} />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0, padding: 3 }}>
          <Lbl htmlFor={uid + 'height'}>{tt('Height', 'Chiều cao')}</Lbl>
          <PxInput id={uid + 'height'} inputMode="numeric" value={height} onChange={(v) => setHeight(v.replace(/\D/g, '').slice(0, 3))} placeholder={t('stylist.charHeightPh')} />
        </div>
      </div>
      <div><GroupLbl>{t('stylist.gender')}</GroupLbl><ChipRow options={GENDERS} value={gender} onChange={setGender} nullable label={t('stylist.gender')} /></div>
      <div><GroupLbl>{t('stylist.body')}</GroupLbl><ChipRow options={BODY} value={bodyType} onChange={setBodyType} nullable label={t('stylist.body')} /></div>
      <div><GroupLbl>{t('stylist.skin')}</GroupLbl><ChipRow options={SKIN} value={skinTone} onChange={setSkinTone} nullable label={t('stylist.skin')} /></div>
      {character && (
        <div style={{ padding: 3 }}>
          <Lbl htmlFor={uid + 'tweak'}>{tt('Tweak', 'Tinh chỉnh')}</Lbl>
          <PxInput id={uid + 'tweak'} value={tweak} onChange={setTweak} placeholder={t('stylist.charTweakPh')} />
        </div>
      )}
      <BtnRow style={{ gap: '16px 20px', padding: '4px 12px 12px 4px' }}>
        {character ? (
          <button type="button" className="sk pbtn" disabled={busy}
            onClick={() => onEdit({ photos, name, height, gender, bodyType, skinTone, tweak })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 18px', fontSize: 13, textTransform: 'uppercase', color: ON_ACCENT, background: ACCENT }}>
            {busy ? busyLabel : <><Pix name="spark" size={14} />{t('stylist.charRegen')}</>}
          </button>
        ) : (
          <button type="button" className="sk pbtn" disabled={busy || !photos.length || !height}
            onClick={() => onCreate({ photos, name, height, gender, bodyType, skinTone })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 18px', fontSize: 13, textTransform: 'uppercase', color: ON_ACCENT, background: ACCENT }}>
            {busy ? busyLabel : <><Pix name="spark" size={14} />{t('stylist.charCreate')}</>}
          </button>
        )}
        {character && <SBtn onClick={() => { setOpen(false); resetForm(); }} style={{ minHeight: 44 }}>{t('stylist.cancel')}</SBtn>}
      </BtnRow>
    </div>
  );

  const stat = (label, value, i) => (
    <div key={label} style={{
      minWidth: 0, padding: i % 2 ? '14px 0 14px 18px' : '14px 0',
      borderBottom: i < 2 ? '3px dashed ' + COLORS.rule : 0, borderLeft: i % 2 ? '3px dashed ' + COLORS.rule : 0,
    }}>
      <dt className="sk" style={{ fontSize: 10, color: COLORS.muted }}>{label}</dt>
      <dd className="sk" style={{ margin: '7px 0 0', fontSize: 15, color: COLORS.text, textTransform: 'uppercase', overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  );

  const dossier = character && (
    <Plate label={tt('Player file', 'Hồ sơ')} pad={isMobile ? '32px 18px 20px' : '38px 28px 28px'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px 14px', paddingBottom: 14, borderBottom: '3px dashed ' + COLORS.rule }}>
        <span className="pf" style={{ fontSize: isMobile ? 26 : 32, lineHeight: 1.1, color: COLORS.text, overflowWrap: 'anywhere' }}>{charName}</span>
        <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>{tt('PINNED = EQUIPPED', 'GHIM = TRANG BỊ')}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', margin: '0 0 18px' }}>
        {[
          [tt('HEIGHT', 'CHIỀU CAO'), character.height ? character.height + ' cm' : '—'],
          [t('stylist.gender'), character.gender ? cap(character.gender) : '—'],
          [t('stylist.body'), character.bodyType ? cap(character.bodyType) : '—'],
          [t('stylist.skin'), character.skinTone ? cap(character.skinTone) : '—'],
        ].map(([l, v], i) => stat(l, v, i))}
      </dl>
      <BtnRow>
        <SBtn onClick={startEdit}><Pix name="edit" size={14} />{t('stylist.edit')}</SBtn>
        <SBtn onClick={onRemove}><Pix name="close" size={14} />{t('stylist.charRemove')}</SBtn>
      </BtnRow>
    </Plate>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: isMobile ? '40px 0' : '44px 40px' }}>
      <Plate label={t('stylist.character')} ariaLabel="character" pad={isMobile ? '32px 14px 22px' : '38px 22px 26px'}
        style={{ flex: '1 1 440px', maxWidth: isMobile ? 'none' : 560 }}>
        {equipScreen}
      </Plate>

      <div style={{ flex: '999 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 44 }}>
        {character && !open ? dossier : (
          <Plate label={character ? tt('Edit character', 'Sửa nhân vật') : tt('New character', 'Tạo nhân vật')} pad={isMobile ? '32px 16px 20px' : '38px 28px 26px'}>
            {form}
          </Plate>
        )}
        <DialogBox>
          <p style={{ margin: 0, paddingRight: 18, fontSize: 13, lineHeight: 1.65, color: COLORS.text }}>
            {tt('Pin a piece in the wardrobe to equip it — every mixed outfit must include it. Exclude keeps a piece out of the mix. Paste an image anywhere to add it to the wardrobe.',
              'Ghim một món trong tủ đồ để trang bị — mọi bộ phối đều phải có món đó. Loại trừ giữ món đó ngoài bộ phối. Dán ảnh ở bất kỳ đâu để thêm vào tủ đồ.')}
          </p>
        </DialogBox>
      </div>
    </div>
  );
}

// ── Outfit set card — loadout (suggestion) or save slot (saved) ──
function SetCard({ set, items, isSaved, busyLookbook, onRenderLookbook, onSwap, onSave, onDelete, onDownload, onMoreLikeThis, onToggleFav, onZoom, index = 0, lookTag, isMobile }) {
  const { t, lang } = useLang();
  const tt = (en, vi) => (lang === 'vi' ? vi : en);
  const [swapFor, setSwapFor] = useState(null);
  const setItems = set.itemIds.map((id) => items.find((it) => it.id === id)).filter(Boolean);
  const swapTarget = swapFor ? items.find((it) => it.id === swapFor) : null;
  const candidates = swapTarget
    ? items.filter((it) => it.itemUrl && it.status !== 'error' && it.category === swapTarget.category && !set.itemIds.includes(it.id))
    : [];
  const num = String(index + 1).padStart(2, '0');
  const zoomLook = () => onZoom && onZoom('look:' + set.id, set.lookbookUrl, set.name);

  const pieces = (size) => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 3 }}>
      {setItems.map((it) => (
        <button key={it.id} type="button" className="sty-pc pxs" onClick={() => setSwapFor(swapFor === it.id ? null : it.id)}
          title={t('stylist.swap')} aria-label={t('stylist.swap') + ': ' + it.name} aria-pressed={swapFor === it.id}
          style={{ width: size, height: size }}>
          <CachedImg cacheKey={'item:' + it.id} url={it.itemUrl} alt={it.name}
            style={{ width: size - 10, height: size - 10, objectFit: 'cover', display: 'block' }} />
        </button>
      ))}
    </div>
  );

  const swapPanel = swapTarget && (
    <div style={{ padding: 12, background: COLORS.field, border: '3px dashed ' + COLORS.rule }}>
      <div className="sk" style={{ marginBottom: 10, fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>
        {t('stylist.swapWith')} · {t('stylist.cat.' + swapTarget.category)}
      </div>
      {candidates.length ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 3 }}>
          {candidates.map((it) => (
            <button key={it.id} type="button" className="sty-pc alt pxs" onClick={() => { onSwap(swapTarget.id, it.id); setSwapFor(null); }}
              title={it.name} aria-label={t('stylist.swapWith') + ' ' + it.name} style={{ width: 52, height: 52 }}>
              <CachedImg cacheKey={'item:' + it.id} url={it.itemUrl} alt={it.name}
                style={{ width: 44, height: 44, objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: COLORS.muted }}>{t('stylist.swapNone')}</div>}
    </div>
  );

  const rationale = set.rationale && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: COLORS.muted }}>{set.rationale}</p>;

  const renderLabel = busyLookbook
    ? <><Pix name="diamond" size={14} />{t('stylist.rendering')}</>
    : set.lookbookUrl
      ? <><Pix name="retry" size={14} />{t('stylist.regenerate')}</>
      : <><Pix name="spark" size={14} />{t('stylist.renderLookbook')}</>;
  const actions = (
    <BtnRow>
      <SBtn fill={ACCENT} onClick={() => onRenderLookbook(set)} disabled={busyLookbook}>{renderLabel}</SBtn>
      {set.lookbookUrl && <SBtn onClick={() => onDownload(set)}><Pix name="download" size={14} />{t('stylist.download')}</SBtn>}
      {onMoreLikeThis && <SBtn onClick={() => onMoreLikeThis(set)}><Pix name="spark" size={14} />{t('stylist.moreLikeThis')}</SBtn>}
      {onSave && <SBtn ink onClick={() => onSave(set)}><Pix name="check" size={14} />{t('stylist.saveSet')}</SBtn>}
      {onDelete && <SBtn onClick={() => onDelete(set)}><Pix name="close" size={14} />{t('stylist.delete')}</SBtn>}
    </BtnRow>
  );

  const renderingOverlay = busyLookbook && (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: 10, textAlign: 'center', background: 'rgba(27, 20, 16, 0.8)',
    }}>
      <span className="sk blink" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: ACCENT, textTransform: 'uppercase' }}>
        <Pix name="diamond" size={14} />{t('stylist.rendering')}
      </span>
      <span className="sty-bar dark" aria-hidden="true"><i /></span>
      {lookTag && !isSaved && <span className="sk" style={{ fontSize: 9, color: DIM }}>{tt('ASYNC RENDER', 'RENDER BẤT ĐỒNG BỘ')} · {lookTag}</span>}
    </div>
  );

  // ── Save slot (saved looks) ──
  if (isSaved) {
    const tw = isMobile ? 84 : 112;
    return (
      <article className="sty-slot" aria-label={set.name} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '18px 24px', padding: '24px 0' }}>
        <div className="sty-screen" style={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: tw, height: Math.round(tw * 4 / 3) }}>
          {set.lookbookUrl ? (
            <CachedImg cacheKey={'look:' + set.id} url={set.lookbookUrl} alt="lookbook" onClick={zoomLook}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
          ) : !busyLookbook && (
            <span className="sk" style={{ fontSize: 9, lineHeight: 1.5, textAlign: 'center', color: DIM }}>{tt('NO', 'CHƯA')}<br />{tt('RENDER', 'RENDER')}</span>
          )}
          {busyLookbook && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'grid', placeItems: 'center', background: 'rgba(27, 20, 16, 0.78)' }}>
              <Pix name="diamond" size={21} color={ACCENT} className="blink" />
            </div>
          )}
          <span className="sk" style={{ position: 'absolute', left: 0, top: 0, zIndex: 2, padding: '3px 6px', fontSize: 9, color: ON_ACCENT, background: ACCENT }}>
            {tt('SLOT', 'Ô')} {num}
          </span>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ minWidth: 0 }}>
              <h3 className="pf" style={{ margin: 0, fontSize: isMobile ? 19 : 22, lineHeight: 1.15, color: COLORS.text, overflowWrap: 'anywhere' }}>{set.name}</h3>
              <div className="sk" style={{ marginTop: 7, fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>
                {setItems.length} {t('stylist.pieces')}{set.occasion ? ' · ' + set.occasion : ''}
              </div>
            </div>
            <div style={{ padding: 3 }}>
              <button type="button" onClick={() => onToggleFav(set)} title={t('stylist.favourite')} aria-label="favourite" aria-pressed={!!set.fav}
                className={'sty-star' + (set.fav ? ' on' : '')}><Pix name="star" size={18} /></button>
            </div>
          </div>
          {rationale}
          <div>
            <GroupLbl>{t('stylist.swap')}</GroupLbl>
            {pieces(isMobile ? 46 : 52)}
          </div>
          {swapPanel}
          {actions}
        </div>
      </article>
    );
  }

  // ── Loadout card (suggested looks) ──
  return (
    <article className="px rise" aria-label={set.name} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: COLORS.paper, animationDelay: index * 90 + 'ms' }}>
      <div className="sk ribs" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, padding: '0 14px',
        fontSize: 12, color: ON_ACCENT, backgroundColor: ACCENT, borderBottom: '4px solid ' + COLORS.ink, textTransform: 'uppercase',
      }}>
        <span>{tt('Loadout', 'Bộ')} {num}</span>
        <span style={{ padding: '3px 7px', fontSize: 10, background: '#fffaf0', border: '3px solid #1b1410' }}>{setItems.length} {t('stylist.pieces')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 18px 20px' }}>
        <div>
          <h3 className="pf" style={{ margin: 0, fontSize: 23, lineHeight: 1.1, color: COLORS.text, overflowWrap: 'anywhere' }}>{set.name}</h3>
          {set.occasion && <div className="sk" style={{ marginTop: 8, fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>{tt('For', 'Cho')}: {set.occasion}</div>}
        </div>
        <div>
          <GroupLbl>{t('stylist.swap')}</GroupLbl>
          {pieces(isMobile ? 56 : 60)}
        </div>
        {swapPanel}
        {rationale}
        {(set.lookbookUrl || busyLookbook) && (
          <div className="sty-screen" style={{ padding: 10 }}>
            <span className="sk" style={{ position: 'absolute', left: 16, top: 16, zIndex: 2, padding: '4px 8px', fontSize: 10, color: ON_ACCENT, background: ACCENT }}>LOOKBOOK</span>
            {set.lookbookUrl && (
              <button type="button" className="sty-ibtn" onClick={zoomLook} aria-label={tt('Open full size', 'Xem cỡ lớn')} title={tt('Open full size', 'Xem cỡ lớn')}
                style={{ position: 'absolute', right: 19, top: 19, zIndex: 2 }}><Pix name="expand" size={14} /></button>
            )}
            {set.lookbookUrl
              ? <CachedImg cacheKey={'look:' + set.id} url={set.lookbookUrl} alt="lookbook" onClick={zoomLook}
                  style={{ width: '100%', display: 'block', cursor: 'zoom-in' }} />
              : <div style={{ height: 230 }} />}
            {renderingOverlay}
          </div>
        )}
        {actions}
      </div>
    </article>
  );
}

// ── Main module ────────────────────────────────────────────────
export function Stylist() {
  const { t, lang } = useLang();
  // Design-only strings (hero / tabs / tokens / footer) live as inline
  // bilingual literals so we don't have to grow the global i18n dict.
  const tt = (en, vi) => (lang === 'vi' ? vi : en);
  const [area, setArea] = useState('character'); // character|wardrobe|compose|lookbook|tokens
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [wardrobe, setWardrobe] = useSyncedData(
    { localKey: 'se77n.wardrobe.v1', serverKey: 'wardrobe' },
    { items: [], sets: [], character: null, lookOpts: DEFAULT_LOOK },
  );
  const items = wardrobe.items || [];
  const sets = wardrobe.sets || [];
  const character = wardrobe.character || null;
  const lookOpts = { ...DEFAULT_LOOK, ...(wardrobe.lookOpts || {}) };

  const [occasion, setOccasion] = useState('');
  const [mixing, setMixing] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [lookbookBusy, setLookbookBusy] = useState({});
  const [charBusy, setCharBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState(null);
  const [pinned, setPinned] = useState(() => new Set());
  const [excluded, setExcluded] = useState(() => new Set());
  const [advOpen, setAdvOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [constraints, setConstraints] = useState({ formality: null, season: null, weather: '', colorMood: '' });
  const [zoom, setZoom] = useState(null); // { cacheKey, url, alt } for the lightbox
  const fileRef = useRef(null);

  const openZoom = useCallback((cacheKey, url, alt) => setZoom({ cacheKey, url, alt }), []);

  const patchItem = useCallback((id, patch) => {
    setWardrobe((w) => ({ ...w, items: (w.items || []).map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }, [setWardrobe]);

  const setLookOpts = useCallback((patch) => {
    setWardrobe((w) => ({ ...w, lookOpts: { ...DEFAULT_LOOK, ...(w.lookOpts || {}), ...patch } }));
  }, [setWardrobe]);

  // ── Upload → detect garments → catalog item(s). ──
  const renderItemFrom = useCallback(async (id, dataUrl, g) => {
    try {
      const url = await renderImage({ prompt: catalogPrompt(g), image: dataUrl, engine: 'nano' });
      patchItem(id, { itemUrl: url, status: 'ready' });
    } catch (e) {
      patchItem(id, { status: 'error', error: (e.message || 'failed').slice(0, 80) });
    }
  }, [patchItem]);

  const addPhoto = useCallback(async (img) => {
    if (!img?.dataUrl) return;
    setError('');
    let garments = [{ name: 'item', category: 'top', color: '' }];
    try {
      const d = await fetch('/api/agent?action=detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: img.dataUrl }),
      });
      const dj = await safeJson(d, 'detect');
      if (Array.isArray(dj.garments) && dj.garments.length) garments = dj.garments.slice(0, 8);
    } catch { /* fall back to single */ }
    let srcBlob = null; try { srcBlob = dataUrlToBlob(img.dataUrl); } catch { /* ignore */ }
    const created = garments.map((g) => ({ id: genId(), name: g.name, category: g.category, color: g.color || '', status: 'processing', createdAt: Date.now() }));
    created.forEach((it) => { if (srcBlob) idbPut('src:' + it.id, srcBlob); });
    setWardrobe((w) => ({ ...w, items: [...created, ...(w.items || [])] }));
    created.forEach((it, i) => renderItemFrom(it.id, img.dataUrl, garments[i]));
  }, [setWardrobe, renderItemFrom]);

  const onPickFile = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach((f) => compressImage(f).then((img) => img && addPhoto(img)).catch(() => {}));
  }, [addPhoto]);

  usePasteImage(useCallback((img) => addPhoto(img), [addPhoto]), true);

  const retryItem = useCallback(async (item) => {
    const blob = await idbGet('src:' + item.id);
    if (!blob) { patchItem(item.id, { status: 'error', error: 'source lost — delete & re-upload' }); return; }
    patchItem(item.id, { status: 'processing' });
    let dataUrl; try { dataUrl = await blobToDataUrl(blob); } catch { patchItem(item.id, { status: 'error', error: 'retry failed' }); return; }
    renderItemFrom(item.id, dataUrl, { name: item.name, category: item.category, color: item.color });
  }, [patchItem, renderItemFrom]);

  const editItem = useCallback((id, patch) => patchItem(id, patch), [patchItem]);

  const deleteItem = useCallback((item) => {
    idbDel('item:' + item.id); idbDel('src:' + item.id);
    setWardrobe((w) => ({
      ...w,
      items: (w.items || []).filter((it) => it.id !== item.id),
      sets: (w.sets || []).map((s) => ({ ...s, itemIds: s.itemIds.filter((id) => id !== item.id) })).filter((s) => s.itemIds.length >= 1),
    }));
    setSuggestions((sg) => sg.map((s) => ({ ...s, itemIds: s.itemIds.filter((id) => id !== item.id) })).filter((s) => s.itemIds.length >= 1));
    setPinned((p) => { const n = new Set(p); n.delete(item.id); return n; });
    setExcluded((p) => { const n = new Set(p); n.delete(item.id); return n; });
  }, [setWardrobe]);

  const togglePin = useCallback((id) => {
    setPinned((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setExcluded((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }, []);
  const toggleExclude = useCallback((id) => {
    setExcluded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setPinned((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }, []);

  // ── Character ──
  const createCharacter = useCallback(async (form) => {
    const photos = (form.photos || []).filter((p) => p?.dataUrl);
    if (!photos.length || !form.height || charBusy) return;
    setCharBusy(true); setError('');
    try {
      const params = { height: Number(form.height) || null, gender: form.gender, bodyType: form.bodyType, skinTone: form.skinTone };
      const charUrl = await renderImage(charRenderBody(params, '', photos, null));
      setWardrobe((w) => ({ ...w, character: { id: genId(), name: (form.name || '').trim(), ...params, charUrl, createdAt: Date.now() } }));
    } catch (e) { setError((e.message || 'character failed').slice(0, 120)); }
    finally { setCharBusy(false); }
  }, [charBusy, setWardrobe]);

  const editCharacter = useCallback(async (form) => {
    if (!character || charBusy) return;
    setCharBusy(true); setError('');
    try {
      const params = {
        height: Number(form.height) || character.height || null,
        gender: form.gender ?? character.gender, bodyType: form.bodyType ?? character.bodyType, skinTone: form.skinTone ?? character.skinTone,
      };
      // Attached photos (1..N face angles) win as the identity reference;
      // otherwise edit the current character image with the tweak prompt.
      const charUrl = await renderImage(charRenderBody(params, form.tweak, form.photos, character.charUrl));
      idbDel('char:' + character.id);
      setWardrobe((w) => ({ ...w, character: { ...character, ...params, name: (form.name ?? character.name) || '', charUrl } }));
    } catch (e) { setError((e.message || 'edit failed').slice(0, 120)); }
    finally { setCharBusy(false); }
  }, [character, charBusy, setWardrobe]);

  const removeCharacter = useCallback(() => {
    if (character?.id) idbDel('char:' + character.id);
    setWardrobe((w) => ({ ...w, character: null }));
  }, [character, setWardrobe]);

  // ── Mix ──
  const readyItems = useMemo(() => items.filter((it) => it.itemUrl && it.status !== 'error'), [items]);
  const sig = (s) => [...s.itemIds].sort().join(',');

  const runMix = useCallback(async ({ anchor = null, avoid = null } = {}) => {
    if (readyItems.length < 2 || mixing) return;
    setMixing(true); setError(''); setSuggestions([]);
    try {
      const favs = (wardrobe.sets || []).filter((s) => s.fav).slice(0, 3)
        .map((s) => ({ name: s.name, items: s.itemIds.map((id) => readyItems.find((it) => it.id === id)?.name).filter(Boolean) }));
      const c = constraints;
      const cleanC = {
        ...(c.formality ? { formality: c.formality } : {}), ...(c.season ? { season: c.season } : {}),
        ...(c.weather.trim() ? { weather: c.weather.trim() } : {}), ...(c.colorMood.trim() ? { colorMood: c.colorMood.trim() } : {}),
      };
      const body = {
        items: readyItems.map((it) => ({ id: it.id, name: it.name, category: it.category, color: it.color })),
        occasion, height: character?.height || undefined,
        include: anchor || (pinned.size ? [...pinned] : undefined),
        exclude: excluded.size ? [...excluded] : undefined,
        constraints: Object.keys(cleanC).length ? cleanC : undefined,
        avoid: avoid || undefined,
        favorites: favs.length ? favs : undefined,
      };
      const res = await fetch('/api/agent?action=mix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await safeJson(res, 'mix');
      const sg = (data.sets || []).map((s) => ({ ...s, id: genId(), occasion }));
      if (!sg.length) setError(t('stylist.noSets'));
      setSuggestions(sg);
    } catch (e) { setError(e.message || 'mix failed'); }
    finally { setMixing(false); }
  }, [readyItems, mixing, occasion, character, pinned, excluded, constraints, wardrobe.sets, t]);

  // ── Lookbook ──
  const renderLookbook = useCallback(async (set, { onDone } = {}) => {
    const garmentUrls = set.itemIds.map((id) => items.find((it) => it.id === id)?.itemUrl).filter(Boolean);
    if (garmentUrls.length < 1) return;
    const hasChar = !!character?.charUrl;
    const images = hasChar ? [character.charUrl, ...garmentUrls] : garmentUrls;
    setLookbookBusy((b) => ({ ...b, [set.id]: true }));
    try {
      const url = await renderImage({ prompt: lookbookPrompt(set.occasion || occasion, character, lookOpts), images, engine: 'nano' });
      if (onDone) onDone(url);
    } catch (e) { setError(e.message || 'lookbook failed'); }
    finally { setLookbookBusy((b) => ({ ...b, [set.id]: false })); }
  }, [items, occasion, character, lookOpts]);

  const renderSuggestionLookbook = useCallback((set) => {
    if (set.lookbookUrl) idbDel('look:' + set.id);
    renderLookbook(set, { onDone: (url) => setSuggestions((sg) => sg.map((s) => (s.id === set.id ? { ...s, lookbookUrl: url } : s))) });
  }, [renderLookbook]);

  const renderSavedLookbook = useCallback((set) => {
    if (set.lookbookUrl) idbDel('look:' + set.id);
    renderLookbook(set, { onDone: (url) => {
      setWardrobe((w) => ({ ...w, sets: (w.sets || []).map((s) => (s.id === set.id ? { ...s, lookbookUrl: url } : s)) }));
      fetch('/api/toolbox?kind=history', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'image', prompt: 'lookbook · ' + (set.name || ''), mediaUrl: url, preset: 'stylist' }),
      }).catch(() => {});
    } });
  }, [renderLookbook, setWardrobe]);

  const swapInSet = (collection, setId, oldId, newId) => collection.map((s) => (s.id === setId
    ? { ...s, itemIds: s.itemIds.map((id) => (id === oldId ? newId : id)) } : s));
  const swapSuggestion = useCallback((set, oldId, newId) => setSuggestions((sg) => swapInSet(sg, set.id, oldId, newId)), []);
  const swapSaved = useCallback((set, oldId, newId) => setWardrobe((w) => ({ ...w, sets: swapInSet(w.sets || [], set.id, oldId, newId) })), [setWardrobe]);

  const saveSet = useCallback((set) => {
    setWardrobe((w) => ({ ...w, sets: [{ ...set, fav: false, createdAt: Date.now() }, ...(w.sets || [])] }));
    setSuggestions((sg) => sg.filter((s) => s.id !== set.id));
  }, [setWardrobe]);
  const deleteSet = useCallback((set) => {
    idbDel('look:' + set.id);
    setWardrobe((w) => ({ ...w, sets: (w.sets || []).filter((s) => s.id !== set.id) }));
  }, [setWardrobe]);
  const toggleFav = useCallback((set) => setWardrobe((w) => ({ ...w, sets: (w.sets || []).map((s) => (s.id === set.id ? { ...s, fav: !s.fav } : s)) })), [setWardrobe]);
  const downloadSet = useCallback((set) => set.lookbookUrl && downloadImage(set.lookbookUrl, (set.name || 'lookbook').replace(/\s+/g, '-') + '.png'), []);
  const moreLikeThis = useCallback((set) => runMix({ anchor: set.itemIds, avoid: [sig(set)] }), [runMix]);
  const shuffle = useCallback(() => runMix({ avoid: suggestions.map(sig) }), [runMix, suggestions]);

  // ── Derived ──
  const counts = useMemo(() => CATEGORIES.reduce((a, c) => { a[c] = readyItems.filter((it) => it.category === c).length; return a; }, {}), [readyItems]);
  const shownItems = useMemo(() => items.filter((it) => {
    if (filterCat && it.category !== filterCat) return false;
    if (query) { const q = query.toLowerCase(); if (!(it.name || '').toLowerCase().includes(q) && !(it.color || '').toLowerCase().includes(q)) return false; }
    return true;
  }), [items, filterCat, query]);
  const sortedSets = useMemo(() => [...sets].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)), [sets]);

  // ── Presentation-only derived values ──
  const equipped = useMemo(() => readyItems.filter((it) => pinned.has(it.id)), [readyItems, pinned]);
  const labelOf = (list, v) => (list.find((o) => o.v === v) || {}).label || v;
  const lookTag = `${lookOpts.ratio} · ${labelOf(SCENES, lookOpts.scene)} · ${labelOf(FRAMINGS, lookOpts.framing)}`;
  const pad2 = (n) => String(n).padStart(2, '0');
  const ids = { search: 'sty-search', occ: 'sty-occasion', weather: 'sty-weather', color: 'sty-colormood' };
  const platePad = isMobile ? '32px 16px 22px' : '38px 28px 30px';

  const stages = [
    { id: 'character', n: '01', label: tt('Character', 'Nhân vật'), meta: character ? tt('1 model', '1 nhân vật') : tt('none', 'chưa có'), c: ACCENT },
    { id: 'wardrobe', n: '02', label: tt('Wardrobe', 'Tủ đồ'), meta: items.length + ' ' + tt('items', 'món'), c: GOLD },
    { id: 'compose', n: '03', label: tt('Compose', 'Phối đồ'), meta: readyItems.length >= 2 ? tt('Ready', 'Sẵn sàng') : tt('need 2+', 'cần 2+'), c: GREEN },
    { id: 'lookbook', n: '04', label: tt('Lookbook', 'Kết quả'), meta: sets.length + ' ' + tt('looks', 'look'), c: ACCENT },
  ];

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', gap: 30, padding: '6px 2px 8px' }
      : { height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 34, padding: '8px 24px 28px 8px' }}>

      {/* ── Stage path (switches area) + quick actions ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px' }}>
        <nav aria-label={tt('Stylist stages', 'Các bước Stylist')} className="sty-stages">
          {stages.map((s, i) => {
            const a = s.id === area;
            return (
              <Fragment key={s.id}>
                <button type="button" onClick={() => setArea(s.id)} aria-current={a ? 'step' : undefined} className="sty-stage pxs lift"
                  style={{ background: a ? COLORS.strip : COLORS.paper, color: a ? COLORS.stripText : COLORS.text }}>
                  <span className="sk" style={{
                    display: 'grid', placeItems: 'center', flexShrink: 0, width: 36, height: 36, fontSize: 12,
                    color: ON_ACCENT, background: s.c, border: '3px solid ' + ON_ACCENT,
                  }}>{s.n}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                    <span className="sk" style={{ fontSize: 12, textTransform: 'uppercase' }}>{s.label}</span>
                    <span className="sk" style={{ fontSize: 10, color: a ? ACCENT : COLORS.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{s.meta}</span>
                  </span>
                </button>
                {i < stages.length - 1 && <PixelArrow className="sty-arr" dir="right" size={10} color={COLORS.muted} />}
              </Fragment>
            );
          })}
        </nav>
        <div className="sty-ctas" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 18px', marginLeft: 'auto', padding: '4px 10px 10px 4px' }}>
          <SBtn onClick={() => setArea('character')} style={{ minHeight: 44, padding: '0 14px' }}>{tt('Build character', 'Tạo nhân vật')}</SBtn>
          <button type="button" className="sk pbtn" onClick={() => setArea('compose')} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 44, padding: '0 18px',
            fontSize: 12, whiteSpace: 'nowrap', textTransform: 'uppercase', color: ON_ACCENT, background: ACCENT,
          }}><Pix name="spark" size={14} />{tt('Compose a look', 'Phối một bộ')}</button>
        </div>
      </div>

      {error && (
        <div role="alert" className="pxs" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', margin: '0 3px', padding: '12px 14px', background: COLORS.paper }}>
          <span className="sk" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '3px 8px', fontSize: 10, color: ON_ACCENT, background: SALMON }}>
            <Pix name="bang" size={10} />{tt('ERROR', 'LỖI')}
          </span>
          <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.text, overflowWrap: 'anywhere' }}>{error}</span>
        </div>
      )}

      {/* Character */}
      {area === 'character' && (
      <div className="rise">
      <CharacterPanel character={character} busy={charBusy} isMobile={isMobile} onZoom={openZoom} equipped={equipped}
        onCreate={createCharacter} onEdit={editCharacter} onRemove={removeCharacter} />
      </div>
      )}

      {/* Wardrobe (inventory) */}
      {area === 'wardrobe' && (
      <div className="rise">
      <Plate label={`${tt('Inventory', 'Hành trang')} · ${t('stylist.wardrobe')} · ${pad2(items.length)}`} ariaLabel={t('stylist.wardrobe')} pad={platePad}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px', marginBottom: 22 }}>
          <p style={{ flex: '1 1 300px', maxWidth: 540, margin: 0, fontSize: 13, lineHeight: 1.6, color: COLORS.muted }}>{t('stylist.uploadHint')}</p>
          <div style={{ padding: '4px 10px 10px 4px' }}>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPickFile} style={{ display: 'none' }} />
            <button type="button" className="sk pbtn" onClick={() => fileRef.current?.click()} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 20px',
              fontSize: 14, textTransform: 'uppercase', color: ON_ACCENT, background: ACCENT,
            }}><Pix name="upload" size={14} />{t('stylist.upload')}</button>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyBox framed title="NO SAVE DATA" hint={t('stylist.empty')}
            icon={<span style={{ color: COLORS.muted }}><CatIcon cat="top" size={48} /></span>}
            action={<SBtn fill={ACCENT} onClick={() => fileRef.current?.click()}><Pix name="plus" size={14} />{t('stylist.upload')}</SBtn>} />
        ) : (
          <>
            {/* toolbar: search + category filter + stats */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 22px', marginBottom: 16 }}>
              <div style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 380, padding: 3 }}>
                <label htmlFor={ids.search} className="sr">{t('stylist.searchPh')}</label>
                <PxInput id={ids.search} value={query} onChange={setQuery} placeholder={t('stylist.searchPh')} />
              </div>
              <div role="group" aria-label="filter" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 3 }}>
                <Chip active={!filterCat} onClick={() => setFilterCat(null)}>{t('stylist.all')}</Chip>
                {CATEGORIES.map((c) => (
                  <Chip key={c} active={filterCat === c} onClick={() => setFilterCat(filterCat === c ? null : c)}>
                    {t('stylist.cat.' + c)} <span className="sty-cnt">{counts[c] || 0}</span>
                  </Chip>
                ))}
              </div>
            </div>
            {CATEGORIES.some((c) => counts[c] === 0) && (
              <p className="sk" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', margin: '0 0 22px 3px', fontSize: 10, color: COLORS.text, textTransform: 'uppercase' }}>
                <span className="pxs" style={{ padding: '3px 8px', color: ON_ACCENT, background: GOLD }}>{t('stylist.gapHint')}</span>
                {CATEGORIES.filter((c) => counts[c] === 0).map((c) => t('stylist.cat.' + c)).join(', ')}
              </p>
            )}

            <div className="sty-inv">
              {shownItems.map((it) => (
                <ItemCard key={it.id} item={it} onZoom={openZoom}
                  pinned={pinned.has(it.id)} excluded={excluded.has(it.id)}
                  onEdit={editItem} onDelete={deleteItem} onRetry={retryItem}
                  onTogglePin={togglePin} onToggleExclude={toggleExclude} />
              ))}
            </div>
            {shownItems.length === 0 && (
              <p className="sk" style={{ margin: '8px 0 0', padding: '22px 12px', textAlign: 'center', fontSize: 11, color: COLORS.muted, border: '3px dashed ' + COLORS.rule }}>
                {tt('NO MATCHING PIECES', 'KHÔNG CÓ MÓN PHÙ HỢP')}
              </p>
            )}
          </>
        )}
      </Plate>
      </div>
      )}

      {/* Compose */}
      {area === 'compose' && (
      <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
      <Plate label={t('stylist.compose')} pad={platePad}>
        <div className="sty-cmp">
          <div>
            <div>
              <GroupLbl>{tt('Presets', 'Gợi ý nhanh')}</GroupLbl>
              <div role="group" aria-label="presets" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 3 }}>
                {PRESETS.map((p) => <Chip key={p.k} active={occasion === p.occ} onClick={() => setOccasion(p.occ)}>{t('stylist.preset.' + p.k)}</Chip>)}
              </div>
            </div>

            <div aria-hidden="true" style={{ padding: '14px 16px', color: COLORS.stripText, background: COLORS.strip }}>
              <div className="sk" style={{ marginBottom: 8, fontSize: 10, color: DIM }}>{tt('QUEST › OCCASION', 'NHIỆM VỤ › DỊP')}</div>
              <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                <span style={{ color: ACCENT }}>&gt;</span>{' '}
                {occasion.trim() || <span style={{ fontWeight: 400, color: DIM }}>{tt('any occasion', 'dịp bất kỳ')}</span>}
                <span className="blink" style={{ display: 'inline-block', width: 9, height: 16, marginLeft: 5, verticalAlign: -2, background: ACCENT }} />
              </div>
            </div>

            <div style={{ padding: 3 }}>
              <Lbl htmlFor={ids.occ}>{tt('Occasion', 'Dịp')}</Lbl>
              <PxInput id={ids.occ} value={occasion} onChange={setOccasion} placeholder={t('stylist.occasionPh')}
                onKeyDown={(e) => { if (e.key === 'Enter') runMix(); }} />
            </div>

            <div style={{ padding: '4px 12px 12px 4px' }}>
              <button type="button" className="sk pbtn" onClick={() => runMix()} disabled={mixing || readyItems.length < 2} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', minHeight: 64, padding: '0 18px',
                fontSize: isMobile ? 16 : 18, textTransform: 'uppercase', color: ON_ACCENT, background: ACCENT,
              }}>
                {mixing
                  ? <><Pix name="diamond" size={14} />{t('stylist.mixing')}<span className="dots-step" aria-hidden="true"><i /><i /><i /></span></>
                  : <><Pix name="spark" size={21} />{t('stylist.mix')} {tt('outfit', 'đồ')}</>}
              </button>
            </div>

            {(pinned.size > 0 || excluded.size > 0) && (
              <div className="sk" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', fontSize: 11, color: COLORS.text, textTransform: 'uppercase' }}>
                {pinned.size > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Pix name="pin" size={14} />{t('stylist.pinned')} {pinned.size}</span>}
                {excluded.size > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Pix name="ban" size={14} />{t('stylist.excluded')} {excluded.size}</span>}
                <button type="button" onClick={() => { setPinned(new Set()); setExcluded(new Set()); }} className="sk sty-link">{t('stylist.clear')}</button>
              </div>
            )}
            {readyItems.length < 2 && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: COLORS.muted }}>{t('stylist.needTwo')}</p>}
          </div>

          {/* Advanced constraints (collapsed) */}
          <div className="sty-opt">
            <Toggle open={advOpen} onClick={() => setAdvOpen((v) => !v)}>{t('stylist.advanced')}</Toggle>
            {advOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <GroupLbl>{t('stylist.formality')}</GroupLbl>
                  <ChipRow options={FORMALITY} label={t('stylist.formality')} value={constraints.formality} onChange={(v) => setConstraints((c) => ({ ...c, formality: v }))} nullable />
                </div>
                <div>
                  <GroupLbl>{t('stylist.season')}</GroupLbl>
                  <ChipRow options={SEASONS} label={t('stylist.season')} value={constraints.season} onChange={(v) => setConstraints((c) => ({ ...c, season: v }))} nullable />
                </div>
                <div style={{ padding: 3 }}>
                  <Lbl htmlFor={ids.weather}>{tt('Weather', 'Thời tiết')}</Lbl>
                  <PxInput id={ids.weather} value={constraints.weather} onChange={(v) => setConstraints((c) => ({ ...c, weather: v }))} placeholder={t('stylist.weatherPh')} />
                </div>
                <div style={{ padding: 3 }}>
                  <Lbl htmlFor={ids.color}>{tt('Color', 'Màu sắc')}</Lbl>
                  <PxInput id={ids.color} value={constraints.colorMood} onChange={(v) => setConstraints((c) => ({ ...c, colorMood: v }))} placeholder={t('stylist.colorPh')} />
                </div>
              </div>
            ) : (
              <TagList empty={tt('No constraints — AI decides.', 'Không ràng buộc — AI tự chọn.')}
                tags={[constraints.formality, constraints.season, constraints.weather.trim(), constraints.colorMood.trim()].filter(Boolean).map(cap)} />
            )}
          </div>

          {/* Lookbook style (collapsed) */}
          <div className="sty-opt">
            <Toggle open={styleOpen} onClick={() => setStyleOpen((v) => !v)}>{t('stylist.lookStyle')}</Toggle>
            {styleOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {[['pose', POSES, 'stylist.pose'], ['scene', SCENES, 'stylist.scene'], ['framing', FRAMINGS, 'stylist.framing'], ['ratio', RATIOS, 'stylist.ratio']].map(([key, options, label]) => (
                  <div key={key}>
                    <GroupLbl>{t(label)}</GroupLbl>
                    <ChipRow options={options} label={t(label)} value={lookOpts[key]} onChange={(v) => v && setLookOpts({ [key]: v })} />
                  </div>
                ))}
              </div>
            ) : (
              <TagList tags={[labelOf(POSES, lookOpts.pose), labelOf(SCENES, lookOpts.scene), labelOf(FRAMINGS, lookOpts.framing), lookOpts.ratio]} />
            )}
          </div>
        </div>
      </Plate>

      {/* Suggestions (loadouts) */}
      {mixing && suggestions.length === 0 && (
        <div className="sty-screen" role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '36px 20px' }}>
          <span className="sk blink" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: ACCENT, textTransform: 'uppercase' }}>
            <Pix name="diamond" size={14} />{t('stylist.mixing')}
          </span>
          <span className="sty-bar dark" aria-hidden="true"><i /></span>
        </div>
      )}
      {suggestions.length > 0 && (
        <section aria-label={t('stylist.suggestions')}>
          <SectionHead kicker={`${t('stylist.suggestions')} · ${pad2(suggestions.length)}`} title={tt('Loadouts', 'Bộ trang bị')}
            right={<BtnRow><SBtn onClick={shuffle} disabled={mixing} style={{ minHeight: 42 }}><Pix name="shuffle" size={14} />{t('stylist.shuffle')}</SBtn></BtnRow>} />
          <div className="sty-looks">
            {suggestions.map((s, i) => (
              <SetCard key={s.id} index={i} set={s} items={items} busyLookbook={!!lookbookBusy[s.id]} onZoom={openZoom} lookTag={lookTag} isMobile={isMobile}
                onRenderLookbook={renderSuggestionLookbook} onSwap={(o, n) => swapSuggestion(s, o, n)}
                onSave={saveSet} onDownload={downloadSet} onMoreLikeThis={moreLikeThis} />
            ))}
          </div>
        </section>
      )}

      </div>
      )}

      {/* Lookbook (saved sets as save slots) */}
      {area === 'lookbook' && (
      <div className="rise">
        {sets.length > 0 ? (
        <section aria-label={t('stylist.saved')}>
          <SectionHead kicker={`${t('stylist.saved')} · ${pad2(sets.length)}`} title="Lookbook"
            right={<span className="sk" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.muted }}><span className="pxs" style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, color: ON_ACCENT, background: GOLD }}><Pix name="star" size={18} /></span>{tt('FAVOURITES FIRST', 'YÊU THÍCH LÊN ĐẦU')}</span>} />
          <div className="px" style={{ padding: isMobile ? '2px 16px' : '4px 28px', background: COLORS.paper }}>
            {sortedSets.map((s, i) => (
              <SetCard key={s.id} index={i} set={s} items={items} isSaved busyLookbook={!!lookbookBusy[s.id]} onZoom={openZoom} isMobile={isMobile}
                onRenderLookbook={renderSavedLookbook} onSwap={(o, n) => swapSaved(s, o, n)}
                onDelete={deleteSet} onDownload={downloadSet} onToggleFav={toggleFav} onMoreLikeThis={moreLikeThis} />
            ))}
          </div>
        </section>
        ) : (
          <Plate label={t('stylist.saved')} pad={platePad}>
            <EmptyBox title={tt('No looks yet', 'Chưa có look')}
              icon={(
                <svg width="48" height="48" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
                  <path d="M1 1h10v10H1z" fill="none" stroke={COLORS.muted} strokeWidth="1" />
                  <path d="M3 8h2V6h2v2h2v1H3z" fill={ACCENT} />
                </svg>
              )}
              hint={tt('Compose an outfit and Mix, then save it — your looks land here.', 'Phối một bộ rồi lưu lại — các look sẽ hiện ở đây.')}
              action={<SBtn fill={ACCENT} onClick={() => setArea('compose')}><Pix name="spark" size={14} />{tt('Go to Compose', 'Tới Phối đồ')}</SBtn>} />
          </Plate>
        )}
      </div>
      )}

      {/* Footer */}
      <footer className="sk" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        marginTop: 4, paddingTop: 16, borderTop: '3px dashed ' + COLORS.rule, fontSize: 10, color: COLORS.muted,
      }}>
        <span>SE77N · STYLIST · EXP 007</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: COLORS.greenInk }}>
          <span className="blink" aria-hidden="true" style={{ width: 8, height: 8, background: 'currentColor' }} />
          NANO · IMG ENGINE · {tt('ASYNC RENDER', 'RENDER BẤT ĐỒNG BỘ')}
        </span>
      </footer>

      <Lightbox data={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

export default Stylist;
