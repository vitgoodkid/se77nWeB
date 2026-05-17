// 04 PLAN · per-trip kanban day-by-day + checklist + reservations + budget.
// Drag-reorder and Google Places "suggest" punted to v0.5; v1 has inline add + modal edit.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';
import { tripToICS, downloadBlob, createShareLink } from './exports.js';

const TYPES = [
  { id: 'see',   label: 'SEE',   color: COLORS.green },
  { id: 'eat',   label: 'EAT',   color: COLORS.gold },
  { id: 'move',  label: 'MOVE',  color: COLORS.red },
  { id: 'stay',  label: 'STAY',  color: '#9bb4ff' },
  { id: 'other', label: 'OTHER', color: COLORS.muted },
];
const STATUS = ['planned', 'done', 'skipped'];
const RES_TYPES = ['flight', 'hotel', 'restaurant', 'other'];

const VIEW_MODES = [
  { id: 'kanban',   label: 'KANBAN'   },
  { id: 'timeline', label: 'TIMELINE' },
  { id: 'list',     label: 'LIST'     },
];

function tripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return 7;
  const s = new Date(trip.startDate), e = new Date(trip.endDate);
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function dayLabel(trip, idx) {
  if (!trip?.startDate) return `DAY ${idx + 1}`;
  const d = new Date(trip.startDate);
  d.setDate(d.getDate() + idx);
  const dow = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
  return { d1: `DAY ${idx + 1} · ${dow}`, date: `${String(d.getDate()).padStart(2,'0')} ${mon}`, iso: d.toISOString().slice(0,10) };
}

function daysToTrip(trip) {
  if (!trip?.startDate) return null;
  const s = new Date(trip.startDate), now = new Date();
  return Math.floor((s - now) / 86400000);
}

export default function TvPlan({ trip, onTripUpdate }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [items, setItems] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban');
  const [editingItem, setEditingItem] = useState(null);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [shareState, setShareState] = useState(null);

  const tripId = trip?._id;
  const days = tripDays(trip);
  const daysLeft = daysToTrip(trip);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const [p, c, r] = await Promise.all([
        tv4.list('plan-items',  { tripId }),
        tv4.list('checklist',   { tripId }),
        tv4.list('reservations',{ tripId }),
      ]);
      setItems(p.docs || []);
      setChecklist(c.docs || []);
      setReservations(r.docs || []);
    } catch (e) {
      console.warn('plan fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { refresh(); }, [refresh]);

  const itemsByDay = useMemo(() => {
    const map = {};
    for (const it of items) {
      const d = it.dayIndex ?? 0;
      (map[d] = map[d] || []).push(it);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || '') || (a.order || 0) - (b.order || 0));
    }
    return map;
  }, [items]);

  const totalEst = useMemo(() => {
    return items.reduce((s, it) => s + (Number(it.estCost) || 0), 0);
  }, [items]);

  const onAddItem = useCallback((dayIndex) => {
    setEditingItem({ dayIndex, title: '', type: 'see', status: 'planned' });
  }, []);

  const onSaveItem = useCallback(async (draft) => {
    if (!tripId) return;
    try {
      if (draft._id) {
        await tv4.update('plan-items', draft._id, draft);
      } else {
        await tv4.create('plan-items', { ...draft, tripId });
      }
      setEditingItem(null);
      await refresh();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }, [tripId, refresh]);

  const onDeleteItem = useCallback(async (id) => {
    if (!window.confirm('Delete this stop?')) return;
    try {
      await tv4.remove('plan-items', id);
      await refresh();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }, [refresh]);

  const onToggleStatus = useCallback(async (item) => {
    const nextStatus = item.status === 'done' ? 'planned' : 'done';
    await tv4.update('plan-items', item._id, { status: nextStatus });
    await refresh();
  }, [refresh]);

  const onToggleCheck = useCallback(async (id, current) => {
    await tv4.update('checklist', id, { done: !current });
    await refresh();
  }, [refresh]);

  const onAddCheck = useCallback(async (text) => {
    if (!tripId || !text.trim()) return;
    await tv4.create('checklist', { tripId, text: text.trim(), done: false });
    await refresh();
  }, [tripId, refresh]);

  const onRemoveCheck = useCallback(async (id) => {
    await tv4.remove('checklist', id);
    await refresh();
  }, [refresh]);

  const onSaveReservation = useCallback(async (draft) => {
    if (!tripId) return;
    try {
      if (draft._id) {
        await tv4.update('reservations', draft._id, draft);
      } else {
        await tv4.create('reservations', { ...draft, tripId });
      }
      setShowReservationModal(false);
      setEditingReservation(null);
      await refresh();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }, [tripId, refresh]);

  const onRemoveReservation = useCallback(async (id) => {
    if (!window.confirm('Delete this reservation?')) return;
    await tv4.remove('reservations', id);
    await refresh();
  }, [refresh]);

  const onPromote = useCallback(async () => {
    if (!tripId) return;
    if (!window.confirm('Mark trip as VISITED? Plan items become trip facts.')) return;
    await tv4.update('trips', tripId, { status: 'visited' });
    onTripUpdate?.();
  }, [tripId, onTripUpdate]);

  const onExportICS = useCallback(async () => {
    if (!tripId) return;
    try {
      const { docs: pins } = await tv4.list('pins', { tripId });
      const ics = tripToICS(trip, items, pins || []);
      downloadBlob(ics, `${trip.slug || 'trip'}-plan.ics`, 'text/calendar');
    } catch (e) {
      alert('Export failed: ' + (e.message || 'unknown'));
    }
  }, [trip, items, tripId]);

  const onShare = useCallback(async () => {
    if (!tripId) return;
    setShareState({ loading: true });
    try {
      const r = await createShareLink(tripId, 30);
      setShareState({ loading: false, url: r.url, expiresAt: r.expiresAt });
    } catch (e) {
      setShareState({ loading: false, error: e.message || 'failed' });
    }
  }, [tripId]);

  if (!trip) return <Empty />;

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {daysLeft !== null && daysLeft > 0 && daysLeft <= 30 && (
          <CountdownBanner daysLeft={daysLeft} checklist={checklist} />
        )}

        <Toolbar
          viewMode={viewMode} onViewChange={setViewMode}
          onPromote={onPromote}
          onExportICS={onExportICS}
          onShare={onShare}
        />

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0, 1fr) 320px', gap: 18 }}>
          <main style={{ minWidth: 0 }}>
            {loading && !items.length ? (
              <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">◇ loading…</div>
            ) : viewMode === 'kanban' ? (
              <Kanban
                trip={trip} days={days} itemsByDay={itemsByDay}
                onAddItem={onAddItem} onEditItem={setEditingItem}
                onDeleteItem={onDeleteItem} onToggleStatus={onToggleStatus}
              />
            ) : viewMode === 'timeline' ? (
              <Timeline trip={trip} days={days} itemsByDay={itemsByDay} onEditItem={setEditingItem} />
            ) : (
              <FlatList trip={trip} days={days} itemsByDay={itemsByDay} onEditItem={setEditingItem} />
            )}
          </main>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ChecklistCard
              checklist={checklist}
              onToggle={onToggleCheck}
              onRemove={onRemoveCheck}
              onAdd={onAddCheck}
            />
            <ReservationsCard
              reservations={reservations}
              onAdd={() => { setEditingReservation(null); setShowReservationModal(true); }}
              onEdit={(r) => { setEditingReservation(r); setShowReservationModal(true); }}
              onRemove={onRemoveReservation}
            />
            <BudgetCard trip={trip} totalEst={totalEst} />
            <TemplateCard trip={trip} items={items} checklist={checklist} />
          </aside>
        </div>
      </div>

      {editingItem && (
        <PlanItemModal
          initial={editingItem}
          tripCurrency={trip.tripCurrency}
          days={days}
          onClose={() => setEditingItem(null)}
          onSave={onSaveItem}
        />
      )}

      {showReservationModal && (
        <ReservationModal
          initial={editingReservation || { type: 'flight' }}
          onClose={() => { setShowReservationModal(false); setEditingReservation(null); }}
          onSave={onSaveReservation}
        />
      )}

      {shareState && (
        <ShareModal state={shareState} onClose={() => setShareState(null)} />
      )}
    </div>
  );
}

function ShareModal({ state, onClose }) {
  return (
    <div role="dialog" onClick={onClose} style={modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard, width: 480 }}>
        <header style={modalHeader}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>SHARE</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>Read-only link</div>
          </div>
          <button onClick={onClose} style={modalClose}>×</button>
        </header>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>
                Anyone with this URL can view a read-only snapshot. Expires in 30 days.
              </p>
              <input
                readOnly
                value={state.url}
                onFocus={(e) => e.target.select()}
                style={{
                  background: COLORS.bg, border: '1px solid ' + COLORS.line,
                  borderRadius: 8, padding: '10px 12px',
                  color: COLORS.text, fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <Btn onClick={() => navigator.clipboard?.writeText(state.url)} variant="tinted" color={COLORS.gold}>
                Copy link
              </Btn>
            </>
          )}
        </div>
        <footer style={modalFooter}>
          <Btn onClick={onClose}>Done</Btn>
        </footer>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">◇ no trip selected</div>
  );
}

function CountdownBanner({ daysLeft, checklist }) {
  const todo = checklist.filter((c) => !c.done).length;
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      background: COLORS.gold + '12', border: `1px solid ${COLORS.gold}55`,
      color: COLORS.gold, fontSize: 12,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span><strong>{daysLeft}</strong> days to go {todo > 0 && `· ${todo} checklist items left`}</span>
    </div>
  );
}

function Toolbar({ viewMode, onViewChange, onPromote, onExportICS, onShare }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', border: '1px solid ' + COLORS.line, borderRadius: 8, overflow: 'hidden' }}>
        {VIEW_MODES.map((v) => {
          const on = viewMode === v.id;
          return (
            <button
              key={v.id}
              onClick={() => onViewChange(v.id)}
              className="mono"
              style={{
                padding: '6px 12px', cursor: 'pointer',
                background: on ? COLORS.gold + '1f' : 'transparent',
                border: 'none', fontSize: 10, letterSpacing: '0.18em',
                color: on ? COLORS.gold : COLORS.muted,
              }}
            >{v.label}</button>
          );
        })}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={onExportICS}>↓ ICAL</Btn>
        <Btn onClick={() => window.print()}>↓ PDF</Btn>
        <Btn onClick={onShare}>↗ SHARE</Btn>
        <Btn onClick={onPromote} variant="tinted" color={COLORS.gold}>PROMOTE →</Btn>
      </div>
    </div>
  );
}

// ─── Kanban ─────────────────────────────────────────────────────
function Kanban({ trip, days, itemsByDay, onAddItem, onEditItem, onDeleteItem, onToggleStatus }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile
        ? 'minmax(0, 1fr)'
        : `repeat(${Math.min(days, 4)}, minmax(220px, 1fr))`,
      gap: 12,
      overflowX: isMobile ? 'visible' : 'auto',
    }}>
      {Array.from({ length: days }, (_, i) => {
        const lbl = dayLabel(trip, i);
        const dayItems = itemsByDay[i] || [];
        return (
          <div key={i} style={{
            background: COLORS.panel, border: '1px solid ' + COLORS.line,
            borderRadius: 12, padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8,
            minHeight: 240,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: COLORS.muted }}>
                {typeof lbl === 'string' ? lbl : lbl.d1}
              </div>
              {typeof lbl !== 'string' && (
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{lbl.date}</div>
              )}
            </div>
            {dayItems.length === 0 ? (
              <button
                onClick={() => onAddItem(i)}
                style={{
                  flex: 1, minHeight: 120,
                  background: 'rgba(245,237,224,0.03)',
                  border: '1px dashed ' + COLORS.line, borderRadius: 8,
                  color: COLORS.muted, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4,
                  fontSize: 12,
                }}
              >
                <span>{tripDays(trip) ? '8h free' : 'EMPTY DAY'}</span>
                <span style={{ fontSize: 10 }} className="mono">+ ADD STOP</span>
              </button>
            ) : (
              <>
                {dayItems.map((it) => (
                  <PlanItem
                    key={it._id}
                    item={it}
                    onEdit={() => onEditItem(it)}
                    onDelete={() => onDeleteItem(it._id)}
                    onToggle={() => onToggleStatus(it)}
                  />
                ))}
                <button
                  onClick={() => onAddItem(i)}
                  className="mono"
                  style={{
                    background: 'transparent', border: '1px dashed ' + COLORS.line,
                    borderRadius: 8, padding: '6px 10px', color: COLORS.muted,
                    cursor: 'pointer', fontSize: 10, letterSpacing: '0.18em',
                  }}
                >+ ADD STOP</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlanItem({ item, onEdit, onDelete, onToggle }) {
  const t = TYPES.find((x) => x.id === item.type) || TYPES[4];
  const done = item.status === 'done';
  const skipped = item.status === 'skipped';
  return (
    <div style={{
      borderRadius: 8, padding: 10,
      background: 'rgba(245,237,224,0.04)',
      border: '1px solid ' + COLORS.line,
      opacity: skipped ? 0.45 : 1,
      textDecoration: skipped ? 'line-through' : 'none',
      cursor: 'pointer', position: 'relative',
    }}
      onClick={onEdit}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span className="mono" style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 4,
          background: t.color + '22', color: t.color, letterSpacing: '0.16em',
        }}>{t.label}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {item.timeStart && (
            <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{item.timeStart}</span>
          )}
          {item.estCost > 0 && (
            <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>
              {(item.currency || '').slice(0,1)}{item.estCost}
            </span>
          )}
        </span>
      </div>
      <div style={{ fontSize: 13, color: done ? COLORS.green : COLORS.text, fontWeight: 600 }}>
        {item.title}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          title={done ? 'Mark planned' : 'Mark done'}
          style={{
            background: 'transparent', border: '1px solid ' + COLORS.line, cursor: 'pointer',
            borderRadius: 4, color: done ? COLORS.green : COLORS.muted,
            fontSize: 11, padding: '2px 6px',
          }}
        >{done ? '✓' : '○'}</button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            marginLeft: 'auto',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: COLORS.muted, fontSize: 14, padding: 0, lineHeight: 1,
          }}
        >×</button>
      </div>
    </div>
  );
}

// ─── Timeline / List ────────────────────────────────────────────
function Timeline({ trip, days, itemsByDay, onEditItem }) {
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {Array.from({ length: days }, (_, i) => {
        const lbl = dayLabel(trip, i);
        const items = itemsByDay[i] || [];
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '80px 1fr', gap: 14,
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : '1px dashed ' + COLORS.line,
          }}>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
              {typeof lbl === 'string' ? lbl : `${lbl.date}`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {items.length === 0 ? (
                <span style={{ color: COLORS.muted, fontSize: 12, fontStyle: 'italic' }}>nothing planned</span>
              ) : items.map((it) => (
                <button
                  key={it._id}
                  onClick={() => onEditItem(it)}
                  style={{
                    background: 'rgba(245,237,224,0.04)',
                    border: '1px solid ' + COLORS.line, borderRadius: 6,
                    padding: '4px 8px', cursor: 'pointer', color: COLORS.text,
                    fontSize: 11,
                  }}
                >
                  {it.timeStart && <span className="mono" style={{ color: COLORS.muted, marginRight: 6 }}>{it.timeStart}</span>}
                  {it.title}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlatList({ trip, days, itemsByDay, onEditItem }) {
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid ' + COLORS.line }}>
            <Th>DAY</Th><Th>TIME</Th><Th>TYPE</Th><Th>TITLE</Th><Th right>COST</Th><Th>STATUS</Th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: days }, (_, i) => itemsByDay[i] || []).flatMap((arr, i) =>
            arr.map((it) => (
              <tr
                key={it._id}
                onClick={() => onEditItem(it)}
                style={{ borderBottom: '1px solid ' + COLORS.line, cursor: 'pointer' }}
              >
                <Td>D{(it.dayIndex ?? 0) + 1}</Td>
                <Td>{it.timeStart || '—'}</Td>
                <Td>{(it.type || '—').toUpperCase()}</Td>
                <Td>{it.title}</Td>
                <Td right>{it.estCost ? `${it.currency || ''} ${it.estCost}` : '—'}</Td>
                <Td>{it.status || 'planned'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, right }) {
  return <th className="mono" style={{
    textAlign: right ? 'right' : 'left',
    padding: '10px 12px', fontSize: 9, letterSpacing: '0.2em',
    color: COLORS.muted, fontWeight: 600, textTransform: 'uppercase',
  }}>{children}</th>;
}
function Td({ children, right }) {
  return <td style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', color: COLORS.text }}>{children}</td>;
}

// ─── Checklist + reservations + budget ──────────────────────────
function ChecklistCard({ checklist, onToggle, onRemove, onAdd }) {
  const [text, setText] = useState('');
  const done = checklist.filter((c) => c.done).length;
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        PRE-TRIP · {done}/{checklist.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
        {checklist.map((c) => (
          <div key={c._id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 4px', borderRadius: 6,
          }}>
            <button
              onClick={() => onToggle(c._id, c.done)}
              style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                background: c.done ? COLORS.green : 'transparent',
                border: '1px solid ' + (c.done ? COLORS.green : COLORS.line),
                cursor: 'pointer', padding: 0, color: COLORS.bg, fontSize: 10,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{c.done ? '✓' : ''}</button>
            <span style={{
              flex: 1, fontSize: 12, color: c.done ? COLORS.muted : COLORS.text,
              textDecoration: c.done ? 'line-through' : 'none',
            }}>{c.text}</span>
            <button
              onClick={() => onRemove(c._id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: COLORS.muted, fontSize: 13, padding: 0,
              }}
            >×</button>
          </div>
        ))}
        {checklist.length === 0 && (
          <span style={{ color: COLORS.muted, fontSize: 12 }}>nothing yet</span>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <Field value={text} onChange={setText} placeholder="add item…" mono={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(text); setText(''); } }}
        />
      </div>
    </div>
  );
}

function ReservationsCard({ reservations, onAdd, onEdit, onRemove }) {
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted }}>
          RESERVATIONS · {reservations.length}
        </div>
        <button onClick={onAdd} className="mono" style={{
          background: 'transparent', border: 'none', color: COLORS.gold,
          cursor: 'pointer', fontSize: 10, letterSpacing: '0.18em',
        }}>+ ADD</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {reservations.map((r) => (
          <div key={r._id} style={{
            padding: 8, borderRadius: 8, background: 'rgba(245,237,224,0.04)',
            border: '1px solid ' + COLORS.line, cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }} onClick={() => onEdit(r)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>
                {r.name || (r.type || '').toUpperCase()}
              </div>
              <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
                {(r.type || '').toUpperCase()} · {r.code || '—'} {r.datetime ? `· ${r.datetime.slice(0,16).replace('T',' ')}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {r.code && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.code); }}
                  title="Copy code"
                  style={{
                    background: 'transparent', border: '1px solid ' + COLORS.line,
                    borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
                    color: COLORS.muted, fontSize: 11,
                  }}
                >⎘</button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(r._id); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: COLORS.muted, fontSize: 13,
                }}
              >×</button>
            </div>
          </div>
        ))}
        {reservations.length === 0 && (
          <span style={{ color: COLORS.muted, fontSize: 12 }}>none yet</span>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ trip, items, checklist }) {
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState(null);

  const onSave = async () => {
    const name = window.prompt('Template name', `${trip.title} blueprint`);
    if (!name?.trim()) return;
    setSaving(true);
    try {
      // Fetch pins now so the template has the full structural snapshot.
      const { docs: pins } = await tv4.list('pins', { tripId: trip._id });
      const strip = (arr) => arr.map(({ _id, userId, tripId, createdAt, updatedAt, ...rest }) => rest);
      await tv4.create('templates', {
        name: name.trim(),
        fromTripId: trip._id,
        pins: strip(pins),
        planItems: strip(items),
        checklist: strip(checklist),
      });
      setSavedName(name.trim());
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        TEMPLATE
      </div>
      <p style={{ fontSize: 12, color: COLORS.muted, margin: '0 0 10px', lineHeight: 1.5 }}>
        Save this trip's structure (pins + plan + checklist) to reuse on a future trip.
      </p>
      <Btn onClick={onSave} disabled={saving}>{saving ? '…' : '↓ SAVE AS TEMPLATE'}</Btn>
      {savedName && (
        <div className="mono" style={{ marginTop: 8, fontSize: 10, color: COLORS.green, letterSpacing: '0.14em' }}>
          ✓ saved as "{savedName}"
        </div>
      )}
    </div>
  );
}

function BudgetCard({ trip, totalEst }) {
  const total = trip.budget?.total || 0;
  const daily = trip.budget?.daily || 0;
  const pct = total ? Math.min(100, (totalEst / total) * 100) : 0;
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        BUDGET
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row label="Daily">
          <Field
            value={daily}
            onChange={() => {}}
            placeholder="0"
            mono
          />
        </Row>
        <div style={{
          display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden',
          background: 'rgba(245,237,224,0.06)',
        }}>
          <div style={{ width: `${pct}%`, background: pct > 100 ? COLORS.red : COLORS.gold }} />
        </div>
        <div className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
          est. plan: {(trip.tripCurrency || '')} {totalEst.toFixed(0)} / {total || '—'}
        </div>
      </div>
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────
function PlanItemModal({ initial, tripCurrency, days, onClose, onSave }) {
  const [draft, setDraft] = useState({
    timeStart: '',
    timeEnd: '',
    title: '',
    type: 'see',
    bookingRef: '',
    url: '',
    estCost: '',
    currency: tripCurrency || 'USD',
    status: 'planned',
    notes: '',
    ...initial,
  });

  const onSubmit = (e) => {
    e?.preventDefault();
    if (!draft.title?.trim()) return;
    onSave({
      ...draft,
      title: draft.title.trim(),
      dayIndex: Number(draft.dayIndex) || 0,
      estCost: draft.estCost === '' ? undefined : Number(draft.estCost),
    });
  };

  return (
    <div role="dialog" onClick={onClose} style={modalBackdrop}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} style={modalCard}>
        <header style={modalHeader}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
              {initial._id ? 'EDIT' : 'NEW STOP'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Plan a stop</div>
          </div>
          <button onClick={onClose} type="button" style={modalClose}>×</button>
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Title">
            <Field value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} placeholder="Dishoom Shoreditch" mono={false} autoFocus />
          </Row>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Row label="Day">
              <Select
                value={draft.dayIndex ?? 0}
                onChange={(v) => setDraft((d) => ({ ...d, dayIndex: Number(v) }))}
                options={Array.from({ length: days }, (_, i) => ({ v: i, l: `Day ${i + 1}` }))}
              />
            </Row>
            <Row label="Start">
              <Field type="time" value={draft.timeStart || ''} onChange={(v) => setDraft((d) => ({ ...d, timeStart: v }))} />
            </Row>
            <Row label="End">
              <Field type="time" value={draft.timeEnd || ''} onChange={(v) => setDraft((d) => ({ ...d, timeEnd: v }))} />
            </Row>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Type">
              <Select
                value={draft.type}
                onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                options={TYPES.map((t) => ({ v: t.id, l: t.label }))}
              />
            </Row>
            <Row label="Status">
              <Select
                value={draft.status}
                onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
                options={STATUS.map((s) => ({ v: s, l: s }))}
              />
            </Row>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Row label="Estimated cost">
              <Field type="number" value={draft.estCost} onChange={(v) => setDraft((d) => ({ ...d, estCost: v }))} placeholder="24" />
            </Row>
            <Row label="Currency">
              <Field value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v.toUpperCase() }))} placeholder="GBP" />
            </Row>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Booking ref">
              <Field value={draft.bookingRef} onChange={(v) => setDraft((d) => ({ ...d, bookingRef: v }))} placeholder="optional" />
            </Row>
            <Row label="URL">
              <Field value={draft.url} onChange={(v) => setDraft((d) => ({ ...d, url: v }))} placeholder="https://…" mono={false} />
            </Row>
          </div>

          <Row label="Notes">
            <Field value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="optional" mono={false} />
          </Row>
        </div>

        <footer style={modalFooter}>
          <Btn onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" variant="solid" color={COLORS.gold}>Save</Btn>
        </footer>
      </form>
    </div>
  );
}

function ReservationModal({ initial, onClose, onSave }) {
  const [draft, setDraft] = useState({
    type: 'flight', name: '', code: '', datetime: '', endDatetime: '', notes: '', url: '',
    ...initial,
  });
  const onSubmit = (e) => { e?.preventDefault(); onSave(draft); };
  return (
    <div role="dialog" onClick={onClose} style={modalBackdrop}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} style={modalCard}>
        <header style={modalHeader}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>RESERVATION</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{initial._id ? 'Edit' : 'Add'} booking</div>
          </div>
          <button onClick={onClose} type="button" style={modalClose}>×</button>
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Type">
              <Select
                value={draft.type}
                onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                options={RES_TYPES.map((t) => ({ v: t, l: t }))}
              />
            </Row>
            <Row label="Confirmation code">
              <Field value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="ABC123" />
            </Row>
          </div>
          <Row label="Name">
            <Field value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="BA 0286 LHR→JFK" mono={false} />
          </Row>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Start">
              <Field type="datetime-local" value={draft.datetime} onChange={(v) => setDraft((d) => ({ ...d, datetime: v }))} />
            </Row>
            <Row label="End">
              <Field type="datetime-local" value={draft.endDatetime} onChange={(v) => setDraft((d) => ({ ...d, endDatetime: v }))} />
            </Row>
          </div>
          <Row label="URL">
            <Field value={draft.url} onChange={(v) => setDraft((d) => ({ ...d, url: v }))} placeholder="https://…" mono={false} />
          </Row>
          <Row label="Notes">
            <Field value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="optional" mono={false} />
          </Row>
        </div>

        <footer style={modalFooter}>
          <Btn onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" variant="solid" color={COLORS.gold}>Save</Btn>
        </footer>
      </form>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────
function Row({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
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

const modalBackdrop = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const modalCard = {
  background: COLORS.panel, border: '1px solid ' + COLORS.line,
  borderRadius: 14, width: 560, maxWidth: '100%', maxHeight: '90vh',
  overflow: 'auto', color: COLORS.text,
  display: 'flex', flexDirection: 'column',
};
const modalHeader = {
  padding: '18px 22px', borderBottom: '1px solid ' + COLORS.line,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const modalClose = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: COLORS.muted, fontSize: 22, lineHeight: 1, padding: 4,
};
const modalFooter = {
  padding: '14px 22px', borderTop: '1px solid ' + COLORS.line,
  display: 'flex', gap: 8, justifyContent: 'flex-end',
};
