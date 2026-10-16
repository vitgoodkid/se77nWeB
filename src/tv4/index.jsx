// se77n Travel v0.4 — module 09 entry point.
// Manages internal sub-routing #/tv4/<view>[/<slug>] and trip context state.
// Per-tab views live in sibling files (TvList, TvFolder, TvMap, TvPlan, TvExpenses, TvSettings).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, useAuth } from '../lib.jsx';
import { DialogBox, PixelCoin } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import TvMap from './TvMap.jsx';
import TvList from './TvList.jsx';
import TvFolder from './TvFolder.jsx';
import TvPlan from './TvPlan.jsx';
import TvExpenses from './TvExpenses.jsx';
import TvSettings from './TvSettings.jsx';
import { IconGear, Loading, PixelFlag, Swatch, statusFill } from './kit.jsx';
import './tv4.arcade.css';

const TABS = [
  { id: 'map',      label: 'MAP',      num: '01' },
  { id: 'list',     label: 'LIST',     num: '02' },
  { id: 'folder',   label: 'FOLDER',   num: '03', needsTrip: true },
  { id: 'plan',     label: 'PLAN',     num: '04', needsTrip: true },
  { id: 'expenses', label: 'EXPENSES', num: '05', needsTrip: true },
];

// Hash format: #/tv4 | #/tv4/<view> | #/tv4/<view>/<slug>
function parseHash() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '') || '';
  const m = raw.replace(/^#\//, '').split('/');
  if (m[0] !== 'tv4') return { view: 'list', slug: null, sub: null };
  const view = TABS.find((t) => t.id === m[1]) ? m[1] : 'list';
  return { view, slug: m[2] || null, sub: m[3] || null };
}

function setHash(view, slug, sub) {
  const parts = ['tv4', view];
  if (slug) parts.push(slug);
  if (sub) parts.push(sub);
  window.location.hash = '#/' + parts.join('/');
}

export function TravelV4() {
  const { user, status: authStatus } = useAuth();
  const authReady = authStatus !== 'loading';
  const [{ view, slug, sub }, setRoute] = useState(parseHash);
  const [trips, setTrips] = useState([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsError, setTripsError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Keep internal state in sync with browser hash changes.
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Fetch the user's trips list once after sign-in. Re-used by every tab.
  const refreshTrips = useCallback(async () => {
    if (!user) { setTrips([]); return; }
    setLoadingTrips(true);
    setTripsError(null);
    try {
      const { docs } = await tv4.list('trips');
      setTrips(docs || []);
    } catch (e) {
      console.warn('tv4 trips load failed', e);
      setTripsError(e.message || 'load_failed');
    } finally {
      setLoadingTrips(false);
    }
  }, [user]);

  useEffect(() => {
    if (authReady) refreshTrips();
  }, [authReady, refreshTrips]);

  const activeTrip = useMemo(() => {
    if (!trips.length) return null;
    if (slug) return trips.find((t) => t.slug === slug) || null;
    // Fallback per spec: when a trip-context tab is opened without slug, use most recent.
    const tabDef = TABS.find((t) => t.id === view);
    if (tabDef?.needsTrip) {
      const ongoing = trips.find((t) => t.status === 'ongoing');
      return ongoing || trips[0] || null;
    }
    return null;
  }, [trips, slug, view]);

  const nav = useCallback((nextView, nextSlug, nextSub) => {
    const tabDef = TABS.find((t) => t.id === nextView);
    // Trip-context tab requested but no trip available → bounce to LIST (per spec).
    if (tabDef?.needsTrip && !nextSlug && !activeTrip) {
      setHash('list');
      return;
    }
    setHash(nextView, nextSlug || (tabDef?.needsTrip ? activeTrip?.slug : null), nextSub);
  }, [activeTrip]);

  // After hash change resolves to a trip-context tab without slug but we have a fallback,
  // canonicalize the URL so refreshes land on the same trip.
  useEffect(() => {
    const tabDef = TABS.find((t) => t.id === view);
    if (tabDef?.needsTrip && !slug && activeTrip?.slug) {
      setHash(view, activeTrip.slug, sub);
    }
  }, [view, slug, sub, activeTrip]);

  // Auth gate — show inline sign-in prompt if no session.
  if (authReady && !user) {
    return <SignedOutPanel />;
  }
  if (!authReady) {
    return <LoadingPanel label="checking session" />;
  }

  return (
    <div className="tv4" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <TabBar
        view={view}
        activeTrip={activeTrip}
        onSelect={(id) => nav(id, activeTrip?.slug)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* One scroll area for every tab; padding keeps pixel rings + drops unclipped. */}
      <div className="tv-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {view === 'map' && (
          <TvMap trips={trips} onOpenTrip={(t) => nav('folder', t.slug)} onRefreshTrips={refreshTrips} />
        )}
        {view === 'list' && (
          <TvList
            trips={trips}
            loading={loadingTrips}
            error={tripsError}
            onOpenTrip={(t) => nav('folder', t.slug)}
            onRefresh={refreshTrips}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
        {view === 'folder' && (
          <TvFolder
            trip={activeTrip}
            sub={sub}
            onSubChange={(s) => nav('folder', activeTrip?.slug, s)}
            onTripUpdate={refreshTrips}
            onGotoPlan={() => nav('plan', activeTrip?.slug)}
            onGotoExpenses={() => nav('expenses', activeTrip?.slug)}
            onTripDeleted={async () => {
              await refreshTrips();
              nav('list');
            }}
          />
        )}
        {view === 'plan' && (
          <TvPlan trip={activeTrip} onTripUpdate={refreshTrips} />
        )}
        {view === 'expenses' && (
          <TvExpenses trip={activeTrip} />
        )}
      </div>

      {showSettings && (
        <TvSettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// Pixel segmented tabs (01 MAP … 05 EXPENSES) + active trip chip + settings.
function TabBar({ view, activeTrip, onSelect, onOpenSettings }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px',
      padding: '4px 4px 18px', marginBottom: 14, borderBottom: '3px dashed var(--rule)', flexShrink: 0,
    }}>
      <nav aria-label="Travel views" style={{ flex: '1 1 auto', minWidth: 0, overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 14, padding: '4px 4px 6px', width: 'max-content' }}>
          {TABS.map(({ id, label, num, needsTrip }) => {
            const on = view === id;
            const disabled = needsTrip && !activeTrip;
            return (
              <button
                key={id}
                type="button"
                onClick={() => !disabled && onSelect(id)}
                disabled={disabled}
                aria-pressed={on}
                aria-current={on ? 'page' : undefined}
                className="chip-px sk"
                title={disabled ? 'Select a trip first' : ''}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 14px', fontSize: 12 }}
              >
                <span className="tv-tn">{num}</span>{label}
              </button>
            );
          })}
        </div>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 'auto', padding: '0 8px 6px 4px', minWidth: 0 }}>
        {activeTrip && (
          <span title="Active trip" style={{
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
            fontSize: 12, color: COLORS.muted,
          }}>
            <Swatch fill={statusFill(activeTrip.status)} size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
              <span style={{ color: COLORS.text, fontWeight: 700 }}>{activeTrip.title}</span> · {activeTrip.country || '—'}
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className="sk sbtn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0,
            height: 44, padding: '0 14px', fontSize: 12, color: COLORS.text, background: COLORS.paper,
          }}
        >
          <IconGear size={18} />SETTINGS
        </button>
      </div>
    </div>
  );
}

function SignedOutPanel() {
  return (
    <div className="tv4" style={{ display: 'flex', justifyContent: 'center', padding: '36px 12px 48px' }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <DialogBox speaker="SE77N · TRAVEL">
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="pxs" style={{
              display: 'grid', placeItems: 'center', flexShrink: 0, width: 64, height: 64, background: '#9fd8ff',
            }}>
              <PixelFlag size={30} fill="#ffd25e" />
            </span>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted }}>PLAYER 1 · PRESS START</p>
              <h2 className="pf" style={{ margin: 0, fontSize: 26, lineHeight: 1.1 }}>Sign in to use Travel</h2>
              <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.6, color: COLORS.muted }}>
                Your trips, plans, and expenses sync to MongoDB.
                Sign in from the top-right of the app.
              </p>
              <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 0', fontSize: 11 }}>
                <PixelCoin size={16} spin /> INSERT COIN TO CONTINUE
              </p>
            </div>
          </div>
        </DialogBox>
      </div>
    </div>
  );
}

function LoadingPanel({ label }) {
  return (
    <div className="tv4" style={{ padding: '28px 12px' }}>
      <Loading label={label} />
    </div>
  );
}

export default TravelV4;
