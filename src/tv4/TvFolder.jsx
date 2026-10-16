// 03 TRIP FOLDER · OVERVIEW (default) + NOTES (sub-tab). Per-trip view.
// PLAN and EXPENSES are reached via the top-level tab bar — they have their own components.
// Sub-routing param: 'overview' (default) | 'notes'.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { DialogBox, PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import TvNotes from './TvNotes.jsx';
import { createShareLink } from './exports.js';
import {
  GOLD, ON, catFill, statusFill,
  CardTitle, Empty, ErrorNote, Fact, IconDots, Label, Loading, PixelFlag, PxDialog, Seg, Swatch, Tag,
  fieldStyle,
} from './kit.jsx';

const SUB_TABS = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'notes',    label: 'NOTES' },
];

// Default "best of" labels — user can rewrite the labels too but these seed empty trips.
const DEFAULT_BEST_OF = [
  { label: 'Best meal',   value: '' },
  { label: 'Best moment', value: '' },
  { label: 'Biggest spend', value: '' },
];

// Haversine in km — good enough for day-by-day route length.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function tripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return null;
  const s = new Date(trip.startDate), e = new Date(trip.endDate);
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return null;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

export default function TvFolder({ trip, sub, onSubChange, onTripUpdate, onGotoPlan, onGotoExpenses, onTripDeleted }) {
  const subId = SUB_TABS.find((t) => t.id === sub) ? sub : 'overview';
  const [pins, setPins] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareState, setShareState] = useState(null);

  const tripId = trip?._id;

  // Refetch trip-scoped data whenever the trip switches.
  useEffect(() => {
    if (!tripId) { setPins([]); setTransactions([]); setNotes([]); setLoading(false); return; }
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const [p, t, n] = await Promise.all([
          tv4.list('pins',         { tripId }),
          tv4.list('transactions', { tripId }),
          tv4.list('notes',        { tripId }),
        ]);
        if (cancel) return;
        setPins(p.docs || []);
        setTransactions(t.docs || []);
        setNotes(n.docs || []);
      } catch (e) {
        console.warn('folder fetch failed', e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [tripId]);

  const stats = useMemo(() => {
    const days = (trip && tripDays(trip)) || 0;
    let km = 0;
    // Group pins by day to compute total walking distance.
    const byDay = {};
    for (const p of pins) {
      const d = p.dayIndex ?? 0;
      (byDay[d] = byDay[d] || []).push(p);
    }
    for (const arr of Object.values(byDay)) {
      const sorted = arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      for (let i = 1; i < sorted.length; i++) km += haversineKm(sorted[i - 1], sorted[i]);
    }
    const spend = transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return {
      places: pins.length,
      days,
      km: Math.round(km),
      spend,
      notes: notes.length,
    };
  }, [trip, pins, transactions, notes]);

  const expenseByCategory = useMemo(() => {
    const acc = {};
    for (const t of transactions) {
      const c = t.category || 'other';
      acc[c] = (acc[c] || 0) + (Number(t.amount) || 0);
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [transactions]);

  const sumDates = useMemo(() => {
    if (!trip?.startDate || !trip?.endDate) return '—';
    return `${trip.startDate} → ${trip.endDate}`;
  }, [trip]);

  const updateTrip = useCallback(async (patch) => {
    if (!tripId) return;
    try {
      await tv4.update('trips', tripId, patch);
      onTripUpdate?.();
    } catch (e) {
      console.warn('trip update failed', e);
    }
  }, [tripId, onTripUpdate]);

  const deleteTrip = useCallback(async () => {
    if (!tripId) return;
    if (!window.confirm(`Delete "${trip.title}"? All pins, plans, expenses, and notes for this trip will be removed. This cannot be undone.`)) return;
    try {
      await tv4.remove('trips', tripId);
      setMenuOpen(false);
      onTripDeleted?.();
    } catch (e) {
      alert('Delete failed: ' + (e.message || 'unknown'));
    }
  }, [tripId, trip, onTripDeleted]);

  if (!trip) return <EmptyState />;

  return (
    <div style={{ padding: '6px 6px 12px' }}>
      <TopPills trip={trip} sumDates={sumDates} stats={stats} onMenu={() => setMenuOpen((v) => !v)} menuOpen={menuOpen}
        onArchive={() => updateTrip({ archived: !trip.archived })}
        onPromote={() => {
          if (window.confirm('Mark this trip as visited? All plan items become trip facts.')) {
            updateTrip({ status: 'visited' });
          }
        }}
        onDelete={deleteTrip}
      />

      <div style={{ margin: '26px 0 30px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <SubTabs value={subId} onChange={onSubChange} />
        <Label className="tv-hide-sm" style={{ marginLeft: 'auto', fontSize: 10 }}>03 FOLDER · {subId === 'notes' ? 'NOTES' : 'OVERVIEW'}</Label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32 }}>
        <main style={{ flex: '999 1 560px', minWidth: 0 }}>
          {subId === 'overview' && (
            <OverviewBody
              trip={trip}
              pins={pins}
              transactions={transactions}
              notes={notes}
              stats={stats}
              loading={loading}
              onUpdate={updateTrip}
              onOpenNotes={() => onSubChange('notes')}
              onGotoPlan={onGotoPlan}
              onGotoExpenses={onGotoExpenses}
            />
          )}
          {subId === 'notes' && (
            <TvNotes trip={trip} />
          )}
        </main>

        <RightRail
          trip={trip}
          stats={stats}
          expenseByCategory={expenseByCategory}
          onGotoExpenses={onGotoExpenses}
          onGotoPlan={onGotoPlan}
          onShare={async () => {
            setShareState({ loading: true });
            try {
              const r = await createShareLink(trip._id, 30);
              setShareState({ loading: false, url: r.url, expiresAt: r.expiresAt });
            } catch (e) {
              setShareState({ loading: false, error: e.message || 'failed' });
            }
          }}
        />
        {shareState && <ShareModal state={shareState} onClose={() => setShareState(null)} />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px" style={{ background: COLORS.paper, margin: 6 }}>
      <Empty title="NO TRIP CONTEXT" hint="No trip context · open one from LIST" />
    </div>
  );
}

function SubTabs({ value, onChange }) {
  return (
    <Seg
      ariaLabel="Folder section"
      options={SUB_TABS}
      value={value}
      onChange={onChange}
      height={40}
    />
  );
}

// Trip heading: kicker + title + fact chips + trip menu.
function TopPills({ trip, sumDates, stats, onMenu, menuOpen, onArchive, onPromote, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap',
      position: 'relative',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 420px' }}>
        <Label as="p" style={{ margin: '0 0 10px', fontSize: 12 }}>
          TRIP FOLDER · {trip.region || 'OTHER'} · {(trip.country || '—').toUpperCase()}
        </Label>
        <h2 className="pf tv-h2" style={{ margin: 0, fontSize: 36, lineHeight: 1.05 }}>{trip.title}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18, paddingLeft: 3 }}>
          <Tag fill={statusFill(trip.status)} style={{ fontSize: 11, padding: '4px 8px' }}>
            {trip.status}{trip.planStage ? ` · ${trip.planStage}` : ''}
          </Tag>
          {sumDates !== '—' && <Fact>{sumDates}</Fact>}
          {stats.days ? <Fact>{stats.days} days</Fact> : null}
          {trip.country && <Fact>{trip.country}</Fact>}
          {(trip.tags || []).slice(0, 5).map((t) => <Fact key={t}>{t}</Fact>)}
        </div>
      </div>

      <div style={{ position: 'relative', padding: '0 8px 8px 0', marginLeft: 'auto' }}>
        <button
          type="button"
          onClick={onMenu}
          className="sbtn"
          aria-label="Trip menu"
          aria-expanded={menuOpen}
          style={{
            display: 'grid', placeItems: 'center', width: 44, height: 44, padding: 0,
            color: COLORS.text, background: COLORS.paper,
          }}
        ><IconDots /></button>
        {menuOpen && (
          <div role="menu" aria-label="Trip menu" className="pxs" style={{
            position: 'absolute', top: 58, right: 8, zIndex: 50,
            display: 'flex', flexDirection: 'column', minWidth: 230, padding: '6px 0',
            background: COLORS.paper,
          }}>
            <MenuItem label="Promote → visited" onClick={onPromote} />
            <MenuItem label={trip.archived ? 'Unarchive' : 'Archive'} onClick={onArchive} />
            <MenuItem label="Duplicate (todo)" onClick={() => alert('Duplicate — coming with templates task #13')} />
            <MenuItem label="Share read-only (todo)" onClick={() => alert('Share — coming with exports task #12')} />
            <MenuItem label="Print" onClick={() => window.print()} />
            <MenuItem label="Delete trip…" danger onClick={onDelete} />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="tv-mi"
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px 16px', background: 'transparent', border: 'none',
        borderTop: danger ? '3px dashed var(--rule)' : 'none',
        color: danger ? 'var(--tv-red-ink)' : COLORS.text,
        fontWeight: danger ? 700 : 400, fontSize: 13,
      }}
    >{label}</button>
  );
}

// ─── Overview body ───────────────────────────────────────────────
function OverviewBody({ trip, pins, transactions, notes, stats, loading, onUpdate, onOpenNotes, onGotoPlan, onGotoExpenses }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <MiniMap trip={trip} pins={pins} />

      <StatsHero stats={stats} currency={trip.tripCurrency || 'USD'} loading={loading} />

      <div className="tv-g2" style={{ gap: 32, alignItems: 'start' }}>
        <DayTimeline trip={trip} pins={pins} onGotoPlan={onGotoPlan} />
        <BestOfCard
          bestOf={trip.bestOf?.length ? trip.bestOf : DEFAULT_BEST_OF}
          onSave={(next) => onUpdate({ bestOf: next })}
        />
      </div>

      <NotesPreview notes={notes} onOpenNotes={onOpenNotes} />
    </div>
  );
}

// Mini-map: pins on a pixel "sea" panel using lat/lng → SVG coords.
// Falls back to a placeholder flag if no pins yet.
function MiniMap({ trip, pins }) {
  const valid = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return (
    <div className="px" style={{ position: 'relative', background: COLORS.paper, padding: 14 }}>
      <div className="tv-minimap" style={{
        position: 'relative',
        backgroundColor: 'var(--tv-sea)',
        backgroundImage: 'radial-gradient(var(--tv-sea-dot) 1px, transparent 1.4px)',
        backgroundSize: '12px 12px',
        border: '3px solid var(--ink)',
      }}>
        <svg viewBox="0 0 800 350" preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={valid.length ? `Route of ${valid.length} pins` : 'No pins yet'}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          {valid.length > 0 ? <PinLayer pins={valid} /> : (
            <>
              <g transform="translate(391 140) scale(4)" shapeRendering="crispEdges">
                <rect x="0" y="0" width="1" height="7" style={{ fill: 'var(--tv-route)' }} />
                <path d="M1 0h5v1H5v1h1v2H1z" fill={statusFill(trip.status)} strokeWidth="0.3" style={{ stroke: '#1b1410' }} />
              </g>
              <text x="400" y="200" textAnchor="middle" fontFamily="Silkscreen, JetBrains Mono, monospace" fontSize="13"
                fontWeight="700" style={{ fill: 'var(--tv-route)' }}>
                NO PINS YET
              </text>
            </>
          )}
        </svg>

        <div className="sk" style={{
          position: 'absolute', top: 10, left: 10, padding: '5px 9px', fontSize: 11,
          color: '#fffaf0', background: 'var(--strip)',
        }}>
          MINI-MAP · {trip.title}
        </div>
      </div>
    </div>
  );
}

function PinLayer({ pins }) {
  // Compute viewport from pin extent with 5% padding.
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Avoid zero range — add 0.01° padding minimum.
  if (maxLat - minLat < 0.01) { minLat -= 0.005; maxLat += 0.005; }
  if (maxLng - minLng < 0.01) { minLng -= 0.005; maxLng += 0.005; }
  const dx = maxLng - minLng, dy = maxLat - minLat;
  const px = (lng) => 50 + (lng - minLng) / dx * 700;
  const py = (lat) => 50 + (1 - (lat - minLat) / dy) * 260;

  // Polyline by dayIndex order.
  const sorted = pins.slice().sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0) || (a.order || 0) - (b.order || 0));
  const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${px(p.lng).toFixed(1)} ${py(p.lat).toFixed(1)}`).join(' ');

  return (
    <>
      <path d={path} strokeWidth="3" fill="none" strokeDasharray="8 6" style={{ stroke: 'var(--tv-route)' }} />
      {sorted.map((p, i) => (
        <g key={p._id} shapeRendering="crispEdges">
          <rect x={px(p.lng) - 8} y={py(p.lat) - 8} width="16" height="16" fill={GOLD} strokeWidth="3" style={{ stroke: 'var(--ink)' }} />
          <text x={px(p.lng)} y={py(p.lat) + 4} textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="10" fontWeight="700" fill="#1b1410">{i + 1}</text>
        </g>
      ))}
    </>
  );
}

function StatsHero({ stats, currency, loading }) {
  const tiles = [
    { k: 'PLACES', v: stats.places },
    { k: 'DAYS',   v: stats.days },
    { k: 'KM',     v: stats.km },
    { k: 'SPEND',  v: stats.spend ? formatMoney(stats.spend, currency) : '—' },
    { k: 'NOTES',  v: stats.notes },
  ];
  return (
    <div className="px tv-g5" style={{ background: COLORS.paper }}>
      {tiles.map((t, i) => (
        <div key={t.k} className="sk" style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', minWidth: 0,
          borderLeft: i ? '3px dashed var(--rule)' : 'none',
        }}>
          <span style={{ fontSize: 11, color: COLORS.muted }}>{t.k}</span>
          <span className="pf tv-kpi-v" style={{
            fontSize: 26, lineHeight: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{loading ? '…' : t.v}</span>
        </div>
      ))}
    </div>
  );
}

function BestOfCard({ bestOf, onSave }) {
  const [draft, setDraft] = useState(() => bestOf.slice(0, 3));
  const [editing, setEditing] = useState(false);

  useEffect(() => { setDraft(bestOf.slice(0, 3)); }, [bestOf]);

  return (
    <section className="px" aria-labelledby="tv-best-h" style={{ background: COLORS.paper, padding: 18 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8,
      }}>
        <CardTitle id="tv-best-h">BEST OF</CardTitle>
        {editing ? (
          <div style={{ display: 'flex', gap: 14, padding: '0 6px 6px 0' }}>
            <PxButton onClick={() => { setEditing(false); setDraft(bestOf.slice(0, 3)); }} style={{ minHeight: 34, fontSize: 11 }}>CANCEL</PxButton>
            <PxButton fill={GOLD} onClick={() => { onSave(draft); setEditing(false); }} style={{ minHeight: 34, fontSize: 11 }}>SAVE</PxButton>
          </div>
        ) : (
          <button type="button" className="chip-px sk" onClick={() => setEditing(true)} style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}>EDIT</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {draft.map((row, i) => (
          <div key={i} style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px 12px',
            padding: '10px 0', borderBottom: i < draft.length - 1 ? '3px dashed var(--rule)' : 0, fontSize: 13,
          }}>
            <span style={{ color: COLORS.text }}>{row.label}</span>
            {editing ? (
              <div style={{ flex: '1 1 160px', minWidth: 0, padding: 3 }}>
                <Field
                  value={row.value || ''}
                  onChange={(v) => {
                    const next = draft.slice();
                    next[i] = { ...row, value: v };
                    setDraft(next);
                  }}
                  placeholder="—"
                  mono={false}
                  style={{ ...fieldStyle, height: 38 }}
                />
              </div>
            ) : (
              <span style={{ color: row.value ? COLORS.text : COLORS.muted, fontWeight: row.value ? 700 : 400, textAlign: 'right' }}>
                {row.value || '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DayTimeline({ trip, pins, onGotoPlan }) {
  const days = tripDays(trip);
  if (!days) return null;

  // Bucket pins by dayIndex (0-based; UI day = dayIndex + 1).
  const byDay = {};
  for (const p of pins) {
    const d = p.dayIndex ?? 0;
    (byDay[d] = byDay[d] || []).push(p);
  }

  return (
    <section className="px" aria-labelledby="tv-days-h" style={{ background: COLORS.paper, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <CardTitle id="tv-days-h">DAY-BY-DAY · {days}D</CardTitle>
        <button type="button" onClick={onGotoPlan} className="chip-px sk" style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}>
          EDIT IN PLAN →
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: days }, (_, i) => {
          const dayPins = byDay[i] || [];
          return (
            <div key={i} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 0',
              borderBottom: i < days - 1 ? '3px dashed var(--rule)' : 0,
            }}>
              <span className="sk" style={{ flexShrink: 0, width: 34, paddingTop: 3, fontSize: 11 }}>D{i + 1}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
                {dayPins.length === 0 ? (
                  <span style={{ fontSize: 12, color: COLORS.muted, fontStyle: 'italic', paddingTop: 2 }}>nothing yet</span>
                ) : (
                  dayPins.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((p) => (
                    <span key={p._id} style={{
                      fontSize: 12, padding: '2px 8px', color: COLORS.text,
                      background: COLORS.field, border: '2px solid var(--ink)',
                    }}>{p.name}</span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NotesPreview({ notes, onOpenNotes }) {
  if (!notes.length) {
    return (
      <DialogBox speaker="NOTES · 0" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: COLORS.muted }}>Tap to start journaling this trip →</p>
          <PxButton onClick={onOpenNotes} style={{ minHeight: 40, fontSize: 11, marginRight: 26 }}>OPEN NOTES →</PxButton>
        </div>
      </DialogBox>
    );
  }
  const latest = notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const excerpt = (latest.content || '').replace(/[#*`]/g, '').slice(0, 200);
  return (
    <DialogBox speaker={`NOTES · ${notes.length}`} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, color: COLORS.text, fontSize: 14, lineHeight: 1.6 }}>
          {excerpt}{(latest.content || '').length > 200 ? '…' : ''}
        </p>
        <div>
          <PxButton onClick={onOpenNotes} style={{ minHeight: 40, fontSize: 11 }}>OPEN NOTES →</PxButton>
        </div>
      </div>
    </DialogBox>
  );
}

function NotesPlaceholder({ noteCount }) {
  return (
    <div className="px" style={{ background: COLORS.paper }}>
      <Empty title={`NOTES · ${noteCount}`} hint="Markdown editor coming in task #9." />
    </div>
  );
}

// ─── Right rail ─────────────────────────────────────────────────
function RightRail({ trip, stats, expenseByCategory, onGotoExpenses, onGotoPlan }) {
  return (
    <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 32 }}>
      <KeyFactsCard trip={trip} stats={stats} />
      <ExpenseSummary
        expenseByCategory={expenseByCategory}
        currency={trip.tripCurrency || 'USD'}
        total={stats.spend}
        onClick={onGotoExpenses}
      />
      <QuickActions
        onPdf={() => window.print()}
        onDuplicate={() => alert('Duplicate — task #13')}
        onArchive={() => alert('Archive: use the ⋯ menu top-right')}
        onShare={() => alert('Share — task #12')}
        onExpenses={onGotoExpenses}
      />
    </aside>
  );
}

function KeyFactsCard({ trip, stats }) {
  const rows = [
    { k: 'Dates',     v: trip.startDate && trip.endDate ? `${trip.startDate} → ${trip.endDate}` : '—' },
    { k: 'Days',      v: stats.days || '—' },
    { k: 'Pins',      v: stats.places },
    { k: 'Distance',  v: stats.km ? `${stats.km} KM` : '—' },
    { k: 'Spend',     v: stats.spend ? formatMoney(stats.spend, trip.tripCurrency || 'USD') : '—' },
    { k: 'Currency',  v: trip.tripCurrency || '—' },
    { k: 'Region',    v: trip.region || '—' },
  ];
  return (
    <section className="px" aria-labelledby="tv-facts-h" style={{ background: COLORS.paper, padding: 18 }}>
      <CardTitle id="tv-facts-h" style={{ marginBottom: 6 }}>KEY FACTS</CardTitle>
      {rows.map((r, i) => (
        <div key={r.k} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          padding: '9px 0', fontSize: 13,
          borderBottom: i < rows.length - 1 ? '3px dashed var(--rule)' : 0,
        }}>
          <span style={{ color: COLORS.muted }}>{r.k}</span>
          <span style={{ color: COLORS.text, textAlign: 'right' }}>{r.v}</span>
        </div>
      ))}
    </section>
  );
}

function ExpenseSummary({ expenseByCategory, currency, total, onClick }) {
  const max = total || 1;
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      role="button"
      tabIndex={0}
      className="px tv-card"
      aria-labelledby="tv-exp-h"
      style={{ background: COLORS.paper, padding: 18 }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12,
      }}>
        <CardTitle id="tv-exp-h">EXPENSES</CardTitle>
        <span className="pf" style={{ fontSize: 18, color: COLORS.text }}>
          {total ? formatMoney(total, currency) : '—'}
        </span>
      </div>

      <div aria-hidden="true" style={{
        display: 'flex', height: 18, background: COLORS.paper, border: '3px solid var(--ink)', overflow: 'hidden',
      }}>
        {expenseByCategory.length === 0 ? (
          <div style={{ flex: 1 }} />
        ) : expenseByCategory.map(([cat, amount]) => (
          <div
            key={cat}
            style={{
              flex: amount / max,
              background: `repeating-linear-gradient(90deg, ${catFill(cat)} 0 10px, transparent 10px 12px)`,
            }}
            title={`${cat}: ${formatMoney(amount, currency)}`}
          />
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {expenseByCategory.length === 0 ? (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No transactions yet — tap to add</div>
        ) : expenseByCategory.slice(0, 5).map(([cat, amount]) => (
          <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, textTransform: 'uppercase' }}>
              <Swatch fill={catFill(cat)} />
              {cat}
            </span>
            <span style={{ color: COLORS.text, fontWeight: 700 }}>{formatMoney(amount, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareModal({ state, onClose }) {
  return (
    <PxDialog
      onClose={onClose}
      zIndex={2000}
      width={500}
      kicker="SHARE · READ-ONLY LINK"
      title="Read-only link"
      footer={state.url ? null : <PxButton onClick={onClose} style={{ height: 44 }}>DONE</PxButton>}
    >
      {state.loading && <Loading label="creating snapshot" />}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.url && (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: COLORS.muted, margin: 0 }}>
            Anyone with this URL can view a read-only snapshot. Expires in 30 days.
          </p>
          <label className="sr" htmlFor="tv-share-url-folder">Share link</label>
          <input
            id="tv-share-url-folder"
            readOnly value={state.url}
            onFocus={(e) => e.target.select()}
            className="mono field"
            style={{ ...fieldStyle, fontSize: 13 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '4px 8px 8px 0' }}>
            <PxButton fill={GOLD} onClick={() => navigator.clipboard?.writeText(state.url)} style={{ height: 44 }}>COPY</PxButton>
            <PxButton onClick={onClose} style={{ height: 44 }}>DONE</PxButton>
          </div>
        </>
      )}
    </PxDialog>
  );
}

function QuickActions({ onPdf, onDuplicate, onArchive, onShare, onExpenses }) {
  const items = [
    { k: 'Export PDF',       fn: onPdf },
    { k: 'Duplicate',        fn: onDuplicate },
    { k: 'Archive',          fn: onArchive },
    { k: 'Share read-only',  fn: onShare },
  ];
  return (
    <section className="px" aria-labelledby="tv-qa-h" style={{ background: COLORS.paper, padding: 18 }}>
      <CardTitle id="tv-qa-h" style={{ marginBottom: 14 }}>QUICK ACTIONS</CardTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((i) => (
          <button
            key={i.k}
            type="button"
            onClick={i.fn}
            className="tv-qa"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              height: 42, padding: '0 12px', background: COLORS.field, border: '3px solid var(--ink)',
              color: COLORS.text, fontSize: 13, textAlign: 'left',
            }}
          >
            <span>{i.k}</span>
            <span className="tv-go" aria-hidden="true">→</span>
          </button>
        ))}
        {onExpenses && (
          <button
            type="button"
            onClick={onExpenses}
            className="tv-qa"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              height: 42, padding: '0 12px', background: GOLD, border: '3px solid var(--ink)',
              color: ON, fontSize: 13, textAlign: 'left',
            }}
          >
            <span>Open expenses</span>
            <span className="tv-go" aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Money formatting ───────────────────────────────────────────
function formatMoney(amount, currency) {
  if (amount == null) return '—';
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency', currency: code,
      maximumFractionDigits: code === 'JPY' || code === 'VND' || code === 'KRW' ? 0 : 0,
    }).format(amount);
  } catch {
    return `${code} ${Math.round(amount).toLocaleString()}`;
  }
}
