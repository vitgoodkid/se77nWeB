// 04 PLAN · per-trip day-by-day stage path + checklist + reservations + budget.
// Drag-reorder and Google Places "suggest" punted to v0.5; v1 has inline add + modal edit.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import { tripToICS, downloadBlob, createShareLink } from './exports.js';
import {
  GOLD, ON, PIN_FILL,
  CardTitle, Chk, Empty as EmptyState, ErrorNote, FormRow, GoalFlag, IconCheck, IconCopy, IconHourglass, Label, Loading,
  PxDialog, PxSelect, Seg, Tag, XBtn, fieldStyle,
} from './kit.jsx';

const TYPES = [
  { id: 'see',   label: 'SEE',   color: PIN_FILL.see },
  { id: 'eat',   label: 'EAT',   color: PIN_FILL.eat },
  { id: 'move',  label: 'MOVE',  color: PIN_FILL.move },
  { id: 'stay',  label: 'STAY',  color: PIN_FILL.stay },
  { id: 'other', label: 'OTHER', color: PIN_FILL.other },
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
    <div style={{ padding: '6px 6px 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
        {daysLeft !== null && daysLeft > 0 && daysLeft <= 30 && (
          <CountdownBanner daysLeft={daysLeft} checklist={checklist} items={items} />
        )}

        <Toolbar
          viewMode={viewMode} onViewChange={setViewMode}
          onPromote={onPromote}
          onExportICS={onExportICS}
          onShare={onShare}
        />

        <main style={{ minWidth: 0 }}>
          {loading && !items.length ? (
            <Loading label="loading plan" />
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

        <aside className="tv-g4" style={{ gap: '32px 28px', alignItems: 'stretch' }}>
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
    <PxDialog
      onClose={onClose}
      width={500}
      kicker="SHARE · READ-ONLY LINK"
      title="Read-only link"
      footer={<PxButton onClick={onClose} style={{ height: 44 }}>DONE</PxButton>}
    >
      {state.loading && <Loading label="creating snapshot" />}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.url && (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: COLORS.muted, margin: 0 }}>
            Anyone with this URL can view a read-only snapshot. Expires in 30 days.
          </p>
          <label className="sr" htmlFor="tv-share-url-plan">Share link</label>
          <input
            id="tv-share-url-plan"
            readOnly
            value={state.url}
            onFocus={(e) => e.target.select()}
            className="mono field"
            style={{ ...fieldStyle, fontSize: 13 }}
          />
          <div style={{ padding: '0 8px 8px 0' }}>
            <PxButton onClick={() => navigator.clipboard?.writeText(state.url)} fill={GOLD} style={{ height: 44 }}>
              COPY LINK
            </PxButton>
          </div>
        </>
      )}
    </PxDialog>
  );
}

function Empty() {
  return (
    <div className="px" style={{ background: COLORS.paper, margin: 6 }}>
      <EmptyBox title="NO TRIP SELECTED" hint="no trip selected — pick one from LIST" />
    </div>
  );
}

// Gold countdown strip with the stage-clear progress bar.
function CountdownBanner({ daysLeft, checklist, items }) {
  const todo = checklist.filter((c) => !c.done).length;
  const doneStops = items.filter((it) => it.status === 'done').length;
  const pct = items.length ? (doneStops / items.length) * 100 : 0;
  return (
    <div className="pxs" role="status" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 28px',
      padding: '14px 18px', margin: '0 3px', color: ON, background: GOLD,
    }}>
      <span className="sk" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <IconHourglass size={16} />
        <span><strong>{daysLeft}</strong> days to go {todo > 0 && `· ${todo} checklist items left`}</span>
      </span>
      {items.length > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <span className="sk" style={{ fontSize: 11 }}>STAGES CLEAR {doneStops}/{items.length}</span>
          <span aria-hidden="true" style={{ display: 'block', width: 160, height: 16, background: '#fffaf0', border: '3px solid #1b1410' }}>
            <span style={{ display: 'block', height: '100%', width: pct + '%', background: 'repeating-linear-gradient(90deg, #2f7a3d 0 10px, transparent 10px 12px)' }} />
          </span>
        </span>
      )}
    </div>
  );
}

function Toolbar({ viewMode, onViewChange, onPromote, onExportICS, onShare }) {
  const btn = { height: 40, fontSize: 12 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '0 3px' }}>
      <Seg options={VIEW_MODES} value={viewMode} onChange={onViewChange} ariaLabel="Plan view" />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, flexWrap: 'wrap', padding: '0 8px 8px 0' }}>
        <PxButton onClick={onExportICS} style={btn}>↓ ICAL</PxButton>
        <PxButton onClick={() => window.print()} style={btn}>↓ PDF</PxButton>
        <PxButton onClick={onShare} style={btn}>↗ SHARE</PxButton>
        <PxButton onClick={onPromote} fill={GOLD} style={btn}>PROMOTE →</PxButton>
      </div>
    </div>
  );
}

// ─── Stage path (kanban) ────────────────────────────────────────
function dayNode(dayItems) {
  const done = dayItems.filter((it) => it.status === 'done').length;
  if (dayItems.length && done === dayItems.length) return { bg: '#7fd18b', color: ON, done };
  if (dayItems.length) return { bg: GOLD, color: ON, done };
  return { bg: COLORS.paper, color: COLORS.text, done };
}

function Kanban({ trip, days, itemsByDay, onAddItem, onEditItem, onDeleteItem, onToggleStatus }) {
  return (
    <div style={{ overflowX: 'auto', padding: '6px 12px 16px 4px' }}>
      <ol className="tv-days" aria-label="Day-by-day plan" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {Array.from({ length: days }, (_, i) => {
          const lbl = dayLabel(trip, i);
          const dayItems = itemsByDay[i] || [];
          const node = dayNode(dayItems);
          const last = i === days - 1;
          return (
            <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
                {!last && (
                  <span className="tv-link" aria-hidden="true" style={{
                    position: 'absolute', left: 50, right: -24, top: 20, borderTop: '4px dashed var(--tv-link)',
                  }} />
                )}
                <span className="pf pxs" style={{
                  position: 'relative', display: 'grid', placeItems: 'center', flexShrink: 0,
                  width: 44, height: 44, fontSize: 20, color: node.color, background: node.bg,
                }}>{i + 1}</span>
                <span style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', gap: 3,
                  padding: '2px 8px', background: COLORS.bg, minWidth: 0,
                }}>
                  <span className="sk" style={{ fontSize: 12 }}>{typeof lbl === 'string' ? lbl : lbl.d1}</span>
                  <span style={{ fontSize: 12, color: COLORS.muted }}>
                    {typeof lbl !== 'string' && `${lbl.date} · `}
                    {dayItems.length ? `${node.done}/${dayItems.length} clear` : 'free'}
                  </span>
                </span>
                {last && <span style={{ position: 'relative', marginLeft: 'auto' }}><GoalFlag size={24} /></span>}
              </div>

              <div className="pxs tv-daybody" style={{
                display: 'flex', flexDirection: 'column', gap: 12, flex: 1,
                padding: 12, background: COLORS.paper,
              }}>
                {dayItems.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onAddItem(i)}
                    className="tv-add"
                    style={{
                      flex: 1, minHeight: 140,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, color: COLORS.muted, background: COLORS.field,
                      border: '3px dashed var(--rule)',
                    }}
                  >
                    <span>{tripDays(trip) ? '8h free' : 'EMPTY DAY'}</span>
                    <span className="sk" style={{ fontSize: 11, color: COLORS.text }}>+ ADD STOP</span>
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
                      type="button"
                      onClick={() => onAddItem(i)}
                      className="sk tv-add"
                      style={{
                        height: 36, marginTop: 'auto', fontSize: 11, color: COLORS.text,
                        background: COLORS.paper, border: '3px dashed var(--rule)',
                      }}
                    >+ ADD STOP</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PlanItem({ item, onEdit, onDelete, onToggle }) {
  const t = TYPES.find((x) => x.id === item.type) || TYPES[4];
  const done = item.status === 'done';
  const skipped = item.status === 'skipped';
  const meta = [
    item.timeStart,
    item.estCost > 0 ? `${(item.currency || '').slice(0, 1)}${item.estCost}` : null,
    item.status || 'planned',
  ].filter(Boolean).join(' · ');
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit stop: ${item.title}`}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter') onEdit(); }}
      className="tv-row"
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 6px 8px 10px',
        background: COLORS.field, border: '3px solid var(--ink)',
        opacity: skipped ? 0.6 : 1,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Chk on={done} onClick={onToggle} label={done ? 'Mark planned' : 'Mark done'} />
        <Tag fill={t.color}>{t.label}</Tag>
        <XBtn onClick={onDelete} label={`Remove stop: ${item.title}`} style={{ marginLeft: 'auto' }} />
      </span>
      <span style={{
        fontSize: 13, fontWeight: 700, lineHeight: 1.35,
        color: done ? 'var(--green-ink)' : skipped ? COLORS.muted : COLORS.text,
        textDecoration: skipped ? 'line-through' : 'none',
      }}>
        {item.title}
      </span>
      <span style={{ fontSize: 11, color: COLORS.muted }}>{meta}</span>
    </div>
  );
}

// ─── Timeline / List ────────────────────────────────────────────
function Timeline({ trip, days, itemsByDay, onEditItem }) {
  return (
    <ol className="px" style={{
      display: 'flex', flexDirection: 'column', margin: '0 8px 8px 4px', padding: '6px 22px',
      listStyle: 'none', background: COLORS.paper,
    }}>
      {Array.from({ length: days }, (_, i) => {
        const lbl = dayLabel(trip, i);
        const items = itemsByDay[i] || [];
        const node = dayNode(items);
        return (
          <li key={i} style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px',
            padding: '14px 0', borderBottom: i < days - 1 ? '3px dashed var(--rule)' : 0,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: 190, flexShrink: 0 }}>
              <span className="pf pxs" style={{
                display: 'grid', placeItems: 'center', width: 36, height: 36, fontSize: 16,
                color: node.color, background: node.bg,
              }}>{i + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="sk" style={{ fontSize: 11 }}>{typeof lbl === 'string' ? lbl : lbl.d1}</span>
                {typeof lbl !== 'string' && <span style={{ fontSize: 11, color: COLORS.muted }}>{lbl.date}</span>}
              </span>
            </span>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, padding: 3 }}>
              {items.length === 0 ? (
                <span style={{ color: COLORS.muted, fontSize: 13, fontStyle: 'italic' }}>nothing planned</span>
              ) : items.map((it) => {
                const t = TYPES.find((x) => x.id === it.type) || TYPES[4];
                return (
                  <button
                    key={it._id}
                    type="button"
                    onClick={() => onEditItem(it)}
                    className="pxs tv-row"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                      background: COLORS.paper, border: 0, color: COLORS.text, fontSize: 13,
                      textDecoration: it.status === 'skipped' ? 'line-through' : 'none',
                    }}
                  >
                    <Tag fill={t.color} style={{ fontSize: 9 }}>{t.label}</Tag>
                    {it.timeStart && <span style={{ color: COLORS.muted, fontSize: 12 }}>{it.timeStart}</span>}
                    <span style={{ color: it.status === 'done' ? 'var(--green-ink)' : COLORS.text }}>{it.title}</span>
                  </button>
                );
              })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FlatList({ trip, days, itemsByDay, onEditItem }) {
  const rows = Array.from({ length: days }, (_, i) => itemsByDay[i] || []).flat();
  return (
    <div className="px" style={{
      background: COLORS.paper, overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 8px 8px 4px',
    }}>
      <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13 }}>
        <caption className="sr">Plan items</caption>
        <thead>
          <tr>
            <Th first>DAY</Th><Th>TIME</Th><Th>TYPE</Th><Th>TITLE</Th><Th right>COST</Th><Th last>STATUS</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, idx) => {
            const t = TYPES.find((x) => x.id === it.type);
            const end = idx === rows.length - 1;
            return (
              <tr
                key={it._id}
                onClick={() => onEditItem(it)}
                onKeyDown={(e) => { if (e.key === 'Enter') onEditItem(it); }}
                tabIndex={0}
                className="tv-row"
              >
                <Td end={end} first><span className="sk" style={{ fontSize: 11 }}>D{(it.dayIndex ?? 0) + 1}</span></Td>
                <Td end={end} muted>{it.timeStart || '—'}</Td>
                <Td end={end}>{t ? <Tag fill={t.color}>{t.label}</Tag> : (it.type || '—').toUpperCase()}</Td>
                <Td end={end}>
                  <span style={{
                    color: it.status === 'done' ? 'var(--green-ink)' : COLORS.text,
                    textDecoration: it.status === 'skipped' ? 'line-through' : 'none',
                  }}>{it.title}</span>
                </Td>
                <Td end={end} right><strong>{it.estCost ? `${it.currency || ''} ${it.estCost}` : '—'}</strong></Td>
                <Td end={end} last muted><span className="sk" style={{ fontSize: 11, textTransform: 'uppercase' }}>{it.status || 'planned'}</span></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyBox title="NO STOPS YET" hint="Switch to KANBAN to add stops day by day." />}
    </div>
  );
}

function Th({ children, right, first, last }) {
  return <th className="sk" scope="col" style={{
    textAlign: right ? 'right' : 'left',
    padding: `14px ${last ? 18 : 12}px 12px ${first ? 18 : 12}px`, fontSize: 11, fontWeight: 700,
    color: COLORS.muted, borderBottom: '3px dashed var(--rule)', whiteSpace: 'nowrap',
  }}>{children}</th>;
}
function Td({ children, right, first, last, end, muted }) {
  return <td style={{
    padding: `11px ${last ? 18 : 12}px 11px ${first ? 18 : 12}px`, textAlign: right ? 'right' : 'left',
    color: muted ? COLORS.muted : COLORS.text, borderBottom: end ? 0 : '3px dashed var(--rule)', verticalAlign: 'middle',
  }}>{children}</td>;
}

function EmptyBox(props) {
  return <EmptyState {...props} />;
}

// ─── Checklist + reservations + budget ──────────────────────────
function RailCard({ title, right, children, labelId }) {
  return (
    <section className="px" aria-labelledby={labelId} style={{
      background: COLORS.paper, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 30 }}>
        <CardTitle id={labelId}>{title}</CardTitle>
        {right}
      </div>
      {children}
    </section>
  );
}

function ChecklistCard({ checklist, onToggle, onRemove, onAdd }) {
  const [text, setText] = useState('');
  const done = checklist.filter((c) => c.done).length;
  return (
    <RailCard title={`PRE-TRIP · ${done}/${checklist.length}`} labelId="tv-check-h">
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none', maxHeight: 240, overflowY: 'auto' }}>
        {checklist.map((c) => (
          <li key={c._id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Chk on={c.done} onClick={() => onToggle(c._id, c.done)} label={c.text} />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35,
              color: c.done ? COLORS.muted : COLORS.text,
              textDecoration: c.done ? 'line-through' : 'none',
            }}>{c.text}</span>
            <XBtn onClick={() => onRemove(c._id)} label="Remove item" />
          </li>
        ))}
        {checklist.length === 0 && (
          <li style={{ color: COLORS.muted, fontSize: 13 }}>nothing yet</li>
        )}
      </ul>
      <label style={{ marginTop: 'auto', padding: 3 }}>
        <span className="sr">Add checklist item</span>
        <Field value={text} onChange={setText} placeholder="add item…" mono={false}
          style={{ ...fieldStyle, height: 40, fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(text); setText(''); } }}
        />
      </label>
    </RailCard>
  );
}

function ReservationsCard({ reservations, onAdd, onEdit, onRemove }) {
  return (
    <RailCard
      title={`RESERVATIONS · ${reservations.length}`}
      labelId="tv-res-h"
      right={<button type="button" onClick={onAdd} className="chip-px sk" style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }}>+ ADD</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reservations.map((r) => (
          <div
            key={r._id}
            role="button"
            tabIndex={0}
            aria-label={`Edit reservation ${r.name || r.type || ''}`}
            onClick={() => onEdit(r)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEdit(r); }}
            className="tv-row"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px 8px 10px',
              background: COLORS.field, border: '3px solid var(--ink)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
                {r.name || (r.type || '').toUpperCase()}
              </span>
              <span className="sk" style={{ fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>
                {(r.type || '')} · {r.code || '—'} {r.datetime ? `· ${r.datetime.slice(0, 16).replace('T', ' ')}` : ''}
              </span>
            </span>
            {r.code && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.code); }}
                title="Copy code"
                aria-label="Copy code"
                className="tv-x"
              ><IconCopy size={15} /></button>
            )}
            <XBtn onClick={() => onRemove(r._id)} label="Remove reservation" />
          </div>
        ))}
        {reservations.length === 0 && (
          <span style={{ color: COLORS.muted, fontSize: 13 }}>none yet</span>
        )}
      </div>
    </RailCard>
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
    <RailCard title="TEMPLATE" labelId="tv-tpl-h">
      <p style={{ fontSize: 13, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>
        Save this trip's structure (pins + plan + checklist) to reuse on a future trip.
      </p>
      <div style={{ marginTop: 'auto', padding: '0 8px 8px 0' }}>
        <PxButton onClick={onSave} disabled={saving} style={{ height: 40, fontSize: 11 }}>
          {saving ? '…' : '↓ SAVE AS TEMPLATE'}
        </PxButton>
      </div>
      {savedName && (
        <div className="sk" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--green-ink)' }}>
          <IconCheck size={12} /> saved as "{savedName}"
        </div>
      )}
    </RailCard>
  );
}

function BudgetCard({ trip, totalEst }) {
  const total = trip.budget?.total || 0;
  const daily = trip.budget?.daily || 0;
  const pct = total ? Math.min(100, (totalEst / total) * 100) : 0;
  return (
    <RailCard title="BUDGET" labelId="tv-budget-h">
      <Row label={`Daily${trip.tripCurrency ? ' · ' + trip.tripCurrency : ''}`}>
        <Field
          value={daily}
          onChange={() => {}}
          placeholder="0"
          mono
          style={{ ...fieldStyle, height: 40, fontSize: 13 }}
        />
      </Row>
      <Label style={{ fontSize: 10 }}>PLAN VS BUDGET · {total ? Math.round(pct) + '%' : '—'}</Label>
      <span aria-hidden="true" style={{ display: 'block', height: 18, background: COLORS.paper, border: '3px solid var(--ink)' }}>
        <span style={{
          display: 'block', height: '100%', width: `${pct}%`,
          background: `repeating-linear-gradient(90deg, ${pct > 100 ? '#ff7a7a' : GOLD} 0 10px, transparent 10px 12px)`,
        }} />
      </span>
      <div style={{ fontSize: 12, color: COLORS.muted }}>
        est. plan: {(trip.tripCurrency || '')} {totalEst.toFixed(0)} / {total || '—'}
      </div>
    </RailCard>
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
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      kicker={initial._id ? 'EDIT' : 'NEW STOP'}
      title="Plan a stop"
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" fill={GOLD} style={{ height: 44 }}>SAVE</PxButton>
      </>}
    >
      <Row label="Title">
        <Field value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} placeholder="Dishoom Shoreditch" mono={false} autoFocus style={fieldStyle} />
      </Row>

      <div className="tv-g3" style={{ gap: 18 }}>
        <Row label="Day">
          <PxSelect
            value={draft.dayIndex ?? 0}
            onChange={(v) => setDraft((d) => ({ ...d, dayIndex: Number(v) }))}
            options={Array.from({ length: days }, (_, i) => ({ v: i, l: `Day ${i + 1}` }))}
          />
        </Row>
        <Row label="Start">
          <Field type="time" value={draft.timeStart || ''} onChange={(v) => setDraft((d) => ({ ...d, timeStart: v }))} style={fieldStyle} />
        </Row>
        <Row label="End">
          <Field type="time" value={draft.timeEnd || ''} onChange={(v) => setDraft((d) => ({ ...d, timeEnd: v }))} style={fieldStyle} />
        </Row>
      </div>

      <div className="tv-g2" style={{ gap: 18 }}>
        <Row label="Type">
          <PxSelect
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
            options={TYPES.map((t) => ({ v: t.id, l: t.label }))}
          />
        </Row>
        <Row label="Status">
          <PxSelect
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            options={STATUS.map((s) => ({ v: s, l: s }))}
          />
        </Row>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <Row label="Estimated cost">
          <Field type="number" value={draft.estCost} onChange={(v) => setDraft((d) => ({ ...d, estCost: v }))} placeholder="24" style={fieldStyle} />
        </Row>
        <Row label="Currency">
          <Field value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v.toUpperCase() }))} placeholder="GBP" style={fieldStyle} />
        </Row>
      </div>

      <div className="tv-g2" style={{ gap: 18 }}>
        <Row label="Booking ref">
          <Field value={draft.bookingRef} onChange={(v) => setDraft((d) => ({ ...d, bookingRef: v }))} placeholder="optional" style={fieldStyle} />
        </Row>
        <Row label="URL">
          <Field value={draft.url} onChange={(v) => setDraft((d) => ({ ...d, url: v }))} placeholder="https://…" mono={false} style={fieldStyle} />
        </Row>
      </div>

      <Row label="Notes">
        <Field value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="optional" mono={false} style={fieldStyle} />
      </Row>
    </PxDialog>
  );
}

function ReservationModal({ initial, onClose, onSave }) {
  const [draft, setDraft] = useState({
    type: 'flight', name: '', code: '', datetime: '', endDatetime: '', notes: '', url: '',
    ...initial,
  });
  const onSubmit = (e) => { e?.preventDefault(); onSave(draft); };
  return (
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      kicker="RESERVATION"
      title={`${initial._id ? 'Edit' : 'Add'} booking`}
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" fill={GOLD} style={{ height: 44 }}>SAVE</PxButton>
      </>}
    >
      <div className="tv-g2" style={{ gap: 18 }}>
        <Row label="Type">
          <PxSelect
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
            options={RES_TYPES.map((t) => ({ v: t, l: t }))}
          />
        </Row>
        <Row label="Confirmation code">
          <Field value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="ABC123" style={fieldStyle} />
        </Row>
      </div>
      <Row label="Name">
        <Field value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="BA 0286 LHR→JFK" mono={false} style={fieldStyle} />
      </Row>
      <div className="tv-g2" style={{ gap: 18 }}>
        <Row label="Start">
          <Field type="datetime-local" value={draft.datetime} onChange={(v) => setDraft((d) => ({ ...d, datetime: v }))} style={fieldStyle} />
        </Row>
        <Row label="End">
          <Field type="datetime-local" value={draft.endDatetime} onChange={(v) => setDraft((d) => ({ ...d, endDatetime: v }))} style={fieldStyle} />
        </Row>
      </div>
      <Row label="URL">
        <Field value={draft.url} onChange={(v) => setDraft((d) => ({ ...d, url: v }))} placeholder="https://…" mono={false} style={fieldStyle} />
      </Row>
      <Row label="Notes">
        <Field value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="optional" mono={false} style={fieldStyle} />
      </Row>
    </PxDialog>
  );
}

// ─── Helpers ────────────────────────────────────────────────────
function Row({ label, children }) {
  return <FormRow label={label}>{children}</FormRow>;
}
