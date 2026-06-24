// POST /api/image
// Body: { prompt: string, image?: string (data URL or http URL), engine?: 'openai'|'nano' }
// Returns:
//   - { image: url }                              when result is ready within ~55s
//   - { pending: true, requestId, model, statusUrl, message }  when render still running
//
// GET /api/image?requestId=...&model=...
//   - { image: url }              when COMPLETED
//   - { pending: true }           still running
//   - { error: ... }              FAILED / CANCELLED
//
// Proxies to fal.ai. Hides FAL_API_KEY server-side. fal openai/gpt-image-2 often
// takes 60–120s, longer than Vercel Hobby's 60s function cap, so we surface a
// pending response that the client polls separately.

import { pickImageUrl } from './_helpers.js';
import { resolveOwner } from './_lib/threads.js';
import { enforceLimits, LIMITS } from './_lib/ratelimit.js';

export const config = { maxDuration: 60 };

function pickModel(engine, hasImage) {
  if (engine === 'nano') {
    return hasImage
      ? (process.env.FAL_IMAGE_NANO_MODEL || 'fal-ai/nano-banana-pro/edit')
      : (process.env.FAL_IMAGE_NANO_T2I_MODEL || 'fal-ai/nano-banana-pro');
  }
  return hasImage
    ? (process.env.FAL_IMAGE_MODEL || 'fal-ai/openai/gpt-image-2/edit')
    : (process.env.FAL_IMAGE_T2I_MODEL || 'fal-ai/openai/gpt-image-2');
}

// Host-allowlist for the image cache proxy (below). fal/cdn only — NOT a
// general proxy (an open image proxy is an SSRF / abuse vector).
const PROXY_ALLOWED_HOSTS = ['fal.ai', 'fal.media', 'fal.run'];
function proxyHostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  return PROXY_ALLOWED_HOSTS.some((base) => h === base || h.endsWith('.' + base));
}

// GET /api/image?url=<fal image url> → streams the bytes so the browser can
// cache them in IndexedDB (the stylist's on-device store) without CORS issues.
async function proxyImage(req, res) {
  const raw = req.query?.url;
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'url required' });
  let target;
  try { target = new URL(raw); } catch { return res.status(400).json({ error: 'invalid url' }); }
  if (target.protocol !== 'https:') return res.status(400).json({ error: 'https only' });
  if (!proxyHostAllowed(target.hostname)) return res.status(403).json({ error: 'host not allowed' });
  try {
    const upstream = await fetch(target.toString());
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream ' + upstream.status });
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) return res.status(415).json({ error: 'not an image' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}

export default async function handler(req, res) {
  // Image cache proxy (no fal key needed) — folded in to stay under the
  // Hobby-plan 12-serverless-function cap.
  if (req.method === 'GET' && req.query?.url) return await proxyImage(req, res);

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  // Polling branch — short request that just hits fal status/result endpoints.
  if (req.method === 'GET') {
    const { requestId, model } = req.query || {};
    if (!requestId || !model) return res.status(400).json({ error: 'requestId and model required' });
    return await pollOnce({ apiKey, model, requestId, res });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt = '', image, images, engine = 'openai' } = req.body || {};
  // Accept either a single `image` (string) or `images` (array) — the latter
  // lets the stylist lookbook compose several garment shots in one edit.
  const imageUrls = Array.isArray(images)
    ? images.filter((u) => typeof u === 'string' && u)
    : (image ? [image] : []);
  if (!prompt && !imageUrls.length) return res.status(400).json({ error: 'prompt or image required' });

  // Rate limit per owner before submitting a (paid) fal job.
  const owner = await resolveOwner(req, res);
  if (!(await enforceLimits(res, owner?.ownerKey, [LIMITS.imageMin, LIMITS.imageDay]))) return;

  const model = pickModel(engine, imageUrls.length > 0);

  const input = { prompt };
  if (imageUrls.length) input.image_urls = imageUrls;

  try {
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify(input),
    });
    const submitData = await submit.json();
    if (!submit.ok) return res.status(submit.status).json({ error: submitData?.detail || 'submit failed', upstream: submitData });

    const requestId = submitData.request_id;
    const statusUrl = submitData.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
    const resultUrl = submitData.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;

    // Inline poll up to ~55s. fal openai/gpt-image-2 commonly exceeds this; we
    // hand back a job ID so the client can poll /api/image?requestId=... after.
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const sd = await s.json();
      if (sd.status === 'COMPLETED') {
        const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
        const final = await finalRes.json();
        const policyErr = extractPolicyError(final);
        if (policyErr) return res.status(422).json({ error: policyErr, upstream: final });
        const url = pickImageUrl(final);
        if (!url) return res.status(502).json({ error: 'no image in response', upstream: final });
        return res.status(200).json({ image: url, model });
      }
      if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
        return res.status(502).json({ error: 'fal job ' + sd.status, upstream: sd });
      }
    }
    return res.status(202).json({
      pending: true,
      requestId,
      model,
      statusUrl: `/api/image?requestId=${encodeURIComponent(requestId)}&model=${encodeURIComponent(model)}`,
      message: 'still rendering — image gen often exceeds 60s; client should poll',
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}

async function pollOnce({ apiKey, model, requestId, res }) {
  try {
    const statusUrl = `https://queue.fal.run/${model}/requests/${requestId}/status`;
    const resultUrl = `https://queue.fal.run/${model}/requests/${requestId}`;
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
    const sd = await s.json();
    if (sd.status === 'COMPLETED') {
      const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const final = await finalRes.json();
      const policyErr = extractPolicyError(final);
      if (policyErr) return res.status(422).json({ error: policyErr, upstream: final });
      const url = pickImageUrl(final);
      if (!url) return res.status(502).json({ error: 'no image in response', upstream: final });
      return res.status(200).json({ image: url, model });
    }
    if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
      return res.status(502).json({ error: 'fal job ' + sd.status, upstream: sd });
    }
    return res.status(202).json({ pending: true, requestId, model });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}

// fal returns COMPLETED status even when output is rejected by safety filters —
// the result body has { detail: [{ msg, type: 'content_policy_violation' }] }
// instead of { images: [...] }. Surface that as a clear user-facing error.
function extractPolicyError(final) {
  const d = final?.detail;
  if (!Array.isArray(d) || !d.length) return null;
  const item = d[0];
  if (item?.type === 'content_policy_violation') {
    return item.msg || 'content policy violation';
  }
  if (item?.msg) return item.msg;
  return null;
}
