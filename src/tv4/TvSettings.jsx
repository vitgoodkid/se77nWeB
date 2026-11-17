// Settings modal — per-user travel preferences. Persists to /api/tv4 (singleton 'settings').
// Map-picker UI is deferred to task #10 (MapLibre); v1 uses lat/lng + name inputs.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { COLORS, Btn, Field } from '../lib.jsx';
import { tv4 } from './api.js';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'TWD', 'VND', 'CNY', 'THB', 'SGD', 'AUD', 'CAD'];
const COLLECTIONS = ['trips', 'pins', 'plan-items', 'checklist', 'reservations', 'transactions', 'notes', 'templates', 'settings'];

export default function TvSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [newTripmate, setNewTripmate] = useState('');

  // Load existing settings (or null doc) on mount.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { doc } = await tv4.getSettings();
        if (cancel) return;
        setSettings(doc || {
          homeBase: { lat: null, lng: null, name: '' },
          baseCurrency: 'USD',
          distanceUnit: 'km',
          fxAutoRefresh: true,
          customCategories: [],
          tripmates: [],
        });
      } catch (e) {
        if (!cancel) setError(e.message || 'load_failed');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const patch = useCallback((next) => {
    setSettings((s) => ({ ...s, ...next }));
  }, []);

  const onSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      const body = {
        homeBase: settings.homeBase || undefined,
        baseCurrency: settings.baseCurrency,
        distanceUnit: settings.distanceUnit,
        fxAutoRefresh: !!settings.fxAutoRefresh,
        customCategories: settings.customCategories || [],
        tripmates: settings.tripmates || [],
      };
      await tv4.saveSettings(body);
      onClose();
    } catch (e) {
      setError(e.message || 'save_failed');
    } finally {
      setSaving(false);
    }
  }, [settings, onClose]);

  const onExportAll = useCallback(async () => {
    try {
      const dump = {};
      for (const c of COLLECTIONS) {
        if (c === 'settings') {
          const r = await tv4.getSettings();
          dump.settings = r.doc;
        } else {
          const r = await tv4.list(c);
          dump[c] = r.docs;
        }
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `se77n-travel-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError('Export failed: ' + (e.message || 'unknown'));
    }
  }, []);

  const onAddCategory = useCallback(() => {
    const v = newCategory.trim();
    if (!v) return;
    if (settings.customCategories?.includes(v)) { setNewCategory(''); return; }
    patch({ customCategories: [...(settings.customCategories || []), v] });
    setNewCategory('');
  }, [newCategory, settings, patch]);

  const onAddTripmate = useCallback(() => {
    const v = newTripmate.trim();
    if (!v) return;
    const next = [...(settings.tripmates || []), { id: cryptoId(), name: v }];
    patch({ tripmates: next });
    setNewTripmate('');
  }, [newTripmate, settings, patch]);

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.panel, border: '1px solid ' + COLORS.line,
          borderRadius: 14, width: 600, maxWidth: '100%', maxHeight: '90vh',
          overflow: 'auto', color: COLORS.text,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid ' + COLORS.line,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
              SETTINGS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Travel preferences</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: COLORS.muted, fontSize: 22, lineHeight: 1, padding: 4,
            }}
          >×</button>
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {loading && <div style={{ color: COLORS.muted, fontSize: 12 }} className="mono">◇ loading…</div>}

          {settings && !loading && (
            <>
              <Section title="HOME BASE">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Row label="Name">
                    <Field
                      value={settings.homeBase?.name || ''}
                      onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), name: v } })}
                      placeholder="Taipei"
                      mono={false}
                    />
                  </Row>
                  <div />
                  <Row label="Lat">
                    <Field
                      value={settings.homeBase?.lat ?? ''}
                      onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), lat: v === '' ? null : Number(v) } })}
                      placeholder="25.04"
                      type="number"
                    />
                  </Row>
                  <Row label="Lng">
                    <Field
                      value={settings.homeBase?.lng ?? ''}
                      onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), lng: v === '' ? null : Number(v) } })}
                      placeholder="121.56"
                      type="number"
                    />
                  </Row>
                </div>
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted, marginTop: 6, letterSpacing: '0.12em' }}>
                  ◇ Map picker arriving with MapLibre (task #10)
                </div>
              </Section>

              <Section title="CURRENCY + UNITS">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Row label="Base currency">
                    <select
                      value={settings.baseCurrency || 'USD'}
                      onChange={(e) => patch({ baseCurrency: e.target.value })}
                      className="mono"
                      style={selectStyle}
                    >
                      {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Row>
                  <Row label="Distance unit">
                    <div style={{ display: 'inline-flex', border: '1px solid ' + COLORS.line, borderRadius: 8, overflow: 'hidden' }}>
                      {['km', 'mi'].map((u) => {
                        const on = settings.distanceUnit === u;
                        return (
                          <button
                            key={u}
                            onClick={() => patch({ distanceUnit: u })}
                            className="mono"
                            style={{
                              padding: '10px 18px', cursor: 'pointer',
                              background: on ? COLORS.gold + '1f' : 'transparent',
                              color: on ? COLORS.gold : COLORS.muted,
                              border: 'none', fontSize: 11, letterSpacing: '0.18em',
                            }}
                          >{u.toUpperCase()}</button>
                        );
                      })}
                    </div>
                  </Row>
                </div>
                <Toggle
                  checked={!!settings.fxAutoRefresh}
                  onChange={(v) => patch({ fxAutoRefresh: v })}
                  label="Auto-refresh FX rates daily"
                  hint="Pulls latest rates from exchangerate.host every 24h"
                />
              </Section>

              <Section title="CUSTOM CATEGORIES">
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.12em', marginBottom: 8 }}>
                  ◇ Extra expense categories beyond food / stay / transport / shopping / other
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {(settings.customCategories || []).map((c) => (
                    <RemovableChip
                      key={c}
                      label={c}
                      onRemove={() => patch({ customCategories: settings.customCategories.filter((x) => x !== c) })}
                    />
                  ))}
                  {(settings.customCategories || []).length === 0 && (
                    <span style={{ color: COLORS.muted, fontSize: 12 }}>none yet</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Field
                      value={newCategory}
                      onChange={setNewCategory}
                      placeholder="Souvenir"
                      mono={false}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCategory(); } }}
                    />
                  </div>
                  <Btn onClick={onAddCategory} variant="tinted" color={COLORS.gold}>Add</Btn>
                </div>
              </Section>

              <Section title="TRIPMATES">
                <div className="mono" style={{ fontSize: 10, color: COLORS.muted, letterSpacing: '0.12em', marginBottom: 8 }}>
                  ◇ Names only for v0.4 — used in expense PAID BY + settle flow
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {(settings.tripmates || []).map((m) => (
                    <RemovableChip
                      key={m.id}
                      label={m.name}
                      onRemove={() => patch({ tripmates: settings.tripmates.filter((x) => x.id !== m.id) })}
                    />
                  ))}
                  {(settings.tripmates || []).length === 0 && (
                    <span style={{ color: COLORS.muted, fontSize: 12 }}>solo (none added)</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Field
                      value={newTripmate}
                      onChange={setNewTripmate}
                      placeholder="Alex"
                      mono={false}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddTripmate(); } }}
                    />
                  </div>
                  <Btn onClick={onAddTripmate} variant="tinted" color={COLORS.gold}>Add</Btn>
                </div>
              </Section>

              <Section title="DATA">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Btn onClick={onExportAll}>↓ Export all (JSON)</Btn>
                </div>
              </Section>
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

        <footer style={{
          padding: '14px 22px', borderTop: '1px solid ' + COLORS.line,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn onClick={onSave} variant="solid" color={COLORS.gold} disabled={saving || loading}>
            {saving ? '…' : 'Save'}
          </Btn>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold,
        marginBottom: 12,
      }}>{title}</div>
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: COLORS.muted, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
      marginTop: 14,
    }}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 999, position: 'relative',
          background: checked ? COLORS.gold : 'rgba(245,237,224,0.1)',
          border: '1px solid ' + COLORS.line,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 14, height: 14, borderRadius: 999, background: COLORS.bg,
          transition: 'left 120ms ease',
        }} />
      </button>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: COLORS.text }}>{label}</span>
        {hint && <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{hint}</span>}
      </span>
    </label>
  );
}

function RemovableChip({ label, onRemove }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: 'rgba(245,237,224,0.05)',
        border: '1px solid ' + COLORS.line,
        color: COLORS.text, fontSize: 11, letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      {label}
      <button
        onClick={onRemove}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: COLORS.muted, fontSize: 14, padding: 0, lineHeight: 1,
        }}
        aria-label="Remove"
      >×</button>
    </span>
  );
}

const selectStyle = {
  width: '100%', background: COLORS.bg,
  border: '1px solid ' + COLORS.line, borderRadius: 10,
  padding: '11px 14px', color: COLORS.text,
  fontSize: 13,
};

function cryptoId() {
  // Short random id for tripmate references (browser-safe).
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
