// Export helpers — pure functions, no React. Used by TvPlan / TvExpenses / TvFolder.
// Formats: iCalendar (.ics), CSV (transactions), printable HTML (browser print path).

// ─── Date formatting ───────────────────────────────────────────
function fmtIcsDateTime(date, time) {
  // YYYY-MM-DD + HH:mm → 20260812T143000  (local time, no UTC suffix to preserve TZ)
  if (!date) return null;
  const d = date.replace(/-/g, '');
  const t = (time || '00:00').replace(':', '') + '00';
  return d + 'T' + t;
}

function escIcs(s) {
  if (!s) return '';
  return String(s).replace(/[\\,;\n]/g, (c) => ({
    '\\': '\\\\', ',': '\\,', ';': '\\;', '\n': '\\n',
  }[c]));
}

function dayDateISO(trip, dayIndex) {
  if (!trip?.startDate) return null;
  const d = new Date(trip.startDate);
  d.setDate(d.getDate() + (dayIndex || 0));
  return d.toISOString().slice(0, 10);
}

// ─── ICS export ────────────────────────────────────────────────
export function tripToICS(trip, planItems, pins) {
  const pinById = new Map(pins.map((p) => [String(p._id), p]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//se77n//Travel v0.4//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escIcs(trip.title)}`,
  ];
  for (const it of planItems) {
    const date = dayDateISO(trip, it.dayIndex);
    if (!date) continue;
    const dtStart = fmtIcsDateTime(date, it.timeStart);
    const dtEnd = fmtIcsDateTime(date, it.timeEnd || addMinutes(it.timeStart, 60));
    const pin = it.pinId ? pinById.get(String(it.pinId)) : null;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${it._id || Math.random().toString(36).slice(2)}@se77n.travel`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`);
    if (dtStart) lines.push(`DTSTART:${dtStart}`);
    if (dtEnd) lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escIcs(it.title || '(untitled)')}`);
    if (it.notes) lines.push(`DESCRIPTION:${escIcs(it.notes)}`);
    if (pin?.name) lines.push(`LOCATION:${escIcs(pin.name)}`);
    if (pin?.lat && pin?.lng) lines.push(`GEO:${pin.lat};${pin.lng}`);
    if (it.url) lines.push(`URL:${escIcs(it.url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function addMinutes(time, mins) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── CSV (transactions) ────────────────────────────────────────
export function txnsToCSV(transactions, tripCurrency = 'USD') {
  const header = ['date', 'time', 'category', 'name', 'amount', 'currency', 'method', 'paid_by', 'notes'];
  const rows = [header.join(',')];
  for (const t of transactions) {
    const row = [
      t.date || '',
      t.time || '',
      t.customCategory || t.category || '',
      t.name || '',
      Number(t.amount) || 0,
      (t.currency || tripCurrency).toUpperCase(),
      t.method || '',
      t.paidBy || 'me',
      t.notes || '',
    ].map(csvCell);
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ─── Download helper ───────────────────────────────────────────
export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Share API ─────────────────────────────────────────────────
export async function createShareLink(tripId, expiryDays) {
  const r = await fetch('/api/tv4-share', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripId, expiryDays }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `http_${r.status}`);
  }
  return r.json();
}
