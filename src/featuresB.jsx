import { useState, useEffect, useMemo, useRef } from 'react';
import {
  COLORS,
  Panel, Btn, Field, Pill, Kicker, Sparkline,
  useSyncedData, copyText, useAuth, useMediaQuery,
} from './lib.jsx';

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

export function TechStackMonitor() {
  const auth = useAuth();
  const isMobile = useMediaQuery('(max-width: 768px)');
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

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 340px',
      gridTemplateRows: isMobile ? 'auto' : 'minmax(0, 1fr) auto',
      gap: isMobile ? 12 : 18,
      height: isMobile ? 'auto' : '100%',
    }}>
      {/* ── LEFT: subscription list ── */}
      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : '100%',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <Kicker>SUBSCRIPTIONS · {String(subs.length).padStart(2, '0')}</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {data?.owner?.name ? `${data.owner.name}'s subscriptions` : 'Subscription Manager'}
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

        <div style={{
          flex: 1,
          overflow: isMobile ? 'visible' : 'auto',
          overflowX: isMobile ? 'auto' : 'auto',
        }}>
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
                  initial={{ name: '', price: '', currency: 'VND', period: 'monthly', url: '', nextRenewal: '' }}
                  fxRates={fxRates}
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
                                  fxRates={fxRates}
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
                                  setConfirmDelete({ id: s.id, name: s.name });
                                  setDeleteErr('');
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
      <Panel padding={20} style={{
        overflow: isMobile ? 'visible' : 'auto',
        height: isMobile ? 'auto' : '100%',
      }}>
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

      <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
        <StackChat subs={subs} fxRates={fxRates} owner={data?.owner} totals={totals} />
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete subscription?"
          body={<>This will permanently remove <strong style={{ color: COLORS.text }}>"{confirmDelete.name}"</strong> from your stack.</>}
          confirmLabel="Delete"
          confirmColor={COLORS.red}
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

function ConfirmDialog({ title, body, confirmLabel, confirmColor, onConfirm, onCancel, busy, err }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy) onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onConfirm, onCancel]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'grid', placeItems: 'center',
        animation: 'fadeUp 160ms ease-out',
        padding: 20,
      }}
    >
      <div style={{
        maxWidth: 420, width: '100%',
        background: COLORS.panel, border: '1px solid ' + COLORS.line,
        borderRadius: 14, padding: 24,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
      }}>
        <Kicker style={{ color: confirmColor, marginBottom: 10 }}>● CONFIRM</Kicker>
        <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.55, marginBottom: 18 }}>{body}</div>
        {err && (
          <div className="mono" style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 14,
            border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
            color: COLORS.red, fontSize: 12,
          }}>✕ {err}</div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn variant="solid" color={confirmColor || COLORS.red} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Stack chat: collapsed by default, expands into a small advisor chat ──
function StackChat({ subs, fxRates, owner, totals }) {
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
    return (
      <button
        onClick={onOpen}
        disabled={subs.length === 0}
        style={{
          width: '100%', padding: '14px 18px', borderRadius: 14,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          color: COLORS.text, textAlign: 'left', cursor: subs.length ? 'pointer' : 'not-allowed',
          opacity: subs.length ? 1 : 0.5,
          display: 'flex', alignItems: 'center', gap: 14,
          transition: 'border-color 120ms, background 120ms',
        }}
        onMouseEnter={(e) => { if (subs.length) { e.currentTarget.style.borderColor = COLORS.green + '60'; e.currentTarget.style.background = COLORS.green + '0a'; } }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.line; e.currentTarget.style.background = COLORS.panel; }}
      >
        <span style={{
          width: 36, height: 36, borderRadius: 10,
          border: `1px solid ${COLORS.green}55`, background: COLORS.green + '14',
          display: 'grid', placeItems: 'center', color: COLORS.green, fontSize: 18,
          flexShrink: 0,
        }}>✦</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ fontSize: 11, color: COLORS.green, letterSpacing: '0.16em', fontWeight: 700 }}>
            ASK AI · STACK ADVISOR
          </div>
          <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 3 }}>
            {subs.length === 0
              ? 'Add a subscription to enable analysis.'
              : `Get a summary + suggestions on ${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'}.`}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 18, color: COLORS.muted }}>↓</span>
      </button>
    );
  }

  // Expanded
  return (
    <Panel padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: 480 }}>
      <div style={{
        padding: '12px 18px', borderBottom: '1px solid ' + COLORS.line,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8,
            border: `1px solid ${COLORS.green}55`, background: COLORS.green + '14',
            display: 'grid', placeItems: 'center', color: COLORS.green, fontSize: 14,
          }}>✦</span>
          <div>
            <Kicker style={{ color: COLORS.green }}>STACK ADVISOR</Kicker>
            <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
              Gemini · context: {subs.length} subs · ${totals.monthlyUSD.toFixed(0)}/mo
            </div>
          </div>
        </div>
        <Btn variant="ghost" onClick={() => setOpen(false)}>✕</Btn>
      </div>

      <div ref={bodyRef} style={{
        flex: 1, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12, minHeight: 120,
      }}>
        {messages.length === 0 && !busy && (
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, textAlign: 'center', padding: 20 }}>
            ◇ Type a question below.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            padding: '10px 14px', borderRadius: 12,
            background: m.role === 'user' ? COLORS.green + '14' : COLORS.bg,
            border: '1px solid ' + (m.role === 'user' ? COLORS.green + '40' : COLORS.line),
            fontSize: 13, color: COLORS.text, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="mono" style={{
            alignSelf: 'flex-start',
            padding: '10px 14px', borderRadius: 12,
            background: COLORS.bg, border: '1px solid ' + COLORS.line,
            fontSize: 11, color: COLORS.muted, letterSpacing: '0.12em',
          }}>
            ◇ thinking…
          </div>
        )}
      </div>

      {err && (
        <div className="mono" style={{
          margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e', color: COLORS.red,
        }}>✕ {err}</div>
      )}

      <div style={{
        padding: 12, borderTop: '1px solid ' + COLORS.line,
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          rows={1}
          placeholder="Ask follow-up… (Enter to send, Shift+Enter for newline)"
          className="mono"
          style={{
            flex: 1, resize: 'none', minHeight: 36, maxHeight: 120,
            background: COLORS.bg, border: '1px solid ' + COLORS.line,
            borderRadius: 8, padding: '8px 12px', color: COLORS.text,
            fontSize: 12, outline: 'none',
          }}
        />
        <Btn variant="solid" color={COLORS.green} onClick={onSend} disabled={busy || !input.trim()}>
          Send
        </Btn>
      </div>
    </Panel>
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

function SubForm({ initial, onSave, onCancel, fxRates }) {
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(String(initial.price ?? ''));
  const [currency, setCurrency] = useState(initial.currency || 'VND');
  const [period, setPeriod] = useState(initial.period || 'monthly');
  const [url, setUrl] = useState(initial.url || '');
  const [nextRenewal, setNextRenewal] = useState(initial.nextRenewal || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
          <Field type="date" value={nextRenewal} onChange={setNextRenewal} placeholder="" />
        </div>
      </div>
      {conversions && conversions.length > 0 && (
        <div className="mono" style={{
          padding: '10px 14px', borderRadius: 8,
          background: COLORS.bg, border: '1px solid ' + COLORS.line,
          fontSize: 11, color: COLORS.muted, display: 'flex',
          flexWrap: 'wrap', gap: 14, alignItems: 'center',
        }}>
          <span style={{ color: COLORS.muted, letterSpacing: '0.1em' }}>≈</span>
          {conversions.map((c, i) => (
            <span key={c.ccy}>
              <span style={{ color: COLORS.green, fontWeight: 700 }}>{fmtCcy(c.val, c.ccy)}</span>
              <span style={{ color: COLORS.muted, marginLeft: 4 }}>{c.ccy}</span>
              {period === 'yearly' && <span style={{ color: COLORS.muted, opacity: 0.6, marginLeft: 4 }}>/yr</span>}
            </span>
          ))}
        </div>
      )}
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
  const isMobile = useMediaQuery('(max-width: 768px)');
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
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 380px',
      gap: isMobile ? 12 : 18,
      height: isMobile ? 'auto' : '100%',
    }}>
      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : undefined,
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Kicker>MARKETS · {statusLabel}</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Currency</div>
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

      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : undefined,
      }}>
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
// 8. TO-DO LIST
// ═════════════════════════════════════════════════════════════
const PRI = {
  P1: { color: COLORS.red,   label: 'P1', name: 'urgent' },
  P2: { color: COLORS.gold,  label: 'P2', name: 'soon' },
  P3: { color: COLORS.green, label: 'P3', name: 'someday' },
};

export function TodoList() {
  const isMobile = useMediaQuery('(max-width: 768px)');
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
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 280px',
      gap: isMobile ? 12 : 18,
      height: isMobile ? 'auto' : '100%',
    }}>
      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : undefined,
      }}>
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

      <Panel padding={20} style={{
        overflow: isMobile ? 'visible' : 'auto',
        height: isMobile ? 'auto' : undefined,
      }}>
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

// ═════════════════════════════════════════════════════════════
// 9. FEED — private AI history (whitelist-only)
// ═════════════════════════════════════════════════════════════
export function Feed() {
  const auth = useAuth();
  const isMobile = useMediaQuery('(max-width: 768px)');
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
    return <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted }} className="mono">◇ loading feed…</div>;
  }
  if (state.status === 'login_required') {
    return (
      <Panel padding={32} style={{ maxWidth: 520, margin: '40px auto' }}>
        <Kicker style={{ color: COLORS.gold, marginBottom: 10 }}>● PRIVATE FEED</Kicker>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Sign in required</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.55, marginBottom: 18 }}>
          This feed is invite-only. Sign in with a whitelisted email to view it.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="solid" color={COLORS.green} onClick={() => auth.login('google')}>Google</Btn>
          <Btn variant="tinted" color={COLORS.green} onClick={() => auth.login('discord')}>Discord</Btn>
        </div>
      </Panel>
    );
  }
  if (state.status === 'forbidden') {
    return (
      <Panel padding={32} style={{ maxWidth: 520, margin: '40px auto' }}>
        <Kicker style={{ color: COLORS.red, marginBottom: 10 }}>● ACCESS DENIED</Kicker>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Not on the whitelist</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.55, marginBottom: 18 }}>
          You're signed in as <span className="mono" style={{ color: COLORS.text }}>{auth.user?.email}</span> but this email isn't on the allowlist. Contact the owner to request access.
        </div>
        <Btn variant="ghost" onClick={() => auth.logout()}>Sign out</Btn>
      </Panel>
    );
  }
  if (state.status === 'error') {
    return (
      <div style={{ padding: 24 }}>
        <div className="mono" style={{
          padding: '12px 16px', borderRadius: 10,
          border: `1px solid ${COLORS.red}55`, background: COLORS.red + '0e',
          color: COLORS.red, fontSize: 13,
        }}>✕ {state.err}</div>
      </div>
    );
  }

  const totalAll = state.folders.reduce((s, f) => s + f.count, 0);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
      gap: isMobile ? 12 : 18,
      height: isMobile ? 'auto' : '100%',
    }}>
      {/* ── Folder sidebar ── */}
      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : '100%',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <Kicker>FOLDERS · {String(state.folders.length).padStart(2, '0')}</Kicker>
          {state.isAdmin && <Pill color={COLORS.red}>● ADMIN</Pill>}
        </div>
        <div style={{
          flex: 1, overflowY: isMobile ? 'visible' : 'auto',
          padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <FolderRow
            label="All activity"
            sub={`${totalAll} items`}
            active={folder === ''}
            onClick={() => setFolder('')}
            color={COLORS.gold}
            icon="◧"
          />
          {state.folders.map((f) => (
            <FolderRow
              key={f.ownerKey}
              label={f.ownerName}
              sub={`${f.count} · ${new Date(f.lastAt).toLocaleDateString()}`}
              active={folder === f.ownerKey}
              onClick={() => setFolder(f.ownerKey)}
              color={f.ownerType === 'guest' ? COLORS.muted : COLORS.green}
              icon={f.ownerType === 'guest' ? '◯' : '◉'}
              avatar={f.ownerAvatar}
            />
          ))}
        </div>
      </Panel>

      {/* ── Items list ── */}
      <Panel padding={0} style={{
        display: 'flex', flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
        height: isMobile ? 'auto' : '100%',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        }}>
          <div>
            <Kicker>{folder ? folder.toUpperCase() : 'ALL'} · {String(state.items.length).padStart(2, '0')} ITEMS</Kicker>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {folder ? state.folders.find((f) => f.ownerKey === folder)?.ownerName || folder : 'AI activity log'}
            </div>
          </div>
          <Btn variant="ghost" onClick={() => load(folder)}>↻ Refresh</Btn>
        </div>

        <div style={{
          flex: 1,
          overflow: isMobile ? 'visible' : 'auto',
          padding: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {state.items.length === 0 ? (
            <div style={{
              padding: 36, textAlign: 'center', borderRadius: 12,
              border: `1px dashed ${COLORS.line}`, background: COLORS.bg,
              color: COLORS.muted,
            }}>
              <div className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: COLORS.text, marginBottom: 6 }}>
                FEED IS EMPTY
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                {folder
                  ? 'This folder has no items yet.'
                  : 'Chat with the AI Playground — every reply is auto-logged here.'}
              </div>
            </div>
          ) : state.items.map((it) => (
            <FeedCard key={it.id} item={it} onDelete={() => { setConfirmDel({ id: it.id, ownerName: it.ownerName }); setDelErr(''); }} />
          ))}
        </div>
      </Panel>

      {confirmDel && (
        <ConfirmDialog
          title="Delete from feed?"
          body={<>Remove this item from <strong style={{ color: COLORS.text }}>{confirmDel.ownerName}</strong>'s activity? This can't be undone.</>}
          confirmLabel="Delete"
          confirmColor={COLORS.red}
          busy={delBusy}
          err={delErr}
          onCancel={() => { setConfirmDel(null); setDelErr(''); }}
          onConfirm={() => doDelete(confirmDel.id)}
        />
      )}
    </div>
  );
}

function FolderRow({ label, sub, active, onClick, color, icon, avatar }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10,
        border: `1px solid ${active ? color + '55' : 'transparent'}`,
        background: active ? color + '14' : 'transparent',
        cursor: 'pointer', textAlign: 'left', color: COLORS.text,
        transition: 'background 100ms, border-color 100ms',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = COLORS.bg; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {avatar ? (
        <img src={avatar} alt="" style={{ width: 28, height: 28, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: color + '14', border: `1px solid ${color}55`,
          display: 'grid', placeItems: 'center', color: color, fontSize: 12, fontWeight: 700,
          flexShrink: 0,
        }}>{icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{
          fontSize: 12, fontWeight: 700,
          color: active ? color : COLORS.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</div>
        <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  );
}

const KIND_META = {
  'chat':      { label: 'CHAT',    color: '#7ABEFF' },
  'image':     { label: 'IMAGE',   color: '#C77BFF' },
  'video':     { label: 'VIDEO',   color: COLORS.gold },
  'bg-remove': { label: 'BG-REMOVE', color: COLORS.green },
};

function FeedCard({ item, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[item.kind] || { label: item.kind?.toUpperCase() || 'ITEM', color: COLORS.muted };
  const hasReply = !!item.reply;
  const hasMedia = !!item.mediaUrl;
  const replyShort = hasReply && item.reply.length > 320 ? item.reply.slice(0, 320) + '…' : item.reply;
  const promptShort = item.prompt && item.prompt.length > 200 ? item.prompt.slice(0, 200) + '…' : item.prompt;
  const showExpandBtn = (hasReply && item.reply.length > 320) || (item.prompt && item.prompt.length > 200);
  const dateStr = new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div style={{
      padding: 16, borderRadius: 12, background: COLORS.bg,
      border: '1px solid ' + COLORS.line,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {item.ownerAvatar ? (
          <img src={item.ownerAvatar} alt="" style={{ width: 28, height: 28, borderRadius: 999, objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: 999,
            background: (item.ownerType === 'guest' ? COLORS.muted : COLORS.green) + '14',
            border: `1px solid ${(item.ownerType === 'guest' ? COLORS.muted : COLORS.green)}55`,
            display: 'grid', placeItems: 'center',
            color: item.ownerType === 'guest' ? COLORS.muted : COLORS.green,
            fontSize: 11, fontWeight: 700,
          }}>{item.ownerName[0]?.toUpperCase()}</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: COLORS.text }}>{item.ownerName}</div>
          <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
            {dateStr}{item.preset && ` · ${item.preset}`}
          </div>
        </div>
        <span className="mono" style={{
          fontSize: 9, letterSpacing: '0.14em', fontWeight: 700,
          padding: '4px 8px', borderRadius: 6,
          color: meta.color, background: meta.color + '14',
          border: `1px solid ${meta.color}55`,
        }}>{meta.label}</span>
        {item.canDelete && (
          <Btn variant="ghost" onClick={onDelete} title="Delete">✕</Btn>
        )}
      </div>

      {item.prompt && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: COLORS.green + '08', border: `1px solid ${COLORS.green}30`,
          fontSize: 12, color: COLORS.text, lineHeight: 1.55,
          marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: COLORS.green, marginBottom: 4 }}>PROMPT</div>
          {expanded ? item.prompt : promptShort}
        </div>
      )}

      {hasReply && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          fontSize: 12, color: COLORS.text, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: COLORS.muted, marginBottom: 4 }}>REPLY</div>
          {expanded ? item.reply : replyShort}
        </div>
      )}

      {hasMedia && (
        <div style={{
          padding: 10, borderRadius: 8,
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: COLORS.muted, marginBottom: 8 }}>
            {meta.label} · OUTPUT
          </div>
          {item.kind === 'video' ? (
            <video src={item.mediaUrl} controls style={{ display: 'block', width: '100%', borderRadius: 6, maxHeight: 400 }} />
          ) : (
            <img
              src={item.mediaUrl}
              alt=""
              loading="lazy"
              style={{ display: 'block', maxWidth: '100%', borderRadius: 6 }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling.style.display = 'block';
              }}
            />
          )}
          <div style={{ display: 'none', padding: 8, fontSize: 11, color: COLORS.muted }} className="mono">
            ◇ Media link expired (fal.ai URLs have short TTL).
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <a
              href={item.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '5px 10px', borderRadius: 6, color: COLORS.muted,
                border: '1px solid ' + COLORS.line, textDecoration: 'none',
              }}
            >Open ↗</a>
          </div>
        </div>
      )}

      {showExpandBtn && (
        <div style={{ marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? '↑ Collapse' : '↓ Expand'}
          </Btn>
        </div>
      )}
    </div>
  );
}

