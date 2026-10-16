// Settings dialog — per-user travel preferences. Persists to /api/tv4 (singleton 'settings').
// Map-picker UI is deferred to task #10 (MapLibre); v1 uses lat/lng + name inputs.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { COLORS, Field } from '../lib.jsx';
import { PxButton } from '../ui/arcade.jsx';
import { tv4 } from './api.js';
import { GOLD, ErrorNote, FormRow, Label, Loading, PxDialog, PxSelect, Seg, XBtn, fieldStyle } from './kit.jsx';

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
    <PxDialog
      onClose={onClose}
      width={940}
      kicker="SETTINGS"
      title="Travel preferences"
      footer={<>
        <PxButton onClick={onClose} style={{ height: 44 }}>CANCEL</PxButton>
        <PxButton kind="big" onClick={onSave} fill={GOLD} disabled={saving || loading} style={{ minHeight: 44, fontSize: 13 }}>
          {saving ? '…' : 'SAVE'}
        </PxButton>
      </>}
    >
      {loading && <Loading label="loading settings" />}

      {settings && !loading && (
        <div className="tv-g3" style={{ gap: 32 }}>
          <Section title="HOME BASE">
            <Row label="Name">
              <Field
                value={settings.homeBase?.name || ''}
                onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), name: v } })}
                placeholder="Taipei"
                mono={false}
                style={fieldStyle}
              />
            </Row>
            <div className="tv-g2" style={{ gap: 14 }}>
              <Row label="Lat">
                <Field
                  value={settings.homeBase?.lat ?? ''}
                  onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), lat: v === '' ? null : Number(v) } })}
                  placeholder="25.04"
                  type="number"
                  style={fieldStyle}
                />
              </Row>
              <Row label="Lng">
                <Field
                  value={settings.homeBase?.lng ?? ''}
                  onChange={(v) => patch({ homeBase: { ...(settings.homeBase || {}), lng: v === '' ? null : Number(v) } })}
                  placeholder="121.56"
                  type="number"
                  style={fieldStyle}
                />
              </Row>
            </div>
            <Label as="p" style={{ margin: 0, fontSize: 10, lineHeight: 1.6 }}>
              Map picker arriving with MapLibre (task #10)
            </Label>
          </Section>

          <Section title="CURRENCY + UNITS">
            <Row label="Base currency">
              <PxSelect
                value={settings.baseCurrency || 'USD'}
                onChange={(v) => patch({ baseCurrency: v })}
                options={COMMON_CURRENCIES.map((c) => ({ v: c, l: c }))}
              />
            </Row>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Distance unit</Label>
              <Seg
                ariaLabel="Distance unit"
                options={['km', 'mi'].map((u) => ({ id: u, label: u.toUpperCase() }))}
                value={settings.distanceUnit}
                onChange={(u) => patch({ distanceUnit: u })}
                style={{ alignSelf: 'flex-start', marginLeft: 3 }}
              />
            </div>
            <Toggle
              checked={!!settings.fxAutoRefresh}
              onChange={(v) => patch({ fxAutoRefresh: v })}
              label="Auto-refresh FX rates daily"
              hint="Pulls latest rates from exchangerate.host every 24h"
            />
          </Section>

          <Section title="CUSTOM CATEGORIES">
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
              Extra expense categories beyond food / stay / transport / shopping / other
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 3 }}>
              {(settings.customCategories || []).map((c) => (
                <RemovableChip
                  key={c}
                  label={c}
                  onRemove={() => patch({ customCategories: settings.customCategories.filter((x) => x !== c) })}
                />
              ))}
              {(settings.customCategories || []).length === 0 && (
                <span style={{ color: COLORS.muted, fontSize: 13 }}>none yet</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '3px 8px 8px 3px' }}>
              <label style={{ flex: 1, minWidth: 0 }}>
                <span className="sr">New category</span>
                <Field
                  value={newCategory}
                  onChange={setNewCategory}
                  placeholder="Souvenir"
                  mono={false}
                  style={fieldStyle}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCategory(); } }}
                />
              </label>
              <PxButton onClick={onAddCategory} fill={GOLD} style={{ height: 44 }}>ADD</PxButton>
            </div>
          </Section>

          <Section title="TRIPMATES">
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
              Names only for v0.4 — used in expense PAID BY + settle flow
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 3 }}>
              {(settings.tripmates || []).map((m) => (
                <RemovableChip
                  key={m.id}
                  label={m.name}
                  onRemove={() => patch({ tripmates: settings.tripmates.filter((x) => x.id !== m.id) })}
                />
              ))}
              {(settings.tripmates || []).length === 0 && (
                <span style={{ color: COLORS.muted, fontSize: 13 }}>solo (none added)</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '3px 8px 8px 3px' }}>
              <label style={{ flex: 1, minWidth: 0 }}>
                <span className="sr">Tripmate name</span>
                <Field
                  value={newTripmate}
                  onChange={setNewTripmate}
                  placeholder="Alex"
                  mono={false}
                  style={fieldStyle}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddTripmate(); } }}
                />
              </label>
              <PxButton onClick={onAddTripmate} fill={GOLD} style={{ height: 44 }}>ADD</PxButton>
            </div>
          </Section>

          <Section title="DATA">
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: COLORS.muted }}>
              Trips, pins, plan items, checklist, reservations, transactions, notes, templates and settings.
            </p>
            <div style={{ padding: '0 8px 8px 0' }}>
              <PxButton onClick={onExportAll} style={{ height: 44 }}>↓ EXPORT ALL (JSON)</PxButton>
            </div>
          </Section>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </PxDialog>
  );
}

function Section({ title, children }) {
  return (
    <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: 0, padding: 0, border: 0, minWidth: 0 }}>
      <legend className="sk" style={{ padding: 0, marginBottom: 14, fontSize: 12, color: COLORS.text }}>
        <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 8, background: GOLD, boxShadow: '0 0 0 2px var(--ink)', verticalAlign: 'middle' }} />
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Row({ label, children }) {
  return <FormRow label={label}>{children}</FormRow>;
}

// Pixel toggle switch (button) + label text.
function Toggle({ checked, onChange, label, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 4 }}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
        className="tv-switch"
      >
        <span />
      </button>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer' }} onClick={() => onChange(!checked)}>
        <span style={{ fontSize: 13, color: COLORS.text }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.45 }}>{hint}</span>}
      </span>
    </div>
  );
}

function RemovableChip({ label, onRemove }) {
  return (
    <span
      className="sk pxs"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '0 2px 0 10px', minHeight: 32, background: COLORS.panel2,
        color: COLORS.text, fontSize: 11, textTransform: 'uppercase',
      }}
    >
      {label}
      <XBtn onClick={onRemove} label={`Remove ${label}`} style={{ width: 26, height: 26 }} />
    </span>
  );
}

function cryptoId() {
  // Short random id for tripmate references (browser-safe).
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
