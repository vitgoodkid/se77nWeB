// GET /api/img-proxy?url=<remote image url>
//
// Streams a remote (fal-hosted) image through the server so the browser can
// read its bytes into IndexedDB for on-device caching — fal's CDN doesn't send
// permissive CORS headers, so a direct client fetch() would be blocked.
//
// SAFETY: host-allowlisted to fal/cdn domains only. This is NOT a general proxy
// — an open image proxy is an SSRF / abuse vector.

export const config = { maxDuration: 30 };

// Only these hosts (or their subdomains) may be fetched.
const ALLOWED_HOSTS = ['fal.ai', 'fal.media', 'fal.run'];

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  return ALLOWED_HOSTS.some((base) => h === base || h.endsWith('.' + base));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = req.query?.url;
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'url required' });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }
  if (target.protocol !== 'https:') return res.status(400).json({ error: 'https only' });
  if (!hostAllowed(target.hostname)) return res.status(403).json({ error: 'host not allowed' });

  try {
    const upstream = await fetch(target.toString());
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream ' + upstream.status });

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'not an image' });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
