// Read-only trip viewer reached via ?share=<hash>. No auth required.
// Renders a stripped-down version of TvFolder Overview for unauthenticated viewers.
import { useState, useEffect, useMemo } from 'react';
import { COLORS } from '../lib.jsx';

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
    return <CenterMessage>◇ loading shared trip…</CenterMessage>;
  }
  if (error) {
    return <CenterMessage error>◇ {error}</CenterMessage>;
  }
  if (!snapshot) return null;

  const trip = snapshot.trip;
  return (
    <div style={{
      minHeight: '100vh', background: COLORS.bg, color: COLORS.text,
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: COLORS.gold }}>
            SE77N · TRAVEL · SHARED
          </div>
          <h1 style={{ marginTop: 8, fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {trip.title}
          </h1>
          <div className="mono" style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
            {trip.status} · {trip.country || '—'} · {trip.startDate || '—'} → {trip.endDate || '—'}
          </div>
          {(trip.tags || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {trip.tags.map((t) => (
                <span key={t} className="mono" style={{
                  padding: '3px 9px', borderRadius: 999,
                  background: 'rgba(245,237,224,0.05)',
                  border: '1px solid ' + COLORS.line,
                  fontSize: 10, color: COLORS.muted, letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}>{t}</span>
              ))}
            </div>
          )}
        </header>

        {totals && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10, marginBottom: 24,
          }}>
            {[
              { k: 'PLACES', v: totals.places },
              { k: 'DAYS',   v: totals.days },
              { k: 'SPEND',  v: totals.spend > 0 ? formatMoney(totals.spend, trip.tripCurrency || 'USD') : '—' },
              { k: 'NOTES',  v: totals.notes },
            ].map((t) => (
              <div key={t.k} style={{
                padding: 14, borderRadius: 10,
                background: COLORS.panel, border: '1px solid ' + COLORS.line,
              }}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: COLORS.muted }}>{t.k}</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{t.v}</div>
              </div>
            ))}
          </div>
        )}

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
              <div key={n._id} style={{ padding: '8px 0', borderBottom: '1px dashed ' + COLORS.line }}>
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted }}>
                  D{(n.dayIndex ?? 0) + 1} · {n.date || ''}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.content}</div>
              </div>
            ))}
          </Card>
        )}

        <footer style={{ marginTop: 30, color: COLORS.muted, fontSize: 11 }} className="mono">
          {expiresAt && <span>Expires {new Date(expiresAt).toISOString().slice(0, 10)} · </span>}
          se77n · read-only view
        </footer>
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 14, padding: 16, marginBottom: 14,
    }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>{children}</div>
    </section>
  );
}

function Row({ k, v }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '6px 0', fontSize: 12, gap: 12,
      borderBottom: '1px dashed ' + COLORS.line,
    }}>
      <span className="mono" style={{ color: COLORS.muted, whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ color: COLORS.text, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function CenterMessage({ children, error }) {
  return (
    <div style={{
      minHeight: '100vh', background: COLORS.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: error ? COLORS.red : COLORS.muted, fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13, padding: 24, textAlign: 'center',
    }}>{children}</div>
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
