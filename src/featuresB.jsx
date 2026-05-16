import { useState, useEffect, useMemo } from 'react';
import {
  COLORS, TECH, VAULT_SEED,
  Panel, Btn, Field, Pill, Kicker, Sparkline,
  useSyncedData, copyText,
} from './lib.jsx';

// ═════════════════════════════════════════════════════════════
// 5. TECH STACK MONITOR — 11 services, $/month, breakdown
// ═════════════════════════════════════════════════════════════
const TECH_CATEGORY_COLORS = {
  design:   COLORS.gold,
  dev:      COLORS.green,
  infra:    COLORS.red,
  ai:       '#C77BFF',
  media:    '#7ABEFF',
  storage:  COLORS.muted,
  security: COLORS.gold,
};

export function TechStackMonitor() {
  const total = TECH.reduce((s, t) => s + t.cost, 0);
  const byCat = useMemo(() => {
    const m = {};
    for (const t of TECH) m[t.category] = (m[t.category] || 0) + t.cost;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, []);

  // Live USD→TWD/VND rate from /api/crypto for accurate burn estimates
  const [fx, setFx] = useState({ twd: 32, vnd: 25000 });
  useEffect(() => {
    let alive = true;
    fetch('/api/crypto')
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d) return;
        if (d.twd) setFx((f) => ({ ...f, twd: d.twd }));
        if (d.vnd) setFx((f) => ({ ...f, vnd: d.vnd }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, height: '100%' }}>
      <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Kicker>SUBSCRIPTIONS · 11</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Tech stack monitor</div>
          </div>
          <Pill color={COLORS.green}>● ALL ACTIVE</Pill>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
            <thead>
              <tr style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted, textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>SERVICE</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>CATEGORY</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>NATIVE</th>
                <th style={{ padding: '10px 12px', fontWeight: 500, textAlign: 'right' }}>USD/MO</th>
              </tr>
            </thead>
            <tbody>
              {TECH.map((t) => {
                const c = TECH_CATEGORY_COLORS[t.category] || COLORS.muted;
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid ' + COLORS.line }}>
                    <td style={{ padding: '14px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: 8,
                          border: `1px solid ${c}55`, background: c + '14',
                          display: 'grid', placeItems: 'center',
                          color: c, fontSize: 12, fontWeight: 700,
                        }}>{t.name[0]}</span>
                        <span style={{ fontSize: 13, color: COLORS.text }}>{t.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 12px' }}>
                      <Pill color={c}>{t.category}</Pill>
                    </td>
                    <td style={{ padding: '14px 12px', fontSize: 12, color: COLORS.muted }}>
                      {t.native.toLocaleString()} {t.currency}
                    </td>
                    <td style={{ padding: '14px 12px', fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
                      ${t.cost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid ' + COLORS.red + '40' }}>
                <td colSpan="3" style={{ padding: '16px 12px', fontSize: 11, letterSpacing: '0.18em', color: COLORS.muted }}>
                  TOTAL · MONTHLY
                </td>
                <td style={{ padding: '16px 12px', fontSize: 18, fontWeight: 800, color: COLORS.red, textAlign: 'right' }}>
                  ${total.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td colSpan="3" style={{ padding: '6px 12px', fontSize: 10, color: COLORS.muted }}>
                  PROJECTED · ANNUAL
                </td>
                <td style={{ padding: '6px 12px', fontSize: 12, color: COLORS.muted, textAlign: 'right' }}>
                  ${(total * 12).toFixed(0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel padding={20} style={{ overflow: 'auto' }}>
        <Kicker style={{ marginBottom: 16 }}>BREAKDOWN BY CATEGORY</Kicker>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {byCat.map(([cat, sum]) => {
            const pct = (sum / total) * 100;
            const c = TECH_CATEGORY_COLORS[cat] || COLORS.muted;
            return (
              <div key={cat}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: c, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{cat}</span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>${sum.toFixed(2)} · {pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: COLORS.bg, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: pct + '%',
                    background: c, opacity: 0.85, transition: 'width 600ms ease-out',
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 24, padding: 16, borderRadius: 12,
          background: 'linear-gradient(135deg, ' + COLORS.red + '14, ' + COLORS.gold + '0a)',
          border: '1px solid ' + COLORS.red + '40',
        }}>
          <Kicker style={{ color: COLORS.red, marginBottom: 8 }}>MONTHLY BURN</Kicker>
          <div className="mono" style={{ fontSize: 30, fontWeight: 800 }}>
            ${total.toFixed(2)}
            <span style={{ fontSize: 11, color: COLORS.muted, marginLeft: 8, fontWeight: 400 }}>USD</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
            ≈ {(total * fx.twd).toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD<br />
            ≈ {(total * fx.vnd).toLocaleString(undefined, { maximumFractionDigits: 0 })} VND
          </div>
        </div>
      </Panel>
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
