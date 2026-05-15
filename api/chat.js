// POST /api/chat
// Body: { system: string, prompt: string }
// Returns: { text: string }
//
// Proxies to yunwu (OpenAI-compatible) using Gemini chat model.
// Hides YUNWU_API_KEY server-side.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { system = '', prompt = '' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt required' });
  }
  const apiKey = process.env.YUNWU_API_KEY;
  const baseUrl = process.env.YUNWU_BASE_URL || 'https://yunwu.ai/v1';
  const model = process.env.YUNWU_CHAT_MODEL || 'gemini-3.1-flash-lite';
  if (!apiKey) return res.status(500).json({ error: 'YUNWU_API_KEY not configured' });

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
          { role: 'user', content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || data?.message || 'upstream error',
        upstream: data,
      });
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
