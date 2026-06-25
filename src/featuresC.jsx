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

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  COLORS, Panel, Btn, Kicker, Pill, Field,
  useLang, useSyncedData, useMediaQuery, compressImage, usePasteImage,
} from './lib.jsx';
import { useCachedImage, idbPut, idbGet, idbDel } from './lib/idb.js';

const CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];
const ACCENT = COLORS.gold;

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

// ── Tiny UI atoms ──────────────────────────────────────────────
function Chip({ active, onClick, children, accent = ACCENT, title }) {
  return (
    <button onClick={onClick} title={title} className="mono" style={{
      padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 11,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
      border: '1px solid ' + (active ? accent + '88' : COLORS.line),
      background: active ? accent + '1a' : 'transparent',
      color: active ? accent : COLORS.muted,
    }}>{children}</button>
  );
}
function ChipRow({ options, value, onChange, accent = ACCENT, nullable }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <Chip key={o.v} active={value === o.v} accent={accent}
          onClick={() => onChange(nullable && value === o.v ? null : o.v)}>{o.label}</Chip>
      ))}
    </div>
  );
}
function IconBtn({ onClick, title, children, active, danger }) {
  const c = danger ? COLORS.red : active ? ACCENT : COLORS.muted;
  return (
    <button onClick={onClick} title={title} aria-label={title} className="mono" style={{
      width: 26, height: 26, borderRadius: 7, padding: 0, cursor: 'pointer',
      border: '1px solid ' + (active ? ACCENT + '66' : COLORS.line),
      background: active ? ACCENT + '14' : 'transparent', color: c,
      display: 'grid', placeItems: 'center', fontSize: 12, flexShrink: 0,
    }}>{children}</button>
  );
}
function CachedImg({ cacheKey, url, alt, style, onClick }) {
  const src = useCachedImage(cacheKey, url);
  if (!src) return <div style={{ ...style, background: COLORS.panel2, display: 'grid', placeItems: 'center', color: COLORS.muted, fontSize: 10 }} className="mono" onClick={onClick}>—</div>;
  return <img src={src} alt={alt || ''} style={style} loading="lazy" onClick={onClick} />;
}

// Full-screen image viewer — click an image (item / character / lookbook) to
// open; click anywhere or press Esc to close.
function Lightbox({ data, onClose }) {
  useEffect(() => {
    if (!data) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);
  if (!data) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.88)',
      display: 'grid', placeItems: 'center', padding: 20, cursor: 'zoom-out',
      animation: 'fadeIn 160ms ease-out',
    }}>
      <CachedImg cacheKey={data.cacheKey} url={data.url} alt={data.alt}
        style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
      <button onClick={onClose} aria-label="close" className="mono" style={{
        position: 'fixed', top: 16, right: 16, width: 40, height: 40, borderRadius: 999,
        background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
        color: '#fff', cursor: 'pointer', fontSize: 18,
      }}>✕</button>
    </div>
  );
}

// ── Wardrobe item card ─────────────────────────────────────────
function ItemCard({ item, pinned, excluded, onEdit, onDelete, onRetry, onTogglePin, onToggleExclude, onZoom }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [cat, setCat] = useState(item.category);
  const [color, setColor] = useState(item.color || '');
  const processing = item.status === 'processing';
  const error = item.status === 'error';

  const save = () => { onEdit(item.id, { name: name.trim() || 'item', category: cat, color: color.trim() }); setEditing(false); };

  return (
    <div style={{
      position: 'relative', borderRadius: 12, overflow: 'hidden',
      border: '1px solid ' + (pinned ? ACCENT + '88' : excluded ? COLORS.red + '66' : COLORS.line),
      background: COLORS.panel, opacity: excluded ? 0.55 : 1,
    }}>
      <div style={{ aspectRatio: '1 / 1', background: COLORS.panel2, position: 'relative' }}>
        {processing ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span className="mono" style={{ fontSize: 10, color: ACCENT, letterSpacing: '0.16em' }}>◇ {t('stylist.processing')}</span>
          </div>
        ) : error ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 10, textAlign: 'center' }}>
            <span className="mono" style={{ fontSize: 10, color: COLORS.red }}>⚠ {item.error || 'failed'}</span>
          </div>
        ) : (
          <CachedImg cacheKey={'item:' + item.id} url={item.itemUrl} alt={item.name}
            onClick={() => onZoom && onZoom('item:' + item.id, item.itemUrl, item.name)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
        )}
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
          {error && <IconBtn onClick={() => onRetry(item)} title={t('stylist.retry')}>↻</IconBtn>}
          <IconBtn onClick={() => onDelete(item)} title={t('stylist.delete')} danger>✕</IconBtn>
        </div>
      </div>

      {editing ? (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field value={name} onChange={setName} placeholder="name" style={{ fontSize: 12, padding: '8px 10px' }} />
          <ChipRow options={CATEGORIES.map((c) => ({ v: c, label: t('stylist.cat.' + c) }))} value={cat} onChange={setCat} />
          <Field value={color} onChange={setColor} placeholder="color" style={{ fontSize: 12, padding: '8px 10px' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="solid" color={ACCENT} onClick={save} style={{ flex: 1 }}>{t('stylist.save')}</Btn>
            <Btn variant="ghost" onClick={() => setEditing(false)}>{t('stylist.cancel')}</Btn>
          </div>
        </div>
      ) : (
        <div style={{ padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: COLORS.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
          {!processing && (
            <>
              <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pill color={ACCENT}>{t('stylist.cat.' + item.category)}</Pill>
                {item.color && <span className="mono" style={{ fontSize: 9, color: COLORS.muted }}>{item.color}</span>}
              </div>
              {!error && (
                <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                  <IconBtn onClick={() => onTogglePin(item.id)} active={pinned} title={t('stylist.pin')}>📌</IconBtn>
                  <IconBtn onClick={() => onToggleExclude(item.id)} active={excluded} title={t('stylist.exclude')}>🚫</IconBtn>
                  <IconBtn onClick={() => { setName(item.name); setCat(item.category); setColor(item.color || ''); setEditing(true); }} title={t('stylist.edit')}>✎</IconBtn>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Character panel ────────────────────────────────────────────
function CharacterPanel({ character, busy, onCreate, onEdit, onRemove, isMobile, onZoom }) {
  const { t } = useLang();
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

  const photoStrip = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {photos.map((p, i) => (
        <div key={i} style={{ position: 'relative', width: 80, height: 104, borderRadius: 10, overflow: 'hidden', border: '1px solid ' + ACCENT + '88' }}>
          <img src={p.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <button onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label="remove" style={{
            position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 6, border: 'none',
            background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0,
          }}>✕</button>
        </div>
      ))}
      {photos.length < 4 && (
        <button onClick={() => fileRef.current?.click()} aria-label="add photo" style={{
          width: 80, height: 104, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', padding: 0,
          border: '1px dashed ' + COLORS.line, background: COLORS.panel2, color: COLORS.muted, fontSize: 22,
          display: 'grid', placeItems: 'center',
        }}>
          {photos.length === 0 && character
            ? <CachedImg cacheKey={'char:' + character.id} url={character.charUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
            : '＋'}
        </button>
      )}
    </div>
  );

  const form = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: 'none' }} />
      {photoStrip}
      <div className="mono" style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.5 }}>{t('stylist.charPhotosHint')}</div>
      <Field value={name} onChange={setName} placeholder={t('stylist.charNamePh')} />
      <Field value={height} onChange={(v) => setHeight(v.replace(/\D/g, '').slice(0, 3))} placeholder={t('stylist.charHeightPh')} />
      <div>
        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 5 }}>{t('stylist.gender')}</div>
        <ChipRow options={GENDERS} value={gender} onChange={setGender} nullable />
      </div>
      <div>
        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 5 }}>{t('stylist.body')}</div>
        <ChipRow options={BODY} value={bodyType} onChange={setBodyType} nullable />
      </div>
      <div>
        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 5 }}>{t('stylist.skin')}</div>
        <ChipRow options={SKIN} value={skinTone} onChange={setSkinTone} nullable />
      </div>
      {character && <Field value={tweak} onChange={setTweak} placeholder={t('stylist.charTweakPh')} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {character ? (
          <Btn variant="solid" color={ACCENT} disabled={busy}
            onClick={() => onEdit({ photos, name, height, gender, bodyType, skinTone, tweak })}>
            {busy ? '◇ ' + t('stylist.charCreating') : '✦ ' + t('stylist.charRegen')}
          </Btn>
        ) : (
          <Btn variant="solid" color={ACCENT} disabled={busy || !photos.length || !height}
            onClick={() => onCreate({ photos, name, height, gender, bodyType, skinTone })}>
            {busy ? '◇ ' + t('stylist.charCreating') : '✦ ' + t('stylist.charCreate')}
          </Btn>
        )}
        {character && <Btn variant="ghost" onClick={() => { setOpen(false); resetForm(); }}>{t('stylist.cancel')}</Btn>}
      </div>
    </div>
  );

  return (
    <Panel padding={isMobile ? 14 : 18}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Kicker>{t('stylist.character')}</Kicker>
        {character && !open && (
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="ghost" onClick={startEdit}>✎ {t('stylist.edit')}</Btn>
            <Btn variant="ghost" onClick={onRemove}>{t('stylist.charRemove')}</Btn>
          </div>
        )}
      </div>

      {character && !open ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <CachedImg cacheKey={'char:' + character.id} url={character.charUrl} alt={character.name || 'character'}
            onClick={() => onZoom && onZoom('char:' + character.id, character.charUrl, character.name || 'character')}
            style={{ width: 84, height: 112, borderRadius: 10, objectFit: 'cover', border: '1px solid ' + COLORS.line, flexShrink: 0, cursor: 'zoom-in' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>{character.name || t('stylist.charDefault')}</div>
            <div style={{ marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {character.height && <Pill color={ACCENT}>{character.height} cm</Pill>}
              {character.gender && <Pill color={ACCENT}>{cap(character.gender)}</Pill>}
              {character.bodyType && <Pill color={ACCENT}>{cap(character.bodyType)}</Pill>}
              {character.skinTone && <Pill color={ACCENT}>{cap(character.skinTone)} skin</Pill>}
            </div>
          </div>
        </div>
      ) : (
        <>
          {!character && <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.5, maxWidth: 480, marginBottom: 12 }}>{t('stylist.charHint')}</div>}
          {form}
        </>
      )}
    </Panel>
  );
}

// ── Outfit set card ────────────────────────────────────────────
function SetCard({ set, items, isSaved, busyLookbook, onRenderLookbook, onSwap, onSave, onDelete, onDownload, onMoreLikeThis, onToggleFav, onZoom }) {
  const { t } = useLang();
  const [swapFor, setSwapFor] = useState(null);
  const setItems = set.itemIds.map((id) => items.find((it) => it.id === id)).filter(Boolean);
  const swapTarget = swapFor ? items.find((it) => it.id === swapFor) : null;
  const candidates = swapTarget
    ? items.filter((it) => it.itemUrl && it.status !== 'error' && it.category === swapTarget.category && !set.itemIds.includes(it.id))
    : [];

  return (
    <Panel padding={14} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{set.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSaved && (
            <button onClick={() => onToggleFav(set)} title={t('stylist.favourite')} aria-label="favourite"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: set.fav ? ACCENT : COLORS.muted, fontSize: 15, padding: 0 }}>
              {set.fav ? '★' : '☆'}
            </button>
          )}
          <Pill color={ACCENT}>{setItems.length} {t('stylist.pieces')}</Pill>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {setItems.map((it) => (
          <button key={it.id} onClick={() => setSwapFor(swapFor === it.id ? null : it.id)} title={t('stylist.swap')}
            style={{ padding: 0, border: '1px solid ' + (swapFor === it.id ? ACCENT + '88' : COLORS.line), borderRadius: 8, background: 'transparent', cursor: 'pointer', lineHeight: 0 }}>
            <CachedImg cacheKey={'item:' + it.id} url={it.itemUrl} alt={it.name}
              style={{ width: 58, height: 58, borderRadius: 7, objectFit: 'cover', display: 'block' }} />
          </button>
        ))}
      </div>

      {swapTarget && (
        <div style={{ border: '1px solid ' + COLORS.line, borderRadius: 10, padding: 10, background: COLORS.panel2 }}>
          <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 8 }}>
            {t('stylist.swapWith')} · {t('stylist.cat.' + swapTarget.category)}
          </div>
          {candidates.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {candidates.map((it) => (
                <button key={it.id} onClick={() => { onSwap(swapTarget.id, it.id); setSwapFor(null); }} title={it.name}
                  style={{ padding: 0, border: '1px solid ' + COLORS.line, borderRadius: 8, background: 'transparent', cursor: 'pointer', lineHeight: 0 }}>
                  <CachedImg cacheKey={'item:' + it.id} url={it.itemUrl} alt={it.name}
                    style={{ width: 52, height: 52, borderRadius: 7, objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          ) : <div style={{ fontSize: 11, color: COLORS.muted }}>{t('stylist.swapNone')}</div>}
        </div>
      )}

      {set.rationale && <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5 }}>{set.rationale}</div>}

      {set.lookbookUrl && (
        <CachedImg cacheKey={'look:' + set.id} url={set.lookbookUrl} alt="lookbook"
          onClick={() => onZoom && onZoom('look:' + set.id, set.lookbookUrl, set.name)}
          style={{ width: '100%', borderRadius: 10, border: '1px solid ' + COLORS.line, display: 'block', cursor: 'zoom-in' }} />
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn variant="tinted" color={ACCENT} onClick={() => onRenderLookbook(set)} disabled={busyLookbook}>
          {busyLookbook ? '◇ ' + t('stylist.rendering') : set.lookbookUrl ? '↻ ' + t('stylist.regenerate') : '✦ ' + t('stylist.renderLookbook')}
        </Btn>
        {set.lookbookUrl && <Btn variant="ghost" onClick={() => onDownload(set)}>↓ {t('stylist.download')}</Btn>}
        {onMoreLikeThis && <Btn variant="ghost" onClick={() => onMoreLikeThis(set)}>✦ {t('stylist.moreLikeThis')}</Btn>}
        {onSave && <Btn variant="solid" color={ACCENT} onClick={() => onSave(set)}>✓ {t('stylist.saveSet')}</Btn>}
        {onDelete && <Btn variant="ghost" onClick={() => onDelete(set)}>{t('stylist.delete')}</Btn>}
      </div>
    </Panel>
  );
}

// ── Token map (design-system reference tab) ────────────────────
function TokenMap({ tt }) {
  const cols = '1.1fr .7fr .7fr 1.5fr';
  const tokens = [
    { name: '--bg', light: '#f3eee4', dark: '#0d0a08', usage: tt('App background', 'Nền ứng dụng'), c: COLORS.text },
    { name: '--panel', light: '#ffffff', dark: '#15110d', usage: tt('Cards, modals, surfaces', 'Card, modal, bề mặt'), c: COLORS.text },
    { name: '--panel2', light: '#faf6ee', dark: '#1c1813', usage: tt('Inset fields, sub-surfaces', 'Ô input, bề mặt phụ'), c: COLORS.text },
    { name: '--text', light: '#211c16', dark: '#f5ede0', usage: tt('Text & icon foreground', 'Chữ & icon'), c: COLORS.text },
    { name: '--red', light: '#cf3a3a', dark: '#e04545', usage: tt('Primary action, brand accent', 'Hành động chính, nhấn'), c: COLORS.red },
    { name: '--green', light: '#3d8a4f', dark: '#5ba868', usage: tt('Success, ready, download', 'Thành công, sẵn sàng'), c: COLORS.green },
    { name: '--gold', light: '#ad7f31', dark: '#d4a858', usage: tt('Pins, favourites, async', 'Ghim, yêu thích, async'), c: COLORS.gold },
    { name: '--line', light: 'rgba(33,28,22,.12)', dark: 'rgba(245,237,224,.12)', usage: tt('Borders, dividers', 'Viền, đường kẻ'), c: COLORS.text },
  ];
  const swatch = (v) => (v.length > 9 ? '.12 α' : v);
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.18)' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid ' + COLORS.line }}>
        <Kicker>{tt('TOKEN MAP', 'BẢNG TOKEN')}</Kicker>
        <div className="mono" style={{ fontSize: 17, fontWeight: 700, marginTop: 5, color: COLORS.text }}>COLORS.*</div>
      </div>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '12px 22px', fontSize: 9, letterSpacing: '0.16em', color: COLORS.muted, borderBottom: '1px solid ' + COLORS.line }}>
        <span>TOKEN</span><span>LIGHT</span><span>DARK</span><span>USAGE</span>
      </div>
      {tokens.map((tk) => (
        <div key={tk.name} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '13px 22px', borderBottom: '1px solid ' + COLORS.line }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: tk.c }}>{tk.name}</span>
          <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: COLORS.muted }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, background: tk.light, boxShadow: '0 0 0 1px rgba(128,128,128,.4)' }} />{swatch(tk.light)}
          </span>
          <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: COLORS.muted }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, background: tk.dark, boxShadow: '0 0 0 1px rgba(128,128,128,.4)' }} />{swatch(tk.dark)}
          </span>
          <span style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.4 }}>{tk.usage}</span>
        </div>
      ))}
    </div>
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

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', gap: 16 }
      : { height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 4 }}>

      {/* ── Hero ── */}
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 22,
        border: '1px solid ' + COLORS.line, background: COLORS.panel,
        padding: isMobile ? '24px 20px' : '34px 36px 30px', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
      }}>
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(70% 90% at 88% 95%, ' + COLORS.red + '1a 0%, transparent 62%), radial-gradient(50% 70% at 10% 0%, ' + COLORS.gold + '14 0%, transparent 60%)',
        }} />
        <div aria-hidden className="mono" style={{
          position: 'absolute', bottom: -56, right: -10, fontSize: 220, lineHeight: 1, fontWeight: 800,
          color: 'rgba(245,237,224,0.04)', pointerEvents: 'none', userSelect: 'none',
        }}>07</div>

        <div style={{ position: 'relative', display: 'grid', gap: isMobile ? 22 : 34, gridTemplateColumns: isMobile ? '1fr' : '1.15fr .85fr', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.red, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.red, animation: 'pulse 1.6s infinite' }} />07 · STYLIST
              </span>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.2em', padding: '3px 8px', borderRadius: 999, border: '1px solid ' + COLORS.line, color: COLORS.muted }}>NANO · IMG ENGINE</span>
            </div>
            <h1 className="mono" style={{ margin: 0, fontSize: isMobile ? 38 : 52, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 0.98, color: COLORS.text }}>
              {tt('AI Stylist', 'Stylist AI')}<span style={{ color: COLORS.red }}>.</span>
            </h1>
            <p style={{ margin: '13px 0 0', maxWidth: 470, fontSize: 14, color: COLORS.muted, lineHeight: 1.6 }}>
              {tt('Build a model from your photos, digitize your wardrobe, then let AI mix & render full looks.',
                'Tạo nhân vật từ ảnh của bạn, số hoá tủ đồ, rồi để AI phối & render trọn bộ look.')}
            </p>

            {/* pipeline — live counts, click to jump */}
            <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', margin: '24px 0 26px' }}>
              {[
                { id: 'character', n: '01', icon: '🧍', label: tt('Character', 'Nhân vật'), meta: character ? tt('1 model', '1 nhân vật') : tt('none', 'chưa có'), c: COLORS.red },
                { id: 'wardrobe', n: '02', icon: '👕', label: tt('Wardrobe', 'Tủ đồ'), meta: items.length + ' ' + tt('items', 'món'), c: COLORS.gold },
                { id: 'compose', n: '03', icon: '✦', label: tt('Compose', 'Phối đồ'), meta: readyItems.length >= 2 ? tt('Ready', 'Sẵn sàng') : tt('need 2+', 'cần 2+'), c: COLORS.green },
                { id: 'lookbook', n: '04', icon: '🖼️', label: tt('Lookbook', 'Kết quả'), meta: sets.length + ' ' + tt('looks', 'look'), c: COLORS.red },
              ].map((p, i, arr) => {
                const a = p.id === area;
                return (
                  <div key={p.id} onClick={() => setArea(p.id)} className="st-press" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '11px 15px', borderRadius: 12, minWidth: 92, background: a ? p.c + '14' : COLORS.panel2, border: '1px solid ' + (a ? p.c + '99' : COLORS.line) }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span className="mono" style={{ fontSize: 9, fontWeight: 800, color: a ? p.c : COLORS.muted }}>{p.n}</span>
                        <span style={{ fontSize: 13 }}>{p.icon}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: a ? p.c : COLORS.text }}>{p.label}</div>
                      <div className="mono" style={{ fontSize: 9, color: COLORS.muted }}>{p.meta}</div>
                    </div>
                    {i < arr.length - 1 && <span className="mono" style={{ padding: '0 7px', color: COLORS.muted, opacity: 0.5 }}>→</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setArea('compose')} className="mono st-press" style={{
                padding: '13px 24px', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', background: COLORS.red, border: '1px solid ' + COLORS.red, color: '#fff',
                display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 10px 26px -10px ' + COLORS.red + '99',
              }}>✦ {tt('Compose a look', 'Phối một bộ')}</button>
              <button onClick={() => setArea('character')} className="mono st-press" style={{
                padding: '13px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', background: 'transparent', border: '1px solid ' + COLORS.line, color: COLORS.text,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>🧍 {tt('Build character', 'Tạo nhân vật')}</button>
            </div>
          </div>

          {/* stage — real character image if present, else placeholder */}
          {!isMobile && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 290 }}>
              {character ? (
                <CachedImg cacheKey={'char:' + character.id} url={character.charUrl} alt={character.name || 'character'}
                  onClick={() => openZoom('char:' + character.id, character.charUrl, character.name || 'character')}
                  style={{ width: 208, height: 282, borderRadius: 18, objectFit: 'cover', border: '1px solid ' + COLORS.line, cursor: 'zoom-in', boxShadow: '0 24px 50px -22px rgba(0,0,0,0.5)' }} />
              ) : (
                <div onClick={() => setArea('character')} style={{
                  width: 208, height: 282, borderRadius: 18, border: '1px dashed ' + COLORS.line, background: COLORS.panel2,
                  position: 'relative', overflow: 'hidden', cursor: 'pointer', display: 'grid', placeItems: 'center',
                }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(80% 70% at 50% 18%, ' + COLORS.gold + '29 0%, transparent 65%)' }} />
                  <span style={{ fontSize: 92, opacity: 0.5 }}>🧍</span>
                  <span className="mono" style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 8, letterSpacing: '0.14em', color: COLORS.muted, background: 'rgba(13,10,8,0.5)', padding: '4px 8px', borderRadius: 7 }}>+ {tt('BUILD MODEL', 'TẠO NHÂN VẬT')}</span>
                </div>
              )}
              {[
                { glyph: '🧥', name: tt('Overcoat', 'Áo khoác'), tag: 'OUTER', tagColor: COLORS.gold, pos: { top: 4, left: -22 }, dur: '4.2s', delay: '0s', rot: '-4deg' },
                { glyph: '👕', name: tt('Top', 'Áo'), tag: 'READY', tagColor: COLORS.green, pos: { bottom: 40, right: -26 }, dur: '5s', delay: '.6s', rot: '3deg' },
                { glyph: '👟', name: tt('Shoes', 'Giày'), tag: 'READY', tagColor: COLORS.green, pos: { bottom: -6, left: 10 }, dur: '4.6s', delay: '1.1s', rot: '2deg' },
              ].map((hc, i) => (
                <div key={i} style={{
                  position: 'absolute', ...hc.pos, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 11,
                  background: COLORS.panel, border: '1px solid ' + COLORS.line, boxShadow: '0 12px 26px -14px rgba(0,0,0,0.45)',
                  animation: 'st-float ' + hc.dur + ' ease-in-out infinite', animationDelay: hc.delay, '--rot': hc.rot,
                }}>
                  <span style={{ fontSize: 18 }}>{hc.glyph}</span>
                  <div>
                    <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: COLORS.text }}>{hc.name}</div>
                    <div className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: hc.tagColor }}>{hc.tag}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Area tabs (sticky: stays pinned to the top of the scroll area so
             it never rides up over the hero, and stays reachable after a mix) ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        borderBottom: '1px solid ' + COLORS.line, padding: '10px 0 12px', margin: '-4px 0 0',
        background: 'rgba(13,10,8,0.7)', backdropFilter: 'blur(10px)',
      }}>
        {[
          { id: 'character', icon: '🧍', label: tt('Character', 'Nhân vật'), short: '01', n: character ? 1 : 0 },
          { id: 'wardrobe', icon: '👕', label: tt('Wardrobe', 'Tủ đồ'), short: '02', n: items.length },
          { id: 'compose', icon: '✦', label: tt('Compose', 'Phối đồ'), short: '03', n: suggestions.length || null },
          { id: 'lookbook', icon: '🖼️', label: tt('Lookbook', 'Kết quả'), short: '04', n: sets.length },
          { id: 'tokens', icon: '◧', label: tt('Tokens', 'Tokens'), short: '05', n: null },
        ].map((tb) => {
          const a = tb.id === area;
          return (
            <button key={tb.id} onClick={() => setArea(tb.id)} className="mono st-tab st-press" style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderRadius: 11, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
              background: a ? COLORS.red + '14' : COLORS.panel, border: '1px solid ' + (a ? COLORS.red + '8c' : COLORS.line), color: a ? COLORS.text : COLORS.muted,
            }}>
              <span style={{ fontSize: 14 }}>{tb.icon}</span>{tb.label}
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, background: a ? COLORS.red + '22' : 'rgba(245,237,224,0.07)', color: a ? COLORS.red : COLORS.muted }}>
                {tb.n != null ? String(tb.n).padStart(2, '0') : tb.short}
              </span>
            </button>
          );
        })}
      </div>

      {/* Character */}
      {area === 'character' && (
      <div style={{ animation: 'fadeUp 200ms ease' }}>
      <CharacterPanel character={character} busy={charBusy} isMobile={isMobile} onZoom={openZoom}
        onCreate={createCharacter} onEdit={editCharacter} onRemove={removeCharacter} />
      </div>
      )}

      {/* Wardrobe */}
      {area === 'wardrobe' && (
      <div style={{ animation: 'fadeUp 200ms ease' }}>
      <Panel padding={isMobile ? 14 : 18}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <Kicker style={{ marginBottom: 6 }}>{t('stylist.wardrobe')} · {String(items.length).padStart(2, '0')}</Kicker>
            <div style={{ fontSize: 13, color: COLORS.muted, maxWidth: 460, lineHeight: 1.5 }}>{t('stylist.uploadHint')}</div>
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPickFile} style={{ display: 'none' }} />
            <Btn variant="solid" color={ACCENT} onClick={() => fileRef.current?.click()}>＋ {t('stylist.upload')}</Btn>
          </div>
        </div>

        {items.length === 0 ? (
          <div style={{ border: '1px dashed ' + COLORS.line, borderRadius: 12, padding: '36px 20px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
            👗 {t('stylist.empty')}
          </div>
        ) : (
          <>
            {/* toolbar: search + category filter + stats */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field value={query} onChange={setQuery} placeholder={t('stylist.searchPh')} style={{ fontSize: 12, padding: '8px 12px' }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip active={!filterCat} onClick={() => setFilterCat(null)}>{t('stylist.all')}</Chip>
                {CATEGORIES.map((c) => (
                  <Chip key={c} active={filterCat === c} onClick={() => setFilterCat(filterCat === c ? null : c)}>
                    {t('stylist.cat.' + c)} {counts[c] || 0}
                  </Chip>
                ))}
              </div>
            </div>
            {CATEGORIES.some((c) => counts[c] === 0) && (
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
                {t('stylist.gapHint')} {CATEGORIES.filter((c) => counts[c] === 0).map((c) => t('stylist.cat.' + c)).join(', ')}
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 130 : 150}px, 1fr))` }}>
              {shownItems.map((it) => (
                <ItemCard key={it.id} item={it} onZoom={openZoom}
                  pinned={pinned.has(it.id)} excluded={excluded.has(it.id)}
                  onEdit={editItem} onDelete={deleteItem} onRetry={retryItem}
                  onTogglePin={togglePin} onToggleExclude={toggleExclude} />
              ))}
            </div>
          </>
        )}
      </Panel>
      </div>
      )}

      {/* Compose */}
      {area === 'compose' && (
      <div style={{ animation: 'fadeUp 200ms ease', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel padding={isMobile ? 14 : 18}>
        <Kicker style={{ marginBottom: 12 }}>{t('stylist.compose')}</Kicker>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {PRESETS.map((p) => <Chip key={p.k} onClick={() => setOccasion(p.occ)}>{t('stylist.preset.' + p.k)}</Chip>)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field value={occasion} onChange={setOccasion} placeholder={t('stylist.occasionPh')}
            onKeyDown={(e) => { if (e.key === 'Enter') runMix(); }} />
          <Btn variant="solid" color={ACCENT} onClick={() => runMix()} disabled={mixing || readyItems.length < 2}
            style={{ width: '100%', padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {mixing ? '◇ ' + t('stylist.mixing') : '✦ ' + t('stylist.mix')}
          </Btn>
        </div>

        {(pinned.size > 0 || excluded.size > 0) && (
          <div style={{ marginTop: 10, fontSize: 11, color: COLORS.muted, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {pinned.size > 0 && <span>📌 {t('stylist.pinned')} {pinned.size}</span>}
            {excluded.size > 0 && <span>🚫 {t('stylist.excluded')} {excluded.size}</span>}
            <button onClick={() => { setPinned(new Set()); setExcluded(new Set()); }} className="mono"
              style={{ background: 'transparent', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11 }}>{t('stylist.clear')}</button>
          </div>
        )}

        {/* Advanced constraints (collapsed) */}
        <button onClick={() => setAdvOpen((v) => !v)} className="mono"
          style={{ marginTop: 12, background: 'transparent', border: 'none', color: COLORS.muted, cursor: 'pointer', fontSize: 11, letterSpacing: '0.14em', padding: 0 }}>
          {advOpen ? '▾' : '▸'} {t('stylist.advanced')}
        </button>
        {advOpen && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 6 }}>{t('stylist.formality')}</div>
              <ChipRow options={FORMALITY} value={constraints.formality} onChange={(v) => setConstraints((c) => ({ ...c, formality: v }))} nullable />
            </div>
            <div>
              <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 6 }}>{t('stylist.season')}</div>
              <ChipRow options={SEASONS} value={constraints.season} onChange={(v) => setConstraints((c) => ({ ...c, season: v }))} nullable />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field value={constraints.weather} onChange={(v) => setConstraints((c) => ({ ...c, weather: v }))} placeholder={t('stylist.weatherPh')} style={{ fontSize: 12, padding: '9px 12px' }} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field value={constraints.colorMood} onChange={(v) => setConstraints((c) => ({ ...c, colorMood: v }))} placeholder={t('stylist.colorPh')} style={{ fontSize: 12, padding: '9px 12px' }} />
              </div>
            </div>
          </div>
        )}

        {/* Lookbook style (collapsed) */}
        <button onClick={() => setStyleOpen((v) => !v)} className="mono"
          style={{ marginTop: 10, background: 'transparent', border: 'none', color: COLORS.muted, cursor: 'pointer', fontSize: 11, letterSpacing: '0.14em', padding: 0 }}>
          {styleOpen ? '▾' : '▸'} {t('stylist.lookStyle')}
        </button>
        {styleOpen && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[['pose', POSES, 'stylist.pose'], ['scene', SCENES, 'stylist.scene'], ['framing', FRAMINGS, 'stylist.framing'], ['ratio', RATIOS, 'stylist.ratio']].map(([key, options, label]) => (
              <div key={key}>
                <div className="mono" style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 6 }}>{t(label)}</div>
                <ChipRow options={options} value={lookOpts[key]} onChange={(v) => v && setLookOpts({ [key]: v })} />
              </div>
            ))}
          </div>
        )}

        {readyItems.length < 2 && <div style={{ marginTop: 10, fontSize: 12, color: COLORS.muted }}>{t('stylist.needTwo')}</div>}
        {error && <div style={{ marginTop: 10, fontSize: 12, color: COLORS.red }}>⚠ {error}</div>}
      </Panel>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Kicker>{t('stylist.suggestions')}</Kicker>
            <Btn variant="ghost" onClick={shuffle} disabled={mixing}>⟳ {t('stylist.shuffle')}</Btn>
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {suggestions.map((s) => (
              <SetCard key={s.id} set={s} items={items} busyLookbook={!!lookbookBusy[s.id]} onZoom={openZoom}
                onRenderLookbook={renderSuggestionLookbook} onSwap={(o, n) => swapSuggestion(s, o, n)}
                onSave={saveSet} onDownload={downloadSet} onMoreLikeThis={moreLikeThis} />
            ))}
          </div>
        </div>
      )}

      </div>
      )}

      {/* Lookbook (saved sets) */}
      {area === 'lookbook' && (
      <div style={{ animation: 'fadeUp 200ms ease' }}>
        {sets.length > 0 ? (
        <div>
          <Kicker style={{ marginBottom: 10 }}>{t('stylist.saved')} · {String(sets.length).padStart(2, '0')}</Kicker>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {sortedSets.map((s) => (
              <SetCard key={s.id} set={s} items={items} isSaved busyLookbook={!!lookbookBusy[s.id]} onZoom={openZoom}
                onRenderLookbook={renderSavedLookbook} onSwap={(o, n) => swapSaved(s, o, n)}
                onDelete={deleteSet} onDownload={downloadSet} onToggleFav={toggleFav} onMoreLikeThis={moreLikeThis} />
            ))}
          </div>
        </div>
        ) : (
          <div style={{ border: '1px dashed ' + COLORS.line, borderRadius: 16, padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 44, opacity: 0.5 }}>🖼️</span>
            <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>{tt('No looks yet', 'Chưa có look')}</div>
            <p style={{ margin: 0, maxWidth: 380, fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55 }}>
              {tt('Compose an outfit and Mix, then save it — your looks land here.', 'Phối một bộ rồi lưu lại — các look sẽ hiện ở đây.')}
            </p>
            <Btn variant="solid" color={COLORS.red} onClick={() => setArea('compose')}>✦ {tt('Go to Compose', 'Tới Phối đồ')}</Btn>
          </div>
        )}
      </div>
      )}

      {/* Tokens (design reference) */}
      {area === 'tokens' && (
      <div style={{ animation: 'fadeUp 200ms ease' }}>
        <TokenMap tt={tt} />
      </div>
      )}

      {/* Footer */}
      <footer className="mono" style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid ' + COLORS.line, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 10, color: COLORS.muted, letterSpacing: '0.16em' }}>
        <span>SE77N · STYLIST · EXP 007</span>
        <span style={{ color: COLORS.gold }}>◐ {tt('ASYNC RENDER', 'RENDER BẤT ĐỒNG BỘ')}</span>
      </footer>

      <Lightbox data={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

export default Stylist;
