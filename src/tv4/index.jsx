// se77n Travel v0.4 — module 09 entry point.
// Manages internal sub-routing #/tv4/<view>[/<slug>] and trip context state.
// Per-tab views live in sibling files (TvList, TvFolder, TvMap, TvPlan, TvExpenses, TvSettings).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, useAuth } from '../lib.jsx';
import { tv4 } from './api.js';
import TvMap from './TvMap.jsx';
import TvList from './TvList.jsx';
import TvFolder from './TvFolder.jsx';
import TvPlan from './TvPlan.jsx';
import TvExpenses from './TvExpenses.jsx';
import TvSettings from './TvSettings.jsx';

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
    return <LoadingPanel label="◇ checking session…" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <TabBar
        view={view}
        activeTrip={activeTrip}
        onSelect={(id) => nav(id, activeTrip?.slug)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {view === 'map' && (
          <TvMap trips={trips} onOpenTrip={(t) => nav('folder', t.slug)} />
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

function TabBar({ view, activeTrip, onSelect, onOpenSettings }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '10px 16px',
      borderBottom: '1px solid ' + COLORS.line, flexShrink: 0,
    }}>
      {TABS.map(({ id, label, num, needsTrip }) => {
        const on = view === id;
        const disabled = needsTrip && !activeTrip;
        return (
          <button
            key={id}
            onClick={() => !disabled && onSelect(id)}
            disabled={disabled}
            className="mono"
            title={disabled ? 'Select a trip first' : ''}
            style={{
              padding: '6px 13px', borderRadius: 999,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 10, letterSpacing: '0.18em',
              background: on ? COLORS.gold + '1f' : 'transparent',
              border: `1px solid ${on ? COLORS.gold + '80' : COLORS.line}`,
              color: on ? COLORS.gold : disabled ? COLORS.dim || 'rgba(245,237,224,0.28)' : COLORS.muted,
              display: 'flex', alignItems: 'center', gap: 7,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <span style={{ opacity: 0.55 }}>{num}</span>{label}
          </button>
        );
      })}

      {activeTrip && (
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: COLORS.muted, fontFamily: 'JetBrains Mono, monospace',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 999,
            background: statusColor(activeTrip.status), flexShrink: 0,
          }} />
          {activeTrip.title} · {activeTrip.country || '—'}
        </div>
      )}

      <button
        onClick={onOpenSettings}
        title="Settings"
        style={{
          marginLeft: activeTrip ? 12 : 'auto',
          width: 28, height: 28, borderRadius: 999,
          background: 'transparent', border: '1px solid ' + COLORS.line,
          color: COLORS.muted, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}
      >
        ⚙
      </button>
    </div>
  );
}

function statusColor(status) {
  if (status === 'visited') return COLORS.green;
  if (status === 'ongoing') return COLORS.gold;
  if (status === 'planned') return COLORS.red;
  return COLORS.muted;
}

function SignedOutPanel() {
  return (
    <div style={{
      padding: 64, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 16, color: COLORS.muted,
    }}>
      <div className="mono" style={{
        fontSize: 11, letterSpacing: '0.22em', color: COLORS.gold,
      }}>SE77N · TRAVEL</div>
      <div style={{ fontSize: 18, color: COLORS.text, fontWeight: 700 }}>
        Sign in to use Travel
      </div>
      <div style={{ fontSize: 13, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        Your trips, plans, and expenses sync to MongoDB.
        Sign in from the top-right of the app.
      </div>
    </div>
  );
}

function LoadingPanel({ label }) {
  return (
    <div className="mono" style={{ padding: 40, color: COLORS.muted, fontSize: 12 }}>
      {label}
    </div>
  );
}

export default TravelV4;
