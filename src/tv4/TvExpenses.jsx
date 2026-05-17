// 05 EXPENSES · per-trip transactions table + add modal + FX panel + settle flow.
// No photo/OCR scan flows (spec strips those). PAID BY column drives tripmate netting.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';
import { txnsToCSV, downloadBlob } from './exports.js';

const BUILTIN_CATEGORIES = ['food', 'stay', 'transport', 'shopping', 'other'];
const METHODS = ['cash', 'card', 'ic', 'transfer'];

const CAT_COLORS = {
  food:      COLORS.gold,
  stay:      COLORS.green,
  transport: COLORS.red,
  shopping:  '#9bb4ff',
  other:     'rgba(245,237,224,0.4)',
};

// Quick-add keyword → category mapping. Lowercased substring match.
const QUICK_KEYWORDS = {
  food:      ['ramen', 'sushi', 'pizza', 'coffee', 'lunch', 'dinner', 'breakfast', 'snack', 'pho', 'cafe', 'food', 'eat', 'restaurant'],
  stay:      ['hotel', 'airbnb', 'hostel', 'ryokan', 'stay', 'lodging'],
  transport: ['taxi', 'uber', 'train', 'subway', 'bus', 'flight', 'metro', 'lyft', 'transit', 'fare', 'jr'],
  shopping:  ['shop', 'store', 'mall', 'gift', 'clothes', 'electronics', 'souvenir'],
};

function quickParse(text, fallbackCurrency) {
  // Pull the last numeric token as amount; rest is name.
  const m = text.match(/^(.*?)([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z]{3})?\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  const amount = Number(m[2].replace(',', '.'));
  const currency = (m[3] || fallbackCurrency || 'USD').toUpperCase();
  const lc = name.toLowerCase();
  let category = 'other';
  for (const [cat, words] of Object.entries(QUICK_KEYWORDS)) {
    if (words.some((w) => lc.includes(w))) { category = cat; break; }
  }
  return { name, amount, currency, category };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function TvExpenses({ trip }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [fx, setFx] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [showSettle, setShowSettle] = useState(false);

  const tripId = trip?._id;
  const tripCurrency = trip?.tripCurrency || 'USD';
  const baseCurrency = settings?.baseCurrency || 'USD';

  // Initial load: txns + settings + fx
  const refresh = useCallback(async () => {
    if (!tripId) return;
    setLoading(true); setError(null);
    try {
      const [tRes, sRes, fxRes] = await Promise.all([
        tv4.list('transactions', { tripId }),
        tv4.getSettings(),
        fetch(`/api/fx?base=${encodeURIComponent(baseCurrency || 'USD')}`, { credentials: 'include' })
          .then((r) => r.ok ? r.json() : null)
          .catch(() => null),
      ]);
      setTransactions(tRes.docs || []);
      setSettings(sRes.doc || null);
      setFx(fxRes?.snapshot || null);
    } catch (e) {
      setError(e.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [tripId, baseCurrency]);

  useEffect(() => { refresh(); }, [refresh]);

  const allCategories = useMemo(
    () => [...BUILTIN_CATEGORIES, ...(settings?.customCategories || [])],
    [settings],
  );

  // Convert any amount to trip currency using fx rates (anchored to settings.baseCurrency).
  const convertToTrip = useCallback((amt, ccy) => {
    if (!amt) return 0;
    if (!ccy || ccy.toUpperCase() === tripCurrency.toUpperCase()) return amt;
    if (!fx || !fx.rates) return amt; // no rates → display raw
    const base = (fx.base || 'USD').toUpperCase();
    const t = tripCurrency.toUpperCase();
    const c = ccy.toUpperCase();
    // We have rates relative to fx.base. amt[ccy] → amt[base] → amt[trip].
    const rateFromCcy = c === base ? 1 : fx.rates[c];
    const rateToTrip = t === base ? 1 : fx.rates[t];
    if (!rateFromCcy || !rateToTrip) return amt;
    const inBase = amt / rateFromCcy;
    return inBase * rateToTrip;
  }, [fx, tripCurrency]);

  const totals = useMemo(() => {
    let spend = 0;
    const byCat = {}, byMethod = { cash: 0, card: 0, ic: 0, transfer: 0 };
    const byPaidBy = {}, byDay = {};
    for (const t of transactions) {
      const v = convertToTrip(Number(t.amount) || 0, t.currency);
      spend += v;
      const cat = t.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + v;
      if (t.method) byMethod[t.method] = (byMethod[t.method] || 0) + v;
      const payer = t.paidBy || 'me';
      byPaidBy[payer] = (byPaidBy[payer] || 0) + v;
      const d = t.date || '—';
      byDay[d] = (byDay[d] || 0) + v;
    }
    return { spend, byCat, byMethod, byPaidBy, byDay };
  }, [transactions, convertToTrip]);

  // Budget alert — based on daily today.
  const todayKey = todayISO();
  const dailyBudget = trip.budget?.daily || 0;
  const spentToday = totals.byDay[todayKey] || 0;
  const budgetPct = dailyBudget ? (spentToday / dailyBudget) * 100 : 0;
  const overBudget = dailyBudget > 0 && budgetPct >= 100;
  const wayOver = dailyBudget > 0 && budgetPct >= 130;

  const onDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      await tv4.remove('transactions', id);
      setTransactions((arr) => arr.filter((t) => t._id !== id));
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }, []);

  if (!trip) return <Empty />;

  return (
    <div style={{ height: '100%', overflow: 'auto', position: 'relative' }}>
      <div style={{
        padding: isMobile ? 12 : 18,
        display: 'grid',
        gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0, 1fr) 320px',
        gap: 18,
      }}>
        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {overBudget && (
            <BudgetBanner
              budgetPct={budgetPct}
              wayOver={wayOver}
              spent={spentToday}
              budget={dailyBudget}
              currency={tripCurrency}
            />
          )}

          <KpiRow
            totals={totals}
            tripCurrency={tripCurrency}
            txnCount={transactions.length}
          />

          {error && <ErrorRow error={error} onRetry={refresh} />}

          <TxnTable
            transactions={transactions}
            tripCurrency={tripCurrency}
            convertToTrip={convertToTrip}
            onEdit={setEditingTx}
            onDelete={onDelete}
            loading={loading}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <button
              onClick={() => {
                const csv = txnsToCSV(transactions, tripCurrency);
                downloadBlob(csv, `${trip.slug || 'trip'}-transactions.csv`, 'text/csv');
              }}
              className="mono"
              style={{
                background: 'transparent', border: '1px solid ' + COLORS.line,
                borderRadius: 8, padding: '6px 12px',
                color: COLORS.muted, cursor: 'pointer',
                fontSize: 10, letterSpacing: '0.16em',
              }}
            >↓ EXPORT CSV</button>
            <a
              href="#/tv4/list"
              style={{
                fontSize: 12, color: COLORS.muted,
                textDecoration: 'none',
              }}
              className="mono"
            >See spending patterns across all trips →</a>
          </div>
        </main>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CategoryBreakdown byCat={totals.byCat} currency={tripCurrency} />
          <CashVsCard byMethod={totals.byMethod} currency={tripCurrency} />
          <FxCard fx={fx} baseCurrency={baseCurrency} tripCurrency={tripCurrency} onRefresh={refresh} />
          {settings?.tripmates?.length > 0 && (
            <Btn onClick={() => setShowSettle(true)}>SETTLE WITH TRIPMATE</Btn>
          )}
        </aside>
      </div>

      <FloatingAddButton onClick={() => setShowAdd(true)} />

      {showAdd && (
        <AddTxnModal
          trip={trip}
          allCategories={allCategories}
          tripmates={settings?.tripmates || []}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await refresh(); }}
        />
      )}

      {editingTx && (
        <EditTxnModal
          txn={editingTx}
          trip={trip}
          allCategories={allCategories}
          tripmates={settings?.tripmates || []}
          onClose={() => setEditingTx(null)}
          onSaved={async () => { setEditingTx(null); await refresh(); }}
        />
      )}

      {showSettle && (
        <SettleModal
          tripmates={settings?.tripmates || []}
          transactions={transactions}
          convertToTrip={convertToTrip}
          tripCurrency={tripCurrency}
          onClose={() => setShowSettle(false)}
        />
      )}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">
      ◇ no trip selected
    </div>
  );
}

function BudgetBanner({ budgetPct, wayOver, spent, budget, currency }) {
  const c = wayOver ? COLORS.red : COLORS.gold;
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      background: c + '12', border: `1px solid ${c}55`,
      color: c, fontSize: 12, display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', gap: 12,
    }}>
      <span>
        ⚠ Today's spend is at <strong>{Math.round(budgetPct)}%</strong> of daily budget
        ({formatMoney(spent, currency)} / {formatMoney(budget, currency)})
      </span>
    </div>
  );
}

function ErrorRow({ error, onRetry }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
      color: COLORS.red, fontSize: 12,
    }}>
      ◇ load error: {error} ·{' '}
      <button onClick={onRetry} style={{
        background: 'transparent', border: 'none', color: COLORS.red,
        cursor: 'pointer', textDecoration: 'underline',
      }}>retry</button>
    </div>
  );
}

function KpiRow({ totals, tripCurrency, txnCount }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const tiles = [
    { k: 'SPEND',  v: formatMoney(totals.spend, tripCurrency) },
    { k: 'TXNS',   v: txnCount },
    { k: 'AVG/DAY', v: formatMoney(totals.spend / Math.max(Object.keys(totals.byDay).length, 1), tripCurrency) },
    { k: 'CASH',   v: formatMoney(totals.byMethod.cash || 0, tripCurrency) },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
      gap: 8,
    }}>
      {tiles.map((t) => (
        <div key={t.k} style={{
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 10, padding: 12, minWidth: 0,
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted }}>{t.k}</div>
          <div className="mono" style={{
            fontSize: 18, fontWeight: 700, marginTop: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.v}</div>
        </div>
      ))}
    </div>
  );
}

function TxnTable({ transactions, tripCurrency, convertToTrip, onEdit, onDelete, loading }) {
  if (loading && !transactions.length) {
    return <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">◇ loading…</div>;
  }
  if (!transactions.length) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', color: COLORS.muted, fontSize: 13,
        border: '1px dashed ' + COLORS.line, borderRadius: 12,
      }}>
        No transactions yet — tap the + button to add one
      </div>
    );
  }
  const sorted = transactions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 12,
      overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid ' + COLORS.line }}>
            <Th>DATE</Th><Th>CAT</Th><Th>NAME</Th><Th right>AMOUNT</Th><Th>METHOD</Th><Th>PAID BY</Th><Th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr
              key={t._id}
              onClick={() => onEdit(t)}
              style={{ borderBottom: '1px solid ' + COLORS.line, cursor: 'pointer' }}
            >
              <Td>{t.date || '—'}</Td>
              <Td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: CAT_COLORS[t.category] || CAT_COLORS.other,
                  }} />
                  {t.customCategory || t.category || 'other'}
                </span>
              </Td>
              <Td>{t.name || '—'}</Td>
              <Td right>
                <span className="mono">
                  {formatMoney(t.amount, t.currency || tripCurrency)}
                </span>
                {t.currency && t.currency.toUpperCase() !== tripCurrency.toUpperCase() && (
                  <span className="mono" style={{ display: 'block', fontSize: 10, color: COLORS.muted }}>
                    ≈ {formatMoney(convertToTrip(t.amount, t.currency), tripCurrency)}
                  </span>
                )}
              </Td>
              <Td>{t.method || '—'}</Td>
              <Td>{t.paidBy || 'me'}</Td>
              <Td>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(t._id); }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: COLORS.muted, fontSize: 14,
                  }}
                >×</button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th
      className="mono"
      style={{
        textAlign: right ? 'right' : 'left',
        padding: '10px 12px',
        fontSize: 9, letterSpacing: '0.2em',
        color: COLORS.muted, fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >{children}</th>
  );
}

function Td({ children, right }) {
  return (
    <td style={{
      padding: '10px 12px', textAlign: right ? 'right' : 'left',
      color: COLORS.text, verticalAlign: 'top',
    }}>{children}</td>
  );
}

function CategoryBreakdown({ byCat, currency }) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        BY CATEGORY
      </div>
      <div style={{
        display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden',
        background: 'rgba(245,237,224,0.06)', marginBottom: 12,
      }}>
        {entries.length === 0 ? <div style={{ flex: 1 }} /> : entries.map(([c, v]) => (
          <div key={c} style={{
            flex: v / Math.max(total, 1),
            background: CAT_COLORS[c] || CAT_COLORS.other,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {entries.length === 0 ? (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>nothing yet</div>
        ) : entries.map(([c, v]) => (
          <div key={c} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: CAT_COLORS[c] || CAT_COLORS.other }} />
              {c}
            </span>
            <span className="mono" style={{ color: COLORS.text }}>{formatMoney(v, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashVsCard({ byMethod, currency }) {
  const cash = byMethod.cash || 0;
  const card = (byMethod.card || 0) + (byMethod.ic || 0) + (byMethod.transfer || 0);
  const total = cash + card;
  const cashPct = total ? (cash / total) * 100 : 0;
  // Tiny SVG donut.
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10 }}>
        CASH · CARD
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <svg viewBox="0 0 70 70" width="70" height="70">
          <circle cx="35" cy="35" r={r} stroke="rgba(245,237,224,0.08)" strokeWidth="8" fill="none" />
          <circle
            cx="35" cy="35" r={r}
            stroke={COLORS.gold} strokeWidth="8" fill="none"
            strokeDasharray={`${(cashPct / 100) * c} ${c}`}
            strokeDashoffset={c / 4}
            transform="rotate(-90 35 35)"
          />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.gold }} />
            <span style={{ color: COLORS.muted }}>cash</span>
            <span className="mono" style={{ marginLeft: 'auto', color: COLORS.text }}>{formatMoney(cash, currency)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'rgba(245,237,224,0.3)' }} />
            <span style={{ color: COLORS.muted }}>card+</span>
            <span className="mono" style={{ marginLeft: 'auto', color: COLORS.text }}>{formatMoney(card, currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FxCard({ fx, baseCurrency, tripCurrency, onRefresh }) {
  const date = fx?.date || '—';
  const rates = fx?.rates || {};
  const tripRate = rates[tripCurrency?.toUpperCase()];
  return (
    <div style={{ background: COLORS.panel, border: '1px solid ' + COLORS.line, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted }}>
          FX · {baseCurrency} BASE
        </div>
        <button
          onClick={onRefresh}
          style={{
            background: 'transparent', border: 'none', color: COLORS.muted,
            cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          }}
        >↻</button>
      </div>
      <div style={{ fontSize: 12, color: COLORS.text }}>
        {tripRate ? (
          <>
            1 {baseCurrency} = <strong>{tripRate.toFixed(tripRate < 1 ? 4 : 2)}</strong> {tripCurrency}
          </>
        ) : (
          <span style={{ color: COLORS.muted }}>
            {tripCurrency} not in snapshot
          </span>
        )}
      </div>
      <div className="mono" style={{ marginTop: 6, fontSize: 10, color: COLORS.muted, letterSpacing: '0.12em' }}>
        snapshot {date} · {fx?.source ? 'live' : '—'}
      </div>
    </div>
  );
}

function FloatingAddButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Add transaction"
      style={{
        position: 'fixed', bottom: 24, right: 24,
        width: 56, height: 56, borderRadius: 999,
        background: COLORS.gold, color: COLORS.bg,
        border: 'none', cursor: 'pointer',
        fontSize: 28, lineHeight: 1, fontWeight: 700,
        boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        zIndex: 60,
      }}
    >+</button>
  );
}

// ─── Add / edit modal ───────────────────────────────────────────
function AddTxnModal({ trip, allCategories, tripmates, onClose, onSaved }) {
  return (
    <TxnModal
      title="Add transaction"
      initial={{
        date: todayISO(),
        category: 'food',
        name: '',
        amount: '',
        currency: trip.tripCurrency || 'USD',
        method: 'cash',
        paidBy: 'me',
        notes: '',
        recurringCount: 0,
      }}
      tripId={trip._id}
      tripCurrency={trip.tripCurrency || 'USD'}
      allCategories={allCategories}
      tripmates={tripmates}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditTxnModal({ txn, trip, allCategories, tripmates, onClose, onSaved }) {
  return (
    <TxnModal
      title="Edit transaction"
      initial={{
        date: txn.date || todayISO(),
        category: txn.category || 'other',
        customCategory: txn.customCategory,
        name: txn.name || '',
        amount: txn.amount ?? '',
        currency: txn.currency || trip.tripCurrency || 'USD',
        method: txn.method || 'cash',
        paidBy: txn.paidBy || 'me',
        notes: txn.notes || '',
      }}
      editingId={txn._id}
      tripId={trip._id}
      tripCurrency={trip.tripCurrency || 'USD'}
      allCategories={allCategories}
      tripmates={tripmates}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TxnModal({ title, initial, tripId, tripCurrency, editingId, allCategories, tripmates, onClose, onSaved }) {
  const [mode, setMode] = useState(editingId ? 'manual' : 'quick'); // start quick on add
  const [quick, setQuick] = useState('');
  const [tx, setTx] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const onQuickParse = useCallback(() => {
    const parsed = quickParse(quick, tripCurrency);
    if (!parsed) { setError('Could not parse — try "ramen 1280" format'); return; }
    setTx((t) => ({
      ...t,
      name: parsed.name || t.name,
      amount: parsed.amount,
      currency: parsed.currency,
      category: parsed.category,
    }));
    setMode('manual');
    setError(null);
  }, [quick, tripCurrency]);

  const onSubmit = useCallback(async (e) => {
    e?.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const body = {
        tripId,
        date: tx.date,
        category: tx.category,
        customCategory: tx.customCategory,
        name: tx.name || undefined,
        amount: Number(tx.amount),
        currency: (tx.currency || tripCurrency).toUpperCase(),
        method: tx.method,
        paidBy: tx.paidBy,
        notes: tx.notes || undefined,
      };
      if (!Number.isFinite(body.amount)) throw new Error('amount must be a number');

      if (editingId) {
        await tv4.update('transactions', editingId, body);
      } else if (tx.recurringCount && Number(tx.recurringCount) > 0) {
        // Generate N daily records linked via recurringGroupId.
        const groupId = `r-${Date.now().toString(36)}`;
        const start = new Date(body.date);
        const n = Math.min(Number(tx.recurringCount), 90);
        for (let i = 0; i < n; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          await tv4.create('transactions', {
            ...body,
            date: d.toISOString().slice(0, 10),
            recurringGroupId: groupId,
          });
        }
      } else {
        await tv4.create('transactions', body);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'save_failed');
      setSubmitting(false);
    }
  }, [tx, tripId, tripCurrency, editingId, onSaved]);

  return (
    <div role="dialog" onClick={onClose} style={modalBackdrop}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} style={modalCard}>
        <header style={modalHeader}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
              {editingId ? 'EDIT' : 'NEW'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{title}</div>
          </div>
          <button onClick={onClose} type="button" style={modalClose}>×</button>
        </header>

        {!editingId && (
          <div style={{ display: 'flex', gap: 6, padding: '14px 22px 0' }}>
            {['quick', 'manual'].map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="mono"
                  style={{
                    padding: '5px 12px', borderRadius: 999,
                    border: '1px solid ' + (on ? COLORS.gold + '80' : COLORS.line),
                    background: on ? COLORS.gold + '14' : 'transparent',
                    color: on ? COLORS.gold : COLORS.muted,
                    fontSize: 10, letterSpacing: '0.18em', cursor: 'pointer',
                  }}
                >{m.toUpperCase()}</button>
              );
            })}
          </div>
        )}

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'quick' && !editingId && (
            <Row label="Try: 'ramen 1280' or 'taxi 18 USD'">
              <Field
                value={quick}
                onChange={setQuick}
                placeholder="ramen 1280"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onQuickParse(); } }}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Btn type="button" onClick={onQuickParse} variant="tinted" color={COLORS.gold}>Parse →</Btn>
              </div>
            </Row>
          )}

          {mode === 'manual' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Row label="Date">
                  <Field type="date" value={tx.date} onChange={(v) => setTx((t) => ({ ...t, date: v }))} />
                </Row>
                <Row label="Category">
                  <Select
                    value={tx.category}
                    onChange={(v) => setTx((t) => ({ ...t, category: v }))}
                    options={allCategories.map((c) => ({ v: c, l: c }))}
                  />
                </Row>
              </div>
              <Row label="Name / description">
                <Field value={tx.name} onChange={(v) => setTx((t) => ({ ...t, name: v }))} placeholder="Ichiran Shibuya" mono={false} />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <Row label="Amount">
                  <Field type="number" value={tx.amount} onChange={(v) => setTx((t) => ({ ...t, amount: v }))} placeholder="1280" />
                </Row>
                <Row label="Currency">
                  <Field value={tx.currency} onChange={(v) => setTx((t) => ({ ...t, currency: v.toUpperCase() }))} placeholder="JPY" />
                </Row>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Row label="Method">
                  <Select
                    value={tx.method}
                    onChange={(v) => setTx((t) => ({ ...t, method: v }))}
                    options={METHODS.map((m) => ({ v: m, l: m }))}
                  />
                </Row>
                <Row label="Paid by">
                  <Select
                    value={tx.paidBy}
                    onChange={(v) => setTx((t) => ({ ...t, paidBy: v }))}
                    options={[{ v: 'me', l: 'me' }, ...tripmates.map((m) => ({ v: m.id, l: m.name }))]}
                  />
                </Row>
              </div>
              <Row label="Notes">
                <Field value={tx.notes} onChange={(v) => setTx((t) => ({ ...t, notes: v }))} placeholder="optional" mono={false} />
              </Row>
              {!editingId && (
                <Row label="Repeat for N days (optional)">
                  <Field
                    type="number"
                    value={tx.recurringCount || ''}
                    onChange={(v) => setTx((t) => ({ ...t, recurringCount: v }))}
                    placeholder="e.g. 7 for a weekly metro pass"
                  />
                </Row>
              )}
            </>
          )}

          {error && (
            <div style={{
              padding: 10, borderRadius: 8,
              background: COLORS.red + '12', border: `1px solid ${COLORS.red}44`,
              color: COLORS.red, fontSize: 12,
            }}>{error}</div>
          )}
        </div>

        <footer style={modalFooter}>
          <Btn onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" variant="solid" color={COLORS.gold} disabled={submitting}>
            {submitting ? '…' : editingId ? 'Save' : 'Add'}
          </Btn>
        </footer>
      </form>
    </div>
  );
}

// ─── Settle modal ───────────────────────────────────────────────
function SettleModal({ tripmates, transactions, convertToTrip, tripCurrency, onClose }) {
  const breakdown = useMemo(() => {
    const byPayer = { me: 0 };
    for (const m of tripmates) byPayer[m.id] = 0;
    for (const t of transactions) {
      const v = convertToTrip(Number(t.amount) || 0, t.currency);
      const k = t.paidBy && byPayer[t.paidBy] !== undefined ? t.paidBy : 'me';
      byPayer[k] += v;
    }
    const total = Object.values(byPayer).reduce((s, v) => s + v, 0);
    const fair = total / (tripmates.length + 1);
    return Object.entries(byPayer).map(([k, v]) => ({
      id: k,
      name: k === 'me' ? 'me' : (tripmates.find((m) => m.id === k)?.name || k),
      paid: v,
      owes: fair - v,
    }));
  }, [tripmates, transactions, convertToTrip]);

  return (
    <div role="dialog" onClick={onClose} style={modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={modalCard}>
        <header style={modalHeader}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>SETTLE</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Who owes whom</div>
          </div>
          <button onClick={onClose} type="button" style={modalClose}>×</button>
        </header>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {breakdown.map((b) => (
            <div key={b.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(245,237,224,0.04)', border: '1px solid ' + COLORS.line,
            }}>
              <span style={{ fontSize: 13 }}>{b.name}</span>
              <span className="mono" style={{ fontSize: 12, color: COLORS.muted }}>
                paid {formatMoney(b.paid, tripCurrency)}
              </span>
              <span className="mono" style={{
                fontSize: 13, fontWeight: 700,
                color: b.owes > 0 ? COLORS.red : COLORS.green,
              }}>
                {b.owes > 0 ? `owes ${formatMoney(b.owes, tripCurrency)}` : `+${formatMoney(-b.owes, tripCurrency)}`}
              </span>
            </div>
          ))}
          <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 4, letterSpacing: '0.12em' }}>
            ◇ V0.4 = aggregate paid-by netting · no per-tx split
          </div>
        </div>
        <footer style={modalFooter}>
          <Btn onClick={onClose} type="button">Close</Btn>
        </footer>
      </div>
    </div>
  );
}

// ─── Shared form helpers ────────────────────────────────────────
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

function formatMoney(amount, currency) {
  if (amount == null || Number.isNaN(amount)) return '—';
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

// ─── Modal styling primitives ──────────────────────────────────
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
