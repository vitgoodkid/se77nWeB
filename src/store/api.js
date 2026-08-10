const BASE = '/api/toolbox?kind=store';

async function call(resource, options = {}) {
  const params = new URLSearchParams({ kind: 'store', resource });
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const response = await fetch(`/api/toolbox?${params}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}

async function safeJson(response, label) {
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { /* not JSON */ }
  }
  if (!response.ok) {
    const detail = data?.error ?? data?.detail ?? data?.message;
    let msg;
    if (typeof detail === 'string') msg = detail;
    else if (Array.isArray(detail)) msg = detail.map((entry) => entry?.msg || JSON.stringify(entry)).join('; ');
    else if (detail && typeof detail === 'object') msg = detail.msg || detail.message || JSON.stringify(detail);
    else msg = `${label} ${response.status}`;
    const lower = msg.toLowerCase();
    if (lower.includes('credential') || lower.includes('unauthorized') || lower.includes('invalid key')) {
      msg = 'FAL_API_KEY không hợp lệ hoặc đã hết hạn. Kiểm tra lại trên Vercel (fal.ai dashboard → Keys).';
    }
    throw new Error(msg);
  }
  if (!data) throw new Error(`${label}: empty response`);
  return data;
}

async function pollImage(initial) {
  if (initial?.image) return initial.image;
  if (!initial?.pending || !initial.statusUrl) {
    throw new Error('image: missing url and not pending');
  }
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const data = await safeJson(await fetch(initial.statusUrl), 'image');
    if (data.image) return data.image;
    if (!data.pending) throw new Error('image: unexpected response');
  }
  throw new Error('image: still rendering after 10 min');
}

function isContentBlocked(message) {
  return /content[_\s-]?policy|content checker|safety|moderation|nsfw|violat/i.test(String(message || ''));
}

async function generateImageOnce({ prompt, image, engine }) {
  const response = await fetch('/api/image', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image, engine }),
  });
  return pollImage(await safeJson(response, 'image'));
}

/**
 * Edit/generate one product photo via /api/image (fal).
 * Default engine: nano. On content-checker / policy blocks, retry once with Grok Imagine.
 */
async function generateImage({ prompt, image, engine = 'nano' }) {
  try {
    return await generateImageOnce({ prompt, image, engine });
  } catch (cause) {
    if (engine !== 'grok' && isContentBlocked(cause?.message)) {
      try {
        return await generateImageOnce({ prompt, image, engine: 'grok' });
      } catch (fallbackErr) {
        throw new Error(`Grok fallback: ${fallbackErr.message || 'gen thất bại'} (sau khi nano bị content checker)`);
      }
    }
    throw cause;
  }
}

export const storeApi = {
  config: () => call('config'),
  products: (admin = false) => call('products', { query: admin ? { admin: 1 } : {} }),
  product: (id, admin = false) => call('products', { query: { id, ...(admin ? { admin: 1 } : {}) } }),
  createProduct: (body) => call('products', { method: 'POST', body }),
  updateProduct: (id, body) => call('products', { method: 'PUT', query: { id }, body }),
  deleteProduct: (id) => call('products', { method: 'DELETE', query: { id } }),
  uploadImage: (body) => call('uploads', { method: 'POST', body }),
  aiFill: (body) => call('ai', { method: 'POST', body }),
  generateImage,
  createOrder: (body) => call('orders', { method: 'POST', body }),
  orders: () => call('orders'),
  updateOrder: (id, status) => call('orders', { method: 'PATCH', query: { id }, body: { status } }),
  deleteOrder: (id) => call('orders', { method: 'DELETE', query: { id } }),
  trackVisit: (body) => call('visits', { method: 'POST', body }),
  visits: () => call('visits'),
};

export { BASE };
