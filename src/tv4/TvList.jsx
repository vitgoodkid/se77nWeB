// 02 LIST · all trips. Filter rail + stat strip + stage-card grid with pixel mini-map covers.
// No photo features (replaced PHOTOS stat → COUNTRIES, cover image → mini-map).
import { useState, useMemo, useCallback, useEffect } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import {
  GOLD, ON, REGION_FILL, STATUS_INK, statusFill,
  CartHead, Empty, ErrorNote, FormRow, IconRows, IconTiles, Label, Loading, PixelFlag,
  PxDialog, PxSelect, Seg, Tag, fieldStyle,
} from './kit.jsx';

const REGIONS = ['SEA', 'NEA', 'EU', 'NA', 'OCEANIA', 'SA', 'AF', 'ME', 'OTHER'];
const STATUSES = [
  { id: 'all',     label: 'ALL',      color: 'var(--text)' },
  { id: 'ongoing', label: 'ONGOING',  color: statusFill('ongoing') },
  { id: 'visited', label: 'VISITED',  color: statusFill('visited') },
  { id: 'planned', label: 'PLANNED',  color: statusFill('planned') },
];
const PLAN_STAGES = ['drafting', 'booked', 'locked'];
const SORTS = [
  { id: 'newest',  label: 'Newest' },
  { id: 'oldest',  label: 'Oldest' },
  { id: 'longest', label: 'Longest' },
  { id: 'az',      label: 'A→Z' },
];

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
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32, padding: '6px 6px 12px' }}>
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

      <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {error && (
          <ErrorNote>
            load error: {error} ·
            <button type="button" onClick={onRefresh} className="sk" style={{
              marginLeft: 8, padding: '4px 8px', fontSize: 11, color: '#fffaf0', background: '#1b1410',
              border: 0, cursor: 'pointer',
            }}>RETRY</button>
          </ErrorNote>
        )}

        <StatRow stats={stats} />

        <InsightsStrip stats={stats} trips={trips} />

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18, padding: '0 8px 0 3px' }}>
          <SortDropdown value={sort} onChange={setSort} />
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <Label>TRIPS · {sorted.length}</Label>
          <div style={{ marginLeft: 'auto', padding: '6px 0 8px' }}>
            <PxButton kind="big" fill={GOLD} onClick={() => setShowNew(true)} style={{ minHeight: 46, fontSize: 13 }}>
              + NEW TRIP
            </PxButton>
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
  return (
    <aside className="px" aria-labelledby="tv-filter-h" style={{
      flex: '1 1 260px', minWidth: 0, background: COLORS.paper,
    }}>
      <CartHead id="tv-filter-h" title="02 LIST · FILTERS" right={`${trips.length} TRIPS`} />
      <div style={{ padding: '18px 18px 6px' }}>
        <FilterGroup label="STATUS" count={STATUSES.length - 1}>
          <ChipWrap>
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
          </ChipWrap>
        </FilterGroup>

        {filterStatus === 'planned' && (
          <FilterGroup label="PLAN STAGE" count={PLAN_STAGES.length}>
            <ChipWrap>
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
            </ChipWrap>
          </FilterGroup>
        )}

        <FilterGroup label="REGION" count={Object.keys(filterCounts.region).length}>
          <ChipWrap>
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
          </ChipWrap>
        </FilterGroup>

        {allYears.length > 0 && (
          <FilterGroup label="YEAR" count={allYears.length}>
            <ChipWrap>
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
            </ChipWrap>
          </FilterGroup>
        )}

        {allTags.length > 0 && (
          <FilterGroup label="TAG" count={allTags.length}>
            <ChipWrap>
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
            </ChipWrap>
          </FilterGroup>
        )}
      </div>
    </aside>
  );
}

function ChipWrap({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 3 }}>{children}</div>;
}

function FilterGroup({ label, count, children }) {
  return (
    <div role="group" aria-label={label} style={{ marginBottom: 22 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        <Label style={{ fontSize: 10, color: COLORS.text }}>{label}</Label>
        <Label style={{ fontSize: 10 }}>{count}</Label>
      </div>
      {children}
    </div>
  );
}

function FilterRow({ on, onClick, label, count, dot }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!on}
      className="chip-px sk"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        minHeight: 36, padding: '0 10px', fontSize: 11, textAlign: 'left',
      }}
    >
      {dot && <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, background: dot, boxShadow: '0 0 0 2px var(--paper)' }} />}
      <span>{label}</span>
      <span className="tv-tn" style={{ marginLeft: 'auto', paddingLeft: 4 }}>{count}</span>
    </button>
  );
}

function TagChip({ label, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!on}
      className="chip-px sk"
      style={{ minHeight: 32, padding: '0 10px', fontSize: 10, textTransform: 'uppercase' }}
    >
      {label}
    </button>
  );
}

// ─── Stat strip ──────────────────────────────────────────────────
function StatRow({ stats }) {
  const tiles = [
    { label: 'HOME',      n: stats.home,      c: STATUS_INK.ongoing },
    { label: 'VISITED',   n: stats.visited,   c: STATUS_INK.visited },
    { label: 'PLANNED',   n: stats.planned,   c: STATUS_INK.planned },
    { label: 'COUNTRIES', n: stats.countries, c: COLORS.text },
  ];
  return (
    <div className="px tv-hud4" style={{ background: COLORS.paper }}>
      {tiles.map((t, i) => (
        <div key={t.label} className="sk" style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', minWidth: 0,
          borderLeft: i ? '3px dashed var(--rule)' : 'none',
        }}>
          <span style={{ fontSize: 11, color: COLORS.muted }}>{t.label}</span>
          <span className="pf" style={{ fontSize: 30, lineHeight: 1, color: t.c }}>{t.n}</span>
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
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', padding: '4px 4px 8px' }}>
      {insights.map((i) => (
        <div key={i.k} className="pxs" style={{
          flex: '0 0 auto', padding: '10px 14px', minWidth: 130, background: COLORS.panel2,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span className="pf" style={{ fontSize: 20, lineHeight: 1 }}>{i.v}</span>
          <span className="sk" style={{ fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>{i.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Sort + view ────────────────────────────────────────────────
function SortDropdown({ value, onChange }) {
  return (
    <PxSelect
      value={value}
      onChange={onChange}
      ariaLabel="Sort trips"
      options={SORTS.map((s) => ({ v: s.id, l: `SORT · ${s.label}` }))}
      style={{ width: 190, height: 42, marginLeft: 3 }}
    />
  );
}

function ViewToggle({ value, onChange }) {
  const opts = [
    { id: 'grid', icon: <IconTiles size={16} />, aria: 'Tiles', title: 'grid' },
    { id: 'list', icon: <IconRows size={16} />, aria: 'Rows', title: 'list' },
  ];
  return <Seg options={opts} value={value} onChange={onChange} ariaLabel="List layout" height={42} />;
}

// ─── Trip cards ─────────────────────────────────────────────────
const stageNo = (i) => 'STAGE ' + String(i + 1).padStart(2, '0');

function TripGrid({ trips, onOpen, onNew }) {
  return (
    <div className="tv-g3" style={{ gap: 32, padding: '4px 12px 12px 4px' }}>
      {trips.map((t, i) => <TripCard key={t._id} trip={t} index={i} onClick={() => onOpen(t)} />)}
      <button
        type="button"
        onClick={onNew}
        className="tv-add sk"
        style={{
          minHeight: 240, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          fontSize: 12, color: COLORS.text, background: COLORS.field,
          border: '3px dashed #c98a12',
        }}
      >
        <span className="pf" aria-hidden="true" style={{ fontSize: 36, lineHeight: 1 }}>+</span>
        NEW TRIP
      </button>
    </div>
  );
}

function TripCompactList({ trips, onOpen }) {
  return (
    <div className="px" style={{ background: COLORS.paper, padding: '6px 14px' }}>
      {trips.map((t, i) => (
        <button
          key={t._id}
          type="button"
          onClick={() => onOpen(t)}
          className="tv-row"
          style={{
            display: 'flex', alignItems: 'center', gap: 16, width: '100%',
            padding: '12px 6px', textAlign: 'left', color: COLORS.text, background: 'transparent',
            border: 0, borderBottom: i < trips.length - 1 ? '3px dashed var(--rule)' : 0,
          }}
        >
          <MiniMapSvg trip={t} compact />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
            <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>
              {stageNo(i)} · {t.region || 'OTHER'} · {(t.country || '—').toUpperCase()}
            </span>
            <span className="pf" style={{ fontSize: 18, lineHeight: 1.1 }}>{t.title}</span>
            <span style={{ fontSize: 12, color: COLORS.muted }}>
              {t.startDate || '—'} · {tripDays(t) || '—'}d · {t.country || '—'}
            </span>
          </span>
          <span className="tv-hide-sm" style={{ display: 'flex', gap: 6 }}>
            <StatusPill status={t.status} stage={t.planStage} />
          </span>
        </button>
      ))}
    </div>
  );
}

function TripCard({ trip, index, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px tv-card"
      style={{
        textAlign: 'left', background: COLORS.paper, border: 0,
        display: 'flex', flexDirection: 'column', color: COLORS.text, padding: 0, minWidth: 0,
      }}
    >
      <MiniMapSvg trip={trip} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px 16px' }}>
        <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>
          {stageNo(index)} · {trip.region || 'OTHER'}
        </span>
        <span className="pf" style={{ fontSize: 19, lineHeight: 1.15 }}>{trip.title}</span>
        <span style={{ fontSize: 12, color: COLORS.muted }}>
          {trip.startDate || '—'} · {tripDays(trip) || '—'} days · {trip.country || '—'}
        </span>
        <span style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <StatusPill status={trip.status} stage={trip.planStage} />
          {trip.tags?.slice(0, 2).map((tg) => (
            <Tag key={tg} fill="var(--paper)" style={{ color: COLORS.text }}>{tg}</Tag>
          ))}
        </span>
      </span>
    </button>
  );
}

function StatusPill({ status, stage }) {
  const label = stage ? `${status} · ${stage}` : status || '—';
  return <Tag fill={statusFill(status)}>{label}</Tag>;
}

// Deterministic mini-map cover: region-tinted pixel tile with a dot grid, a
// pixel flag in the trip's status colour and the country code.
function MiniMapSvg({ trip, compact }) {
  const region = trip.region || 'OTHER';
  const fill = REGION_FILL[region] || REGION_FILL.OTHER;
  return (
    <span aria-hidden="true" style={{
      position: 'relative', display: 'block', flexShrink: 0,
      width: compact ? 58 : '100%', height: compact ? 58 : 92,
      backgroundColor: fill,
      backgroundImage: 'radial-gradient(rgba(27, 20, 16, 0.28) 1px, transparent 1.4px)',
      backgroundSize: '6px 6px',
      borderBottom: compact ? undefined : '4px solid var(--ink)',
      border: compact ? '3px solid var(--ink)' : undefined,
    }}>
      <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-30%, -60%)' }}>
        <PixelFlag size={compact ? 18 : 26} fill={statusFill(trip.status)} />
      </span>
      <span className="sk" style={{
        position: 'absolute', right: 5, bottom: 3, fontSize: compact ? 9 : 11, color: ON,
      }}>{(trip.country || '').toUpperCase().slice(0, 3)}</span>
      {!compact && (
        <span className="sk" style={{ position: 'absolute', left: 8, top: 6, fontSize: 10, color: ON }}>{region}</span>
      )}
    </span>
  );
}

// ─── Empty / loading ────────────────────────────────────────────
function EmptyState({ hasTrips, onNew }) {
  return (
    <div className="px" style={{ background: COLORS.paper }}>
      <Empty
        title={hasTrips ? 'NO MATCHES' : 'NO SAVE DATA'}
        hint={hasTrips ? 'No trips match the current filters.' : 'You have no trips yet.'}
        action={!hasTrips && (
          <PxButton fill={GOLD} onClick={onNew} style={{ height: 44, marginTop: 4 }}>+ CREATE FIRST TRIP</PxButton>
        )}
        style={{ padding: '40px 18px 44px' }}
      />
    </div>
  );
}

function LoadingTiles() {
  return (
    <div>
      <Loading label="loading trips" style={{ paddingTop: 0 }} />
      <div className="tv-g3" style={{ gap: 32, padding: '4px 12px 12px 4px' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="pxs" style={{
            height: 220, opacity: 0.7 - i * 0.08,
            background: COLORS.panel2,
            backgroundImage: 'linear-gradient(var(--rule) 0 92px, transparent 92px)',
          }} />
        ))}
      </div>
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
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      width={640}
      kicker="NEW · WORLD SAVE SLOT"
      title="Plan a trip"
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" kind="big" fill={GOLD} disabled={submitting} style={{ minHeight: 44, fontSize: 13 }}>
          {submitting ? '...' : 'CREATE TRIP'}
        </PxButton>
      </>}
    >
      <FormRow label="Title">
        <Field value={title} onChange={setTitle} placeholder="Tokyo · Akiba nights" autoFocus style={fieldStyle} />
      </FormRow>

      <div className="tv-g2" style={{ gap: '20px 24px' }}>
        <FormRow label="Status">
          <PxSelect value={status} onChange={setStatus} options={[
            { v: 'planned',  l: 'planned'  },
            { v: 'ongoing',  l: 'ongoing'  },
            { v: 'visited',  l: 'visited'  },
          ]} />
        </FormRow>
        <FormRow label="Region">
          <PxSelect value={region} onChange={setRegion} options={REGIONS.map((r) => ({ v: r, l: r }))} />
        </FormRow>
      </div>

      <FormRow label="Country (ISO 2 or full name)">
        <Field value={country} onChange={setCountry} placeholder="JP" style={fieldStyle} />
      </FormRow>

      {templates.length > 0 && (
        <FormRow label="Start from template (optional)">
          <PxSelect
            value={templateId}
            onChange={setTemplateId}
            options={[{ v: '', l: '— none —' }, ...templates.map((t) => ({ v: t._id, l: t.name }))]}
          />
        </FormRow>
      )}

      <div className="tv-g2" style={{ gap: '20px 24px' }}>
        <FormRow label="Start">
          <Field type="date" value={startDate} onChange={setStartDate} style={fieldStyle} />
        </FormRow>
        <FormRow label="End">
          <Field type="date" value={endDate} onChange={setEndDate} style={fieldStyle} />
        </FormRow>
      </div>

      <div className="tv-g2" style={{ gap: '20px 24px' }}>
        <FormRow label="Trip currency">
          <Field value={tripCurrency} onChange={setTripCurrency} placeholder="JPY" style={fieldStyle} />
        </FormRow>
        <FormRow label="Tags (comma-sep)">
          <Field value={tags} onChange={setTags} placeholder="solo, food" style={fieldStyle} />
        </FormRow>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
    </PxDialog>
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
