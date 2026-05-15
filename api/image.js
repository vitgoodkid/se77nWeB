// POST /api/image
// Body: { prompt: string, image?: string (data URL or http URL) }
// Returns: { image: string (URL) }
//
// Proxies to fal.ai image edit model. Hides FAL_API_KEY server-side.

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt = '', image } = req.body || {};
  if (!prompt && !image) return res.status(400).json({ error: 'prompt or image required' });

  const apiKey = process.env.FAL_API_KEY;
  const model = process.env.FAL_IMAGE_MODEL || 'fal-ai/openai/gpt-image-2/edit';
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  const input = { prompt };
  if (image) input.image_urls = [image];

  try {
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({ input }),
    });
    const submitData = await submit.json();
    if (!submit.ok) return res.status(submit.status).json({ error: submitData?.detail || 'submit failed', upstream: submitData });

    const requestId = submitData.request_id;
    const statusUrl = submitData.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
    const resultUrl = submitData.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;

    // Poll for completion (capped to ~55s under maxDuration 60)
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
      const sd = await s.json();
      if (sd.status === 'COMPLETED') {
        const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
        const final = await finalRes.json();
        const url = final?.images?.[0]?.url || final?.image?.url || final?.url || null;
        if (!url) return res.status(502).json({ error: 'no image in response', upstream: final });
        return res.status(200).json({ image: url, model });
      }
      if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
        return res.status(502).json({ error: 'fal job ' + sd.status, upstream: sd });
      }
    }
    return res.status(504).json({ error: 'timeout waiting for fal image' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
