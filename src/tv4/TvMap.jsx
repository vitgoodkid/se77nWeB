// 01 MAP · MapLibre canvas + right drawer + pins + command palette + layers.
// Tile source: CARTO Dark Matter (free OSS raster, no key). Switch to vector + Protomaps
// for a denser map experience later — keep this simple for v0.4.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';

const PIN_COLORS = {
  see:      COLORS.green,
  eat:      COLORS.gold,
  move:     COLORS.red,
  stay:     '#9bb4ff',
  other:    COLORS.muted,
  wishlist: 'rgba(212,168,88,0.35)',
  ongoing:  COLORS.gold,
};

const RASTER_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d0a08' } },
    { id: 'carto', type: 'raster', source: 'carto-dark', minzoom: 0, maxzoom: 19, paint: { 'raster-opacity': 0.85 } },
  ],
};

export default function TvMap({ trips, onOpenTrip }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const routeLayerId = 'tv4-routes';
  const heatLayerId = 'tv4-heat';

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
  const [enableClustering, setEnableClustering] = useState(true);
  const clusterMarkersRef = useRef([]);
  const supRef = useRef(null);

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

  // Map init.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE,
      center: [121.56, 25.04], // Taipei default
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapRef.current = map;

    map.on('contextmenu', (e) => {
      setContextMenu({ x: e.point.x, y: e.point.y, lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    map.on('click', (e) => {
      setContextMenu(null);
      // editMode click-to-add handled in a separate effect that reads latest state.
      const ev = new CustomEvent('tv4-map-click', { detail: { lng: e.lngLat.lng, lat: e.lngLat.lat } });
      window.dispatchEvent(ev);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync projection.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    try {
      // setProjection exists on MapLibre 4+; ignore on older.
      m.setProjection?.({ type: projection });
    } catch (e) {
      // older versions silently noop
    }
  }, [projection]);

  // Markers (raw pins + cluster bubbles). Re-renders when pins/zoom/active change.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    // Build supercluster index once per pins set.
    const points = pins
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({
        type: 'Feature',
        properties: { pinId: p._id },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      }));
    supRef.current = new Supercluster({ radius: 50, maxZoom: 14 }).load(points);

    const renderMarkers = () => {
      // Clear all.
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
      clusterMarkersRef.current.forEach((mk) => mk.remove());
      clusterMarkersRef.current = [];

      const bounds = m.getBounds();
      const z = Math.floor(m.getZoom());
      const clusters = enableClustering ? supRef.current.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        z,
      ) : points;

      for (const c of clusters) {
        const [lng, lat] = c.geometry.coordinates;
        if (c.properties?.cluster) {
          const count = c.properties.point_count;
          const el = document.createElement('button');
          el.style.cssText = `
            width:${28 + Math.min(count, 50)}px;height:${28 + Math.min(count, 50)}px;
            border-radius:999px;background:${COLORS.gold}33;color:${COLORS.gold};
            border:2px solid ${COLORS.gold};cursor:pointer;padding:0;
            font-family:JetBrains Mono, monospace;font-weight:700;font-size:12px;
            box-shadow:0 0 18px ${COLORS.gold}55;
          `;
          el.textContent = String(count);
          el.addEventListener('click', () => {
            const expansionZoom = Math.min(supRef.current.getClusterExpansionZoom(c.properties.cluster_id), 14);
            m.flyTo({ center: [lng, lat], zoom: expansionZoom + 0.5, speed: 1.4 });
          });
          const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
          clusterMarkersRef.current.push(mk);
          continue;
        }

        const pinId = c.properties?.pinId;
        const p = pins.find((x) => x._id === pinId);
        if (!p) continue;
        const dim = activeTripId && p.tripId !== activeTripId && !editMode;
        const color = PIN_COLORS[p.type] || PIN_COLORS.other;

        const el = document.createElement('div');
        el.style.cssText = 'position:relative;';
        el.innerHTML = `
          <button style="
            width:${editMode ? 18 : 14}px;height:${editMode ? 18 : 14}px;border-radius:999px;
            border:2px solid ${COLORS.bg};
            background:${color};cursor:pointer;padding:0;
            box-shadow:0 0 0 1px ${color}55,0 0 12px ${color}66;
            opacity:${dim ? 0.35 : 1};
            ${p.type === 'wishlist' ? 'border-style:dashed;background:transparent;' : ''}
            ${p.type === 'ongoing' ? 'animation:tv4PinPulse 1.8s ease-in-out infinite;' : ''}
          " title="${(p.name || '').replace(/"/g, '&quot;')} — ${(p._tripTitle || '').replace(/"/g, '&quot;')}"></button>
          ${editMode ? `<button class="tv4-pin-del" style="
            position:absolute;top:-8px;right:-8px;width:16px;height:16px;border-radius:999px;
            background:${COLORS.red};color:${COLORS.bg};border:none;cursor:pointer;
            font-size:11px;font-weight:700;line-height:1;
          ">×</button>` : ''}
        `;
        el.querySelector('button')?.addEventListener('click', (e) => {
          e.stopPropagation();
          setActivePinId(p._id);
          setActiveTripId(p.tripId);
          m.flyTo({ center: [p.lng, p.lat], zoom: 12, speed: 1.4 });
        });
        if (editMode) {
          el.querySelector('.tv4-pin-del')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.confirm(`Delete pin "${p.name}"?`)) return;
            try {
              await tv4.remove('pins', p._id);
              setPins((arr) => arr.filter((x) => x._id !== p._id));
            } catch (err) {
              alert('Delete failed: ' + err.message);
            }
          });
        }
        const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
        markersRef.current.push(mk);
      }
    };

    renderMarkers();
    m.on('moveend', renderMarkers);
    m.on('zoomend', renderMarkers);
    return () => {
      m.off('moveend', renderMarkers);
      m.off('zoomend', renderMarkers);
    };
  }, [pins, activeTripId, editMode, enableClustering]);

  // Click-to-add in edit mode.
  useEffect(() => {
    const onClick = (e) => {
      if (!editMode) return;
      if (!activeTripId) {
        alert('Pick a trip in the drawer before adding pins.');
        return;
      }
      setNewPinDraft({ lat: e.detail.lat, lng: e.detail.lng });
    };
    window.addEventListener('tv4-map-click', onClick);
    return () => window.removeEventListener('tv4-map-click', onClick);
  }, [editMode, activeTripId]);

  // Routes layer.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) {
      // wait for style
      const handler = () => {
        toggleRoutes(mapRef.current, pins, activeTripId, layerRoutes, routeLayerId);
      };
      m?.once('load', handler);
      return () => m?.off('load', handler);
    }
    toggleRoutes(m, pins, activeTripId, layerRoutes, routeLayerId);
  }, [pins, activeTripId, layerRoutes]);

  // Heat layer.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const apply = () => toggleHeat(m, pins, layerHeat, heatLayerId);
    if (m.isStyleLoaded()) apply();
    else m.once('load', apply);
    return () => m.off('load', apply);
  }, [pins, layerHeat]);

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
    const m = mapRef.current; if (!m) return;
    setActiveTripId(trip._id);
    const tripPins = pins.filter((p) => p.tripId === trip._id && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!tripPins.length) return;
    const lngs = tripPins.map((p) => p.lng), lats = tripPins.map((p) => p.lat);
    m.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, duration: 800 },
    );
  }, [pins]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile
        ? '1fr'
        : (drawerOpen ? '1fr 380px' : '1fr 0'),
      gridTemplateRows: isMobile && drawerOpen ? '1fr auto' : '1fr',
      height: '100%', position: 'relative',
    }}>
      <div ref={containerRef} style={{ position: 'relative', overflow: 'hidden' }}>
        <style>{`@keyframes tv4PinPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.6; } }`}</style>

        {!drawerOpen && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="mono"
            style={{
              position: 'absolute', top: 12, right: 12, zIndex: 5,
              padding: '6px 12px', borderRadius: 8,
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
              color: COLORS.muted, cursor: 'pointer',
              fontSize: 10, letterSpacing: '0.18em',
            }}
          >SHOW DRAWER · [</button>
        )}

        <div style={{
          position: 'absolute', bottom: 12, left: 12, zIndex: 5,
          display: 'flex', gap: 6,
        }}>
          <LayerToggle on={layerRoutes} onClick={() => setLayerRoutes((v) => !v)} label="ROUTES" />
          <LayerToggle on={layerHeat} onClick={() => setLayerHeat((v) => !v)} label="HEATMAP" />
          <LayerToggle on={enableClustering} onClick={() => setEnableClustering((v) => !v)} label="CLUSTER" />
          <LayerToggle
            on={projection === 'globe'}
            onClick={() => setProjection((p) => p === 'globe' ? 'mercator' : 'globe')}
            label="🌐 GLOBE"
          />
        </div>

        {editMode && (
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 5,
            display: 'flex', gap: 6, alignItems: 'center',
            padding: '6px 10px', borderRadius: 999,
            background: COLORS.red + '20', border: `1px solid ${COLORS.red}80`,
            color: COLORS.red, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: '0.14em',
          }}>
            ◉ EDIT MODE · click to add · ESC to finish
            <button onClick={() => setEditMode(false)} style={{
              marginLeft: 8, padding: '2px 8px', borderRadius: 6,
              background: COLORS.red, color: COLORS.bg, border: 'none',
              cursor: 'pointer', fontSize: 10, fontWeight: 700,
            }}>DONE</button>
          </div>
        )}

        {contextMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: contextMenu.y, left: contextMenu.x, zIndex: 10,
              background: COLORS.panel, border: '1px solid ' + COLORS.line,
              borderRadius: 10, padding: 6, minWidth: 200,
              boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
            }}
          >
            <CtxItem label={`Add pin here (${contextMenu.lat.toFixed(2)}, ${contextMenu.lng.toFixed(2)})`}
              onClick={() => alert('Pin add via map — task #11')} />
            <CtxItem label="Set as home" onClick={() => alert('Home base via Settings')} />
            <CtxItem label="Plan a trip from here" onClick={() => alert('Pre-fill new trip — todo')} />
            <CtxItem label="Cancel" onClick={() => setContextMenu(null)} />
          </div>
        )}
      </div>

      {drawerOpen && (
        <aside style={{
          borderLeft: isMobile ? 'none' : '1px solid ' + COLORS.line,
          borderTop: isMobile ? '1px solid ' + COLORS.line : 'none',
          overflow: 'auto',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(13,10,8,0.92)', backdropFilter: 'blur(10px)',
          maxHeight: isMobile ? '50vh' : '100%',
        }}>
          <DrawerHeader
            activeTrip={activeTrip}
            onClose={() => setDrawerOpen(false)}
            onSearch={() => setPaletteOpen(true)}
            editMode={editMode}
            onToggleEdit={() => {
              if (!activeTripId && !editMode) { alert('Pick a trip first'); return; }
              setEditMode((v) => !v);
            }}
          />
          <StatsRow stats={stats} />
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
function DrawerHeader({ activeTrip, onClose, onSearch, editMode, onToggleEdit }) {
  return (
    <div style={{
      padding: '14px 16px', borderBottom: '1px solid ' + COLORS.line,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <button
        onClick={onSearch}
        className="mono"
        style={{
          flex: 1,
          padding: '8px 12px', borderRadius: 8,
          background: COLORS.bg, border: '1px solid ' + COLORS.line,
          color: COLORS.muted, cursor: 'pointer', textAlign: 'left',
          fontSize: 11, letterSpacing: '0.12em',
        }}
      >⌘K · search trips, places, tags</button>
      <button
        onClick={onToggleEdit}
        title="Toggle edit pins (ESC to leave)"
        className="mono"
        style={{
          padding: '6px 10px', borderRadius: 6,
          background: editMode ? COLORS.red + '20' : 'transparent',
          color: editMode ? COLORS.red : COLORS.muted,
          border: '1px solid ' + (editMode ? COLORS.red + '60' : COLORS.line),
          cursor: 'pointer', fontSize: 10, letterSpacing: '0.14em',
        }}
      >EDIT</button>
      <button
        onClick={onClose}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'transparent', border: '1px solid ' + COLORS.line,
          color: COLORS.muted, cursor: 'pointer', fontSize: 14,
        }}
        title="Collapse [ "
      >×</button>
    </div>
  );
}

function StatsRow({ stats }) {
  const cells = [
    ['PLACES', stats.places, COLORS.gold],
    ['DAYS',   stats.days,   COLORS.green],
    ['KM',     stats.km,     COLORS.red],
    ['SPEND',  stats.spend,  COLORS.text],
    ['NOTES',  stats.notes,  COLORS.muted],
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
      borderBottom: '1px solid ' + COLORS.line,
    }}>
      {cells.map(([l, n, c]) => (
        <div key={l} style={{ padding: '10px 6px', borderRight: '1px solid ' + COLORS.line, textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 8, letterSpacing: '0.16em', color: COLORS.muted }}>{l}</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4, color: c }}>{n}</div>
        </div>
      ))}
    </div>
  );
}

function ActiveTripPanel({ trip, activePin, pins, onOpenTrip, onSelectPin, onClearTrip }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
      <div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
          ACTIVE TRIP
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{trip.title}</div>
        <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
          {trip.country || '—'} · {trip.startDate || '—'} → {trip.endDate || '—'}
        </div>
      </div>

      {activePin && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'rgba(245,237,224,0.04)',
          border: '1px solid ' + COLORS.line,
        }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: COLORS.gold }}>
            ● {(activePin.type || 'OTHER').toUpperCase()}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{activePin.name}</div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
            {activePin.lat.toFixed(4)}° · {activePin.lng.toFixed(4)}°
            {activePin.dayIndex != null && ` · D${activePin.dayIndex + 1}`}
            {activePin.estCost ? ` · ${activePin.currency || ''}${activePin.estCost}` : ''}
          </div>
          {activePin.notes && (
            <div style={{ marginTop: 8, fontSize: 12, color: COLORS.text }}>{activePin.notes}</div>
          )}
        </div>
      )}

      <div>
        <div className="mono" style={{
          fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 6,
        }}>PLACES · {pins.length}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pins.length === 0 ? (
            <span style={{ color: COLORS.muted, fontSize: 12 }}>no pins yet</span>
          ) : pins.slice().sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0)).map((p) => (
            <button
              key={p._id}
              onClick={() => onSelectPin(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 6,
                background: activePin?._id === p._id ? 'rgba(212,168,88,0.10)' : 'transparent',
                border: '1px solid ' + (activePin?._id === p._id ? COLORS.gold + '55' : 'transparent'),
                color: COLORS.text, cursor: 'pointer',
                fontSize: 12, textAlign: 'left',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: PIN_COLORS[p.type] || PIN_COLORS.other }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>
                D{(p.dayIndex ?? 0) + 1}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
        <Btn onClick={onClearTrip}>Clear</Btn>
        <Btn onClick={onOpenTrip} variant="tinted" color={COLORS.gold}>Open trip folder →</Btn>
      </div>
    </div>
  );
}

function AllTripsPanel({ trips, pins, onFocus }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 6,
      }}>ALL TRIPS · {trips.length}</div>
      {trips.length === 0 ? (
        <span style={{ color: COLORS.muted, fontSize: 12 }}>No trips yet — create one in LIST</span>
      ) : trips.map((t) => {
        const count = pins.filter((p) => p.tripId === t._id).length;
        return (
          <button
            key={t._id}
            onClick={() => onFocus(t)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8,
              background: 'rgba(245,237,224,0.04)',
              border: '1px solid ' + COLORS.line, cursor: 'pointer',
              color: COLORS.text, textAlign: 'left', fontSize: 12,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: 999,
              background: t.status === 'visited' ? COLORS.green : t.status === 'ongoing' ? COLORS.gold : COLORS.red,
            }} />
            <span style={{ flex: 1 }}>{t.title}</span>
            <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{count} pins</span>
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
      onClick={onClick}
      className="mono"
      style={{
        padding: '5px 10px', borderRadius: 6,
        background: on ? COLORS.gold + '24' : COLORS.panel,
        border: '1px solid ' + (on ? COLORS.gold + '80' : COLORS.line),
        color: on ? COLORS.gold : COLORS.muted,
        fontSize: 9, letterSpacing: '0.18em', cursor: 'pointer',
      }}
    >{label}</button>
  );
}

function CtxItem({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6,
        background: 'transparent', border: 'none', color: COLORS.text,
        cursor: 'pointer', fontSize: 12,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245,237,224,0.05)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '92%',
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 14, overflow: 'hidden',
          color: COLORS.text,
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="search trips, places, tags…"
          style={{
            width: '100%',
            padding: '14px 18px',
            background: 'transparent', border: 'none', outline: 'none',
            color: COLORS.text, fontSize: 15,
            borderBottom: '1px solid ' + COLORS.line,
          }}
        />
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {matchTrips.length > 0 && (
            <PaletteGroup title="TRIPS">
              {matchTrips.slice(0, 8).map((t) => (
                <PaletteRow key={t._id} onClick={() => onSelectTrip(t)} primary={t.title} secondary={t.country || '—'} />
              ))}
            </PaletteGroup>
          )}
          {matchPins.length > 0 && (
            <PaletteGroup title="PLACES">
              {matchPins.slice(0, 12).map((p) => (
                <PaletteRow key={p._id} onClick={() => onSelectPin(p)} primary={p.name} secondary={`${p._tripTitle || ''} · ${p.lat.toFixed(2)}°,${p.lng.toFixed(2)}°`} />
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
            <div style={{ padding: 22, color: COLORS.muted, fontSize: 13 }} className="mono">
              ◇ no matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaletteGroup({ title, children }) {
  return (
    <div>
      <div className="mono" style={{
        fontSize: 9, letterSpacing: '0.22em', color: COLORS.muted,
        padding: '10px 18px 4px',
      }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function PaletteRow({ onClick, primary, secondary }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '10px 18px',
        background: 'transparent', border: 'none', cursor: onClick ? 'pointer' : 'default',
        color: COLORS.text, textAlign: 'left',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245,237,224,0.04)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ flex: 1, fontSize: 13 }}>{primary}</span>
      <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{secondary}</span>
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
    paint: { 'line-color': COLORS.gold, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
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
    <div role="dialog" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} style={{
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 14, padding: 24, width: 420, color: COLORS.text,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>NEW PIN</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>Drop a place</div>
          <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
            {initial.lat.toFixed(4)}°, {initial.lng.toFixed(4)}°
          </div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>Name</span>
          <Field value={name} onChange={setName} placeholder="Ichiran Shibuya" autoFocus mono={false} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="mono" style={{
              background: COLORS.bg, border: '1px solid ' + COLORS.line,
              borderRadius: 10, padding: '11px 14px', color: COLORS.text, fontSize: 13,
            }}>
              {['see', 'eat', 'move', 'stay', 'other', 'wishlist'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>Day</span>
            <Field type="number" value={dayIndex} onChange={setDayIndex} placeholder="0" />
          </label>
        </div>
        {error && (
          <div style={{
            padding: 10, borderRadius: 8,
            background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
            color: COLORS.red, fontSize: 12,
          }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Btn onClick={onClose} type="button">Cancel</Btn>
          <div style={{ marginLeft: 'auto' }}>
            <Btn type="submit" variant="solid" color={COLORS.gold} disabled={submitting}>
              {submitting ? '…' : 'Drop pin'}
            </Btn>
          </div>
        </div>
      </form>
    </div>
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
