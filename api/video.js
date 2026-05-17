// POST /api/video
// Body: { prompt: string, image?: string, duration?: number, resolution?: '480p'|'720p'|'1080p',
//         aspectRatio?: '16:9'|'9:16'|'1:1'|'21:9', generateAudio?: boolean }
// Returns: { video: string (URL) }
//
// Proxies to fal.ai seedance-2.0 (text-to-video by default; switches to image-to-video if `image` provided).
// Hides FAL_API_KEY server-side.

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt = '',
    image,
    duration,
    resolution,
    aspectRatio,
    generateAudio,
  } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.FAL_API_KEY;
  const t2v = process.env.FAL_VIDEO_T2V_MODEL || 'bytedance/seedance-2.0/text-to-video';
  const i2v = process.env.FAL_VIDEO_I2V_MODEL || 'bytedance/seedance-2.0/image-to-video';
  const model = image ? i2v : t2v;
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

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
        const url = final?.video?.url || final?.videos?.[0]?.url || final?.url || null;
        if (!url) return res.status(502).json({ error: 'no video in response', upstream: final });
        return res.status(200).json({ video: url, model });
      }
      if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
        return res.status(502).json({ error: 'fal job ' + sd.status, upstream: sd });
      }
    }
    return res.status(202).json({
      pending: true,
      requestId,
      statusUrl: `/api/video?requestId=${encodeURIComponent(requestId)}&model=${encodeURIComponent(model)}`,
      message: 'still rendering — video gen often exceeds 60s; client should poll',
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
