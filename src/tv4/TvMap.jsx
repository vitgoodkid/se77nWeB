// 01 MAP · Pixel "overworld" map + trip drawer + pins + command palette.
// Replaces the previous MapLibre raster engine with a deterministic SVG render
// (see DottedWorldMap.jsx) that blinks world capitals in gold. Click → pan/select,
// right-click → context menu (add pin / plan trip / set as home).
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import DottedWorldMap from './DottedWorldMap.jsx';
import {
  GOLD, ON, PIN_FILL, PIN_LEGEND, statusFill,
  CartHead, Empty, ErrorNote, FormRow, IconClose, IconSearch, Label, Overlay, PixelFlag,
  PxDialog, PxSelect, Swatch, Tag, fieldStyle,
} from './kit.jsx';

const PIN_COLORS = PIN_FILL;

export default function TvMap({ trips, onOpenTrip, onRefreshTrips }) {
  const [pins, setPins] = useState([]);
  const [activeTripId, setActiveTripId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [activePinId, setActivePinId] = useState(null);
  const [layerRoutes, setLayerRoutes] = useState(false);
  const [layerHeat, setLayerHeat] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [projection, setProjection] = useState('mercator');
  const [editMode, setEditMode] = useState(false);
  const [newPinDraft, setNewPinDraft] = useState(null);
  const [newTripDraft, setNewTripDraft] = useState(null);
  const [enableClustering, setEnableClustering] = useState(true);
  const frameRef = useRef(null);
  // The SVG map has no camera; this ref stays null so the flyTo calls below are
  // safe no-ops instead of throwing a ReferenceError.
  const mapRef = useRef(null);
  // Inline toast — replaces native alert(), auto-dismisses after 3s.
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Load all pins for all trips on mount.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Fetch all pins by listing per trip (no global pins endpoint scope).
        const all = [];
        for (const t of trips) {
          const r = await tv4.list('pins', { tripId: t._id });
          for (const p of r.docs || []) all.push({ ...p, _tripSlug: t.slug, _tripTitle: t.title, _tripStatus: t.status });
        }
        if (!cancel) setPins(all);
      } catch (e) {
        console.warn('pin load failed', e);
      }
    })();
    return () => { cancel = true; };
  }, [trips]);

  // Pin select from the SVG map.
  const onPinSelect = useCallback((p) => {
    setActivePinId(p._id);
    setActiveTripId(p.tripId);
  }, []);

  // Right-click on the SVG → open context menu at click position.
  const onMapContextMenu = useCallback((c) => {
    setContextMenu({ x: c.x, y: c.y, lat: c.lat, lng: c.lng });
  }, []);

  // Keyboard shortcuts: '[' toggles drawer, '⌘K' or 'ctrl+K' opens palette.
  useEffect(() => {
    const h = (e) => {
      if (e.key === '[') {
        setDrawerOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setContextMenu(null);
        setEditMode(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Aggregate stats per active trip (or global if none).
  const stats = useMemo(() => {
    const scope = activeTripId
      ? pins.filter((p) => p.tripId === activeTripId)
      : pins;
    const trip = activeTripId ? trips.find((t) => t._id === activeTripId) : null;
    let km = 0;
    if (trip) {
      const byDay = {};
      for (const p of scope) {
        const d = p.dayIndex ?? 0;
        (byDay[d] = byDay[d] || []).push(p);
      }
      for (const arr of Object.values(byDay)) {
        const s = arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        for (let i = 1; i < s.length; i++) {
          km += haversineKm(s[i - 1], s[i]);
        }
      }
    }
    return {
      places: scope.length,
      days:   trip ? tripDays(trip) : trips.length,
      km:     Math.round(km),
      spend:  '—',
      notes:  '—',
    };
  }, [pins, trips, activeTripId]);

  const activePin = useMemo(() => pins.find((p) => p._id === activePinId), [pins, activePinId]);
  const activeTrip = useMemo(() => trips.find((t) => t._id === activeTripId), [trips, activeTripId]);

  const focusTrip = useCallback((trip) => {
    setActiveTripId(trip._id);
  }, []);

  const toggleEdit = () => {
    if (!activeTripId && !editMode) { setToast({ kind: 'warn', text: 'Pick a trip first.' }); return; }
    setEditMode((v) => !v);
  };

  // Keep the context menu inside the map frame.
  const frameW = frameRef.current?.clientWidth || 0;
  const frameH = frameRef.current?.clientHeight || 0;
  const menuLeft = contextMenu ? (frameW && contextMenu.x + 250 > frameW ? Math.max(4, contextMenu.x - 250) : contextMenu.x) : 0;
  const menuTop = contextMenu ? (frameH && contextMenu.y + 200 > frameH ? Math.max(4, contextMenu.y - 200) : contextMenu.y) : 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32, padding: '6px 6px 12px' }}>
      <section className="px" aria-labelledby="tv-map-h" style={{
        flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', background: COLORS.paper,
      }}>
        <CartHead id="tv-map-h" title="01 MAP · OVERWORLD" right={`${pins.length} PINS · ${trips.length} TRIPS`} />

        {/* Toolbar: search + edit pins (+ drawer re-open) */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18,
          padding: '16px 22px 18px 16px', borderBottom: '3px dashed var(--rule)',
        }}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="pxs mono"
            style={{
              flex: '1 1 240px', minWidth: 0, height: 44, padding: '0 12px',
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
              fontSize: 13, color: COLORS.muted, background: COLORS.field, border: 0, cursor: 'pointer',
            }}
          >
            <span style={{ color: COLORS.text, display: 'inline-flex' }}><IconSearch size={16} /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span className="sk" style={{ fontSize: 11, color: COLORS.text }}>⌘K</span> · search trips, places, tags
            </span>
          </button>
          <button
            type="button"
            onClick={toggleEdit}
            aria-pressed={editMode}
            title="Toggle edit pins (ESC to leave)"
            className="sk sbtn"
            style={{
              height: 40, padding: '0 14px', fontSize: 12,
              color: editMode ? ON : COLORS.text, background: editMode ? '#ff7a7a' : COLORS.paper,
            }}
          >EDIT PINS</button>
          {!drawerOpen && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="sk sbtn"
              style={{ height: 40, padding: '0 14px', fontSize: 12, color: COLORS.text, background: COLORS.paper }}
            >SHOW DRAWER · [</button>
          )}
        </div>

        {/* The map "screen" */}
        <div
          ref={frameRef}
          className="tv-map tv-mapframe"
          style={{
            position: 'relative',
            backgroundColor: 'var(--tv-sea)',
            backgroundImage: 'radial-gradient(var(--tv-sea-dot) 1px, transparent 1.4px)',
            backgroundSize: '12px 12px',
            border: '3px solid var(--ink)',
          }}
        >
          <DottedWorldMap
            pins={pins}
            trips={trips}
            activeTripId={activeTripId}
            onPinSelect={onPinSelect}
            onContextMenu={onMapContextMenu}
          />

          {editMode && (
            <div className="sk pxs" role="status" style={{
              position: 'absolute', top: 12, left: 12, zIndex: 5,
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px',
              maxWidth: 'calc(100% - 30px)', padding: '8px 10px',
              fontSize: 11, color: ON, background: '#ff7a7a',
            }}>
              <span>
                <span className="blink" aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 8, background: ON }} />
                EDIT MODE · CLICK TO ADD · ESC TO FINISH
              </span>
              <button type="button" onClick={() => setEditMode(false)} className="sk" style={{
                height: 28, padding: '0 10px', fontSize: 11, color: '#fffaf0', background: '#1b1410',
                border: 0, cursor: 'pointer',
              }}>DONE</button>
            </div>
          )}

          {contextMenu && (
            <div
              role="menu"
              aria-label="Map actions"
              onClick={(e) => e.stopPropagation()}
              className="pxs"
              style={{
                position: 'absolute', top: menuTop, left: menuLeft, zIndex: 10,
                display: 'flex', flexDirection: 'column', minWidth: 230, padding: '6px 0',
                background: COLORS.paper, color: COLORS.text,
              }}
            >
              <Label as="p" style={{ margin: 0, padding: '6px 14px 8px', fontSize: 10, borderBottom: '3px dashed var(--rule)' }}>
                {contextMenu.lat.toFixed(2)}° · {contextMenu.lng.toFixed(2)}°
              </Label>
              <CtxItem
                label={`Add pin here (${contextMenu.lat.toFixed(2)}, ${contextMenu.lng.toFixed(2)})`}
                onClick={() => {
                  if (!activeTripId) {
                    setToast({ kind: 'warn', text: 'Pick a trip in the drawer before adding pins.' });
                    setContextMenu(null);
                    return;
                  }
                  setNewPinDraft({ lat: contextMenu.lat, lng: contextMenu.lng });
                  setContextMenu(null);
                }}
              />
              <CtxItem
                label="Plan a trip from here"
                onClick={() => {
                  setNewTripDraft({ lat: contextMenu.lat, lng: contextMenu.lng });
                  setContextMenu(null);
                }}
              />
              <CtxItem
                label="Set as home"
                onClick={async () => {
                  const { lat, lng } = contextMenu;
                  setContextMenu(null);
                  try {
                    const { doc: existing } = await tv4.getSettings();
                    const next = {
                      ...(existing || {}),
                      homeBase: { lat, lng, name: existing?.homeBase?.name || '' },
                    };
                    await tv4.saveSettings(next);
                    setToast({ kind: 'ok', text: `Home base set · ${lat.toFixed(3)}°, ${lng.toFixed(3)}°` });
                  } catch (e) {
                    setToast({ kind: 'err', text: 'Save failed: ' + (e.message || 'unknown') });
                  }
                }}
              />
              <CtxItem label="Cancel" muted onClick={() => setContextMenu(null)} />
            </div>
          )}

          {toast && (
            <div
              role="status"
              className="sk pxs"
              style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
                zIndex: 20, maxWidth: 'calc(100% - 30px)', padding: '8px 14px',
                fontSize: 11, lineHeight: 1.4, textAlign: 'center', color: ON,
                background: toast.kind === 'err' ? '#ff7a7a' : toast.kind === 'ok' ? '#7fd18b' : GOLD,
              }}
            >{toast.text}</div>
          )}
        </div>

        {/* Map stats strip (always-dark HUD) */}
        <StatsRow stats={stats} />

        {/* Legend + right-click hint */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px 20px' }}>
          <p className="sk" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px',
            margin: 0, fontSize: 10, color: COLORS.muted,
          }}>
            <span style={{ color: COLORS.text }}>PIN TYPES</span>
            {PIN_LEGEND.map((t) => (
              <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Swatch fill={PIN_FILL[t.id]} dashed={t.id === 'wishlist'} />{t.label}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, background: GOLD, boxShadow: '0 0 0 2px var(--ink)' }} />CAPITAL
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <PixelFlag size={12} />TRIP HOME
            </span>
          </p>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
            <span className="sk" style={{ fontSize: 10, color: COLORS.text }}>RIGHT-CLICK MAP ›</span>{' '}
            Add pin here · Plan a trip from here · Set as home
          </p>
        </div>
      </section>

      {drawerOpen && (
        <aside className="px" aria-labelledby="tv-drawer-h" style={{
          flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', background: COLORS.paper,
        }}>
          <DrawerHeader activeTrip={activeTrip} onClose={() => setDrawerOpen(false)} />
          {activeTrip ? (
            <ActiveTripPanel
              trip={activeTrip}
              activePin={activePin}
              pins={pins.filter((p) => p.tripId === activeTrip._id)}
              onOpenTrip={() => onOpenTrip(activeTrip)}
              onSelectPin={(p) => { setActivePinId(p._id); mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 12 }); }}
              onClearTrip={() => setActiveTripId(null)}
            />
          ) : (
            <AllTripsPanel trips={trips} pins={pins} onFocus={focusTrip} />
          )}
        </aside>
      )}

      {newPinDraft && activeTripId && (
        <NewPinModal
          initial={newPinDraft}
          tripId={activeTripId}
          onClose={() => setNewPinDraft(null)}
          onCreated={async (created) => {
            const trip = trips.find((t) => t._id === activeTripId);
            setPins((arr) => [...arr, { ...created, _tripSlug: trip?.slug, _tripTitle: trip?.title, _tripStatus: trip?.status }]);
            setNewPinDraft(null);
          }}
        />
      )}

      {newTripDraft && (
        <NewTripFromMapModal
          initial={newTripDraft}
          onClose={() => setNewTripDraft(null)}
          onCreated={async (trip) => {
            setNewTripDraft(null);
            await onRefreshTrips?.();
            setActiveTripId(trip._id);
            mapRef.current?.flyTo({ center: [newTripDraft.lng, newTripDraft.lat], zoom: 9, speed: 1.4 });
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          query={paletteQuery}
          onQuery={setPaletteQuery}
          trips={trips}
          pins={pins}
          onClose={() => { setPaletteOpen(false); setPaletteQuery(''); }}
          onSelectTrip={(t) => {
            setPaletteOpen(false); setPaletteQuery('');
            focusTrip(t);
          }}
          onSelectPin={(p) => {
            setPaletteOpen(false); setPaletteQuery('');
            setActivePinId(p._id);
            setActiveTripId(p.tripId);
            mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 13 });
          }}
        />
      )}
    </div>
  );
}

// ─── Drawer subviews ────────────────────────────────────────────
function DrawerHeader({ activeTrip, onClose }) {
  return (
    <div className="sk ribs" style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      minHeight: 32, padding: '4px 6px 4px 14px', fontSize: 12, color: ON, backgroundColor: GOLD,
      borderBottom: '4px solid var(--ink)',
    }}>
      <h3 id="tv-drawer-h" className="tv-skh" style={{ margin: 0, fontSize: 12, color: ON }}>
        {activeTrip ? 'TRIP DRAWER · ACTIVE' : 'TRIP DRAWER · ALL'}
      </h3>
      <button
        type="button"
        onClick={onClose}
        aria-label="Collapse drawer"
        title="Collapse [ "
        style={{
          display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0,
          color: ON, background: 'transparent', border: '2px solid #1b1410', cursor: 'pointer',
        }}
      ><IconClose size={12} /></button>
    </div>
  );
}

function StatsRow({ stats }) {
  const cells = [
    ['PLACES', stats.places, '#ffd25e'],
    ['DAYS',   stats.days,   '#7fd18b'],
    ['KM',     stats.km,     '#ff7a7a'],
    ['SPEND',  stats.spend,  '#fffaf0'],
    ['NOTES',  stats.notes,  '#c9bca6'],
  ];
  return (
    <div className="sk tv-g5 tv-mapframe" style={{
      marginTop: 0, color: '#fffaf0', background: 'var(--strip)', '--tv-sep': '#5c5046',
      border: '3px solid var(--ink)', borderTop: 0,
    }}>
      {cells.map(([l, n, c], i) => (
        <div key={l} style={{
          display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', minWidth: 0,
          borderLeft: i ? '3px dashed #5c5046' : 'none',
        }}>
          <span style={{ fontSize: 10, color: '#c9bca6' }}>{l}</span>
          <span style={{ fontSize: 16, color: c, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

function ActiveTripPanel({ trip, activePin, pins, onOpenTrip, onSelectPin, onClearTrip }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
      <div>
        <Label as="p" style={{ margin: 0, fontSize: 10 }}>ACTIVE TRIP</Label>
        <p className="pf" style={{ margin: '6px 0 0', fontSize: 22, lineHeight: 1.1 }}>{trip.title}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.muted }}>
          {trip.country || '—'} · {trip.startDate || '—'} → {trip.endDate || '—'}
        </p>
      </div>

      {activePin && (
        <div className="pxs" style={{ padding: 12, background: COLORS.field, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span><Tag fill={PIN_COLORS[activePin.type] || PIN_COLORS.other}>{(activePin.type || 'OTHER').toUpperCase()}</Tag></span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{activePin.name}</span>
          <span style={{ fontSize: 11, color: COLORS.muted }}>
            {activePin.lat.toFixed(4)}° · {activePin.lng.toFixed(4)}°
            {activePin.dayIndex != null && ` · D${activePin.dayIndex + 1}`}
            {activePin.estCost ? ` · ${activePin.currency || ''}${activePin.estCost}` : ''}
          </span>
          {activePin.notes && (
            <span style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>{activePin.notes}</span>
          )}
        </div>
      )}

      <div>
        <Label as="p" style={{ margin: '0 0 8px', fontSize: 10 }}>PLACES · {pins.length}</Label>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {pins.length === 0 ? (
            <span style={{ color: COLORS.muted, fontSize: 12 }}>no pins yet</span>
          ) : pins.slice().sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0)).map((p) => {
            const on = activePin?._id === p._id;
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => onSelectPin(p)}
                aria-pressed={on}
                className={'tv-row' + (on ? ' tv-on' : '')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                  background: on ? COLORS.panel2 : 'transparent', border: 0,
                  borderBottom: '3px dashed var(--rule)', color: COLORS.text,
                  fontSize: 13, textAlign: 'left',
                }}
              >
                <Swatch fill={PIN_COLORS[p.type] || PIN_COLORS.other} dashed={p.type === 'wishlist'} />
                <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>D{(p.dayIndex ?? 0) + 1}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 16, padding: '0 8px 8px 0' }}>
        <PxButton onClick={onClearTrip} style={{ height: 40 }}>CLEAR</PxButton>
        <PxButton onClick={onOpenTrip} fill={GOLD} style={{ height: 40 }}>OPEN TRIP FOLDER →</PxButton>
      </div>
    </div>
  );
}

function AllTripsPanel({ trips, pins, onFocus }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <Label as="p" style={{ margin: '0 0 4px', fontSize: 10 }}>ALL TRIPS · {trips.length}</Label>
      {trips.length === 0 ? (
        <Empty title="NO SAVE DATA" hint="No trips yet — create one in LIST" style={{ padding: '18px 8px' }} />
      ) : trips.map((t) => {
        const count = pins.filter((p) => p.tripId === t._id).length;
        return (
          <button
            key={t._id}
            type="button"
            onClick={() => onFocus(t)}
            className="tv-row"
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px',
              background: 'transparent', border: 0, borderBottom: '3px dashed var(--rule)',
              color: COLORS.text, textAlign: 'left', fontSize: 13,
            }}
          >
            <PixelFlag size={16} fill={statusFill(t.status)} />
            <span style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{t.title}</span>
            <span className="sk" style={{ fontSize: 10, color: COLORS.muted, whiteSpace: 'nowrap' }}>{count} PINS</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Layer toggle ───────────────────────────────────────────────
function LayerToggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="chip-px sk"
      style={{ minHeight: 30, padding: '0 10px', fontSize: 10 }}
    >{label}</button>
  );
}

function CtxItem({ label, onClick, muted }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="tv-mi"
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '9px 14px', background: 'transparent', border: 'none',
        color: muted ? COLORS.muted : COLORS.text, fontSize: 13,
      }}
    >{label}</button>
  );
}

// ─── Command palette ────────────────────────────────────────────
function CommandPalette({ query, onQuery, trips, pins, onClose, onSelectTrip, onSelectPin }) {
  const q = query.toLowerCase().trim();
  const matchTrips = trips.filter((t) => !q || (t.title || '').toLowerCase().includes(q) || (t.country || '').toLowerCase().includes(q));
  const matchPins  = pins.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  const tagSet = new Set();
  for (const t of trips) (t.tags || []).forEach((tag) => tagSet.add(tag));
  const matchTags = [...tagSet].filter((tg) => !q || tg.toLowerCase().includes(q));

  return (
    <Overlay>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--tv-backdrop)',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '80px 16px 16px',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search trips, places, tags"
          onClick={(e) => e.stopPropagation()}
          className="px"
          style={{ width: 560, maxWidth: 'calc(100% - 20px)', background: COLORS.paper, color: COLORS.text }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px',
            borderBottom: '3px dashed var(--rule)',
          }}>
            <IconSearch size={18} />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="search trips, places, tags…"
              aria-label="Search trips, places, tags"
              className="mono field"
              style={{ flex: 1, minWidth: 0, height: 44, padding: '0 12px', fontSize: 15 }}
            />
            <span className="sk tv-hide-sm" style={{ fontSize: 10, color: COLORS.muted }}>ESC</span>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto', padding: '4px 0 10px' }}>
            {matchTrips.length > 0 && (
              <PaletteGroup title="TRIPS">
                {matchTrips.slice(0, 8).map((t) => (
                  <PaletteRow key={t._id} onClick={() => onSelectTrip(t)} primary={t.title} secondary={t.country || '—'}
                    icon={<PixelFlag size={14} fill={statusFill(t.status)} />} />
                ))}
              </PaletteGroup>
            )}
            {matchPins.length > 0 && (
              <PaletteGroup title="PLACES">
                {matchPins.slice(0, 12).map((p) => (
                  <PaletteRow key={p._id} onClick={() => onSelectPin(p)} primary={p.name} secondary={`${p._tripTitle || ''} · ${p.lat.toFixed(2)}°,${p.lng.toFixed(2)}°`}
                    icon={<Swatch fill={PIN_COLORS[p.type] || PIN_COLORS.other} dashed={p.type === 'wishlist'} />} />
                ))}
              </PaletteGroup>
            )}
            {matchTags.length > 0 && (
              <PaletteGroup title="TAGS">
                {matchTags.slice(0, 6).map((tg) => (
                  <PaletteRow key={tg} primary={`#${tg}`} secondary="" />
                ))}
              </PaletteGroup>
            )}
            {!matchTrips.length && !matchPins.length && !matchTags.length && (
              <Empty title="NO MATCHES" hint="Nothing found for that search." style={{ padding: '22px 16px' }} />
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function PaletteGroup({ title, children }) {
  return (
    <div>
      <Label as="p" style={{ margin: 0, padding: '12px 18px 6px', fontSize: 10 }}>{title}</Label>
      <div>{children}</div>
    </div>
  );
}

function PaletteRow({ onClick, primary, secondary, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={onClick ? 'tv-mi' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '10px 18px',
        background: 'transparent', border: 'none', cursor: onClick ? 'pointer' : 'default',
        color: COLORS.text, textAlign: 'left',
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{primary}</span>
      <span style={{ fontSize: 11, color: COLORS.muted }}>{secondary}</span>
    </button>
  );
}

// ─── Layer helpers ──────────────────────────────────────────────
function toggleRoutes(map, pins, activeTripId, on, layerId) {
  if (!map || !map.getStyle) return;
  if (map.getLayer(layerId)) { map.removeLayer(layerId); }
  if (map.getSource(layerId)) { map.removeSource(layerId); }
  if (!on) return;

  // Build per-trip ordered polylines, filter to active trip if set.
  const tripsScope = {};
  for (const p of pins) {
    if (activeTripId && p.tripId !== activeTripId) continue;
    (tripsScope[p.tripId] = tripsScope[p.tripId] || []).push(p);
  }
  const features = [];
  for (const arr of Object.values(tripsScope)) {
    const s = arr.slice().sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0) || (a.order || 0) - (b.order || 0));
    const coords = s.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => [p.lng, p.lat]);
    if (coords.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
  }
  map.addSource(layerId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: layerId, source: layerId, type: 'line',
    paint: { 'line-color': GOLD, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
  });
}

function toggleHeat(map, pins, on, layerId) {
  if (!map || !map.getStyle) return;
  if (map.getLayer(layerId)) { map.removeLayer(layerId); }
  if (map.getSource(layerId)) { map.removeSource(layerId); }
  if (!on) return;
  const features = pins
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  map.addSource(layerId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: layerId, source: layerId, type: 'heatmap',
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': 1.1,
      'heatmap-radius': 32,
      'heatmap-opacity': 0.75,
    },
  });
}

// ─── New pin modal (edit mode) ──────────────────────────────────
function NewPinModal({ initial, tripId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('see');
  const [dayIndex, setDayIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const { doc } = await tv4.create('pins', {
        tripId,
        name: name.trim(),
        type,
        lat: initial.lat,
        lng: initial.lng,
        dayIndex: Number(dayIndex) || 0,
      });
      onCreated(doc);
    } catch (e) {
      setError(e.message || 'create_failed');
      setSubmitting(false);
    }
  };

  return (
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      zIndex={2000}
      width={440}
      kicker="NEW PIN"
      title="Drop a place"
      sub={`${initial.lat.toFixed(4)}°, ${initial.lng.toFixed(4)}°`}
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" fill={GOLD} disabled={submitting} style={{ height: 44 }}>
          {submitting ? '…' : 'DROP PIN'}
        </PxButton>
      </>}
    >
      <FormRow label="Name">
        <Field value={name} onChange={setName} placeholder="Ichiran Shibuya" autoFocus mono={false} style={fieldStyle} />
      </FormRow>
      <div className="tv-g2" style={{ gap: 18 }}>
        <FormRow label="Type">
          <PxSelect value={type} onChange={setType}
            options={['see', 'eat', 'move', 'stay', 'other', 'wishlist'].map((t) => ({ v: t, l: t }))} />
        </FormRow>
        <FormRow label="Day">
          <Field type="number" value={dayIndex} onChange={setDayIndex} placeholder="0" style={fieldStyle} />
        </FormRow>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </PxDialog>
  );
}

// ─── New trip from map click ────────────────────────────────────
function NewTripFromMapModal({ initial, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('planned');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('NEA');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tripCurrency, setTripCurrency] = useState('JPY');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e?.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSubmitting(true); setError(null);
    try {
      const body = {
        title: title.trim(),
        status,
        country: country.trim() || undefined,
        region,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        tripCurrency: tripCurrency || undefined,
        homeBase: { lat: initial.lat, lng: initial.lng, name: country.trim() || '' },
      };
      const { doc } = await tv4.create('trips', body);
      onCreated(doc);
    } catch (err) {
      setError(err.message || 'create_failed');
      setSubmitting(false);
    }
  };

  return (
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      zIndex={2000}
      width={520}
      kicker="PLAN A TRIP HERE"
      title="New trip"
      sub={`home base · ${initial.lat.toFixed(4)}°, ${initial.lng.toFixed(4)}°`}
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" fill={GOLD} disabled={submitting} style={{ height: 44 }}>
          {submitting ? '…' : 'CREATE TRIP'}
        </PxButton>
      </>}
    >
      <FormRow label="Title">
        <Field value={title} onChange={setTitle} placeholder="Tokyo · Akiba nights" autoFocus mono={false} style={fieldStyle} />
      </FormRow>

      <div className="tv-g2" style={{ gap: 18 }}>
        <FormRow label="Status">
          <PxSelect value={status} onChange={setStatus}
            options={['planned', 'ongoing', 'visited'].map((s) => ({ v: s, l: s }))} />
        </FormRow>
        <FormRow label="Region">
          <PxSelect value={region} onChange={setRegion}
            options={['SEA', 'NEA', 'EU', 'NA', 'OCEANIA', 'SA', 'AF', 'ME', 'OTHER'].map((r) => ({ v: r, l: r }))} />
        </FormRow>
      </div>

      <FormRow label="Country">
        <Field value={country} onChange={setCountry} placeholder="JP" style={fieldStyle} />
      </FormRow>

      <div className="tv-g2" style={{ gap: 18 }}>
        <FormRow label="Start">
          <Field type="date" value={startDate} onChange={setStartDate} style={fieldStyle} />
        </FormRow>
        <FormRow label="End">
          <Field type="date" value={endDate} onChange={setEndDate} style={fieldStyle} />
        </FormRow>
      </div>

      <FormRow label="Trip currency">
        <Field value={tripCurrency} onChange={setTripCurrency} placeholder="JPY" style={fieldStyle} />
      </FormRow>

      {error && <ErrorNote>{error}</ErrorNote>}
    </PxDialog>
  );
}

// ─── Helpers ────────────────────────────────────────────────────
function tripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return 0;
  const s = new Date(trip.startDate), e = new Date(trip.endDate);
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(x));
}
