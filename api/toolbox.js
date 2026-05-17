// /api/toolbox — bundled Toolbox endpoints.
//
// Vercel Hobby limits 12 serverless functions per deployment, so these three
// public utilities share a single function and dispatch on ?kind=.
//
// Endpoints (via vercel.json rewrites for clean URLs):
//   /s/:slug       → ?kind=short&slug=:slug&go=1   (302 redirect)
//   /p/:id         → ?kind=paste&id=:id&view=1     (HTML view)
//   /api/toolbox   → direct calls from ShortenerTool / PastebinTool / GameResourcesTool
//
// Public — no auth.

import { getDb } from './_lib/mongo.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  const kind = (req.query?.kind || '').toString();
  try {
    switch (kind) {
      case 'short': return await handleShort(req, res);
      case 'paste': return await handlePaste(req, res);
      case 'games': return await handleGames(req, res);
      default: return res.status(400).json({ error: 'unknown kind', hint: 'expected ?kind=short|paste|games' });
    }
  } catch (err) {
    console.error('[/api/toolbox]', kind, err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
}

// ═════════════════════════════════════════════════════════════
// SHORT — URL shortener
// ═════════════════════════════════════════════════════════════
const SLUG_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'auth', 'assets', 's', 'p', 'share',
  'login', 'logout', 'signup', 'settings', 'home',
]);
const MAX_URL_LEN = 2048;

function randomCode(len, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

let shortIndexEnsured = false;
async function ensureShortIndex(col) {
  if (shortIndexEnsured) return;
  try {
    await col.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });
    shortIndexEnsured = true;
  } catch { /* race — ignore */ }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shortNotFoundHtml(slug) {
  const safe = escapeHtml(slug);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 · se77n</title></head>
<body style="background:#0a0a0a;color:#888;font-family:ui-monospace,monospace;padding:40px;line-height:1.6">
<h1 style="color:#7fdb96">404 · Short link not found</h1>
<p style="color:#666">/s/${safe}</p>
<p><a href="/" style="color:#7fdb96">← back to se77n</a></p>
</body></html>`;
}

async function handleShort(req, res) {
  const db = await getDb();
  const col = db.collection('shortlinks');
  await ensureShortIndex(col);

  if (req.method === 'GET') {
    const slug = (req.query?.slug || '').toString();
    const go = req.query?.go === '1';
    if (!slug) return res.status(400).json({ error: 'slug required' });

    const doc = await col.findOne({ slug });
    if (!doc) {
      if (go) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(shortNotFoundHtml(slug));
      }
      return res.status(404).json({ error: 'not found' });
    }

    col.updateOne({ slug }, { $inc: { clicks: 1 }, $set: { lastClickAt: new Date() } }).catch(() => {});

    if (go) {
      res.writeHead(302, { Location: doc.url });
      return res.end();
    }
    return res.status(200).json({ slug: doc.slug, url: doc.url, clicks: doc.clicks || 0 });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const url = (body.url || '').toString().trim();
    let alias = (body.alias || '').toString().trim();

    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (url.length > MAX_URL_LEN) return res.status(400).json({ error: 'URL too long' });
    if (!isValidUrl(url)) return res.status(400).json({ error: 'URL must start with http:// or https://' });

    if (alias) {
      if (!SLUG_REGEX.test(alias)) return res.status(400).json({ error: 'Alias must be 3-32 chars, letters/digits/_/-' });
      if (RESERVED_SLUGS.has(alias.toLowerCase())) return res.status(400).json({ error: 'Alias is reserved' });
      const existing = await col.findOne({ slug: alias });
      if (existing) return res.status(409).json({ error: 'Alias already taken' });
    } else {
      for (let i = 0; i < 6; i++) {
        const candidate = randomCode(6);
        const exists = await col.findOne({ slug: candidate });
        if (!exists) { alias = candidate; break; }
      }
      if (!alias) return res.status(500).json({ error: 'Could not generate unique slug, try again' });
    }

    await col.insertOne({ slug: alias, url, createdAt: new Date(), clicks: 0 });
    return res.status(201).json({ slug: alias, url, path: `/s/${alias}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ═════════════════════════════════════════════════════════════
// PASTE — Pastebin
// ═════════════════════════════════════════════════════════════
const MAX_PASTE_BYTES = 256 * 1024;

let pasteIndexEnsured = false;
async function ensurePasteIndex(col) {
  if (pasteIndexEnsured) return;
  try {
    await col.createIndex({ pid: 1 }, { unique: true, name: 'pid_unique' });
    pasteIndexEnsured = true;
  } catch { /* race */ }
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

function pasteNotFoundHtml(pid) {
  const safe = escapeHtml(pid);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 · se77n</title></head>
<body style="background:#0a0a0a;color:#888;font-family:ui-monospace,monospace;padding:40px;line-height:1.6">
<h1 style="color:#7fdb96">404 · Paste not found</h1>
<p style="color:#666">/p/${safe}</p>
<p><a href="/" style="color:#7fdb96">← back to se77n</a></p>
</body></html>`;
}

async function handlePaste(req, res) {
  const db = await getDb();
  const col = db.collection('pastes');
  await ensurePasteIndex(col);

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
        return res.end(pasteNotFoundHtml(pid));
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
    if (bytes > MAX_PASTE_BYTES) {
      return res.status(413).json({ error: `Content too large (${(bytes / 1024).toFixed(1)} KB > ${MAX_PASTE_BYTES / 1024} KB)` });
    }

    let pid = '';
    for (let i = 0; i < 6; i++) {
      const candidate = randomCode(7);
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
}

// ═════════════════════════════════════════════════════════════
// GAMES — list files from a public Google Drive folder
// ═════════════════════════════════════════════════════════════
let gamesCache = { at: 0, data: null };
const GAMES_CACHE_MS = 60_000;

async function handleGames(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GDRIVE_API_KEY;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!apiKey || !folderId) {
    return res.status(503).json({
      error: 'GDrive not configured',
      hint: 'Set GDRIVE_API_KEY and GDRIVE_FOLDER_ID in Vercel env vars.',
    });
  }

  const search = (req.query?.q || '').toString().trim().toLowerCase();

  if (gamesCache.data && Date.now() - gamesCache.at < GAMES_CACHE_MS) {
    return res.status(200).json(filterGameFiles(gamesCache.data, search));
  }

  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink,webViewLink,webContentLink,description)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&orderBy=modifiedTime desc&key=${apiKey}`;

  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await r.json();
  if (!r.ok) {
    console.error('[/api/toolbox games] drive error', data);
    return res.status(r.status).json({
      error: data?.error?.message || 'Drive API error',
      upstream: data?.error,
    });
  }

  const files = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    size: f.size ? Number(f.size) : null,
    modifiedAt: f.modifiedTime,
    thumb: f.thumbnailLink || null,
    icon: f.iconLink || null,
    description: f.description || null,
    viewUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    downloadUrl: f.webContentLink || `https://drive.google.com/uc?export=download&id=${f.id}`,
  }));

  gamesCache = { at: Date.now(), data: files };
  return res.status(200).json(filterGameFiles(files, search));
}

function filterGameFiles(files, search) {
  if (!search) return { files, total: files.length };
  const filtered = files.filter((f) => f.name.toLowerCase().includes(search));
  return { files: filtered, total: filtered.length, filteredFrom: files.length };
}
