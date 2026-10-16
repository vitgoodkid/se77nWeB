// 05 EXPENSES · per-trip transactions table + add modal + FX panel + settle flow.
// No photo/OCR scan flows (spec strips those). PAID BY column drives tripmate netting.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { PixelCoin, PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import { txnsToCSV, downloadBlob } from './exports.js';
import {
  GOLD, ON, CAT_FILL,
  CardTitle, Empty as EmptyState, ErrorNote, FormRow, IconRefresh, IconWarn, Label, Loading,
  PxDialog, PxSelect, Seg, Swatch, Tag, XBtn, fieldStyle,
} from './kit.jsx';

const BUILTIN_CATEGORIES = ['food', 'stay', 'transport', 'shopping', 'other'];
const METHODS = ['cash', 'card', 'ic', 'transfer'];

const CAT_COLORS = CAT_FILL;

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
    <div style={{ position: 'relative', padding: '6px 6px 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
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

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32 }}>
          <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 26 }}>
            <FloatingAddButton onClick={() => setShowAdd(true)} />

            <TxnTable
              transactions={transactions}
              tripCurrency={tripCurrency}
              convertToTrip={convertToTrip}
              onEdit={setEditingTx}
              onDelete={onDelete}
              loading={loading}
              total={totals.spend}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '0 8px 8px 4px' }}>
              <PxButton
                onClick={() => {
                  const csv = txnsToCSV(transactions, tripCurrency);
                  downloadBlob(csv, `${trip.slug || 'trip'}-transactions.csv`, 'text/csv');
                }}
                style={{ height: 40, fontSize: 11 }}
              >↓ EXPORT CSV</PxButton>
              <a
                href="#/tv4/list"
                style={{ fontSize: 13, color: COLORS.text }}
              >See spending patterns across all trips →</a>
            </div>
          </main>

          <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 32 }}>
            <CategoryBreakdown byCat={totals.byCat} currency={tripCurrency} />
            <CashVsCard byMethod={totals.byMethod} currency={tripCurrency} />
            <FxCard fx={fx} baseCurrency={baseCurrency} tripCurrency={tripCurrency} onRefresh={refresh} />
            {settings?.tripmates?.length > 0 && (
              <div style={{ padding: '0 8px 8px 0' }}>
                <PxButton onClick={() => setShowSettle(true)} style={{ height: 44 }}>SETTLE WITH TRIPMATE</PxButton>
              </div>
            )}
          </aside>
        </div>
      </div>

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
    <div className="px" style={{ background: COLORS.paper, margin: 6 }}>
      <EmptyState title="NO TRIP SELECTED" hint="no trip selected — pick one from LIST" />
    </div>
  );
}

function BudgetBanner({ budgetPct, wayOver, spent, budget, currency }) {
  const c = wayOver ? '#ff7a7a' : GOLD;
  return (
    <div className="pxs" role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', margin: '0 3px',
      fontSize: 13, lineHeight: 1.5, color: ON, background: c,
    }}>
      <IconWarn size={18} fill={c} />
      <span>
        Today's spend is at <strong>{Math.round(budgetPct)}%</strong> of daily budget
        ({formatMoney(spent, currency)} / {formatMoney(budget, currency)})
      </span>
    </div>
  );
}

function ErrorRow({ error, onRetry }) {
  return (
    <ErrorNote style={{ margin: '0 3px' }}>
      load error: {error} ·{' '}
      <button type="button" onClick={onRetry} className="sk" style={{
        marginLeft: 4, padding: '4px 8px', fontSize: 11, color: '#fffaf0', background: '#1b1410',
        border: 0, cursor: 'pointer',
      }}>RETRY</button>
    </ErrorNote>
  );
}

function KpiRow({ totals, tripCurrency, txnCount }) {
  const tiles = [
    { k: 'SPEND',  v: formatMoney(totals.spend, tripCurrency), coin: true },
    { k: 'TXNS',   v: txnCount },
    { k: 'AVG/DAY', v: formatMoney(totals.spend / Math.max(Object.keys(totals.byDay).length, 1), tripCurrency) },
    { k: 'CASH',   v: formatMoney(totals.byMethod.cash || 0, tripCurrency) },
  ];
  return (
    <div className="tv-kpi" style={{ gap: 28, padding: '0 3px' }}>
      {tiles.map((t) => (
        <div key={t.k} className="pxs" style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', minWidth: 0,
          background: COLORS.paper,
        }}>
          <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.muted }}>
            {t.coin && <PixelCoin size={16} spin />}{t.k}
          </span>
          <span className="pf tv-kpi-v" style={{
            fontSize: 28, lineHeight: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.v}</span>
        </div>
      ))}
    </div>
  );
}

function TxnTable({ transactions, tripCurrency, convertToTrip, onEdit, onDelete, loading, total }) {
  if (loading && !transactions.length) {
    return <Loading label="loading transactions" />;
  }
  if (!transactions.length) {
    return (
      <div className="px" style={{ background: COLORS.paper, margin: '0 8px 8px 0' }}>
        <EmptyState
          icon={<PixelCoin size={36} />}
          title="NO SAVE DATA"
          hint="No transactions yet — tap the + button to add one"
        />
      </div>
    );
  }
  const sorted = transactions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <div className="px" style={{
      background: COLORS.paper, overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 8px 8px 0',
    }}>
      <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 13 }}>
        <caption className="sr">Transactions for this trip</caption>
        <thead>
          <tr>
            <Th first>DATE</Th><Th>CAT</Th><Th>NAME</Th><Th right>AMOUNT</Th><Th>METHOD</Th><Th>PAID BY</Th>
            <Th last><span className="sr">Actions</span></Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr
              key={t._id}
              onClick={() => onEdit(t)}
              onKeyDown={(e) => { if (e.key === 'Enter') onEdit(t); }}
              tabIndex={0}
              className="tv-row"
            >
              <Td first muted><span style={{ whiteSpace: 'nowrap' }}>{t.date || '—'}</span></Td>
              <Td>
                <Tag fill={CAT_COLORS[t.category] || '#b9a2ff'}>{t.customCategory || t.category || 'other'}</Tag>
              </Td>
              <Td>{t.name || '—'}</Td>
              <Td right>
                <strong>
                  {formatMoney(t.amount, t.currency || tripCurrency)}
                </strong>
                {t.currency && t.currency.toUpperCase() !== tripCurrency.toUpperCase() && (
                  <span style={{ display: 'block', fontSize: 11, color: COLORS.muted }}>
                    ≈ {formatMoney(convertToTrip(t.amount, t.currency), tripCurrency)}
                  </span>
                )}
              </Td>
              <Td><span className="sk" style={{ fontSize: 11, textTransform: 'uppercase' }}>{t.method || '—'}</span></Td>
              <Td>{t.paidBy || 'me'}</Td>
              <Td last>
                <XBtn onClick={() => onDelete(t._id)} label="Delete transaction" />
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="sk" style={{ fontSize: 12, color: '#fffaf0', background: 'var(--strip)' }}>
            <td colSpan={3} style={{ padding: '12px 12px 12px 18px' }}>TOTAL SPEND</td>
            <td style={{ padding: 12, textAlign: 'right', color: GOLD, whiteSpace: 'nowrap' }}>{formatMoney(total, tripCurrency)}</td>
            <td colSpan={3} style={{ padding: '12px 18px 12px 12px', color: '#c9bca6' }}>{transactions.length} TXNS</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Th({ children, right, first, last }) {
  return (
    <th
      className="sk"
      scope="col"
      style={{
        textAlign: right ? 'right' : 'left',
        padding: `14px ${last ? 18 : 12}px 12px ${first ? 18 : 12}px`,
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
        color: COLORS.muted, borderBottom: '3px dashed var(--rule)',
      }}
    >{children}</th>
  );
}

function Td({ children, right, first, last, muted }) {
  return (
    <td style={{
      padding: `11px ${last ? 14 : 12}px 11px ${first ? 18 : 12}px`, textAlign: right ? 'right' : 'left',
      color: muted ? COLORS.muted : COLORS.text, verticalAlign: 'middle',
      borderBottom: '3px dashed var(--rule)',
    }}>{children}</td>
  );
}

function SideCard({ title, labelId, right, children }) {
  return (
    <section className="px" aria-labelledby={labelId} style={{
      background: COLORS.paper, padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 28 }}>
        <CardTitle id={labelId}>{title}</CardTitle>
        {right}
      </div>
      {children}
    </section>
  );
}

function CategoryBreakdown({ byCat, currency }) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <SideCard title="BY CATEGORY" labelId="tv-cat-h">
      <div aria-hidden="true" style={{
        display: 'flex', height: 18, background: COLORS.paper, border: '3px solid var(--ink)', overflow: 'hidden',
      }}>
        {entries.length === 0 ? <div style={{ flex: 1 }} /> : entries.map(([c, v]) => (
          <div key={c} style={{
            flex: v / Math.max(total, 1),
            background: `repeating-linear-gradient(90deg, ${CAT_COLORS[c] || '#b9a2ff'} 0 10px, transparent 10px 12px)`,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 ? (
          <div style={{ color: COLORS.muted, fontSize: 13 }}>nothing yet</div>
        ) : entries.map(([c, v]) => (
          <div key={c} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, textTransform: 'uppercase' }}>
              <Swatch fill={CAT_COLORS[c] || '#b9a2ff'} />
              {c}
            </span>
            <span style={{ color: COLORS.text, fontWeight: 700 }}>{formatMoney(v, currency)}</span>
          </div>
        ))}
      </div>
    </SideCard>
  );
}

function CashVsCard({ byMethod, currency }) {
  const cash = byMethod.cash || 0;
  const card = (byMethod.card || 0) + (byMethod.ic || 0) + (byMethod.transfer || 0);
  const total = cash + card;
  const cashPct = total ? (cash / total) * 100 : 0;
  return (
    <SideCard title="CASH · CARD" labelId="tv-cash-h" right={<Label style={{ fontSize: 10 }}>CASH {Math.round(cashPct)}%</Label>}>
      {/* Pixel split bar: cash (gold) vs card+ (hatched paper). */}
      <span aria-hidden="true" style={{ display: 'flex', height: 18, background: COLORS.paper, border: '3px solid var(--ink)', overflow: 'hidden' }}>
        <span style={{ width: `${cashPct}%`, background: `repeating-linear-gradient(90deg, ${GOLD} 0 10px, transparent 10px 12px)` }} />
        <span style={{ flex: 1, background: 'repeating-linear-gradient(90deg, var(--rule) 0 10px, transparent 10px 12px)' }} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Swatch fill={GOLD} />
          <span style={{ color: COLORS.muted }}>cash</span>
          <span style={{ marginLeft: 'auto', color: COLORS.text, fontWeight: 700 }}>{formatMoney(cash, currency)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Swatch fill="var(--rule)" />
          <span style={{ color: COLORS.muted }}>card+</span>
          <span style={{ marginLeft: 'auto', color: COLORS.text, fontWeight: 700 }}>{formatMoney(card, currency)}</span>
        </div>
      </div>
    </SideCard>
  );
}

function FxCard({ fx, baseCurrency, tripCurrency, onRefresh }) {
  const date = fx?.date || '—';
  const rates = fx?.rates || {};
  const tripRate = rates[tripCurrency?.toUpperCase()];
  return (
    <SideCard
      title={`FX · ${baseCurrency} BASE`}
      labelId="tv-fx-h"
      right={<button type="button" onClick={onRefresh} className="tv-x" aria-label="Refresh rates" title="Refresh rates"><IconRefresh size={16} /></button>}
    >
      <div style={{ fontSize: 13, color: COLORS.text }}>
        {tripRate ? (
          <span className="pf" style={{ fontSize: 22 }}>
            1 {baseCurrency} = {tripRate.toFixed(tripRate < 1 ? 4 : 2)} {tripCurrency}
          </span>
        ) : (
          <span style={{ color: COLORS.muted }}>
            {tripCurrency} not in snapshot
          </span>
        )}
      </div>
      <Label style={{ fontSize: 10 }}>
        snapshot {date} · {fx?.source ? 'live' : '—'}
      </Label>
    </SideCard>
  );
}

// Add-transaction call to action (was a floating + button).
function FloatingAddButton({ onClick }) {
  return (
    <div className="px" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 22px',
      padding: '16px 22px 20px 18px', background: COLORS.paper,
    }}>
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label style={{ fontSize: 11 }}>QUICK ADD · TRY 'RAMEN 1280' OR 'TAXI 18 USD'</Label>
        <span style={{ fontSize: 13, color: COLORS.muted }}>Log a spend in one line, or switch to manual for every field.</span>
      </div>
      <PxButton kind="big" fill="#ff7a7a" onClick={onClick} title="Add transaction" style={{ minHeight: 46, fontSize: 13 }}>
        + ADD TRANSACTION
      </PxButton>
    </div>
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
    <PxDialog
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      kicker={editingId ? 'EDIT' : 'NEW'}
      title={title}
      footer={<>
        <PxButton type="button" onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton type="submit" fill={GOLD} disabled={submitting} style={{ height: 44 }}>
          {submitting ? '…' : editingId ? 'SAVE' : 'ADD'}
        </PxButton>
      </>}
    >
      {!editingId && (
        <Seg
          ariaLabel="Entry mode"
          options={[{ id: 'quick', label: 'QUICK' }, { id: 'manual', label: 'MANUAL' }]}
          value={mode}
          onChange={setMode}
          style={{ alignSelf: 'flex-start', marginLeft: 3 }}
        />
      )}

      {mode === 'quick' && !editingId && (
        <Row label="Try: 'ramen 1280' or 'taxi 18 USD'">
          <Field
            value={quick}
            onChange={setQuick}
            placeholder="ramen 1280"
            autoFocus
            style={fieldStyle}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onQuickParse(); } }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, padding: '0 8px 8px 0' }}>
            <PxButton type="button" onClick={onQuickParse} fill={GOLD} style={{ height: 40 }}>PARSE →</PxButton>
          </div>
        </Row>
      )}

      {mode === 'manual' && (
        <>
          <div className="tv-g2" style={{ gap: 18 }}>
            <Row label="Date">
              <Field type="date" value={tx.date} onChange={(v) => setTx((t) => ({ ...t, date: v }))} style={fieldStyle} />
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
            <Field value={tx.name} onChange={(v) => setTx((t) => ({ ...t, name: v }))} placeholder="Ichiran Shibuya" mono={false} style={fieldStyle} />
          </Row>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
            <Row label="Amount">
              <Field type="number" value={tx.amount} onChange={(v) => setTx((t) => ({ ...t, amount: v }))} placeholder="1280" style={fieldStyle} />
            </Row>
            <Row label="Currency">
              <Field value={tx.currency} onChange={(v) => setTx((t) => ({ ...t, currency: v.toUpperCase() }))} placeholder="JPY" style={fieldStyle} />
            </Row>
          </div>
          <div className="tv-g2" style={{ gap: 18 }}>
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
            <Field value={tx.notes} onChange={(v) => setTx((t) => ({ ...t, notes: v }))} placeholder="optional" mono={false} style={fieldStyle} />
          </Row>
          {!editingId && (
            <Row label="Repeat for N days (optional)">
              <Field
                type="number"
                value={tx.recurringCount || ''}
                onChange={(v) => setTx((t) => ({ ...t, recurringCount: v }))}
                placeholder="e.g. 7 for a weekly metro pass"
                style={fieldStyle}
              />
            </Row>
          )}
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </PxDialog>
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
    <PxDialog
      onClose={onClose}
      kicker="SETTLE"
      title="Who owes whom"
      footer={<PxButton type="button" onClick={onClose} style={{ height: 44 }}>CLOSE</PxButton>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {breakdown.map((b) => (
          <div key={b.id} style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '6px 14px',
            padding: '10px 12px', background: COLORS.field, border: '3px solid var(--ink)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</span>
            <span style={{ fontSize: 12, color: COLORS.muted }}>
              paid {formatMoney(b.paid, tripCurrency)}
            </span>
            <span className="sk" style={{
              fontSize: 12,
              color: b.owes > 0 ? 'var(--tv-red-ink)' : 'var(--green-ink)',
            }}>
              {b.owes > 0 ? `owes ${formatMoney(b.owes, tripCurrency)}` : `+${formatMoney(-b.owes, tripCurrency)}`}
            </span>
          </div>
        ))}
      </div>
      <Label as="p" style={{ margin: 0, fontSize: 10 }}>
        V0.4 = aggregate paid-by netting · no per-tx split
      </Label>
    </PxDialog>
  );
}

// ─── Shared form helpers ────────────────────────────────────────
function Row({ label, children }) {
  return <FormRow label={label}>{children}</FormRow>;
}

function Select({ value, onChange, options }) {
  return <PxSelect value={value} onChange={onChange} options={options} />;
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
