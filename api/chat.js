// POST /api/chat
// Body: { system: string, prompt: string, image?: string (data URL or http URL) }
// Returns: { text: string }
//
// Proxies to yunwu (OpenAI-compatible) using Gemini chat model.
// Hides YUNWU_API_KEY server-side. Supports multimodal input via OpenAI's
// `image_url` content part — provider must accept it (Gemini family does).

export const config = { maxDuration: 60 };

// Public endpoint — restrict client-selectable models to a known-good set so a
// caller can't bill arbitrary yunwu models. Anything else falls back to the
// server default.
const ALLOWED_MODELS = new Set([
  'gemini-3.1-pro-preview', 'gemini-3-pro-preview',
  'gemini-3.1-flash-preview', 'gemini-3-flash-preview',
  'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash',
  'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'grok-4', 'grok-4.1', 'grok-4-fast',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { system = '', prompt = '', image, model: reqModel, history } = req.body || {};
  if (!prompt && !image) {
    return res.status(400).json({ error: 'prompt or image required' });
  }
  const apiKey = process.env.YUNWU_API_KEY;
  const baseUrl = process.env.YUNWU_BASE_URL || 'https://yunwu.ai/v1';
  const defaultModel = process.env.YUNWU_CHAT_MODEL || 'gemini-3.1-flash-lite';
  const model = (typeof reqModel === 'string' && ALLOWED_MODELS.has(reqModel)) ? reqModel : defaultModel;
  if (!apiKey) return res.status(500).json({ error: 'YUNWU_API_KEY not configured' });

  const userContent = image
    ? [
        { type: 'text', text: prompt || 'Describe this image.' },
        { type: 'image_url', image_url: { url: image } },
      ]
    : prompt;

  const priorMsgs = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...priorMsgs,
          { role: 'user', content: userContent },
        ],
        max_tokens: 8000,
        temperature: 0.7,
      }),
    });
    const raw = await upstream.text();
    let data = null;
    if (raw) { try { data = JSON.parse(raw); } catch { /* not JSON */ } }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || data?.message || (raw && raw.slice(0, 300)) || 'upstream error',
        upstream: data,
      });
    }
    if (!data) {
      return res.status(502).json({ error: 'upstream returned non-JSON response' });
    }
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      '';
    return res.status(200).json({ text, model });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
