// Read-only trip viewer reached via ?share=<hash>. No auth required.
// Renders a stripped-down version of TvFolder Overview for unauthenticated viewers,
// inside a minimal B header/footer (the page has no app shell).
import { useState, useEffect, useMemo } from 'react';
import { COLORS } from '../lib.jsx';
import { Bricks, DialogBox, PixelCoin } from '../ui/arcade.jsx';
import { GOLD, ON, statusFill, CartHead, Fact, IconWarn, PixelFlag, Tag } from './kit.jsx';
import './tv4.arcade.css';

export default function SharedTripView({ token }) {
  const [snapshot, setSnapshot] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/tv4-share?hash=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (cancel) return;
        if (!r.ok) {
          setError(j.error === 'expired' ? 'This share link has expired.' :
                   j.error === 'not_found' ? 'Share link not found.' :
                   j.error || 'Could not load share.');
          return;
        }
        setSnapshot(j.snapshot);
        setExpiresAt(j.expiresAt);
      } catch (e) {
        if (!cancel) setError(e.message || 'load_failed');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [token]);

  const totals = useMemo(() => {
    if (!snapshot) return null;
    const spend = (snapshot.transactions || []).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return {
      places: (snapshot.pins || []).length,
      days: (() => {
        const t = snapshot.trip;
        if (!t?.startDate || !t?.endDate) return 0;
        const s = new Date(t.startDate), e = new Date(t.endDate);
        return Math.max(1, Math.round((e - s) / 86400000) + 1);
      })(),
      spend,
      notes: (snapshot.notes || []).length,
    };
  }, [snapshot]);

  if (loading) {
    return <ShareShell><CenterMessage>loading shared trip…</CenterMessage></ShareShell>;
  }
  if (error) {
    return <ShareShell><CenterMessage error>{error}</CenterMessage></ShareShell>;
  }
  if (!snapshot) return null;

  const trip = snapshot.trip;
  return (
    <ShareShell expiresAt={expiresAt}>
      <header style={{ marginBottom: 36 }}>
        <p className="sk" style={{ margin: '0 0 10px', fontSize: 12, color: COLORS.muted }}>
          SE77N · TRAVEL · SHARED
        </p>
        <h1 className="pf" style={{ margin: 0, fontSize: 40, lineHeight: 1.05 }}>
          {trip.title}
        </h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18, paddingLeft: 3 }}>
          <Tag fill={statusFill(trip.status)} style={{ fontSize: 11, padding: '4px 8px' }}>{trip.status || '—'}</Tag>
          <Fact>{trip.country || '—'}</Fact>
          <Fact>{trip.startDate || '—'} → {trip.endDate || '—'}</Fact>
          {(trip.tags || []).map((t) => <Fact key={t}>{t}</Fact>)}
        </div>
      </header>

      {totals && (
        <div className="tv-kpi" style={{ gap: 28, marginBottom: 40, padding: '0 3px' }}>
          {[
            { k: 'PLACES', v: totals.places },
            { k: 'DAYS',   v: totals.days },
            { k: 'SPEND',  v: totals.spend > 0 ? formatMoney(totals.spend, trip.tripCurrency || 'USD') : '—', coin: true },
            { k: 'NOTES',  v: totals.notes },
          ].map((t) => (
            <div key={t.k} className="pxs" style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', minWidth: 0, background: COLORS.paper,
            }}>
              <span className="sk" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.muted }}>
                {t.coin && <PixelCoin size={14} />}{t.k}
              </span>
              <span className="pf" style={{ fontSize: 28, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.v}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
        {trip.bestOf?.length > 0 && (
          <Card title="BEST OF">
            {trip.bestOf.filter((b) => b.value).map((b, i) => (
              <Row key={i} k={b.label} v={b.value} />
            ))}
          </Card>
        )}

        {snapshot.pins?.length > 0 && (
          <Card title={`PLACES · ${snapshot.pins.length}`}>
            {snapshot.pins.slice(0, 50).map((p) => (
              <Row key={p._id} k={`D${(p.dayIndex ?? 0) + 1} · ${(p.type || '').toUpperCase()}`} v={p.name} />
            ))}
          </Card>
        )}

        {snapshot.planItems?.length > 0 && (
          <Card title={`PLAN · ${snapshot.planItems.length} STOPS`}>
            {snapshot.planItems
              .slice()
              .sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0) || (a.timeStart || '').localeCompare(b.timeStart || ''))
              .slice(0, 80)
              .map((it) => (
                <Row
                  key={it._id}
                  k={`D${(it.dayIndex ?? 0) + 1} ${it.timeStart || ''}`}
                  v={`${(it.type || '').toUpperCase()} · ${it.title}`}
                />
              ))}
          </Card>
        )}

        {snapshot.notes?.length > 0 && (
          <Card title={`NOTES · ${snapshot.notes.length}`}>
            {snapshot.notes.slice(0, 20).map((n) => (
              <div key={n._id} style={{ padding: '10px 0', borderBottom: '3px dashed var(--rule)' }}>
                <div className="sk" style={{ fontSize: 10, color: COLORS.muted }}>
                  D{(n.dayIndex ?? 0) + 1} · {n.date || ''}
                </div>
                <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{n.content}</div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </ShareShell>
  );
}

// Minimal B shell for the public page: paper header with the se77n mark,
// gold accent strip, content column, brick footer.
function ShareShell({ children, expiresAt }) {
  return (
    <div className="tv4" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', color: COLORS.text,
    }}>
      <header style={{ background: COLORS.paper, borderBottom: '4px solid var(--ink)' }}>
        <div style={{
          maxWidth: 1040, margin: '0 auto', padding: '14px 20px', minHeight: 80,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="pf" style={{ fontSize: 32, lineHeight: 1 }}>
              se<span style={{ color: '#e04545', textShadow: '3px 3px 0 var(--ink)' }}>77</span>n
            </span>
            <span className="sk" style={{ fontSize: 10, color: COLORS.muted }}>WORLD 007 · TRAVEL PLAN</span>
          </div>
          <span className="sk pxs" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 11,
            color: ON, background: GOLD,
          }}>
            <PixelFlag size={12} fill="#fffaf0" />
            SHARED TRIP · READ-ONLY
          </span>
        </div>
      </header>
      <div aria-hidden="true" style={{ height: 8, background: GOLD, borderBottom: '4px solid var(--ink)' }} />

      <main style={{ flex: 1, width: '100%', maxWidth: 1000, margin: '0 auto', padding: '40px 20px 64px' }}>
        {children}
      </main>

      <footer>
        <div className="sk" style={{
          maxWidth: 1000, margin: '0 auto', padding: '16px 20px', display: 'flex', flexWrap: 'wrap',
          justifyContent: 'space-between', gap: 12, fontSize: 11, color: COLORS.muted,
        }}>
          <span>
            {expiresAt && <span>Expires {new Date(expiresAt).toISOString().slice(0, 10)} · </span>}
            se77n · read-only view
          </span>
          <span style={{ color: COLORS.text }}>SE77N · WORLD 007</span>
        </div>
        <Bricks height={40} />
      </footer>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="px" style={{ background: COLORS.paper }}>
      <CartHead title={title} />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 18px 12px' }}>{children}</div>
    </section>
  );
}

function Row({ k, v }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '10px 0', fontSize: 13, gap: 16,
      borderBottom: '3px dashed var(--rule)',
    }}>
      <span className="sk" style={{ fontSize: 11, color: COLORS.muted, whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ color: COLORS.text, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function CenterMessage({ children, error }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0 40px' }}>
      <div style={{ width: '100%', maxWidth: 580 }}>
        <DialogBox speaker={error ? 'SE77N SAYS:' : 'NOW LOADING'}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="pxs" style={{
              display: 'grid', placeItems: 'center', flexShrink: 0, width: 60, height: 60,
              background: error ? '#ff7a7a' : '#9fd8ff',
            }}>
              {error ? <IconWarn size={30} fill="#ff7a7a" /> : <PixelFlag size={28} fill={GOLD} />}
            </span>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <p className="sk" style={{ margin: '0 0 8px', fontSize: 11, color: COLORS.muted }}>
                {error ? 'GAME OVER · CONTINUE?' : 'SHARED TRIP'}
              </p>
              {error ? (
                <>
                  <h1 className="pf" style={{ margin: 0, fontSize: 26, lineHeight: 1.1 }}>This trip can't be shown</h1>
                  <p role="alert" className="mono" style={{
                    margin: '12px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--tv-red-ink)', overflowWrap: 'anywhere',
                  }}>{children}</p>
                  <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: COLORS.muted }}>
                    Ask whoever sent it for a fresh read-only link.
                  </p>
                </>
              ) : (
                <div role="status" className="sk" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                  <span className="dots-step" aria-hidden="true" style={{ display: 'inline-flex', color: GOLD }}><i /><i /><i /></span>
                  {children}
                </div>
              )}
            </div>
          </div>
        </DialogBox>
      </div>
    </div>
  );
}

function formatMoney(amount, currency) {
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
