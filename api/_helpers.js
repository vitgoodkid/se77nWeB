// Shared helpers for /api/* routes.
// Vercel ignores underscore-prefixed files in api/ as endpoints
// but allows them as importable modules.

// ── Chat (yunwu OpenAI-compatible) ─────────────────────────────
export async function callChat({ system, prompt, image, max_tokens = 1024, temperature = 0.7, jsonMode = false, model }) {
  const apiKey = process.env.YUNWU_API_KEY;
  const baseUrl = process.env.YUNWU_BASE_URL || 'https://yunwu.ai/v1';
  const chatModel = model || process.env.YUNWU_CHAT_MODEL || 'gemini-3.1-flash-lite';
  if (!apiKey) throw new Error('YUNWU_API_KEY not configured');

  const userContent = image
    ? [
        { type: 'text', text: prompt || 'Describe this image.' },
        { type: 'image_url', image_url: { url: image } },
      ]
    : prompt;

  const body = {
    model: chatModel,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: userContent },
    ],
    max_tokens,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    const msg = data?.error?.message || data?.message || 'chat upstream error';
    const err = new Error(msg);
    err.upstream = data;
    err.status = upstream.status;
    throw err;
  }
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
}

// ── fal.ai queue (submit + poll until completed or pending) ────
export async function falSubmitAndPoll(model, input, { maxWaitMs = 55_000, pollMs = 2000 } = {}) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY not configured');

  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
    body: JSON.stringify(input),
  });
  const submitData = await submit.json();
  if (!submit.ok) {
    const err = new Error(submitData?.detail || submitData?.message || 'fal submit failed');
    err.upstream = submitData;
    err.status = submit.status;
    throw err;
  }

  const requestId = submitData.request_id;
  const statusUrl = submitData.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const resultUrl = submitData.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
    const sd = await s.json();
    if (sd.status === 'COMPLETED') {
      const finalRes = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` } });
      return await finalRes.json();
    }
    if (sd.status === 'FAILED' || sd.status === 'CANCELLED') {
      const err = new Error('fal job ' + sd.status);
      err.upstream = sd;
      throw err;
    }
  }
  return { __pending: true, requestId, statusUrl, resultUrl };
}

// ── Common output extractors for fal models ────────────────────
// fal queue sometimes wraps output in { data: {...} } and sometimes returns
// it flat. Some models also nest under output/result. Check every shape we've
// seen so a schema bump on fal's side doesn't silently break the UI.
export function pickImageUrl(result) {
  if (!result) return null;
  const d = result.data || result.output || result.result || result;
  return d?.images?.[0]?.url
    || d?.image?.url
    || d?.url
    || result?.images?.[0]?.url
    || result?.image?.url
    || result?.url
    || null;
}
export function pickVideoUrl(result) {
  if (!result) return null;
  const d = result.data || result.output || result.result || result;
  return d?.video?.url
    || d?.videos?.[0]?.url
    || d?.url
    || result?.video?.url
    || result?.videos?.[0]?.url
    || result?.url
    || null;
}

// ── Strip code fences from JSON returned by chat models ────────
export function stripJsonFence(s) {
  if (!s) return s;
  return String(s).replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export function tryParseJson(s) {
  try {
    return JSON.parse(stripJsonFence(s));
  } catch {
    // Try to extract first {...} block
    const m = String(s).match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }
}
