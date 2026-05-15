// POST /api/bg-remove
// Body: { image: string (data URL or http URL) }
// Returns: { image: string (URL of background-removed PNG) }
//
// Proxies to fal.ai ideogram/remove-background. Hides FAL_API_KEY.

import { falSubmitAndPoll, pickImageUrl } from './_helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });

  const model = process.env.FAL_BG_REMOVE_MODEL || 'fal-ai/ideogram/remove-background';

  try {
    const result = await falSubmitAndPoll(model, { image_url: image });
    if (result.__pending) {
      return res.status(202).json({ pending: true, requestId: result.requestId });
    }
    const url = pickImageUrl(result);
    if (!url) return res.status(502).json({ error: 'no image in response', upstream: result });
    return res.status(200).json({ image: url, model });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e), upstream: e.upstream });
  }
}
