// POST /api/video
// Body: { prompt: string, image?: string, engine?: 'seedance'|'veo3'|'kling'|'grok',
//         duration?: number, resolution?: '480p'|'720p'|'1080p',
//         aspectRatio?: '16:9'|'9:16'|'1:1'|'21:9', generateAudio?: boolean }
// Returns:
//   - { video: url }                              when result is ready within ~55s
//   - { pending: true, requestId, model, statusUrl, message }  when render still running
//
// GET /api/video?requestId=...&model=...   (client polling)
//
// Proxies to fal.ai. Hides FAL_API_KEY server-side.

import { pickVideoUrl } from './_helpers.js';

export const config = { maxDuration: 60 };

// Engine → fal model paths. Each engine picks t2v vs i2v based on whether
// the request body includes an image. Endpoint paths confirmed against fal.ai
// docs (2026-05). Override any of these via env if fal renames.
function pickModel(engine, hasImage) {
  switch (engine) {
    case 'veo3':
      return hasImage
        ? (process.env.FAL_VIDEO_VEO3_I2V || 'fal-ai/veo3.1/image-to-video')
        : (process.env.FAL_VIDEO_VEO3_T2V || 'fal-ai/veo3.1');
    case 'kling':
      return hasImage
        ? (process.env.FAL_VIDEO_KLING_I2V || 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video')
        : (process.env.FAL_VIDEO_KLING_T2V || 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video');
    case 'grok':
      return hasImage
        ? (process.env.FAL_VIDEO_GROK_I2V || 'xai/grok-imagine-video/image-to-video')
        : (process.env.FAL_VIDEO_GROK_T2V || 'xai/grok-imagine-video/text-to-video');
    case 'seedance':
    default:
      return hasImage
        ? (process.env.FAL_VIDEO_I2V_MODEL || 'fal-ai/bytedance/seedance-2.0/image-to-video')
        : (process.env.FAL_VIDEO_T2V_MODEL || 'fal-ai/bytedance/seedance-2.0/text-to-video');
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  if (req.method === 'GET') {
    const { requestId, model } = req.query || {};
    if (!requestId || !model) return res.status(400).json({ error: 'requestId and model required' });
    return await pollOnce({ apiKey, model, requestId, res });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt = '',
    image,
    engine = 'seedance',
    duration,
    resolution,
    aspectRatio,
    generateAudio,
  } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const model = pickModel(engine, !!image);

  const input = { prompt };
  if (image) input.image_url = image;
  if (Number.isFinite(Number(duration))) input.duration = Number(duration);
  if (resolution) input.resolution = resolution;
  if (aspectRatio) input.aspect_ratio = aspectRatio;
  if (typeof generateAudio === 'boolean') input.generate_audio = generateAudio;

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

    // Vercel serverless function maxDuration cap = 60s. Video gen can take longer.
    // We poll up to ~55s. If still pending, return job ID so client can poll separately later.
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const sd = await s.json();
      if (sd.status === 'COMPLETED') {
        const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
        const final = await finalRes.json();
        const policyErr = extractPolicyError(final);
        if (policyErr) return res.status(422).json({ error: policyErr, upstream: final });
        const url = pickVideoUrl(final);
        if (!url) return res.status(502).json({
          error: 'no video in response — keys=' + Object.keys(final || {}).join(',') + ' preview=' + JSON.stringify(final).slice(0, 400),
          upstream: final,
        });
        return res.status(200).json({ video: url, model });
      }
      if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
        return res.status(502).json({ error: 'fal job ' + sd.status, upstream: sd });
      }
    }
    return res.status(202).json({
      pending: true,
      requestId,
      model,
      statusUrl: `/api/video?requestId=${encodeURIComponent(requestId)}&model=${encodeURIComponent(model)}`,
      message: 'still rendering — video gen often exceeds 60s; client should poll',
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
      const url = pickVideoUrl(final);
      if (!url) return res.status(502).json({
        error: 'no video in response — keys=' + Object.keys(final || {}).join(',') + ' preview=' + JSON.stringify(final).slice(0, 400),
        upstream: final,
      });
      return res.status(200).json({ video: url, model });
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
// instead of { video: { url } }. Surface that as a clear user-facing error.
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
