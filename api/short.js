// /api/short — URL shortener backed by MongoDB.
//
// POST  body { url, alias? }            → 201 { slug, shortUrl, url }
// GET   ?slug=<slug>                    → 200 { slug, url, clicks }
// GET   ?slug=<slug>&go=1               → 302 redirect to url (used by /s/:slug rewrite)
//
// Public — no auth. Anyone can create a short link.
import { getDb } from './_lib/mongo.js';

export const config = { maxDuration: 10 };

const SLUG_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
const RESERVED = new Set([
  'api', 'admin', 'auth', 'assets', 's', 'p', 'share',
  'login', 'logout', 'signup', 'settings', 'home',
]);
const MAX_URL_LEN = 2048;

function randomSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

let indexEnsured = false;
async function ensureIndex(col) {
  if (indexEnsured) return;
  try {
    await col.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });
    indexEnsured = true;
  } catch { /* race on cold-start parallel — ignore */ }
}

function notFoundHtml(slug) {
  const safe = String(slug).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 · se77n</title></head>
<body style="background:#0a0a0a;color:#888;font-family:ui-monospace,monospace;padding:40px;line-height:1.6">
<h1 style="color:#7fdb96">404 · Short link not found</h1>
<p style="color:#666">/s/${safe}</p>
<p><a href="/" style="color:#7fdb96">← back to se77n</a></p>
</body></html>`;
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection('shortlinks');
    await ensureIndex(col);

    if (req.method === 'GET') {
      const slug = (req.query?.slug || '').toString();
      const go = req.query?.go === '1';
      if (!slug) return res.status(400).json({ error: 'slug required' });

      const doc = await col.findOne({ slug });
      if (!doc) {
        if (go) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(notFoundHtml(slug));
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
        if (RESERVED.has(alias.toLowerCase())) return res.status(400).json({ error: 'Alias is reserved' });
        const existing = await col.findOne({ slug: alias });
        if (existing) return res.status(409).json({ error: 'Alias already taken' });
      } else {
        for (let i = 0; i < 6; i++) {
          const candidate = randomSlug(6);
          const exists = await col.findOne({ slug: candidate });
          if (!exists) { alias = candidate; break; }
        }
        if (!alias) return res.status(500).json({ error: 'Could not generate unique slug, try again' });
      }

      await col.insertOne({ slug: alias, url, createdAt: new Date(), clicks: 0 });

      return res.status(201).json({ slug: alias, url, path: `/s/${alias}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/short]', err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
}
