import { useState, useEffect, useMemo } from 'react';
import {
  COLORS, VAULT_SEED,
  Panel, Btn, Field, Pill, Kicker, Sparkline,
  useSyncedData, copyText, useAuth,
} from './lib.jsx';

// ═════════════════════════════════════════════════════════════
// 5. TECH STACK MONITOR — per-user subscription tracker
// ═════════════════════════════════════════════════════════════
const TECH_CURRENCIES = ['USD', 'TWD', 'VND', 'EUR', 'JPY', 'KRW', 'SGD', 'CAD', 'GBP', 'CNY', 'THB', 'AUD'];

function subToMonthlyUSD(sub, fxRates) {
  const rate = fxRates?.[sub.currency] ?? 1;
  if (!rate || !Number.isFinite(rate)) return 0;
  const usd = Number(sub.price) / rate;
  if (!Number.isFinite(usd)) return 0;
  return sub.period === 'yearly' ? usd / 12 : usd;
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
}

export function TechStackMonitor() {
  const auth = useAuth();
  const [data, setData] = useState(null); // { subs, owner, fx }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const isYou = !!data?.owner?.isYou;

  // ── Load on mount + when auth status changes ──
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    fetch('/api/toolbox?kind=tech', { credentials: 'include' })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) { setErr(j.error || 'Failed'); setData(null); }
        else setData(j);
      })
      .catch((e) => { if (alive) { setErr(e.message); setData(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [auth.status]);

  async function refresh() {
    const r = await fetch('/api/toolbox?kind=tech', { credentials: 'include' });
    const j = await r.json();
    if (r.ok) setData(j);
  }

  async function addSub(sub) {
    const r = await fetch('/api/toolbox?kind=tech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(sub),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Add failed');
    await refresh();
  }
  async function updateSub(id, sub) {
    const r = await fetch(`/api/toolbox?kind=tech&id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(sub),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Update failed');
    await refresh();
  }
  async function deleteSub(id) {
    const r = await fetch(`/api/toolbox?kind=tech&id=${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Delete failed');
    }
    await refresh();
  }

  const subs = data?.subs || [];
  const fxRates = data?.fx || { USD: 1, TWD: 32, VND: 25500 };

  const totals = useMemo(() => {
    let monthlyUSD = 0;
    for (const s of subs) monthlyUSD += subToMonthlyUSD(s, fxRates);
    return {
      monthlyUSD,
      yearlyUSD: monthlyUSD * 12,
      monthlyTWD: monthlyUSD * (fxRates.TWD || 0),
      monthlyVND: monthlyUSD * (fxRates.VND || 0),
      yearlyTWD: monthlyUSD * 12 * (fxRates.TWD || 0),
      yearlyVND: monthlyUSD * 12 * (fxRates.VND || 0),
    };
  }, [subs, fxRates]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, height: '100%' }}>
      {/* ── LEFT: subscription list ── */}
      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <Kicker>SUBSCRIPTIONS · {String(subs.length).padStart(2, '0')}</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {data?.owner?.name ? `${data.owner.name}'s stack` : 'Tech stack monitor'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isYou
              ? <Pill color={COLORS.green}>● YOURS</Pill>
              : <Pill color={COLORS.gold}>● PUBLIC · READ ONLY</Pill>}
            {isYou && !adding && (
              <Btn variant="solid" color={COLORS.green} onClick={() => setAdding(true)}>+ Add</Btn>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted }} className="mono">◇ loading…</div>
          ) : err ? (
            <div style={{ padding: 24 }}>
              <div className="mono" style={{
                padding: '10px 14px', borderRadius: 10,
                border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
                color: COLORS.red, fontSize: 12,
              }}>✕ {err}</div>
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              {adding && (
                <SubForm
                  initial={{ name: '', price: '', currency: 'USD', period: 'monthly', url: '', nextRenewal: '' }}
                  onCancel={() => setAdding(false)}
                  onSave={async (sub) => {
                    await addSub(sub);
                    setAdding(false);
                  }}
                />
              )}

              {subs.length === 0 && !adding ? (
                <EmptyState isYou={isYou} onAdd={() => setAdding(true)} />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
                  <thead>
                    <tr style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted, textAlign: 'left' }}>
                      <th style={{ padding: '10px 12px', fontWeight: 500 }}>SERVICE</th>
                      <th style={{ padding: '10px 12px', fontWeight: 500 }}>NATIVE</th>
                      <th style={{ padding: '10px 12px', fontWeight: 500 }}>PERIOD</th>
                      <th style={{ padding: '10px 12px', fontWeight: 500, textAlign: 'right' }}>USD/MO</th>
                      {isYou && <th style={{ padding: '10px 12px', fontWeight: 500, width: 80 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => {
                      if (editingId === s.id) {
                        return (
                          <tr key={s.id}>
                            <td colSpan={isYou ? 5 : 4} style={{ padding: 0, borderTop: '1px solid ' + COLORS.line }}>
                              <div style={{ padding: 12 }}>
                                <SubForm
                                  initial={s}
                                  onCancel={() => setEditingId(null)}
                                  onSave={async (sub) => {
                                    await updateSub(s.id, sub);
                                    setEditingId(null);
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      const monthly = subToMonthlyUSD(s, fxRates);
                      const days = daysUntil(s.nextRenewal);
                      return (
                        <tr key={s.id} style={{ borderTop: '1px solid ' + COLORS.line }}>
                          <td style={{ padding: '14px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{
                                width: 28, height: 28, borderRadius: 8,
                                border: `1px solid ${COLORS.green}55`, background: COLORS.green + '14',
                                display: 'grid', placeItems: 'center',
                                color: COLORS.green, fontSize: 12, fontWeight: 700,
                              }}>{s.name[0]?.toUpperCase()}</span>
                              <div style={{ minWidth: 0 }}>
                                {s.url ? (
                                  <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: COLORS.text, textDecoration: 'none' }}>{s.name} ↗</a>
                                ) : (
                                  <span style={{ fontSize: 13, color: COLORS.text }}>{s.name}</span>
                                )}
                                {s.nextRenewal && (
                                  <div style={{ fontSize: 10, color: days != null && days < 7 ? COLORS.red : COLORS.muted, marginTop: 2 }}>
                                    renews {s.nextRenewal}{days != null && (days < 0 ? ' · overdue' : ` · in ${days}d`)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 12px', fontSize: 12, color: COLORS.muted }}>
                            {Number(s.price).toLocaleString()} {s.currency}
                          </td>
                          <td style={{ padding: '14px 12px', fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {s.period === 'yearly' ? 'YEARLY' : 'MONTHLY'}
                          </td>
                          <td style={{ padding: '14px 12px', fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
                            ${monthly.toFixed(2)}
                          </td>
                          {isYou && (
                            <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                <Btn variant="ghost" onClick={() => setEditingId(s.id)} title="Edit">✎</Btn>
                                <Btn variant="ghost" onClick={() => {
                                  if (confirm(`Delete "${s.name}"?`)) deleteSub(s.id).catch((e) => alert(e.message));
                                }} title="Delete">✕</Btn>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </Panel>

      {/* ── RIGHT: burn summary ── */}
      <Panel padding={20} style={{ overflow: 'auto', height: '100%' }}>
        <Kicker style={{ marginBottom: 8 }}>MONTHLY BURN</Kicker>
        <div style={{
          padding: 16, borderRadius: 12, marginBottom: 14,
          background: 'linear-gradient(135deg, ' + COLORS.red + '14, ' + COLORS.gold + '0a)',
          border: '1px solid ' + COLORS.red + '40',
        }}>
          <div className="mono" style={{ fontSize: 30, fontWeight: 800 }}>
            ${totals.monthlyUSD.toFixed(2)}
            <span style={{ fontSize: 11, color: COLORS.muted, marginLeft: 8, fontWeight: 400 }}>USD</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, lineHeight: 1.6 }}>
            ≈ {totals.monthlyTWD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD<br />
            ≈ {totals.monthlyVND.toLocaleString(undefined, { maximumFractionDigits: 0 })} VND
          </div>
        </div>

        <Kicker style={{ marginBottom: 8 }}>YEARLY BURN</Kicker>
        <div style={{
          padding: 16, borderRadius: 12, marginBottom: 20,
          background: COLORS.bg, border: '1px solid ' + COLORS.line,
        }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: COLORS.gold }}>
            ${totals.yearlyUSD.toFixed(0)}
            <span style={{ fontSize: 11, color: COLORS.muted, marginLeft: 8, fontWeight: 400 }}>USD</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 8, lineHeight: 1.6 }}>
            ≈ {totals.yearlyTWD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD<br />
            ≈ {totals.yearlyVND.toLocaleString(undefined, { maximumFractionDigits: 0 })} VND
          </div>
        </div>

        {!isYou && (
          <div style={{
            padding: 16, borderRadius: 12,
            border: `1px dashed ${COLORS.green}55`, background: COLORS.green + '06',
          }}>
            <Kicker style={{ color: COLORS.green, marginBottom: 8 }}>CREATE YOUR OWN</Kicker>
            <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5, marginBottom: 12 }}>
              {auth.status === 'authed'
                ? 'Sign in as a different account to manage your own subscription stack.'
                : 'Sign in to track your own subscriptions. Private — only you see your list.'}
            </div>
            {auth.status === 'authed' ? (
              <Btn variant="solid" color={COLORS.green} onClick={() => auth.logout()}>Sign out</Btn>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="solid" color={COLORS.green} onClick={() => auth.login('google')}>Google</Btn>
                <Btn variant="tinted" color={COLORS.green} onClick={() => auth.login('discord')}>Discord</Btn>
              </div>
            )}
          </div>
        )}

        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, marginTop: 16, letterSpacing: '0.06em', lineHeight: 1.5 }}>
          ◇ FX rates auto-refreshed from exchangerate.host. Yearly subs amortized to monthly for burn math.
        </div>
      </Panel>
    </div>
  );
}

function EmptyState({ isYou, onAdd }) {
  return (
    <div style={{
      padding: 40, textAlign: 'center', borderRadius: 12, margin: 8,
      border: `1px dashed ${COLORS.line}`, background: COLORS.bg,
      color: COLORS.muted,
    }}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: COLORS.text, marginBottom: 8 }}>
        {isYou ? 'NO SUBSCRIPTIONS YET' : 'STACK IS EMPTY'}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: isYou ? 14 : 0 }}>
        {isYou
          ? 'Add Netflix, Spotify, Cursor, AWS, anything you pay for monthly or yearly.'
          : 'The owner hasn\'t added any subscriptions yet.'}
      </div>
      {isYou && <Btn variant="solid" color={COLORS.green} onClick={onAdd}>+ Add your first</Btn>}
    </div>
  );
}

function SubForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(String(initial.price ?? ''));
  const [currency, setCurrency] = useState(initial.currency || 'USD');
  const [period, setPeriod] = useState(initial.period || 'monthly');
  const [url, setUrl] = useState(initial.url || '');
  const [nextRenewal, setNextRenewal] = useState(initial.nextRenewal || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await onSave({
        name: name.trim(),
        price: Number(price),
        currency,
        period,
        url: url.trim(),
        nextRenewal: nextRenewal.trim(),
      });
    } catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      padding: 14, borderRadius: 10, marginBottom: 10,
      border: `1px solid ${COLORS.green}55`, background: COLORS.green + '08',
      display: 'grid', gap: 10,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
        <div>
          <Kicker style={{ marginBottom: 6 }}>NAME</Kicker>
          <Field value={name} onChange={setName} placeholder="Cursor Pro" />
        </div>
        <div>
          <Kicker style={{ marginBottom: 6 }}>PRICE</Kicker>
          <Field value={price} onChange={setPrice} placeholder="20" />
        </div>
        <div>
          <Kicker style={{ marginBottom: 6 }}>CCY</Kicker>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mono"
            style={{
              width: '100%', background: COLORS.bg, color: COLORS.text,
              border: '1px solid ' + COLORS.line, borderRadius: 8,
              padding: '10px 12px', fontSize: 12, outline: 'none',
            }}
          >
            {TECH_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Kicker style={{ marginBottom: 6 }}>PERIOD</Kicker>
          <div style={{ display: 'flex', gap: 4 }}>
            <Btn variant={period === 'monthly' ? 'tinted' : 'ghost'} color={COLORS.green}
              onClick={() => setPeriod('monthly')}>mo</Btn>
            <Btn variant={period === 'yearly' ? 'tinted' : 'ghost'} color={COLORS.green}
              onClick={() => setPeriod('yearly')}>yr</Btn>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
        <div>
          <Kicker style={{ marginBottom: 6 }}>URL (optional)</Kicker>
          <Field value={url} onChange={setUrl} placeholder="https://cursor.com" />
        </div>
        <div>
          <Kicker style={{ marginBottom: 6 }}>NEXT RENEWAL (optional)</Kicker>
          <Field value={nextRenewal} onChange={setNextRenewal} placeholder="2026-06-15" />
        </div>
      </div>
      {err && (
        <div className="mono" style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 11,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e', color: COLORS.red,
        }}>✕ {err}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="solid" color={COLORS.green} onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 6. CRYPTO WATCH — real BTC + GOLD + TWD/VND, sparklines, converter
// ═════════════════════════════════════════════════════════════
export function CryptoWatch() {
  const [ticks, setTicks] = useState({
    btc:  { price: null, series: [] },
    gold: { price: null, series: [] },
    twd:  { price: null, series: [] },
    vnd:  { price: null, series: [] },
  });
  const [status, setStatus] = useState({ live: false, loaded: false, t: 0, error: null });

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch('/api/crypto');
        if (!r.ok) throw new Error('crypto ' + r.status);
        const d = await r.json();
        if (!alive) return;
        setTicks((cur) => {
          const merge = (key) => {
            const liveSeries = Array.isArray(d.series?.[key]) ? d.series[key] : null;
            if (liveSeries && liveSeries.length) {
              return { price: d[key] ?? liveSeries[liveSeries.length - 1], series: liveSeries };
            }
            // No historical data from API yet — append the latest tick onto whatever
            // we already have, so the sparkline grows over time instead of showing fakes.
            if (Number.isFinite(d[key])) {
              const next = [...cur[key].series, d[key]].slice(-40);
              return { price: d[key], series: next };
            }
            return cur[key];
          };
          return {
            btc:  merge('btc'),
            gold: merge('gold'),
            twd:  merge('twd'),
            vnd:  merge('vnd'),
          };
        });
        setStatus({ live: true, loaded: true, t: Date.now(), error: null });
      } catch (e) {
        if (!alive) return;
        setStatus((s) => ({ ...s, live: false, loaded: true, error: e.message || 'fetch failed' }));
      }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const havePrices = Number.isFinite(ticks.twd.price) && Number.isFinite(ticks.vnd.price);
  const twdPerVnd = havePrices ? ticks.twd.price / ticks.vnd.price : 0;
  const vndPerTwd = havePrices ? ticks.vnd.price / ticks.twd.price : 0;

  const [direction, setDirection] = useState('twd-vnd');
  const [amount, setAmount] = useState('1000');
  const num = parseFloat(amount.replace(/,/g, '')) || 0;
  const converted = direction === 'twd-vnd' ? num * vndPerTwd : num * twdPerVnd;

  const tickers = [
    { key: 'btc',  label: 'BTC / USDT', price: ticks.btc.price,  fmt: (v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 }), color: COLORS.gold },
    { key: 'gold', label: 'GOLD / oz',  price: ticks.gold.price, fmt: (v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 }), color: COLORS.gold },
    { key: 'twd',  label: 'TWD / USD',  price: ticks.twd.price,  fmt: (v) => v.toFixed(3),       color: COLORS.green },
    { key: 'vnd',  label: 'VND / USD',  price: ticks.vnd.price,  fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), color: COLORS.red },
  ];

  const statusLabel = !status.loaded ? 'CONNECTING'
                    : status.live    ? 'LIVE · 60s'
                    :                  'OFFLINE';
  const statusColor = !status.loaded ? COLORS.muted
                    : status.live    ? COLORS.green
                    :                  COLORS.red;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 18, height: '100%' }}>
      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Kicker>MARKETS · {statusLabel}</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Crypto watch</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 999,
              background: statusColor,
              boxShadow: status.live ? `0 0 8px ${COLORS.green}` : 'none',
              animation: status.live ? 'pulse 1.4s ease-in-out infinite' : 'none',
            }} />
            <span className="mono" style={{
              fontSize: 10, letterSpacing: '0.16em',
              color: statusColor,
            }}>{statusLabel}</span>
          </div>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 14 }}>
          {tickers.map((t) => {
            const series = ticks[t.key].series;
            const havePrice = Number.isFinite(t.price);
            const haveSeries = series.length >= 2;
            const first = haveSeries ? series[0] : 0;
            const last = haveSeries ? series[series.length - 1] : 0;
            const delta = last - first;
            const pct = first ? (delta / first) * 100 : 0;
            const up = delta >= 0;
            return (
              <div key={t.key} style={{
                padding: '18px 20px', borderRadius: 12,
                background: COLORS.bg, border: '1px solid ' + COLORS.line,
                display: 'grid', gridTemplateColumns: '160px 1fr 180px', alignItems: 'center', gap: 24,
              }}>
                <div>
                  <Kicker style={{ color: t.color, marginBottom: 4 }}>{t.label}</Kicker>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                    {havePrice ? t.fmt(t.price) : (
                      <span style={{ color: COLORS.muted, fontSize: 14, fontWeight: 500 }}>—</span>
                    )}
                  </div>
                </div>
                <div style={{ overflow: 'hidden', minHeight: 56, display: 'flex', alignItems: 'center' }}>
                  {haveSeries ? (
                    <Sparkline data={series} color={t.color} w={400} h={56} fill />
                  ) : (
                    <span className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.16em' }}>
                      {status.error ? '○ no data' : '○ loading history…'}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {haveSeries ? (
                    <>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: up ? COLORS.green : COLORS.red }}>
                        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
                        {up ? '+' : ''}{delta.toFixed(2)} · {series.length}t
                      </div>
                    </>
                  ) : (
                    <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.14em' }}>—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line }}>
          <Kicker>CONVERTER · CROSS</Kicker>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>TWD ⇄ VND</div>
        </div>
        <div style={{ flex: 1, padding: 20, display: 'grid', gap: 14 }}>
          <div>
            <Kicker style={{ marginBottom: 8 }}>FROM</Kicker>
            <div style={{
              padding: '14px 16px', borderRadius: 12, border: '1px solid ' + COLORS.line, background: COLORS.bg,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span className="mono" style={{
                fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 6,
                background: (direction === 'twd-vnd' ? COLORS.green : COLORS.red) + '1a',
                color: direction === 'twd-vnd' ? COLORS.green : COLORS.red,
                letterSpacing: '0.12em',
              }}>{direction === 'twd-vnd' ? 'TWD' : 'VND'}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mono"
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: COLORS.text, fontSize: 22, fontWeight: 700,
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button onClick={() => setDirection((d) => (d === 'twd-vnd' ? 'vnd-twd' : 'twd-vnd'))}
              className="mono"
              style={{
                padding: '8px 14px', borderRadius: 999,
                background: COLORS.gold + '14',
                border: `1px solid ${COLORS.gold}55`,
                color: COLORS.gold, fontSize: 11, letterSpacing: '0.16em', cursor: 'pointer',
              }}>⇅ SWAP</button>
          </div>

          <div>
            <Kicker style={{ marginBottom: 8 }}>TO</Kicker>
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              border: '1px solid ' + COLORS.gold + '55',
              background: COLORS.gold + '0a',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span className="mono" style={{
                fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 6,
                background: (direction === 'twd-vnd' ? COLORS.red : COLORS.green) + '1a',
                color: direction === 'twd-vnd' ? COLORS.red : COLORS.green,
                letterSpacing: '0.12em',
              }}>{direction === 'twd-vnd' ? 'VND' : 'TWD'}</span>
              <span className="mono" style={{ flex: 1, fontSize: 22, fontWeight: 700, color: COLORS.gold }}>
                {havePrices ? converted.toLocaleString(undefined, { maximumFractionDigits: direction === 'twd-vnd' ? 0 : 2 }) : '—'}
              </span>
            </div>
          </div>

          <div style={{
            marginTop: 8, padding: 14, borderRadius: 10,
            background: COLORS.bg, border: '1px solid ' + COLORS.line,
          }}>
            <div className="mono" style={{
              fontSize: 10, color: COLORS.muted, letterSpacing: '0.16em', marginBottom: 8,
            }}>CROSS RATES · VIA USD</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }} className="mono">
              <span>1 TWD =</span>
              <span style={{ color: COLORS.gold, fontWeight: 700 }}>
                {havePrices ? vndPerTwd.toFixed(1) + ' VND' : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }} className="mono">
              <span>1000 VND =</span>
              <span style={{ color: COLORS.gold, fontWeight: 700 }}>
                {havePrices ? (twdPerVnd * 1000).toFixed(3) + ' TWD' : '—'}
              </span>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 7. DIGITAL VAULT
// ═════════════════════════════════════════════════════════════
export function DigitalVault() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState(null);

  const categories = useMemo(() => {
    const set = new Set(VAULT_SEED.map((v) => v.category));
    return ['all', ...Array.from(set)];
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return VAULT_SEED.filter(
      (v) =>
        (cat === 'all' || v.category === cat) &&
        (!ql ||
          v.label.toLowerCase().includes(ql) ||
          v.user.toLowerCase().includes(ql) ||
          v.tags.some((t) => t.includes(ql))),
    );
  }, [q, cat]);

  function copy(text, id) {
    copyText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div>
          <Kicker>VAULT · {VAULT_SEED.length} ENTRIES</Kicker>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Digital vault</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
          <div style={{ position: 'relative', minWidth: 240, flex: '0 1 320px' }}>
            <span className="mono" style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: COLORS.muted, fontSize: 12, pointerEvents: 'none',
            }}>⌕</span>
            <Field value={q} onChange={setQ} placeholder="Search labels, users, tags…" style={{ paddingLeft: 32 }} />
          </div>
        </div>
      </div>

      <div style={{
        padding: '12px 20px', display: 'flex', gap: 6, flexWrap: 'wrap',
        borderBottom: '1px solid ' + COLORS.line,
      }}>
        {categories.map((c) => {
          const active = c === cat;
          return (
            <button key={c} onClick={() => setCat(c)} className="mono" style={{
              padding: '6px 12px', borderRadius: 999,
              fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
              background: active ? COLORS.red + '1a' : 'transparent',
              border: `1px solid ${active ? COLORS.red + '60' : COLORS.line}`,
              color: active ? COLORS.red : COLORS.muted,
            }}>{c}</button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
          <thead>
            <tr style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted, textAlign: 'left' }}>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>LABEL</th>
              <th style={{ padding: '12px 12px', fontWeight: 500 }}>USER</th>
              <th style={{ padding: '12px 12px', fontWeight: 500 }}>SECRET</th>
              <th style={{ padding: '12px 12px', fontWeight: 500 }}>TAGS</th>
              <th style={{ padding: '12px 12px', fontWeight: 500 }}>UPDATED</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const isRev = revealed[v.id];
              return (
                <tr key={v.id} style={{ borderTop: '1px solid ' + COLORS.line, transition: 'background 120ms' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: COLORS.red + '14', border: `1px solid ${COLORS.red}40`,
                        display: 'grid', placeItems: 'center', fontWeight: 700,
                        fontSize: 13, color: COLORS.red,
                      }}>{v.label[0]}</span>
                      <div>
                        <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 700 }}>{v.label}</div>
                        <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 2, letterSpacing: '0.1em' }}>
                          {v.category.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 12px', fontSize: 12, color: COLORS.muted }}>{v.user}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '4px 10px',
                      background: COLORS.bg, border: '1px solid ' + COLORS.line, borderRadius: 6,
                      fontSize: 12, color: isRev ? COLORS.gold : COLORS.muted,
                      letterSpacing: isRev ? '0.04em' : '0.16em', minWidth: 140,
                    }}>{isRev ? v.secret.replace(/•+/g, 'p4ssW0rd_xYz') : v.secret}</span>
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {v.tags.map((t) => (
                        <span key={t} style={{
                          fontSize: 9, letterSpacing: '0.1em',
                          padding: '3px 7px', borderRadius: 4,
                          background: COLORS.green + '14', color: COLORS.green,
                          border: `1px solid ${COLORS.green}30`,
                        }}>{t}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '14px 12px', fontSize: 11, color: COLORS.muted }}>{v.updated}</td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => setRevealed((r) => ({ ...r, [v.id]: !r[v.id] }))} className="mono"
                        style={{
                          padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                          background: 'transparent', border: '1px solid ' + COLORS.line,
                          color: COLORS.muted, fontSize: 10, letterSpacing: '0.1em',
                        }}>{isRev ? 'HIDE' : 'REVEAL'}</button>
                      <button onClick={() => copy('p4ssW0rd_xYz', v.id)} className="mono"
                        style={{
                          padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                          background: copied === v.id ? COLORS.green + '14' : 'transparent',
                          border: `1px solid ${copied === v.id ? COLORS.green : COLORS.line}`,
                          color: copied === v.id ? COLORS.green : COLORS.muted,
                          fontSize: 10, letterSpacing: '0.1em', minWidth: 60,
                        }}>{copied === v.id ? '✓ COPIED' : 'COPY'}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="6" style={{ padding: 40, textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
                  No entries match — try clearing the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════
// 8. TO-DO LIST
// ═════════════════════════════════════════════════════════════
const PRI = {
  P1: { color: COLORS.red,   label: 'P1', name: 'urgent' },
  P2: { color: COLORS.gold,  label: 'P2', name: 'soon' },
  P3: { color: COLORS.green, label: 'P3', name: 'someday' },
};

export function TodoList() {
  const [items, setItems] = useSyncedData(
    { localKey: 'se77n.todo.v2', serverKey: 'todo' },
    [
    { id: 't1', text: 'Ship desktop redesign (red/green/gold)', priority: 'P1', done: false, created: Date.now() - 86400000 },
    { id: 't2', text: 'Wire Spotify ambient palette (OAuth)',    priority: 'P2', done: false, created: Date.now() - 172800000 },
    { id: 't3', text: 'Replace mock VAULT with KV store',        priority: 'P2', done: false, created: Date.now() - 259200000 },
    { id: 't4', text: 'Drop the mobile demo into archives',      priority: 'P3', done: true,  created: Date.now() - 604800000 },
    ],
  );
  const [draft, setDraft] = useState('');
  const [pri, setPri] = useState('P2');
  const [filter, setFilter] = useState('open');

  function add() {
    const t = draft.trim();
    if (!t) return;
    setItems((arr) => [
      { id: 't' + Math.random().toString(36).slice(2, 8), text: t, priority: pri, done: false, created: Date.now() },
      ...arr,
    ]);
    setDraft('');
  }
  function toggle(id) { setItems((arr) => arr.map((i) => (i.id === id ? { ...i, done: !i.done } : i))); }
  function remove(id) { setItems((arr) => arr.filter((i) => i.id !== id)); }
  function setPriOf(id, p) { setItems((arr) => arr.map((i) => (i.id === id ? { ...i, priority: p } : i))); }

  const filtered = items.filter((i) => filter === 'all' || (filter === 'open' ? !i.done : i.done));
  const sorted = [...filtered].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const order = { P1: 0, P2: 1, P3: 2 };
    return order[a.priority] - order[b.priority] || b.created - a.created;
  });

  const counts = {
    open: items.filter((i) => !i.done).length,
    done: items.filter((i) => i.done).length,
    P1: items.filter((i) => !i.done && i.priority === 'P1').length,
    P2: items.filter((i) => !i.done && i.priority === 'P2').length,
    P3: items.filter((i) => !i.done && i.priority === 'P3').length,
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, height: '100%' }}>
      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Kicker>TASKS · {counts.open} OPEN · {counts.done} DONE</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>To-do list</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['open', 'done', 'all'].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className="mono" style={{
                padding: '6px 12px', borderRadius: 999,
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
                background: filter === f ? COLORS.red + '1a' : 'transparent',
                border: `1px solid ${filter === f ? COLORS.red + '60' : COLORS.line}`,
                color: filter === f ? COLORS.red : COLORS.muted,
              }}>{f}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: 16, borderBottom: '1px solid ' + COLORS.line, display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {Object.entries(PRI).map(([k, v]) => (
              <button key={k} onClick={() => setPri(k)} className="mono" title={v.name}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: pri === k ? v.color + '18' : 'transparent',
                  border: `1px solid ${pri === k ? v.color : COLORS.line}`,
                  color: pri === k ? v.color : COLORS.muted,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>{v.label}</button>
            ))}
          </div>
          <Field value={draft} onChange={setDraft} placeholder="New task… ⏎ to add"
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Btn variant="solid" onClick={add} disabled={!draft.trim()}>+ Add</Btn>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {sorted.map((it) => {
            const p = PRI[it.priority] || PRI.P2;
            return (
              <div key={it.id} style={{
                padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14,
                borderBottom: '1px solid ' + COLORS.line, transition: 'background 120ms',
                opacity: it.done ? 0.55 : 1,
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <button onClick={() => toggle(it.id)} aria-label="toggle" style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: it.done ? p.color : 'transparent',
                  border: `1.5px solid ${p.color}`,
                  cursor: 'pointer', display: 'grid', placeItems: 'center',
                  color: '#0d0a08', flexShrink: 0, transition: 'background 150ms',
                }}>
                  {it.done && <span style={{ fontSize: 13, fontWeight: 800 }}>✓</span>}
                </button>
                <select value={it.priority} onChange={(e) => setPriOf(it.id, e.target.value)} className="mono"
                  style={{
                    background: p.color + '14', border: `1px solid ${p.color}55`,
                    color: p.color, fontSize: 10, letterSpacing: '0.12em',
                    padding: '4px 6px', borderRadius: 4, cursor: 'pointer',
                  }}>
                  {Object.keys(PRI).map((k) => (
                    <option key={k} value={k} style={{ color: '#000' }}>{k}</option>
                  ))}
                </select>
                <div style={{ flex: 1, fontSize: 14, textDecoration: it.done ? 'line-through' : 'none' }}>{it.text}</div>
                <button onClick={() => remove(it.id)} className="mono"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: COLORS.muted, fontSize: 14, padding: 6,
                  }} title="delete">✕</button>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
              {filter === 'done' ? 'Chưa có task nào hoàn thành.' : filter === 'open' ? 'Inbox zero — nice.' : 'Empty list.'}
            </div>
          )}
        </div>
      </Panel>

      <Panel padding={20} style={{ overflow: 'auto' }}>
        <Kicker style={{ marginBottom: 16 }}>BREAKDOWN</Kicker>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Object.entries(PRI).map(([k, v]) => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: v.color, letterSpacing: '0.12em' }}>
                  {v.label} · {v.name.toUpperCase()}
                </span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{counts[k]}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: COLORS.bg, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: counts[k] === 0 ? '0%' : Math.min(100, counts[k] * 25) + '%',
                  background: v.color, transition: 'width 400ms',
                }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 24, padding: 14, borderRadius: 10,
          background: COLORS.bg, border: '1px solid ' + COLORS.line,
        }}>
          <Kicker style={{ marginBottom: 8 }}>STORAGE</Kicker>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
            ◇ persisted to localStorage<br />
            ◇ key: se77n.todo.v2<br />
            ◇ {items.length} items · {(JSON.stringify(items).length / 1024).toFixed(2)} KB
          </div>
        </div>
      </Panel>
    </div>
  );
}
