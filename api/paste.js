// /api/paste — Pastebin backed by MongoDB.
//
// POST  body { content }                → 201 { id, viewUrl, rawUrl }
// GET   ?id=<id>                        → 200 { id, content, createdAt, len }
// GET   ?id=<id>&view=1                 → 200 text/html (used by /p/:id rewrite)
// GET   ?id=<id>&view=1&raw=1           → 200 text/plain (raw content)
//
// Public — no auth. Anyone can create a paste.
import { getDb } from './_lib/mongo.js';

export const config = { maxDuration: 10 };

const MAX_CONTENT_BYTES = 256 * 1024; // 256 KB per paste

function randomId(len = 7) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

let indexEnsured = false;
async function ensureIndex(col) {
  if (indexEnsured) return;
  try {
    await col.createIndex({ pid: 1 }, { unique: true, name: 'pid_unique' });
    indexEnsured = true;
  } catch { /* race — ignore */ }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderPasteHtml({ pid, content, createdAt }) {
  const safeContent = escapeHtml(content);
  const safeId = escapeHtml(pid);
  const date = new Date(createdAt).toISOString().slice(0, 19).replace('T', ' ');
  const bytes = Buffer.byteLength(content, 'utf8');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>/p/${safeId} · se77n pastebin</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0a; color: #d6d6d6;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height: 1.5; }
  .mono { font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 80px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    flex-wrap: wrap; padding-bottom: 18px; margin-bottom: 18px;
    border-bottom: 1px solid #1f1f1f; }
  .id { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
    color: #7fdb96; font-weight: 700; }
  .meta { font-size: 11px; color: #6a6a6a; letter-spacing: 0.06em; }
  .actions { display: flex; gap: 8px; }
  .btn { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 700; padding: 8px 14px; border-radius: 8px;
    border: 1px solid #2a2a2a; background: transparent; color: #d6d6d6;
    cursor: pointer; text-decoration: none; display: inline-block;
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace; }
  .btn:hover { border-color: #7fdb9655; background: #7fdb960a; color: #7fdb96; }
  pre { margin: 0; padding: 20px; border-radius: 12px;
    background: #060606; border: 1px solid #1a1a1a;
    color: #d6d6d6; font-size: 13px; line-height: 1.55;
    overflow: auto; white-space: pre-wrap; word-wrap: break-word;
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace; }
  .foot { margin-top: 18px; font-size: 11px; color: #5a5a5a; }
  a.home { color: #7fdb96; text-decoration: none; }
  a.home:hover { text-decoration: underline; }
</style>
</head><body>
<div class="wrap">
  <div class="head">
    <div>
      <div class="id mono">/p/${safeId}</div>
      <div class="meta mono">${date} UTC · ${bytes} bytes</div>
    </div>
    <div class="actions">
      <button class="btn" id="copy">Copy</button>
      <a class="btn" href="/p/${safeId}?raw=1">Raw</a>
    </div>
  </div>
  <pre id="content">${safeContent}</pre>
  <div class="foot mono"><a class="home" href="/">← se77n</a></div>
</div>
<script>
  document.getElementById('copy').addEventListener('click', async () => {
    const txt = document.getElementById('content').textContent;
    try { await navigator.clipboard.writeText(txt);
      const b = document.getElementById('copy');
      const orig = b.textContent; b.textContent = 'Copied ✓';
      setTimeout(() => { b.textContent = orig; }, 1200);
    } catch (e) {}
  });
</script>
</body></html>`;
}

function notFoundHtml(pid) {
  const safe = escapeHtml(pid);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 · se77n</title></head>
<body style="background:#0a0a0a;color:#888;font-family:ui-monospace,monospace;padding:40px;line-height:1.6">
<h1 style="color:#7fdb96">404 · Paste not found</h1>
<p style="color:#666">/p/${safe}</p>
<p><a href="/" style="color:#7fdb96">← back to se77n</a></p>
</body></html>`;
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection('pastes');
    await ensureIndex(col);

    if (req.method === 'GET') {
      const pid = (req.query?.id || '').toString();
      const view = req.query?.view === '1';
      const raw = req.query?.raw === '1';
      if (!pid) return res.status(400).json({ error: 'id required' });

      const doc = await col.findOne({ pid });
      if (!doc) {
        if (view) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(notFoundHtml(pid));
        }
        return res.status(404).json({ error: 'not found' });
      }

      if (view && raw) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end(doc.content);
      }
      if (view) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(renderPasteHtml(doc));
      }
      return res.status(200).json({
        id: doc.pid, content: doc.content,
        createdAt: doc.createdAt, len: doc.content.length,
      });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const content = (body.content || '').toString();
      if (!content.trim()) return res.status(400).json({ error: 'Content is empty' });
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_CONTENT_BYTES) {
        return res.status(413).json({ error: `Content too large (${(bytes / 1024).toFixed(1)} KB > ${MAX_CONTENT_BYTES / 1024} KB)` });
      }

      let pid = '';
      for (let i = 0; i < 6; i++) {
        const candidate = randomId(7);
        const exists = await col.findOne({ pid: candidate });
        if (!exists) { pid = candidate; break; }
      }
      if (!pid) return res.status(500).json({ error: 'Could not generate unique id, try again' });

      await col.insertOne({ pid, content, createdAt: new Date() });

      return res.status(201).json({
        id: pid,
        viewUrl: `/p/${pid}`,
        rawUrl: `/p/${pid}?raw=1`,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/paste]', err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
}
