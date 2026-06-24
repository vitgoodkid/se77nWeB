// featuresC.jsx — AI Outfit Stylist.
//
// Upload clothes/accessories → AI re-renders each into a clean catalog item →
// type an occasion → AI mixes your real pieces into outfit sets → render a
// lookbook per set. Item bytes are cached on-device (IndexedDB); only small
// metadata (names, categories, fal URLs) syncs via useSyncedData.
//
// Reuses: /api/stylist (classify + mix), /api/image (catalog re-render +
// multi-image lookbook, with its pending/poll machinery), and the lib.jsx
// primitives + sync hooks.

import { useState, useRef, useCallback } from 'react';
import {
  COLORS, Panel, Btn, Kicker, Pill, Field,
  useLang, useSyncedData, useMediaQuery, compressImage, usePasteImage,
} from './lib.jsx';
import { useCachedImage, idbDel } from './lib/idb.js';

const CATEGORIES = ['top', 'bottom', 'outer', 'shoes', 'accessory'];

const ACCENT = COLORS.gold;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function catalogPrompt(category) {
  return `Studio e-commerce product photo of this exact ${category}, isolated on a clean seamless light-grey background, centered, soft even lighting, no model, no extra props, sharp focus, catalog style. Keep the garment's real color, pattern and shape unchanged.`;
}

function lookbookPrompt(occasion) {
  const occ = (occasion || '').trim();
  return `A cohesive fashion lookbook flat-lay neatly arranging these clothing pieces together as one styled outfit${occ ? ', suited for ' + occ : ''}. Clean seamless background, soft daylight, magazine styling, top-down arrangement. Keep each piece's real color and shape.`;
}

// Read a fetch Response without throwing the cryptic JSON parse error.
async function safeJson(res, label) {
  const raw = await res.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { /* not JSON */ } }
  if (!res.ok) throw new Error(data?.error || data?.message || `${label} ${res.status}`);
  if (!data) throw new Error(`${label}: empty response`);
  return data;
}

// /api/image returns { image } when fast, or { pending, statusUrl } to poll.
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return pollImage(await safeJson(res, 'image'));
}

// ── Cached <img> for a wardrobe item / lookbook ────────────────
function CachedImg({ cacheKey, url, alt, style }) {
  const src = useCachedImage(cacheKey, url);
  if (!src) {
    return <div style={{ ...style, background: COLORS.panel2, display: 'grid', placeItems: 'center', color: COLORS.muted, fontSize: 10 }} className="mono">—</div>;
  }
  return <img src={src} alt={alt || ''} style={style} loading="lazy" />;
}

// ── Wardrobe item card ─────────────────────────────────────────
function ItemCard({ item, onDelete }) {
  const { t } = useLang();
  const processing = item.status === 'processing';
  const error = item.status === 'error';
  return (
    <div style={{
      position: 'relative', borderRadius: 12, overflow: 'hidden',
      border: '1px solid ' + COLORS.line, background: COLORS.panel,
    }}>
      <div style={{ aspectRatio: '1 / 1', background: COLORS.panel2, position: 'relative' }}>
        {processing ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span className="mono" style={{ fontSize: 10, color: ACCENT, letterSpacing: '0.16em' }}>
              ◇ {t('stylist.processing')}
            </span>
          </div>
        ) : error ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 10, textAlign: 'center' }}>
            <span className="mono" style={{ fontSize: 10, color: COLORS.red }}>⚠ {item.error || 'failed'}</span>
          </div>
        ) : (
          <CachedImg cacheKey={'item:' + item.id} url={item.itemUrl}
            alt={item.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{
          fontSize: 12, color: COLORS.text, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.name}</div>
        {!processing && (
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill color={ACCENT}>{t('stylist.cat.' + item.category)}</Pill>
            {item.color && <span className="mono" style={{ fontSize: 9, color: COLORS.muted }}>{item.color}</span>}
          </div>
        )}
      </div>
      <button onClick={() => onDelete(item)} aria-label="delete"
        style={{
          position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 7,
          background: 'rgba(13,10,8,0.55)', border: '1px solid ' + COLORS.line,
          color: COLORS.text, cursor: 'pointer', display: 'grid', placeItems: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1,
        }}>✕</button>
    </div>
  );
}

// ── Outfit set card (suggestion or saved) ──────────────────────
function SetCard({ set, items, onRenderLookbook, onSave, onDelete, busyLookbook }) {
  const { t } = useLang();
  const setItems = set.itemIds.map((id) => items.find((it) => it.id === id)).filter(Boolean);
  return (
    <Panel padding={14} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{set.name}</div>
        <Pill color={ACCENT}>{setItems.length} {t('stylist.pieces')}</Pill>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {setItems.map((it) => (
          <CachedImg key={it.id} cacheKey={'item:' + it.id} url={it.itemUrl} alt={it.name}
            style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: '1px solid ' + COLORS.line }} />
        ))}
      </div>

      {set.rationale && (
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5 }}>{set.rationale}</div>
      )}

      {set.lookbookUrl && (
        <CachedImg cacheKey={'look:' + set.id} url={set.lookbookUrl} alt="lookbook"
          style={{ width: '100%', borderRadius: 10, border: '1px solid ' + COLORS.line, display: 'block' }} />
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!set.lookbookUrl && (
          <Btn variant="tinted" color={ACCENT} onClick={() => onRenderLookbook(set)} disabled={busyLookbook}>
            {busyLookbook ? '◇ ' + t('stylist.rendering') : '✦ ' + t('stylist.renderLookbook')}
          </Btn>
        )}
        {onSave && (
          <Btn variant="solid" color={ACCENT} onClick={() => onSave(set)}>✓ {t('stylist.saveSet')}</Btn>
        )}
        {onDelete && (
          <Btn variant="ghost" onClick={() => onDelete(set)}>{t('stylist.delete')}</Btn>
        )}
      </div>
    </Panel>
  );
}

// ── Main module ────────────────────────────────────────────────
export function Stylist() {
  const { t } = useLang();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [wardrobe, setWardrobe] = useSyncedData(
    { localKey: 'se77n.wardrobe.v1', serverKey: 'wardrobe' },
    { items: [], sets: [] },
  );
  const items = wardrobe.items || [];
  const sets = wardrobe.sets || [];

  const [occasion, setOccasion] = useState('');
  const [count, setCount] = useState(3);
  const [mixing, setMixing] = useState(false);
  const [suggestions, setSuggestions] = useState([]); // unsaved sets from last mix
  const [lookbookBusy, setLookbookBusy] = useState({}); // setId|suggIdx → bool
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const patchItem = useCallback((id, patch) => {
    setWardrobe((w) => ({
      ...w,
      items: (w.items || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  }, [setWardrobe]);

  // Upload → classify → catalog re-render → wardrobe.
  const addGarment = useCallback(async (img) => {
    if (!img?.dataUrl) return;
    const id = genId();
    setError('');
    setWardrobe((w) => ({
      ...w,
      items: [{ id, name: t('stylist.processing'), category: 'top', color: '', status: 'processing', createdAt: Date.now() }, ...(w.items || [])],
    }));
    try {
      // 1. classify (fast)
      let meta = { name: 'item', category: 'top', color: '' };
      try {
        const c = await fetch('/api/agent?action=classify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: img.dataUrl }),
        });
        meta = await safeJson(c, 'classify');
      } catch { /* fall back to defaults; re-render still works */ }
      patchItem(id, { name: meta.name, category: meta.category, color: meta.color });

      // 2. catalog re-render (slow, may poll)
      const itemUrl = await renderImage({ prompt: catalogPrompt(meta.category), image: img.dataUrl, engine: 'nano' });
      patchItem(id, { itemUrl, status: 'ready' });
    } catch (e) {
      patchItem(id, { status: 'error', error: (e.message || 'failed').slice(0, 80) });
    }
  }, [setWardrobe, patchItem, t]);

  const onPickFile = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach((f) => compressImage(f).then((img) => img && addGarment(img)).catch(() => {}));
  }, [addGarment]);

  usePasteImage(useCallback((img) => addGarment(img), [addGarment]), true);

  const deleteItem = useCallback((item) => {
    idbDel('item:' + item.id);
    setWardrobe((w) => ({
      ...w,
      items: (w.items || []).filter((it) => it.id !== item.id),
      // prune the dead id out of saved sets; drop sets left too small
      sets: (w.sets || [])
        .map((s) => ({ ...s, itemIds: s.itemIds.filter((id) => id !== item.id) }))
        .filter((s) => s.itemIds.length >= 1),
    }));
    setSuggestions((sg) => sg
      .map((s) => ({ ...s, itemIds: s.itemIds.filter((id) => id !== item.id) }))
      .filter((s) => s.itemIds.length >= 1));
  }, [setWardrobe]);

  // Occasion → mix (fast chat).
  const runMix = useCallback(async () => {
    const ready = items.filter((it) => it.status !== 'processing' && it.status !== 'error' && it.itemUrl);
    if (ready.length < 2 || mixing) return;
    setMixing(true);
    setError('');
    setSuggestions([]);
    try {
      const res = await fetch('/api/agent?action=mix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: ready.map((it) => ({ id: it.id, name: it.name, category: it.category, color: it.color })),
          occasion, count,
        }),
      });
      const data = await safeJson(res, 'mix');
      const sg = (data.sets || []).map((s) => ({ ...s, id: genId(), occasion }));
      if (!sg.length) setError(t('stylist.noSets'));
      setSuggestions(sg);
    } catch (e) {
      setError(e.message || 'mix failed');
    } finally {
      setMixing(false);
    }
  }, [items, occasion, count, mixing, t]);

  // Render a lookbook composite for a set (on-demand, one fal job).
  const renderLookbook = useCallback(async (set, { onDone } = {}) => {
    const urls = set.itemIds
      .map((id) => items.find((it) => it.id === id)?.itemUrl)
      .filter(Boolean);
    if (urls.length < 1) return;
    setLookbookBusy((b) => ({ ...b, [set.id]: true }));
    try {
      const url = await renderImage({ prompt: lookbookPrompt(set.occasion || occasion), images: urls, engine: 'nano' });
      if (onDone) onDone(url);
    } catch (e) {
      setError(e.message || 'lookbook failed');
    } finally {
      setLookbookBusy((b) => ({ ...b, [set.id]: false }));
    }
  }, [items, occasion]);

  const renderSuggestionLookbook = useCallback((set) => {
    renderLookbook(set, { onDone: (url) => {
      setSuggestions((sg) => sg.map((s) => (s.id === set.id ? { ...s, lookbookUrl: url } : s)));
    } });
  }, [renderLookbook]);

  const renderSavedLookbook = useCallback((set) => {
    renderLookbook(set, { onDone: (url) => {
      setWardrobe((w) => ({ ...w, sets: (w.sets || []).map((s) => (s.id === set.id ? { ...s, lookbookUrl: url } : s)) }));
      // best-effort log to the shared history feed (matches AIPlayground)
      fetch('/api/toolbox?kind=history', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'image', prompt: 'lookbook · ' + (set.name || ''), mediaUrl: url, preset: 'stylist' }),
      }).catch(() => {});
    } });
  }, [renderLookbook, setWardrobe]);

  const saveSet = useCallback((set) => {
    setWardrobe((w) => ({ ...w, sets: [{ ...set, createdAt: Date.now() }, ...(w.sets || [])] }));
    setSuggestions((sg) => sg.filter((s) => s.id !== set.id));
  }, [setWardrobe]);

  const deleteSet = useCallback((set) => {
    idbDel('look:' + set.id);
    setWardrobe((w) => ({ ...w, sets: (w.sets || []).filter((s) => s.id !== set.id) }));
  }, [setWardrobe]);

  const readyCount = items.filter((it) => it.itemUrl && it.status !== 'error').length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 4 }}>
      {/* Wardrobe */}
      <Panel padding={isMobile ? 14 : 18}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
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
          <div style={{
            border: '1px dashed ' + COLORS.line, borderRadius: 12, padding: '36px 20px',
            textAlign: 'center', color: COLORS.muted, fontSize: 13,
          }}>
            👗 {t('stylist.empty')}
          </div>
        ) : (
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 130 : 150}px, 1fr))`,
          }}>
            {items.map((it) => <ItemCard key={it.id} item={it} onDelete={deleteItem} />)}
          </div>
        )}
      </Panel>

      {/* Compose */}
      <Panel padding={isMobile ? 14 : 18}>
        <Kicker style={{ marginBottom: 12 }}>{t('stylist.compose')}</Kicker>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field value={occasion} onChange={setOccasion}
              placeholder={t('stylist.occasionPh')}
              onKeyDown={(e) => { if (e.key === 'Enter') runMix(); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[2, 3, 4].map((n) => (
              <button key={n} onClick={() => setCount(n)} className="mono"
                style={{
                  width: 34, height: 38, borderRadius: 8, cursor: 'pointer',
                  border: '1px solid ' + (count === n ? ACCENT + '88' : COLORS.line),
                  background: count === n ? ACCENT + '1a' : 'transparent',
                  color: count === n ? ACCENT : COLORS.muted, fontSize: 12, fontWeight: 700,
                }}>{n}</button>
            ))}
          </div>
          <Btn variant="solid" color={ACCENT} onClick={runMix} disabled={mixing || readyCount < 2}>
            {mixing ? '◇ ' + t('stylist.mixing') : '✦ ' + t('stylist.mix')}
          </Btn>
        </div>
        {readyCount < 2 && (
          <div style={{ marginTop: 10, fontSize: 12, color: COLORS.muted }}>{t('stylist.needTwo')}</div>
        )}
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: COLORS.red }}>⚠ {error}</div>
        )}
      </Panel>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <Kicker style={{ marginBottom: 10 }}>{t('stylist.suggestions')}</Kicker>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {suggestions.map((s) => (
              <SetCard key={s.id} set={s} items={items}
                onRenderLookbook={renderSuggestionLookbook}
                onSave={saveSet}
                busyLookbook={!!lookbookBusy[s.id]} />
            ))}
          </div>
        </div>
      )}

      {/* Saved sets */}
      {sets.length > 0 && (
        <div>
          <Kicker style={{ marginBottom: 10 }}>{t('stylist.saved')} · {String(sets.length).padStart(2, '0')}</Kicker>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {sets.map((s) => (
              <SetCard key={s.id} set={s} items={items}
                onRenderLookbook={renderSavedLookbook}
                onDelete={deleteSet}
                busyLookbook={!!lookbookBusy[s.id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Stylist;
