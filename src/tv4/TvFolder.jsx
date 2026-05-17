// 03 TRIP FOLDER · OVERVIEW (default) + NOTES (sub-tab). Per-trip view.
// PLAN and EXPENSES are reached via the top-level tab bar — they have their own components.
// Sub-routing param: 'overview' (default) | 'notes'.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';
import TvNotes from './TvNotes.jsx';
import { createShareLink } from './exports.js';

const SUB_TABS = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'notes',    label: 'NOTES' },
];

const STATUS_COLOR = { visited: COLORS.green, ongoing: COLORS.gold, planned: COLORS.red };

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

export default function TvFolder({ trip, sub, onSubChange, onTripUpdate, onGotoPlan, onGotoExpenses }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
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

  if (!trip) return <EmptyState />;

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ padding: 18 }}>
        <TopPills trip={trip} sumDates={sumDates} stats={stats} onMenu={() => setMenuOpen((v) => !v)} menuOpen={menuOpen}
          onArchive={() => updateTrip({ archived: !trip.archived })}
          onPromote={() => {
            if (window.confirm('Mark this trip as visited? All plan items become trip facts.')) {
              updateTrip({ status: 'visited' });
            }
          }}
        />

        <div style={{ marginTop: 14, marginBottom: 14 }}>
          <SubTabs value={subId} onChange={onSubChange} />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px',
          gap: 18,
        }}>
          <main style={{ minWidth: 0 }}>
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
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">
      ◇ no trip context · open one from LIST
    </div>
  );
}

function SubTabs({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {SUB_TABS.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="mono"
            style={{
              padding: '5px 12px', borderRadius: 999,
              border: '1px solid ' + (on ? COLORS.gold + '80' : COLORS.line),
              background: on ? COLORS.gold + '14' : 'transparent',
              color: on ? COLORS.gold : COLORS.muted,
              fontSize: 10, letterSpacing: '0.18em', cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function TopPills({ trip, sumDates, stats, onMenu, menuOpen, onArchive, onPromote }) {
  const c = STATUS_COLOR[trip.status] || COLORS.muted;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      position: 'relative',
    }}>
      <Pill color={c}>{trip.status}{trip.planStage ? ` · ${trip.planStage}` : ''}</Pill>
      {sumDates !== '—' && <Pill>{sumDates}</Pill>}
      {stats.days ? <Pill>{stats.days} days</Pill> : null}
      {trip.country && <Pill>{trip.country}</Pill>}
      {(trip.tags || []).slice(0, 5).map((t) => <Pill key={t}>{t}</Pill>)}

      <div style={{ marginLeft: 'auto', position: 'relative' }}>
        <button
          onClick={onMenu}
          style={{
            width: 32, height: 28, borderRadius: 8,
            background: 'transparent', border: '1px solid ' + COLORS.line,
            color: COLORS.text, cursor: 'pointer', fontSize: 16, lineHeight: 1,
          }}
          aria-label="Trip menu"
        >⋯</button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 36, right: 0, zIndex: 50,
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            borderRadius: 10, padding: 6, minWidth: 200,
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
          }}>
            <MenuItem label="Promote → visited" onClick={onPromote} />
            <MenuItem label={trip.archived ? 'Unarchive' : 'Archive'} onClick={onArchive} />
            <MenuItem label="Duplicate (todo)" onClick={() => alert('Duplicate — coming with templates task #13')} />
            <MenuItem label="Share read-only (todo)" onClick={() => alert('Share — coming with exports task #12')} />
            <MenuItem label="Print" onClick={() => window.print()} />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6,
        background: 'transparent', border: 'none', color: COLORS.text,
        cursor: 'pointer', fontSize: 12,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245,237,224,0.04)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >{label}</button>
  );
}

function Pill({ children, color }) {
  const c = color || COLORS.muted;
  return (
    <span className="mono" style={{
      padding: '4px 10px', borderRadius: 999,
      border: `1px solid ${c}55`,
      color: color ? c : COLORS.muted,
      background: color ? c + '14' : 'transparent',
      fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

// ─── Overview body ───────────────────────────────────────────────
function OverviewBody({ trip, pins, transactions, notes, stats, loading, onUpdate, onOpenNotes, onGotoPlan, onGotoExpenses }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MiniMap trip={trip} pins={pins} />

      <StatsHero stats={stats} currency={trip.tripCurrency || 'USD'} loading={loading} />

      <BestOfCard
        bestOf={trip.bestOf?.length ? trip.bestOf : DEFAULT_BEST_OF}
        onSave={(next) => onUpdate({ bestOf: next })}
      />

      <DayTimeline trip={trip} pins={pins} onGotoPlan={onGotoPlan} />

      <NotesPreview notes={notes} onOpenNotes={onOpenNotes} />
    </div>
  );
}

// Mini-map: render pins on a gradient panel using lat/lng → SVG coords.
// Falls back to a placeholder pulse if no pins yet.
function MiniMap({ trip, pins }) {
  const valid = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return (
    <div style={{
      position: 'relative', borderRadius: 14, overflow: 'hidden',
      border: '1px solid ' + COLORS.line, background: COLORS.panel,
      aspectRatio: '16/9', minHeight: 220,
    }}>
      <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="folder-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={COLORS.gold} stopOpacity="0.18" />
            <stop offset="100%" stopColor={COLORS.green} stopOpacity="0.08" />
          </linearGradient>
          <pattern id="folder-dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="7" cy="7" r="0.7" fill="rgba(245,237,224,0.22)" />
          </pattern>
        </defs>
        <rect width="800" height="450" fill={COLORS.panel} />
        <rect width="800" height="450" fill="url(#folder-grad)" />
        <rect width="800" height="450" fill="url(#folder-dots)" />

        {valid.length > 0 ? <PinLayer pins={valid} /> : (
          <>
            <circle cx="400" cy="225" r="6" fill={STATUS_COLOR[trip.status] || COLORS.muted} />
            <text x="400" y="260" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="12" fill={COLORS.muted}>
              no pins yet
            </text>
          </>
        )}
      </svg>

      <div style={{
        position: 'absolute', top: 12, left: 14,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted }}>
          MINI-MAP
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{trip.title}</div>
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
  const px = (lng) => 40 + (lng - minLng) / dx * 720;
  const py = (lat) => 40 + (1 - (lat - minLat) / dy) * 370;

  // Polyline by dayIndex order.
  const sorted = pins.slice().sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0) || (a.order || 0) - (b.order || 0));
  const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${px(p.lng).toFixed(1)} ${py(p.lat).toFixed(1)}`).join(' ');

  return (
    <>
      <path d={path} stroke={COLORS.gold + 'AA'} strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
      {sorted.map((p, i) => (
        <g key={p._id}>
          <circle cx={px(p.lng)} cy={py(p.lat)} r="5" fill={COLORS.gold} />
          <circle cx={px(p.lng)} cy={py(p.lat)} r="9" fill="none" stroke={COLORS.gold} strokeOpacity="0.35" />
        </g>
      ))}
    </>
  );
}

function StatsHero({ stats, currency, loading }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const tiles = [
    { k: 'PLACES', v: stats.places },
    { k: 'DAYS',   v: stats.days },
    { k: 'KM',     v: stats.km },
    { k: 'SPEND',  v: stats.spend ? formatMoney(stats.spend, currency) : '—' },
    { k: 'NOTES',  v: stats.notes },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(5, minmax(0, 1fr))',
      gap: 8,
    }}>
      {tiles.map((t) => (
        <div key={t.k} style={{
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 10, padding: 12, minWidth: 0,
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted }}>
            {t.k}
          </div>
          <div className="mono" style={{
            fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {loading ? '…' : t.v}
          </div>
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
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 16,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
          BEST OF
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn onClick={() => { setEditing(false); setDraft(bestOf.slice(0, 3)); }}>Cancel</Btn>
            <Btn
              variant="tinted" color={COLORS.gold}
              onClick={() => { onSave(draft); setEditing(false); }}
            >Save</Btn>
          </div>
        ) : (
          <Btn onClick={() => setEditing(true)}>Edit</Btn>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>{row.label}</span>
            {editing ? (
              <Field
                value={row.value || ''}
                onChange={(v) => {
                  const next = draft.slice();
                  next[i] = { ...row, value: v };
                  setDraft(next);
                }}
                placeholder="—"
                mono={false}
              />
            ) : (
              <span style={{ color: row.value ? COLORS.text : COLORS.muted, fontSize: 13 }}>
                {row.value || '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
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
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
          DAY-BY-DAY · {days}D
        </div>
        <button
          onClick={onGotoPlan}
          className="mono"
          style={{
            background: 'transparent', border: 'none', color: COLORS.muted,
            cursor: 'pointer', fontSize: 10, letterSpacing: '0.18em',
          }}
        >EDIT IN PLAN →</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: days }, (_, i) => {
          const dayPins = byDay[i] || [];
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12, alignItems: 'flex-start',
              padding: '8px 0',
              borderTop: i === 0 ? 'none' : '1px dashed ' + COLORS.line,
            }}>
              <div className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.12em' }}>
                D{i + 1}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dayPins.length === 0 ? (
                  <span style={{ fontSize: 12, color: COLORS.muted, fontStyle: 'italic' }}>nothing yet</span>
                ) : (
                  dayPins.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((p) => (
                    <span
                      key={p._id}
                      className="mono"
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 6,
                        background: 'rgba(245,237,224,0.04)',
                        border: '1px solid ' + COLORS.line,
                        color: COLORS.text,
                      }}
                    >{p.name}</span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotesPreview({ notes, onOpenNotes }) {
  if (!notes.length) {
    return (
      <div
        onClick={onOpenNotes}
        style={{
          background: COLORS.panel, border: '1px dashed ' + COLORS.line,
          borderRadius: 12, padding: 16,
          cursor: 'pointer', color: COLORS.muted, fontSize: 13,
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold, marginBottom: 8 }}>
          NOTES
        </div>
        Tap to start journaling this trip →
      </div>
    );
  }
  const latest = notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const excerpt = (latest.content || '').replace(/[#*`]/g, '').slice(0, 200);
  return (
    <div
      onClick={onOpenNotes}
      style={{
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 12, padding: 16, cursor: 'pointer',
      }}
    >
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold, marginBottom: 8 }}>
        NOTES · {notes.length}
      </div>
      <div style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.5 }}>
        {excerpt}{(latest.content || '').length > 200 ? '…' : ''}
      </div>
    </div>
  );
}

function NotesPlaceholder({ noteCount }) {
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 32, color: COLORS.muted, textAlign: 'center',
    }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: COLORS.gold }}>
        NOTES · {noteCount}
      </div>
      <div style={{ marginTop: 10, fontSize: 13 }}>
        Markdown editor coming in task #9.
      </div>
    </div>
  );
}

// ─── Right rail ─────────────────────────────────────────────────
function RightRail({ trip, stats, expenseByCategory, onGotoExpenses, onGotoPlan }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 14, padding: 16,
    }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        KEY FACTS
      </div>
      {rows.map((r) => (
        <div key={r.k} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', fontSize: 12,
          borderBottom: '1px dashed ' + COLORS.line,
        }}>
          <span style={{ color: COLORS.muted }}>{r.k}</span>
          <span className="mono" style={{ color: COLORS.text }}>{r.v}</span>
        </div>
      ))}
    </div>
  );
}

const CAT_COLORS = {
  food:      COLORS.gold,
  stay:      COLORS.green,
  transport: COLORS.red,
  shopping:  '#9bb4ff',
  other:     'rgba(245,237,224,0.4)',
};

function ExpenseSummary({ expenseByCategory, currency, total, onClick }) {
  const max = total || 1;
  return (
    <div
      onClick={onClick}
      style={{
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 14, padding: 16, cursor: 'pointer',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted }}>
          EXPENSES
        </div>
        <div className="mono" style={{ fontSize: 11, color: COLORS.text }}>
          {total ? formatMoney(total, currency) : '—'}
        </div>
      </div>

      <div style={{
        display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden',
        background: 'rgba(245,237,224,0.06)',
      }}>
        {expenseByCategory.length === 0 ? (
          <div style={{ flex: 1 }} />
        ) : expenseByCategory.map(([cat, amount]) => (
          <div
            key={cat}
            style={{
              flex: amount / max,
              background: CAT_COLORS[cat] || CAT_COLORS.other,
            }}
            title={`${cat}: ${formatMoney(amount, currency)}`}
          />
        ))}
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {expenseByCategory.length === 0 ? (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No transactions yet — tap to add</div>
        ) : expenseByCategory.slice(0, 5).map(([cat, amount]) => (
          <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.muted }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: CAT_COLORS[cat] || CAT_COLORS.other,
              }} />
              {cat}
            </span>
            <span className="mono" style={{ color: COLORS.text }}>{formatMoney(amount, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareModal({ state, onClose }) {
  return (
    <div role="dialog" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 14, width: 460, padding: 22, color: COLORS.text,
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>SHARE</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, marginBottom: 12 }}>Read-only link</div>
        {state.loading && <div className="mono" style={{ color: COLORS.muted, fontSize: 12 }}>◇ creating snapshot…</div>}
        {state.error && (
          <div style={{
            padding: 10, borderRadius: 8,
            background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
            color: COLORS.red, fontSize: 12,
          }}>{state.error}</div>
        )}
        {state.url && (
          <>
            <p style={{ fontSize: 13, color: COLORS.muted, margin: '0 0 10px' }}>
              Anyone with this URL can view a read-only snapshot. Expires in 30 days.
            </p>
            <input
              readOnly value={state.url}
              onFocus={(e) => e.target.select()}
              style={{
                width: '100%',
                background: COLORS.bg, border: '1px solid ' + COLORS.line,
                borderRadius: 8, padding: '10px 12px',
                color: COLORS.text, fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Btn onClick={() => navigator.clipboard?.writeText(state.url)} variant="tinted" color={COLORS.gold}>Copy</Btn>
              <Btn onClick={onClose}>Done</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuickActions({ onPdf, onDuplicate, onArchive, onShare }) {
  const items = [
    { k: 'Export PDF',       fn: onPdf },
    { k: 'Duplicate',        fn: onDuplicate },
    { k: 'Archive',          fn: onArchive },
    { k: 'Share read-only',  fn: onShare },
  ];
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 14, padding: 16,
    }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        QUICK ACTIONS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((i) => (
          <button
            key={i.k}
            onClick={i.fn}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', border: '1px solid ' + COLORS.line,
              color: COLORS.text, fontSize: 12, textAlign: 'left',
            }}
          >
            <span>{i.k}</span>
            <span style={{ color: COLORS.muted, fontSize: 14 }}>→</span>
          </button>
        ))}
      </div>
    </div>
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
