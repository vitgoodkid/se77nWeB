// NOTES tab body — markdown editor with per-day picker + live preview + auto-save.
// Custom mini markdown renderer to avoid adding a runtime dep for ~5 syntax rules.
// Note shape: { _id, tripId, dayIndex, date, content, pinId, updatedAt }
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { COLORS, Btn, Field, useMediaQuery } from '../lib.jsx';
import { tv4 } from './api.js';

function tripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return 1;
  const s = new Date(trip.startDate), e = new Date(trip.endDate);
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function dayDate(trip, idx) {
  if (!trip?.startDate || idx < 0) return '';
  const d = new Date(trip.startDate);
  d.setDate(d.getDate() + idx);
  return d.toISOString().slice(0, 10);
}

function shortRelative(ts) {
  if (!ts) return 'unsaved';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 5000) return 'saved just now';
  if (ms < 60000) return `saved ${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `saved ${Math.floor(ms / 60000)}m ago`;
  return `saved ${Math.floor(ms / 3600000)}h ago`;
}

export default function TvNotes({ trip }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const days = trip ? tripDays(trip) : 1;
  const [notes, setNotes] = useState([]);
  const [activeDay, setActiveDay] = useState(0);
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef(null);
  const pendingTextRef = useRef(null);
  const activeIdRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const tripId = trip?._id;
  const refresh = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const { docs } = await tv4.list('notes', { tripId });
      if (mountedRef.current) setNotes(docs || []);
    } catch (e) {
      console.warn('notes fetch', e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Map dayIndex → most recent note for that day.
  const noteByDay = useMemo(() => {
    const m = {};
    for (const n of notes) {
      const d = n.dayIndex ?? -1;
      if (!m[d] || (n.updatedAt || '') > (m[d].updatedAt || '')) m[d] = n;
    }
    return m;
  }, [notes]);

  // Load content when switching day.
  useEffect(() => {
    const n = noteByDay[activeDay];
    setContent(n?.content || '');
    setSavedAt(n?.updatedAt || null);
    activeIdRef.current = n?._id || null;
  }, [activeDay, noteByDay]);

  const persist = useCallback(async (text) => {
    if (!tripId) return;
    setSaving(true);
    try {
      const id = activeIdRef.current;
      if (id) {
        await tv4.update('notes', id, { content: text });
      } else {
        const { doc } = await tv4.create('notes', {
          tripId,
          dayIndex: activeDay,
          date: dayDate(trip, activeDay),
          content: text,
        });
        activeIdRef.current = doc._id;
      }
      const now = new Date().toISOString();
      if (!mountedRef.current) return;
      setSavedAt(now);
      setNotes((arr) => {
        const idx = arr.findIndex((n) => n._id === activeIdRef.current);
        if (idx < 0) return [...arr, { _id: activeIdRef.current, tripId, dayIndex: activeDay, content: text, updatedAt: now }];
        const next = arr.slice();
        next[idx] = { ...next[idx], content: text, updatedAt: now };
        return next;
      });
    } catch (e) {
      console.warn('note save failed', e);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [tripId, trip, activeDay]);

  // Debounced auto-save on content change. Tracks the pending text in a ref so
  // cleanup can flush only when there's actually a queued write.
  const onChange = useCallback((v) => {
    setContent(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingTextRef.current = v;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      pendingTextRef.current = null;
      persist(v);
    }, 800);
  }, [persist]);

  // Flush pending save when switching day / unmounting.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const pending = pendingTextRef.current;
        pendingTextRef.current = null;
        if (pending != null) persist(pending);
      }
    };
  }, [activeDay, persist]);

  const html = useMemo(() => miniMarkdown(content), [content]);

  if (!trip) return (
    <div style={{ padding: 24, color: COLORS.muted, fontSize: 12 }} className="mono">◇ no trip</div>
  );

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '140px minmax(0, 1fr) minmax(0, 1fr)',
      gap: 12, height: '100%', minHeight: 480,
    }}>
      <DayPicker
        days={days}
        active={activeDay}
        onSelect={setActiveDay}
        noteByDay={noteByDay}
        trip={trip}
        loading={loading}
      />

      <Editor
        content={content}
        onChange={onChange}
        savedAt={savedAt}
        saving={saving}
        activeDay={activeDay}
        trip={trip}
      />

      <Preview html={html} />
    </div>
  );
}

function DayPicker({ days, active, onSelect, noteByDay, trip, loading }) {
  return (
    <aside style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto',
    }}>
      <div className="mono" style={{
        fontSize: 9, letterSpacing: '0.22em', color: COLORS.muted,
        padding: '4px 8px', marginBottom: 4,
      }}>DAYS</div>
      <DayButton
        on={active === -1}
        onClick={() => onSelect(-1)}
        label="GENERAL"
        date=""
        hasNote={!!noteByDay[-1]}
      />
      {Array.from({ length: days }, (_, i) => (
        <DayButton
          key={i}
          on={active === i}
          onClick={() => onSelect(i)}
          label={`D${i + 1}`}
          date={dayDate(trip, i).slice(5)}
          hasNote={!!noteByDay[i]}
        />
      ))}
      {loading && (
        <div className="mono" style={{ fontSize: 9, color: COLORS.muted, padding: '4px 8px' }}>◇ loading…</div>
      )}
    </aside>
  );
}

function DayButton({ on, onClick, label, date, hasNote }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '7px 8px', borderRadius: 6,
        background: on ? COLORS.gold + '14' : 'transparent',
        border: '1px solid ' + (on ? COLORS.gold + '55' : 'transparent'),
        color: on ? COLORS.gold : COLORS.text,
        cursor: 'pointer', fontSize: 12, textAlign: 'left',
      }}
    >
      <span className="mono" style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {hasNote && <span style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.gold }} />}
        <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}>{date}</span>
      </span>
    </button>
  );
}

function Editor({ content, onChange, savedAt, saving, activeDay, trip }) {
  const label = activeDay === -1 ? 'GENERAL NOTES' : `DAY ${activeDay + 1} · ${dayDate(trip, activeDay)}`;
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column',
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: COLORS.gold }}>
          {label}
        </div>
        <div className="mono" style={{ fontSize: 10, color: COLORS.muted }}>
          {saving ? '◇ saving…' : shortRelative(savedAt)}
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder="# headline\n\nWrite freely — # heading, **bold**, *italic*, [link](url), - list item, `code`"
        style={{
          flex: 1, minHeight: 320,
          background: COLORS.bg, border: '1px solid ' + COLORS.line,
          borderRadius: 8, padding: 12,
          color: COLORS.text, fontSize: 13, lineHeight: 1.55,
          resize: 'vertical',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
    </div>
  );
}

function Preview({ html }) {
  return (
    <div style={{
      background: COLORS.panel, border: '1px solid ' + COLORS.line,
      borderRadius: 12, padding: 16,
      overflow: 'auto', minWidth: 0,
    }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.22em', color: COLORS.muted, marginBottom: 10,
      }}>PREVIEW</div>
      {html ? (
        <div
          style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.65 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div style={{ color: COLORS.muted, fontSize: 12 }}>—</div>
      )}
    </div>
  );
}

// Minimal markdown — handles: headings, bold, italic, inline code, links, unordered lists, paragraphs.
// HTML-escapes input first; emits a small set of inline transforms.
// Not standards-compliant — designed for personal trip notes, not document publishing.
function miniMarkdown(src) {
  if (!src) return '';
  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = esc(src).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl} style="margin:14px 0 6px; font-weight:700; font-size:${20 - lvl * 2}px;">${inline(h[2])}</h${lvl}>`);
      i++; continue;
    }

    // List block
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul style="margin:8px 0; padding-left:20px;">${items.join('')}</ul>`);
      continue;
    }

    // Blank line → spacer
    if (line.trim() === '') { i++; continue; }

    // Paragraph: gather until blank line
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^[-*]\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p style="margin:6px 0;">${inline(para.join('<br/>'))}</p>`);
  }
  return out.join('\n');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code style="background:rgba(245,237,224,0.08); padding:1px 4px; border-radius:3px; font-family:JetBrains Mono, monospace; font-size:0.9em;">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = safeUrl(url);
      if (!safe) return label;
      return `<a href="${safe}" target="_blank" rel="noreferrer noopener" style="color:#D4A858; text-decoration:underline;">${label}</a>`;
    });
}

// Allow http(s)/mailto/relative paths only — blocks javascript:, data:, vbscript: payloads
// that could fire on click. Input is already HTML-escaped (& < >), so we test against
// the unescaped scheme via a single decode of `&amp;` (the only ambiguous one in URLs).
function safeUrl(raw) {
  const url = String(raw).trim().replace(/&amp;/g, '&');
  if (/^(https?:|mailto:|\/|#|\?)/i.test(url)) {
    return url.replace(/"/g, '%22');
  }
  return null;
}
