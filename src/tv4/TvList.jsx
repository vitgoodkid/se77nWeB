// 02 LIST · all trips. Filter rail + stat row + trip grid with mini-map SVG covers.
// No photo features (replaced PHOTOS stat → COUNTRIES, cover image → mini-map).
import { useState, useMemo, useCallback } from 'react';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';

const REGIONS = ['SEA', 'NEA', 'EU', 'NA', 'OCEANIA', 'SA', 'AF', 'ME', 'OTHER'];
const STATUSES = [
  { id: 'all',     label: 'ALL',      color: COLORS.text },
  { id: 'ongoing', label: 'ONGOING',  color: COLORS.gold },
  { id: 'visited', label: 'VISITED',  color: COLORS.green },
  { id: 'planned', label: 'PLANNED',  color: COLORS.red },
];
const PLAN_STAGES = ['drafting', 'booked', 'locked'];
const SORTS = [
  { id: 'newest',  label: 'Newest' },
  { id: 'oldest',  label: 'Oldest' },
  { id: 'longest', label: 'Longest' },
  { id: 'az',      label: 'A→Z' },
];

// Region accent gradients for mini-map covers.
const REGION_GRADIENTS = {
  SEA:     ['#5BA868', '#D4A858'],
  NEA:     ['#E04545', '#D4A858'],
  EU:      ['#7e8cb8', '#5BA868'],
  NA:      ['#D4A858', '#E04545'],
  OCEANIA: ['#5BA8A8', '#5BA868'],
  SA:      ['#E0A858', '#E04545'],
  AF:      ['#D49058', '#E04545'],
  ME:      ['#C8A858', '#7e6850'],
  OTHER:   ['#7e6850', '#15110d'],
};

function statusColor(s) {
  if (s === 'visited') return COLORS.green;
  if (s === 'ongoing') return COLORS.gold;
  if (s === 'planned') return COLORS.red;
  return COLORS.muted;
}

function tripDays(trip) {
  if (!trip.startDate || !trip.endDate) return null;
  const s = new Date(trip.startDate), e = new Date(trip.endDate);
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return null;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function tripYear(trip) {
  if (!trip.startDate) return null;
  return trip.startDate.slice(0, 4);
}

export default function TvList({ trips, loading, error, onOpenTrip, onRefresh }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRegion, setFilterRegion] = useState(null);
  const [filterYear, setFilterYear] = useState(null);
  const [filterTag, setFilterTag] = useState(null);
  const [filterStage, setFilterStage] = useState(null);
  const [sort, setSort] = useState('newest');
  const [viewMode, setViewMode] = useState('grid');
  const [showNew, setShowNew] = useState(false);

  // Pre-compute counts per filter axis. All counts respect the *other* axes
  // so the rail reflects what each click would actually show.
  const filtered = useMemo(() => {
    return trips.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterRegion && t.region !== filterRegion) return false;
      if (filterYear && tripYear(t) !== filterYear) return false;
      if (filterTag && !(t.tags || []).includes(filterTag)) return false;
      if (filterStage && t.planStage !== filterStage) return false;
      return true;
    });
  }, [trips, filterStatus, filterRegion, filterYear, filterTag, filterStage]);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    switch (sort) {
      case 'newest':  arr.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')); break;
      case 'oldest':  arr.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')); break;
      case 'longest': arr.sort((a, b) => (tripDays(b) || 0) - (tripDays(a) || 0)); break;
      case 'az':      arr.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
    }
    return arr;
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const homes = trips.filter((t) => t.status === 'visited' && t.tags?.includes('home')).length;
    return {
      home:      trips.filter((t) => t.tags?.includes('home')).length || homes,
      visited:   trips.filter((t) => t.status === 'visited').length,
      planned:   trips.filter((t) => t.status === 'planned').length,
      countries: new Set(trips.map((t) => t.country).filter(Boolean)).size,
      ongoing:   trips.filter((t) => t.status === 'ongoing').length,
      totalDays: trips.reduce((s, t) => s + (tripDays(t) || 0), 0),
    };
  }, [trips]);

  const filterCounts = useMemo(() => {
    const c = { status: {}, region: {}, year: {}, tag: {}, stage: {} };
    for (const t of trips) {
      c.status[t.status] = (c.status[t.status] || 0) + 1;
      if (t.region)    c.region[t.region] = (c.region[t.region] || 0) + 1;
      const y = tripYear(t); if (y) c.year[y] = (c.year[y] || 0) + 1;
      for (const tag of t.tags || []) c.tag[tag] = (c.tag[tag] || 0) + 1;
      if (t.planStage) c.stage[t.planStage] = (c.stage[t.planStage] || 0) + 1;
    }
    return c;
  }, [trips]);

  const allTags = useMemo(() => Object.keys(filterCounts.tag).sort(), [filterCounts]);
  const allYears = useMemo(() => Object.keys(filterCounts.year).sort().reverse(), [filterCounts]);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr', gap: 18,
      padding: isMobile ? 12 : 18, height: '100%', overflow: 'auto',
    }}>
      <FilterRail
        trips={trips}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        filterRegion={filterRegion} setFilterRegion={setFilterRegion}
        filterYear={filterYear} setFilterYear={setFilterYear}
        filterTag={filterTag} setFilterTag={setFilterTag}
        filterStage={filterStage} setFilterStage={setFilterStage}
        allTags={allTags} allYears={allYears}
        filterCounts={filterCounts}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div style={{
            padding: 12, borderRadius: 10,
            background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
            color: COLORS.red, fontSize: 12,
          }}>
            ◇ load error: {error} ·
            <button onClick={onRefresh} style={{
              marginLeft: 8, background: 'transparent', border: 'none',
              color: COLORS.red, cursor: 'pointer', textDecoration: 'underline',
            }}>retry</button>
          </div>
        )}

        <StatRow stats={stats} />

        <InsightsStrip stats={stats} trips={trips} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SortDropdown value={sort} onChange={setSort} />
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn onClick={() => setShowNew(true)} variant="tinted" color={COLORS.gold}>
              + NEW TRIP
            </Btn>
          </div>
        </div>

        {loading && !trips.length ? (
          <LoadingTiles />
        ) : sorted.length === 0 ? (
          <EmptyState hasTrips={trips.length > 0} onNew={() => setShowNew(true)} />
        ) : viewMode === 'grid' ? (
          <TripGrid trips={sorted} onOpen={onOpenTrip} onNew={() => setShowNew(true)} />
        ) : (
          <TripCompactList trips={sorted} onOpen={onOpenTrip} />
        )}
      </div>

      {showNew && (
        <NewTripModal
          onClose={() => setShowNew(false)}
          onCreated={async (newTrip) => {
            setShowNew(false);
            await onRefresh();
            onOpenTrip(newTrip);
          }}
        />
      )}
    </div>
  );
}

// ─── Filter rail ─────────────────────────────────────────────────
function FilterRail({
  trips,
  filterStatus, setFilterStatus,
  filterRegion, setFilterRegion,
  filterYear, setFilterYear,
  filterTag, setFilterTag,
  filterStage, setFilterStage,
  allTags, allYears, filterCounts,
}) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <aside style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14,
      padding: 18, alignSelf: 'start',
      position: isMobile ? 'static' : 'sticky', top: 0,
    }}>
      <FilterGroup label="STATUS" count={STATUSES.length - 1}>
        {STATUSES.map((s) => (
          <FilterRow
            key={s.id}
            on={filterStatus === s.id}
            onClick={() => setFilterStatus(s.id)}
            count={s.id === 'all' ? trips.length : (filterCounts.status[s.id] || 0)}
            dot={s.color}
            label={s.label}
          />
        ))}
      </FilterGroup>

      {filterStatus === 'planned' && (
        <FilterGroup label="PLAN STAGE" count={PLAN_STAGES.length}>
          <FilterRow on={!filterStage} onClick={() => setFilterStage(null)} label="ANY" count={filterCounts.status.planned || 0} />
          {PLAN_STAGES.map((s) => (
            <FilterRow
              key={s}
              on={filterStage === s}
              onClick={() => setFilterStage(s)}
              count={filterCounts.stage[s] || 0}
              label={s.toUpperCase()}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup label="REGION" count={Object.keys(filterCounts.region).length}>
        <FilterRow on={!filterRegion} onClick={() => setFilterRegion(null)} label="ANY" count={trips.length} />
        {REGIONS.filter((r) => filterCounts.region[r]).map((r) => (
          <FilterRow
            key={r}
            on={filterRegion === r}
            onClick={() => setFilterRegion(r)}
            count={filterCounts.region[r]}
            label={r}
          />
        ))}
      </FilterGroup>

      {allYears.length > 0 && (
        <FilterGroup label="YEAR" count={allYears.length}>
          <FilterRow on={!filterYear} onClick={() => setFilterYear(null)} label="ANY" count={trips.length} />
          {allYears.map((y) => (
            <FilterRow
              key={y}
              on={filterYear === y}
              onClick={() => setFilterYear(y)}
              count={filterCounts.year[y]}
              label={y}
            />
          ))}
        </FilterGroup>
      )}

      {allTags.length > 0 && (
        <FilterGroup label="TAG" count={allTags.length}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {filterTag && (
              <TagChip label="× clear" on onClick={() => setFilterTag(null)} />
            )}
            {allTags.map((t) => (
              <TagChip
                key={t}
                label={t}
                on={filterTag === t}
                onClick={() => setFilterTag(t === filterTag ? null : t)}
              />
            ))}
          </div>
        </FilterGroup>
      )}
    </aside>
  );
}

function FilterGroup({ label, count, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, color: COLORS.muted,
      }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.22em' }}>{label}</span>
        <span className="mono" style={{ fontSize: 10, color: 'rgba(245,237,224,0.28)' }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function FilterRow({ on, onClick, label, count, dot }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '7px 10px', borderRadius: 8,
        border: '1px solid ' + (on ? COLORS.line : 'transparent'),
        background: on ? 'rgba(245,237,224,0.03)' : 'transparent',
        color: on ? COLORS.text : COLORS.muted,
        fontSize: 12, cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: 'inline-block' }} />}
        {label}
      </span>
      <span className="mono" style={{ fontSize: 10, color: 'rgba(245,237,224,0.28)' }}>{count}</span>
    </button>
  );
}

function TagChip({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: '4px 10px', borderRadius: 999,
        background: on ? COLORS.gold + '1a' : 'transparent',
        border: '1px solid ' + (on ? COLORS.gold + '60' : COLORS.line),
        color: on ? COLORS.gold : COLORS.muted,
        fontSize: 10, letterSpacing: '0.16em', cursor: 'pointer',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  );
}

// ─── Stat row ────────────────────────────────────────────────────
function StatRow({ stats }) {
  const tiles = [
    { label: 'HOME',      n: stats.home,      c: COLORS.gold },
    { label: 'VISITED',   n: stats.visited,   c: COLORS.green },
    { label: 'PLANNED',   n: stats.planned,   c: COLORS.red },
    { label: 'COUNTRIES', n: stats.countries, c: COLORS.text },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{
          padding: 14, borderRadius: 10,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted }}>
            {t.label}
          </div>
          <div className="mono" style={{
            fontSize: 26, fontWeight: 700, marginTop: 6, color: t.c, letterSpacing: '-0.01em',
          }}>
            {t.n}
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsStrip({ stats, trips }) {
  const insights = useMemo(() => {
    const items = [];
    if (stats.countries) items.push({ k: 'countries', v: stats.countries, label: 'countries' });
    if (stats.totalDays) items.push({ k: 'days', v: stats.totalDays, label: 'days on the road' });
    if (stats.ongoing)   items.push({ k: 'ongoing', v: stats.ongoing, label: 'in progress' });
    // best year = max trips in one calendar year
    const byYear = {};
    for (const t of trips) {
      const y = tripYear(t);
      if (y) byYear[y] = (byYear[y] || 0) + 1;
    }
    const bestY = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0];
    if (bestY) items.push({ k: 'best', v: bestY[0], label: `${bestY[1]} trips · best year` });
    return items;
  }, [stats, trips]);

  if (!insights.length) return null;

  return (
    <div style={{
      display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4,
    }}>
      {insights.map((i) => (
        <div key={i.k} style={{
          flex: '0 0 auto', padding: '10px 14px', borderRadius: 10,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120,
        }}>
          <div className="mono" style={{
            fontSize: 18, fontWeight: 700, color: COLORS.text, letterSpacing: '-0.01em',
          }}>{i.v}</div>
          <div className="mono" style={{
            fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted, textTransform: 'uppercase',
          }}>{i.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Sort + view ────────────────────────────────────────────────
function SortDropdown({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mono"
      style={{
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 8, padding: '6px 10px',
        color: COLORS.text, fontSize: 11, letterSpacing: '0.1em',
        cursor: 'pointer',
      }}
    >
      {SORTS.map((s) => (
        <option key={s.id} value={s.id}>SORT · {s.label}</option>
      ))}
    </select>
  );
}

function ViewToggle({ value, onChange }) {
  const opts = [
    { id: 'grid', label: '▦' },
    { id: 'list', label: '☰' },
  ];
  return (
    <div style={{
      display: 'inline-flex', border: '1px solid ' + COLORS.line, borderRadius: 8,
      overflow: 'hidden',
    }}>
      {opts.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.id}
            style={{
              padding: '6px 12px',
              background: on ? 'rgba(245,237,224,0.06)' : 'transparent',
              border: 'none', cursor: 'pointer',
              color: on ? COLORS.text : COLORS.muted, fontSize: 14,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Trip cards ─────────────────────────────────────────────────
function TripGrid({ trips, onOpen, onNew }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
      gap: 14,
    }}>
      {trips.map((t) => <TripCard key={t._id} trip={t} onClick={() => onOpen(t)} />)}
      <button
        onClick={onNew}
        style={{
          background: 'transparent', cursor: 'pointer',
          border: `1px dashed ${COLORS.gold}66`, borderRadius: 12,
          minHeight: 240, color: COLORS.gold,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        <div className="mono" style={{ fontSize: 32, lineHeight: 1 }}>+</div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em' }}>NEW TRIP</div>
      </button>
    </div>
  );
}

function TripCompactList({ trips, onOpen }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {trips.map((t) => (
        <button
          key={t._id}
          onClick={() => onOpen(t)}
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 1fr auto',
            gap: 14, alignItems: 'center', textAlign: 'left',
            padding: 10, borderRadius: 10, cursor: 'pointer',
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            color: COLORS.text,
          }}
        >
          <div style={{ borderRadius: 6, overflow: 'hidden' }}>
            <MiniMapSvg trip={t} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</div>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
              {t.startDate || '—'} · {tripDays(t) || '—'}d · {t.country || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <StatusPill status={t.status} stage={t.planStage} />
          </div>
        </button>
      ))}
    </div>
  );
}

function TripCard({ trip, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer',
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', color: COLORS.text,
        padding: 0,
      }}
    >
      <MiniMapSvg trip={trip} />
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{trip.title}</div>
        <div className="mono" style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
          {trip.startDate || '—'} · {tripDays(trip) || '—'} days · {trip.country || '—'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <StatusPill status={trip.status} stage={trip.planStage} />
          {trip.tags?.slice(0, 2).map((tg) => (
            <span
              key={tg}
              className="mono"
              style={{
                fontSize: 10, letterSpacing: '0.16em', padding: '3px 8px',
                borderRadius: 999, border: '1px solid ' + COLORS.line,
                color: COLORS.muted, textTransform: 'uppercase',
              }}
            >{tg}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

function StatusPill({ status, stage }) {
  const c = statusColor(status);
  const label = stage ? `${status} · ${stage}` : status || '—';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, letterSpacing: '0.12em', padding: '3px 9px',
        borderRadius: 999, border: `1px solid ${c}60`, color: c,
        textTransform: 'uppercase',
        background: c + '18',
      }}
    >{label}</span>
  );
}

// Deterministic mini-map cover. Uses regional gradient + country code text.
// When the trip has pins, render them positioned via lat/lng range mapped to viewBox.
// For now (pin data not yet on the trip doc), draws a single decorative pin at center.
function MiniMapSvg({ trip }) {
  const region = trip.region || 'OTHER';
  const [c1, c2] = REGION_GRADIENTS[region] || REGION_GRADIENTS.OTHER;
  const gradId = `tg-${trip._id}`;
  const dotId = `td-${trip._id}`;
  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', aspectRatio: '16/9' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor={c1} stopOpacity="0.55" />
          <stop offset="100%" stopColor={c2} stopOpacity="0.25" />
        </linearGradient>
        <pattern id={dotId} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.7" fill="rgba(245,237,224,0.22)" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="320" height="180" fill="#15110d" />
      <rect x="0" y="0" width="320" height="180" fill={`url(#${gradId})`} />
      <rect x="0" y="0" width="320" height="180" fill={`url(#${dotId})`} />
      <circle cx="160" cy="90" r="5" fill={statusColor(trip.status)} />
      <circle cx="160" cy="90" r="10" fill="none" stroke={statusColor(trip.status)} strokeOpacity="0.4" strokeWidth="1" />
      <text
        x="304" y="170" textAnchor="end"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="11" letterSpacing="4" fill="rgba(245,237,224,0.3)"
      >{(trip.country || '').toUpperCase().slice(0, 3)}</text>
    </svg>
  );
}

// ─── Empty / loading ────────────────────────────────────────────
function EmptyState({ hasTrips, onNew }) {
  return (
    <div style={{
      padding: 48, textAlign: 'center',
      border: '1px dashed ' + COLORS.line, borderRadius: 14,
      color: COLORS.muted,
    }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: COLORS.gold }}>
        {hasTrips ? '◇ NO MATCHES' : '◇ EMPTY ARCHIVE'}
      </div>
      <div style={{ marginTop: 10, fontSize: 14, color: COLORS.text }}>
        {hasTrips ? 'No trips match the current filters.' : 'You have no trips yet.'}
      </div>
      {!hasTrips && (
        <div style={{ marginTop: 14 }}>
          <Btn onClick={onNew} variant="tinted" color={COLORS.gold}>+ CREATE FIRST TRIP</Btn>
        </div>
      )}
    </div>
  );
}

function LoadingTiles() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
      gap: 14,
    }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 12, height: 240,
          opacity: 0.6 - i * 0.08,
        }} />
      ))}
    </div>
  );
}

// ─── New trip modal ─────────────────────────────────────────────
function NewTripModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('planned');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('NEA');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tripCurrency, setTripCurrency] = useState('JPY');
  const [tags, setTags] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load available templates (silent fail — feature optional).
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { docs } = await tv4.list('templates');
        if (!cancel) setTemplates(docs || []);
      } catch (e) {
        // ignore
      }
    })();
    return () => { cancel = true; };
  }, []);

  const onSubmit = useCallback(async (e) => {
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
        endDate:   endDate   || undefined,
        tripCurrency: tripCurrency || undefined,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const { doc } = await tv4.create('trips', body);

      // Apply template if selected — copy pins, plan_items, checklist to the new trip.
      if (templateId) {
        const template = templates.find((t) => t._id === templateId);
        if (template) {
          await applyTemplate(doc._id, template);
        }
      }
      onCreated(doc);
    } catch (err) {
      setError(err.message || 'create_failed');
      setSubmitting(false);
    }
  }, [title, status, country, region, startDate, endDate, tripCurrency, tags, templateId, templates, onCreated]);

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 14, padding: 24, width: 480, color: COLORS.text,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>NEW</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Plan a trip</div>
        </div>

        <Row label="Title">
          <Field value={title} onChange={setTitle} placeholder="Tokyo · Akiba nights" autoFocus />
        </Row>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Row label="Status">
            <Select value={status} onChange={setStatus} options={[
              { v: 'planned',  l: 'planned'  },
              { v: 'ongoing',  l: 'ongoing'  },
              { v: 'visited',  l: 'visited'  },
            ]} />
          </Row>
          <Row label="Region">
            <Select value={region} onChange={setRegion} options={REGIONS.map((r) => ({ v: r, l: r }))} />
          </Row>
        </div>

        <Row label="Country (ISO 2 or full name)">
          <Field value={country} onChange={setCountry} placeholder="JP" />
        </Row>

        {templates.length > 0 && (
          <Row label="Start from template (optional)">
            <Select
              value={templateId}
              onChange={setTemplateId}
              options={[{ v: '', l: '— none —' }, ...templates.map((t) => ({ v: t._id, l: t.name }))]}
            />
          </Row>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Row label="Start">
            <Field type="date" value={startDate} onChange={setStartDate} />
          </Row>
          <Row label="End">
            <Field type="date" value={endDate} onChange={setEndDate} />
          </Row>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Row label="Trip currency">
            <Field value={tripCurrency} onChange={setTripCurrency} placeholder="JPY" />
          </Row>
          <Row label="Tags (comma-sep)">
            <Field value={tags} onChange={setTags} placeholder="solo, food" />
          </Row>
        </div>

        {error && (
          <div style={{
            padding: 10, borderRadius: 8,
            background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
            color: COLORS.red, fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Btn onClick={onClose} type="button">Cancel</Btn>
          <div style={{ marginLeft: 'auto' }}>
            <Btn type="submit" variant="solid" color={COLORS.gold} disabled={submitting}>
              {submitting ? '...' : 'Create trip'}
            </Btn>
          </div>
        </div>
      </form>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

async function applyTemplate(newTripId, template) {
  const seed = async (collection, items) => {
    for (const it of items || []) {
      await tv4.create(collection, { ...it, tripId: newTripId });
    }
  };
  // Sequential to avoid hitting Mongo pool too hard; small N typical.
  await seed('pins',       template.pins);
  await seed('plan-items', template.planItems);
  await seed('checklist',  template.checklist);
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mono"
      style={{
        background: COLORS.bg, border: '1px solid ' + COLORS.line,
        borderRadius: 10, padding: '11px 14px',
        color: COLORS.text, fontSize: 13,
      }}
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
