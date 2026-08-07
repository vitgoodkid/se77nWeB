// Shared helpers for /api/* routes.
// Vercel ignores underscore-prefixed files in api/ as endpoints
// but allows them as importable modules.

// ── Chat via fal's openrouter/router (uses FAL_API_KEY) ─────────
// fal proxies OpenRouter LLMs behind one TEXT-ONLY endpoint: prompt +
// system_prompt, no messages array / tools / image input. We flatten the
// conversation into a single prompt. Model ids may carry an "openrouter:"/
// "fal:" prefix (stripped). yunwu retired.
const FAL_CHAT_URL = 'https://fal.run/openrouter/router';

function resolveFalModel(model) {
  // fal's router only accepts concrete OpenRouter ids — NOT "-latest" aliases.
  const fallback = process.env.FAL_CHAT_MODEL || 'google/gemini-2.5-flash';
  const m = (typeof model === 'string' && model.trim()) ? model.trim() : fallback;
  return m.replace(/^(?:openrouter|fal):/, '');
}

function flattenForFal(system, history, prompt) {
  const turns = [];
  if (Array.isArray(history)) {
    for (const m of history) {
      if (!m || typeof m.content !== 'string' || !m.content.trim()) continue;
      if (m.role === 'user') turns.push(`User: ${m.content}`);
      else if (m.role === 'assistant') turns.push(`Assistant: ${m.content}`);
    }
  }
  if (prompt) turns.push(`User: ${prompt}`);
  return { prompt: turns.join('\n\n') || '(empty)', system_prompt: system || '' };
}

// Core text completion through fal openrouter/router. Returns { text, tokensIn, tokensOut }.
export async function falChat({ system, history, prompt, model, temperature = 0.7, maxTokens = 1024, jsonMode = false }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY not configured');
  const sys = jsonMode
    ? `${system || ''}\n\nReturn ONLY valid JSON — no prose, no markdown code fences.`.trim()
    : system;
  const flat = flattenForFal(sys, history, prompt);
  const upstream = await fetch(FAL_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
    body: JSON.stringify({
      model: resolveFalModel(model),
      prompt: flat.prompt,
      // fal's router makes reasoning mandatory for Gemini 2.5-pro / 3.x (400
      // otherwise) and 2.5-flash tolerates it without burning extra tokens.
      reasoning: true,
      ...(flat.system_prompt ? { system_prompt: flat.system_prompt } : {}),
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    const msg = data?.detail || data?.error || data?.message || 'fal chat error';
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.upstream = data;
    err.status = upstream.status;
    throw err;
  }
  const out = data.output ?? data.data?.output ?? '';
  const usage = data.usage ?? data.data?.usage ?? {};
  return {
    text: (out || '').trim(),
    tokensIn: usage.prompt_tokens ?? 0,
    tokensOut: usage.completion_tokens ?? 0,
  };
}

// ── Chat: text → fal router; image → optional OpenRouter vision ─
// fal openrouter/router is text-only. When an image is attached (stylist
// classify/detect, vision chat), fall back to OpenRouter's OpenAI-compatible
// endpoint — but only if OPENROUTER_API_KEY is set. Without it, image requests
// surface a clear error rather than silently dropping the picture.
export async function callChat({ system, prompt, image, images, history, max_tokens = 1024, temperature = 0.7, jsonMode = false, model }) {
  const visionImages = Array.isArray(images)
    ? images.map((entry) => String(entry || '').trim()).filter(Boolean)
    : (image ? [String(image).trim()].filter(Boolean) : []);
  if (!visionImages.length) {
    const { text } = await falChat({ system, history, prompt, model, temperature, maxTokens: max_tokens, jsonMode });
    return text;
  }
  return callVisionChat({ system, prompt, images: visionImages, history, max_tokens, temperature, jsonMode, model });
}

async function callVisionChat({ system, prompt, images, history, max_tokens, temperature, jsonMode, model }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error('Phân tích ảnh cần OPENROUTER_API_KEY (fal openrouter/router không nhận ảnh).');
    err.status = 501;
    throw err;
  }
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const visionModel = (model || process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-pro')
    .replace(/^(?:openrouter|fal):/, '');
  const priorMsgs = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];
  const imageParts = (Array.isArray(images) ? images : []).slice(0, 8).map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));
  const body = {
    model: visionModel,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...priorMsgs,
      { role: 'user', content: [
        { type: 'text', text: prompt || 'Describe this image.' },
        ...imageParts,
      ] },
    ],
    max_tokens,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  // Gemini 2.5 via OpenRouter often burns the whole max_tokens budget on
  // "thinking" and returns empty message.content — keep reasoning low for
  // structured product fills so JSON actually comes back.
  if (/gemini/i.test(visionModel)) {
    body.reasoning = { effort: 'low' };
  }
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    const err = new Error(data?.error?.message || data?.message || 'vision chat error');
    err.upstream = data;
    err.status = upstream.status;
    throw err;
  }
  const choice = data?.choices?.[0];
  const textOut = extractAssistantText(choice?.message) || String(choice?.text || '').trim();
  if (!textOut) {
    const finish = choice?.finish_reason || data?.error?.message || 'empty';
    const err = new Error(`OpenRouter/Gemini trả về rỗng (finish=${finish}). Thử lại hoặc đổi STORE_AI_MODEL sang google/gemini-2.5-flash.`);
    err.status = 422;
    err.upstream = data;
    throw err;
  }
  return textOut;
}

/** Normalize OpenAI/OpenRouter message.content (string | parts[]) to text. */
function extractAssistantText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text') return part.text || '';
        return part.text || part.content || '';
      })
      .join('')
      .trim();
  }
  if (typeof message.refusal === 'string' && message.refusal.trim()) return message.refusal.trim();
  return '';
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

/** Extract the first balanced {...} object from a string. */
function extractBalancedObject(s) {
  const text = String(s || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function tryParseJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  const cleaned = stripJsonFence(s);
  try {
    return JSON.parse(cleaned);
  } catch {
    const block = extractBalancedObject(cleaned) || extractBalancedObject(String(s));
    if (block) {
      try { return JSON.parse(block); } catch { /* fall through */ }
    }
    // Last resort: greedy {...} (may fail on nested junk)
    const m = String(s).match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* ignore */ }
    }
    return null;
  }
}
