import { useState, useEffect, useMemo, useRef, useId } from 'react';
import {
  COLORS, withAlpha,
  useSyncedData, useAuth, useMediaQuery,
} from './lib.jsx';
import { PixelArrow, ModuleIcon, DialogBox, PxButton } from './ui/arcade.jsx';
import './featuresB.arcade.css';

// ── "B · Pixel Lobby" palette for this file ───────────────────────
// Neutrals come from COLORS (CSS variables → light/dark). Accents are hex
// fills and always carry INK text. The "screen" surfaces (ticker, LCD,
// HUD cells) sit on the always-dark strip.
const INK = COLORS.onAccent;
const SCREEN_TEXT = COLORS.stripText;
const SCREEN_MUTED = '#c9bca6';
const RED_INK = 'var(--fb-red-ink)';
const SK_FONT = "'Silkscreen', 'JetBrains Mono', monospace";
const AC = {
  red: '#ff7a7a', danger: '#e04545', gold: '#ffd25e', coin: '#ffc93c', green: '#7fd18b',
  sky: '#9fd8ff', violet: '#b9a2ff', orange: '#ffa764', rule: '#d8cdb9',
};

// ── Pixel icons ───────────────────────────────────────────────────
const COIN_PATH = 'M2 0h4v1h1v1h1v4H7v1H6v1H2V7H1V6H0V2h1V1h1z';
const ICO = {
  x: 'M6 6l12 12M18 6L6 18',
  pencil: 'M4 20h4L20 8l-4-4L4 16zM13.5 6.5l4 4',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  stack: 'M3 3h12v12H3zM9 9h12v12H9z',
  image: 'M3 4h18v16H3zM3 14l5-4 3 3M14 20l-2-5 4-3 5 4',
};

function Ico({ d, size = 18, sw = 2.4, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d={d} />
    </svg>
  );
}

// Spinning coin with a letter stamped on it.
function CoinBadge({ size = 60, letter, fill = AC.coin, spin = true }) {
  return (
    <span className={spin ? 'coin-spin' : undefined} aria-hidden="true"
      style={{ position: 'relative', display: 'inline-block', flexShrink: 0, width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" style={{ position: 'absolute', inset: 0 }}>
        <path d={COIN_PATH} fill={fill} stroke="#fffaf0" strokeWidth="0.3" />
        <path d="M2 1h4v1h1v4H6v1H2V6H1V2h1z" fill="none" stroke="#c98a12" strokeWidth="0.3" />
      </svg>
      {letter && (
        <span className="pf" style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: Math.round(size * 0.43), lineHeight: 1, color: INK,
        }}>{letter}</span>
      )}
    </span>
  );
}

function GoldBar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M2 3h6v1h1v2h1v3H0V6h1V4h1z" fill={AC.coin} stroke="#fffaf0" strokeWidth="0.3" />
      <rect x="3" y="4" width="3" height="1" fill="#fff3c4" />
      <rect x="1" y="7" width="8" height="1" fill="#c98a12" />
    </svg>
  );
}

function TwinCoins({ size = 60 }) {
  const c = Math.round(size * 0.63);
  return (
    <span aria-hidden="true" style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <svg width={c} height={c} viewBox="0 0 8 8" shapeRendering="crispEdges" style={{ position: 'absolute', left: 0, top: 0 }}>
        <path d={COIN_PATH} fill={AC.green} stroke="#fffaf0" strokeWidth="0.4" />
      </svg>
      <svg width={c} height={c} viewBox="0 0 8 8" shapeRendering="crispEdges" style={{ position: 'absolute', right: 0, bottom: 0 }}>
        <path d={COIN_PATH} fill={AC.red} stroke="#fffaf0" strokeWidth="0.4" />
      </svg>
    </span>
  );
}

// Memory card (History module). `empty` draws a dashed label window.
function MemCard({ w = 16, fill = '#fffaf0', empty = false }) {
  return (
    <svg width={w} height={Math.round(w * 1.2)} viewBox="0 0 10 12" shapeRendering="crispEdges" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M0 0h8v1h1v1h1v10H0z" fill={fill} stroke="#1b1410" strokeWidth={w > 24 ? 0.7 : 1} />
      {empty
        ? <rect x="2" y="6" width="6" height="4" fill="none" stroke="#1b1410" strokeWidth="0.5" strokeDasharray="1 0.6" />
        : <rect x="2" y="6" width="6" height="4" fill="#1b1410" />}
      <rect x="2" y="1.5" width="1" height="2.5" fill="#1b1410" />
      <rect x="4" y="1.5" width="1" height="2.5" fill="#1b1410" />
      <rect x="6" y="1.5" width="1" height="2.5" fill="#1b1410" />
    </svg>
  );
}

function PixelGuest({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M3 0h2v1h1v2H5v1H3V3H2V1h1zM1 5h6v1h1v2H0V6h1z" fill={INK} />
    </svg>
  );
}

function PixelTick() {
  return (
    <svg className="fb-tick" width="20" height="15" viewBox="0 0 8 6" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M6 0h2v1H6zM5 1h2v1H5zM0 2h1v1H0zM4 2h2v1H4zM0 3h2v1H0zM3 3h2v1H3zM1 4h3v1H1zM2 5h1v1H2z" fill={INK} />
    </svg>
  );
}

// ⇅ as pixels: up arrow on the left, down arrow on the right.
function PixelSwap({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M1 0h1v1h1v1H2v5H1V2H0V1h1zM5 0h1v5h1v1H6v1H5V6H4V5h1z" fill="currentColor" />
    </svg>
  );
}

function PixelChest() {
  return (
    <svg width="72" height="60" viewBox="0 0 12 10" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M1 4h10v6H1z" fill="#d8cdb9" stroke="#1b1410" strokeWidth="0.5" />
      <path d="M0 1h12v3H0z" fill="#c9733e" stroke="#1b1410" strokeWidth="0.5" />
      <rect x="5" y="3" width="2" height="3" fill={AC.coin} stroke="#1b1410" strokeWidth="0.4" />
    </svg>
  );
}

function PixelScroll() {
  return (
    <svg width="52" height="52" viewBox="0 0 13 13" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 1h8v1h1v10H2z" fill="#fffaf0" stroke="#1b1410" strokeWidth="1" />
      <path d="M4 4h5v1H4zM4 6h5v1H4zM4 8h3v1H4z" fill={AC.green} />
    </svg>
  );
}

// ▲ / ▼ for price deltas.
function DeltaArrow({ up, size = 7 }) {
  return <PixelArrow dir="down" size={size} style={up ? { transform: 'scaleY(-1)' } : undefined} />;
}

// ── Shared pieces ─────────────────────────────────────────────────
function Kick({ children, style, id }) {
  return <p id={id} className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted, ...style }}>{children}</p>;
}

// Small status tag (YOURS / PUBLIC · READ ONLY / LIVE …).
function Tag({ bg, children, dot = false, blink = false, style }) {
  return (
    <span className="sk pxs" style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 11,
      background: bg || COLORS.paper, color: bg ? INK : COLORS.text, whiteSpace: 'nowrap', ...style,
    }}>
      {dot && <span className={'fb-tdot' + (blink ? ' blink' : '')} aria-hidden="true" />}
      {children}
    </span>
  );
}

// Ribbed cartridge strip used as a header on accent cards.
function CartStrip({ bg, children, right, height = 30, style }) {
  return (
    <div className="sk ribs" style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
      height, padding: '0 12px', fontSize: 12, textTransform: 'uppercase',
      color: INK, backgroundColor: bg, borderBottom: '3px solid ' + COLORS.ink, ...style,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {children}
      </span>
      {right != null && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

// Ink name plate that straddles the top edge of a panel.
function Plate({ children, as: Tag = 'span', id, style }) {
  return (
    <Tag id={id} className="sk" style={{
      position: 'absolute', left: 20, top: -14, zIndex: 1, margin: 0, padding: '7px 12px',
      fontFamily: SK_FONT, fontSize: 12, lineHeight: 1.2, color: SCREEN_TEXT, background: COLORS.strip, ...style,
    }}>{children}</Tag>
  );
}

function ErrBox({ children, style }) {
  return (
    <div role="alert" className="mono" style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
      fontSize: 12, lineHeight: 1.5, color: RED_INK, background: COLORS.paper,
      borderLeft: '6px solid ' + AC.danger, boxShadow: 'inset 0 0 0 2px ' + withAlpha(AC.danger, 0.35), ...style,
    }}>
      <Ico d={ICO.x} size={14} sw={3} style={{ marginTop: 2 }} />
      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

function Loading({ label }) {
  return (
    <div role="status" className="sk" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      padding: '44px 16px', fontSize: 12, color: COLORS.muted,
    }}>
      <span className="dots-step" aria-hidden="true" style={{ display: 'inline-flex' }}><i /><i /><i /></span>
      {label}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 5. TECH STACK MONITOR — per-user subscription tracker
// ═════════════════════════════════════════════════════════════
const TECH_CURRENCIES = ['USD', 'TWD', 'VND', 'EUR', 'JPY', 'KRW', 'SGD', 'CAD', 'GBP', 'CNY', 'THB', 'AUD'];

// Hard-coded fallback in case the server response is missing rates for a currency.
// Mirrors api/toolbox.js FX_FALLBACK so the UI stays sane even if FX fetch fails.
const FX_FALLBACK_CLIENT = {
  USD: 1, TWD: 32, VND: 25500, EUR: 0.92, JPY: 155, KRW: 1370,
  SGD: 1.34, CAD: 1.37, GBP: 0.79, CNY: 7.2, THB: 36, AUD: 1.52,
};

function getRate(fxRates, ccy) {
  const r = fxRates?.[ccy];
  if (Number.isFinite(r) && r > 0) return r;
  return FX_FALLBACK_CLIENT[ccy] || null;
}

function subToMonthlyUSD(sub, fxRates) {
  const rate = getRate(fxRates, sub.currency);
  if (!rate) return 0;
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

function fmtRate(r) {
  if (!Number.isFinite(r)) return '—';
  if (r >= 1000) return r.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (r >= 10) return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return r.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const fmt0 = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function TechStackMonitor() {
  const auth = useAuth();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const uid = useId();
  const [data, setData] = useState(null); // { subs, owner, fx }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name } | null
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

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
    const twdRate = getRate(fxRates, 'TWD') || 0;
    const vndRate = getRate(fxRates, 'VND') || 0;
    return {
      monthlyUSD,
      yearlyUSD: monthlyUSD * 12,
      monthlyTWD: monthlyUSD * twdRate,
      monthlyVND: monthlyUSD * vndRate,
      yearlyTWD: monthlyUSD * 12 * twdRate,
      yearlyVND: monthlyUSD * 12 * vndRate,
    };
  }, [subs, fxRates]);

  // Desktop shows the add/edit form in the side column (row stays highlighted);
  // phones keep it inline, where the row was.
  const editingSub = editingId != null ? subs.find((s) => s.id === editingId) || null : null;
  const listReady = !loading && !err;

  const addForm = adding ? (
    <SubForm
      key="add"
      initial={{ name: '', price: '', currency: 'VND', period: 'monthly', url: '', nextRenewal: '' }}
      fxRates={fxRates}
      kicker="NEW SUBSCRIPTION"
      title="Add subscription"
      inline={isMobile}
      onCancel={() => setAdding(false)}
      onSave={async (sub) => {
        await addSub(sub);
        setAdding(false);
      }}
    />
  ) : null;

  function editForm(s) {
    return (
      <SubForm
        key={'edit-' + s.id}
        initial={s}
        fxRates={fxRates}
        kicker={'EDIT · ' + String(s.name || '')}
        title="Edit subscription"
        inline={isMobile}
        onCancel={() => setEditingId(null)}
        onSave={async (sub) => {
          await updateSub(s.id, sub);
          setEditingId(null);
        }}
      />
    );
  }

  const count2 = String(subs.length).padStart(2, '0');

  return (
    <div className="fb-root fb-col">
      {/* ── HUD: upkeep totals ── */}
      <section aria-label="Upkeep totals" className="px rise" style={{ background: COLORS.paper }}>
        <div className="fb-hud">
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '22px 26px', minWidth: 0, background: COLORS.strip, color: SCREEN_TEXT }}>
            <CoinBadge size={isMobile ? 48 : 60} letter="$" />
            <div style={{ minWidth: 0 }}>
              <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: SCREEN_MUTED }}>MONTHLY BURN</p>
              <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
                <span className="pf fb-hud-big" style={{ lineHeight: 1, color: AC.gold }}>${totals.monthlyUSD.toFixed(2)}</span>{' '}
                <span className="sk" style={{ fontSize: 12, color: SCREEN_MUTED }}>USD</span>
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.6, color: SCREEN_MUTED }}>
                ≈ {fmt0(totals.monthlyTWD)} TWD · ≈ {fmt0(totals.monthlyVND)} VND
              </p>
            </div>
          </div>
          <div style={{ padding: '22px 26px', minWidth: 0 }}>
            <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted }}>YEARLY BURN</p>
            <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
              <span className="pf" style={{ fontSize: 36, lineHeight: 1 }}>${totals.yearlyUSD.toFixed(0)}</span>{' '}
              <span className="sk" style={{ fontSize: 12, color: COLORS.muted }}>USD</span>
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.6, color: COLORS.muted }}>
              ≈ {fmt0(totals.yearlyTWD)} TWD<br />
              ≈ {fmt0(totals.yearlyVND)} VND
            </p>
          </div>
          <div style={{ padding: '22px 26px', minWidth: 0 }}>
            <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted }}>PARTY SIZE</p>
            <p className="pf" style={{ margin: 0, fontSize: 36, lineHeight: 1 }}>{count2}</p>
            <p className="sk" style={{ margin: '10px 0 0', fontSize: 11, color: COLORS.muted }}>
              {subs.length === 1 ? 'SUBSCRIPTION' : 'SUBSCRIPTIONS'}
            </p>
          </div>
        </div>
      </section>

      <div className="fb-row">
        {/* ── Inventory + advisor ── */}
        <div className="fb-main fb-col">
          <section aria-labelledby={uid + 'inv'} className="px rise" style={{ background: COLORS.paper, animationDelay: '60ms' }}>
            <div style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              padding: '20px 24px', borderBottom: '4px solid ' + COLORS.ink,
            }}>
              <div style={{ minWidth: 0 }}>
                <Kick style={{ fontSize: 12, marginBottom: 6 }}>SUBSCRIPTIONS · {count2}</Kick>
                <h2 id={uid + 'inv'} className="pf" style={{ margin: 0, fontSize: 28, lineHeight: 1.05, overflowWrap: 'anywhere' }}>
                  {data?.owner?.name ? `${data.owner.name}'s subscriptions` : 'Inventory'}
                </h2>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 22px', padding: '4px 10px 10px 4px' }}>
                {isYou
                  ? <Tag bg={AC.green} dot>YOURS</Tag>
                  : <Tag bg={AC.gold} dot>PUBLIC · READ ONLY</Tag>}
                {isYou && !adding && (
                  <PxButton kind="big" fill={AC.green} onClick={() => setAdding(true)} style={{ minHeight: 44, padding: '0 16px', fontSize: 13 }}>
                    <Ico d={ICO.plus} size={14} sw={3} />Add
                  </PxButton>
                )}
              </div>
            </div>

            {loading ? (
              <Loading label="LOADING STACK…" />
            ) : err ? (
              <div style={{ padding: 24 }}><ErrBox>{err}</ErrBox></div>
            ) : (
              <div style={{ padding: '8px 16px 18px' }}>
                {isMobile && addForm && <div style={{ padding: '16px 4px 24px' }}>{addForm}</div>}

                {subs.length === 0 ? (
                  (!adding || !isMobile) && (
                    <EmptyState isYou={isYou} canAdd={!adding} onAdd={() => setAdding(true)} />
                  )
                ) : (
                  <>
                    <div className={'fb-srow fb-srow-h sk' + (isYou ? '' : ' ro')} aria-hidden="true">
                      <span className="c-svc">SERVICE · RENEWAL HP</span>
                      <span className="c-nat">NATIVE</span>
                      <span className="c-per">PERIOD</span>
                      <span className="c-usd">USD/MO</span>
                      {isYou && <span className="c-act" />}
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {subs.map((s) => (isMobile && editingId === s.id ? (
                        <li key={s.id} style={{ padding: '18px 4px 24px', borderBottom: '3px dashed ' + COLORS.rule }}>
                          {editForm(s)}
                        </li>
                      ) : (
                        <SubRow
                          key={s.id}
                          s={s}
                          fxRates={fxRates}
                          isYou={isYou}
                          editing={editingId === s.id}
                          onEdit={() => setEditingId(s.id)}
                          onDelete={() => {
                            setConfirmDelete({ id: s.id, name: s.name });
                            setDeleteErr('');
                          }}
                        />
                      )))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>

          <StackChat subs={subs} fxRates={fxRates} owner={data?.owner} totals={totals} />
        </div>

        {/* ── Side: form, visitor sign-in, FX table ── */}
        <aside aria-label="Edit subscription and FX rates" className="fb-side fb-col">
          {!isMobile && listReady && addForm}
          {!isMobile && listReady && editingSub && editForm(editingSub)}

          {!isYou && (
            <section aria-labelledby={uid + 'own'} className="px rise" style={{ padding: '20px 20px 24px', background: COLORS.paper, animationDelay: '100ms' }}>
              <h2 id={uid + 'own'} className="sk" style={{ margin: '0 0 10px', fontFamily: SK_FONT, fontSize: 13, color: COLORS.greenInk }}>
                CREATE YOUR OWN
              </h2>
              <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>
                {auth.status === 'authed'
                  ? 'Sign in as a different account to manage your own subscription stack.'
                  : 'Sign in to track your own subscriptions. Private — only you see your list.'}
              </p>
              {auth.status === 'authed' ? (
                <div style={{ padding: '0 8px 8px 0' }}>
                  <PxButton fill={AC.green} onClick={() => auth.logout()} style={{ minHeight: 44, fontSize: 13 }}>Sign out</PxButton>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: '0 8px 8px 0' }}>
                  <PxButton fill={AC.green} onClick={() => auth.login('google')} style={{ minHeight: 44, fontSize: 13 }}>Google</PxButton>
                  <PxButton onClick={() => auth.login('discord')} style={{ minHeight: 44, fontSize: 13 }}>Discord</PxButton>
                </div>
              )}
            </section>
          )}

          <section aria-labelledby={uid + 'fx'} className="px rise" style={{ padding: '20px 20px 22px', background: COLORS.paper, animationDelay: '160ms' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ minWidth: 0 }}>
                <Kick style={{ marginBottom: 6 }}>FX RATES · 1 USD =</Kick>
                <h2 id={uid + 'fx'} className="pf" style={{ margin: 0, fontSize: 24, lineHeight: 1 }}>Exchange table</h2>
              </div>
              {data?.fx
                ? <Tag bg={AC.green} style={{ padding: '4px 8px', fontSize: 10 }}>LIVE</Tag>
                : <Tag style={{ padding: '4px 8px', fontSize: 10, color: COLORS.muted }}>{loading ? 'LOADING' : 'FALLBACK'}</Tag>}
            </div>
            <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
              {TECH_CURRENCIES.map((c) => (
                <li key={c} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', minWidth: 0, background: COLORS.cream }}>
                  <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>{c}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{fmtRate(getRate(fxRates, c))}</span>
                </li>
              ))}
            </ul>
            <p style={{ margin: '16px 0 0', fontSize: 11, lineHeight: 1.55, color: COLORS.muted }}>
              FX rates auto-refreshed from exchangerate.host. Yearly subs amortized to monthly for burn math.
            </p>
          </section>
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete subscription?"
          body={<>This will permanently remove <strong style={{ color: COLORS.text }}>"{confirmDelete.name}"</strong> from your stack.</>}
          confirmLabel="Delete"
          confirmColor={AC.red}
          busy={deleteBusy}
          err={deleteErr}
          onCancel={() => { setConfirmDelete(null); setDeleteErr(''); }}
          onConfirm={async () => {
            setDeleteBusy(true); setDeleteErr('');
            try {
              await deleteSub(confirmDelete.id);
              setConfirmDelete(null);
            } catch (e) {
              setDeleteErr(e.message || 'Delete failed');
            } finally {
              setDeleteBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

// One inventory row: service + renewal HP bar, native price, cycle, USD/mo, actions.
function SubRow({ s, fxRates, isYou, editing, onEdit, onDelete }) {
  const monthly = subToMonthlyUSD(s, fxRates);
  const days = daysUntil(s.nextRenewal);
  const low = days != null && days < 7;
  const yearly = s.period === 'yearly';
  // Renewal HP: share of the billing cycle left before the next charge.
  const hp = days == null ? null : Math.max(0, Math.min(1, days / (yearly ? 365 : 30)));

  return (
    <li className={'fb-srow' + (isYou ? '' : ' ro') + (editing ? ' fb-srow-on' : '')}>
      <div className="c-svc" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="pf pxs" aria-hidden="true" style={{
          display: 'grid', placeItems: 'center', flexShrink: 0, width: 44, height: 44,
          fontSize: 22, background: AC.green, color: INK,
        }}>{s.name[0]?.toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
              fontSize: 14, fontWeight: 700, color: COLORS.text, textDecoration: 'none', overflowWrap: 'anywhere',
            }}>{s.name}<Ico d={ICO.ext} size={13} sw={2.6} /></a>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, overflowWrap: 'anywhere' }}>{s.name}</span>
          )}
          {s.nextRenewal && (
            <div style={{ marginTop: 4, fontSize: 11, color: low ? RED_INK : COLORS.muted, fontWeight: low ? 700 : 400 }}>
              renews {s.nextRenewal}{days != null && (days < 0 ? ' · overdue' : ` · in ${days}d`)}
            </div>
          )}
          <div title={hp == null ? 'No renewal date' : `Renewal HP ${Math.round(hp * 100)}%`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span className="sk" style={{ fontSize: 10, color: COLORS.text }}>HP</span>
            {hp == null ? (
              <span aria-hidden="true" style={{ flex: 1, maxWidth: 200, height: 14, border: '3px dashed ' + COLORS.rule }} />
            ) : (
              <div className="hpbar" aria-hidden="true" style={{ flex: 1, maxWidth: 200, height: 14, '--a': low ? AC.danger : AC.green }}>
                <span style={{ width: hp * 100 + '%' }} />
              </div>
            )}
          </div>
        </div>
      </div>
      <span className="c-nat" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, color: COLORS.muted }}>
        <span style={{ overflowWrap: 'anywhere' }}>{Number(s.price).toLocaleString()}</span>
        <span className="sk pxs" style={{ padding: '3px 6px', fontSize: 10, color: COLORS.text, background: COLORS.cream }}>{s.currency}</span>
      </span>
      <span className="c-per">
        <span className="sk pxs fb-cyc" style={{ background: yearly ? AC.gold : AC.sky }}>{yearly ? 'YEARLY' : 'MONTHLY'}</span>
      </span>
      <span className="c-usd" style={{ fontSize: 15, fontWeight: 700 }}>${monthly.toFixed(2)}</span>
      {isYou && (
        <span className="c-act" style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, padding: '0 8px 8px 0' }}>
          <button type="button" className="sbtn fb-icob" onClick={onEdit} title="Edit" aria-label={`Edit ${s.name}`}>
            <Ico d={ICO.pencil} />
          </button>
          <button type="button" className="sbtn fb-icob" onClick={onDelete} title="Delete" aria-label={`Delete ${s.name}`}>
            <Ico d={ICO.x} />
          </button>
        </span>
      )}
    </li>
  );
}

// Pixel confirm. Modal by default; `inline` renders it inside a card with an
// ink plate (History save slots). Esc cancels, Enter confirms either way.
function ConfirmDialog({ title, body, confirmLabel, confirmColor, onConfirm, onCancel, busy, err, inline = false, plate }) {
  const uid = useId();
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy) onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onConfirm, onCancel]);

  const box = (
    <div
      role="alertdialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={uid + 'h'}
      aria-describedby={uid + 'b'}
      className={inline ? 'pxs' : 'px rise'}
      style={{
        position: 'relative', width: '100%', maxWidth: inline ? undefined : 440,
        padding: inline ? '22px 16px 14px' : '26px 26px 22px',
        background: COLORS.paper, color: COLORS.text,
        borderLeft: inline ? '6px solid ' + AC.danger : undefined,
      }}
    >
      {!inline && (
        <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', fontSize: 12, color: RED_INK }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, background: AC.danger }} />CONFIRM
        </p>
      )}
      <h2 id={uid + 'h'} className="pf" style={{ margin: '0 0 10px', fontSize: inline ? 20 : 28, lineHeight: 1.1 }}>{title}</h2>
      <div id={uid + 'b'} style={{ margin: inline ? '0 0 14px' : '0 0 22px', fontSize: inline ? 12 : 13, lineHeight: 1.55, color: COLORS.muted }}>{body}</div>
      {err && <ErrBox style={{ marginBottom: 14 }}>{err}</ErrBox>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: inline ? 16 : 22, padding: '0 8px 8px 0' }}>
        <PxButton onClick={onCancel} disabled={busy} style={inline ? { minHeight: 34, padding: '0 12px', fontSize: 11 } : { minHeight: 44, fontSize: 13 }}>
          Cancel
        </PxButton>
        <PxButton fill={confirmColor || AC.red} onClick={onConfirm} disabled={busy} style={inline ? { minHeight: 34, padding: '0 12px', fontSize: 11 } : { minHeight: 44, fontSize: 13 }}>
          {busy ? 'Working…' : confirmLabel}
        </PxButton>
      </div>
      <p className="sk fb-hide-sm" style={{ margin: inline ? '10px 0 0' : '16px 0 0', fontSize: 10, color: COLORS.muted }}>
        ESC · CANCEL — ENTER · {String(confirmLabel).toUpperCase()}
      </p>
    </div>
  );

  if (inline) {
    return (
      <div style={{ position: 'relative', marginTop: 12 }}>
        {plate && <Plate style={{ left: 12, top: -12, padding: '4px 10px', fontSize: 10 }}>{plate}</Plate>}
        {box}
      </div>
    );
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(27, 20, 16, 0.6)',
        display: 'grid', placeItems: 'center',
        animation: 'fadeIn 120ms steps(3)',
        padding: 24,
      }}
    >
      {box}
    </div>
  );
}

// ── Stack chat: collapsed by default, expands into an RPG dialog box ──
function StackChat({ subs, fxRates, owner, totals }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, text }]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bodyRef = useRef(null);
  const taRef = useRef(null);

  // Build a fresh system prompt every send so it reflects current totals/subs.
  function buildSystem() {
    const lines = subs.map((s, i) => {
      const monthlyUSD = subToMonthlyUSD(s, fxRates);
      const periodTag = s.period === 'yearly' ? '/yr' : '/mo';
      const url = s.url ? ` <${s.url}>` : '';
      const renew = s.nextRenewal ? ` · renews ${s.nextRenewal}` : '';
      return `${i + 1}. ${s.name} — ${s.price} ${s.currency}${periodTag} (~$${monthlyUSD.toFixed(2)} USD/mo)${url}${renew}`;
    }).join('\n');

    const ownerTag = owner?.isYou ? "the user's own" : `${owner?.name || 'a public'}`;
    return (
      `You are se77n's subscription advisor — a concise, opinionated financial copilot focused on recurring software/service spending.\n\n` +
      `You are looking at ${ownerTag} subscription stack:\n` +
      (lines || '(empty)') +
      `\n\nTotals:\n` +
      `- Monthly burn: $${totals.monthlyUSD.toFixed(2)} USD ≈ ${totals.monthlyTWD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD ≈ ${totals.monthlyVND.toLocaleString(undefined, { maximumFractionDigits: 0 })} VND\n` +
      `- Yearly burn: $${totals.yearlyUSD.toFixed(0)} USD ≈ ${totals.yearlyTWD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD ≈ ${totals.yearlyVND.toLocaleString(undefined, { maximumFractionDigits: 0 })} VND\n\n` +
      `Style: short paragraphs or bullet lists. Lean on numbers. If asked for analysis, ` +
      `look for: (1) duplicates / overlap, (2) most expensive, (3) underused categories, ` +
      `(4) yearly savings if switching from monthly→annual or cancelling. Match the user's language (English or Vietnamese).`
    );
  }

  async function sendPrompt(userText, opts = {}) {
    if (busy) return;
    setBusy(true); setErr('');
    const isAuto = opts.auto === true;
    // For the auto-summary we don't show the prompt as a user bubble — feels chatty.
    const next = isAuto ? messages : [...messages, { role: 'user', text: userText }];
    if (!isAuto) setMessages(next);
    try {
      const transcript = next.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
      const prompt = isAuto
        ? userText
        : (transcript ? transcript + '\n\nAssistant:' : userText);
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: buildSystem(), prompt }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Chat failed');
      setMessages([...next, { role: 'assistant', text: data.text || '(empty response)' }]);
    } catch (e) {
      setErr(e.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function onOpen() {
    setOpen(true);
    if (messages.length === 0 && subs.length > 0) {
      sendPrompt(
        `Give a brief summary of this subscription stack: total monthly + yearly burn, the 3 most expensive items, and 1–2 honest suggestions (cancel/downgrade/switch to annual). 4–6 short bullets.`,
        { auto: true },
      );
    }
  }

  async function onSend() {
    const t = input.trim();
    if (!t) return;
    setInput('');
    await sendPrompt(t);
  }

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, busy]);

  // Collapsed
  if (!open) {
    const enabled = subs.length > 0;
    return (
      <button
        type="button"
        onClick={onOpen}
        disabled={subs.length === 0}
        className={'px' + (enabled ? ' lift' : '')}
        style={{
          display: 'flex', alignItems: 'center', gap: 18, width: '100%', padding: '18px 22px',
          textAlign: 'left', fontFamily: 'inherit', border: 0,
          color: COLORS.text, background: enabled ? COLORS.paper : COLORS.cream,
          cursor: enabled ? 'pointer' : 'not-allowed',
        }}
      >
        <span className="pxs" aria-hidden="true" style={{
          display: 'grid', placeItems: 'center', flexShrink: 0, width: 44, height: 44,
          background: enabled ? AC.green : COLORS.paper, color: enabled ? INK : COLORS.muted,
        }}><ModuleIcon id="ai" size={24} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="sk" style={{ display: 'block', fontSize: 13, color: enabled ? COLORS.text : COLORS.muted }}>
            ASK AI · STACK ADVISOR
          </span>
          <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: COLORS.muted }}>
            {subs.length === 0
              ? 'Add a subscription to enable analysis.'
              : `Get a summary + suggestions on ${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'}.`}
          </span>
        </span>
        {enabled && <PixelArrow dir="down" size={9} color={COLORS.text} />}
      </button>
    );
  }

  // Expanded
  return (
    <section aria-labelledby={uid + 'h'} className="rise" style={{ position: 'relative' }}>
      <Plate>STACK ADVISOR SAYS:</Plate>
      <div className="px" style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: COLORS.paper }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
          padding: '30px 24px 16px', borderBottom: '3px dashed ' + COLORS.rule,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <span className="pxs" aria-hidden="true" style={{
              display: 'grid', placeItems: 'center', flexShrink: 0, width: 40, height: 40, background: AC.green, color: INK,
            }}><ModuleIcon id="ai" size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <h2 id={uid + 'h'} className="sk" style={{ margin: 0, fontFamily: SK_FONT, fontSize: 14 }}>ASK AI · STACK ADVISOR</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.muted }}>
                Gemini · context: {subs.length} subs · ${totals.monthlyUSD.toFixed(0)}/mo
              </p>
            </div>
          </div>
          <button type="button" className="sbtn fb-icob" onClick={() => setOpen(false)} title="Close" aria-label="Close stack advisor">
            <Ico d={ICO.x} />
          </button>
        </div>

        <div ref={bodyRef} aria-live="polite" style={{
          display: 'flex', flexDirection: 'column', gap: 16, minHeight: 120, maxHeight: 380,
          overflowY: 'auto', padding: '18px 24px 22px',
        }}>
          {messages.length === 0 && !busy && (
            <p className="sk" style={{ margin: 'auto', padding: 20, fontSize: 11, color: COLORS.muted, textAlign: 'center' }}>
              Type a question below.
            </p>
          )}
          {messages.map((m, i) => {
            const mine = m.role === 'user';
            const lastReply = !mine && i === messages.length - 1 && !busy;
            return (
              <div key={i} style={{
                position: 'relative', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%',
                padding: mine ? '12px 16px' : '14px 18px 20px',
                fontSize: 13, lineHeight: 1.6, color: mine ? INK : COLORS.text,
                background: mine ? AC.green : COLORS.cream, border: '3px solid ' + COLORS.ink,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.text}
                {lastReply && (
                  <PixelArrow dir="down" size={9} color={AC.danger} className="bob" style={{ position: 'absolute', right: 10, bottom: 6 }} />
                )}
              </div>
            );
          })}
          {busy && (
            <div role="status" className="sk" style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', fontSize: 11, background: COLORS.cream, border: '3px solid ' + COLORS.ink,
            }}>
              THINKING
              <span className="dots-step" aria-hidden="true" style={{ display: 'inline-flex' }}><i /><i /><i /></span>
            </div>
          )}
        </div>

        {err && <ErrBox style={{ margin: '0 24px 12px' }}>{err}</ErrBox>}

        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 20,
          padding: '16px 24px 24px', borderTop: '3px dashed ' + COLORS.rule,
        }}>
          <label htmlFor={uid + 'in'} className="sr">Ask follow-up</label>
          <textarea
            id={uid + 'in'}
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            rows={1}
            placeholder="Ask follow-up… (Enter to send, Shift+Enter for newline)"
            className="mono field"
            style={{
              flex: 1, minWidth: 0, minHeight: 48, maxHeight: 120, resize: 'none',
              padding: '13px 14px', fontSize: 13, lineHeight: 1.5,
            }}
          />
          <PxButton kind="big" fill={AC.green} onClick={onSend} disabled={busy || !input.trim()}
            style={{ flexShrink: 0, minHeight: 48, padding: '0 20px', fontSize: 13, marginRight: 8 }}>
            Send
          </PxButton>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ isYou, onAdd, canAdd = true }) {
  return (
    <div style={{
      margin: '14px 4px 4px', padding: '40px 24px', textAlign: 'center',
      background: COLORS.cream, border: '3px dashed ' + COLORS.rule,
    }}>
      <PixelChest />
      <p className="sk" style={{ margin: '16px 0 8px', fontSize: 15, color: COLORS.text }}>
        {isYou ? 'NO SUBSCRIPTIONS YET' : 'STACK IS EMPTY'}
      </p>
      <p style={{ margin: '0 auto', maxWidth: 420, fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>
        {isYou
          ? 'Add Netflix, Spotify, Cursor, AWS, anything you pay for monthly or yearly.'
          : 'The owner hasn\'t added any subscriptions yet.'}
      </p>
      {isYou && canAdd && (
        <PxButton fill={AC.green} onClick={onAdd} style={{ marginTop: 22, minHeight: 44, fontSize: 13 }}>
          <Ico d={ICO.plus} size={14} sw={3} />Add your first
        </PxButton>
      )}
    </div>
  );
}

function SubForm({ initial, onSave, onCancel, fxRates, kicker = 'NEW SUBSCRIPTION', title = 'Add subscription', inline = false }) {
  const uid = useId();
  const rootRef = useRef(null);
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(String(initial.price ?? ''));
  const [currency, setCurrency] = useState(initial.currency || 'VND');
  const [period, setPeriod] = useState(initial.period || 'monthly');
  const [url, setUrl] = useState(initial.url || '');
  const [nextRenewal, setNextRenewal] = useState(initial.nextRenewal || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // In the side column the form can open away from the row that was clicked;
  // bring it into view when it appears.
  useEffect(() => {
    if (!inline && rootRef.current?.scrollIntoView) rootRef.current.scrollIntoView({ block: 'nearest' });
  }, [inline]);

  // Live FX preview: convert entered price into the OTHER 2 of USD/TWD/VND
  const conversions = useMemo(() => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return null;
    const baseRate = getRate(fxRates, currency);
    if (!baseRate) return null;
    const usd = p / baseRate;
    const out = [];
    for (const target of ['USD', 'VND', 'TWD']) {
      if (target === currency) continue;
      const r = getRate(fxRates, target);
      if (!r) continue;
      out.push({ ccy: target, val: usd * r });
    }
    return out;
  }, [price, currency, fxRates]);

  function fmtCcy(v, ccy) {
    if (ccy === 'USD' || ccy === 'EUR' || ccy === 'GBP') {
      return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

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
    <section ref={rootRef} aria-labelledby={uid + 'h'} className={(inline ? 'pxs' : 'px') + ' rise'}
      style={{ background: COLORS.paper, scrollMarginTop: 24, scrollMarginBottom: 24 }}>
      <CartStrip bg={AC.green} right={<Ico d={ICO.plus} size={14} sw={3} />} style={{ borderBottomWidth: 4 }}>
        {kicker}
      </CartStrip>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: inline ? '18px 16px 22px' : '18px 20px 24px' }}>
        <h2 id={uid + 'h'} className="pf" style={{ margin: 0, fontSize: 24, lineHeight: 1 }}>{title}</h2>
        <div>
          <label htmlFor={uid + 'n'} className="sk fb-lbl">NAME</label>
          <input id={uid + 'n'} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cursor Pro" className="mono field fb-fld" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 }}>
          <div>
            <label htmlFor={uid + 'p'} className="sk fb-lbl">PRICE</label>
            <input id={uid + 'p'} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="20" inputMode="decimal" className="mono field fb-fld" />
          </div>
          <div>
            <label htmlFor={uid + 'c'} className="sk fb-lbl">CCY</label>
            <div style={{ position: 'relative' }}>
              <select id={uid + 'c'} value={currency} onChange={(e) => setCurrency(e.target.value)} className="mono field fb-fld">
                {TECH_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <PixelArrow dir="down" size={6} color={COLORS.text} style={{ position: 'absolute', right: 13, top: 20, pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
        <div>
          <span id={uid + 'per'} className="sk fb-lbl">PERIOD</span>
          <div role="group" aria-labelledby={uid + 'per'} className="fb-seg pxs" style={{ display: 'inline-flex', marginLeft: 3 }}>
            <button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')} style={{ minWidth: 64 }}>mo</button>
            <button type="button" aria-pressed={period === 'yearly'} onClick={() => setPeriod('yearly')} style={{ minWidth: 64 }}>yr</button>
          </div>
        </div>
        <div>
          <label htmlFor={uid + 'u'} className="sk fb-lbl">URL (optional)</label>
          <input id={uid + 'u'} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cursor.com" className="mono field fb-fld" />
        </div>
        <div>
          <label htmlFor={uid + 'd'} className="sk fb-lbl">NEXT RENEWAL (optional)</label>
          <input id={uid + 'd'} type="date" value={nextRenewal} onChange={(e) => setNextRenewal(e.target.value)} className="mono field fb-fld" />
        </div>
        {conversions && conversions.length > 0 && (
          <div aria-live="polite" className="mono" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px',
            padding: '10px 12px', fontSize: 12, color: COLORS.muted,
            background: COLORS.cream, border: '3px dashed ' + COLORS.rule,
          }}>
            <span>≈</span>
            {conversions.map((c) => (
              <span key={c.ccy}>
                <b style={{ color: COLORS.greenInk }}>{fmtCcy(c.val, c.ccy)}</b>
                <span style={{ marginLeft: 4 }}>{c.ccy}</span>
                {period === 'yearly' && <span style={{ marginLeft: 4, opacity: 0.8 }}>/yr</span>}
              </span>
            ))}
          </div>
        )}
        {err && <ErrBox>{err}</ErrBox>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, padding: '4px 10px 10px 0' }}>
          <PxButton kind="big" fill={AC.green} onClick={submit} disabled={busy} style={{ minHeight: 46, fontSize: 13 }}>
            {busy ? 'Saving…' : 'Save'}
          </PxButton>
          <PxButton onClick={onCancel} disabled={busy} style={{ minHeight: 46, padding: '0 18px', fontSize: 13 }}>Cancel</PxButton>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// 6. CRYPTO WATCH — real BTC + GOLD + TWD/VND, step charts, converter
// ═════════════════════════════════════════════════════════════

// Pixel step chart: one bar per close (evenly sampled past 48), heights
// snapped to 8 steps between the series min and max.
function StepChart({ data, color, label, emptyText }) {
  const bars = useMemo(() => {
    if (!data || data.length < 2) return null;
    const MAX = 48;
    const pts = data.length > MAX
      ? Array.from({ length: MAX }, (_, i) => data[Math.round((i * (data.length - 1)) / (MAX - 1))])
      : data;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    return pts.map((v) => ((Math.round(((v - min) / span) * 7) + 1) / 8) * 100);
  }, [data]);

  return (
    <div className="fb-chart" role="img" aria-label={label} style={{ '--c': color }}>
      {bars
        ? bars.map((h, i) => <i key={i} style={{ height: h + '%' }} />)
        : <span className="sk fb-chart-empty">{emptyText}</span>}
    </div>
  );
}

// NEXT POLL meter: six 10s steps across the 60s refresh window.
function PollMeter({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const step = Math.min(6, Math.floor(((now - since) % 60_000) / 10_000) + 1);
  return (
    <div className="sk" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
      <span style={{ color: COLORS.muted }}>NEXT POLL</span>
      <span aria-hidden="true" style={{ display: 'flex', gap: 6, padding: '2px 2px 0' }}>
        {[1, 2, 3, 4, 5, 6].map((i) => <span key={i} className={'fb-pseg' + (i <= step ? ' on' : '')} />)}
      </span>
    </div>
  );
}

// Scoreboard tile: accent cartridge with a dark price screen.
function ScoreTile({ n, title, bg, icon, label, value, valueColor = AC.gold, unit, footer, delay = 0 }) {
  return (
    <article aria-label={title} className="pxs rise" style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, background: bg, color: INK, animationDelay: delay + 'ms',
    }}>
      <CartStrip bg={bg} right={n}>
        <h3 style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit' }}>{title}</h3>
      </CartStrip>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, margin: '16px 16px 0', padding: 16, minWidth: 0,
        background: COLORS.strip, color: SCREEN_TEXT,
      }}>
        {icon}
        <div style={{ minWidth: 0 }}>
          <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: SCREEN_MUTED }}>{label}</p>
          <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
            <span className="pf fb-tile-big" style={{ lineHeight: 1, color: valueColor }}>{value}</span>
            {unit && <> <span className="sk" style={{ fontSize: 13 }}>{unit}</span></>}
          </p>
        </div>
      </div>
      <div style={{ padding: '14px 16px 16px', fontSize: 13 }}>{footer}</div>
    </article>
  );
}

function DeltaChip({ st }) {
  return (
    <span className="pxs" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px',
      fontWeight: 700, background: COLORS.paper, color: COLORS.text, whiteSpace: 'nowrap',
    }}>
      {st.haveSeries ? (
        <>
          <span style={{ display: 'inline-flex', color: st.up ? COLORS.greenInk : RED_INK }}><DeltaArrow up={st.up} /></span>
          {Math.abs(st.pct).toFixed(2)}%
        </>
      ) : 'Δ —'}
    </span>
  );
}

export function CryptoWatch() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const uid = useId();
  const mountedAt = useRef(Date.now()); // the poll below runs on mount + every 60s
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
    { key: 'btc',  label: 'BTC / USDT', price: ticks.btc.price,  fmt: (v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 }), color: AC.gold },
    { key: 'gold', label: 'GOLD / oz',  price: ticks.gold.price, fmt: (v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 }), color: AC.coin },
    { key: 'twd',  label: 'TWD / USD',  price: ticks.twd.price,  fmt: (v) => v.toFixed(3),       color: AC.green },
    { key: 'vnd',  label: 'VND / USD',  price: ticks.vnd.price,  fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), color: AC.red },
  ];

  const statusLabel = !status.loaded ? 'CONNECTING'
                    : status.live    ? 'LIVE · 60s'
                    :                  'OFFLINE';
  const statusKey = !status.loaded ? 'connecting' : status.live ? 'live' : 'offline';

  // Per-ticker change over the series (first → last close).
  const stats = {};
  for (const t of tickers) {
    const series = ticks[t.key].series;
    const haveSeries = series.length >= 2;
    const first = haveSeries ? series[0] : 0;
    const last = haveSeries ? series[series.length - 1] : 0;
    const delta = last - first;
    stats[t.key] = {
      series,
      havePrice: Number.isFinite(t.price),
      haveSeries,
      delta,
      pct: first ? (delta / first) * 100 : 0,
      up: delta >= 0,
    };
  }
  const priceOf = (t) => (stats[t.key].havePrice ? t.fmt(t.price) : '—');
  const changeOf = (st) => (st.haveSeries ? `${st.up ? '+' : ''}${st.delta.toFixed(2)} · ${st.series.length}t` : '—');
  const pad2 = (v) => String(v).padStart(2, '0');
  const updated = status.t ? `${pad2(new Date(status.t).getHours())}:${pad2(new Date(status.t).getMinutes())}` : '--:--';
  const maxCloses = Math.max(...tickers.map((t) => stats[t.key].series.length));

  // ── Marquee ticker (second run is a visual duplicate for the loop) ──
  const marq = [
    { k: 'BTC', c: AC.gold, v: priceOf(tickers[0]) },
    { k: 'GOLD/OZ', c: AC.gold, v: priceOf(tickers[1]) },
    { k: '1 TWD', c: AC.green, v: `= ${havePrices ? vndPerTwd.toFixed(1) : '—'} VND` },
    { k: 'TWD/USD', c: AC.sky, v: priceOf(tickers[2]) },
    { k: 'VND/USD', c: AC.red, v: priceOf(tickers[3]) },
  ];
  const marqRun = (dup) => (
    <span aria-hidden={dup || undefined} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {marq.map((m) => (
        <span key={m.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: m.c }}>{m.k}</span>{m.v}
          <span aria-hidden="true" style={{ width: 8, height: 8, margin: '0 26px', background: AC.danger }} />
        </span>
      ))}
    </span>
  );

  const statusChips = [
    ['connecting', 'CONNECTING'],
    ['live', 'LIVE · 60s'],
    ['offline', 'OFFLINE'],
  ];

  const cabinet = (
    <section aria-labelledby={uid + 'x'} className="px rise" style={{ position: 'relative', minWidth: 0, background: COLORS.paper }}>
      <div aria-label="Markets ticker" style={{
        display: 'flex', alignItems: 'center', height: 52, overflow: 'hidden', background: COLORS.strip, color: SCREEN_TEXT,
      }}>
        <div className="marq sk" style={{ display: 'flex', width: 'max-content', whiteSpace: 'nowrap', fontSize: 15 }}>
          {marqRun(false)}{marqRun(true)}
        </div>
      </div>

      <div className="fb-pad" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '20px 32px',
        padding: '24px 28px 22px', borderBottom: '3px dashed ' + COLORS.rule,
      }}>
        <div style={{ minWidth: 0 }}>
          <Kick style={{ fontSize: 12 }}>MARKETS · {statusLabel}</Kick>
          <h2 id={uid + 'x'} className="pf" style={{ margin: 0, fontSize: isMobile ? 28 : 34, lineHeight: 1 }}>Coin-op exchange</h2>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 28px' }}>
          <ul aria-label="Feed status" className="sk" style={{
            display: 'flex', flexWrap: 'wrap', gap: 14, margin: 0, padding: '0 4px', listStyle: 'none', fontSize: 11,
          }}>
            {statusChips.map(([k, lbl]) => {
              const on = statusKey === k;
              const fill = on && k === 'live' ? AC.green : on && k === 'offline' ? AC.red : null;
              return (
                <li key={k} className={'pxs' + (on ? '' : ' fb-hide-sm')} aria-current={on ? 'true' : undefined} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  background: fill || (on ? COLORS.paper : COLORS.cream),
                  color: fill ? INK : on ? COLORS.text : COLORS.muted,
                }}>
                  {on && <span className={k === 'offline' ? undefined : 'blink'} aria-hidden="true" style={{ width: 8, height: 8, background: 'currentColor' }} />}
                  {lbl}
                </li>
              );
            })}
          </ul>
          <PollMeter since={mountedAt.current} />
          <div className="sk" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
            <span style={{ color: COLORS.muted }}>UPDATED</span>
            <span style={{ fontSize: 16 }}>{updated}</span>
          </div>
        </div>
      </div>

      <div className="fb-tiles fb-pad" style={{ padding: '32px 28px 36px' }}>
        <ScoreTile
          n="01" title={tickers[0].label} bg={AC.gold} delay={60}
          icon={<CoinBadge size={isMobile ? 44 : 60} letter="B" />}
          label="PRICE · USD" value={priceOf(tickers[0])}
          footer={(
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <DeltaChip st={stats.btc} /><span style={{ textAlign: 'right' }}>{changeOf(stats.btc)}</span>
            </div>
          )}
        />
        <ScoreTile
          n="02" title={tickers[1].label} bg={AC.coin} delay={120}
          icon={<GoldBar size={isMobile ? 44 : 60} />}
          label="PRICE · USD / OZ" value={priceOf(tickers[1])}
          footer={(
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <DeltaChip st={stats.gold} /><span style={{ textAlign: 'right' }}>{changeOf(stats.gold)}</span>
            </div>
          )}
        />
        <ScoreTile
          n="03" title="TWD ⇄ VND" bg={AC.green} delay={180}
          icon={<TwinCoins size={isMobile ? 44 : 60} />}
          label="1 TWD =" value={havePrices ? vndPerTwd.toFixed(1) : '—'} valueColor={AC.green} unit="VND"
          footer={(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span className="sk" style={{ fontSize: 11 }}>USD → TWD</span><b>{priceOf(tickers[2])}</b>
              </span>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span className="sk" style={{ fontSize: 11 }}>USD → VND</span><b>{priceOf(tickers[3])}</b>
              </span>
            </div>
          )}
        />
      </div>
    </section>
  );

  const charts = (
    <section aria-labelledby={uid + 'h'} className="px rise fb-pad" style={{
      flex: isMobile ? undefined : '999 1 560px', minWidth: 0,
      padding: '24px 28px 22px', background: COLORS.paper, animationDelay: '80ms',
    }}>
      <div style={{ marginBottom: 20 }}>
        <Kick style={{ fontSize: 12 }}>PRICE HISTORY · {maxCloses >= 2 ? `${maxCloses} CLOSES` : 'NO SERIES YET'}</Kick>
        <h2 id={uid + 'h'} className="pf" style={{ margin: 0, fontSize: isMobile ? 26 : 30, lineHeight: 1 }}>High-score charts</h2>
      </div>

      <div className="fb-hrow head sk" aria-hidden="true">
        <span>TICKER</span><span>HISTORY</span><span style={{ textAlign: 'right' }}>CHANGE</span>
      </div>
      {tickers.map((t) => {
        const st = stats[t.key];
        return (
          <div key={t.key} className="fb-hrow">
            <div style={{ minWidth: 0 }}>
              <span className="sk pxs" style={{
                display: 'inline-block', margin: 3, padding: '5px 8px', fontSize: 11,
                textTransform: 'uppercase', background: t.color, color: INK,
              }}>{t.label}</span>
              <p className="mono" style={{ margin: '8px 0 0', fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>
                {st.havePrice ? t.fmt(t.price) : <span style={{ color: COLORS.muted }}>—</span>}
              </p>
            </div>
            <StepChart
              data={st.series}
              color={t.color}
              label={st.haveSeries
                ? `${t.label} history, ${st.series.length} closes, ${st.up ? 'up' : 'down'} ${Math.abs(st.pct).toFixed(2)}%`
                : `${t.label} history, no data yet`}
              emptyText={status.error ? 'NO DATA' : 'LOADING HISTORY…'}
            />
            <div style={{ textAlign: 'right' }}>
              {st.haveSeries ? (
                <>
                  <p className="mono" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 15, fontWeight: 700,
                    color: st.up ? COLORS.greenInk : RED_INK,
                  }}><DeltaArrow up={st.up} />{Math.abs(st.pct).toFixed(2)}%</p>
                  <p className="mono" style={{ margin: '6px 0 0', fontSize: 11, color: COLORS.muted }}>{changeOf(st)}</p>
                </>
              ) : (
                <p className="mono" style={{ margin: 0, fontSize: 13, color: COLORS.muted }}>—</p>
              )}
            </div>
          </div>
        );
      })}
      <p style={{ margin: '18px 0 0', fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
        Each bar is one close from the markets feed, snapped to 8 steps between the low and the high.
      </p>
    </section>
  );

  const t2v = direction === 'twd-vnd';
  const fromCode = t2v ? 'TWD' : 'VND';
  const toCode = t2v ? 'VND' : 'TWD';
  const result = havePrices ? converted.toLocaleString(undefined, { maximumFractionDigits: t2v ? 0 : 2 }) : '—';

  const converter = (
    <section aria-labelledby={uid + 'c'} className="px rise" style={{
      flex: isMobile ? undefined : '1 1 360px', minWidth: 0,
      display: 'flex', flexDirection: 'column', background: AC.gold, color: INK, animationDelay: '140ms',
    }}>
      <CartStrip bg={AC.gold} right="04" style={{ borderBottomWidth: 4, padding: '0 14px' }}>CONVERTER · CROSS</CartStrip>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '18px 22px 0' }}>
        <h2 id={uid + 'c'} className="pf" style={{ margin: 0, fontSize: 32, lineHeight: 1, color: INK }}>TWD ⇄ VND</h2>
        <span aria-hidden="true" style={{
          display: 'grid', placeItems: 'center', flexShrink: 0, width: 44, height: 58,
          background: COLORS.strip, boxShadow: 'inset 0 0 0 3px #43362b',
        }}><span style={{ width: 6, height: 34, background: AC.gold }} /></span>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 18, margin: '18px 22px 0', padding: '18px 18px 20px',
        background: COLORS.paper, color: COLORS.text, border: '3px solid ' + COLORS.ink,
      }}>
        <div>
          <p id={uid + 'f'} className="sk fb-lbl">FROM</p>
          <div role="group" aria-labelledby={uid + 'f'} className="fb-seg pxs" style={{ margin: '0 3px' }}>
            <button type="button" aria-pressed={t2v} onClick={() => setDirection('twd-vnd')}>TWD</button>
            <button type="button" aria-pressed={!t2v} onClick={() => setDirection('vnd-twd')}>VND</button>
          </div>
        </div>
        <div>
          <label htmlFor={uid + 'a'} className="sk fb-lbl">AMOUNT · {fromCode}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 3px' }}>
            <span className="sk pxs" aria-hidden="true" style={{
              display: 'grid', placeItems: 'center', flexShrink: 0, width: 58, height: 52, fontSize: 12,
              background: t2v ? AC.green : AC.red, color: INK,
            }}>{fromCode}</span>
            <input
              id={uid + 'a'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mono field"
              style={{ flex: 1, minWidth: 0, width: '100%', height: 52, padding: '0 14px', fontSize: 22, fontWeight: 700 }}
            />
          </div>
        </div>
        <PxButton
          fill={AC.gold}
          onClick={() => setDirection((d) => (d === 'twd-vnd' ? 'vnd-twd' : 'twd-vnd'))}
          aria-label="Swap conversion direction"
          style={{ alignSelf: 'center', minHeight: 44, padding: '0 20px', fontSize: 13 }}
        >
          <PixelSwap size={16} />Swap
        </PxButton>
        <div>
          <p id={uid + 't'} className="sk fb-lbl">TO</p>
          <div role="group" aria-labelledby={uid + 't'} className="fb-seg pxs" style={{ margin: '0 3px' }}>
            <button type="button" aria-pressed={t2v} onClick={() => setDirection('twd-vnd')}>VND</button>
            <button type="button" aria-pressed={!t2v} onClick={() => setDirection('vnd-twd')}>TWD</button>
          </div>
        </div>
      </div>

      <div className="fb-lcd" aria-live="polite" style={{ margin: '22px 22px 0', padding: '16px 18px 18px', color: SCREEN_TEXT }}>
        <div className="sk" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: SCREEN_MUTED }}>
          <span>RESULT</span><span>{fromCode} → {toCode}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginTop: 12, minWidth: 0 }}>
          <span className="pf" style={{
            minWidth: 0, fontSize: result.length > 9 ? 30 : 42, lineHeight: 1, color: AC.gold, overflowWrap: 'anywhere',
          }}>{result}</span>
          <span className="sk" style={{ fontSize: 14 }}>{toCode}</span>
          <span className="blink" aria-hidden="true" style={{ alignSelf: 'center', width: 12, height: 26, background: AC.gold }} />
        </div>
      </div>

      <div style={{
        margin: '20px 22px 24px', padding: '14px 16px 12px',
        background: COLORS.paper, color: COLORS.text, border: '3px solid ' + COLORS.ink,
      }}>
        <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted }}>CROSS RATES · VIA USD</p>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', fontSize: 14, borderBottom: '3px dashed ' + COLORS.rule }}>
          <span>1 TWD =</span>
          <b>{havePrices ? vndPerTwd.toFixed(1) + ' VND' : '—'}</b>
        </div>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0 2px', fontSize: 14 }}>
          <span>1000 VND =</span>
          <b>{havePrices ? (twdPerVnd * 1000).toFixed(3) + ' TWD' : '—'}</b>
        </div>
      </div>
    </section>
  );

  // Phones: converter first, then the scoreboard, then the charts (one column).
  if (isMobile) {
    return <div className="fb-root fb-col">{converter}{cabinet}{charts}</div>;
  }
  return (
    <div className="fb-root fb-col">
      {cabinet}
      <div className="fb-row">{charts}{converter}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 8. TO-DO LIST
// ═════════════════════════════════════════════════════════════
const PRI = {
  P1: { color: AC.red,   label: 'P1', name: 'urgent' },
  P2: { color: AC.gold,  label: 'P2', name: 'soon' },
  P3: { color: AC.green, label: 'P3', name: 'someday' },
};

export function TodoList() {
  const uid = useId();
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

  const total = items.length;
  const xpPct = total ? Math.round((counts.done / total) * 100) : 0;
  const listTitle = filter === 'open' ? 'Open quests' : filter === 'done' ? 'Cleared quests' : 'All quests';
  const emptyTitle = filter === 'done' ? 'NO SAVE DATA'
                   : filter === 'open' ? (total ? 'ALL QUESTS CLEARED' : 'NO QUESTS YET')
                   : 'EMPTY LIST';
  const priBox = (on, color) => ({ background: on ? color : COLORS.paper, color: on ? INK : COLORS.text });

  return (
    <div className="fb-root fb-row" style={{ paddingTop: 14 }}>
      {/* ── Quest log ── */}
      <section aria-labelledby={uid + 'q'} className="fb-main" style={{ position: 'relative' }}>
        <Plate as="h2" id={uid + 'q'} style={{ left: 26, top: -16 }}>QUEST LOG</Plate>
        <div className="px" style={{ background: COLORS.paper }}>
          <div className="fb-pad" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20,
            padding: '36px 28px 22px',
          }}>
            <div style={{ minWidth: 0 }}>
              <Kick>TASKS · {counts.open} OPEN · {counts.done} DONE</Kick>
              <p className="pf" style={{ margin: 0, fontSize: 30, lineHeight: 1 }}>{listTitle}</p>
            </div>
            <div role="group" aria-label="Filter tasks" className="fb-seg pxs" style={{ margin: '3px 4px 3px 3px' }}>
              {[['open', counts.open], ['done', counts.done], ['all', total]].map(([f, n]) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ height: 40 }}>
                  {f}<span style={{ opacity: 0.75 }}>{n}</span>
                </button>
              ))}
            </div>
          </div>

          {/* XP bar */}
          <div className="fb-pad" style={{ padding: '0 28px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <span id={uid + 'xp'} className="sk" style={{ fontSize: 11, color: COLORS.muted }}>QUEST XP</span>
              <span className="sk" style={{ fontSize: 12 }}>
                <span className="pf" style={{ fontSize: 18 }}>{counts.done}</span> / {total} CLEARED
              </span>
            </div>
            <div role="progressbar" aria-labelledby={uid + 'xp'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts.done}
              style={{ height: 28, border: '3px solid ' + COLORS.ink, background: COLORS.paper }}>
              <div className="fb-xpfill" style={{
                width: xpPct + '%', backgroundImage: `repeating-linear-gradient(90deg, ${AC.green} 0 10px, transparent 10px 12px)`,
              }} />
            </div>
            {total > 0 && counts.open === 0 && (
              <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 0', fontSize: 12, color: COLORS.greenInk }}>
                <span className="blink" aria-hidden="true">★</span>ALL QUESTS CLEARED
              </p>
            )}
          </div>

          {/* Add a quest */}
          <div className="fb-pad" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '18px 22px', padding: '24px 28px 26px',
            background: COLORS.cream, borderTop: '3px dashed ' + COLORS.rule, borderBottom: '3px dashed ' + COLORS.rule,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span id={uid + 'p'} className="sk" style={{ fontSize: 11, color: COLORS.muted }}>PRIORITY</span>
              <div role="group" aria-labelledby={uid + 'p'} className="sk pxs" style={{ display: 'flex', alignSelf: 'flex-start', marginLeft: 3, fontSize: 12 }}>
                {Object.entries(PRI).map(([k, v], i) => (
                  <button key={k} type="button" onClick={() => setPri(k)} title={v.name} aria-pressed={pri === k} className="fb-ppick"
                    style={{
                      width: 48, height: 48, padding: 0, borderLeft: i ? '3px solid ' + COLORS.ink : 0,
                      fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, ...priBox(pri === k, v.color),
                    }}>{v.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flex: '1 1 240px', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <label htmlFor={uid + 'in'} className="sk" style={{ fontSize: 11, color: COLORS.muted }}>
                NEW QUEST · {(PRI[pri]?.name || '').toUpperCase()}
              </label>
              <input
                id={uid + 'in'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="New task… ⏎ to add"
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                className="mono field"
                style={{ width: '100%', height: 48, padding: '0 14px', fontSize: 14, background: COLORS.paper }}
              />
            </div>
            <PxButton kind="big" fill={AC.green} onClick={add} disabled={!draft.trim()}
              style={{ flexShrink: 0, minHeight: 52, padding: '0 26px', fontSize: 16, marginRight: 10, marginBottom: 4 }}>
              <Ico d={ICO.plus} size={16} sw={3} />Add
            </PxButton>
          </div>

          {/* Quest rows */}
          <ul className="fb-pad" style={{ margin: 0, padding: '8px 28px 18px', listStyle: 'none' }}>
            {sorted.map((it) => {
              const p = PRI[it.priority] || PRI.P2;
              return (
                <li key={it.id} className="fb-qrow rise">
                  <button type="button" role="checkbox" aria-checked={it.done}
                    aria-label={(it.done ? 'Mark not done: ' : 'Mark done: ') + it.text}
                    onClick={() => toggle(it.id)} className="pxs fb-qbox"
                    style={{
                      display: 'grid', placeItems: 'center', flexShrink: 0, width: 30, height: 30, padding: 0,
                      background: it.done ? p.color : COLORS.paper,
                    }}>
                    {it.done && <PixelTick />}
                  </button>
                  <select value={it.priority} onChange={(e) => setPriOf(it.id, e.target.value)}
                    aria-label={'Priority: ' + it.text} title={p.name} className="sk pxs"
                    style={{
                      flexShrink: 0, height: 30, padding: '0 4px', fontSize: 11, border: 0, cursor: 'pointer',
                      color: INK, background: p.color,
                    }}>
                    {Object.keys(PRI).map((k) => (
                      <option key={k} value={k} style={{ color: COLORS.text, background: COLORS.paper }}>{k}</option>
                    ))}
                  </select>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.45, overflowWrap: 'anywhere',
                    color: it.done ? COLORS.muted : COLORS.text, textDecoration: it.done ? 'line-through' : 'none',
                  }}>{it.text}</span>
                  {it.done ? (
                    <span className="sk fb-hide-sm" style={{
                      flexShrink: 0, padding: '3px 7px', fontSize: 10, color: INK, background: AC.green, border: '2px solid ' + COLORS.ink,
                    }}>CLEARED</span>
                  ) : (
                    <span className="sk fb-hide-sm" style={{ flexShrink: 0, fontSize: 10, color: COLORS.muted }}>{p.name.toUpperCase()}</span>
                  )}
                  <button type="button" onClick={() => remove(it.id)} title="delete" aria-label={'Delete task: ' + it.text} className="fb-qdel"
                    style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 40, height: 40, padding: 0 }}>
                    <Ico d={ICO.x} size={16} sw={3} />
                  </button>
                </li>
              );
            })}
          </ul>

          {sorted.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '12px 24px 44px', textAlign: 'center' }}>
              <PixelScroll />
              <p className="sk" style={{ margin: '4px 0 0', fontSize: 15 }}>{emptyTitle}</p>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>
                {filter === 'done' ? 'Chưa có task nào hoàn thành.' : filter === 'open' ? 'Inbox zero — nice.' : 'Empty list.'}
              </p>
              {filter !== 'all' && total > 0 && (
                <PxButton fill={AC.green} onClick={() => setFilter('all')} style={{ marginTop: 8, fontSize: 11 }}>Show all</PxButton>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Sidebar ── */}
      <aside aria-label="Quest stats" className="fb-side fb-col">
        <section aria-labelledby={uid + 'b'} className="px" style={{ padding: '24px 24px 22px', background: COLORS.paper }}>
          <h2 id={uid + 'b'} className="sk" style={{ margin: '0 0 6px', fontFamily: SK_FONT, fontSize: 12, color: COLORS.muted }}>BREAKDOWN · OPEN</h2>
          {Object.entries(PRI).map(([k, v], i, arr) => {
            const lastRow = i === arr.length - 1;
            return (
              <div key={k} style={{
                display: 'flex', flexDirection: 'column', gap: 9, padding: lastRow ? '14px 0 4px' : '14px 0',
                borderBottom: lastRow ? 0 : '3px dashed ' + COLORS.rule,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, background: v.color, border: '2px solid ' + COLORS.ink }} />
                    {v.label} · {v.name.toUpperCase()}
                  </span>
                  <span className="pf" style={{ fontSize: 22, lineHeight: 1 }}>{counts[k]}</span>
                </div>
                <div aria-hidden="true" style={{ height: 18, border: '3px solid ' + COLORS.ink, background: COLORS.paper }}>
                  <div className="fb-xpfill" style={{
                    width: (counts[k] === 0 ? 0 : Math.min(100, counts[k] * 25)) + '%',
                    backgroundImage: `repeating-linear-gradient(90deg, ${v.color} 0 10px, transparent 10px 12px)`,
                  }} />
                </div>
              </div>
            );
          })}
        </section>

        <section aria-labelledby={uid + 's'} className="px" style={{ padding: '22px 24px 24px', background: COLORS.strip, color: SCREEN_TEXT }}>
          <h2 id={uid + 's'} className="sk" style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px', fontFamily: SK_FONT, fontSize: 12, color: SCREEN_MUTED,
          }}>
            <span className="blink" aria-hidden="true" style={{ width: 8, height: 8, background: AC.green }} />STORAGE
          </h2>
          <p className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.9 }}>
            {[
              'persisted to localStorage',
              <>key: <span style={{ color: AC.green }}>se77n.todo.v2</span></>,
              `${items.length} items · ${(JSON.stringify(items).length / 1024).toFixed(2)} KB`,
            ].map((line, i) => (
              <span key={i} style={{ display: 'block' }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 6, height: 6, marginRight: 10, verticalAlign: 'middle', background: AC.gold }} />
                {line}
              </span>
            ))}
          </p>
        </section>

        <DialogBox speaker="SE77N SAYS:" padding="30px 24px 28px" style={{ marginTop: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            Press Enter to add a quest. Tick the square to clear it — open quests sort P1 first, cleared ones sink to the bottom.
          </p>
        </DialogBox>
      </aside>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 9. FEED — private AI history (whitelist-only)
// ═════════════════════════════════════════════════════════════
function GatePanel({ tone, kicker, title, children, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <section className="px rise" style={{ width: '100%', maxWidth: 520, padding: '28px 28px 24px', background: COLORS.paper }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <MemCard w={34} fill={AC.orange} />
          <p className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 12, color: COLORS.text }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, background: tone }} />{kicker}
          </p>
        </div>
        <h2 className="pf" style={{ margin: '0 0 10px', fontSize: 28, lineHeight: 1.1 }}>{title}</h2>
        <div style={{ marginBottom: 22, fontSize: 13, lineHeight: 1.55, color: COLORS.muted }}>{children}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: '0 8px 8px 0' }}>{actions}</div>
      </section>
    </div>
  );
}

export function Feed() {
  const auth = useAuth();
  const uid = useId();
  const [state, setState] = useState({ status: 'loading', items: [], folders: [], isAdmin: false, err: '' });
  const [folder, setFolder] = useState(''); // ownerKey filter, '' = all
  const [confirmDel, setConfirmDel] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

  async function load(filter) {
    const f = filter !== undefined ? filter : folder;
    setState((s) => ({ ...s, status: 'loading', err: '' }));
    try {
      const url = '/api/toolbox?kind=history' + (f ? `&owner=${encodeURIComponent(f)}` : '');
      const r = await fetch(url, { credentials: 'include' });
      const data = await r.json();
      if (r.status === 401) { setState({ status: 'login_required', items: [], folders: [], isAdmin: false, err: '' }); return; }
      if (r.status === 403) { setState({ status: 'forbidden', items: [], folders: [], isAdmin: false, err: data.error || 'Forbidden' }); return; }
      if (!r.ok) { setState({ status: 'error', items: [], folders: [], isAdmin: false, err: data.error || 'Failed' }); return; }
      setState({
        status: 'ok',
        items: data.items || [],
        folders: data.folders || [],
        isAdmin: !!data.isAdmin,
        err: '',
      });
    } catch (e) {
      setState({ status: 'error', items: [], folders: [], isAdmin: false, err: e.message || 'Network error' });
    }
  }

  useEffect(() => { load(folder); /* eslint-disable-next-line */ }, [auth.status, folder]);

  async function doDelete(id) {
    setDelBusy(true); setDelErr('');
    try {
      const r = await fetch(`/api/toolbox?kind=history&id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Delete failed');
      }
      setConfirmDel(null);
      await load(folder);
    } catch (e) {
      setDelErr(e.message);
    } finally {
      setDelBusy(false);
    }
  }

  if (state.status === 'loading' && state.items.length === 0) {
    return <div className="fb-root"><Loading label="LOADING FEED…" /></div>;
  }
  if (state.status === 'login_required') {
    return (
      <div className="fb-root">
        <GatePanel
          tone={AC.gold}
          kicker="PRIVATE FEED"
          title="Sign in required"
          actions={<>
            <PxButton fill={AC.green} onClick={() => auth.login('google')} style={{ minHeight: 44, fontSize: 13 }}>Google</PxButton>
            <PxButton onClick={() => auth.login('discord')} style={{ minHeight: 44, fontSize: 13 }}>Discord</PxButton>
          </>}
        >
          This feed is invite-only. Sign in with a whitelisted email to view it.
        </GatePanel>
      </div>
    );
  }
  if (state.status === 'forbidden') {
    return (
      <div className="fb-root">
        <GatePanel
          tone={AC.danger}
          kicker="ACCESS DENIED"
          title="Not on the whitelist"
          actions={<PxButton onClick={() => auth.logout()} style={{ minHeight: 44, fontSize: 13 }}>Sign out</PxButton>}
        >
          You're signed in as <span className="mono" style={{ color: COLORS.text, overflowWrap: 'anywhere' }}>{auth.user?.email}</span> but this email isn't on the allowlist. Contact the owner to request access.
        </GatePanel>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="fb-root" style={{ padding: '24px 0' }}>
        <section className="px" style={{ maxWidth: 640, padding: '22px 24px 24px', background: COLORS.paper }}>
          <Kick>HISTORY · NO SIGNAL</Kick>
          <ErrBox>{state.err}</ErrBox>
        </section>
      </div>
    );
  }

  const totalAll = state.folders.reduce((s, f) => s + f.count, 0);
  const folderName = folder ? state.folders.find((f) => f.ownerKey === folder)?.ownerName || folder : 'AI activity log';

  return (
    <div className="fb-root fb-row" style={{ gap: 32 }}>
      {/* ── Memory card sidebar ── */}
      <aside aria-label="Folders and file types" className="fb-col" style={{ flex: '1 1 260px', minWidth: 0, gap: 32 }}>
        <section aria-labelledby={uid + 'f'} className="px" style={{ background: COLORS.paper }}>
          <div className="ribs" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px',
            backgroundColor: AC.orange, color: INK, borderBottom: '4px solid ' + COLORS.ink,
          }}>
            <h2 id={uid + 'f'} className="sk" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontFamily: SK_FONT, fontSize: 13 }}>
              <MemCard w={16} />FOLDERS · {String(state.folders.length).padStart(2, '0')}
            </h2>
            {state.isAdmin && (
              <span className="sk pxs" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 10,
                background: COLORS.paper, color: COLORS.text,
              }}>
                <span className="blink" aria-hidden="true" style={{ width: 8, height: 8, background: AC.danger }} />ADMIN
              </span>
            )}
          </div>
          <div role="group" aria-label="Filter by folder" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10 }}>
            <FolderRow
              label="All activity"
              sub={`${totalAll} items`}
              active={folder === ''}
              onClick={() => setFolder('')}
              kind="all"
            />
            {state.folders.map((f) => (
              <FolderRow
                key={f.ownerKey}
                label={f.ownerName}
                sub={`${f.count} · ${new Date(f.lastAt).toLocaleDateString()}`}
                active={folder === f.ownerKey}
                onClick={() => setFolder(f.ownerKey)}
                kind={f.ownerType === 'guest' ? 'guest' : 'user'}
                avatar={f.ownerAvatar}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby={uid + 't'} className="px fb-hide-sm" style={{ padding: '20px 20px 10px', background: COLORS.paper }}>
          <h2 id={uid + 't'} className="sk" style={{ margin: '0 0 8px', fontFamily: SK_FONT, fontSize: 13 }}>FILE TYPES</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {Object.values(KIND_META).map((m, i, arr) => (
              <li key={m.label} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 10px 3px',
                borderBottom: i === arr.length - 1 ? 0 : '3px dashed ' + COLORS.rule,
              }}>
                <span className="sk pxs" style={{
                  flexShrink: 0, width: 84, padding: '3px 0', textAlign: 'center', fontSize: 10, background: m.color, color: INK,
                }}>{m.label}</span>
                <span style={{ fontSize: 12, color: COLORS.muted }}>{m.hint}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="fb-hide-sm">
          <DialogBox speaker="SE77N SAYS:" padding="30px 20px 26px" style={{ marginTop: 0 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              Every reply from the AI Playground is auto-saved here. fal.ai media links expire after a short while.
            </p>
            <div style={{ marginTop: 18, padding: '0 6px 6px 0' }}>
              <PxButton as="a" href="#/ai" fill={AC.red} style={{ minHeight: 36, padding: '0 12px', fontSize: 11 }}>
                Play AI<PixelArrow size={10} />
              </PxButton>
            </div>
          </DialogBox>
        </div>
      </aside>

      {/* ── Save slots ── */}
      <div className="fb-col" style={{ flex: '999 1 560px', minWidth: 0, gap: 32 }}>
        <section aria-labelledby={uid + 'h'} className="px" style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 18,
          padding: '20px 22px', background: COLORS.paper,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <MemCard w={34} fill={AC.orange} />
            <div style={{ minWidth: 0 }}>
              <Kick style={{ marginBottom: 6, overflowWrap: 'anywhere' }}>
                {folder ? folder.toUpperCase() : 'ALL'} · {String(state.items.length).padStart(2, '0')} ITEMS
              </Kick>
              <h2 id={uid + 'h'} className="pf" style={{ margin: 0, fontSize: 30, lineHeight: 1, overflowWrap: 'anywhere' }}>{folderName}</h2>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 8px 8px 0' }}>
            {state.status === 'loading' && (
              <span role="status" className="sk blink" style={{ fontSize: 11, color: COLORS.muted }}>LOADING FEED…</span>
            )}
            <PxButton fill={AC.orange} onClick={() => load(folder)} style={{ minHeight: 38, fontSize: 12 }}>
              <Ico d={ICO.refresh} size={14} sw={2.8} />Refresh
            </PxButton>
          </div>
        </section>

        {state.items.length === 0 ? (
          <div className="px" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            padding: '44px 24px 40px', textAlign: 'center', background: COLORS.paper,
          }}>
            <MemCard w={48} fill={AC.rule} empty />
            <p className="sk" style={{ margin: 0, fontSize: 18 }}>NO SAVE DATA</p>
            <p className="sk" style={{ margin: 0, fontSize: 11, color: COLORS.muted }}>FEED IS EMPTY</p>
            <p style={{ margin: 0, maxWidth: 420, fontSize: 13, lineHeight: 1.55, color: COLORS.muted }}>
              {folder
                ? 'This folder has no items yet.'
                : 'Chat with the AI Playground — every reply is auto-logged here.'}
            </p>
            {!folder && (
              <div style={{ marginTop: 8, padding: '0 6px 6px 0' }}>
                <PxButton as="a" href="#/ai" fill={AC.red} style={{ minHeight: 38, fontSize: 12 }}>Open AI Playground</PxButton>
              </div>
            )}
          </div>
        ) : (
          <div className="fb-slots">
            {state.items.map((it, i) => (
              <FeedCard
                key={it.id}
                item={it}
                slot={i + 1}
                onDelete={() => { setConfirmDel({ id: it.id, ownerName: it.ownerName }); setDelErr(''); }}
              >
                {confirmDel && confirmDel.id === it.id && (
                  <ConfirmDialog
                    inline
                    plate={`ERASE SLOT ${String(i + 1).padStart(2, '0')}?`}
                    title="Delete from feed?"
                    body={<>Remove this item from <strong style={{ color: COLORS.text }}>{confirmDel.ownerName}</strong>'s activity? This can't be undone.</>}
                    confirmLabel="Delete"
                    confirmColor={AC.red}
                    busy={delBusy}
                    err={delErr}
                    onCancel={() => { setConfirmDel(null); setDelErr(''); }}
                    onConfirm={() => doDelete(confirmDel.id)}
                  />
                )}
              </FeedCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Memory-card folder row. kind: 'all' | 'user' | 'guest'.
function FolderRow({ label, sub, active, onClick, kind = 'user', avatar }) {
  const tile = { display: 'grid', placeItems: 'center', flexShrink: 0, width: 34, height: 34 };
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={'fb-fold' + (active ? ' on' : '')}>
      {avatar ? (
        <img src={avatar} alt="" className="fb-fic" style={{ display: 'block', flexShrink: 0, width: 34, height: 34, objectFit: 'cover' }} />
      ) : kind === 'all' ? (
        <span className="fb-fic" aria-hidden="true" style={{ ...tile, background: AC.orange, color: INK }}>
          <Ico d={ICO.stack} size={18} sw={2.6} />
        </span>
      ) : kind === 'guest' ? (
        <span className="fb-fic" aria-hidden="true" style={{ ...tile, background: AC.rule }}><PixelGuest size={16} /></span>
      ) : (
        <span className="fb-fic pf" aria-hidden="true" style={{ ...tile, fontSize: 17, background: AC.green, color: INK }}>
          {String(label || '?')[0].toUpperCase()}
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span className="fb-fsub" style={{ fontSize: 11 }}>{sub}</span>
      </span>
    </button>
  );
}

const KIND_META = {
  'chat':      { label: 'CHAT',      color: AC.sky,    hint: 'Prompt + reply' },
  'image':     { label: 'IMAGE',     color: AC.violet, hint: 'Generated or edited' },
  'video':     { label: 'VIDEO',     color: AC.gold,   hint: 'Generated clip' },
  'bg-remove': { label: 'BG-REMOVE', color: AC.green,  hint: 'Background cut-out' },
};

// Save-slot card: ribbed strip in the kind colour, owner, prompt, reply, media.
function FeedCard({ item, onDelete, slot = 1, children }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[item.kind] || { label: item.kind?.toUpperCase() || 'ITEM', color: AC.rule };
  const hasReply = !!item.reply;
  const hasMedia = !!item.mediaUrl;
  const replyShort = hasReply && item.reply.length > 320 ? item.reply.slice(0, 320) + '…' : item.reply;
  const promptShort = item.prompt && item.prompt.length > 200 ? item.prompt.slice(0, 200) + '…' : item.prompt;
  const showExpandBtn = (hasReply && item.reply.length > 320) || (item.prompt && item.prompt.length > 200);
  const dateStr = new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const nn = String(slot).padStart(2, '0');
  const avatarBox = {
    display: 'grid', placeItems: 'center', flexShrink: 0, width: 36, height: 36, border: '3px solid ' + COLORS.ink,
  };

  return (
    <article aria-label={`Save slot ${nn}, ${meta.label.toLowerCase()}`} className="px rise" style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, background: COLORS.paper,
      animationDelay: Math.min(slot - 1, 5) * 60 + 'ms',
    }}>
      <CartStrip
        bg={meta.color}
        height={38}
        right={<span className="pxs" style={{ display: 'inline-block', padding: '3px 8px', fontSize: 10, background: COLORS.paper, color: COLORS.text }}>{meta.label}</span>}
        style={{ borderBottomWidth: 4, padding: '0 14px' }}
      >
        <MemCard w={14} />SLOT {nn}
      </CartStrip>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minWidth: 0, padding: '18px 18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {item.ownerAvatar ? (
            <img src={item.ownerAvatar} alt="" style={{ ...avatarBox, display: 'block', objectFit: 'cover' }} />
          ) : item.ownerType === 'guest' ? (
            <span aria-hidden="true" style={{ ...avatarBox, background: AC.rule }}><PixelGuest size={16} /></span>
          ) : (
            <span className="pf" aria-hidden="true" style={{ ...avatarBox, fontSize: 18, background: AC.green, color: INK }}>
              {item.ownerName?.[0]?.toUpperCase()}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.text, overflowWrap: 'anywhere' }}>{item.ownerName}</p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: COLORS.muted }}>
              {dateStr}{item.preset && ` · ${item.preset}`}
            </p>
          </div>
          {item.canDelete && (
            <button type="button" className="sbtn fb-icob" onClick={onDelete} title="Delete" aria-label={`Delete slot ${nn}`}
              style={{ width: 36, height: 36, marginRight: 6 }}>
              <Ico d={ICO.x} size={14} sw={3.2} />
            </button>
          )}
        </div>

        {item.prompt && (
          <div style={{
            padding: '10px 12px 12px', background: COLORS.cream, borderLeft: '6px solid ' + AC.green,
            fontSize: 13, lineHeight: 1.55, color: COLORS.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            <p className="sk" style={{ margin: '0 0 6px', fontSize: 10, color: COLORS.greenInk }}>PROMPT</p>
            {expanded ? item.prompt : promptShort}
          </div>
        )}

        {hasReply && (
          <div style={{
            padding: '10px 12px 12px', border: '3px dashed ' + COLORS.rule,
            fontSize: 13, lineHeight: 1.6, color: COLORS.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            <p className="sk" style={{ margin: '0 0 6px', fontSize: 10, color: COLORS.muted }}>REPLY</p>
            {expanded ? item.reply : replyShort}
          </div>
        )}

        {hasMedia && (
          <div style={{ padding: '10px 10px 12px', border: '3px dashed ' + COLORS.rule }}>
            <p className="sk" style={{ margin: '0 0 12px', fontSize: 10, color: COLORS.muted }}>{meta.label} · OUTPUT</p>
            {item.kind === 'video' ? (
              <video src={item.mediaUrl} controls className="pxs"
                style={{ display: 'block', width: 'calc(100% - 6px)', maxHeight: 400, margin: 3, background: '#000' }} />
            ) : (
              <img
                src={item.mediaUrl}
                alt=""
                loading="lazy"
                className="pxs"
                style={{ display: 'block', maxWidth: 'calc(100% - 6px)', margin: 3 }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling.style.display = 'block';
                }}
              />
            )}
            <div className="mono" style={{ display: 'none', padding: 14, fontSize: 12, lineHeight: 1.5, color: COLORS.muted, background: COLORS.cream }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Ico d={ICO.image} size={24} color={COLORS.text} />
                <span>Media link expired (fal.ai URLs have short TTL).</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 16, padding: '0 8px 8px 3px' }}>
              <PxButton as="a" href={item.mediaUrl} target="_blank" rel="noreferrer" style={{ minHeight: 32, padding: '0 12px', fontSize: 11 }}>
                Open<Ico d={ICO.ext} size={12} sw={2.8} />
              </PxButton>
            </div>
          </div>
        )}

        {showExpandBtn && (
          <div style={{ padding: '0 8px 8px 0' }}>
            <PxButton onClick={() => setExpanded(!expanded)} aria-expanded={expanded} style={{ minHeight: 34, padding: '0 12px', fontSize: 11 }}>
              <PixelArrow dir="down" size={7} style={expanded ? { transform: 'scaleY(-1)' } : undefined} />
              {expanded ? 'Collapse' : 'Expand'}
            </PxButton>
          </div>
        )}

        {children}
      </div>
    </article>
  );
}
